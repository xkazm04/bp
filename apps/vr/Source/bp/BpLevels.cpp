// The table's levels (lynx-plan L3.4, spark vr-hands-zoom WP3, the owner's "Lift"; BpTable.h declares the API and the
// constants). The entered wing rises off the paper in place and grows about its own centre, the entered room rises a
// further step above it, and the rest of the sheet dims; nothing else moves. Every lift is a transform of a whole batch
// (Rooms, or Bays and Tiles), never of an instance in plan space, so a batch back at rest is where it was, bit for bit.
// What shows is per-instance custom data 3 (Show) on M_EdgeGlow, and each label's opacity.
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"

namespace
{
	TAutoConsoleVariable<int32> CVarReducedMotion(
		TEXT("bp.ReducedMotion"),
		0,
		TEXT("1: level changes on the light table are instant instead of easing over ABpTable::LevelEaseS."),
		ECVF_Default);

	/** A highlighted room's shell glows this much brighter (Show above 1 scales M_EdgeGlow's emissive). */
	constexpr float HighlightShow = 1.6f;

	/** Ease-in-out on a step's progress; 0 and 1 map to exactly 0 and 1, so a settled step is exactly at rest or lifted. */
	float Ease(float Alpha)
	{
		return Alpha * Alpha * (3.f - 2.f * Alpha);
	}

	/** The actor's space to paper centimetres (the inverse of ABpTable::PaperCmToLocal, height dropped). */
	FVector2D LocalToPaperCm(const FVector& Local)
	{
		return FVector2D(Local.Y + ABpTable::PaperWidthCm * 0.5, ABpTable::PaperDepthCm * 0.5 - Local.X);
	}

	bool Inside(const FBpPlanBox& Box, const FVector2D& Plan)
	{
		return Plan.X >= Box.x && Plan.X <= Box.x + Box.w && Plan.Y >= Box.y && Plan.Y <= Box.y + Box.h;
	}

	/** Runs Fn on every table of the world; a command that comes before any table has a plan (-ExecCmds at startup) is
	 *  kept for ApplyPlan instead. */
	void WithTables(UWorld* World, const FString& Command, TFunctionRef<void(ABpTable&)> Fn)
	{
		bool bAny = false;
		if (World)
		{
			for (TActorIterator<ABpTable> It(World); It; ++It)
			{
				if (!It->HasPlan()) continue;
				bAny = true;
				Fn(**It);
			}
		}
		if (!bAny)
		{
			ABpTable::PendingLevelCommands().Add(Command);
			UE_LOG(LogBpTable, Log, TEXT("BpLevel: deferred \"%s\" until the plan arrives"), *Command);
		}
	}

	FString JoinArgs(const TArray<FString>& Args)
	{
		return FString::Join(Args, TEXT(" "));
	}

	FAutoConsoleCommandWithWorldAndArgs CmdLevelEnter(
		TEXT("BpLevel.Enter"),
		TEXT("BpLevel.Enter <wing id|room id>: lift a wing (L0 -> L1) or a room (L1 -> L2; from L0 its wing first)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpLevel: usage BpLevel.Enter <wing id|room id>"));
				return;
			}
			const FString Id = Args[0];
			WithTables(World, TEXT("BpLevel.Enter ") + JoinArgs(Args), [&Id](ABpTable& Table) { Table.Enter(Id); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdLevelBack(
		TEXT("BpLevel.Back"),
		TEXT("BpLevel.Back: one level up (L2 -> L1 -> L0)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			WithTables(World, TEXT("BpLevel.Back"), [](ABpTable& Table) { Table.Back(); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdLevelHome(
		TEXT("BpLevel.Home"),
		TEXT("BpLevel.Home: back to L0, one logged step at a time."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			WithTables(World, TEXT("BpLevel.Home"), [](ABpTable& Table) { Table.Home(); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdLevelHighlight(
		TEXT("BpLevel.Highlight"),
		TEXT("BpLevel.Highlight <wing|room|crumb> [id]: brighten one wing, room or crumb (HitTest's ids); no id clears it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString Kind = Args.Num() > 0 ? Args[0] : FString();
			const FString Id = Args.Num() > 1 ? Args[1] : FString();
			WithTables(World, TEXT("BpLevel.Highlight ") + JoinArgs(Args), [&Kind, &Id](ABpTable& Table) { Table.SetHighlight(Kind, Id); });
		}));
}

TArray<FString>& ABpTable::PendingLevelCommands()
{
	static TArray<FString> Pending;
	return Pending;
}

const FBpPlanWing* ABpTable::FindWing(const FString& Id) const
{
	return SheetPlan.IsValid() ? SheetPlan->wings.FindByPredicate([&Id](const FBpPlanWing& Wing) { return Wing.id == Id; }) : nullptr;
}

const FBpPlanRoom* ABpTable::FindRoom(const FString& Id) const
{
	return SheetPlan.IsValid() ? SheetPlan->rooms.FindByPredicate([&Id](const FBpPlanRoom& Room) { return Room.id == Id; }) : nullptr;
}

FVector2D ABpTable::PaperCmToPlan(const FVector2D& PaperCm) const
{
	// The inverse of PlanToPaperCm.
	const FVector2D Margin = (FVector2D(PaperWidthCm, PaperDepthCm) - PlanSize * BpPlanUnitCm) * 0.5;
	return PlanMin + (PaperCm - Margin) / BpPlanUnitCm;
}

float ABpTable::SheetInkFactor(const FString& Wing) const
{
	return SheetDimWing.IsEmpty() || Wing == SheetDimWing ? 1.f : LevelDim;
}

void ABpTable::LogStep(EBpLevel From, EBpLevel To)
{
	const TCHAR* Names[] = { TEXT("L0"), TEXT("L1"), TEXT("L2") };
	const bool bRoom = From == EBpLevel::L2 || To == EBpLevel::L2;
	UE_LOG(LogBpTable, Log, TEXT("BpLevel: %s -> %s %s=%s"), Names[static_cast<int32>(From)], Names[static_cast<int32>(To)],
		bRoom ? TEXT("room") : TEXT("wing"), bRoom ? *RoomId : *WingId);
}

bool ABpTable::EnterWing(const FString& InWingId)
{
	if (!SheetPlan.IsValid())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused no plan yet"));
		return false;
	}
	if (!FindWing(InWingId))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused unknown wing %s"), *InWingId);
		return false;
	}
	if (Level != EBpLevel::L0 && WingId == InWingId)
	{
		if (Level == EBpLevel::L2) Back();
		return true;
	}
	Home();
	WingId = InWingId;
	Level = EBpLevel::L1;
	LogStep(EBpLevel::L0, EBpLevel::L1);
	UpdateBreadcrumb();
	KickLevels();
	return true;
}

bool ABpTable::Enter(const FString& Id)
{
	if (FindRoom(Id)) return EnterRoom(Id);
	if (FindWing(Id) || !SheetPlan.IsValid()) return EnterWing(Id);
	UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused unknown id %s"), *Id);
	return false;
}

bool ABpTable::EnterRoom(const FString& InRoomId)
{
	const FBpPlanRoom* Room = FindRoom(InRoomId);
	if (!SheetPlan.IsValid() || !Room)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused %s"), SheetPlan.IsValid() ? *FString::Printf(TEXT("unknown room %s"), *InRoomId) : TEXT("no plan yet"));
		return false;
	}
	if (Level == EBpLevel::L0)
	{
		if (!EnterWing(Room->parentId)) return false;
	}
	else if (Room->parentId != WingId)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused room %s is not in wing %s"), *InRoomId, *WingId);
		return false;
	}
	if (Level == EBpLevel::L2)
	{
		if (RoomId == InRoomId) return true;
		Back();
	}
	RoomId = InRoomId;
	Level = EBpLevel::L2;
	LogStep(EBpLevel::L1, EBpLevel::L2);
	UpdateBreadcrumb();
	KickLevels();
	return true;
}

void ABpTable::Back()
{
	if (Level == EBpLevel::L2)
	{
		LogStep(EBpLevel::L2, EBpLevel::L1);
		Level = EBpLevel::L1;
		RoomId.Reset();
	}
	else if (Level == EBpLevel::L1)
	{
		LogStep(EBpLevel::L1, EBpLevel::L0);
		Level = EBpLevel::L0;
		WingId.Reset();
	}
	else
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLevel: refused back, already at L0"));
		return;
	}
	UpdateBreadcrumb();
	KickLevels();
}

void ABpTable::Home()
{
	while (Level != EBpLevel::L0) Back();
}

bool ABpTable::IsLevelMoving() const
{
	const FString WantWing = Level != EBpLevel::L0 ? WingId : FString();
	const FString WantRoom = Level == EBpLevel::L2 ? RoomId : FString();
	return AnimWing != WantWing || AnimRoom != WantRoom
		|| WingAlpha != (WantWing.IsEmpty() ? 0.f : 1.f) || RoomAlpha != (WantRoom.IsEmpty() ? 0.f : 1.f);
}

void ABpTable::ResetLevels()
{
	Level = EBpLevel::L0;
	WingId.Reset();
	RoomId.Reset();
	AnimWing.Reset();
	AnimRoom.Reset();
	WingAlpha = RoomAlpha = 0.f;
	AnimWingScale = 1.f;
	AnimWingCentre = AnimWingSlide = FVector::ZeroVector;
	LiftedRoom = INDEX_NONE;
	LiftedRoomSlideCm = 0.f;
	LiftedShell->ClearInstances();
	HighlightKind.Reset();
	HighlightId.Reset();
	// Unknown, so the first ApplyLevelVisuals writes every instance's Show and redraws the sheet.
	ShownRooms.Init(-1.f, Rooms->GetInstanceCount());
	ShownBays.Init(-1.f, Bays->GetInstanceCount());
	ShownTiles.Init(-1.f, Tiles->GetInstanceCount());
	ShownRest.Init(-1.f, RestVolumes->GetInstanceCount());
	SheetDimWing = TEXT("-");
	ApplyLevelVisuals();
	SetActorTickInterval(0.25f);
}

void ABpTable::KickLevels()
{
	// Start at once (and finish at once under bp.ReducedMotion 1); the tick carries an easing on.
	AdvanceLevels(0.f);
	ApplyLevelVisuals();
	SetActorTickInterval(IsLevelMoving() ? 0.f : 0.25f);
}

bool ABpTable::AdvanceLevels(float DeltaSeconds)
{
	float Budget = CVarReducedMotion.GetValueOnGameThread() != 0 ? UE_BIG_NUMBER : DeltaSeconds / LevelEaseS;
	const FString WantWing = Level != EBpLevel::L0 ? WingId : FString();
	const FString WantRoom = Level == EBpLevel::L2 ? RoomId : FString();
	// Spend the step's budget in order: an unwanted room comes down, then an unwanted wing; a wanted wing goes up, then
	// a wanted room. So going back retraces going in, and a jump between wings passes through L0.
	const auto Down = [&Budget](float& Alpha, FString& Anim)
	{
		if (Budget >= Alpha) { Budget -= Alpha; Alpha = 0.f; Anim.Reset(); }
		else { Alpha -= Budget; Budget = 0.f; }
	};
	const auto Up = [&Budget](float& Alpha)
	{
		if (Budget >= 1.f - Alpha) { Budget -= 1.f - Alpha; Alpha = 1.f; }
		else { Alpha += Budget; Budget = 0.f; }
	};
	for (int32 Guard = 0; Guard < 8; ++Guard)
	{
		if (!AnimRoom.IsEmpty() && (AnimRoom != WantRoom || AnimWing != WantWing))
		{
			if (Budget <= 0.f && RoomAlpha > 0.f) break;
			Down(RoomAlpha, AnimRoom);
			continue;
		}
		if (!AnimWing.IsEmpty() && AnimWing != WantWing)
		{
			if (Budget <= 0.f && WingAlpha > 0.f) break;
			Down(WingAlpha, AnimWing);
			continue;
		}
		if (AnimWing.IsEmpty() && !WantWing.IsEmpty())
		{
			// A wing about to rise.
			const FBpPlanWing* Wing = FindWing(WantWing);
			if (!Wing) break;
			AnimWing = WantWing;
			WingAlpha = 0.f;
			WingLift(*Wing, AnimWingScale, AnimWingCentre, AnimWingSlide);
			continue;
		}
		if (!AnimWing.IsEmpty() && WingAlpha < 1.f)
		{
			if (Budget <= 0.f) break;
			Up(WingAlpha);
			continue;
		}
		if (AnimRoom.IsEmpty() && !WantRoom.IsEmpty())
		{
			AnimRoom = WantRoom;
			RoomAlpha = 0.f;
			LiftedRoomSlideCm = RoomSlideCm(AnimRoom);
			continue;
		}
		if (!AnimRoom.IsEmpty() && RoomAlpha < 1.f)
		{
			if (Budget <= 0.f) break;
			Up(RoomAlpha);
			continue;
		}
		break;
	}
	return IsLevelMoving();
}

float ABpTable::RoomSlideCm(const FString& Room) const
{
	// The far-rim clamp (FC1): at full lift, the room's top far edge, seen from the target eye and from the play eye
	// (ABpGameMode's poses), must land on the table RoomLiftRimMarginCm inside the frame's far rim. Where it would not, the
	// room's lift slides it toward the viewer by just enough as it rises (its copy in LiftedShell, and its bays and
	// tiles). Nothing moves in plan space: the instance in Rooms stays where it is.
	const FBpPlanRoom* Node = FindRoom(Room);
	if (!Node || AnimWing.IsEmpty()) return 0.f;
	const FTransform WingT = WingGroupTransform(1.f);
	const FVector2D A = PlanToPaperCm(FVector2D(Node->box.x, Node->box.y));
	const FVector2D B = PlanToPaperCm(FVector2D(Node->box.x + Node->box.w, Node->box.y + Node->box.h));
	const FVector Lift(0.0, 0.0, RoomLiftCm);
	// Paper v is smallest at the far edge, so the box's far edge is its top (A.Y).
	const FVector Far[2] = {
		WingT.TransformPosition(PaperCmToLocal(FVector2D(A.X, A.Y), RoomShellCm)) + Lift,
		WingT.TransformPosition(PaperCmToLocal(FVector2D(B.X, A.Y), RoomShellCm)) + Lift };
	const double PaperZ = PlacedHeightCm - GlassRecessCm;
	const double LimitX = TableDepthCm * 0.5 - RoomLiftRimMarginCm;
	const FVector Eyes[2] = {
		FVector(-(TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0, PlacedHeightCm + ABpGameMode::TargetEyeAboveTopCm),
		FVector(-(TableDepthCm * 0.5 + ABpGameMode::PlayBehindNearEdgeCm), 0.0, ABpGameMode::PlayEyeHeightCm) };
	double Slide = 0.0;
	for (const FVector& Eye : Eyes)
	{
		for (const FVector& P : Far)
		{
			if (Eye.Z <= P.Z + 1.0) continue;
			// Through the eye and the edge onto the paper's plane: x = eye + (p - eye) * k.
			const double K = (Eye.Z - PaperZ) / (Eye.Z - P.Z);
			const double Projected = Eye.X + (P.X - Eye.X) * K;
			if (Projected > LimitX) Slide = FMath::Max(Slide, (P.X - Eye.X) - (LimitX - Eye.X) / K);
		}
	}
	UE_LOG(LogBpTable, Log, TEXT("BpLevel: room %s lift slide_cm=%.1f (far-rim clamp)"), *Room, Slide);
	return static_cast<float>(Slide);
}

void ABpTable::WingLift(const FBpPlanWing& Wing, float& OutScale, FVector& OutCentre, FVector& OutSlide) const
{
	// The fit-to-paper clamp: the lesser of WingLiftScale and what fits the paper less WingLiftMarginCm, then a slide
	// inward until the lifted footprint is on the paper.
	const FVector2D A = PlanToPaperCm(FVector2D(Wing.box.x, Wing.box.y));
	const FVector2D B = PlanToPaperCm(FVector2D(Wing.box.x + Wing.box.w, Wing.box.y + Wing.box.h));
	const FVector2D Size = B - A, Centre = (A + B) * 0.5;
	const FVector2D Room(PaperWidthCm - 2.0 * WingLiftMarginCm, PaperDepthCm - 2.0 * WingLiftMarginCm);
	OutScale = FMath::Max(1.f, static_cast<float>(FMath::Min3<double>(WingLiftScale, Room.X / Size.X, Room.Y / Size.Y)));
	const FVector2D Half = Size * (0.5 * OutScale);
	const FVector2D Lo = Centre - Half, Hi = Centre + Half;
	const FVector2D Slide(
		FMath::Max(0.0, WingLiftMarginCm - Lo.X) - FMath::Max(0.0, Hi.X - (PaperWidthCm - WingLiftMarginCm)),
		FMath::Max(0.0, WingLiftMarginCm - Lo.Y) - FMath::Max(0.0, Hi.Y - (PaperDepthCm - WingLiftMarginCm)));
	const FVector C = PaperCmToLocal(Centre, 0.f);
	OutCentre = FVector(C.X, C.Y, 0.0);
	// Paper u runs along local +Y, v along local -X.
	OutSlide = FVector(-Slide.Y, Slide.X, 0.0);
}

FTransform ABpTable::WingGroupTransform(float E) const
{
	const double PaperZ = PlacedHeightCm - GlassRecessCm;
	if (E <= 0.f || AnimWing.IsEmpty()) return FTransform(FQuat::Identity, FVector(0.0, 0.0, PaperZ), FVector::OneVector);
	// Scale about the footprint's centre on the paper, slide inward by the clamp, rise: p' = C + S (p - C) + slide + lift.
	const double Scale = 1.0 + (AnimWingScale - 1.0) * E;
	const FVector Translation = AnimWingCentre * (1.0 - Scale) + AnimWingSlide * E + FVector(0.0, 0.0, PaperZ + WingLiftCm * E);
	return FTransform(FQuat::Identity, Translation, FVector(Scale));
}

void ABpTable::SetLabelAlpha(UWidgetComponent* Label, float Alpha)
{
	if (!Label) return;
	const float* Was = LabelAlpha.Find(Label);
	if (Was && *Was == Alpha) return;
	const bool bWasShown = Label->IsVisible();
	Label->SetTintColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, Alpha));
	Label->SetVisibility(Alpha > 0.f);
	if (Alpha > 0.f && !bWasShown) Label->RequestRedraw();
	LabelAlpha.Add(Label, Alpha);
}

void ABpTable::ApplyLevelVisuals()
{
	const float Ew = Ease(WingAlpha), Er = Ease(RoomAlpha);
	const FTransform WingT = WingGroupTransform(Ew);
	FTransform RoomT = WingT;
	RoomT.AddToTranslation(FVector(-LiftedRoomSlideCm * Er, 0.0, RoomLiftCm * Er));
	Rooms->SetRelativeTransform(WingT);
	Bays->SetRelativeTransform(RoomT);
	Tiles->SetRelativeTransform(RoomT);
	// Nothing stands at L0, yet the batches stay visible: an instance with Show 0 is folded onto its pivot by M_EdgeGlow's
	// vertex shader and covers no pixel. A batch hidden and shown again lost its custom data on the GPU in UE 5.8 (every
	// instance then read size 0 and Show 0 and nothing drew; Lynx, 2026-10-24), so visibility is never toggled.
	if (!SheetPlan.IsValid()) return;

	// The lifted room: its instance in Rooms never moves (FC1); a copy of it in LiftedShell rides the room's lift, the rise
	// and the far-rim slide toward the viewer (RoomSlideCm), its name with it, and the instance shows 0 meanwhile. The name
	// is put back exactly when the room settles.
	const int32 Lifted = AnimRoom.IsEmpty() ? INDEX_NONE : SheetPlan->rooms.IndexOfByPredicate([this](const FBpPlanRoom& Room) { return Room.id == AnimRoom; });
	const int32 WantLifted = RoomAlpha > 0.f ? Lifted : INDEX_NONE;
	if (LiftedRoom != INDEX_NONE && LiftedRoom != WantLifted)
	{
		LiftedShell->ClearInstances();
		if (RoomLabels.IsValidIndex(LiftedRoom)) RoomLabels[LiftedRoom]->SetRelativeLocation(LiftedRoomLabelRest);
		LiftedRoom = INDEX_NONE;
	}
	if (WantLifted != INDEX_NONE)
	{
		if (LiftedRoom != WantLifted)
		{
			Rooms->GetInstanceTransform(WantLifted, LiftedRoomRest, false);
			if (RoomLabels.IsValidIndex(WantLifted)) LiftedRoomLabelRest = RoomLabels[WantLifted]->GetRelativeLocation();
			LiftedRoom = WantLifted;
			const FVector Size = LiftedRoomRest.GetScale3D() * 100.0;
			LiftedShell->ClearInstances();
			LiftedShell->AddInstance(LiftedRoomRest, false);
			LiftedShell->SetCustomData(0, { static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), 0.f }, true);
		}
		LiftedShell->SetRelativeTransform(RoomT);
		const FVector Rise(-LiftedRoomSlideCm * Er / WingT.GetScale3D().X, 0.0, RoomLiftCm * Er / WingT.GetScale3D().Z);
		if (RoomLabels.IsValidIndex(LiftedRoom)) RoomLabels[LiftedRoom]->SetRelativeLocation(LiftedRoomLabelRest + Rise);
	}

	// Show per instance: the lifted wing's shells fade in as it rises, the lifted room's siblings dim as it rises, and
	// the lifted room's bays and tiles fade in with it.
	const bool bRoomLit = HighlightKind == TEXT("room") && !HighlightId.IsEmpty();
	const auto Write = [](UInstancedStaticMeshComponent* Kind, TArray<float>& Shown, int32 Index, float Value, bool& bDirty)
	{
		if (!Shown.IsValidIndex(Index) || Shown[Index] == Value) return;
		Shown[Index] = Value;
		Kind->SetCustomDataValue(Index, 3, Value, false);
		bDirty = true;
	};
	bool bRoomsDirty = false, bBaysDirty = false, bTilesDirty = false;
	for (int32 Index = 0; Index < SheetPlan->rooms.Num(); ++Index)
	{
		const bool bInWing = !AnimWing.IsEmpty() && RoomWing.IsValidIndex(Index) && RoomWing[Index] == AnimWing;
		float Show = bInWing ? Ew * (Index == Lifted ? 1.f : FMath::Lerp(1.f, LevelDim, Er)) : 0.f;
		if (bRoomLit && SheetPlan->rooms[Index].id == HighlightId) Show *= HighlightShow;
		if (Index == LiftedRoom && LiftedShell->GetInstanceCount() > 0)
		{
			LiftedShell->SetCustomDataValue(0, 3, Show, true);
			Show = 0.f;
		}
		Write(Rooms, ShownRooms, Index, Show, bRoomsDirty);
		if (RoomLabels.IsValidIndex(Index))
		{
			const float Alpha = bInWing ? Ew * (Index == Lifted ? 1.f : FMath::Lerp(1.f, LevelDim, Er)) : 0.f;
			SetLabelAlpha(RoomLabels[Index], Alpha);
		}
	}
	for (int32 Index = 0; Index < SheetPlan->bays.Num(); ++Index)
	{
		const bool bInRoom = Lifted != INDEX_NONE && BayRoom.IsValidIndex(Index) && BayRoom[Index] == Lifted;
		Write(Bays, ShownBays, Index, bInRoom ? Er : 0.f, bBaysDirty);
		if (BayLabels.IsValidIndex(Index))
		{
			SetLabelAlpha(BayLabels[Index], bInRoom && BayNameFits.IsValidIndex(Index) && BayNameFits[Index] ? Er : 0.f);
		}
	}
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
	{
		const bool bInRoom = Lifted != INDEX_NONE && TileRoom.IsValidIndex(Index) && TileRoom[Index] == Lifted;
		Write(Tiles, ShownTiles, Index, bInRoom ? Er : 0.f, bTilesDirty);
	}
	if (bRoomsDirty) Rooms->MarkRenderStateDirty();
	if (bBaysDirty) Bays->MarkRenderStateDirty();
	if (bTilesDirty) Tiles->MarkRenderStateDirty();

	// The rooms at rest stay on the paper; the lifted wing's leave with it. The pins and tags follow the lifts.
	ApplyRestVolumes(Ew);
	PlacePins();

	// The sheet is redrawn only when what it dims around or highlights changes: as a wing starts to rise and once it
	// has settled back, never per frame.
	const FString DimWing = AnimWing;
	const FString LitWing = HighlightKind == TEXT("wing") ? HighlightId : FString();
	if (DimWing != SheetDimWing || LitWing != SheetHighlightWing || Level != SheetLevel)
	{
		SheetLevel = Level;
		SheetDimWing = DimWing;
		SheetHighlightWing = LitWing;
		RedrawSheet();
	}
}

FTransform ABpTable::GroupTransformForRoom(int32 Room) const
{
	const FString Wing = RoomWing.IsValidIndex(Room) ? RoomWing[Room] : FString();
	if (Wing.IsEmpty() || Wing != AnimWing || WingAlpha <= 0.f) return WingGroupTransform(0.f);
	FTransform Group = WingGroupTransform(Ease(WingAlpha));
	if (SheetPlan.IsValid() && SheetPlan->rooms.IsValidIndex(Room) && SheetPlan->rooms[Room].id == AnimRoom && RoomAlpha > 0.f)
	{
		const float Er = Ease(RoomAlpha);
		Group.AddToTranslation(FVector(-LiftedRoomSlideCm * Er, 0.0, RoomLiftCm * Er));
	}
	return Group;
}

FTransform ABpTable::LiftedWingTransform() const
{
	return WingGroupTransform(Ease(WingAlpha));
}

float ABpTable::RoomRiseEase(int32 Room) const
{
	return SheetPlan.IsValid() && SheetPlan->rooms.IsValidIndex(Room) && SheetPlan->rooms[Room].id == AnimRoom ? Ease(RoomAlpha) : 0.f;
}

void ABpTable::ApplyRestVolumes(float WingEase)
{
	const bool bOn = CVarL0VolumesValue() != 0;
	bool bDirty = false;
	for (int32 Index = 0; Index < RestRoom.Num() && Index < ShownRest.Num(); ++Index)
	{
		const int32 Room = RestRoom[Index];
		const FString Wing = RoomWing.IsValidIndex(Room) ? RoomWing[Room] : FString();
		float Show = 0.f;
		if (bOn) Show = AnimWing.IsEmpty() ? 1.f : (Wing == AnimWing ? 1.f - WingEase : FMath::Lerp(1.f, LevelDim, WingEase));
		if (ShownRest[Index] == Show) continue;
		ShownRest[Index] = Show;
		RestVolumes->SetCustomDataValue(Index, 3, Show, false);
		bDirty = true;
	}
	RestVolumes->SetRelativeTransform(WingGroupTransform(0.f));
	if (bDirty) RestVolumes->MarkRenderStateDirty();
}

void ABpTable::RedrawSheet()
{
	if (Sheet) Sheet->UpdateResource();
}

void ABpTable::SetHighlight(const FString& Kind, const FString& Id)
{
	HighlightKind = Id.IsEmpty() ? FString() : Kind.ToLower();
	HighlightId = Id;
	UE_LOG(LogBpTable, Log, TEXT("BpLevel: highlight %s"), HighlightId.IsEmpty() ? TEXT("cleared") : *FString::Printf(TEXT("%s=%s"), *HighlightKind, *HighlightId));
	// Force the rooms' Show to be rewritten.
	for (float& Shown : ShownRooms) Shown = -1.f;
	UpdateBreadcrumb();
	ApplyLevelVisuals();
}

bool ABpTable::HitTest(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutKind, FString& OutId) const
{
	OutKind.Reset();
	OutId.Reset();
	if (!SheetPlan.IsValid() || WorldDir.IsNearlyZero()) return false;
	const FTransform& Actor = GetActorTransform();
	const FVector Origin = Actor.InverseTransformPosition(WorldOrigin), Dir = Actor.InverseTransformVector(WorldDir);
	const auto OnPlane = [&Origin, &Dir](double Z, FVector& Point)
	{
		if (FMath::IsNearlyZero(Dir.Z)) return false;
		const double T = (Z - Origin.Z) / Dir.Z;
		if (T < 0.0) return false;
		Point = Origin + Dir * T;
		return true;
	};
	// A point on a lifted plane, back through its batch's transform to the paper, then to plan space.
	const auto ToPlan = [this](const FTransform& Group, const FVector& Point)
	{
		return PaperCmToPlan(LocalToPaperCm(Group.InverseTransformPosition(Point)));
	};
	const float Ew = Ease(WingAlpha), Er = Ease(RoomAlpha);
	const FTransform WingT = WingGroupTransform(Ew);
	FVector Point;

	// The lifted room's floor, at its current lift.
	if (!AnimRoom.IsEmpty() && RoomAlpha > 0.f)
	{
		FTransform RoomT = WingT;
		RoomT.AddToTranslation(FVector(-LiftedRoomSlideCm * Er, 0.0, RoomLiftCm * Er));
		const FBpPlanRoom* Room = FindRoom(AnimRoom);
		if (Room && OnPlane(RoomT.GetTranslation().Z, Point) && Inside(Room->box, ToPlan(RoomT, Point)))
		{
			OutKind = TEXT("room");
			OutId = AnimRoom;
			return true;
		}
	}
	// The lifted wing's floor: one of its rooms, or the wing between them.
	if (!AnimWing.IsEmpty() && WingAlpha > 0.f && OnPlane(WingT.GetTranslation().Z, Point))
	{
		const FVector2D Plan = ToPlan(WingT, Point);
		for (const FBpPlanRoom& Room : SheetPlan->rooms)
		{
			if (Room.parentId == AnimWing && Room.id != AnimRoom && Inside(Room.box, Plan))
			{
				OutKind = TEXT("room");
				OutId = Room.id;
				return true;
			}
		}
		const FBpPlanWing* Wing = FindWing(AnimWing);
		if (Wing && Inside(Wing->box, Plan))
		{
			OutKind = TEXT("wing");
			OutId = AnimWing;
			return true;
		}
	}
	// The paper: a crumb of the title block, or a wing's footprint.
	if (OnPlane(PlacedHeightCm - GlassRecessCm, Point))
	{
		const FVector2D PaperCm = LocalToPaperCm(Point);
		for (const FCrumb& Crumb : Crumbs)
		{
			if (!Crumb.Id.IsEmpty() && Crumb.PaperCm.IsInside(PaperCm))
			{
				OutKind = TEXT("crumb");
				OutId = Crumb.Id;
				return true;
			}
		}
		const FVector2D Plan = PaperCmToPlan(PaperCm);
		for (const FBpPlanWing& Wing : SheetPlan->wings)
		{
			if (Inside(Wing.box, Plan))
			{
				OutKind = TEXT("wing");
				OutId = Wing.id;
				return true;
			}
		}
	}
	return false;
}

bool ABpTable::AimAt(const FString& Id, FVector& OutWorld) const
{
	if (!SheetPlan.IsValid()) return false;
	// Paper centimetres on a group's plane (the paper, the lifted wing's or the lifted room's) to the world.
	const auto OnGroup = [this, &OutWorld](const FTransform& Group, const FVector2D& PaperCm)
	{
		const FVector Local(PaperDepthCm * 0.5 - PaperCm.Y, PaperCm.X - PaperWidthCm * 0.5, 0.0);
		OutWorld = GetActorTransform().TransformPosition(Group.TransformPosition(Local));
		return true;
	};
	const auto Centre = [](const FBpPlanBox& Box) { return FVector2D(Box.x + Box.w * 0.5, Box.y + Box.h * 0.5); };
	const FTransform AtRest = WingGroupTransform(0.f);
	const FTransform WingT = WingGroupTransform(Ease(WingAlpha));
	for (const FCrumb& Crumb : Crumbs)
	{
		if (Crumb.Id == Id) return OnGroup(AtRest, Crumb.PaperCm.GetCenter());
	}
	if (const FBpPlanRoom* Room = FindRoom(Id))
	{
		if (Room->parentId != AnimWing || WingAlpha <= 0.f) return OnGroup(AtRest, PlanToPaperCm(Centre(Room->box)));
		FTransform Group = WingT;
		if (Id == AnimRoom && RoomAlpha > 0.f) Group.AddToTranslation(FVector(-LiftedRoomSlideCm * Ease(RoomAlpha), 0.0, RoomLiftCm * Ease(RoomAlpha)));
		return OnGroup(Group, PlanToPaperCm(Centre(Room->box)));
	}
	if (const FBpPlanWing* Wing = FindWing(Id))
	{
		return OnGroup(Id == AnimWing && WingAlpha > 0.f ? WingT : AtRest, PlanToPaperCm(Centre(Wing->box)));
	}
	return false;
}
