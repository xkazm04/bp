#include "BpHands.h"

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
		TEXT("BpHands.Pinch <wing id|room id|crumb id>: the synthetic hand points at it, pinches and pulls the pinch toward the eye, through the same judging as real hands."),
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
		Table->HitTest(Sample.RayOrigin, Sample.RayDir, S.HoverKind, S.HoverId);
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
}

void UBpHands::PinchEnded(FSlot& S)
{
	S.bPinch = false;
	ABpTable* T = FindTable();
	if (S.bFired || !T || S.HoverKind != TEXT("crumb")) return;
	// Released on a crumb: jump to that crumb's level.
	if (S.HoverId == TEXT("home"))
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
	const int32 Order[SlotCount] = { Right, Left, Synthetic };
	const FSlot* Speaker = nullptr;
	for (const int32 Slot : Order)
	{
		const FSlot& S = Slots[Slot];
		if ((Slot == Synthetic && !bSyntheticActive) || !S.bEverTracked || !IsLive(S.State)) continue;
		if (S.bPinch) { Speaker = &S; break; }
		if (!Speaker) Speaker = &S;
	}
	if (!Speaker)
	{
		if (bHighlightOwned && FindTable()) Table->SetHighlight(FString(), FString());
		bHighlightOwned = false;
		ShownKind.Reset();
		ShownId.Reset();
		return;
	}
	const FString& Kind = Speaker->bPinch ? Speaker->TargetKind : Speaker->HoverKind;
	const FString& Id = Speaker->bPinch ? Speaker->TargetId : Speaker->HoverId;
	if (bHighlightOwned && Kind == ShownKind && Id == ShownId) return;
	if (!bHighlightOwned && Id.IsEmpty()) return;
	if (!FindTable() || !Table->HasPlan()) return;
	Table->SetHighlight(Kind, Id);
	ShownKind = Kind;
	ShownId = Id;
	bHighlightOwned = !Id.IsEmpty();
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
		Sample.bAims = true;
		Sample.RayDir = (Gesture.Aim - Gesture.Hand).GetSafeNormal();
		Sample.bPinching = Gesture.Step != FGesture::EStep::Point;
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
	if (Verb == TEXT("Pinch") || Gesture.bPush) Gesture.Step = FGesture::EStep::Wait;
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
		if (!T->AimAt(Gesture.Id, Gesture.Aim))
		{
			UE_LOG(LogBpHands, Log, TEXT("BpHands: refused pinch on unknown id %s"), *Gesture.Id);
			Gesture.Step = EStep::Idle;
			return;
		}
		// The hand stands on the line from the eye to the target, so its ray meets the target as drawn now.
		Gesture.Hand = FMath::Lerp(Eye(), Gesture.Aim, static_cast<double>(SyntheticReach));
		Gesture.PullDir = TowardEye(Gesture.Hand) * (Gesture.bPush ? -1.0 : 1.0);
		Gesture.Step = EStep::Point;
		Gesture.Frames = 0;
		return;
	case EStep::Point:
		if (++Gesture.Frames >= SyntheticPointFrames) Gesture.Step = EStep::Pinch;
		return;
	case EStep::Pinch:
		// On a crumb the pinch is a tap: released where it closed.
		Gesture.Step = IsCrumb(Gesture.Id) ? EStep::Release : EStep::Pull;
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
	UpdateFades(DeltaTime);
	RunCommands(DeltaTime);
}
