#include "BpHands.h"

#include "BpGameMode.h"
#include "BpPawn.h"
#include "BpTable.h"
#include "Camera/CameraComponent.h"
#include "Core/IsdkConditionalBool.h"
#include "Core/IsdkConditionalGroupAll.h"
#include "DataSources/IsdkIHandPointerPose.h"
#include "DataSources/IsdkIRootPose.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "HandPoseDetection/IsdkHandFingerPinchGrabRecognizer.h"
#include "InputCoreTypes.h"
#include "IsdkHandMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "MotionControllerComponent.h"
#include "Rig/IsdkControllerRigComponent.h"
#include "Rig/IsdkHandRigComponent.h"
#include "Rig/IsdkHandVisualsRigComponent.h"

DEFINE_LOG_CATEGORY(LogBpHands);

namespace
{
	FAutoConsoleCommandWithWorldAndArgs CmdHandsPinch(
		TEXT("BpHands.Pinch"),
		TEXT("BpHands.Pinch <wing id|room id|crumb id|deck:next|deck:prev|deck:approve|deck:decline|feature:<id>>: the synthetic hand points at it, pinches and pulls the pinch toward the eye (on a crumb, a deck control or a feature it taps: released where it closed), through the same judging as real hands."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Pinch <wing id|room id|crumb id>"));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Pinch ") + Args[0]);
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdHandsSimulate(
		TEXT("BpHands.Simulate"),
		TEXT("BpHands.Simulate lost|back: every hand stops reporting (lost, after the coast bound) or reports again (back, after the settle interval)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0 || !(Args[0].Equals(TEXT("lost"), ESearchCase::IgnoreCase) || Args[0].Equals(TEXT("back"), ESearchCase::IgnoreCase)))
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Simulate lost|back"));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Simulate ") + Args[0].ToLower());
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdHandsPoint(
		TEXT("BpHands.Point"),
		TEXT("BpHands.Point <lamp|feature:<id>|minimap:<room>|...> [seconds]: the synthetic hand points at it without pinching for that long (default 2), so a hold acts (the lamp: the next room; a feature: the lamp's line about it; a key plan room: a switch)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Point <id> [seconds]"));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Point ") + Args[0] + (Args.Num() > 1 ? TEXT(" ") + Args[1] : FString()));
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdHandsLasso(
		TEXT("BpHands.Lasso"),
		TEXT("BpHands.Lasso <feature id>...: the synthetic hand pinches on the room's map and draws a loop round those features' glyphs (BpRoom.Lasso's loop), then releases: the hands' own lasso."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Lasso <feature id>..."));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Lasso ") + FString::Join(Args, TEXT(" ")));
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdHandsPush(
		TEXT("BpHands.Push"),
		TEXT("BpHands.Push [id]: the synthetic hand pinches (on the id, or on what is lifted now) and pushes the pinch away from the eye."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			UBpHands::PendingCommands().Add(TEXT("Push ") + (Args.Num() > 0 ? Args[0] : FString(TEXT("*"))));
		}));

	bool IsCrumb(const FString& Id)
	{
		return Id == TEXT("home") || Id.StartsWith(TEXT("wing:")) || Id.StartsWith(TEXT("room:"));
	}

	/** A pinch released where it closed, with no pull: a crumb, the screen deck's controls, a feature on the room's map, a
	 *  key plan room, the wrist's tabs and rows (ABpTable's hands' rule). */
	bool IsTap(const FString& Id)
	{
		return IsCrumb(Id) || Id.StartsWith(TEXT("deck:")) || Id.StartsWith(TEXT("feature:")) || Id.StartsWith(TEXT("minimap:")) || Id.StartsWith(TEXT("wrist:"));
	}

	/** What a hold acts on (ABpTable's hands' rule): the lamp's head, a feature's glyph, a key plan room. */
	bool IsHoldable(const FString& Kind)
	{
		return Kind == TEXT("lamp") || Kind == TEXT("feature") || Kind == TEXT("minimap");
	}

	bool IsLive(EBpTracking State)
	{
		return State != EBpTracking::Lost;
	}
}

TArray<FString>& UBpHands::PendingCommands()
{
	static TArray<FString> Pending;
	return Pending;
}

UBpHands::UBpHands()
{
	PrimaryComponentTick.bCanEverTick = true;
	// After the Isdk rigs have read this frame's hands and controllers.
	PrimaryComponentTick.TickGroup = TG_PostPhysics;
}

void UBpHands::BeginPlay()
{
	Super::BeginPlay();
	for (int32 Side = Left; Side <= Right; ++Side)
	{
		Pinch[Side] = NewObject<UIsdkHandFingerPinchGrabRecognizer>(this);
		HideHand[Side] = NewObject<UIsdkConditionalBool>(this);
		HideHand[Side]->SetValue(false);
	}
}

const TCHAR* UBpHands::SlotName(int32 Slot)
{
	return Slot == Left ? TEXT("left") : Slot == Right ? TEXT("right") : TEXT("synthetic");
}

ABpTable* UBpHands::FindTable()
{
	if (!Table.IsValid() && GetWorld())
	{
		for (TActorIterator<ABpTable> It(GetWorld()); It; ++It)
		{
			Table = *It;
			break;
		}
	}
	return Table.Get();
}

FVector UBpHands::Eye() const
{
	const ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
	return Pawn ? Pawn->GetPawnViewLocation() : FVector::ZeroVector;
}

FVector UBpHands::TowardEye(const FVector& Point) const
{
	FVector Dir = Eye() - Point;
	Dir.Z = 0.0;
	if (Dir.Normalize()) return Dir;
	// The eye straight above the pinch: toward the table's near edge.
	const ABpTable* T = Table.Get();
	return T ? -T->GetActorForwardVector() : FVector(-1.0, 0.0, 0.0);
}

FString UBpHands::LevelName() const
{
	const ABpTable* T = Table.Get();
	return FString::Printf(TEXT("L%d"), T ? static_cast<int32>(T->GetBpLevel()) : 0);
}

// ---- Reading the headset ----------------------------------------------------------------------------------------------

void UBpHands::ReadHeadset(float DeltaTime, FSample (&Out)[2])
{
	ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
	if (!Pawn) return;
	const FVector HeadForward = Pawn->GetCamera()->GetForwardVector();

	bool bHand[2] = { false, false };
	bool bController[2] = { false, false };
	FSample Hand[2], Controller[2];
	for (int32 Side = Left; Side <= Right; ++Side)
	{
		// A hand: the Isdk rig's data sources, the pointer pose for the ray, and our own pinch recognizer on its mesh.
		if (UIsdkHandRigComponent* Rig = Pawn->GetHandRig(Side))
		{
			UIsdkHandVisualsRigComponent* Visuals = Rig->GetHandVisuals();
			const FIsdkTrackingDataSources* Sources = Visuals ? &Visuals->GetDataSources() : nullptr;
			UObject* Root = Sources ? Sources->HandRootPose.GetObject() : nullptr;
			UObject* Pointer = Sources ? Sources->HandPointerPose.GetObject() : nullptr;
			if (Root && Pointer && IIsdkIRootPose::Execute_IsRootPoseValid(Root))
			{
				FTransform Pose;
				bool bPoseValid = false;
				IIsdkIHandPointerPose::Execute_GetPointerPose(Pointer, Pose, bPoseValid);
				if (bPoseValid)
				{
					bHand[Side] = true;
					Hand[Side].bValid = Hand[Side].bAims = true;
					Hand[Side].RayOrigin = Hand[Side].PinchPoint = Pose.GetLocation();
					Hand[Side].RayDir = Pose.GetRotation().GetForwardVector();
					UIsdkHandFingerPinchGrabRecognizer* Recognizer = Pinch[Side];
					if (Recognizer && Visuals->TrackedHandVisual)
					{
						Recognizer->HandVisual = Visuals->TrackedHandVisual;
						Recognizer->CurrentWristForward = IIsdkIRootPose::Execute_GetRootPose(Root).GetRotation().GetForwardVector();
						Recognizer->CurrentHMDForward = HeadForward;
						Recognizer->UpdateState(DeltaTime);
						Hand[Side].bPinching = Recognizer->IsActive();
					}
				}
			}
		}
		// A controller: its aim pose and its trigger.
		UMotionControllerComponent* Aim = Pawn->GetControllerAim(Side);
		if (Aim && Aim->IsTracked())
		{
			bController[Side] = true;
			Controller[Side].bValid = Controller[Side].bAims = true;
			Controller[Side].RayOrigin = Controller[Side].PinchPoint = Aim->GetComponentLocation();
			Controller[Side].RayDir = Aim->GetForwardVector();
			const APlayerController* PC = Cast<APlayerController>(Pawn->GetController());
			const float Trigger = PC ? PC->GetInputAnalogKeyState(Side == Left ? EKeys::OculusTouch_Left_Trigger_Axis : EKeys::OculusTouch_Right_Trigger_Axis) : 0.f;
			bool& bDown = Slots[Side].bTriggerDown;
			bDown = bDown ? Trigger > TriggerReleased : Trigger >= TriggerPressed;
			Controller[Side].bPinching = bDown;
		}
	}

	// Hands lead whenever either is seen; the controllers otherwise; with neither, the last input stays (that is a loss).
	EInput Now = Input;
	if (bHand[Left] || bHand[Right]) Now = EInput::Hands;
	else if (bController[Left] || bController[Right]) Now = EInput::Controllers;
	if (Now != Input)
	{
		Input = Now;
		UE_LOG(LogBpHands, Log, TEXT("BpHands: input=%s"), Input == EInput::Hands ? TEXT("hands") : TEXT("controllers"));
	}
	for (int32 Side = Left; Side <= Right; ++Side)
	{
		Out[Side] = Input == EInput::Controllers ? Controller[Side] : Hand[Side];
	}
}

// ---- The tracking states ----------------------------------------------------------------------------------------------

void UBpHands::Step(int32 Slot, const FSample& Sample, float DeltaTime)
{
	FSlot& S = Slots[Slot];
	if (!Sample.bValid)
	{
		if (S.State == EBpTracking::Tracked || S.State == EBpTracking::Reacquiring)
		{
			S.State = EBpTracking::Coasting;
			S.GapS = 0.f;
		}
		if (S.State == EBpTracking::Coasting)
		{
			S.GapS += DeltaTime;
			if (S.GapS > CoastS)
			{
				S.State = EBpTracking::Lost;
				OnLost(Slot);
			}
		}
		return;
	}

	if (S.State == EBpTracking::Lost || S.State == EBpTracking::Coasting)
	{
		const bool bWasLost = S.State == EBpTracking::Lost;
		S.State = EBpTracking::Reacquiring;
		S.SettledS = 0.f;
		// Recognition never spans a gap: a coasted pinch restarts its distance after the settle interval, and a pinch
		// already closed when the hand comes back is not fresh.
		S.bRebase = S.bPinch;
		if (!S.bPinch && Sample.bPinching) S.bNeedRelease = true;
		if (bWasLost) OnBack(Slot);
	}
	if (Sample.bAims && FindTable())
	{
		// The wrist panel first (it is nearest the eye; spark vr-room-layers WP3's room list), then the table.
		const ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
		if (Pawn && Pawn->WristHit(Sample.RayOrigin, Sample.RayDir, S.HoverId)) S.HoverKind = TEXT("wrist");
		else Table->HitTest(Sample.RayOrigin, Sample.RayDir, S.HoverKind, S.HoverId);
	}
	else
	{
		S.HoverKind.Reset();
		S.HoverId.Reset();
	}
	if (S.State == EBpTracking::Reacquiring)
	{
		S.SettledS += DeltaTime;
		if (S.SettledS < SettleS) return;
		S.State = EBpTracking::Tracked;
		if (S.bRebase && S.bPinch)
		{
			S.Onset = Sample.PinchPoint;
			S.PullDir = TowardEye(S.Onset);
		}
		S.bRebase = false;
	}
	Judge(Slot, Sample);
}

void UBpHands::OnLost(int32 Slot)
{
	FSlot& S = Slots[Slot];
	S.HoverKind.Reset();
	S.HoverId.Reset();
	if (!S.bEverTracked) return;
	if (S.bPinch)
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch released by tracking loss, no transition hand=%s"), SlotName(Slot));
		S.bPinch = false;
		S.bNeedRelease = true;
	}
	FindTable();
	UE_LOG(LogBpHands, Log, TEXT("BpHands: tracking lost -> held level=%s hand=%s"), *LevelName(), SlotName(Slot));
}

void UBpHands::OnBack(int32 Slot)
{
	FSlot& S = Slots[Slot];
	S.Fade = 1.f;
	if (Slot != Synthetic && HideHand[Slot]) HideHand[Slot]->SetValue(false);
	if (!S.bEverTracked)
	{
		// The first time a hand is seen is not a return.
		S.bEverTracked = true;
		return;
	}
	UE_LOG(LogBpHands, Log, TEXT("BpHands: tracking back hand=%s"), SlotName(Slot));
}

// ---- Judging a pinch --------------------------------------------------------------------------------------------------

void UBpHands::Judge(int32 Slot, const FSample& Sample)
{
	FSlot& S = Slots[Slot];
	if (!Sample.bPinching)
	{
		S.bNeedRelease = false;
		if (S.bPinch) PinchEnded(S);
		return;
	}
	if (!S.bPinch)
	{
		if (!S.bNeedRelease) PinchStarted(S, Sample);
		return;
	}
	// A pinch on the room's map draws (the hands' rule): the ray's paper point each frame, never a pull or a push.
	if (S.bLasso)
	{
		FVector2D Paper;
		if (Sample.bAims && FindTable() && Table->PaperAt(Sample.RayOrigin, Sample.RayDir, Paper)) Table->LassoPoint(Paper);
		return;
	}
	if (S.bFired) return;
	const float AlongCm = FVector::DotProduct(Sample.PinchPoint - S.Onset, S.PullDir);
	if (AlongCm >= PullEnterCm) Pull(S);
	else if (AlongCm <= -PushBackCm) Push(S);
}

void UBpHands::PinchStarted(FSlot& S, const FSample& Sample)
{
	S.bPinch = true;
	S.bFired = false;
	S.Onset = Sample.PinchPoint;
	S.PullDir = TowardEye(S.Onset);
	S.TargetKind = S.HoverKind;
	S.TargetId = S.HoverId;
	S.bLasso = false;
	ABpTable* T = FindTable();
	if (T && !T->GetRoomModeId().IsEmpty() && (S.TargetKind == TEXT("feature") || S.TargetKind == TEXT("map")))
	{
		S.bLasso = true;
		T->LassoBegin();
		FVector2D Paper;
		if (Sample.bAims && T->PaperAt(Sample.RayOrigin, Sample.RayDir, Paper)) T->LassoPoint(Paper);
	}
}

void UBpHands::PinchEnded(FSlot& S)
{
	S.bPinch = false;
	ABpTable* T = FindTable();
	// A pinch that drew a lasso closes it; one that never moved far enough is a tap (WP3).
	if (S.bLasso)
	{
		S.bLasso = false;
		if (T && T->LassoEnd())
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: lasso released -> %s"), *T->GetLassoLine());
			return;
		}
	}
	// The wrist's tabs and rows, a key plan room (WP3): taps.
	if (!S.bFired && S.HoverKind == TEXT("wrist"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		if (ABpPawn* Pawn = Cast<ABpPawn>(GetOwner())) Pawn->WristTap(S.HoverId);
		return;
	}
	if (!S.bFired && T && S.HoverKind == TEXT("minimap"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		T->SwitchRoom(S.HoverId.Mid(8), TEXT("keyplan"));
		return;
	}
	// Released on the screen deck or on a feature of the room's map (spark vr-room-layers WP2): a tap.
	if (!S.bFired && T && (S.HoverKind == TEXT("deck") || S.HoverKind == TEXT("feature")))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		T->DeckTap(S.HoverId);
		return;
	}
	if (S.bFired || !T || S.HoverKind != TEXT("crumb")) return;
	// Released on a crumb: jump to that crumb's level. In room mode any crumb but the room's own is the way out.
	if (!T->GetRoomModeId().IsEmpty())
	{
		if (S.HoverId != TEXT("room:") + T->GetRoomModeId()) T->ExitRoomMode();
	}
	else if (S.HoverId == TEXT("home"))
	{
		T->Home();
	}
	else if (S.HoverId.StartsWith(TEXT("wing:")) && T->GetBpLevel() == EBpLevel::L2)
	{
		T->Back();
	}
	UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch on crumb %s -> %s"), *S.HoverId, *LevelName());
}

void UBpHands::Pull(FSlot& S)
{
	S.bFired = true;
	ABpTable* T = FindTable();
	if (!T) return;
	if (S.TargetKind == TEXT("wing"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-pull -> enter wing=%s"), *S.TargetId);
		T->EnterWing(S.TargetId);
	}
	else if (S.TargetKind == TEXT("room") && T->GetBpLevel() == EBpLevel::L2 && T->GetRoomId() == S.TargetId)
	{
		// Pulled again on the lifted room: in (spark vr-room-layers WP1, room mode).
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-pull on the lifted room -> room mode room=%s"), *S.TargetId);
		T->EnterRoomMode(S.TargetId);
	}
	else if (S.TargetKind == TEXT("room"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-pull -> enter room=%s"), *S.TargetId);
		T->EnterRoom(S.TargetId);
	}
	else
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-pull on %s, no transition"), S.TargetKind.IsEmpty() ? TEXT("nothing") : *FString::Printf(TEXT("%s=%s"), *S.TargetKind, *S.TargetId));
	}
}

void UBpHands::Push(FSlot& S)
{
	S.bFired = true;
	ABpTable* T = FindTable();
	if (!T) return;
	if (!T->GetRoomModeId().IsEmpty())
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-push -> exit room mode"));
		T->ExitRoomMode();
		return;
	}
	if (T->GetBpLevel() == EBpLevel::L0)
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-push at L0, no transition"));
		return;
	}
	UE_LOG(LogBpHands, Log, TEXT("BpHands: pinch-push -> back"));
	T->Back();
}

// ---- What the table shows ---------------------------------------------------------------------------------------------

void UBpHands::UpdateHighlight()
{
	// A pinching hand shows what it pinched; otherwise the right hand, then the left, then the synthetic one shows what it
	// points at. Only a live hand speaks, so BpLevel.Highlight keeps working with no hands at all.
	const FSlot* Speaking = Speaker();
	if (!Speaking)
	{
		if (bHighlightOwned && FindTable()) Table->SetHighlight(FString(), FString());
		bHighlightOwned = false;
		ShownKind.Reset();
		ShownId.Reset();
		return;
	}
	const FString& Kind = Speaking->bPinch ? Speaking->TargetKind : Speaking->HoverKind;
	const FString& Id = Speaking->bPinch ? Speaking->TargetId : Speaking->HoverId;
	if (bHighlightOwned && Kind == ShownKind && Id == ShownId) return;
	if (!bHighlightOwned && Id.IsEmpty()) return;
	if (!FindTable() || !Table->HasPlan()) return;
	Table->SetHighlight(Kind, Id);
	ShownKind = Kind;
	ShownId = Id;
	bHighlightOwned = !Id.IsEmpty();
}

const UBpHands::FSlot* UBpHands::Speaker() const
{
	const int32 Order[SlotCount] = { Right, Left, Synthetic };
	const FSlot* Out = nullptr;
	for (const int32 Slot : Order)
	{
		const FSlot& S = Slots[Slot];
		if ((Slot == Synthetic && !bSyntheticActive) || !S.bEverTracked || !IsLive(S.State)) continue;
		if (S.bPinch) return &S;
		if (!Out) Out = &S;
	}
	return Out;
}

void UBpHands::UpdateHold(float DeltaTime)
{
	// The speaking hand, pointing without a pinch, at something a hold acts on.
	ABpTable* T = FindTable();
	const FSlot* Speaking = Speaker();
	FString Kind, Id;
	if (T && Speaking && !Speaking->bPinch && Speaking->State == EBpTracking::Tracked && IsHoldable(Speaking->HoverKind))
	{
		Kind = Speaking->HoverKind;
		Id = Speaking->HoverId;
	}
	if (Id != HoldId)
	{
		if (T && HoldKind == TEXT("lamp")) T->SetLampHold(0.f);
		if (T && !HoldId.IsEmpty() && HoldKind != TEXT("lamp") && !ABpPawn::IsHeadsetOn()) T->ShowPointer(false);
		HoldKind = Kind;
		HoldId = Id;
		HeldS = 0.f;
		bHoldFired = false;
		// The flat view has no hand to point with: the posed right hand points at a paper target while it is held.
		FVector At;
		if (T && !Id.IsEmpty() && Kind != TEXT("lamp") && !ABpPawn::IsHeadsetOn() && T->AimAt(Id, At)) T->ShowPointer(true, At);
	}
	if (Id.IsEmpty() || bHoldFired) return;
	HeldS += DeltaTime;
	if (Kind == TEXT("lamp")) T->SetLampHold(FMath::Min(1.f, HeldS / ABpTable::HoldS));
	if (HeldS < ABpTable::HoldS) return;
	bHoldFired = true;
	UE_LOG(LogBpHands, Log, TEXT("BpHands: hold on %s (%.2f s)"), *Id, HeldS);
	if (Kind == TEXT("feature")) T->AskLamp(Id.Mid(8));
	else if (Kind == TEXT("minimap")) T->SwitchRoom(Id.Mid(8), TEXT("keyplan"));
}

void UBpHands::UpdateFades(float DeltaTime)
{
	ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
	if (!Pawn) return;
	// The flat view's rest hands stand for the synthetic hand: gone while it is lost.
	Pawn->SetRestHandsVisible(!(bSyntheticActive && Slots[Synthetic].bEverTracked && Slots[Synthetic].State == EBpTracking::Lost));
	for (int32 Side = Left; Side <= Right; ++Side)
	{
		FSlot& S = Slots[Side];
		const float Target = S.State == EBpTracking::Lost && S.bEverTracked ? 0.f : 1.f;
		if (S.Fade == Target) continue;
		S.Fade = FMath::FInterpConstantTo(S.Fade, Target, DeltaTime, 1.f / HandFadeS);
		TArray<TObjectPtr<UMaterialInstanceDynamic>>& Mids = Side == Left ? HandMidsLeft : HandMidsRight;
		UIsdkHandRigComponent* Rig = Pawn->GetHandRig(Side);
		UIsdkHandVisualsRigComponent* Visuals = Rig ? Rig->GetHandVisuals() : nullptr;
		if (Visuals && Mids.Num() == 0)
		{
			for (UIsdkHandMeshComponent* Mesh : { Visuals->TrackedHandVisual.Get(), Visuals->SyntheticHandVisual.Get() })
			{
				if (!Mesh) continue;
				for (int32 Index = 0; Index < Mesh->GetNumMaterials(); ++Index)
				{
					if (UMaterialInstanceDynamic* Mid = Mesh->CreateDynamicMaterialInstance(Index)) Mids.Add(Mid);
				}
			}
			if (UIsdkConditionalGroupAll* ForceOff = Visuals->GetForceOffVisibility()) ForceOff->AddConditional(HideHand[Side]);
		}
		for (UMaterialInstanceDynamic* Mid : Mids)
		{
			if (Mid) Mid->SetScalarParameterValue(TEXT("Opacity"), S.Fade);
		}
		HideHand[Side]->SetValue(S.Fade <= 0.f);
	}
}

// ---- The synthetic hand and the console -------------------------------------------------------------------------------

void UBpHands::ActivateSynthetic()
{
	if (bSyntheticActive) return;
	bSyntheticActive = true;
	Gesture.Hand = Eye() + FVector(0.0, 0.0, -30.0);
	UE_LOG(LogBpHands, Log, TEXT("BpHands: input=hands (synthetic)"));
}

UBpHands::FSample UBpHands::SyntheticSample()
{
	FSample Sample;
	Sample.bValid = true;
	Sample.PinchPoint = Sample.RayOrigin = Gesture.Hand;
	switch (Gesture.Step)
	{
	case FGesture::EStep::Point:
	case FGesture::EStep::Pinch:
	case FGesture::EStep::Pull:
	case FGesture::EStep::Hold:
	case FGesture::EStep::Stroke:
		Sample.bAims = true;
		Sample.RayDir = (Gesture.Aim - Gesture.Hand).GetSafeNormal();
		Sample.bPinching = Gesture.Step != FGesture::EStep::Point && Gesture.Step != FGesture::EStep::Hold;
		break;
	default:
		break;
	}
	return Sample;
}

bool UBpHands::StartCommand(const FString& Command)
{
	FString Verb, Arg;
	if (!Command.Split(TEXT(" "), &Verb, &Arg)) return false;
	Gesture = FGesture{ FGesture::EStep::Idle, Arg, Gesture.Hand };
	Gesture.bPush = Verb == TEXT("Push");
	if (Verb == TEXT("Point"))
	{
		// "Point <id> [seconds]"
		FString Id = Arg, Seconds;
		if (Arg.Split(TEXT(" "), &Id, &Seconds)) Gesture.Id = Id;
		Gesture.HoldForS = Seconds.IsEmpty() ? 2.f : FCString::Atof(*Seconds);
		Gesture.Step = FGesture::EStep::Wait;
	}
	else if (Verb == TEXT("Lasso"))
	{
		Arg.ParseIntoArrayWS(Gesture.Features);
		Gesture.Id = TEXT("map");
		Gesture.Step = FGesture::EStep::Wait;
	}
	else if (Verb == TEXT("Pinch") || Gesture.bPush) Gesture.Step = FGesture::EStep::Wait;
	else if (Arg == TEXT("lost")) Gesture.Step = FGesture::EStep::SimulateLost;
	else Gesture.Step = FGesture::EStep::SimulateBack;
	if (!ABpPawn::IsHeadsetOn()) ActivateSynthetic();
	if (Gesture.Step == FGesture::EStep::SimulateLost) bForceLost = true;
	if (Gesture.Step == FGesture::EStep::SimulateBack) bForceLost = false;
	return true;
}

void UBpHands::RunCommands(float DeltaTime)
{
	using EStep = FGesture::EStep;
	if (Gesture.Step == EStep::Idle)
	{
		TArray<FString>& Pending = PendingCommands();
		if (Pending.Num() == 0) return;
		const FString Command = Pending[0];
		Pending.RemoveAt(0);
		if (!StartCommand(Command)) return;
	}
	Gesture.ElapsedS += DeltaTime;
	ABpTable* T = FindTable();
	const FSlot& Hand = Slots[Synthetic];
	switch (Gesture.Step)
	{
	case EStep::Wait:
		if (!T || !T->HasPlan() || T->IsLevelMoving()) return;
		if (bForceLost || (Hand.State == EBpTracking::Lost && Hand.bEverTracked))
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: refused %s on %s: tracking lost, level held at %s"), Gesture.bPush ? TEXT("pinch-push") : TEXT("pinch-pull"), *Gesture.Id, *LevelName());
			Gesture.Step = EStep::Idle;
			return;
		}
		if (Hand.State != EBpTracking::Tracked) return;
		if (Gesture.Id == TEXT("*"))
		{
			// A push needs no target: pinch on what is lifted now.
			Gesture.Id = !T->GetRoomId().IsEmpty() ? T->GetRoomId() : !T->GetWingId().IsEmpty() ? T->GetWingId() : FString(TEXT("home"));
		}
		if (Gesture.Features.Num() > 0)
		{
			// The lasso's path: the table's loop round the features, on the paper, in the world.
			Gesture.Path.Reset();
			for (const FVector2D& Paper : T->LassoLoop(Gesture.Features)) Gesture.Path.Add(T->PaperToWorld(Paper));
			if (Gesture.Path.Num() < 3)
			{
				UE_LOG(LogBpHands, Log, TEXT("BpHands: refused lasso: none of [%s] is on the room's map"), *FString::Join(Gesture.Features, TEXT(",")));
				Gesture.Step = EStep::Idle;
				return;
			}
			Gesture.Aim = Gesture.Path[0];
			Gesture.PathAt = 0;
		}
		else
		{
			const ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
			const bool bAimed = Gesture.Id.StartsWith(TEXT("wrist:")) ? Pawn && Pawn->WristAim(Gesture.Id, Gesture.Aim) : T->AimAt(Gesture.Id, Gesture.Aim);
			if (!bAimed)
			{
				UE_LOG(LogBpHands, Log, TEXT("BpHands: refused pinch on unknown id %s"), *Gesture.Id);
				Gesture.Step = EStep::Idle;
				return;
			}
		}
		// The hand stands on the line from the eye to the target, so its ray meets the target as drawn now.
		Gesture.Hand = FMath::Lerp(Eye(), Gesture.Aim, static_cast<double>(SyntheticReach));
		Gesture.PullDir = TowardEye(Gesture.Hand) * (Gesture.bPush ? -1.0 : 1.0);
		Gesture.Step = EStep::Point;
		Gesture.Frames = 0;
		return;
	case EStep::Point:
		if (++Gesture.Frames < SyntheticPointFrames) return;
		// A point only (BpHands.Point): it holds; a lasso pinches and strokes; else the pinch.
		Gesture.Step = Gesture.HoldForS > 0.f ? EStep::Hold : Gesture.Features.Num() > 0 ? EStep::Stroke : EStep::Pinch;
		Gesture.ElapsedS = 0.f;
		return;
	case EStep::Hold:
		if (Gesture.ElapsedS >= Gesture.HoldForS) Gesture.Step = EStep::Idle;
		return;
	case EStep::Stroke:
		// One point of the loop a frame, the pinch closed; then released where it ends.
		if (++Gesture.PathAt >= Gesture.Path.Num())
		{
			Gesture.Aim = Gesture.Path[0];
			Gesture.Step = EStep::Release;
			return;
		}
		Gesture.Aim = Gesture.Path[Gesture.PathAt];
		return;
	case EStep::Pinch:
		// On a crumb the pinch is a tap: released where it closed.
		Gesture.Step = IsTap(Gesture.Id) ? EStep::Release : EStep::Pull;
		return;
	case EStep::Pull:
		Gesture.PulledCm += SyntheticStepCm;
		Gesture.Hand += Gesture.PullDir * SyntheticStepCm;
		if (Gesture.PulledCm >= SyntheticPullCm) Gesture.Step = EStep::Release;
		return;
	case EStep::Release:
		Gesture.Step = EStep::Idle;
		return;
	case EStep::SimulateLost:
		for (const FSlot& S : Slots)
		{
			if (S.bEverTracked && IsLive(S.State)) return;
		}
		Gesture.Step = EStep::Idle;
		return;
	case EStep::SimulateBack:
		for (const FSlot& S : Slots)
		{
			if (S.State == EBpTracking::Tracked)
			{
				Gesture.Step = EStep::Idle;
				return;
			}
		}
		if (Gesture.ElapsedS > SimulateBackTimeoutS)
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: no hand is tracked %.0f s after Simulate back"), SimulateBackTimeoutS);
			Gesture.Step = EStep::Idle;
		}
		return;
	default:
		return;
	}
}

void UBpHands::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (ABpPawn::IsHeadsetOn())
	{
		FSample Headset[2];
		ReadHeadset(DeltaTime, Headset);
		for (int32 Side = Left; Side <= Right; ++Side)
		{
			if (bForceLost) Headset[Side].bValid = false;
			Step(Side, Headset[Side], DeltaTime);
		}
	}
	if (bSyntheticActive)
	{
		FSample Sample = SyntheticSample();
		if (bForceLost) Sample.bValid = false;
		// The release frame: the pinch opens where the pull ended.
		if (Gesture.Step == FGesture::EStep::Release)
		{
			Sample.bAims = true;
			Sample.RayDir = (Gesture.Aim - Gesture.Hand).GetSafeNormal();
		}
		Step(Synthetic, Sample, DeltaTime);
	}
	UpdateHighlight();
	UpdateHold(DeltaTime);
	UpdateFades(DeltaTime);
	RunCommands(DeltaTime);
}
