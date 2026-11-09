// The headset session (docs/concepts/vr-light-table/headset-plan.md, "Code to change before or during the session"): the
// seated calibration (BpView.Seat: the table comes to the seated eye, the view never moves), the legibility test card
// (BpView.TextCard: every text class at the angle it subtends where it stands, labelled with that angle) and the frame
// meter over the wrist panel (bp.FrameMeter: the GPU's and the game thread's p50 against the 90 Hz bar).
#include "BpPawn.h"

#include "BpGameMode.h"
#include "BpTable.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "DynamicRHI.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "IXRTrackingSystem.h"
#include "Misc/App.h"
#include "RenderTimer.h"
#include "Styling/CoreStyle.h"
#include "TimerManager.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	TAutoConsoleVariable<int32> CVarFrameMeter(
		TEXT("bp.FrameMeter"),
		-1,
		TEXT("The frame meter over the wrist panel (headset-plan code item 4): 1 shown, 0 hidden, -1 shown with a headset only."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarSeatFakeEye(
		TEXT("bp.SeatFakeEyeCm"),
		-1.f,
		TEXT("A check of the seat's guard without a headset on a head: over 0, a headset Seat reads the eye this high above the floor until the head is reported on (the floor correction still applies), as an off-head launch or a wrong floor would."),
		ECVF_Default);

	const FLinearColor Cyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor CyanText(FColor(0xEC, 0xF9, 0xFF));
	const FLinearColor Amber(FColor(0xFF, 0xB5, 0x47));
	const FLinearColor Glass(FColor(0x08, 0x16, 0x2E));

	/** The vendor's comfortable band for body text (0.6 to 0.8 degrees) and our floor (BpType::FloorArcmin). */
	constexpr double ComfortLowArcmin = 36.0;
	constexpr double ComfortHighArcmin = 48.0;
	/** The card's own labels stand at this angle, inside the band. */
	constexpr double CardLabelArcmin = 42.0;
	/** A wrist farther from the eye than WristRaisedCm is not raised; it is read as if at WristReadCm. */
	constexpr double WristRaisedCm = 70.0;
	constexpr double WristReadCm = 40.0;

	FSlateFontInfo CapFont(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Font = ABpTable::TextFontObject()) return FSlateFontInfo(Font, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}

	/** The playing world (from the editor's console the world is the editor's), its bp pawn and its table. */
	bool FindPlay(UWorld* World, ABpPawn*& OutPawn, ABpTable*& OutTable)
	{
		if (GEngine && (!World || !World->IsGameWorld()))
		{
			World = nullptr;
			for (const FWorldContext& Context : GEngine->GetWorldContexts())
			{
				if (Context.World() && Context.World()->IsGameWorld())
				{
					World = Context.World();
					break;
				}
			}
		}
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		OutPawn = PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
		TActorIterator<ABpTable> Table(World);
		OutTable = Table ? *Table : nullptr;
		return OutPawn && OutTable;
	}

	float TableTopCm()
	{
		const IConsoleVariable* Height = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.TableHeightCm"));
		return Height ? Height->GetFloat() : ABpTable::DefaultTableHeightCm;
	}

	/** The world's own tick (actors, components, their tick groups) in ms, start to post-actor-tick: the game thread's work
	 *  without the frame pacing. GGameThreadTime (the meter's GAME) also holds OpenXR's xrWaitFrame, which UE calls on the
	 *  game thread outside its idle accounting, so on a headset GAME reads near the frame time whatever the game costs. */
	struct FTickClock { double StartedAt = 0.0; float LastMs = 0.f; bool bHooked = false; };
	FTickClock& TickClock()
	{
		static FTickClock Clock;
		if (!Clock.bHooked)
		{
			Clock.bHooked = true;
			FWorldDelegates::OnWorldTickStart.AddLambda([](UWorld* World, ELevelTick, float) { if (World && World->IsGameWorld()) TickClock().StartedAt = FPlatformTime::Seconds(); });
			FWorldDelegates::OnWorldPostActorTick.AddLambda([](UWorld* World, ELevelTick, float)
			{
				FTickClock& Each = TickClock();
				if (World && World->IsGameWorld() && Each.StartedAt > 0.0) Each.LastMs = static_cast<float>((FPlatformTime::Seconds() - Each.StartedAt) * 1000.0);
			});
		}
		return Clock;
	}

	/** The render thread's and the world tick's samples over the meter's window (the log line's render_ms and tick_ms). */
	struct FThreadSample { double At; float RenderMs; float TickMs; };
	TArray<FThreadSample>& ThreadSamples()
	{
		static TArray<FThreadSample> Samples;
		return Samples;
	}

	FString RuntimeName()
	{
		return GEngine && GEngine->XRSystem.IsValid() ? GEngine->XRSystem->GetVersionString() : FString(TEXT("none (flat)"));
	}

	FAutoConsoleCommandWithWorldAndArgs CmdSeat(
		TEXT("BpView.Seat"),
		TEXT("BpView.Seat [eye_above_floor_cm]: seated calibration. Reads the eye where it is and moves the table (never the view) so that eye stands at the target pose's place over it, the table turned to the way the head faces. Runs once at start with a headset; the wrist's SEAT runs it too. With a height, seats as if the eye stood that high (checks without a headset, or a seat by hand)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = nullptr;
			ABpTable* Table = nullptr;
			const float EyeCm = Args.Num() > 0 ? FCString::Atof(*Args[0]) : -1.f;
			if (!FindPlay(World, Pawn, Table) || !Pawn->Seat(EyeCm)) UE_LOG(LogBpTable, Warning, TEXT("BpView: usage BpView.Seat [eye_above_floor_cm] (needs a playing world with the bp pawn and a table)"));
		}));

#if !UE_BUILD_SHIPPING
	FAutoConsoleCommandWithWorldAndArgs CmdBench(
		TEXT("BpView.Bench"),
		TEXT("BpView.Bench [pitch_deg] [yaw_deg]: for a headset lying still on a desk. Turns and moves the pawn so that the headset's view, wherever it points, is the seated target view over the table (default pitch the target pose's, yaw 0; a yaw looks aside, e.g. at the shelves). The device then renders what a seated person sees, for measurements and screen captures with nobody wearing it. Non-Shipping builds only."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = nullptr;
			ABpTable* Table = nullptr;
			const float Pitch = Args.Num() > 0 ? FCString::Atof(*Args[0]) : ABpGameMode::TargetPitchDeg;
			const float Yaw = Args.Num() > 1 ? FCString::Atof(*Args[1]) : 0.f;
			if (!FindPlay(World, Pawn, Table) || !Pawn->Bench(Pitch, Yaw)) UE_LOG(LogBpTable, Warning, TEXT("BpView: usage BpView.Bench [pitch_deg] [yaw_deg] (needs a playing world with the bp pawn and a table)"));
		}));
#endif

	FAutoConsoleCommandWithWorldAndArgs CmdFakeHead(
		TEXT("BpView.FakeHead"),
		TEXT("BpView.FakeHead on|off|unknown [seconds]: what a headset put on or taken off would do, or a runtime with no presence signal (unknown), after that many seconds (the seat guard's check, with the Simulator)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = nullptr;
			ABpTable* Table = nullptr;
			if (Args.Num() == 0 || !FindPlay(World, Pawn, Table))
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpView: usage BpView.FakeHead on|off [seconds] (needs a playing world with the bp pawn)"));
				return;
			}
			const bool bOn = Args[0] == TEXT("on");
			const bool bForget = Args[0] == TEXT("unknown");
			const float After = Args.Num() > 1 ? FCString::Atof(*Args[1]) : 0.f;
			const TWeakObjectPtr<ABpPawn> Weak(Pawn);
			FTimerHandle Later;
			Pawn->GetWorld()->GetTimerManager().SetTimer(Later, FTimerDelegate::CreateLambda([Weak, bOn, bForget]()
			{
				if (ABpPawn* Each = Weak.Get())
				{
					if (bForget) Each->ForgetHead();
					else if (bOn) Each->OnHeadOn();
					else Each->OnHeadOff();
				}
			}), FMath::Max(0.01f, After), false);
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdTextCard(
		TEXT("BpView.TextCard"),
		TEXT("BpView.TextCard [1|0]: the legibility test card at the deck's place: every text class (deck, sheet, spines, caption, wrist, map, key plan) at the angle it subtends from the eye where it stands, each labelled with it, and the 22' floor and the 36'-48' comfortable band. Logs each class's arcmin."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = nullptr;
			ABpTable* Table = nullptr;
			if (!FindPlay(World, Pawn, Table))
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpView: usage BpView.TextCard [1|0] (needs a playing world with the bp pawn and a table)"));
				return;
			}
			const bool bShow = Args.Num() == 0 || Args[0] != TEXT("0");
			TArray<BpType::FClassSample> Classes;
			Table->TextClasses(Classes);
			const FVector Eye = Pawn->GetPawnViewLocation();
			TArray<BpType::FClassSample> Wrist;
			Pawn->WristTextClasses(Wrist);
			for (BpType::FClassSample& Each : Wrist)
			{
				// A wrist that is not raised (a tracked hand down, the Simulator's hands at rest) is read where a raised one
				// stands, WristReadCm straight ahead of the eye.
				if (FVector::Dist(Each.Foot, Eye) <= WristRaisedCm) continue;
				const FRotator View = Pawn->GetViewRotation();
				Each.Foot = Eye + View.Vector() * WristReadCm;
				Each.Up = FRotationMatrix(View).GetUnitAxis(EAxis::Z);
				Each.Name += FString::Printf(TEXT(" (at %.0f cm)"), WristReadCm);
			}
			Classes.Append(Wrist);
			Table->ShowTextCard(bShow, Eye, Classes);
		}));

	/** The competition's FoV-aware design: essential UI inside the narrower view of every Quest (3S about 96 deg across, 3
	 *  about 110), so nothing that matters needs a head turn from the seated rest gaze. The rest gaze is the eye toward the
	 *  paper's centre; each element is read as its yaw (right +) and pitch (up +) off it. In view: within FovComfortDeg both
	 *  ways; edge: within FovEdgeDeg (seen, but at the lens's soft rim); beyond: a head turn. */
	constexpr double FovComfortDeg = 30.0;
	constexpr double FovEdgeDeg = 42.0;
	FAutoConsoleCommandWithWorld CmdFov(
		TEXT("BpView.Fov"),
		TEXT("BpView.Fov: logs every text class, the deck's front screen and the lamp's caption as yaw/pitch degrees off the seated rest gaze (the eye toward the paper's centre), with in view (30 deg), edge (42) or beyond."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			ABpPawn* Pawn = nullptr;
			ABpTable* Table = nullptr;
			if (!FindPlay(World, Pawn, Table))
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpView: BpView.Fov needs a playing world with the bp pawn and a table"));
				return;
			}
			const FVector Eye = Pawn->GetPawnViewLocation();
			const FVector Centre = Table->PaperToWorld(FVector2D(ABpTable::PaperWidthCm * 0.5, ABpTable::PaperDepthCm * 0.5));
			const FVector Fwd = (Centre - Eye).GetSafeNormal();
			const FVector Right = FVector::CrossProduct(FVector::UpVector, Fwd).GetSafeNormal();
			const FVector Up = FVector::CrossProduct(Fwd, Right);
			struct FMark { FString Name; FVector At; };
			TArray<FMark> Marks;
			TArray<BpType::FClassSample> Classes;
			Table->TextClasses(Classes);
			for (const BpType::FClassSample& Each : Classes) Marks.Add({ Each.Name, Each.Foot });
			Marks.Add({ TEXT("deck front screen"), Table->GetDeckFrontWorld() });
			Marks.Add({ TEXT("lamp caption (centre)"), Table->GetCaptionWorld() });
			TArray<FVector> Stations;
			Table->LampStationsLocal(Stations);
			for (int32 Index = 0; Index < Stations.Num(); ++Index) Marks.Add({ FString::Printf(TEXT("lamp station %d"), Index), Table->GetActorTransform().TransformPosition(Stations[Index]) });
			const double W = ABpTable::PaperWidthCm, D = ABpTable::PaperDepthCm;
			Marks.Add({ TEXT("paper far-left corner"), Table->PaperToWorld(FVector2D(0.0, 0.0)) });
			Marks.Add({ TEXT("paper far-right corner"), Table->PaperToWorld(FVector2D(W, 0.0)) });
			Marks.Add({ TEXT("paper near-left corner"), Table->PaperToWorld(FVector2D(0.0, D)) });
			Marks.Add({ TEXT("paper near-right corner"), Table->PaperToWorld(FVector2D(W, D)) });
			int32 Beyond = 0, Edge = 0;
			UE_LOG(LogBpTable, Log, TEXT("BpView: fov rest gaze pitch %.1f deg (eye %.0f cm from the paper's centre); in view <= %.0f deg, edge <= %.0f"),
				FMath::RadiansToDegrees(FMath::Asin(Fwd.Z)), FVector::Dist(Eye, Centre), FovComfortDeg, FovEdgeDeg);
			for (const FMark& Mark : Marks)
			{
				const FVector Dir = (Mark.At - Eye).GetSafeNormal();
				const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(FVector::DotProduct(Dir, Right), FVector::DotProduct(Dir, Fwd)));
				const double Pitch = FMath::RadiansToDegrees(FMath::Atan2(FVector::DotProduct(Dir, Up), FVector::DotProduct(Dir, Fwd)));
				const double Worst = FMath::Max(FMath::Abs(Yaw), FMath::Abs(Pitch));
				const TCHAR* Band = Worst <= FovComfortDeg ? TEXT("in view") : Worst <= FovEdgeDeg ? TEXT("edge") : TEXT("beyond");
				Edge += Worst > FovComfortDeg && Worst <= FovEdgeDeg ? 1 : 0;
				Beyond += Worst > FovEdgeDeg ? 1 : 0;
				UE_LOG(LogBpTable, Log, TEXT("BpView: fov %-34s yaw %+6.1f pitch %+6.1f  %s"), *Mark.Name, Yaw, Pitch, Band);
			}
			UE_LOG(LogBpTable, Log, TEXT("BpView: fov %d marks, %d at the edge, %d beyond"), Marks.Num(), Edge, Beyond);
		}));
}

// ---- Seated calibration ----------------------------------------------------------------------------------------------------

void ABpTable::MoveTable(const FTransform& To)
{
	// What stands on the table follows it rigidly: a world transform W becomes W * From^-1 * To.
	const FTransform Delta = GetActorTransform().Inverse() * To;
	if (GetRootComponent() && GetRootComponent()->Mobility != EComponentMobility::Movable) GetRootComponent()->SetMobility(EComponentMobility::Movable);
	SetActorTransform(To, false, nullptr, ETeleportType::TeleportPhysics);
	if (!Lamp.IsValid()) return;
	LampRest = LampRest * Delta;
	for (FTransform& Rest : LampGroupRest) Rest = Rest * Delta;
	// Movable to be moved: PlaceLamp puts it at its new rest (or its room place) and, at its rest, gives its mobility back.
	if (Lamp->GetRootComponent()) Lamp->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	for (const TWeakObjectPtr<AActor>& Each : LampGroup)
	{
		if (Each.IsValid() && Each->GetRootComponent()) Each->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	}
	bLampMovable = true;
	PlaceLamp();
}

bool ABpPawn::Seat(float EyeAboveFloorCm)
{
	TActorIterator<ABpTable> It(GetWorld());
	if (!It || !Camera) return false;
	ABpTable* Table = *It;
	const double FloorZ = Table->GetHomeTransform().GetLocation().Z;
	FVector Eye = Camera->GetComponentLocation();
	if (EyeAboveFloorCm > 0.f) Eye.Z = FloorZ + EyeAboveFloorCm;
	else if (CVarSeatFakeEye.GetValueOnGameThread() > 0.f && IsHeadsetOn() && HeadPresence != EBpHeadPresence::On) Eye.Z = FloorZ + CVarSeatFakeEye.GetValueOnGameThread();
	// The floor correction is for a wrong runtime floor under a head that is really on (Steam Link, 2026-10-29). A headset
	// lying on a desk reads the same low eye, and a correction taken for it would leave the person 1.5 m over the table
	// (2026-11-08), so it never runs with the headset known to be off the head.
	if (EyeAboveFloorCm <= 0.f && IsHeadsetOn() && HeadPresence != EBpHeadPresence::Off && Eye.Z - FloorZ < SeatEyeMinCm)
	{
		const double FloorFixCm = SeatedEyeCm - (Eye.Z - FloorZ);
		AddActorWorldOffset(FVector(0.0, 0.0, FloorFixCm));
		Eye.Z += FloorFixCm;
		SeatFloorFixCm += FloorFixCm;
		UE_LOG(LogBpTable, Log, TEXT("BpView: seat floor corrected by %.1f cm (the runtime's floor stood %.1f cm under the eye)"), FloorFixCm, SeatedEyeCm - FloorFixCm);
	}
	const double HeadYaw = Camera->GetComponentRotation().Yaw;
	const FTransform Was = Table->GetActorTransform();
	const double Top = TableTopCm();
	// Where the table stands so the eye is at the target pose's place over it (ABpGameMode::FindPose's "target"), turned to
	// the head's yaw: the eye is TargetBehindNearEdgeCm behind the near edge (-X) and TargetEyeAboveTopCm over the top.
	const FVector EyeOnTable(-(ABpTable::TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0, Top + ABpGameMode::TargetEyeAboveTopCm);
	const FQuat Yaw(FVector::UpVector, FMath::DegreesToRadians(HeadYaw));
	FVector At = Eye - Yaw.RotateVector(EyeOnTable);
	// Its feet never rise off the floor the level stood it on (a standing eye gets the table as built, the gap logged), nor
	// sink so far that its top is under SeatTopMinCm.
	At.Z = FMath::Clamp(At.Z, FloorZ - (Top - SeatTopMinCm), FloorZ);
	Table->MoveTable(FTransform(Yaw, At, Was.GetScale3D()));
	const double TopAboveFloor = At.Z - FloorZ + Top;
	UE_LOG(LogBpTable, Log, TEXT("BpView: seat %s%s eye_above_floor_cm=%.1f table_top_cm=%.1f eye_above_top_cm=%.1f (target %.0f) moved_cm=%.1f turned_deg=%.1f runtime=%s"),
		IsHeadsetOn() ? TEXT("headset") : TEXT("flat"), EyeAboveFloorCm > 0.f ? TEXT(" (eye height given)") : TEXT(""), Eye.Z - FloorZ, TopAboveFloor, Eye.Z - FloorZ - TopAboveFloor, ABpGameMode::TargetEyeAboveTopCm,
		FVector::Dist(Was.GetLocation(), At), FMath::FindDeltaAngleDegrees(Was.Rotator().Yaw, HeadYaw), *RuntimeName());
	return true;
}

bool ABpPawn::Bench(float PitchDeg, float YawDeg)
{
	TActorIterator<ABpTable> It(GetWorld());
	if (!It || !Camera) return false;
	const FTransform Table = It->GetActorTransform();
	// The target pose's eye over the table as it stands now (Seat's own EyeOnTable), looking down the table.
	const FVector EyeOnTable(-(ABpTable::TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0, TableTopCm() + ABpGameMode::TargetEyeAboveTopCm);
	const FTransform Want(Table.GetRotation() * FRotator(PitchDeg, YawDeg, 0.f).Quaternion(), Table.GetLocation() + Table.GetRotation().RotateVector(EyeOnTable));
	// The camera rides the pawn: world = CameraInPawn * Pawn, so the pawn goes to CameraInPawn^-1 * Want.
	const FTransform Cam(Camera->GetComponentQuat(), Camera->GetComponentLocation());
	const FTransform Self(GetActorQuat(), GetActorLocation());
	const FTransform To = Cam.GetRelativeTransform(Self).Inverse() * Want;
	SetActorLocationAndRotation(To.GetLocation(), To.GetRotation(), false, nullptr, ETeleportType::TeleportPhysics);
	UE_LOG(LogBpTable, Log, TEXT("BpView: bench pitch=%.1f yaw=%.1f eye=(%.0f,%.0f,%.0f): the resting headset now sees the seated view"), PitchDeg, YawDeg, Want.GetLocation().X, Want.GetLocation().Y, Want.GetLocation().Z);
	return true;
}

void ABpPawn::SeatAtStart()
{
	// The head's first poses can still be the origin's: at least two tries, then the first tracked one on a head that is on.
	++SeatTried;
	if (SeatTried < 2) return;
	const bool bTracked = GEngine && GEngine->XRSystem.IsValid() && GEngine->XRSystem->IsTracking(IXRTrackingSystem::HMDDeviceId);
	const bool bWorn = HeadPresence == EBpHeadPresence::On || (HeadPresence == EBpHeadPresence::Unknown && FApp::HasVRFocus());
	if (!bTracked || HeadPresence == EBpHeadPresence::Off || !bWorn)
	{
		// Waiting for a head (a launch with the headset off, the runtime's menu, or a head not yet tracked). The first wait is
		// logged; after SeatTries, a runtime that says nothing about the head and gives no focus still gets a seat, so it does
		// not sit at the level's table forever: a provisional one, redone when the head is really on.
		if (SeatTried == 2) UE_LOG(LogBpTable, Log, TEXT("BpView: seat waits for the head (presence=%d tracked=%d focus=%d)"), static_cast<int32>(HeadPresence), bTracked, FApp::HasVRFocus());
		if (SeatTried >= SeatTries && bTracked && HeadPresence == EBpHeadPresence::Unknown && !bSeatProvisional)
		{
			UE_LOG(LogBpTable, Warning, TEXT("BpView: no presence signal and no focus after %.0f s; a provisional seat at the eye it reports"), SeatTried * SeatRetryS);
			bSeatProvisional = true;
			Seat();
		}
		return;
	}
	GetWorldTimerManager().ClearTimer(SeatTimer);
	// A provisional seat (no signal, then the head arrived): its correction goes first.
	if (bSeatProvisional && !FMath::IsNearlyZero(SeatFloorFixCm))
	{
		AddActorWorldOffset(FVector(0.0, 0.0, -SeatFloorFixCm));
		UE_LOG(LogBpTable, Log, TEXT("BpView: undid a %.1f cm floor correction taken before the head was on"), SeatFloorFixCm);
		SeatFloorFixCm = 0.0;
	}
	const bool bAssumed = HeadPresence != EBpHeadPresence::On;
	bSeatProvisional = false;
	Seat();
	// On a head only assumed (no presence signal), a correction stays provisional until a real put-on says otherwise.
	bSeatProvisional = bAssumed && !FMath::IsNearlyZero(SeatFloorFixCm);
}

void ABpPawn::OnHeadOn()
{
	const bool bFirst = !bHeadEverOn;
	bHeadEverOn = true;
	HeadPresence = EBpHeadPresence::On;
	UE_LOG(LogBpTable, Log, TEXT("BpView: the headset is on the head (first=%d provisional=%d)"), bFirst, bSeatProvisional);
	if (!bFirst || !bSeatProvisional) return;
	// The first put-on after a seat made on an assumed head: the correction it took goes, and the seat is made again.
	if (!FMath::IsNearlyZero(SeatFloorFixCm))
	{
		AddActorWorldOffset(FVector(0.0, 0.0, -SeatFloorFixCm));
		UE_LOG(LogBpTable, Log, TEXT("BpView: undid a %.1f cm floor correction taken before the head was on"), SeatFloorFixCm);
		SeatFloorFixCm = 0.0;
	}
	bSeatProvisional = false;
	GetWorldTimerManager().ClearTimer(SeatTimer);
	Seat();
}

void ABpPawn::ForgetHead()
{
	HeadPresence = EBpHeadPresence::Unknown;
	bHeadEverOn = false;
	UE_LOG(LogBpTable, Log, TEXT("BpView: the head's presence is unknown (a check)"));
}

void ABpPawn::OnHeadOff()
{
	HeadPresence = EBpHeadPresence::Off;
	UE_LOG(LogBpTable, Log, TEXT("BpView: the headset is off the head"));
}

// ---- The legibility test card ------------------------------------------------------------------------------------------

void ABpTable::TextClasses(TArray<BpType::FClassSample>& Out) const
{
	DeckTextClasses(Out);
	// The caption faces the target eye (ApplyLampWidgets), so its cap rises square to that eye's ray.
	const FVector Caption(CaptionXCm, CaptionYCm, PlacedHeightCm + CaptionAboveTopCm);
	Out.Add({ TEXT("lamp caption"), CaptionCapCm, GetCaptionWorld(), GetActorTransform().TransformVectorNoScale(FRotationMatrix((EyeLocal() - Caption).Rotation()).GetUnitAxis(EAxis::Z)) });
	// The paper's classes at the floor's rule (BpType: a class never draws under the floor where it stands), at the paper's
	// middle and at the plan's far edge, rising toward the far edge.
	const auto OnPaper = [&](const TCHAR* Name, const BpType::FRecipe& Recipe, const FVector2D& At)
	{
		const FVector Foot = PaperToWorld(At);
		Out.Add({ Name, FMath::Max(Recipe.CapCm, TextFloorCm(At)), Foot, PaperToWorld(At - FVector2D(0.0, 1.0)) - Foot });
	};
	const FVector2D Middle(PaperWidthCm * 0.5, PaperDepthCm * 0.5), Far(PaperWidthCm * 0.5, PlanFarMarginCm);
	OnPaper(TEXT("map feature name"), BpType::FeatureName, Middle);
	OnPaper(TEXT("map feature name, far"), BpType::FeatureName, Far);
	OnPaper(TEXT("map bay kind"), BpType::BayKind, Middle);
	OnPaper(TEXT("map open count"), BpType::OpenCount, Middle);
	OnPaper(TEXT("site room name"), BpType::RoomName, Middle);
	OnPaper(TEXT("key plan label"), BpType::TitleSub, FVector2D(KeyPlanLeftCm, KeyPlanTopCm + 1.0));
}

void ABpTable::ShowTextCard(bool bShow, const FVector& EyeWorld, const TArray<BpType::FClassSample>& Classes)
{
	if (!bShow)
	{
		if (TextCard) TextCard->SetVisibility(false);
		UE_LOG(LogBpTable, Log, TEXT("BpView: text card hidden"));
		return;
	}
	if (!TextCard)
	{
		TextCard = NewObject<UWidgetComponent>(this, TEXT("TextCard"));
		TextCard->SetupAttachment(GetRootComponent());
		TextCard->SetWidgetSpace(EWidgetSpace::World);
		TextCard->SetDrawSize(FVector2D(TextCardWidthCm * TextCardPxPerCm, TextCardHeightCm * TextCardPxPerCm));
		TextCard->SetDrawAtDesiredSize(false);
		TextCard->SetPivot(FVector2D(0.5, 0.5));
		TextCard->SetBlendMode(EWidgetBlendMode::Transparent);
		TextCard->SetTwoSided(false);
		TextCard->SetBackgroundColor(FLinearColor::Transparent);
		TextCard->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		TextCard->SetCastShadow(false);
		TextCard->SetWindowFocusable(false);
		TextCard->SetManuallyRedraw(true);
		TextCard->SetTranslucentSortPriority(20);
		TextCard->RegisterComponent();
	}
	// At the deck's front screen, a little nearer the eye so it stands over a deck that shows, turned to the eye.
	const FVector Eye = GetActorTransform().InverseTransformPosition(EyeWorld);
	const FVector Front = DeckPose(0.f, 0.f).GetLocation();
	const FVector At = Front + (Eye - Front).GetSafeNormal() * 2.0;
	TextCard->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(1.0 / TextCardPxPerCm)));
	TextCard->SetVisibility(true);
	const double Distance = FVector::Dist(Eye, At);
	// The cap that subtends an angle at the card's distance, in the card's pixels.
	const auto CapPx = [&](double Arcmin) { return static_cast<float>(2.0 * Distance * FMath::Tan(FMath::DegreesToRadians(Arcmin / 60.0) * 0.5) * TextCardPxPerCm); };
	const FSlateFontInfo LabelFont = CapFont(TEXT("Bold"), CapPx(CardLabelArcmin));
	static const FSlateRoundedBoxBrush Panel(Glass, 16.f, Cyan.CopyWithNewOpacity(0.8f), 3.f);
	TSharedRef<SVerticalBox> Rows = SNew(SVerticalBox);
	const auto Row = [&](const FString& Label, double Arcmin, const FLinearColor& Ink, const TCHAR* Sample)
	{
		Rows->AddSlot().AutoHeight().Padding(0.f, 0.f, 0.f, CapPx(5.0))
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(0.42f).VAlign(VAlign_Bottom)
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%s  %.0f'"), *Label.ToUpper(), Arcmin))).Font(LabelFont).ColorAndOpacity(FSlateColor(Ink))
			]
			+ SHorizontalBox::Slot().FillWidth(0.58f).VAlign(VAlign_Bottom)
			[
				SNew(STextBlock).Text(FText::FromString(Sample)).Font(CapFont(TEXT("Regular"), CapPx(Arcmin))).ColorAndOpacity(FSlateColor(FLinearColor::White))
			]
		];
	};
	Row(TEXT("floor"), BpType::FloorArcmin, Amber, TEXT("Approve 3 findings · T1 2 · wave 07"));
	Row(TEXT("comfort, low"), ComfortLowArcmin, Cyan, TEXT("Approve 3 findings · T1 2 · wave 07"));
	Row(TEXT("comfort, high"), ComfortHighArcmin, Cyan, TEXT("Approve 3 findings · T1 2 · wave 07"));
	for (const BpType::FClassSample& Each : Classes)
	{
		const double Arcmin = BpType::Arcmin(Each, EyeWorld);
		const double Away = FVector::Dist(Each.Foot, EyeWorld);
		UE_LOG(LogBpTable, Log, TEXT("BpView: text class=\"%s\" cap_cm=%.2f dist_cm=%.1f arcmin=%.1f%s"), *Each.Name, Each.CapCm, Away, Arcmin,
			Arcmin < BpType::FloorArcmin ? TEXT(" UNDER THE FLOOR") : Arcmin < ComfortLowArcmin ? TEXT(" under the band") : TEXT(""));
		Row(Each.Name, Arcmin, Arcmin < ComfortLowArcmin ? Amber : CyanText, TEXT("Approve 3 findings · T1 2 · wave 07"));
	}
	TextCard->SetSlateWidget(
		SNew(SBorder).BorderImage(&Panel).Padding(FMargin(CapPx(36.0), CapPx(20.0)))
		[
			Rows
		]);
	TextCard->RequestRedraw();
	UE_LOG(LogBpTable, Log, TEXT("BpView: text card %d classes, %.1f cm from the eye; amber under %.0f', the floor %.0f'"), Classes.Num(), Distance, ComfortLowArcmin, BpType::FloorArcmin);
}

// ---- The frame meter ------------------------------------------------------------------------------------------------------

void ABpPawn::MakeFrameMeter()
{
	if (!WristPanel) return;
	// A strip over the wrist panel, in its pixels (its scale is cm a pixel): the panel's width, above its top edge.
	constexpr float W = WristPanelWidthCm * WristPanelPxPerCm, H = 64.f;
	FrameMeter = NewObject<UWidgetComponent>(this, TEXT("FrameMeter"));
	FrameMeter->SetupAttachment(WristPanel);
	FrameMeter->SetWidgetSpace(EWidgetSpace::World);
	FrameMeter->SetDrawSize(FVector2D(W, H));
	FrameMeter->SetDrawAtDesiredSize(false);
	FrameMeter->SetPivot(FVector2D(0.5, 0.5));
	FrameMeter->SetBlendMode(EWidgetBlendMode::Transparent);
	FrameMeter->SetTwoSided(false);
	FrameMeter->SetBackgroundColor(FLinearColor::Transparent);
	FrameMeter->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	FrameMeter->SetCastShadow(false);
	FrameMeter->SetWindowFocusable(false);
	FrameMeter->SetManuallyRedraw(true);
	// UWidgetComponent's mapping: widget y is -local Z, so above the panel is +Z.
	FrameMeter->SetRelativeLocation(FVector(0.0, 0.0, WristPanelHeightCm * WristPanelPxPerCm * 0.5 + H * 0.5 + 12.0));
	FrameMeter->SetVisibility(false);
	FrameMeter->RegisterComponent();
	SetActorTickEnabled(true);
}

void ABpPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	TickFrameMeter(DeltaSeconds);
	TickWristLive();
}

void ABpPawn::TickFrameMeter(float DeltaSeconds)
{
	const int32 Want = CVarFrameMeter.GetValueOnGameThread();
	const bool bShow = FrameMeter && (Want > 0 || (Want < 0 && IsHeadsetOn()));
	if (FrameMeter && FrameMeter->IsVisible() != bShow) FrameMeter->SetVisibility(bShow);
	if (!bShow) return;
	const double Now = FPlatformTime::Seconds();
	FrameSamples.Add({ Now, static_cast<float>(FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles())), static_cast<float>(FPlatformTime::ToMilliseconds(GGameThreadTime)), DeltaSeconds * 1000.f });
	FrameSamples.RemoveAll([Now](const FFrameSample& Each) { return Now - Each.At > FrameWindowS; });
	TArray<FThreadSample>& Threads = ThreadSamples();
	Threads.Add({ Now, static_cast<float>(FPlatformTime::ToMilliseconds(GRenderThreadTime)), TickClock().LastMs });
	Threads.RemoveAll([Now](const FThreadSample& Each) { return Now - Each.At > FrameWindowS; });
	if (Now - FrameShownAt < 0.25) return;
	const bool bLog = FMath::FloorToInt(Now / 10.0) != FMath::FloorToInt(FrameShownAt / 10.0);
	FrameShownAt = Now;
	const auto P50 = [this](float FFrameSample::*Field)
	{
		TArray<float> Values;
		for (const FFrameSample& Each : FrameSamples) Values.Add(Each.*Field);
		Values.Sort();
		return Values.Num() ? Values[Values.Num() / 2] : 0.f;
	};
	const float Gpu = P50(&FFrameSample::GpuMs), Game = P50(&FFrameSample::GameMs), Frame = P50(&FFrameSample::FrameMs);
	const auto Ink = [](float Ms) { return FSlateColor(Ms <= FrameBarMs ? CyanText : Amber); };
	const FSlateFontInfo Font = CapFont(TEXT("Bold"), 26.f);
	static const FSlateRoundedBoxBrush Strip(Glass.CopyWithNewOpacity(0.85f), 10.f, Cyan.CopyWithNewOpacity(0.6f), 2.f);
	const auto Cell = [&](const FString& Text, float Ms) -> TSharedRef<SWidget>
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(Ink(Ms));
	};
	FrameMeter->SetSlateWidget(
		SNew(SBorder).BorderImage(&Strip).Padding(FMargin(16.f, 0.f)).VAlign(VAlign_Center)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.f)[Cell(FString::Printf(TEXT("GPU %.1f"), Gpu), Gpu)]
			+ SHorizontalBox::Slot().FillWidth(1.f)[Cell(FString::Printf(TEXT("GAME %.1f"), Game), Game)]
			+ SHorizontalBox::Slot().FillWidth(1.f)[Cell(FString::Printf(TEXT("FRAME %.1f MS"), Frame), Frame)]
		]);
	FrameMeter->RequestRedraw();
	if (bLog)
	{
		const auto ThreadP50 = [&Threads](float FThreadSample::*Field)
		{
			TArray<float> Values;
			for (const FThreadSample& Each : Threads) Values.Add(Each.*Field);
			Values.Sort();
			return Values.Num() ? Values[Values.Num() / 2] : 0.f;
		};
		// game_ms holds xrWaitFrame on a headset (TickClock); tick_ms is the world's own tick, render_ms the render thread's.
		UE_LOG(LogBpTable, Log, TEXT("BpFrame: p50 over %.0f s gpu_ms=%.2f game_ms=%.2f frame_ms=%.2f render_ms=%.2f tick_ms=%.2f (bar %.1f) samples=%d runtime=%s"),
			FrameWindowS, Gpu, Game, Frame, ThreadP50(&FThreadSample::RenderMs), ThreadP50(&FThreadSample::TickMs), FrameBarMs, FrameSamples.Num(), *RuntimeName());
	}
}
