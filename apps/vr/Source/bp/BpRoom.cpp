// Room mode (spark vr-room-layers WP1; BpTable.h declares the API and the constants). The person sits still at the studio
// desk and nothing moves but what the paper shows: entering a room cross-fades the paper from the site plan to that room's
// map, its bays as walled cells with a doorway, a kind label per cell, each feature as a flat kit glyph with its name and
// its open findings as amber beads, and the whole site shrinks to a key plan at the paper's near-right corner. The lift
// entry first raises the room as the pointed room's glass column, holds it, then dives. Exit fades back to the site plan
// with the room left pointed. What the map says is the plan's and the store's (the bays, their features and kinds, the
// findings and their tiers); only where a cell stands on the paper is the map's own, a schematic, as a key plan is.
#include "BpTable.h"

#include "BpLink.h"
#include "BpType.h"
#include "CanvasItem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GlobalRenderResources.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/PackageName.h"
#include "Rendering/SlateRenderer.h"

namespace
{
	TAutoConsoleVariable<float> CVarRoomFadeS(
		TEXT("bp.RoomFadeS"),
		ABpTable::RoomFadeS,
		TEXT("Room mode's cross-fade between the site plan and a room's map, in seconds (a mid-transition capture slows it)."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomLiftHoldS(
		TEXT("bp.RoomLiftHoldS"),
		ABpTable::RoomLiftHoldS,
		TEXT("Room mode's lift entry: how long the lifted column holds before the dive, in seconds."),
		ECVF_Default);

	/** BpRoom.Entry: the entry every table's next EnterRoomMode takes. */
	EBpRoomEntry GRoomEntry = EBpRoomEntry::Dive;

	// The sheet's palette (BpTable.cpp's).
	const FLinearColor RoomCyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor RoomPaperInk(FColor(0xF3, 0xE9, 0xD2));
	const FLinearColor RoomAmber(FColor(0xFF, 0xB5, 0x47));

	constexpr double RoomSheetPxPerCm = ABpTable::SheetWidthPx / ABpTable::PaperWidthCm;
	constexpr double RoomSlatePxPerPoint = 96.0 / 72.0;
	/** The breadcrumb's separator and its bottom on the paper (BpTable.cpp's). */
	const TCHAR* const RoomCrumbSeparator = TEXT("  ›  ");
	constexpr double RoomCrumbBottomCm = 74.6;
	/** The drawing's border, as the site plan's. */
	constexpr double RoomBorderInsetCm = 1.2;
	/** A line box is this many ems tall: the cap (0.7 em), the descender (0.2) and a little air. */
	constexpr double RoomLinePitchEm = 1.12;
	/** Inside a slot, the glyph and the text keep this far from its edges. */
	constexpr double RoomSlotPadCm = 0.6;
	/** A cell's header: the kind label's cap with this much paper above and below it. */
	constexpr double RoomHeaderPadCm = 0.9;  // FAH: 0.9 (from 0.6), the kind label clear of the far wall's glow

	/** Ease-in-out, as the levels'. */
	float RoomEase(float Alpha)
	{
		return Alpha * Alpha * (3.f - 2.f * Alpha);
	}

	FVector2D RoomMeasure(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return FVector2D(Renderer->GetFontMeasureService()->Measure(Text, Font));
		}
		const double EmPx = Font.Size * RoomSlatePxPerPoint;
		return FVector2D(Text.Len() * 0.533 * EmPx, 1.2 * EmPx);
	}

	/** The sheet's font at a cap height on the paper (its size in sheet pixels, as BpTable.cpp's SheetFont). */
	FSlateFontInfo RoomSheetFont(const TCHAR* Style, double CapCm)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), static_cast<float>(CapCm * RoomSheetPxPerCm / (BpType::CapPerEm * RoomSlatePxPerPoint)), FName(Style));
	}

	double RoomTrackPx(const BpType::FRecipe& Recipe, double CapCm)
	{
		return Recipe.TrackEm * CapCm / BpType::CapPerEm * RoomSheetPxPerCm;
	}

	/** A text's width on the paper at a cap (cm), tracking included. */
	double RoomTextWidthCm(const FString& Text, const BpType::FRecipe& Recipe, double CapCm)
	{
		return (RoomMeasure(Text, RoomSheetFont(Recipe.Face, CapCm)).X + RoomTrackPx(Recipe, CapCm) * Text.Len()) / RoomSheetPxPerCm;
	}

	/** The cut a text takes when it does not fit: as many characters as fit, then an ellipsis. */
	FString RoomCutToWidth(const FString& Text, const BpType::FRecipe& Recipe, double CapCm, double MaxCm)
	{
		for (int32 Keep = Text.Len(); Keep > 0; --Keep)
		{
			const FString Cut = Text.Left(Keep).TrimEnd() + BpType::Ellipsis();
			if (RoomTextWidthCm(Cut, Recipe, CapCm) <= MaxCm) return Cut;
		}
		return FString();
	}

	/** Words into at most MaxLines lines of MaxCm at a cap; the last line kept is cut with an ellipsis when words are
	 *  left over (BpType's rule: never smaller, cut instead). */
	TArray<FString> RoomWrap(const FString& Text, const BpType::FRecipe& Recipe, double CapCm, double MaxCm, int32 MaxLines)
	{
		TArray<FString> Lines;
		if (MaxLines <= 0) return Lines;
		TArray<FString> Words;
		Text.ParseIntoArray(Words, TEXT(" "));
		FString Line;
		for (int32 Index = 0; Index < Words.Num(); ++Index)
		{
			const FString Try = Line.IsEmpty() ? Words[Index] : Line + TEXT(" ") + Words[Index];
			if (RoomTextWidthCm(Try, Recipe, CapCm) <= MaxCm)
			{
				Line = Try;
				continue;
			}
			if (Line.IsEmpty())
			{
				// One word wider than the line: cut it.
				Lines.Add(RoomCutToWidth(Words[Index], Recipe, CapCm, MaxCm));
				continue;
			}
			Lines.Add(Line);
			Line = Words[Index];
			if (RoomTextWidthCm(Line, Recipe, CapCm) > MaxCm) Line = RoomCutToWidth(Line, Recipe, CapCm, MaxCm);
		}
		if (!Line.IsEmpty()) Lines.Add(Line);
		if (Lines.Num() > MaxLines)
		{
			// The last line kept takes the rest, cut.
			FString Rest = Lines[MaxLines - 1];
			for (int32 Index = MaxLines; Index < Lines.Num(); ++Index) Rest += TEXT(" ") + Lines[Index];
			Lines.SetNum(MaxLines);
			Lines[MaxLines - 1] = RoomCutToWidth(Rest, Recipe, CapCm, MaxCm);
		}
		return Lines;
	}

	bool RoomIsOpen(const FBpProposal& Proposal)
	{
		return Proposal.status == TEXT("proposed");
	}

	/** Two triangles per quad in sheet pixels, as BpTable.cpp's pen. */
	struct FRoomPen
	{
		TArray<FCanvasUVTri> Tris;

		void Quad(const FVector2D& A, const FVector2D& B, const FVector2D& C, const FVector2D& D, const FLinearColor& Color)
		{
			FCanvasUVTri T;
			T.V0_Color = T.V1_Color = T.V2_Color = Color;
			T.V0_Pos = A; T.V1_Pos = B; T.V2_Pos = C;
			Tris.Add(T);
			T.V0_Pos = A; T.V1_Pos = C; T.V2_Pos = D;
			Tris.Add(T);
		}

		/** A stroke between two paper points (cm), square-capped, WidthPx sheet pixels wide. */
		void Line(const FVector2D& FromCm, const FVector2D& ToCm, float WidthPx, const FLinearColor& Color)
		{
			const FVector2D From = ABpTable::PaperCmToSheetPx(FromCm), To = ABpTable::PaperCmToSheetPx(ToCm);
			const FVector2D Dir = (To - From).GetSafeNormal();
			if (Dir.IsZero()) return;
			const FVector2D Along = Dir * (WidthPx * 0.5f);
			const FVector2D Across(-Along.Y, Along.X);
			Quad(From - Along - Across, To + Along - Across, To + Along + Across, From - Along + Across, Color);
		}

		void Fill(const FVector2D& MinCm, const FVector2D& MaxCm, const FLinearColor& Color)
		{
			const FVector2D A = ABpTable::PaperCmToSheetPx(MinCm), B = ABpTable::PaperCmToSheetPx(MaxCm);
			Quad(A, FVector2D(B.X, A.Y), B, FVector2D(A.X, B.Y), Color);
		}

		void Box(const FBox2D& Cm, float WidthPx, const FLinearColor& Color)
		{
			Line(Cm.Min, FVector2D(Cm.Max.X, Cm.Min.Y), WidthPx, Color);
			Line(FVector2D(Cm.Max.X, Cm.Min.Y), Cm.Max, WidthPx, Color);
			Line(Cm.Max, FVector2D(Cm.Min.X, Cm.Max.Y), WidthPx, Color);
			Line(FVector2D(Cm.Min.X, Cm.Max.Y), Cm.Min, WidthPx, Color);
		}

		/** An arc about a centre (cm) from angle A0 to A1 (radians; 0 along +u, positive toward +v). */
		void Arc(const FVector2D& Centre, double Radius, double A0, double A1, float WidthPx, const FLinearColor& Color)
		{
			constexpr int32 Steps = 24;
			for (int32 Step = 0; Step < Steps; ++Step)
			{
				const double T0 = A0 + (A1 - A0) * Step / Steps, T1 = A0 + (A1 - A0) * (Step + 1) / Steps;
				Line(Centre + Radius * FVector2D(FMath::Cos(T0), FMath::Sin(T0)), Centre + Radius * FVector2D(FMath::Cos(T1), FMath::Sin(T1)), WidthPx, Color);
			}
		}
	};

	/** Runs Fn on every table with a plan; before any has one (-ExecCmds at startup) the command waits for the plan. */
	void WithRoomTables(UWorld* World, const FString& Command, TFunctionRef<void(ABpTable&)> Fn)
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
			UE_LOG(LogBpTable, Log, TEXT("BpRoom: deferred \"%s\" until the plan arrives"), *Command);
		}
	}

	FAutoConsoleCommandWithWorldAndArgs CmdRoomEnter(
		TEXT("BpRoom.Enter"),
		TEXT("BpRoom.Enter <room id>: the paper dives into the room's map (BpRoom.Entry picks dive or lift)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpRoom: usage BpRoom.Enter <room id>"));
				return;
			}
			const FString Id = Args[0];
			WithRoomTables(World, TEXT("BpRoom.Enter ") + Id, [&Id](ABpTable& Table) { Table.EnterRoomMode(Id); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdRoomExit(
		TEXT("BpRoom.Exit"),
		TEXT("BpRoom.Exit: the paper fades back to the site plan, the room left pointed."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			WithRoomTables(World, TEXT("BpRoom.Exit"), [](ABpTable& Table) { Table.ExitRoomMode(); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdRoomNext(
		TEXT("BpRoom.Next"),
		TEXT("BpRoom.Next: room mode switches to the next room by urgency (T0 and T1 findings, then open findings, then plan order), as the queue's end and the lamp offer it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			WithRoomTables(World, TEXT("BpRoom.Next"), [](ABpTable& Table) { Table.SwitchToNextRoom(); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdRoomLasso(
		TEXT("BpRoom.Lasso"),
		TEXT("BpRoom.Lasso <feature id>...: draws a loop round those features' glyphs on the room's map (over bp.LassoDrawS) and closes it as a hand's lasso: the open findings inside go into the draft wave (never dispatched)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpRoom: usage BpRoom.Lasso <feature id>..."));
				return;
			}
			WithRoomTables(World, TEXT("BpRoom.Lasso ") + FString::Join(Args, TEXT(" ")), [&Args](ABpTable& Table) { Table.LassoFeatures(Args); });
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdRoomEntry(
		TEXT("BpRoom.Entry"),
		TEXT("BpRoom.Entry dive|lift: how the next BpRoom.Enter goes in (dive: the paper cross-fades; lift: the room lifts as a glass column, holds, then dives)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString Which = Args.Num() > 0 ? Args[0].ToLower() : FString();
			if (Which != TEXT("dive") && Which != TEXT("lift"))
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpRoom: usage BpRoom.Entry dive|lift (now %s)"), ABpTable::GetRoomEntry() == EBpRoomEntry::Lift ? TEXT("lift") : TEXT("dive"));
				return;
			}
			ABpTable::SetRoomEntry(Which == TEXT("lift") ? EBpRoomEntry::Lift : EBpRoomEntry::Dive);
		}));
}

void ABpTable::SetRoomEntry(EBpRoomEntry Entry)
{
	GRoomEntry = Entry;
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: entry %s"), Entry == EBpRoomEntry::Lift ? TEXT("lift") : TEXT("dive"));
}

EBpRoomEntry ABpTable::GetRoomEntry()
{
	return GRoomEntry;
}

float ABpTable::SiteShow() const
{
	return 1.f - RoomEase(FMath::Clamp(RoomFade, 0.f, 1.f));
}

FTransform ABpTable::PointedGroupTransform() const
{
	FTransform Group = WingGroupTransform(0.f);
	Group.SetScale3D(FVector(1.0, 1.0, ColumnScale));
	return Group;
}

void ABpTable::InitRoomMode()
{
	// The overlay that carries the map during the fade: UWidgetComponent's engine material, as the greybox's sheet, under
	// every other translucent thing on the table.
	RoomOverlayMid = UMaterialInstanceDynamic::Create(EngineSheetMaterial, this);
	RoomOverlayMid->SetVectorParameterValue(TEXT("TintColorAndOpacity"), FLinearColor(1.f, 1.f, 1.f, 0.f));
	RoomOverlayMid->SetScalarParameterValue(TEXT("OpacityFromTexture"), 1.f);
	RoomOverlay->SetMaterial(0, RoomOverlayMid);
	RoomOverlay->SetTranslucentSortPriority(-1);
	RoomOverlay->SetVisibility(false);
	// The beads in the pins' amber with their halos (BpMarks' materials).
	const auto Load = [](const TSoftObjectPtr<UMaterialInterface>& Ref) -> UMaterialInterface*
	{
		const FSoftObjectPath Path = Ref.ToSoftObjectPath();
		return Path.IsValid() && FPackageName::DoesPackageExist(Path.GetLongPackageName()) ? Ref.LoadSynchronous() : nullptr;
	};
	if (UMaterialInterface* Body = Load(PinBodyMaterial)) RoomBeads->SetMaterial(0, Body);
	if (UMaterialInterface* Halo = Load(PinHaloMaterial)) RoomHalos->SetMaterial(0, Halo);
	MapWalls->SetNumCustomDataFloats(5);
}

void ABpTable::ResetRoomMode()
{
	const bool bWas = !RoomModeId.IsEmpty() || !ShownRoomMode.IsEmpty();
	RoomModeId.Reset();
	ShownRoomMode.Reset();
	LiftRoomId.Reset();
	RoomFade = 0.f;
	LiftAlpha = LiftHoldClock = 0.f;
	bLiftDone = true;
	ColumnScale = 1.f;
	ClearRoomMap();
	bPaperOnRoomSheet = false;
	AppliedColumnLook = -1.f;
	RoomOverlay->SetVisibility(false);
	if (bWas) RoomModeChanged.Broadcast(FString());
}

bool ABpTable::EnterRoomMode(const FString& InRoomId)
{
	const FBpPlanRoom* Room = FindRoom(InRoomId);
	if (!SheetPlan.IsValid() || !Room)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused %s"), SheetPlan.IsValid() ? *FString::Printf(TEXT("unknown room %s"), *InRoomId) : TEXT("no plan yet"));
		return false;
	}
	if (RoomModeId == InRoomId) return true;
	// The levels come home first (logged step by step); the dive waits for them (AdvanceRoomMode).
	const TCHAR* Names[] = { TEXT("L0"), TEXT("L1"), TEXT("L2") };
	const TCHAR* From = Names[static_cast<int32>(Level)];
	// From the site plan the levels come home; from another room's map (always at L0) it is a switch, not an exit.
	if (RoomModeId.IsEmpty()) Home();
	const bool bSwitch = !RoomModeId.IsEmpty() || !ShownRoomMode.IsEmpty();
	RoomModeId = InRoomId;
	RoomsVisited.Add(InRoomId);
	RoomEntryNow = GRoomEntry;
	LiftAlpha = LiftHoldClock = 0.f;
	LiftRoomId.Reset();
	// A switch from another room's map dives straight in; the lift is the way in from the site plan.
	bLiftDone = RoomEntryNow != EBpRoomEntry::Lift || bSwitch;
	// The column rises from the pointed room's height when the room already stands pointed, else from about its rest
	// walls' (the pointed copy's walls stand RestRoomCm + HighlightRiseCm high).
	LiftFrom = HighlightKind == TEXT("room") && HighlightId == InRoomId ? 1.f : RestRoomCm / (RestRoomCm + HighlightRiseCm);
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: enter %s \"%s\" entry=%s from=%s%s"), *InRoomId, *Room->name, RoomEntryNow == EBpRoomEntry::Lift ? TEXT("lift") : TEXT("dive"),
		From, bSwitch ? TEXT(" (switch)") : TEXT(""));
	RoomModeChanged.Broadcast(RoomModeId);
	// The deck replaces the decision card in room mode (BpDeck.cpp).
	if (bCardShown) RefreshCard();
	ApplyCardVisibility();
	SetActorTickInterval(0.f);
	AdvanceRoomMode(0.f);
	ApplyRoomVisuals();
	return true;
}

void ABpTable::ExitRoomMode()
{
	if (RoomModeId.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused exit, already on the site plan"));
		return;
	}
	const FString Left = RoomModeId;
	RoomModeId.Reset();
	LiftRoomId.Reset();
	ColumnScale = 1.f;
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: exit %s"), *Left);
	RoomModeChanged.Broadcast(FString());
	ApplyCardVisibility();
	// The room left stands as the pointed room as the site plan comes back (FK's raised room, the focal room).
	SetHighlight(TEXT("room"), Left);
	SetActorTickInterval(0.f);
	AdvanceRoomMode(0.f);
	ApplyRoomVisuals();
}

bool ABpTable::IsRoomModeMoving() const
{
	if (!RoomModeId.IsEmpty()) return ShownRoomMode != RoomModeId || RoomFade < 1.f || !LiftRoomId.IsEmpty();
	return !ShownRoomMode.IsEmpty() || RoomFade > 0.f;
}

void ABpTable::AdvanceRoomMode(float DeltaSeconds)
{
	const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
	const bool bInstant = Reduced && Reduced->GetInt() != 0;
	const float Step = bInstant ? 1.f : DeltaSeconds / FMath::Max(CVarRoomFadeS.GetValueOnGameThread(), 0.01f);
	const auto FadeOut = [this, Step]()
	{
		RoomFade = FMath::Max(0.f, RoomFade - Step);
		if (RoomFade > 0.f) return;
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: %s's map is out"), *ShownRoomMode);
		ClearRoomMap();
		ShownRoomMode.Reset();
		if (RoomModeId.IsEmpty()) UE_LOG(LogBpTable, Log, TEXT("BpRoom: back on the site plan"));
	};
	if (RoomModeId.IsEmpty())
	{
		if (!ShownRoomMode.IsEmpty() || RoomFade > 0.f) FadeOut();
		return;
	}
	// Another room's map is out first (a switch).
	if (!ShownRoomMode.IsEmpty() && ShownRoomMode != RoomModeId)
	{
		FadeOut();
		return;
	}
	if (ShownRoomMode.IsEmpty())
	{
		// The levels are home before anything else moves.
		if (Level != EBpLevel::L0 || IsLevelMoving()) return;
		if (!bLiftDone)
		{
			// The lift entry: the room's column rises over LevelEaseS, then holds.
			if (LiftRoomId.IsEmpty())
			{
				LiftRoomId = RoomModeId;
				UE_LOG(LogBpTable, Log, TEXT("BpRoom: lift %s from x%.2f to x%.2f, hold %.2f s"), *LiftRoomId, LiftFrom, RoomLiftColumnScale, CVarRoomLiftHoldS.GetValueOnGameThread());
			}
			if (LiftAlpha < 1.f)
			{
				LiftAlpha = bInstant ? 1.f : FMath::Min(1.f, LiftAlpha + DeltaSeconds / LevelEaseS);
				ColumnScale = FMath::Lerp(LiftFrom, RoomLiftColumnScale, RoomEase(LiftAlpha));
				return;
			}
			LiftHoldClock += DeltaSeconds;
			if (!bInstant && LiftHoldClock < CVarRoomLiftHoldS.GetValueOnGameThread()) return;
			bLiftDone = true;
		}
		ShownRoomMode = RoomModeId;
		BuildRoomMap();
	}
	const float Was = RoomFade;
	RoomFade = FMath::Min(1.f, RoomFade + Step);
	if (RoomFade >= 1.f && Was < 1.f) UE_LOG(LogBpTable, Log, TEXT("BpRoom: in %s (map settled)"), *ShownRoomMode);
	if (RoomFade >= 1.f && !LiftRoomId.IsEmpty())
	{
		// The column went with the site plan.
		LiftRoomId.Reset();
		LiftAlpha = 0.f;
		ColumnScale = 1.f;
	}
}

void ABpTable::ApplyRoomVisuals()
{
	const float E = RoomEase(FMath::Clamp(RoomFade, 0.f, 1.f));
	const float Site = 1.f - E;
	// The paper: the site sheet's ink fades while the overlay brings the map's in; at the end the paper takes the map as
	// its own sheet (its ink path, the hands' shadow over it) and the overlay goes.
	if (bRealPaper && PaperMid)
	{
		const bool bOnRoom = RoomFade >= 1.f && RoomSheet != nullptr;
		if (bOnRoom != bPaperOnRoomSheet && Sheet)
		{
			PaperMid->SetTextureParameterValue(TEXT("Sheet"), bOnRoom ? RoomSheet.Get() : Sheet.Get());
			bPaperOnRoomSheet = bOnRoom;
		}
		if (Sheet) PaperMid->SetScalarParameterValue(TEXT("SheetStrength"), bOnRoom ? 1.f : Site);
	}
	else if (OverlayMid)
	{
		OverlayMid->SetVectorParameterValue(TEXT("TintColorAndOpacity"), FLinearColor(1.f, 1.f, 1.f, Site));
	}
	const bool bOverlay = RoomSheet && RoomOverlayMid && RoomFade > 0.f && (RoomFade < 1.f || !bRealPaper);
	if (RoomOverlay->IsVisible() != bOverlay) RoomOverlay->SetVisibility(bOverlay);
	if (bOverlay) RoomOverlayMid->SetVectorParameterValue(TEXT("TintColorAndOpacity"), FLinearColor(1.f, 1.f, 1.f, E));

	// The map's 3D comes in with it: the walls' and glyphs' Show, the beads' size.
	if (E != AppliedRoomFade)
	{
		AppliedRoomFade = E;
		for (int32 Index = 0; Index < MapWalls->GetInstanceCount(); ++Index) MapWalls->SetCustomDataValue(Index, 3, E * RoomWallShow, false);
		MapWalls->MarkRenderStateDirty();
		// The deck's current feature glows (BpDeck.cpp), its cell lit with it.
		ApplyDeckLight();
		if (RoomBeadPlaces.Num() > 0 && RoomBeads->GetInstanceCount() == RoomBeadPlaces.Num())
		{
			TArray<FTransform> Beads, Halos;
			for (const FTransform& Place : RoomBeadPlaces)
			{
				Beads.Add(FTransform(FQuat::Identity, Place.GetLocation(), Place.GetScale3D() * E));
				Halos.Add(FTransform(FQuat::Identity, Place.GetLocation(), Place.GetScale3D() * (E * PinHaloScale)));
			}
			RoomBeads->BatchUpdateInstancesTransforms(0, Beads, false, true);
			if (RoomHalos->GetInstanceCount() == Halos.Num()) RoomHalos->BatchUpdateInstancesTransforms(0, Halos, false, true);
		}
	}
	// The screen deck comes in with the map.
	ApplyDeckPoses();
	// The site's 3D, labels, pins and the pointed column go through SiteShow; the beam too.
	ApplyLevelVisuals();
	WriteScanParams(ScanStrength);
}

FString ABpTable::RoomFindingsKey() const
{
	// The room, then its open findings and their tiers in store order.
	if (!SheetPlan.IsValid()) return FString();
	const int32 RoomIndex = SheetPlan->rooms.IndexOfByPredicate([this](const FBpPlanRoom& R) { return R.id == ShownRoomMode; });
	FString Key = ShownRoomMode + TEXT("|");
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	TMap<FString, int32> TileOf;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index) TileOf.Add(SheetPlan->tiles[Index].id, Index);
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		const int32* Tile = TileOf.Find(Proposal.feature);
		if (!RoomIsOpen(Proposal) || !Tile || !TileRoom.IsValidIndex(*Tile) || TileRoom[*Tile] != RoomIndex) continue;
		const int32* Tier = State.Tiers.Find(Proposal.id);
		Key += Proposal.id + (Tier ? FString::Printf(TEXT(":%d,"), *Tier) : FString(TEXT(",")));
	}
	return Key;
}

void ABpTable::ClearRoomMap()
{
	MapWalls->ClearInstances();
	RoomBeads->ClearInstances();
	RoomHalos->ClearInstances();
	for (UInstancedStaticMeshComponent* Glyph : RoomGlyphs)
	{
		if (Glyph) Glyph->ClearInstances();
	}
	RoomBeadPlaces.Reset();
	RoomCells.Reset();
	RoomSlots.Reset();
	KeyCells.Reset();
	RoomCrumbs.Reset();
	RoomMapKey.Reset();
	AppliedRoomFade = -1.f;
}

void ABpTable::BuildRoomMap()
{
	ClearRoomMap();
	const FBpPlanRoom* Room = FindRoom(ShownRoomMode);
	if (!SheetPlan.IsValid() || !Room) return;
	RoomMapKey = RoomFindingsKey();
	const FBpPlan& Plan = *SheetPlan;
	const FBpPlanWing* Wing = FindWing(Room->parentId);
	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FBpScanState& State = Link.GetScanState();

	// The room's bays in plan order, each with its features in plan order.
	TArray<int32> RoomBays;
	for (int32 Index = 0; Index < Plan.bays.Num(); ++Index)
	{
		if (Plan.bays[Index].parentId == Room->id) RoomBays.Add(Index);
	}
	RoomBays.StableSort([&Plan](int32 A, int32 B) { return Plan.bays[A].order < Plan.bays[B].order; });
	TMap<FString, int32> BayAt;
	for (int32 Index = 0; Index < RoomBays.Num(); ++Index) BayAt.Add(Plan.bays[RoomBays[Index]].id, Index);
	TArray<TArray<int32>> BayTiles;
	BayTiles.SetNum(RoomBays.Num());
	for (int32 Index = 0; Index < Plan.tiles.Num(); ++Index)
	{
		if (const int32* At = BayAt.Find(Plan.tiles[Index].parentId)) BayTiles[*At].Add(Index);
	}
	for (TArray<int32>& Each : BayTiles) Each.StableSort([&Plan](int32 A, int32 B) { return Plan.tiles[A].order < Plan.tiles[B].order; });
	// Each feature's open findings and the most urgent tier among them (store v4 `tier`; untriaged findings have none).
	TMap<FString, int32> Open, TopTier;
	int32 OpenTotal = 0, Features = 0;
	for (const TArray<int32>& Each : BayTiles) Features += Each.Num();
	TSet<FString> InRoom;
	for (const TArray<int32>& Each : BayTiles)
	{
		for (const int32 Tile : Each) InRoom.Add(Plan.tiles[Tile].id);
	}
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		if (!RoomIsOpen(Proposal) || !InRoom.Contains(Proposal.feature)) continue;
		++Open.FindOrAdd(Proposal.feature);
		++OpenTotal;
		if (const int32* Tier = State.Tiers.Find(Proposal.id))
		{
			int32& Top = TopTier.FindOrAdd(Proposal.feature, *Tier);
			Top = FMath::Min(Top, *Tier);
		}
	}

	// ---- The cells: bays on shelves across the map, features in slots inside them ------------------------------------
	// Each layout gives every bay c columns of slots (at most K across a shelf) and as many rows as its features need,
	// about Rho rows each; bays go onto shelves in plan order. The one whose smallest slot side is largest wins, among
	// those whose slots are RoomSlotMinWidthCm wide or more (a name at the floor needs the width).
	const double W = RoomMapRightCm - RoomMapLeftCm, H = RoomMapBottomCm - RoomMapTopCm;
	const double HeaderGuessCm = 3.2, NearGuessCm = 3.0;
	const int32 NB = FMath::Max(RoomBays.Num(), 1);
	int32 MaxN = 1;
	for (const TArray<int32>& Each : BayTiles) MaxN = FMath::Max(MaxN, Each.Num());
	struct FBayPlace { int32 Cols = 1; int32 Rows = 1; int32 Shelf = 0; };
	TArray<FBayPlace> Best;
	double BestScore = -1.0;
	const int32 KMax = FMath::Max(1, FMath::FloorToInt(W / RoomSlotMinWidthCm));
	const auto ShelfSlotW = [W](int32 BaysOn, int32 Cols) { return (W - (BaysOn - 1) * RoomCellGutterCm - BaysOn * 2.0 * RoomCellPadCm) / FMath::Max(Cols, 1); };
	for (int32 K = 1; K <= KMax; ++K)
	{
		for (int32 Rho = 1; Rho <= MaxN; ++Rho)
		{
			TArray<FBayPlace> Places;
			TArray<int32> ShelfCols, ShelfBays, ShelfRows;
			for (int32 Index = 0; Index < NB; ++Index)
			{
				const int32 N = RoomBays.IsValidIndex(Index) ? FMath::Max(BayTiles[Index].Num(), 1) : 1;
				FBayPlace Place;
				Place.Cols = FMath::Min(K, FMath::DivideAndRoundUp(N, Rho));
				Place.Rows = FMath::DivideAndRoundUp(N, Place.Cols);
				if (ShelfCols.Num() == 0 || ShelfCols.Last() + Place.Cols > K)
				{
					ShelfCols.Add(0);
					ShelfBays.Add(0);
					ShelfRows.Add(0);
				}
				Place.Shelf = ShelfCols.Num() - 1;
				ShelfCols.Last() += Place.Cols;
				ShelfBays.Last() += 1;
				ShelfRows.Last() = FMath::Max(ShelfRows.Last(), Place.Rows);
				Places.Add(Place);
			}
			int32 Rows = 0;
			for (const int32 R : ShelfRows) Rows += R;
			const int32 S = ShelfRows.Num();
			const double SlotH = (H - (S - 1) * RoomCellGutterCm - S * (HeaderGuessCm + NearGuessCm)) / FMath::Max(Rows, 1);
			double MinW = UE_BIG_NUMBER;
			for (int32 Shelf = 0; Shelf < S; ++Shelf) MinW = FMath::Min(MinW, ShelfSlotW(ShelfBays[Shelf], ShelfCols[Shelf]));
			if (MinW < RoomSlotMinWidthCm && !(K == 1 && Best.Num() == 0)) continue;
			const double Score = FMath::Min(SlotH, MinW);
			if (Score > BestScore + 1e-6)
			{
				BestScore = Score;
				Best = Places;
			}
		}
	}
	int32 Shelves = 0;
	for (const FBayPlace& Place : Best) Shelves = FMath::Max(Shelves, Place.Shelf + 1);

	// The shelves top to bottom: a header for the kind labels (its cap at the floor where it stands), the slots, and a near
	// pad the near wall's cover needs. Laid out twice: the floors and the cover move with where the shelves end up.
	const double CentreU = PaperWidthCm * 0.5;
	TArray<double> HeaderCap, NearPad;
	// A header holds its label with a pad above and half a cap of paper under it, before the first row's names.
	const auto HeaderH = [](double Cap) { return Cap * 1.5 + 2.0 * RoomHeaderPadCm; };
	HeaderCap.Init(BpType::BayKind.CapCm, Shelves);
	NearPad.Init(NearGuessCm, Shelves);
	TArray<int32> ShelfRows;
	ShelfRows.Init(0, Shelves);
	TArray<int32> ShelfCols, ShelfBays;
	ShelfCols.Init(0, Shelves);
	ShelfBays.Init(0, Shelves);
	for (const FBayPlace& Place : Best)
	{
		ShelfRows[Place.Shelf] = FMath::Max(ShelfRows[Place.Shelf], Place.Rows);
		ShelfCols[Place.Shelf] += Place.Cols;
		ShelfBays[Place.Shelf] += 1;
	}
	int32 TotalRows = 0;
	for (const int32 R : ShelfRows) TotalRows += R;
	TArray<double> ShelfTop, SlotH;
	ShelfTop.Init(0.0, Shelves);
	SlotH.Init(0.0, Shelves);
	// A slot is at most RoomSlotAspect times as deep as the narrowest shelf's slots are wide; what that leaves of the map's
	// depth goes RoomMapFarShare to the far side.
	double NarrowestW = UE_BIG_NUMBER;
	for (int32 Shelf = 0; Shelf < Shelves; ++Shelf) NarrowestW = FMath::Min(NarrowestW, ShelfSlotW(ShelfBays[Shelf], ShelfCols[Shelf]));
	for (int32 Pass = 0; Pass < 3; ++Pass)
	{
		double Fixed = (Shelves - 1) * RoomCellGutterCm;
		for (int32 Shelf = 0; Shelf < Shelves; ++Shelf) Fixed += HeaderH(HeaderCap[Shelf]) + NearPad[Shelf];
		const double RowH = FMath::Min((H - Fixed) / FMath::Max(TotalRows, 1), NarrowestW * RoomSlotAspect);
		double V = RoomMapTopCm + FMath::Max(0.0, H - Fixed - RowH * TotalRows) * RoomMapFarShare;
		for (int32 Shelf = 0; Shelf < Shelves; ++Shelf)
		{
			ShelfTop[Shelf] = V;
			SlotH[Shelf] = RowH;
			HeaderCap[Shelf] = FMath::Max(BpType::BayKind.CapCm, TextFloorCm(FVector2D(CentreU, V + RoomHeaderPadCm + HeaderCap[Shelf])));
			const double SlotsEnd = V + HeaderH(HeaderCap[Shelf]) + RowH * ShelfRows[Shelf];
			// The near wall hides the paper behind it from the eye: the slots end that far (and a little) before it.
			NearPad[Shelf] = CoverCm(SlotsEnd + NearPad[Shelf], RoomWallCm) + 0.3;
			V = SlotsEnd + NearPad[Shelf] + RoomCellGutterCm;
		}
	}

	// Cells and slots.
	TArray<double> ShelfU;
	ShelfU.Init(RoomMapLeftCm, Shelves);
	FBox2D Outer(ForceInit);
	const auto KindOf = [&Link, this](const FString& Feature)
	{
		const FString* Found = Link.FindFeatureKind(Feature);
		const FString Kind = Found ? *Found : FString(TEXT("generic"));
		return GlyphMeshes.Contains(Kind) ? Kind : FString(TEXT("generic"));
	};
	TArray<FString> Dropped;
	for (int32 Index = 0; Index < RoomBays.Num() && Index < Best.Num(); ++Index)
	{
		const FBayPlace& Place = Best[Index];
		const FBpPlanBay& Bay = Plan.bays[RoomBays[Index]];
		const double SW = ShelfSlotW(ShelfBays[Place.Shelf], ShelfCols[Place.Shelf]);
		const double Top = ShelfTop[Place.Shelf];
		const double Header = HeaderH(HeaderCap[Place.Shelf]);
		const double Inner = SlotH[Place.Shelf] * ShelfRows[Place.Shelf];
		const double CellW = Place.Cols * SW + 2.0 * RoomCellPadCm;
		FRoomCell Cell;
		Cell.Bay = RoomBays[Index];
		Cell.Box = FBox2D(FVector2D(ShelfU[Place.Shelf], Top), FVector2D(ShelfU[Place.Shelf] + CellW, Top + Header + Inner + NearPad[Place.Shelf]));
		ShelfU[Place.Shelf] += CellW + RoomCellGutterCm;
		Outer += Cell.Box;
		// The kind label (the bay's name: `<capability>.<kind>`'s kind as the plan names it) in the header, cut to the cell.
		Cell.LabelCap = HeaderCap[Place.Shelf];
		const FString Label = Bay.name.ToUpper();
		const double LabelMax = CellW - 2.0 * RoomCellPadCm;
		Cell.Label = RoomTextWidthCm(Label, BpType::BayKind, Cell.LabelCap) <= LabelMax ? Label : RoomCutToWidth(Label, BpType::BayKind, Cell.LabelCap, LabelMax);
		Cell.LabelAt = FVector2D(Cell.Box.Min.X + RoomCellPadCm, Top + RoomHeaderPadCm);
		// The doorway: in the near wall, centred.
		const double Mid = Cell.Box.GetCenter().X;
		Cell.Door0 = Mid - RoomDoorCm * 0.5;
		Cell.Door1 = Mid + RoomDoorCm * 0.5;
		UE_LOG(LogBpTable, Log, TEXT("BpType: room-kind \"%s\" cap_cm=%.2f at=(%.1f,%.1f)"), *Cell.Label, Cell.LabelCap, Cell.LabelAt.X, Cell.LabelAt.Y + Cell.LabelCap);
		RoomCells.Add(Cell);

		// The bay's features, row by row; a bay with fewer rows than its shelf takes taller slots.
		const double BayRowH = Inner / FMath::Max(Place.Rows, 1);
		for (int32 At = 0; At < BayTiles[Index].Num(); ++At)
		{
			const int32 TileIndex = BayTiles[Index][At];
			const FBpPlanTile& Tile = Plan.tiles[TileIndex];
			const int32 Col = At % Place.Cols, Row = At / Place.Cols;
			FRoomSlot Slot;
			Slot.Tile = TileIndex;
			Slot.Kind = KindOf(Tile.id);
			const double U0 = Cell.Box.Min.X + RoomCellPadCm + Col * SW, V0 = Top + Header + Row * BayRowH;
			Slot.Box = FBox2D(FVector2D(U0, V0), FVector2D(U0 + SW, V0 + BayRowH));
			const double SlotW = SW - 2.0 * RoomSlotPadCm, SlotHt = BayRowH - 2.0 * RoomSlotPadCm;
			// A tall slot sets its glyph over its name, a wide one beside it.
			double TU0, TU1, TV0;
			const double TV1 = V0 + BayRowH - RoomSlotPadCm;
			Slot.bCentre = BayRowH >= 0.7 * SW;
			// The glyph keeps off what stands farther than it: from the eye, its height hides the paper behind it (the kind
			// label, the row behind), so it starts that cover nearer.
			const double GlyphGap = CoverCm(V0 + RoomSlotPadCm, RoomGlyphMaxCm + RoomBeadCm);
			if (Slot.bCentre)
			{
				const double GH = FMath::Min(SlotHt * 0.5 - GlyphGap, SlotW * 0.75);
				Slot.GlyphBox = FBox2D(FVector2D(U0 + RoomSlotPadCm, V0 + RoomSlotPadCm + GlyphGap), FVector2D(U0 + SW - RoomSlotPadCm, V0 + RoomSlotPadCm + GlyphGap + GH));
				TU0 = U0 + RoomSlotPadCm;
				TU1 = U0 + SW - RoomSlotPadCm;
				TV0 = V0 + RoomSlotPadCm + GlyphGap + GH + 0.6;
			}
			else
			{
				const double GS = FMath::Max(0.5, FMath::Min(SlotHt - GlyphGap, SlotW * 0.32));
				Slot.GlyphBox = FBox2D(FVector2D(U0 + RoomSlotPadCm, V0 + RoomSlotPadCm + GlyphGap), FVector2D(U0 + RoomSlotPadCm + GS, V0 + RoomSlotPadCm + GlyphGap + GS));
				TU0 = U0 + RoomSlotPadCm + GS + 0.8;
				TU1 = U0 + SW - RoomSlotPadCm;
				TV0 = V0 + RoomSlotPadCm;
			}
			// The name at its recipe's cap, raised to BpType's floor where it stands; where it does not fit the slot whole, the
			// cap steps down toward the floor (never under it), then the name is cut. The findings' line in amber under it.
			double Floor = BpType::FeatureName.CapCm;
			for (int32 Pass = 0; Pass < 3; ++Pass) Floor = TextFloorCm(FVector2D(FMath::Clamp(CentreU, TU0, TU1), TV0 + Floor));
			Slot.Findings = Open.FindRef(Tile.id);
			double OpenCap = 0.0;
			double OpenH = 0.0;
			if (Slot.Findings > 0)
			{
				OpenCap = BpType::OpenCount.CapCm;
				for (int32 Pass = 0; Pass < 3; ++Pass) OpenCap = FMath::Max(BpType::OpenCount.CapCm, TextFloorCm(FVector2D(FMath::Clamp(CentreU, TU0, TU1), TV1 - OpenCap * 0.3)));
				OpenH = OpenCap / BpType::CapPerEm * RoomLinePitchEm;
			}
			const auto LinesAt = [&](double C) { return FMath::Max(0, FMath::FloorToInt((TV1 - TV0 - OpenH - C * (1.0 + BpType::DescPerEm / BpType::CapPerEm)) / (C / BpType::CapPerEm * RoomLinePitchEm)) + 1); };
			double Cap = FMath::Max(BpType::FeatureName.CapCm, Floor);
			for (; Cap > Floor; Cap = FMath::Max(Cap - 0.05, Floor))
			{
				const TArray<FString> Whole = RoomWrap(Tile.name, BpType::FeatureName, Cap, TU1 - TU0, 64);
				if (Whole.Num() <= LinesAt(Cap) && !FString::Join(Whole, TEXT(" ")).Contains(BpType::Ellipsis())) break;
			}
			const double Pitch = Cap / BpType::CapPerEm * RoomLinePitchEm;
			Slot.Cap = Cap;
			Slot.Lines = RoomWrap(Tile.name, BpType::FeatureName, Cap, TU1 - TU0, LinesAt(Cap));
			Slot.TextAt = FVector2D(TU0, TV0);
			if (Slot.Lines.Num() == 0) Dropped.Add(Tile.id);
			if (Slot.Findings > 0)
			{
				const int32* Tier = TopTier.Find(Tile.id);
				const FString Count = FString::Printf(TEXT("%d OPEN"), Slot.Findings);
				const FString Full = Tier ? FString::Printf(TEXT("%s  ·  T%d"), *Count, *Tier) : Count;
				Slot.Open = RoomTextWidthCm(Full, BpType::OpenCount, OpenCap) <= TU1 - TU0 ? Full : Count;
				Slot.OpenCap = OpenCap;
				Slot.OpenAt = FVector2D(TU0, TV0 + Slot.Lines.Num() * Pitch + 0.15);
			}
			UE_LOG(LogBpTable, Log, TEXT("BpType: room-feature \"%s\" lines=%d cap_cm=%.2f floor_cm=%.2f at=(%.1f,%.1f) slot=%.1fx%.1f%s"), *Tile.name, Slot.Lines.Num(), Cap, Floor, TU0, TV0 + Cap,
				SW, BayRowH, Slot.Lines.Num() == 0 ? TEXT(" dropped") : TEXT(""));
			RoomSlots.Add(Slot);
		}
	}

	// ---- The map's 3D: the cells' low walls with a doorway, each feature's glyph lying flat, its findings' beads -------
	{
		TArray<FTransform> Walls;
		TArray<float> Data;
		const auto Wall = [&](const FVector2D& A, const FVector2D& B)
		{
			// A segment of wall between two paper points along u or v, RoomWallThickCm thick (paper u runs along +Y, v along -X).
			const FVector2D Lo(FMath::Min(A.X, B.X) - RoomWallThickCm * 0.5, FMath::Min(A.Y, B.Y) - RoomWallThickCm * 0.5);
			const FVector2D Hi(FMath::Max(A.X, B.X) + RoomWallThickCm * 0.5, FMath::Max(A.Y, B.Y) + RoomWallThickCm * 0.5);
			const FVector Size(Hi.Y - Lo.Y, Hi.X - Lo.X, RoomWallCm);
			Walls.Add(FTransform(FQuat::Identity, PaperCmToLocal((Lo + Hi) * 0.5, RoomWallCm * 0.5f), Size / 100.0));
			Data.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), 0.f, 1.f });
		};
		for (const FRoomCell& Cell : RoomCells)
		{
			const FVector2D A = Cell.Box.Min, B = Cell.Box.Max;
			Wall(A, FVector2D(B.X, A.Y));
			Wall(A, FVector2D(A.X, B.Y));
			Wall(FVector2D(B.X, A.Y), B);
			Wall(FVector2D(A.X, B.Y), FVector2D(Cell.Door0, B.Y));
			Wall(FVector2D(Cell.Door1, B.Y), B);
		}
		MapWalls->SetNumCustomDataFloats(5);
		if (Walls.Num() > 0)
		{
			MapWalls->AddInstances(Walls, false, false, false);
			MapWalls->SetCustomData(0, Walls.Num() - 1, Data, true);
		}
		MapWalls->SetRelativeTransform(WingGroupTransform(0.f));
	}
	TMap<FString, TArray<FTransform>> GlyphPlaces;
	TArray<FTransform> Beads;
	for (FRoomSlot& Slot : RoomSlots)
	{
		const TSoftObjectPtr<UStaticMesh>* Ref = GlyphMeshes.Find(Slot.Kind);
		const FSoftObjectPath Path = Ref ? Ref->ToSoftObjectPath() : FSoftObjectPath();
		UStaticMesh* Mesh = Path.IsValid() && FPackageName::DoesPackageExist(Path.GetLongPackageName()) ? Ref->LoadSynchronous() : nullptr;
		double TopCm = 0.0;
		const FVector2D Centre = Slot.GlyphBox.GetCenter();
		if (Mesh)
		{
			// The kit's glyph (pivot its base centre, standing +Z) flat on the slot: its long side along the box's, at most
			// GlyphFill of the box and RoomGlyphSpanCm across, at most RoomGlyphMaxCm high (a plan symbol, not a model).
			const FBox Bounds = Mesh->GetBoundingBox();
			const FVector Size = Bounds.GetSize();
			const double Long = FMath::Max(FMath::Max(Size.X, Size.Y), 0.01), Short = FMath::Max(FMath::Min(Size.X, Size.Y), 0.01);
			const FVector2D Box = Slot.GlyphBox.GetSize();
			const double BoxLong = FMath::Max(Box.X, Box.Y), BoxShort = FMath::Min(Box.X, Box.Y);
			// A box wider than deep has its long side along the paper's u (the actor's +Y).
			const bool bTurn = (Size.X > Size.Y) == (Box.X >= Box.Y);
			const double Flat = FMath::Min3(GlyphFill * BoxLong / Long, GlyphFill * BoxShort / Short, RoomGlyphSpanCm / Long);
			const double Tall = FMath::Min(Flat, RoomGlyphMaxCm / FMath::Max(Size.Z, 0.01));
			const FRotator Yaw(0.f, bTurn ? 90.f : 0.f, 0.f);
			const FVector Offset(Bounds.GetCenter().X * Flat, Bounds.GetCenter().Y * Flat, 0.0);
			Slot.GlyphInstance = GlyphPlaces.FindOrAdd(Slot.Kind).Add(FTransform(Yaw, PaperCmToLocal(Centre, 0.f) - Yaw.RotateVector(Offset), FVector(Flat, Flat, Tall)));
			TopCm = Size.Z * Tall;
		}
		// Its open findings: up to RoomBeadsMax beads in a row over the glyph (the line under the name counts them all).
		const int32 Count = FMath::Min(Slot.Findings, RoomBeadsMax);
		for (int32 Bead = 0; Bead < Count; ++Bead)
		{
			const double U = Centre.X + (Bead - (Count - 1) * 0.5) * RoomBeadCm * 1.5;
			Beads.Add(FTransform(FQuat::Identity, PaperCmToLocal(FVector2D(U, Centre.Y), static_cast<float>(TopCm + RoomBeadCm * 0.5 + 0.1)), FVector(RoomBeadCm * 0.5)));
		}
	}
	for (TPair<FString, TArray<FTransform>>& Pair : GlyphPlaces)
	{
		int32 Batch = RoomGlyphKinds.IndexOfByKey(Pair.Key);
		if (Batch == INDEX_NONE)
		{
			UStaticMesh* Mesh = GlyphMeshes[Pair.Key].LoadSynchronous();
			UInstancedStaticMeshComponent* Glyph = NewObject<UInstancedStaticMeshComponent>(this, MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), FName(*FString::Printf(TEXT("RoomGlyphs_%s"), *Pair.Key))));
			Glyph->SetupAttachment(Root);
			Glyph->SetMobility(EComponentMobility::Movable);
			Glyph->SetStaticMesh(Mesh);
			Glyph->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Glyph->SetCastShadow(false);
			Glyph->NumCustomDataFloats = 1;
			for (int32 Slot = 0; Slot < Mesh->GetStaticMaterials().Num(); ++Slot) Glyph->SetMaterial(Slot, GlyphMid);
			Glyph->RegisterComponent();
			Batch = RoomGlyphs.Add(Glyph);
			RoomGlyphKinds.Add(Pair.Key);
		}
		UInstancedStaticMeshComponent* Glyph = RoomGlyphs[Batch];
		Glyph->AddInstances(Pair.Value, false, false, false);
		TArray<float> Show;
		Show.Init(0.f, Pair.Value.Num());
		Glyph->SetCustomData(0, Show.Num() - 1, Show, true);
		Glyph->SetRelativeTransform(WingGroupTransform(0.f));
	}
	RoomBeadPlaces = Beads;
	if (Beads.Num() > 0)
	{
		TArray<FTransform> Folded;
		for (const FTransform& Place : Beads) Folded.Add(FTransform(FQuat::Identity, Place.GetLocation(), FVector::ZeroVector));
		RoomBeads->AddInstances(Folded, false, false, false);
		RoomHalos->AddInstances(Folded, false, false, false);
	}
	RoomBeads->SetRelativeTransform(WingGroupTransform(0.f));
	RoomHalos->SetRelativeTransform(WingGroupTransform(0.f));

	// ---- The title block, the breadcrumb, the key plan ---------------------------------------------------------------
	const FString Product = Link.GetProductName().IsEmpty() ? Link.GetProductSlug() : Link.GetProductName();
	RoomTitle = FString::Printf(TEXT("ROOM PLAN — %s"), *Room->name.ToUpper());
	RoomSubtitle = FString::Printf(TEXT("WING %s  ·  %d %s  ·  %d %s  ·  %d OPEN %s"), Wing ? *Wing->letter : TEXT("?"), RoomBays.Num(), RoomBays.Num() == 1 ? TEXT("BAY") : TEXT("BAYS"),
		Features, Features == 1 ? TEXT("FEATURE") : TEXT("FEATURES"), OpenTotal, OpenTotal == 1 ? TEXT("FINDING") : TEXT("FINDINGS"));
	TArray<TPair<FString, FString>> Items;
	Items.Emplace(TEXT("home"), Product);
	if (Wing) Items.Emplace(TEXT("wing:") + Wing->id, Wing->letter + TEXT(" ") + Wing->name);
	Items.Emplace(TEXT("room:") + Room->id, Room->name);
	LayoutCrumbs(Items, RoomCrumbRightCm, RoomCrumbBottomCm, RoomCrumbs);
	// The key plan: the site's extent fitted into its corner under its label, each room a cell tagged with its id.
	const double KeyLabelCap = FMath::Max(BpType::TitleSub.CapCm, TextFloorCm(FVector2D(KeyPlanLeftCm, KeyPlanTopCm + 1.0)));
	const FBox2D KeyArea(FVector2D(KeyPlanLeftCm + 0.6, KeyPlanTopCm + KeyLabelCap + 1.2), FVector2D(KeyPlanRightCm - 0.6, KeyPlanBottomCm - 0.6));
	const double KeyScale = FMath::Min(KeyArea.GetSize().X / FMath::Max(PlanSize.X, 1.0), KeyArea.GetSize().Y / FMath::Max(PlanSize.Y, 1.0));
	const FVector2D KeyOrigin = KeyArea.GetCenter() - PlanSize * (KeyScale * 0.5);
	const auto KeyBox = [&](const FBpPlanBox& Box)
	{
		return FBox2D(KeyOrigin + (FVector2D(Box.x, Box.y) - PlanMin) * KeyScale, KeyOrigin + (FVector2D(Box.x + Box.w, Box.y + Box.h) - PlanMin) * KeyScale);
	};
	KeyPlanBox = FBox2D(KeyOrigin, KeyOrigin + PlanSize * KeyScale);
	for (const FBpPlanRoom& Each : Plan.rooms) KeyCells.Add({ Each.id, KeyBox(Each.box) });

	UE_LOG(LogBpTable, Log, TEXT("BpRoom: map %s: bays=%d features=%d open=%d shelves=%d slots=%d (smallest side %.1f cm) dropped=%d walls=%d glyphs=%d beads=%d key plan %.1f x %.1f cm"),
		*Room->id, RoomBays.Num(), Features, OpenTotal, Shelves, RoomSlots.Num(), BestScore, Dropped.Num(), MapWalls->GetInstanceCount(), RoomSlots.Num(), Beads.Num(),
		KeyPlanBox.GetSize().X, KeyPlanBox.GetSize().Y);

	// The map's sheet: drawn once now (the render target's update calls DrawRoomSheet).
	if (!RoomSheet)
	{
		RoomSheet = NewObject<UCanvasRenderTarget2D>(this);
		RoomSheet->ClearColor = FLinearColor::Transparent;
		RoomSheet->RenderTargetFormat = RTF_RGBA8;
		RoomSheet->bAutoGenerateMips = true;
		RoomSheet->MipsSamplerFilter = TF_Trilinear;
		RoomSheet->Filter = TF_Default;
		RoomSheet->OnCanvasRenderTargetUpdate.AddDynamic(this, &ABpTable::DrawRoomSheet);
		RoomSheet->InitAutoFormat(SheetWidthPx, SheetHeightPx);
		if (RoomOverlayMid) RoomOverlayMid->SetTextureParameterValue(TEXT("SlateUI"), RoomSheet);
	}
	else
	{
		RoomSheet->UpdateResource();
	}
	if (bPaperOnRoomSheet && PaperMid) PaperMid->SetTextureParameterValue(TEXT("Sheet"), RoomSheet);
	AppliedRoomFade = -1.f;
	ApplyRoomVisuals();
}

void ABpTable::DrawRoomSheet(UCanvas* Canvas, int32 Width, int32 Height)
{
	if (!Canvas || !SheetPlan.IsValid() || ShownRoomMode.IsEmpty()) return;
	if (Canvas->Canvas) Canvas->Canvas->SetWriteDestinationAlpha(true);
	FRoomPen Pen;
	struct FInk { FString Text; FVector2D Px; FSlateFontInfo Font; FLinearColor Color; float Tracking; };
	TArray<FInk> Texts;
	/** Text with its cap's top at CapTopV and its left at U. */
	const auto Put = [&Texts](const FString& Text, const BpType::FRecipe& Recipe, double U, double CapTopV, double CapCm, const FLinearColor& Color)
	{
		const double Top = CapTopV - (BpType::AscPerEm - BpType::CapPerEm) * (CapCm / BpType::CapPerEm);
		Texts.Add({ Text, PaperCmToSheetPx(FVector2D(U, Top)), RoomSheetFont(Recipe.Face, CapCm), Color, static_cast<float>(RoomTrackPx(Recipe, CapCm)) });
		return RoomTextWidthCm(Text, Recipe, CapCm);
	};

	// The room's outline round its cells, the strongest line (the site plan's wing outline, glow and all).
	FBox2D Outer(ForceInit);
	for (const FRoomCell& Cell : RoomCells) Outer += Cell.Box;
	if (Outer.bIsValid)
	{
		Outer = Outer.ExpandBy(RoomCellGutterCm * 0.5);
		Pen.Fill(Outer.Min, Outer.Max, RoomCyan.CopyWithNewOpacity(0.04f));
		Pen.Box(Outer, 34.f, RoomCyan.CopyWithNewOpacity(0.06f));
		Pen.Box(Outer, 16.f, RoomCyan.CopyWithNewOpacity(0.14f));
		Pen.Box(Outer, 7.f, RoomCyan);
	}
	// Each cell: a faint floor, its walls as solid poché with the doorway in the near wall, the door's leaf and swing, the
	// kind label in its header and a fine rule under it.
	const float WallPx = static_cast<float>(RoomWallThickCm * 1.6 * RoomSheetPxPerCm);
	const FLinearColor WallInk = RoomCyan.CopyWithNewOpacity(0.7f);
	for (const FRoomCell& Cell : RoomCells)
	{
		const FVector2D A = Cell.Box.Min, B = Cell.Box.Max;
		Pen.Fill(A, B, RoomCyan.CopyWithNewOpacity(0.05f));
		Pen.Line(A, FVector2D(B.X, A.Y), WallPx, WallInk);
		Pen.Line(A, FVector2D(A.X, B.Y), WallPx, WallInk);
		Pen.Line(FVector2D(B.X, A.Y), B, WallPx, WallInk);
		Pen.Line(FVector2D(A.X, B.Y), FVector2D(Cell.Door0, B.Y), WallPx, WallInk);
		Pen.Line(FVector2D(Cell.Door1, B.Y), B, WallPx, WallInk);
		// The door hinged at the doorway's left jamb, open into the cell (-v), its swing back to the far jamb.
		const FVector2D Hinge(Cell.Door0, B.Y);
		const double Leaf = Cell.Door1 - Cell.Door0;
		Pen.Line(Hinge, Hinge - FVector2D(0.0, Leaf), 3.f, RoomCyan.CopyWithNewOpacity(0.6f));
		Pen.Arc(Hinge, Leaf, -UE_DOUBLE_HALF_PI, 0.0, 2.f, RoomCyan.CopyWithNewOpacity(0.45f));
		const double RuleV = Cell.LabelAt.Y + Cell.LabelCap + RoomHeaderPadCm * 0.8;
		Pen.Line(FVector2D(A.X + RoomCellPadCm, RuleV), FVector2D(B.X - RoomCellPadCm, RuleV), 2.f, RoomCyan.CopyWithNewOpacity(0.3f));
		Put(Cell.Label, BpType::BayKind, Cell.LabelAt.X, Cell.LabelAt.Y, Cell.LabelCap, RoomCyan.CopyWithNewOpacity(0.95f));
	}
	// Each feature: its slot's fine outline (the site plan's tile cells), its name and its findings' line.
	for (const FRoomSlot& Slot : RoomSlots)
	{
		Pen.Box(Slot.Box.ExpandBy(-0.25), 2.f, RoomCyan.CopyWithNewOpacity(0.16f));
		const double Pitch = Slot.Cap / BpType::CapPerEm * RoomLinePitchEm;
		// A tall slot's text is centred under its glyph, a wide one's starts beside it.
		const double Span = Slot.Box.Max.X - RoomSlotPadCm - Slot.TextAt.X;
		const auto Across = [&Slot, Span](const FString& Text, const BpType::FRecipe& Recipe, double Cap)
		{
			return Slot.TextAt.X + (Slot.bCentre ? (Span - RoomTextWidthCm(Text, Recipe, Cap)) * 0.5 : 0.0);
		};
		for (int32 Line = 0; Line < Slot.Lines.Num(); ++Line)
		{
			Put(Slot.Lines[Line], BpType::FeatureName, Across(Slot.Lines[Line], BpType::FeatureName, Slot.Cap), Slot.TextAt.Y + Line * Pitch, Slot.Cap, RoomPaperInk.CopyWithNewOpacity(0.95f));
		}
		if (!Slot.Open.IsEmpty()) Put(Slot.Open, BpType::OpenCount, Across(Slot.Open, BpType::OpenCount, Slot.OpenCap), Slot.OpenAt.Y, Slot.OpenCap, RoomAmber);
	}

	// The title block under the map, near-left, between the wrist panel below it and the left hand right of it in the
	// target framing: the room's plan, the wing and its counts. Each row as BpType fits it: its recipe's cap raised to the
	// floor, stepping down toward the floor (never under it) to fit the block's width, then cut.
	{
		const double L = RoomTitleLeftCm, Top = RoomMapBottomCm + 2.0;
		const double U0 = L + 1.0, U1 = RoomTitleRightCm - 1.0, MaxW = U1 - U0;
		const auto FitRow = [this, U0, U1, MaxW](const FString& Text, const BpType::FRecipe& Recipe, double CapTop, double& OutCap)
		{
			double Floor = Recipe.CapCm;
			for (int32 Pass = 0; Pass < 3; ++Pass) Floor = TextFloorCm(FVector2D(FMath::Clamp(PaperWidthCm * 0.5, U0, U1), CapTop + Floor));
			for (OutCap = FMath::Max(Recipe.CapCm, Floor); OutCap > Floor && RoomTextWidthCm(Text, Recipe, OutCap) > MaxW; OutCap = FMath::Max(OutCap - 0.05, Floor)) {}
			return RoomTextWidthCm(Text, Recipe, OutCap) <= MaxW ? Text : RoomCutToWidth(Text, Recipe, OutCap, MaxW);
		};
		double TitleCap = 0.0, SubCap = 0.0;
		const double TitleTop = Top + 1.3;
		const FString Title = FitRow(RoomTitle, BpType::Title, TitleTop, TitleCap);
		const double SubTop = TitleTop + TitleCap + 1.0;
		const FString Sub = FitRow(RoomSubtitle, BpType::TitleSub, SubTop, SubCap);
		const double TitleW = Put(Title, BpType::Title, U0, TitleTop, TitleCap, RoomPaperInk);
		const double SubW = Put(Sub, BpType::TitleSub, U0, SubTop, SubCap, RoomCyan.CopyWithNewOpacity(0.9f));
		const double R = U0 + FMath::Max(TitleW, SubW) + 1.0, Bottom = SubTop + SubCap + 1.0;
		const FLinearColor FrameInk = RoomCyan.CopyWithNewOpacity(0.55f);
		Pen.Box(FBox2D(FVector2D(L, Top), FVector2D(R, Bottom)), 3.f, FrameInk);
		Pen.Line(FVector2D(L, SubTop - 0.5), FVector2D(R, SubTop - 0.5), 2.f, FrameInk);
		UE_LOG(LogBpTable, Log, TEXT("BpType: room-title \"%s\" cap_cm=%.2f; room-sub \"%s\" cap_cm=%.2f; block u=%.1f..%.1f v=%.1f..%.1f"), *Title, TitleCap, *Sub, SubCap, L, R, Top, Bottom);
	}

	// The key plan, near-right: the site's wings and rooms small, the room you are in lit.
	{
		const FBox2D KeyFrame(FVector2D(KeyPlanLeftCm, KeyPlanTopCm), FVector2D(KeyPlanRightCm, KeyPlanBottomCm));
		Pen.Box(KeyFrame, 3.f, RoomCyan.CopyWithNewOpacity(0.45f));
		const double Cap = FMath::Max(BpType::TitleSub.CapCm, TextFloorCm(FVector2D(KeyPlanLeftCm, KeyPlanTopCm + 1.0)));
		Put(TEXT("KEY PLAN"), BpType::TitleSub, KeyPlanLeftCm + 0.6, KeyPlanTopCm + 0.6, Cap, RoomCyan.CopyWithNewOpacity(0.9f));
		const double Scale = KeyPlanBox.GetSize().X / FMath::Max(PlanSize.X, 1.0);
		for (const FBpPlanWing& Each : SheetPlan->wings)
		{
			const FBox2D Box(KeyPlanBox.Min + (FVector2D(Each.box.x, Each.box.y) - PlanMin) * Scale, KeyPlanBox.Min + (FVector2D(Each.box.x + Each.box.w, Each.box.y + Each.box.h) - PlanMin) * Scale);
			Pen.Box(Box, 3.f, RoomCyan.CopyWithNewOpacity(0.55f));
		}
		for (const FKeyCell& Cell : KeyCells)
		{
			if (Cell.Room == ShownRoomMode)
			{
				Pen.Fill(Cell.PaperCm.Min, Cell.PaperCm.Max, RoomCyan.CopyWithNewOpacity(0.85f));
				Pen.Box(Cell.PaperCm.ExpandBy(0.15), 4.f, RoomAmber);
			}
			else
			{
				Pen.Box(Cell.PaperCm, 2.f, RoomCyan.CopyWithNewOpacity(0.35f));
			}
		}
	}

	// The border, as the site plan's.
	const double BL = RoomBorderInsetCm, BR = PaperWidthCm - RoomBorderInsetCm, BT = RoomBorderInsetCm, BB = PaperDepthCm - RoomBorderInsetCm;
	Pen.Box(FBox2D(FVector2D(BL, BT), FVector2D(BR, BB)), 3.f, RoomCyan.CopyWithNewOpacity(0.4f));

	if (Pen.Tris.Num() > 0)
	{
		FCanvasTriangleItem Item(Pen.Tris, GWhiteTexture);
		Item.BlendMode = SE_BLEND_AlphaBlend;
		Canvas->DrawItem(Item);
	}
	// The breadcrumb, right-aligned left of the key plan (the hands' way back, WP3).
	const FSlateFontInfo Way = RoomSheetFont(BpType::Crumb.Face, LabelCapHeightCm);
	for (int32 Index = 0; Index < RoomCrumbs.Num(); ++Index)
	{
		const FCrumb& Crumb = RoomCrumbs[Index];
		Texts.Add({ Crumb.Text, PaperCmToSheetPx(Crumb.PaperCm.Min), RoomSheetFont(Crumb.bHere ? TEXT("Bold") : BpType::Crumb.Face, LabelCapHeightCm), RoomPaperInk, 0.f });
		if (Index + 1 < RoomCrumbs.Num()) Texts.Add({ RoomCrumbSeparator, PaperCmToSheetPx(FVector2D(Crumb.PaperCm.Max.X, Crumb.PaperCm.Min.Y)), Way, RoomPaperInk, 0.f });
	}
	if (RoomCrumbs.Num() > 0)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpType: room-crumb \"%s\" u=%.1f..%.1f cap_cm=%.2f floor_cm=%.2f"), *GetBreadcrumb(), RoomCrumbs[0].PaperCm.Min.X, RoomCrumbs.Last().PaperCm.Max.X,
			LabelCapHeightCm, TextFloorCm(FVector2D(RoomCrumbs[0].PaperCm.Min.X, RoomCrumbBottomCm)));
	}
	for (const FInk& Text : Texts)
	{
		FCanvasTextItem Item(Text.Px, FText::FromString(Text.Text), Text.Font, Text.Color);
		Item.HorizSpacingAdjust = Text.Tracking;
		Canvas->DrawItem(Item);
	}
}

bool ABpTable::KeyPlanRoomAt(const FVector2D& PaperCm, FString& OutRoomId) const
{
	OutRoomId.Reset();
	if (RoomModeId.IsEmpty()) return false;
	for (const FKeyCell& Cell : KeyCells)
	{
		if (Cell.PaperCm.IsInside(PaperCm))
		{
			OutRoomId = Cell.Room;
			return true;
		}
	}
	return false;
}

bool ABpTable::RoomModeHit(const FVector2D& PaperCm, FString& OutKind, FString& OutId) const
{
	for (const FCrumb& Crumb : RoomCrumbs)
	{
		if (!Crumb.Id.IsEmpty() && Crumb.PaperCm.IsInside(PaperCm))
		{
			OutKind = TEXT("crumb");
			OutId = Crumb.Id;
			return true;
		}
	}
	if (KeyPlanRoomAt(PaperCm, OutId))
	{
		// WP3: a key plan room is a switch target (a tap or a hold).
		OutKind = TEXT("minimap");
		OutId = TEXT("minimap:") + OutId;
		return true;
	}
	// A feature's slot on the map: a tap brings its screen to the deck's front (BpDeck.cpp).
	for (const FRoomSlot& Slot : RoomSlots)
	{
		if (SheetPlan.IsValid() && SheetPlan->tiles.IsValidIndex(Slot.Tile) && Slot.Box.IsInside(PaperCm))
		{
			OutKind = TEXT("feature");
			OutId = TEXT("feature:") + SheetPlan->tiles[Slot.Tile].id;
			return true;
		}
	}
	// The map's paper between them: where a lasso may start (WP3).
	for (const FRoomCell& Cell : RoomCells)
	{
		if (Cell.Box.ExpandBy(RoomCellGutterCm).IsInside(PaperCm))
		{
			OutKind = TEXT("map");
			OutId = TEXT("map");
			return true;
		}
	}
	return false;
}
