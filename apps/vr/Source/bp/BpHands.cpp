#include "BpHands.h"

#include "BpGameMode.h"
#include "BpPawn.h"
#include "BpTable.h"
#include "Camera/CameraComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
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
	TAutoConsoleVariable<int32> CVarAim(
		TEXT("bp.Aim"),
		1,
		TEXT("The aim cursor: a thin ray from the pinch point and a small reticle where it meets the paper or a target, bright and snapped on what a pinch would act on, dim on nothing. 0 off, 1 on for headset hands and controllers, 2 also for the synthetic hand (flat captures)."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarAimRayCm(
		TEXT("bp.AimRayCm"),
		140.f,
		TEXT("The aim ray's length when it meets nothing (cm, 20 to 400); meeting a surface it ends there."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarAimReticleCm(
		TEXT("bp.AimReticleCm"),
		1.2f,
		TEXT("The aim reticle's size (cm across, 0.3 to 6); 1.4x on a target, 0.85x on nothing."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarAimRayWidthCm(
		TEXT("bp.AimRayWidthCm"),
		0.12f,
		TEXT("The aim ray's thickness (cm, 0.03 to 1)."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarAimAssistDeg(
		TEXT("bp.AimAssistDeg"),
		2.f,
		TEXT("The aim assist: a ray that meets nothing takes the nearest pinchable paper target within this cone (degrees, 0 off, up to 10)."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarAimDotDeg(
		TEXT("bp.AimDotDeg"),
		0.35f,
		TEXT("Wave N3-W1, the laser pointer: the dot where the ray meets a panel (the console, the near bar, the far sheet, the wrist, Glim), facing the eye at this angular size whatever its distance (degrees, 0.1 to 2; 1.3x on a control that will act). On the paper the reticle is never smaller than it either."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarAimFade(
		TEXT("bp.AimFade"),
		0.55f,
		TEXT("Wave N3-W1: a ray longer than 60 cm narrows and dims over its far part from this fraction of its length (0.2 to 1; 1 keeps it whole), and stops short of the dot, so it never draws a hard line across the far sheet's words."),
		ECVF_Default);

	/** BpHands.AimStat: the next frame's aim, logged per aiming hand. */
	bool GAimStat = false;
	FAutoConsoleCommand CmdHandsAimStat(
		TEXT("BpHands.AimStat"),
		TEXT("BpHands.AimStat: logs each aiming hand's ray (what it meets, its length, the dot's size and colour) on the next frame."),
		FConsoleCommandDelegate::CreateLambda([]() { GAimStat = true; }));

	TAutoConsoleVariable<float> CVarAimSynthOffset(
		TEXT("bp.AimSynthOffsetCm"),
		0.f,
		TEXT("Flat checks only: the synthetic hand stands this far right of and below the eye's line to its target, so its ray is seen from the side (a capture of the aim ray; 0 keeps the eye's line)."),
		ECVF_Default);

	/** The cursor's colours (emissive; the material clamps on the headset). */
	const FLinearColor AimOnTarget(FLinearColor(1.f, 0.62f, 0.14f) * 2.2f);
	const FLinearColor AimOnPaper(FLinearColor(0.72f, 0.92f, 1.f) * 1.05f);
	const FLinearColor AimOnNothing(FLinearColor(0.72f, 0.92f, 1.f) * 0.5f);

	/** What a pinch acts on, small enough for the reticle to snap to its centre (a wing or a room keeps the ray's own point). */
	bool ReticleSnaps(const FString& Kind)
	{
		return Kind == TEXT("crumb") || Kind == TEXT("deck") || Kind == TEXT("card") || Kind == TEXT("feature") || Kind == TEXT("minimap") || Kind == TEXT("lamp");
	}

	FAutoConsoleCommandWithWorldAndArgs CmdHandsPinch(
		TEXT("BpHands.Pinch"),
		TEXT("BpHands.Pinch <wing id|room id|crumb id|deck:next|deck:prev|deck:approve|deck:approveall|deck:decline|card:decline|card:approve|feature:<id>>: the synthetic hand points at it, pinches and pulls the pinch toward the eye (on a crumb, a deck or card control or a feature it taps: released where it closed), through the same judging as real hands."),
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

	FAutoConsoleCommandWithWorldAndArgs CmdHandsTap(
		TEXT("BpHands.Tap"),
		TEXT("BpHands.Tap <wing id|room id|console:<act>|wrist:<act>|...>: the synthetic hand points at it, pinches and releases where it closed, with no pull (night two W1: a tap on a wing enters it, on a room lifts it, on the lifted room steps inside)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Tap <id>"));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Tap ") + Args[0]);
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdHandsPull(
		TEXT("BpHands.Pull"),
		TEXT("BpHands.Pull <id>: the synthetic hand pinches on the id and pulls the pinch toward the eye whatever the id is (BpHands.Pinch only taps a control): a pinch that closed on the console or the wrist and moved must change no level."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpHands, Warning, TEXT("BpHands: usage BpHands.Pull <id>"));
				return;
			}
			UBpHands::PendingCommands().Add(TEXT("Pull ") + Args[0]);
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
		return IsCrumb(Id) || Id == TEXT("lamp") || Id.StartsWith(TEXT("deck:")) || Id.StartsWith(TEXT("card:")) || Id.StartsWith(TEXT("feature:")) || Id.StartsWith(TEXT("minimap:")) || Id.StartsWith(TEXT("wrist:")) || Id.StartsWith(TEXT("console:"));
	}

	/** A panel near the eye (the wrist, the console): a pinch that closes on it is a tap or nothing, never a pull or a push. */
	bool IsPanel(const FString& Kind)
	{
		return Kind == TEXT("wrist") || Kind == TEXT("console");
	}

	/** What a hold acts on (ABpTable's hands' rule): the lamp's head, a feature's glyph, a key plan room. */
	bool IsHoldable(const FString& Kind)
	{
		// The lamp's own hold is push to talk now (BpTalk.cpp, a pinch held on it); its old 0.8 s point ("the next room") is
		// the console's ROOMS › NEXT ROOM (night two W3).
		return Kind == TEXT("feature") || Kind == TEXT("minimap");
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
		if (TActorIterator<ABpTable> It(GetWorld()); It) Table = *It;
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
	S.bAiming = false;
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
		// Then the console in the deck's slot (night two W1): it stands in front of the table.
		else if (Pawn && Pawn->ConsoleHit(Sample.RayOrigin, Sample.RayDir, S.HoverId)) S.HoverKind = TEXT("console");
		else if (!Table->HitTest(Sample.RayOrigin, Sample.RayDir, S.HoverKind, S.HoverId) && (Slot != Synthetic || CVarAim.GetValueOnGameThread() >= 2))
		{
			// A ray that just misses (a seam, a thin room): the nearest pinchable paper target within a small cone.
			Table->AssistHit(Sample.RayOrigin, Sample.RayDir, FMath::Clamp(CVarAimAssistDeg.GetValueOnGameThread(), 0.f, 10.f), S.HoverKind, S.HoverId);
		}
		S.AimFrom = Sample.RayOrigin;
		S.AimDir = Sample.RayDir.GetSafeNormal();
		S.bAiming = !S.AimDir.IsNearlyZero();
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
	// A pinch that closed on the wrist or the console never becomes a pull or a push (night two W1: one that started on the
	// wrist and moved 6 cm used to run Push, which went Back()). Moved that far it is no tap either: it is spent.
	if (IsPanel(S.TargetKind))
	{
		if (FMath::Abs(AlongCm) >= FMath::Min(PullEnterCm, PushBackCm))
		{
			S.bFired = true;
			UE_LOG(LogBpHands, Log, TEXT("BpHands: a pinch that closed on the %s (%s) moved %.1f cm: no pull, no push, no tap; level=%s"), *S.TargetKind, *S.TargetId, AlongCm, *LevelName());
		}
		return;
	}
	if (AlongCm >= PullEnterCm) Pull(S);
	else if (AlongCm <= -PushBackCm) Push(S);
}

void UBpHands::PinchStarted(FSlot& S, const FSample& Sample)
{
	S.bPinch = true;
	S.bFired = false;
	if (ABpTable* T = FindTable()) T->NoteHand(TEXT("pinch"));
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
	// The tour (BpTour.cpp) counts the person as active, and a tap on the deck or the card as a decision.
	if (T && !S.bFired) T->NoteHand((S.HoverKind == TEXT("deck") || S.HoverKind == TEXT("card")) ? TEXT("tap") : TEXT("pinch"));
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
	// The console's controls (night two W1): taps, as the wrist's.
	if (!S.bFired && S.HoverKind == TEXT("console"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		if (ABpPawn* Pawn = Cast<ABpPawn>(GetOwner())) Pawn->ConsoleTap(S.HoverId);
		return;
	}
	// A tap on a wing or a room, released where it closed (night two W1, the owner: "operating in blueprint without
	// dependency of the pins and drag movement"): the transitions a pull makes.
	if (!S.bFired && T && (S.HoverKind == TEXT("wing") || S.HoverKind == TEXT("room")) && S.HoverKind == S.TargetKind && S.HoverId == S.TargetId)
	{
		T->NoteHand(TEXT("tap"));
		if (S.HoverKind == TEXT("wing"))
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: tap -> enter wing=%s"), *S.HoverId);
			T->EnterWing(S.HoverId);
		}
		else if (T->GetBpLevel() == EBpLevel::L2 && T->GetRoomId() == S.HoverId)
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on the lifted room -> room mode room=%s"), *S.HoverId);
			T->EnterRoomMode(S.HoverId);
		}
		else
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: tap -> enter room=%s"), *S.HoverId);
			T->EnterRoom(S.HoverId);
		}
		return;
	}
	if (!S.bFired && T && S.HoverKind == TEXT("minimap"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		T->SwitchRoom(S.HoverId.Mid(8), TEXT("keyplan"));
		return;
	}
	// A pinch released on the lamp's head: the lamp's next-step ask, or what its answer offers (BpAsk.cpp).
	if (!S.bFired && T && S.HoverKind == TEXT("lamp"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on lamp"));
		// The pinch also opened a talk hold (UpdateHold). A tap lets go of it first, so the short hold returns the talk to idle
		// and the lamp acts, instead of LampPinched cancelling the microphone it just opened ("Stopped.").
		if (bTalkHeld)
		{
			bTalkHeld = false;
			T->TalkHold(*TalkSource, false);
		}
		T->LampPinched();
		return;
	}
	// Released on the decision card's buttons (ROADMAP F8): a tap; Decline on a repeat declines it in the store.
	if (!S.bFired && T && S.HoverKind == TEXT("card"))
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: tap on %s"), *S.HoverId);
		T->CardTap(S.HoverId);
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
	T->NoteHand(TEXT("pull"));
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
	T->NoteHand(TEXT("push"));
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
	ABpPawn* Owner = Cast<ABpPawn>(GetOwner());
	if (!Speaking)
	{
		// The hands let go of the highlight: the pad's focus cursor comes back if it has one (else it is cleared).
		if (bHighlightOwned && FindTable())
		{
			if (Owner) Owner->RestoreFocusHighlight();
			else Table->SetHighlight(FString(), FString());
		}
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
	if (Id.IsEmpty() && Owner) Owner->RestoreFocusHighlight();
	else Table->SetHighlight(Kind, Id);
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
	// Push to talk by hand: a pinch that closed on the lamp's head, or on the wrist's TALK, held. Down at once (the microphone
	// opens when the wearer already allowed it); past ABpTable::TalkMinHoldS the pinch is spent, so its release taps nothing.
	{
		const bool bOnLamp = Speaking && Speaking->bPinch && Speaking->TargetKind == TEXT("lamp");
		const bool bOnTalk = Speaking && Speaking->bPinch && Speaking->HoverKind == TEXT("wrist") && Speaking->HoverId == TEXT("wrist:talk");
		const bool bHeld = T && (bOnLamp || bOnTalk);
		if (bHeld && !bTalkHeld)
		{
			bTalkHeld = true;
			TalkHeldS = 0.f;
			TalkSource = bOnLamp ? TEXT("lamp") : TEXT("wrist");
			T->TalkHold(*TalkSource, true);
		}
		else if (bHeld)
		{
			TalkHeldS += DeltaTime;
			if (TalkHeldS >= ABpTable::TalkMinHoldS) const_cast<FSlot*>(Speaking)->bFired = true;
		}
		else if (bTalkHeld)
		{
			bTalkHeld = false;
			if (T) T->TalkHold(*TalkSource, false);
		}
	}
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
	T->NoteHand(TEXT("hold"));
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
	Gesture.bTap = Verb == TEXT("Tap");
	Gesture.bMove = Verb == TEXT("Pull") || Gesture.bPush;
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
	else if (Verb == TEXT("Pinch") || Verb == TEXT("Tap") || Verb == TEXT("Pull") || Gesture.bPush) Gesture.Step = FGesture::EStep::Wait;
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
			// "paper:<x cm>_<y cm>" (or a comma, but -ExecCmds splits there): bare paper, BpHands.Point's way of aiming at nothing
			// for the aim cursor's checks.
			bool bAimed = false;
			if (Gesture.Id.StartsWith(TEXT("paper:")))
			{
				FString XText, YText;
				if (Gesture.Id.Mid(6).Replace(TEXT("_"), TEXT(",")).Split(TEXT(","), &XText, &YText))
				{
					Gesture.Aim = T->PaperToWorld(FVector2D(FCString::Atod(*XText), FCString::Atod(*YText)));
					bAimed = true;
				}
			}
			else if (Gesture.Id == TEXT("air"))
			{
				// Wave N3-W1: nothing at all (up and to the left, over the studio): the pointer's short ray, no dot.
				Gesture.Aim = Eye() + T->GetActorForwardVector() * 120.0 - T->GetActorRightVector() * 90.0 + FVector(0.0, 0.0, 110.0);
				bAimed = true;
			}
			else if (Gesture.Id.StartsWith(TEXT("wrist:"))) bAimed = Pawn && Pawn->WristAim(Gesture.Id, Gesture.Aim);
			else if (Gesture.Id.StartsWith(TEXT("console:"))) bAimed = Pawn && Pawn->ConsoleAim(Gesture.Id, Gesture.Aim);
			else bAimed = T->AimAt(Gesture.Id, Gesture.Aim);
			if (!bAimed)
			{
				UE_LOG(LogBpHands, Log, TEXT("BpHands: refused pinch on unknown id %s"), *Gesture.Id);
				Gesture.Step = EStep::Idle;
				return;
			}
		}
		// The hand stands on the line from the eye to the target, so its ray meets the target as drawn now.
		// Wave N3-W1: never further than an arm's reach (45 cm) from the eye, so a far target (the wall's sheet) is pointed at
		// from where a hand is.
		Gesture.Hand = FMath::Lerp(Eye(), Gesture.Aim, FMath::Min(static_cast<double>(SyntheticReach), 45.0 / FMath::Max(1.0, FVector::Dist(Eye(), Gesture.Aim))));
		if (const float Aside = CVarAimSynthOffset.GetValueOnGameThread(); Aside != 0.f)
		{
			// Seen from the side: a ray on the eye's own line is a point to the eye.
			Gesture.Hand += T->GetActorRightVector() * Aside - FVector(0.0, 0.0, Aside);
		}
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
		// On a crumb the pinch is a tap: released where it closed. BpHands.Tap always taps; BpHands.Pull and Push always move.
		Gesture.Step = Gesture.bTap || (IsTap(Gesture.Id) && !Gesture.bMove) ? EStep::Release : EStep::Pull;
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
	UpdateAim();
	RunCommands(DeltaTime);
}

void UBpHands::UpdateAim()
{
	struct FMark { FTransform Place; FLinearColor Color; };
	TArray<FMark, TInlineAllocator<12>> Marks;
	const int32 Mode = CVarAim.GetValueOnGameThread();
	ABpTable* T = Mode > 0 ? FindTable() : nullptr;
	const ABpPawn* Pawn = Cast<ABpPawn>(GetOwner());
	const float ReticleCm = FMath::Clamp(CVarAimReticleCm.GetValueOnGameThread(), 0.3f, 6.f);
	const float RayLen = FMath::Clamp(CVarAimRayCm.GetValueOnGameThread(), 20.f, 400.f);
	const float RayW = FMath::Clamp(CVarAimRayWidthCm.GetValueOnGameThread(), 0.03f, 1.f);
	FString WristHover, ConsoleHover;
	// Night two V6: a pinch that closed on the control the ray is still on, not yet released nor spent: it draws pressed.
	bool bWristDown = false, bConsoleDown = false;
	const float DotDeg = FMath::Clamp(CVarAimDotDeg.GetValueOnGameThread(), 0.1f, 2.f);
	const float FadeAt = FMath::Clamp(CVarAimFade.GetValueOnGameThread(), 0.2f, 1.f);
	const FVector EyeAt = Eye();
	/** The dot's size (cm across) for the constant angular size at a point. */
	const auto DotCm = [&](const FVector& At, float Deg) { return 2.0 * FVector::Dist(EyeAt, At) * FMath::Tan(FMath::DegreesToRadians(Deg * 0.5)); };
	// Wave N3-W1: with both hands tracked the dominant one leads (the one without the wrist panel, bp.WristHand); the wrist's
	// own hand shows its ray only while it is raised toward something.
	static const IConsoleVariable* WristHandVar = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.WristHand"));
	const int32 WristSide = WristHandVar && WristHandVar->GetInt() != 0 ? Right : Left;
	const bool bBothAim = Slots[Left].bAiming && Slots[Right].bAiming;
	// The ray from Start to End: one bar, or (long, wave N3-W1) a bar then three narrowing, dimming steps that stop short of
	// the end, so its far part never draws a hard line across the words it lands on. Opaque and unlit: one instanced draw.
	const auto AddRay = [&](const FVector& From, const FVector& End, const FVector& Up, const FLinearColor& Color, float Width)
	{
		const FVector Along = End - From;
		const double Len = Along.Size();
		if (Len < 0.5) return;
		const FVector Dir = Along / Len;
		const FQuat Rot = FRotationMatrix::MakeFromXZ(Dir, FMath::Abs(FVector::DotProduct(Dir, Up)) < 0.99 ? Up : FVector::RightVector).ToQuat();
		const auto Bar = [&](double T0, double T1, float W, float Dim)
		{
			const FVector A = From + Along * T0, B = From + Along * T1;
			Marks.Add({ FTransform(Rot, (A + B) * 0.5, FVector((T1 - T0) * Len / 100.0, W / 100.0, W / 100.0)), Color * Dim });
		};
		if (Len < 60.0 || FadeAt >= 1.f)
		{
			Bar(0.0, 1.0, Width, 0.55f);
			return;
		}
		const double F = FadeAt, Step = (0.97 - F) / 3.0;
		Bar(0.0, F, Width, 0.55f);
		Bar(F, F + Step, Width * 0.7f, 0.46f);
		Bar(F + Step, F + 2.0 * Step, Width * 0.45f, 0.36f);
		Bar(F + 2.0 * Step, 0.97, Width * 0.25f, 0.26f);
	};
	// Wave U1, "Glim alive": the first ray that meets the site plan this frame, for Glim's glance (ABpTable::NoteRayPoint).
	bool bGlance = false;
	FVector GlanceAt = FVector::ZeroVector;
	for (int32 Slot = 0; T && Pawn && Slot < SlotCount; ++Slot)
	{
		const FSlot& S = Slots[Slot];
		if (!S.bAiming || (Slot == Synthetic && (Mode < 2 || !bSyntheticActive))) continue;
		const bool bHeldHere = S.bPinch && !S.bFired && S.TargetKind == S.HoverKind && S.TargetId == S.HoverId;
		const bool bQuiet = Slot == WristSide && bBothAim && S.HoverId.IsEmpty();
		// Wave N3-W1, the laser pointer: a panel (the wrist, the console at the desk, its near bar, the far sheet) lights the
		// control under the ray as before, and the ray now runs to it with a dot where it meets it: on the wall 2.6 m away the
		// person sees where they aim.
		if (S.HoverKind == TEXT("wrist") || S.HoverKind == TEXT("console"))
		{
			const bool bWrist = S.HoverKind == TEXT("wrist");
			(bWrist ? WristHover : ConsoleHover) = S.HoverId;
			(bWrist ? bWristDown : bConsoleDown) = bHeldHere;
			FVector Hit;
			if (bQuiet || !Pawn->PanelHitPoint(S.HoverKind, S.AimFrom, S.AimDir, Hit)) continue;
			const bool bControl = !S.HoverId.IsEmpty() && S.HoverId != TEXT("console:panel");
			const FLinearColor Color = bControl ? AimOnTarget : AimOnPaper;
			AddRay(S.AimFrom + S.AimDir * 3.0, Hit, T->GetActorUpVector(), Color, RayW);
			const FVector Normal = (EyeAt - Hit).GetSafeNormal();
			const double Size = DotCm(Hit, DotDeg * (bControl ? 1.3f : 1.f)) / 100.0;
			const FQuat Facing = FRotationMatrix::MakeFromZ(Normal).ToQuat() * FQuat(FVector::UpVector, FMath::DegreesToRadians(45.0));
			// Lifted toward the eye off the panel (more on the far sheet, whose depth is coarser at 2.6 m).
			Marks.Add({ FTransform(Facing, Hit + Normal * (FVector::Dist(EyeAt, Hit) > 150.0 ? 1.0 : 0.3), FVector(Size, Size, 0.0006)), Color });
			if (GAimStat)
			{
				UE_LOG(LogBpHands, Log, TEXT("BpHands: aim hand=%s meets %s %s at %.0f cm (the eye %.0f cm), dot %.2f cm (%.2f deg) %s"), SlotName(Slot), *S.HoverKind, *S.HoverId,
					FVector::Dist(S.AimFrom, Hit), FVector::Dist(EyeAt, Hit), Size * 100.0, DotDeg * (bControl ? 1.3f : 1.f), bControl ? TEXT("amber") : TEXT("cyan"));
			}
			continue;
		}
		if (bQuiet) continue;
		const bool bHover = !S.HoverId.IsEmpty();
		bool bPoint = false, bFlat = false;
		FVector Point = FVector::ZeroVector;
		if (bHover && ReticleSnaps(S.HoverKind))
		{
			// A control or a glyph: the reticle snaps to its centre, which is where the pinch counts.
			bPoint = T->AimAt(S.HoverId, Point);
			bFlat = bPoint && S.HoverKind != TEXT("deck") && S.HoverKind != TEXT("card") && S.HoverKind != TEXT("lamp");
		}
		if (!bPoint && bHover && T->GetAimHit(Point)) { bPoint = true; bFlat = true; }
		if (!bPoint)
		{
			// Nothing to pinch: where the ray meets the paper, dim; none at all (a ray pointing off the table) leaves the ray.
			FVector2D Paper;
			if (T->PaperAt(S.AimFrom, S.AimDir, Paper) && FVector::DotProduct(T->PaperToWorld(Paper) - S.AimFrom, S.AimDir) <= RayLen)
			{
				Point = T->PaperToWorld(Paper);
				bPoint = bFlat = true;
			}
		}
		const FLinearColor Color = bHover ? AimOnTarget : bPoint ? AimOnPaper : AimOnNothing;
		const FVector TableUp = T->GetActorUpVector();
		{
			const FVector End = bPoint ? Point : S.AimFrom + S.AimDir * RayLen;
			const FVector Start = S.AimFrom + S.AimDir * 3.0;
			// A ray that meets something narrows toward it (wave N3-W1); one that meets nothing keeps its short, whole length.
			if (FVector::DotProduct(End - Start, S.AimDir) > 0.5)
			{
				if (bPoint) AddRay(Start, End, TableUp, Color, RayW);
				else Marks.Add({ FTransform(FRotationMatrix::MakeFromXZ(S.AimDir, FMath::Abs(FVector::DotProduct(S.AimDir, TableUp)) < 0.99 ? TableUp : FVector::RightVector).ToQuat(), (Start + End) * 0.5, FVector((End - Start).Size() / 100.0, RayW / 100.0, RayW / 100.0)), Color * 0.55f });
			}
		}
		if (GAimStat)
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: aim hand=%s meets %s at %.0f cm (%s)"), SlotName(Slot), bHover ? *FString::Printf(TEXT("%s %s"), *S.HoverKind, *S.HoverId) : bPoint ? TEXT("the paper") : TEXT("nothing"),
				bPoint ? FVector::Dist(S.AimFrom, Point) : RayLen, bHover ? TEXT("amber") : TEXT("cyan"));
		}
		if (bPoint && !bGlance && S.HoverKind != TEXT("lamp")) { bGlance = true; GlanceAt = Point; }
		if (bPoint)
		{
			// Never smaller than the dot's angular size (wave N3-W1).
			const double Size = FMath::Max(ReticleCm * (bHover ? 1.4 : 0.85), DotCm(Point, DotDeg * (bHover ? 1.3f : 1.f))) / 100.0;
			// Lying on the paper (lifted a hair, so it never z-fights the glass), else square to the hand.
			const FVector Normal = bFlat ? TableUp : -S.AimDir;
			const FVector At = Point + Normal * 0.25;
			const FQuat Facing = FRotationMatrix::MakeFromZ(Normal).ToQuat() * FQuat(FVector::UpVector, FMath::DegreesToRadians(45.0));
			Marks.Add({ FTransform(Facing, At, FVector(Size, Size, 0.0006)), Color });
		}
	}
	if (T) T->NoteRayPoint(bGlance, GlanceAt);
	if (GAimStat)
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: aim marks %d (rays, steps and dots in one instanced draw)"), Marks.Num());
		GAimStat = false;
	}
	if (ABpPawn* Owner = Cast<ABpPawn>(GetOwner()))
	{
		Owner->SetWristHover(Mode > 0 ? WristHover : FString(), bWristDown);
		Owner->SetConsoleHover(Mode > 0 ? ConsoleHover : FString(), bConsoleDown);
	}
	if (Marks.Num() == 0)
	{
		// Nothing aims: no draw, no work beyond this frame's reading, until a hand aims again.
		if (AimMarks && AimShown > 0)
		{
			AimMarks->ClearInstances();
			AimMarks->SetVisibility(false);
		}
		AimShown = 0;
		return;
	}
	if (!AimMarks)
	{
		UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
		UMaterialInterface* Material = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Bp/Materials/M_AimMark.M_AimMark"));
		if (!Cube || !Material)
		{
			UE_LOG(LogBpHands, Warning, TEXT("BpHands: aim cursor assets are missing (cube %d, M_AimMark %d); no cursor"), Cube != nullptr, Material != nullptr);
			return;
		}
		AimMarks = NewObject<UInstancedStaticMeshComponent>(GetOwner(), TEXT("AimMarks"));
		AimMarks->SetupAttachment(GetOwner()->GetRootComponent());
		AimMarks->SetMobility(EComponentMobility::Movable);
		AimMarks->SetUsingAbsoluteLocation(true);
		AimMarks->SetUsingAbsoluteRotation(true);
		AimMarks->SetUsingAbsoluteScale(true);
		AimMarks->SetStaticMesh(Cube);
		AimMarks->SetMaterial(0, Material);
		AimMarks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		AimMarks->SetCastShadow(false);
		AimMarks->NumCustomDataFloats = 3;
		AimMarks->RegisterComponent();
		AimMarks->SetWorldTransform(FTransform::Identity);
	}
	if (!AimMarks->IsVisible()) AimMarks->SetVisibility(true);
	while (AimMarks->GetInstanceCount() > Marks.Num()) AimMarks->RemoveInstance(AimMarks->GetInstanceCount() - 1);
	for (int32 Index = 0; Index < Marks.Num(); ++Index)
	{
		const FMark& Mark = Marks[Index];
		if (Index >= AimMarks->GetInstanceCount()) AimMarks->AddInstance(Mark.Place, true);
		else AimMarks->UpdateInstanceTransform(Index, Mark.Place, true, false, true);
		AimMarks->SetCustomDataValue(Index, 0, Mark.Color.R, false);
		AimMarks->SetCustomDataValue(Index, 1, Mark.Color.G, false);
		AimMarks->SetCustomDataValue(Index, 2, Mark.Color.B, false);
	}
	// The instance data manager already carries these changes to the renderer: no proxy rebuilt every aiming frame.
	AimShown = Marks.Num();
}
