// The table's levels (lynx-plan L3.4, spark vr-hands-zoom WP3, the owner's "Lift"; BpTable.h declares the API and the
// constants). The entered wing rises off the paper in place and grows about its own centre, the entered room rises a
// further step above it, and the rest of the sheet dims; nothing else moves. Every lift is a transform of a whole batch
// (Rooms, or Bays and Tiles), never of an instance in plan space, so a batch back at rest is where it was, bit for bit.
// What shows is per-instance custom data 3 (Show) on M_EdgeGlow, and each label's opacity.
#include "BpTable.h"

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
	HighlightKind.Reset();
	HighlightId.Reset();
	// Unknown, so the first ApplyLevelVisuals writes every instance's Show and redraws the sheet.
	ShownRooms.Init(-1.f, Rooms->GetInstanceCount());
	ShownBays.Init(-1.f, Bays->GetInstanceCount());
	ShownTiles.Init(-1.f, Tiles->GetInstanceCount());
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
	RoomT.AddToTranslation(FVector(0.0, 0.0, RoomLiftCm * Er));
	Rooms->SetRelativeTransform(WingT);
	Bays->SetRelativeTransform(RoomT);
	Tiles->SetRelativeTransform(RoomT);
	// Nothing stands at L0, yet the batches stay visible: an instance with Show 0 is folded onto its pivot by M_EdgeGlow's
	// vertex shader and covers no pixel. A batch hidden and shown again lost its custom data on the GPU in UE 5.8 (every
	// instance then read size 0 and Show 0 and nothing drew; Lynx, 2026-10-24), so visibility is never toggled.
	if (!SheetPlan.IsValid()) return;

	// The lifted room rises out of its wing's batch by its own instance's height, its name with it, both put back exactly
	// when it settles.
	const int32 Lifted = AnimRoom.IsEmpty() ? INDEX_NONE : SheetPlan->rooms.IndexOfByPredicate([this](const FBpPlanRoom& Room) { return Room.id == AnimRoom; });
	const int32 WantLifted = RoomAlpha > 0.f ? Lifted : INDEX_NONE;
	if (LiftedRoom != INDEX_NONE && LiftedRoom != WantLifted)
	{
		Rooms->UpdateInstanceTransform(LiftedRoom, LiftedRoomRest, false, true);
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
		}
		const FVector Rise(0.0, 0.0, RoomLiftCm * Er / WingT.GetScale3D().Z);
		FTransform Raised = LiftedRoomRest;
		Raised.AddToTranslation(Rise);
		Rooms->UpdateInstanceTransform(LiftedRoom, Raised, false, true);
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

	// The wings' labels on the paper: the others dim with the sheet, the lifted wing's own gives way to its rooms' names.
	for (int32 Index = 0; Index < WingLabels.Num() && Index < WingLabelIds.Num(); ++Index)
	{
		const float Alpha = AnimWing.IsEmpty() ? 1.f : FMath::Lerp(1.f, WingLabelIds[Index] == AnimWing ? 0.f : LevelDim, Ew);
		SetLabelAlpha(WingLabels[Index], Alpha);
	}

	// The sheet is redrawn only when what it dims around or highlights changes: as a wing starts to rise and once it
	// has settled back, never per frame.
	const FString DimWing = AnimWing;
	const FString LitWing = HighlightKind == TEXT("wing") ? HighlightId : FString();
	if (DimWing != SheetDimWing || LitWing != SheetHighlightWing)
	{
		SheetDimWing = DimWing;
		SheetHighlightWing = LitWing;
		RedrawSheet();
	}
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
		RoomT.AddToTranslation(FVector(0.0, 0.0, RoomLiftCm * Er));
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
