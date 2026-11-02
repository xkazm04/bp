// The build-up (spark onboarding-vr WP-V2; BpTable.h declares the state and the pace): while the open product's adopt job
// runs, the table builds itself from the job's feed (BpLink reads it, FBpBuildupBatch), the way the web's winner B ("the
// outline becomes the building", apps/web/src/buildup/b-outline/engine.ts) does on a page, in the table's own idiom:
//   survey     -> the code areas chalked onto the paper as dashed parcels, sized by files until lines arrive, grouped; the
//                 area the agent touched last glows softly; they recede when the structure lands
//   outline    -> each decided domain typed in the paper's near margin, its capabilities under it, in the order decided
//   structure  -> the plan drawn as the live table draws it (the feed's islands boxes); per wing in order its margin line
//                 flies to the wing, the wing's outline draws itself, and its rooms rise one at a time (the rest walls'
//                 height and Show scalar, at most one room committed a frame), each capability line landing on its room
//   history    -> the final boxes read again (/plan?layout=islands); rooms that moved glide there
//   judging    -> pencil brackets on the batch being judged, its provisional health pencilled, the final reading inked
//   narration  -> the follow caption (what it does, then "next: ..."); the phase strip in the title block
//   done       -> the live plan takes over with the same boxes and the ink fades into it; failed keeps what was drawn
// A past batch (a join mid-run, a switch back) is drawn at its end state at once. Everything 2D is drawn into the sheet's
// one render target, redrawn at most BuildSheetHz while something on it moves: the build-up adds no draw call of its own.
#include "BpTable.h"

#include "BpLink.h"
#include "BpType.h"
#include "CanvasItem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GlobalRenderResources.h"
#include "HAL/IConsoleManager.h"
#include "Misc/PackageName.h"
#include "ProfilingDebugging/CsvProfiler.h"
#include "Rendering/SlateRenderer.h"

// The build-up's columns in a CSV capture (WP-V3): the table's tick, and each heavy piece of a commit.
CSV_DEFINE_CATEGORY(BpBuild, true);

namespace
{
	// The sheet's palette (BpTable.cpp's), and the readings' inks.
	const FLinearColor BuildCyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor BuildPaper(FColor(0xF3, 0xE9, 0xD2));
	const FLinearColor BuildAmber(FColor(0xFF, 0xB5, 0x47));
	const FLinearColor HealthGood(FColor(0x7C, 0xE0, 0xA4));
	const FLinearColor HealthBad(FColor(0xFF, 0x6B, 0x5E));
	const FLinearColor HealthNone(FColor(0x9F, 0xB3, 0xC8));
	FLinearColor HealthInk(const FString& Reading)
	{
		if (Reading == TEXT("good")) return HealthGood;
		if (Reading == TEXT("watch")) return BuildAmber;
		if (Reading == TEXT("bad")) return HealthBad;
		return HealthNone;
	}

	/** The build-up's text classes (BpType's recipes; the floor raises each where it stands). */
	constexpr BpType::FRecipe DomainLine{ TEXT("Bold"), 1.7, 0.04, true };
	constexpr BpType::FRecipe CapabilityLine{ TEXT("Regular"), 1.2, 0.0, false };
	constexpr BpType::FRecipe ParcelName{ TEXT("Regular"), 0.9, 0.06, true };
	constexpr BpType::FRecipe ParcelFigure{ TEXT("Regular"), 0.6, 0.04, true };

	/** Where the survey's parcels lie (the paper's far band, inside what the target framing sees) and the outline's
	 *  margin (its near band, left of the title block): columns of a domain each, up to OutlineCols a row. */
	constexpr double SurveyLeftCm = 15.0, SurveyRightCm = 151.0, SurveyTopCm = 11.5, SurveyBottomCm = 38.5;
	constexpr double ParcelGapCm = 0.35;
	constexpr double OutlineLeftCm = 16.0, OutlineTopCm = 43.0;
	constexpr int32 OutlineCols = 6, OutlineRows = 2;
	constexpr double OutlineColCm = 17.5, OutlineRowCm = 8.6;
	/** Past OutlineRows rows (more than 12 domains, WP-V3) the rows share the same band, the pitch and the type shrinking
	 *  together down to the floor; a row is never shallower than its name line at the floor plus this. */
	constexpr double OutlineRowPadCm = 0.7;
	/** The build-up's title block, near and right of centre, between the hands of the target framing (the right forearm
	 *  covers the paper's near-right corner, where the site plan's own block stands once live). */
	constexpr double BlockLeftCm = 80.0, BlockRightCm = 118.0, BlockBottomCm = 72.4;
	constexpr double BorderInsetCm = 1.2;
	/** A parcel's dashes and a judged batch's brackets. */
	constexpr double DashCm = 0.7, DashGapCm = 0.45;
	constexpr double BracketCm = 1.4, BracketOutCm = 0.6;
	/** The batch being judged (WP-V3: the brackets read faintly at the target pose): a soft pencil wash on its tiles, a
	 *  halo round them, a firm pencil edge and heavier brackets. */
	constexpr float JudgeWashA = 0.26f, JudgeHaloA = 0.10f, JudgeEdgeA = 0.95f;
	constexpr double JudgeHaloCm = 0.55;
	constexpr float JudgeEdgePx = 5.f, JudgeBracketPx = 11.f;
	/** A slice of level labels made in one frame while the build-up spreads its commit (ms). */
	constexpr double LevelLabelSliceMs = 3.0;
	/** A heavy piece longer than this is logged with its frame. */
	constexpr double HeavyLogMs = 6.0;
	/** A room's capability line lands this far inside its room's far-left corner. */
	const FVector2D RoomLandCm(0.6, 1.5);
	constexpr double LitS = 3.0;
	constexpr double ResizeS = 0.8;
	constexpr double GlideS = 0.9;

	const TCHAR* const Phases[] = { TEXT("check"), TEXT("context-map"), TEXT("seed"), TEXT("product-tree"), TEXT("events"), TEXT("measure"), TEXT("judge"), TEXT("register") };
	int32 PhaseAt(const FString& Phase)
	{
		for (int32 Index = 0; Index < UE_ARRAY_COUNT(Phases); ++Index)
		{
			if (Phase == Phases[Index]) return Index;
		}
		return -1;
	}

	bool ReducedMotion()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}

	float Clamp01(double V) { return static_cast<float>(FMath::Clamp(V, 0.0, 1.0)); }
	float EaseInOut(float A) { return A * A * (3.f - 2.f * A); }
	/** How far a step that starts at At and lasts S has come at T (0 before, 1 after). */
	float Progress(double T, double At, double S) { return S <= 0.0 ? (T >= At ? 1.f : 0.f) : Clamp01((T - At) / S); }
	/** A step still under way at T. */
	bool Moving(double T, double At, double S) { return T >= At && T < At + S; }

	FVector2D BuildMeasure(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return FVector2D(Renderer->GetFontMeasureService()->Measure(Text, Font));
		}
		const double EmPx = Font.Size * 96.0 / 72.0;
		return FVector2D(Text.Len() * 0.533 * EmPx, 1.2 * EmPx);
	}
	FSlateFontInfo BuildFont(const TCHAR* Style, double CapCm)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), static_cast<float>(CapCm * ABpTable::SheetPxPerCm() / (BpType::CapPerEm * 96.0 / 72.0)), FName(Style));
	}
	double BuildTrackPx(const BpType::FRecipe& Recipe, double CapCm) { return Recipe.TrackEm * CapCm / BpType::CapPerEm * ABpTable::SheetPxPerCm(); }
	double BuildWidthCm(const FString& Text, const BpType::FRecipe& Recipe, double CapCm)
	{
		return (BuildMeasure(Text, BuildFont(Recipe.Face, CapCm)).X + BuildTrackPx(Recipe, CapCm) * Text.Len()) / ABpTable::SheetPxPerCm();
	}
	FString BuildCut(const FString& Text, const BpType::FRecipe& Recipe, double CapCm, double MaxCm)
	{
		if (BuildWidthCm(Text, Recipe, CapCm) <= MaxCm) return Text;
		FString Cut = Text;
		while (Cut.Len() > 2 && BuildWidthCm(Cut + BpType::Ellipsis(), Recipe, CapCm) > MaxCm) Cut = Cut.LeftChop(1).TrimEnd();
		return Cut.Len() > 2 ? Cut + BpType::Ellipsis() : FString();
	}

	/** Two triangles per quad, in paper cm (BpRoom.cpp's pen), with dashes and partial outlines. */
	struct FBuildPen
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
		void Line(const FVector2D& FromCm, const FVector2D& ToCm, float WidthPx, const FLinearColor& Color)
		{
			const FVector2D From = ABpTable::PaperCmToSheetPx(FromCm), To = ABpTable::PaperCmToSheetPx(ToCm);
			const FVector2D Dir = (To - From).GetSafeNormal();
			if (Dir.IsZero() || Color.A <= 0.f) return;
			const FVector2D Along = Dir * (WidthPx * ABpTable::SheetPxScale() * 0.5f);
			const FVector2D Across(-Along.Y, Along.X);
			Quad(From - Along - Across, To + Along - Across, To + Along + Across, From - Along + Across, Color);
		}
		void Fill(const FVector2D& MinCm, const FVector2D& MaxCm, const FLinearColor& Color)
		{
			if (Color.A <= 0.f) return;
			const FVector2D A = ABpTable::PaperCmToSheetPx(MinCm), B = ABpTable::PaperCmToSheetPx(MaxCm);
			Quad(A, FVector2D(B.X, A.Y), B, FVector2D(A.X, B.Y), Color);
		}
		/** The box's perimeter clockwise from its far-left corner, Drawn of it, solid or dashed. */
		void Perimeter(const FBox2D& Box, float Drawn, float WidthPx, const FLinearColor& Color, bool bDashed)
		{
			const FVector2D C[5] = { Box.Min, FVector2D(Box.Max.X, Box.Min.Y), Box.Max, FVector2D(Box.Min.X, Box.Max.Y), Box.Min };
			double Total = 0.0;
			for (int32 Side = 0; Side < 4; ++Side) Total += FVector2D::Distance(C[Side], C[Side + 1]);
			double Left = Total * FMath::Clamp(Drawn, 0.f, 1.f);
			for (int32 Side = 0; Side < 4 && Left > 0.0; ++Side)
			{
				const double Len = FVector2D::Distance(C[Side], C[Side + 1]);
				if (Len <= 0.0) continue;
				const FVector2D Dir = (C[Side + 1] - C[Side]) / Len;
				const double Take = FMath::Min(Len, Left);
				if (!bDashed) Line(C[Side], C[Side] + Dir * Take, WidthPx, Color);
				else
				{
					for (double S = 0.0; S < Take; S += DashCm + DashGapCm) Line(C[Side] + Dir * S, C[Side] + Dir * FMath::Min(Take, S + DashCm), WidthPx, Color);
				}
				Left -= Take;
			}
		}
		void Brackets(const FBox2D& Box, float WidthPx, const FLinearColor& Color)
		{
			const FBox2D B(Box.Min - FVector2D(BracketOutCm, BracketOutCm), Box.Max + FVector2D(BracketOutCm, BracketOutCm));
			const double L = FMath::Min(BracketCm, 0.45 * FMath::Min(B.GetSize().X, B.GetSize().Y));
			const FVector2D Corners[4] = { B.Min, FVector2D(B.Max.X, B.Min.Y), B.Max, FVector2D(B.Min.X, B.Max.Y) };
			const FVector2D Signs[4] = { FVector2D(1, 1), FVector2D(-1, 1), FVector2D(-1, -1), FVector2D(1, -1) };
			for (int32 K = 0; K < 4; ++K)
			{
				Line(Corners[K], Corners[K] + FVector2D(Signs[K].X * L, 0.0), WidthPx, Color);
				Line(Corners[K], Corners[K] + FVector2D(0.0, Signs[K].Y * L), WidthPx, Color);
			}
		}
	};

	struct FBuildText
	{
		FString Text;
		FVector2D Px;
		FSlateFontInfo Font;
		FLinearColor Color;
		float Tracking;
	};

	FAutoConsoleCommandWithWorld CmdBuildLine(
		TEXT("BpBuild.Line"),
		TEXT("Log every table's build-up line (phase, areas, domains, rooms risen, pencil and ink), or that none runs."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (!World) return;
			for (TActorIterator<ABpTable> It(World); It; ++It)
			{
				const FString Line = It->GetBuildLine();
				UE_LOG(LogBpTable, Log, TEXT("BpBuild: line %s"), Line.IsEmpty() ? TEXT("(no build-up runs)") : *Line);
			}
		}));
}

// ---- Events -------------------------------------------------------------------------------------------------------------

void ABpTable::OnBuildup(const FBpBuildupBatch& Batch)
{
	FBpLinkModule& Link = FBpLinkModule::Get();
	if (Batch.Slug != Link.GetProductSlug()) return;
	if (Batch.JobId != BuildJob)
	{
		// A new watch: whatever was drawn goes (a re-run over an old map, or another job), and the empty sheet takes the
		// build-up.
		// A live plan held for this build-up stays held: it takes over at done.
		TSharedPtr<FBpPlan> Held = PendingLivePlan;
		if (SheetPlan.IsValid() || bBuild) OnProductChanged(Batch.Slug);
		ResetBuildup();
		PendingLivePlan = Held;
		bBuild = true;
		BuildJob = Batch.JobId;
		BuildName = Link.NameOf(Batch.Slug);
		bEmptySheet = true;
		EnsureSheet();
		UE_LOG(LogBpTable, Log, TEXT("BpBuild: %s builds itself from job %s's feed (%s %s)"), *Batch.Slug, *BuildJob, *Batch.JobStatus, *Batch.JobPhase);
	}
	if (!bBuild) return;
	const bool bPast = Batch.bPast || ReducedMotion();
	const double T0 = FPlatformTime::Seconds();
	TMap<FString, int32> Kinds;
	for (const FBpBuildupEvent& Event : Batch.Events)
	{
		ApplyBuildupEvent(Event, bPast);
		Kinds.FindOrAdd(Event.Type)++;
	}
	if (BuildPhase.IsEmpty() && !Batch.JobPhase.IsEmpty()) BuildPhase = Batch.JobPhase;
	FString Counts;
	for (const TPair<FString, int32>& Each : Kinds) Counts += FString::Printf(TEXT(" %s=%d"), *Each.Key, Each.Value);
	UE_LOG(LogBpTable, Log, TEXT("BpBuild: %d events%s applied in %.1f ms%s:%s; %s"), Batch.Events.Num(), bPast ? TEXT(" (past, at their end state)") : TEXT(""),
		(FPlatformTime::Seconds() - T0) * 1000.0, Batch.bDone ? TEXT(", the feed is done") : TEXT(""), *Counts, *GetBuildLine());
	SayBuildCaption();
	NextSheetDrawAt = 0.0;
	RedrawSheet();
	SetActorTickInterval(0.f);
}

void ABpTable::ApplyBuildupEvent(const FBpBuildupEvent& E, bool bPast)
{
	const double Now = bPast ? -1.0e6 : BuildClock;
	if (E.Type == TEXT("begin"))
	{
		if (!E.Text.IsEmpty()) BuildName = E.Text;
	}
	else if (E.Type == TEXT("phase"))
	{
		if (E.State == TEXT("start") || E.State == TEXT("failed")) BuildPhase = E.Phase;
	}
	else if (E.Type == TEXT("survey"))
	{
		for (int32 Index = 0; Index < E.Areas.Num(); ++Index)
		{
			const FBpBuildupArea& In = E.Areas[Index];
			FBuildArea* Area = BuildAreas.FindByPredicate([&In](const FBuildArea& A) { return A.Id == In.Id; });
			if (!Area)
			{
				Area = &BuildAreas.AddDefaulted_GetRef();
				Area->Id = In.Id;
				Area->BornAt = bPast ? -1.0e6 : Now + Index * 0.06;
			}
			Area->Name = In.Name.IsEmpty() ? In.Id : In.Name;
			Area->Group = In.Group;
			Area->Files = In.Files;
			if (In.Lines >= 0) Area->Lines = In.Lines;
		}
		LayoutSurvey(bPast);
	}
	else if (E.Type == TEXT("activity"))
	{
		if (!bPast && !E.Area.IsEmpty())
		{
			LitArea = E.Area;
			LitAt = BuildClock;
		}
	}
	else if (E.Type == TEXT("outline"))
	{
		for (const FBpBuildupDomain& In : E.Domains)
		{
			FBuildDomain* Domain = BuildDomains.FindByPredicate([&In](const FBuildDomain& D) { return D.Id == In.Id; });
			if (!Domain)
			{
				// Typed after the domain before it has finished typing (B's queue: never before what is already queued).
				double Start = Now;
				if (!bPast && BuildDomains.Num() > 0)
				{
					const FBuildDomain& Last = BuildDomains.Last();
					int32 Chars = Last.Name.Len();
					for (const FString& Cap : Last.CapNames) Chars += Cap.Len();
					Start = FMath::Max(Start, Last.TypeAt + Chars / BuildTypeCps);
				}
				Domain = &BuildDomains.AddDefaulted_GetRef();
				Domain->Id = In.Id;
				Domain->TypeAt = Start;
			}
			Domain->Name = In.Name;
			Domain->Order = In.Order;
			Domain->CapIds = In.CapIds;
			Domain->CapNames = In.CapNames;
			// Unflown until the structure places it (a re-send keeps the flights already set).
			if (Domain->FlyAt.Num() != 1 + Domain->CapIds.Num()) Domain->FlyAt.Init(1.0e9, 1 + Domain->CapIds.Num());
		}
	}
	else if (E.Type == TEXT("structure"))
	{
		// Merged by id: parents arrive before or with their children (contract.ts).
		const auto Upsert = [](auto& Into, const auto& From)
		{
			for (const auto& Node : From)
			{
				auto* Found = Into.FindByPredicate([&Node](const auto& Each) { return Each.id == Node.id; });
				if (Found) *Found = Node;
				else Into.Add(Node);
			}
		};
		if (!BuildPlan.IsValid()) BuildPlan = MakeShared<FBpPlan>();
		Upsert(BuildPlan->wings, E.Structure.wings);
		Upsert(BuildPlan->rooms, E.Structure.rooms);
		Upsert(BuildPlan->bays, E.Structure.bays);
		Upsert(BuildPlan->tiles, E.Structure.tiles);
		bBuildHasPlan = true;
		// Each feature's kind (the furniture it gets), from the structure itself.
		for (const TPair<FString, FString>& Kind : E.Tiles) FBpLinkModule::Get().NoteFeatureKind(Kind.Key, Kind.Value);
		// Committed by the tick in a frame of its own (WP-V3), every chunk of a batch in one commit.
		bStructurePending = true;
		bStructurePast = bStructurePast || bPast;
	}
	else if (E.Type == TEXT("history"))
	{
		if (!bBuildHasPlan) return;
		// The feed's boxes are provisional until history (WP-S: the wing order can change once dates land): the final ones,
		// read again, and the rooms that moved glide there.
		TWeakObjectPtr<ABpTable> Self(this);
		const FString Job = BuildJob;
		FBpLinkModule::Get().FetchIslandsPlan([Self, Job, bPast](bool bOk, const FBpPlan& Final)
		{
			ABpTable* Table = Self.Get();
			if (!Table || !Table->bBuild || Table->BuildJob != Job || !Table->SheetPlan.IsValid()) return;
			if (!bOk)
			{
				UE_LOG(LogBpTable, Log, TEXT("BpBuild: history: no final plan to read yet; the feed's boxes stand"));
				return;
			}
			int32 Moved = 0, Matched = 0;
			Table->GlideDelta.Reset();
			for (int32 Room = 0; Room < Table->SheetPlan->rooms.Num(); ++Room)
			{
				const FBpPlanRoom& Was = Table->SheetPlan->rooms[Room];
				const FBpPlanRoom* Now = Final.rooms.FindByPredicate([&Was](const FBpPlanRoom& R) { return R.id == Was.id; });
				if (!Now) continue;
				++Matched;
				const FVector2D A = Table->PlanToPaperCm(FVector2D(Was.box.x + Was.box.w * 0.5, Was.box.y + Was.box.h * 0.5));
				const FVector2D B = Table->PlanToPaperCm(FVector2D(Now->box.x + Now->box.w * 0.5, Now->box.y + Now->box.h * 0.5));
				const FVector Delta = PaperCmToLocal(B, 0.f) - PaperCmToLocal(A, 0.f);
				if (Delta.Size() < 0.05) continue;
				++Moved;
				Table->GlideDelta.Add(Room, Delta);
			}
			UE_LOG(LogBpTable, Log, TEXT("BpBuild: history: the final plan (rev %s) read; %d of %d rooms move"), *Final.rev, Moved, Matched);
			if (Moved == 0 || Matched == 0) return;
			// The final boxes become the build-up's plan; the walls glide there first.
			FBpPlan Next = *Table->BuildPlan;
			const auto Take = [](auto& Into, const auto& From)
			{
				for (auto& Node : Into)
				{
					if (const auto* Found = From.FindByPredicate([&Node](const auto& Each) { return Each.id == Node.id; })) Node.box = Found->box;
				}
			};
			Take(Next.wings, Final.wings);
			Take(Next.rooms, Final.rooms);
			Take(Next.bays, Final.bays);
			Take(Next.tiles, Final.tiles);
			for (FBpPlanWing& Wing : Next.wings)
			{
				if (const FBpPlanWing* Found = Final.wings.FindByPredicate([&Wing](const FBpPlanWing& W) { return W.id == Wing.id; })) { Wing.order = Found->order; Wing.letter = Found->letter; }
			}
			Table->GlideTo = MakeShared<FBpPlan>(MoveTemp(Next));
			Table->GlideAt = bPast || ReducedMotion() ? Table->BuildClock - GlideS : FMath::Max(Table->BuildClock, Table->BuildQueue);
			Table->BuildQueue = FMath::Max(Table->BuildQueue, Table->GlideAt + GlideS);
			Table->SetActorTickInterval(0.f);
		});
	}
	else if (E.Type == TEXT("progress"))
	{
		if (!E.Phase.IsEmpty()) BuildPhase = E.Phase;
		NoteBuildCount(E.Phase.IsEmpty() ? BuildPhase : E.Phase, E.N, E.Of);
	}
	else if (E.Type == TEXT("narration"))
	{
		if (!E.Phase.IsEmpty()) BuildPhase = E.Phase;
		if (E.Features.Num() > 0)
		{
			// The batch dispatched: bracketed in pencil as "being judged now" until its provisional reading lands.
			BuildJudging.Reset();
			for (const FString& Feature : E.Features) BuildJudging.Add(Feature);
		}
		if (!E.Text.IsEmpty())
		{
			NarrText = E.Text;
			NarrNext = E.Next;
		}
	}
	else if (E.Type == TEXT("health"))
	{
		const double Start = bPast ? -1.0e6 : FMath::Max(BuildClock, BuildQueue);
		for (int32 Index = 0; Index < E.Tiles.Num(); ++Index)
		{
			const FString& Id = E.Tiles[Index].Key;
			BuildJudging.Remove(Id);
			if (E.bProvisional)
			{
				BuildPencil.Add(Id, E.Tiles[Index].Value);
				PencilAt.Add(Id, bPast ? -1.0e6 : BuildClock + Index * 0.04);
			}
			else
			{
				BuildInk.Add(Id, E.Tiles[Index].Value);
				InkAt.Add(Id, bPast ? -1.0e6 : Start + Index * 0.06);
			}
		}
		if (!E.bProvisional)
		{
			BuildJudging.Reset();
			if (!bPast) BuildQueue = FMath::Max(BuildQueue, Start + E.Tiles.Num() * 0.06 + BuildInkS);
		}
	}
	else if (E.Type == TEXT("done"))
	{
		bBuildEnded = true;
		BuildEndedAt = BuildClock;
		BuildPhase = TEXT("register");
		BuildJudging.Reset();
	}
	else if (E.Type == TEXT("failed"))
	{
		bBuildEnded = bBuildFailed = true;
		BuildEndedAt = BuildClock;
		BuildFailPhase = E.Phase.IsEmpty() ? BuildPhase : E.Phase;
		BuildFailText = E.Text;
		BuildJudging.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpBuild: stopped at %s (%s); what was drawn stays"), *BuildFailPhase, *E.Text.Left(160));
	}
}

void ABpTable::LayoutSurvey(bool bPast)
{
	// A treemap of the areas over the paper's far band, grouped (an area's group, then its size), each sized by its lines
	// once the inventory sent them (files until then).
	TArray<int32> Order;
	for (int32 Index = 0; Index < BuildAreas.Num(); ++Index) Order.Add(Index);
	const bool bLines = BuildAreas.ContainsByPredicate([](const FBuildArea& A) { return A.Lines > 0; });
	TArray<double> Weight;
	double Total = 0.0;
	for (const FBuildArea& Area : BuildAreas)
	{
		const double W = bLines ? (Area.Lines > 0 ? Area.Lines : FMath::Max(1, Area.Files) * 150.0) : FMath::Max(1, Area.Files);
		Weight.Add(W);
		Total += W;
	}
	// The smallest parcels keep room for a name.
	for (double& W : Weight) W = FMath::Max(W, Total * 0.012);
	Order.Sort([this, &Weight](int32 A, int32 B)
	{
		const FString& GA = BuildAreas[A].Group, & GB = BuildAreas[B].Group;
		if (GA != GB) return GA.IsEmpty() ? false : GB.IsEmpty() ? true : GA < GB;
		return Weight[A] > Weight[B];
	});
	TArray<FBox2D> Boxes;
	Boxes.SetNum(BuildAreas.Num());
	TFunction<void(int32, int32, FBox2D)> Split = [&](int32 From, int32 To, FBox2D Rect)
	{
		if (To - From <= 0) return;
		if (To - From == 1)
		{
			Boxes[Order[From]] = Rect;
			return;
		}
		double Sum = 0.0;
		for (int32 K = From; K < To; ++K) Sum += Weight[Order[K]];
		double Run = 0.0, Best = UE_BIG_NUMBER;
		int32 Cut = From + 1;
		for (int32 K = From; K < To - 1; ++K)
		{
			Run += Weight[Order[K]];
			if (FMath::Abs(Run - Sum * 0.5) < Best) { Best = FMath::Abs(Run - Sum * 0.5); Cut = K + 1; }
		}
		double Left = 0.0;
		for (int32 K = From; K < Cut; ++K) Left += Weight[Order[K]];
		const double Share = Sum > 0.0 ? Left / Sum : 0.5;
		const FVector2D Size = Rect.GetSize();
		if (Size.X >= Size.Y)
		{
			const double X = Rect.Min.X + Size.X * Share;
			Split(From, Cut, FBox2D(Rect.Min, FVector2D(X, Rect.Max.Y)));
			Split(Cut, To, FBox2D(FVector2D(X, Rect.Min.Y), Rect.Max));
		}
		else
		{
			const double Y = Rect.Min.Y + Size.Y * Share;
			Split(From, Cut, FBox2D(Rect.Min, FVector2D(Rect.Max.X, Y)));
			Split(Cut, To, FBox2D(FVector2D(Rect.Min.X, Y), Rect.Max));
		}
	};
	Split(0, Order.Num(), FBox2D(FVector2D(SurveyLeftCm, SurveyTopCm), FVector2D(SurveyRightCm, SurveyBottomCm)));
	for (int32 Index = 0; Index < BuildAreas.Num(); ++Index)
	{
		FBuildArea& Area = BuildAreas[Index];
		const FBox2D Box(Boxes[Index].Min + FVector2D(ParcelGapCm, ParcelGapCm), Boxes[Index].Max - FVector2D(ParcelGapCm, ParcelGapCm));
		if (Area.Box.bIsValid && !bPast && (Area.Box.Min - Box.Min).Size() + (Area.Box.Max - Box.Max).Size() > 0.05)
		{
			// Resized by a re-send: it eases from where it is drawn now.
			const float P = EaseInOut(Progress(BuildClock, Area.MovedAt, ResizeS));
			Area.From = FBox2D(FMath::Lerp(Area.From.Min, Area.Box.Min, P), FMath::Lerp(Area.From.Max, Area.Box.Max, P));
			Area.MovedAt = BuildClock;
		}
		else if (!Area.Box.bIsValid || bPast)
		{
			Area.From = Box;
			Area.MovedAt = -1.0e6;
		}
		Area.Box = Box;
	}
}

void ABpTable::BuildupStructure(bool bPast)
{
	// The plan the table draws: the structure's boxes as the feed sends them (the islands layout, as /plan?layout=islands),
	// no lens yet; drawn through the live table's own path, so done changes nothing but the ink.
	FBpPlan Plan = *BuildPlan;
	Plan.rev = FString::Printf(TEXT("buildup:%s:%d"), *BuildJob, ++BuildSerial);
	Plan.lenses.Reset();
	const double T0 = FPlatformTime::Seconds();
	// Marked in a CSV capture, so the structure burst's frames can be read apart from the idle ones.
	CSV_EVENT_GLOBAL(TEXT("BpBuild structure"));
	bApplyingBuild = true;
	ApplyPlanNow(Plan);
	bApplyingBuild = false;
	StructureCommitMs = (FPlatformTime::Seconds() - T0) * 1000.0;
	if (!SheetPlan.IsValid()) return;

	TArray<const FBpPlanWing*> Wings;
	for (const FBpPlanWing& Wing : SheetPlan->wings) Wings.Add(&Wing);
	Wings.Sort([](const FBpPlanWing& A, const FBpPlanWing& B) { return A.order < B.order; });
	const auto RoomsOf = [this](const FString& Wing)
	{
		TArray<const FBpPlanRoom*> Out;
		for (const FBpPlanRoom& Room : SheetPlan->rooms) if (Room.parentId == Wing) Out.Add(&Room);
		Out.Sort([](const FBpPlanRoom& A, const FBpPlanRoom& B) { return A.order < B.order; });
		return Out;
	};
	const auto DomainOf = [this](const FString& Wing) { return BuildDomains.FindByPredicate([&Wing](const FBuildDomain& D) { return D.Id == Wing; }); };
	if (bPast)
	{
		SurveyGoneAt = FMath::Min(SurveyGoneAt, -1.0e6);
		for (const FBpPlanWing* Wing : Wings) WingDrawAt.FindOrAdd(Wing->id, -1.0e6);
		for (const FBpPlanRoom& Room : SheetPlan->rooms) RoomRiseAt.FindOrAdd(Room.id, -1.0e6);
		for (FBuildDomain& Domain : BuildDomains) for (double& At : Domain.FlyAt) At = FMath::Min(At, -1.0e6);
	}
	else
	{
		// Per wing in order: its line's flight, its outline drawn, then its rooms one at a time; a burst longer than
		// BuildDrainS is compressed to it. What is already scheduled (a re-sent chunk) keeps its time.
		double Total = 0.0;
		for (const FBpPlanWing* Wing : Wings)
		{
			if (WingDrawAt.Contains(Wing->id)) continue;
			Total += BuildFlyS + BuildWingDrawS + RoomsOf(Wing->id).Num() * BuildRoomStaggerS;
		}
		const double K = Total > BuildDrainS ? BuildDrainS / Total : 1.0;
		const double Start = FMath::Max(BuildClock, BuildQueue);
		SurveyGoneAt = FMath::Min(SurveyGoneAt, Start);
		double T = Start + BuildRecedeS * 0.5 * K;
		for (const FBpPlanWing* Wing : Wings)
		{
			if (WingDrawAt.Contains(Wing->id)) continue;
			FBuildDomain* Domain = DomainOf(Wing->id);
			if (Domain && Domain->FlyAt.Num() > 0) Domain->FlyAt[0] = T;
			T += BuildFlyS * K;
			WingDrawAt.Add(Wing->id, T);
			T += BuildWingDrawS * K;
			for (const FBpPlanRoom* Room : RoomsOf(Wing->id))
			{
				RoomRiseAt.Add(Room->id, T);
				// Its capability line lands as the room rises.
				if (Domain)
				{
					const int32 Line = Domain->CapIds.IndexOfByKey(Room->id);
					if (Line != INDEX_NONE && Domain->FlyAt.IsValidIndex(Line + 1)) Domain->FlyAt[Line + 1] = T - BuildFlyS * K;
				}
				T += BuildRoomStaggerS * K;
			}
		}
		BuildQueue = FMath::Max(BuildQueue, T + BuildRoomRiseS);
		UE_LOG(LogBpTable, Log, TEXT("BpBuild: structure: %d wings, %d rooms queued over %.1f s (pace x%.2f) from t=%.1f"), Wings.Num(), SheetPlan->rooms.Num(), T - Start, K, Start);
	}
	// The order the rooms rise in; every one with no time (a chunk's stray) rises now.
	RiseOrder.Reset();
	for (const FBpPlanRoom& Room : SheetPlan->rooms)
	{
		RoomRiseAt.FindOrAdd(Room.id, bPast ? -1.0e6 : BuildClock);
		RiseOrder.Add(Room.id);
	}
	RiseOrder.Sort([this](const FString& A, const FString& B) { return RoomRiseAt[A] < RoomRiseAt[B]; });
	ApplyLevelVisuals();
	UE_LOG(LogBpTable, Log, TEXT("BpBuild: the structure drawn as rev %s in %.1f ms (%.1f ms with its choreography; %d rooms, %d bays, %d tiles; the rest follows a piece a frame, the rooms rise one a frame at most)"),
		*SheetPlan->rev, StructureCommitMs, (FPlatformTime::Seconds() - T0) * 1000.0, SheetPlan->rooms.Num(), SheetPlan->bays.Num(), SheetPlan->tiles.Num());
	NoteHeavy(TEXT("structure"), T0);
}

// ---- The clock --------------------------------------------------------------------------------------------------------

float ABpTable::RoomBuildShow(int32 Room) const
{
	if (!bBuild || !SheetPlan.IsValid() || !SheetPlan->rooms.IsValidIndex(Room)) return 1.f;
	const FString& Id = SheetPlan->rooms[Room].id;
	if (!RisenRooms.Contains(Id)) return 0.f;
	const double* At = RoomRiseAt.Find(Id);
	return At ? Progress(BuildClock, *At, BuildRoomRiseS) : 1.f;
}

float ABpTable::WingBuildShow(const FString& Wing) const
{
	if (!bBuild) return 1.f;
	const double* At = WingDrawAt.Find(Wing);
	return At ? Progress(BuildClock, *At, BuildWingDrawS) : 0.f;
}

void ABpTable::ApplyRoomRise()
{
	if (!SheetPlan.IsValid() || RestBase.Num() != RestVolumes->GetInstanceCount() || RestBase.Num() != RestRoom.Num()) return;
	if (RoomRiseShown.Num() != SheetPlan->rooms.Num()) RoomRiseShown.Init(-1.f, SheetPlan->rooms.Num());
	const float Glide = GlideAt >= 0.0 ? EaseInOut(Progress(BuildClock, GlideAt, GlideS)) : 0.f;
	bool bAny = false;
	for (int32 Room = 0; Room < SheetPlan->rooms.Num(); ++Room)
	{
		const FVector* Delta = GlideDelta.Find(Room);
		const float H = EaseInOut(RoomBuildShow(Room));
		// The key folds the glide in, so a gliding room is written every frame and a still one never.
		const float Key = H + (Delta ? 2.f + Glide : 0.f);
		if (RoomRiseShown[Room] == Key) continue;
		RoomRiseShown[Room] = Key;
		for (int32 Index = 0; Index < RestRoom.Num(); ++Index)
		{
			if (RestRoom[Index] != Room) continue;
			FTransform T = RestBase[Index];
			const FVector Scale = T.GetScale3D();
			const double Full = Scale.Z * 100.0;
			const double Now = FMath::Max(0.02, Full * H);
			const FVector At = T.GetLocation();
			T.SetLocation(FVector(At.X, At.Y, At.Z - Full * 0.5 + Now * 0.5) + (Delta ? *Delta * Glide : FVector::ZeroVector));
			T.SetScale3D(FVector(Scale.X, Scale.Y, Now / 100.0));
			RestVolumes->UpdateInstanceTransform(Index, T, false, false, true);
			RestVolumes->SetCustomDataValue(Index, 2, static_cast<float>(Now), false);
		}
		bAny = true;
	}
	if (bAny)
	{
		RestVolumes->MarkRenderStateDirty();
		ApplyLevelVisuals();
	}
}

bool ABpTable::SheetMovingNow() const
{
	const double T = BuildClock;
	if (SettleAt >= 0.0) return true;
	if (!bBuild) return false;
	const bool bSurvey = T < SurveyGoneAt + BuildRecedeS;
	if (bSurvey)
	{
		if (Moving(T, SurveyGoneAt, BuildRecedeS) || Moving(T, LitAt, LitS)) return true;
		for (const FBuildArea& Area : BuildAreas)
		{
			if (Moving(T, Area.BornAt, BuildChalkS) || Moving(T, Area.MovedAt, ResizeS)) return true;
		}
	}
	for (const FBuildDomain& Domain : BuildDomains)
	{
		int32 Chars = Domain.Name.Len();
		for (const FString& Cap : Domain.CapNames) Chars += Cap.Len();
		if (Moving(T, Domain.TypeAt, Chars / BuildTypeCps)) return true;
		for (const double At : Domain.FlyAt) if (Moving(T, At, BuildFlyS)) return true;
	}
	for (const TPair<FString, double>& Each : WingDrawAt) if (Moving(T, Each.Value, BuildWingDrawS)) return true;
	for (const TPair<FString, double>& Each : RoomRiseAt) if (Moving(T, Each.Value, BuildRoomRiseS)) return true;
	for (const TPair<FString, double>& Each : PencilAt) if (Moving(T, Each.Value, BuildInkS)) return true;
	for (const TPair<FString, double>& Each : InkAt) if (Moving(T, Each.Value, BuildInkS)) return true;
	return false;
}

void ABpTable::StepDeferredCommit()
{
	if (DeferredSteps <= 0) return;
	if (!SheetPlan.IsValid() || SheetPlan->rev != DeferredRev)
	{
		DeferredSteps = 0;
		return;
	}
	// One piece a frame, in a frame no other heavy piece took (WP-V3).
	if (SpreadNow() && HeavyBusy()) return;
	const double T0 = FPlatformTime::Seconds();
	const TCHAR* Step = TEXT("");
	switch (DeferredSteps)
	{
	case 5: RefreshWingCounts(); SetTitle(FString(), ActiveLens); Step = TEXT("counts and title"); break;
	case 4: BuildLevelLabels(*SheetPlan); Step = TEXT("labels (who belongs to whom; the labels follow a slice a frame)"); break;
	case 3: BuildRoomNames(*SheetPlan); Step = TEXT("names"); break;
	case 2: BuildGlyphs(*SheetPlan); Step = TEXT("glyphs"); break;
	default: BuildPins(FBpLinkModule::Get().GetScanState()); Step = TEXT("pins"); break;
	}
	--DeferredSteps;
	// The new pieces take the levels' (and the build-up's) Show at once.
	for (float& Shown : ShownRest) Shown = -1.f;
	ApplyLevelVisuals();
	UE_LOG(LogBpTable, Log, TEXT("BpBuild: commit step %s in %.1f ms (%d left, frame %llu)"), Step, (FPlatformTime::Seconds() - T0) * 1000.0, DeferredSteps, static_cast<uint64>(GFrameCounter));
	NoteHeavy(TEXT("commit step"), T0);
}

bool ABpTable::HeavyBusy() const
{
	return HeavyFrame == GFrameCounter;
}

void ABpTable::NoteHeavy(const TCHAR* What, double StartSeconds)
{
	HeavyFrame = GFrameCounter;
	const double Ms = (FPlatformTime::Seconds() - StartSeconds) * 1000.0;
	CSV_CUSTOM_STAT(BpBuild, HeavyMs, static_cast<float>(Ms), ECsvCustomStatOp::Accumulate);
	if (Ms >= HeavyLogMs)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpBuild: heavy %s %.1f ms (frame %llu)"), What, Ms, static_cast<uint64>(GFrameCounter));
	}
}

void ABpTable::NoteBuildCount(const FString& Phase, int32 N, int32 Of)
{
	// progress counts batches LANDED (judged), not the batch being judged: with a real model the batches run in parallel
	// ("Judging batch 1 of 2" and "2 of 2" in the same second, progress 0 of 2 until one lands), so the title says
	// "n of N judged", as the web does, for the phase the count belongs to (WP-V3).
	if (Phase != BuildCountPhase)
	{
		BuildCountPhase = Phase;
		BuildOf = 0;
	}
	BuildN = FMath::Max(0, N);
	if (Of > 0) BuildOf = Of;
}

bool ABpTable::TickBuildup(float DeltaSeconds)
{
	// A sheet a build-up deferred, once it no longer spreads its commit: drawn now.
	if (bSheetDirty && !SpreadNow()) DrawSheetNow();
	// The structure that arrived, committed in a frame of its own (WP-V3: it shared one with the labels, 28 ms).
	if (bStructurePending && bBuild && !HeavyBusy())
	{
		bStructurePending = false;
		const bool bPast = bStructurePast;
		bStructurePast = false;
		BuildupStructure(bPast);
	}
	// One deferred commit step a frame (a structure, a glide's landing or the hand-over), then the level labels a slice a
	// frame, each in a frame no other heavy piece took.
	const bool bDeferred = DeferredSteps > 0 || LevelLabelsNext >= 0;
	StepDeferredCommit();
	if (LevelLabelsNext >= 0 && DeferredSteps < 4)
	{
		if (!SpreadNow()) StepLevelLabels(-1.0);
		else if (!HeavyBusy())
		{
			const double T0 = FPlatformTime::Seconds();
			StepLevelLabels(LevelLabelSliceMs);
			NoteHeavy(TEXT("level labels"), T0);
		}
	}
	// The furniture kit, loaded ahead while the survey and the outline draw (one mesh a frame), so the structure's glyph
	// step never loads one.
	if (bBuild && GlyphPreloadNext < GlyphMeshes.Num() && !HeavyBusy())
	{
		const double T0 = FPlatformTime::Seconds();
		int32 Index = 0;
		for (const TPair<FString, TSoftObjectPtr<UStaticMesh>>& Kind : GlyphMeshes)
		{
			if (Index++ != GlyphPreloadNext) continue;
			const FSoftObjectPath Path = Kind.Value.ToSoftObjectPath();
			if (Path.IsValid() && FPackageName::DoesPackageExist(Path.GetLongPackageName()))
			{
				if (UStaticMesh* Mesh = Kind.Value.LoadSynchronous()) GlyphMeshHold.AddUnique(Mesh);
			}
			break;
		}
		++GlyphPreloadNext;
		NoteHeavy(TEXT("kit mesh"), T0);
	}
	// A live plan held for a build-up that never started (the feed did not answer): drawn after BuildHoldS.
	if (HeldPlanAt >= 0.0)
	{
		const double Real = GetWorld() ? GetWorld()->GetRealTimeSeconds() : 0.0;
		if (bBuild) HeldPlanAt = -1.0;
		else if (Real > HeldPlanAt + BuildHoldS)
		{
			HeldPlanAt = -1.0;
			if (TSharedPtr<FBpPlan> Held = PendingLivePlan)
			{
				PendingLivePlan.Reset();
				UE_LOG(LogBpTable, Log, TEXT("BpBuild: no build-up began within %.0f s: the live plan is drawn"), BuildHoldS);
				bSpreadCommit = true;
				ApplyPlanNow(*Held);
				bSpreadCommit = false;
			}
		}
		else return true;
	}
	if (!bBuild && SettleAt < 0.0) return bDeferred;
	BuildClock += FMath::Clamp(DeltaSeconds, 0.f, 0.5f);
	bool bMoving = false;
	if (bBuild && SheetPlan.IsValid())
	{
		// At most one room committed a frame (render-submission-economy: prepare off the render thread, commit on it):
		// the next room whose time has come starts to rise.
		for (const FString& Id : RiseOrder)
		{
			if (RisenRooms.Contains(Id)) continue;
			if (RoomRiseAt.FindRef(Id) <= BuildClock)
			{
				RisenRooms.Add(Id);
				UE_LOG(LogBpTable, Verbose, TEXT("BpBuild: room %s rises (%d of %d)"), *Id, RisenRooms.Num(), RiseOrder.Num());
				if (RisenRooms.Num() == RiseOrder.Num())
				{
					UE_LOG(LogBpTable, Log, TEXT("BpBuild: every room has risen (%d) at t=%.1f"), RisenRooms.Num(), BuildClock);
					CSV_EVENT_GLOBAL(TEXT("BpBuild risen"));
				}
			}
			break;
		}
		bMoving |= RisenRooms.Num() < RiseOrder.Num();
		ApplyRoomRise();
		// A wing drawing itself brings its label in with it.
		for (const TPair<FString, double>& Each : WingDrawAt)
		{
			if (Moving(BuildClock, Each.Value, BuildWingDrawS + 0.1)) { ApplyLevelVisuals(); bMoving = true; break; }
		}
		if (GlideAt >= 0.0)
		{
			bMoving = true;
			if (BuildClock >= GlideAt + GlideS && GlideTo.IsValid() && !HeavyBusy())
			{
				const double T0 = FPlatformTime::Seconds();
				// Landed: the final boxes are the build-up's plan from here (the walls stand where it draws them).
				*BuildPlan = *GlideTo;
				GlideTo.Reset();
				GlideDelta.Reset();
				GlideAt = -1.0;
				FBpPlan Plan = *BuildPlan;
				Plan.rev = FString::Printf(TEXT("buildup:%s:%d"), *BuildJob, ++BuildSerial);
				Plan.lenses.Reset();
				bApplyingBuild = true;
				ApplyPlanNow(Plan);
				bApplyingBuild = false;
				UE_LOG(LogBpTable, Log, TEXT("BpBuild: history: the rooms glided to the final boxes (rev %s)"), *Plan.rev);
				NoteHeavy(TEXT("glide landing"), T0);
			}
		}
	}
	if (bBuild)
	{
		TryHandOver();
		// A done whose live plan never came (the milestone read missed it): ask once.
		if (bBuild && bBuildEnded && !bBuildFailed && !PendingLivePlan.IsValid() && BuildEndedAt >= 0.0 && BuildClock > BuildEndedAt + 4.0)
		{
			BuildEndedAt = -1.0;
			UE_LOG(LogBpTable, Log, TEXT("BpBuild: done, and no live plan yet: reading it"));
			if (GEngine) GEngine->Exec(GetWorld(), TEXT("BpLink.Fetch"));
		}
	}
	if (SettleAt >= 0.0 && BuildClock > SettleAt + BuildSettleS)
	{
		ResetBuildup();
		RedrawSheet();
		UE_LOG(LogBpTable, Log, TEXT("BpBuild: settled; the table is the live table"));
		return false;
	}
	// The sheet: redrawn at most BuildSheetHz while something on it moves, once more when it stops, and when a commit
	// marked it; in a frame no other heavy piece took (the next free one).
	const bool bSheet = SheetMovingNow();
	const double Real = GetWorld() ? GetWorld()->GetRealTimeSeconds() : 0.0;
	const bool bWant = bSheetDirty || (bSheet && Real >= NextSheetDrawAt) || (!bSheet && bSheetMoving);
	if (bWant && !HeavyBusy())
	{
		NextSheetDrawAt = Real + 1.0 / BuildSheetHz;
		const double T0 = FPlatformTime::Seconds();
		DrawSheetNow();
		NoteHeavy(TEXT("sheet"), T0);
		bSheetMoving = bSheet;
	}
	else if (!bWant) bSheetMoving = bSheet;
	return bMoving || bSheet || bWant || SettleAt >= 0.0 || bStructurePending || DeferredSteps > 0 || LevelLabelsNext >= 0 || bWingLabelsDirty;
}

void ABpTable::TryHandOver()
{
	if (!bBuild || !PendingLivePlan.IsValid() || bBuildFailed || bStructurePending || HeavyBusy()) return;
	// The feed's own `done` (its final readings are in by then), the queue drained, every room up.
	if (!bBuildEnded ||BuildClock < BuildQueue + 0.5 || RisenRooms.Num() < RiseOrder.Num() || GlideAt >= 0.0) return;
	EndBuildup();
}

void ABpTable::EndBuildup()
{
	TSharedPtr<FBpPlan> Live = PendingLivePlan;
	PendingLivePlan.Reset();
	if (!Live.IsValid()) return;
	int32 Moved = 0;
	for (const FBpPlanRoom& Room : Live->rooms)
	{
		const FBpPlanRoom* Was = BuildPlan.IsValid() ? BuildPlan->rooms.FindByPredicate([&Room](const FBpPlanRoom& R) { return R.id == Room.id; }) : nullptr;
		if (!Was || FMath::Abs(Was->box.x - Room.box.x) + FMath::Abs(Was->box.y - Room.box.y) + FMath::Abs(Was->box.w - Room.box.w) + FMath::Abs(Was->box.h - Room.box.h) > 0.5) ++Moved;
	}
	// The live table takes over (the same boxes, so nothing jumps); the build-up's ink fades into it over BuildSettleS.
	bBuild = false;
	bBuildCaption = false;
	SettleAt = BuildClock;
	CSV_EVENT_GLOBAL(TEXT("BpBuild handover"));
	const double T0 = FPlatformTime::Seconds();
	bSpreadCommit = true;
	ApplyPlanNow(*Live);
	bSpreadCommit = false;
	NoteHeavy(TEXT("hand-over"), T0);
	UE_LOG(LogBpTable, Log, TEXT("BpBuild: done: the live plan (rev %s) takes over; %d of %d rooms differ from the drawn boxes; the ink settles over %.1f s"),
		*Live->rev, Moved, Live->rooms.Num(), BuildSettleS);
	SetActorTickInterval(0.f);
}

void ABpTable::ResetBuildup()
{
	// The narration leaves the follow caption (which otherwise stays while following is on).
	if (!BuildCaptionKey.IsEmpty() && FollowLine == BuildCaptionKey) FollowLine.Reset();
	bBuild = false;
	BuildJob.Reset();
	BuildName.Reset();
	BuildClock = BuildQueue = 0.0;
	BuildAreas.Reset();
	SurveyGoneAt = 1.0e9;
	LitArea.Reset();
	LitAt = -1.0e6;
	BuildDomains.Reset();
	BuildPlan = MakeShared<FBpPlan>();
	bBuildHasPlan = false;
	WingDrawAt.Reset();
	RoomRiseAt.Reset();
	RiseOrder.Reset();
	RisenRooms.Reset();
	BuildPencil.Reset();
	PencilAt.Reset();
	BuildInk.Reset();
	InkAt.Reset();
	BuildJudging.Reset();
	BuildPhase.Reset();
	BuildN = BuildOf = 0;
	BuildCountPhase.Reset();
	bStructurePending = bStructurePast = false;
	NarrText.Reset();
	NarrNext.Reset();
	bBuildEnded = bBuildFailed = false;
	BuildFailPhase.Reset();
	BuildFailText.Reset();
	BuildEndedAt = -1.0;
	PendingLivePlan.Reset();
	HeldPlanAt = -1.0;
	SettleAt = -1.0;
	bSheetMoving = false;
	bBuildCaption = false;
	BuildCaptionKey.Reset();
	GlideDelta.Reset();
	GlideAt = -1.0;
	GlideTo.Reset();
}

FString ABpTable::GetBuildLine() const
{
	if (!bBuild) return FString();
	return FString::Printf(TEXT("%s %s%d/%d areas=%d domains=%d rooms=%d/%d judging=%d pencil=%d ink=%d t=%.1f sheet=%.1f/%.1fms x%d%s"), *BuildJob,
		BuildPhase.IsEmpty() ? TEXT("-") : *BuildPhase, BuildN, BuildOf, BuildAreas.Num(), BuildDomains.Num(), RisenRooms.Num(), RiseOrder.Num(),
		BuildJudging.Num(), BuildPencil.Num(), BuildInk.Num(), BuildClock, LastSheetMs, MaxSheetMs, SheetDraws, bBuildFailed ? *FString::Printf(TEXT(" stopped at %s"), *BuildFailPhase) : bBuildEnded ? TEXT(" done") : TEXT(""));
}

void ABpTable::SayBuildCaption()
{
	if (!bBuild) return;
	const FString Phase = FBpLinkModule::PhaseLabel(BuildPhase);
	FString Line1, Line2;
	if (bBuildFailed)
	{
		Line1 = FString::Printf(TEXT("Stopped at %s"), *FBpLinkModule::PhaseLabel(BuildFailPhase).ToLower());
		Line2 = BuildFailText.IsEmpty() ? FString(TEXT("what was drawn stays")) : BuildFailText;
	}
	else if (bBuildEnded)
	{
		Line1 = FString::Printf(TEXT("%s is in bp"), *BuildName);
		Line2 = TEXT("the table becomes the live table");
	}
	else if (!NarrText.IsEmpty())
	{
		Line1 = NarrText;
		Line2 = NarrNext.IsEmpty() ? (BuildOf > 0 && BuildCountPhase == BuildPhase ? FString::Printf(TEXT("%s · %d of %d judged"), *Phase, BuildN, BuildOf) : Phase) : TEXT("next: ") + NarrNext;
	}
	else
	{
		Line1 = FString::Printf(TEXT("Onboarding %s"), *BuildName);
		Line2 = Phase.IsEmpty() ? FString(TEXT("starting")) : Phase;
	}
	const FString Key = Line1 + TEXT("\n") + Line2;
	if (Key == BuildCaptionKey) return;
	BuildCaptionKey = Key;
	bBuildCaption = true;
	ShowCaption(Line1, Line2);
}

// ---- The drawing ----------------------------------------------------------------------------------------------------

void ABpTable::DrawBuildup(UCanvas* Canvas, bool bWithPlan)
{
	if (!Canvas) return;
	if (Canvas->Canvas) Canvas->Canvas->SetWriteDestinationAlpha(true);
	const double T = BuildClock;
	FBuildPen Pen;
	TArray<FBuildText> Texts;
	/** Text with its cap's top-left at (U, CapTop): recipe, cap, colour. */
	const auto Put = [&Texts](const FString& Raw, const BpType::FRecipe& Recipe, double U, double CapTop, double Cap, const FLinearColor& Color)
	{
		if (Raw.IsEmpty() || Color.A <= 0.f) return;
		const FString Text = Recipe.bUpper ? Raw.ToUpper() : Raw;
		const double Top = CapTop - (BpType::AscPerEm - BpType::CapPerEm) * (Cap / BpType::CapPerEm);
		Texts.Add({ Text, ABpTable::PaperCmToSheetPx(FVector2D(U, Top)), BuildFont(Recipe.Face, Cap), Color, static_cast<float>(BuildTrackPx(Recipe, Cap)) });
	};
	const auto CapAt = [this](const BpType::FRecipe& Recipe, double U, double V) { return FMath::Max(Recipe.CapCm, TextFloorCm(FVector2D(U, V))); };
	const float Settle = SettleAt >= 0.0 ? 1.f - Progress(T, SettleAt, BuildSettleS) : 1.f;

	if (bBuild && !bWithPlan)
	{
		// The drawing's border, as a drawn sheet has it.
		const FLinearColor Border = BuildCyan.CopyWithNewOpacity(0.4f);
		Pen.Perimeter(FBox2D(FVector2D(BorderInsetCm, BorderInsetCm), FVector2D(PaperWidthCm - BorderInsetCm, PaperDepthCm - BorderInsetCm)), 1.f, 3.f, Border, false);
	}

	if (bBuild)
	{
		// ---- The survey: dashed parcels chalked in, a name and a figure each; the touched area glows; all recede ------
		const float Survey = 1.f - Progress(T, SurveyGoneAt, BuildRecedeS);
		if (Survey > 0.f)
		{
			const bool bLines = BuildAreas.ContainsByPredicate([](const FBuildArea& A) { return A.Lines > 0; });
			for (const FBuildArea& Area : BuildAreas)
			{
				const float Chalk = Progress(T, Area.BornAt, BuildChalkS);
				if (Chalk <= 0.f || !Area.Box.bIsValid) continue;
				const float P = EaseInOut(Progress(T, Area.MovedAt, ResizeS));
				const FBox2D Box(FMath::Lerp(Area.From.Min, Area.Box.Min, P), FMath::Lerp(Area.From.Max, Area.Box.Max, P));
				const bool bLit = Area.Id == LitArea && T < LitAt + LitS;
				Pen.Fill(Box.Min, Box.Max, BuildCyan.CopyWithNewOpacity((0.04f + (bLit ? 0.22f * (1.f - Progress(T, LitAt, LitS)) : 0.f)) * Chalk * Survey));
				Pen.Perimeter(Box, Chalk, bLit ? 6.f : 4.f, BuildCyan.CopyWithNewOpacity((bLit ? 1.f : 0.75f) * Survey), true);
				// Its name and size inside its far-left corner, where they fit at the floor.
				const double U = Box.Min.X + 0.45, V = Box.Min.Y + 0.45;
				const double Cap = CapAt(ParcelName, U, V + 1.0);
				if (Chalk < 1.f || Box.GetSize().Y < Cap * 2.2 || Box.GetSize().X < 3.0) continue;
				const FString Name = BuildCut(Area.Name.ToUpper(), ParcelName, Cap, Box.GetSize().X - 0.9);
				Put(Name, ParcelName, U, V, Cap, BuildPaper.CopyWithNewOpacity((bLit ? 1.f : 0.7f) * Survey));
				const double FigCap = CapAt(ParcelFigure, U, V + Cap * 2.6);
				if (Box.GetSize().Y >= Cap * 1.8 + FigCap * 2.4)
				{
					const FString Fig = bLines && Area.Lines > 0 ? FString::Printf(TEXT("%d lines"), Area.Lines) : FString::Printf(TEXT("%d %s"), Area.Files, Area.Files == 1 ? TEXT("file") : TEXT("files"));
					Put(BuildCut(Fig, ParcelFigure, FigCap, Box.GetSize().X - 0.9), ParcelFigure, U, V + Cap * 1.8, FigCap, BuildCyan.CopyWithNewOpacity(0.6f * Survey));
				}
			}
		}

		// ---- The outline in the near margin: each domain typed, its capabilities under it; each line flies to its wing
		// or room when the structure places it -------------------------------------------------------------------------
		// The margin's grid (WP-V3: any count of domains): OutlineCols a row. Past OutlineRows rows they share the same band,
		// the pitch and the type shrinking together down to the floor (fewer capability lines, the rest counted); past what
		// fits with the names at the floor, the oldest domains scroll off (they are the first to have flown).
		const int32 Count = BuildDomains.Num();
		const double BandCm = OutlineRows * OutlineRowCm;
		const double MarginFloorCm = TextFloorCm(FVector2D(OutlineLeftCm + OutlineCols * OutlineColCm * 0.5, OutlineTopCm));
		const int32 MaxRows = FMath::Max(OutlineRows, FMath::FloorToInt32(BandCm / (MarginFloorCm * 1.9 + OutlineRowPadCm)));
		const int32 Rows = FMath::Clamp((Count + OutlineCols - 1) / OutlineCols, OutlineRows, MaxRows);
		const int32 First = FMath::Max(0, Count - Rows * OutlineCols);
		const double RowCm = BandCm / Rows;
		const double Scale = RowCm / OutlineRowCm;
		const auto MarginCap = [this, Scale](const BpType::FRecipe& Recipe, double U, double V) { return FMath::Max(Recipe.CapCm * Scale, TextFloorCm(FVector2D(U, V))); };
		for (int32 Index = First; Index < Count; ++Index)
		{
			const FBuildDomain& Domain = BuildDomains[Index];
			const int32 Slot = Index - First;
			const double X0 = OutlineLeftCm + (Slot % OutlineCols) * OutlineColCm;
			const double Y0 = OutlineTopCm + (Slot / OutlineCols) * RowCm;
			const double MaxW = OutlineColCm - 1.0;
			double Typed = (T - Domain.TypeAt) * BuildTypeCps;
			if (Typed <= 0.0) continue;
			double V = Y0;
			const FBpPlanWing* Wing = SheetPlan.IsValid() ? SheetPlan->wings.FindByPredicate([&Domain](const FBpPlanWing& W) { return W.id == Domain.Id; }) : nullptr;
			// The capability lines under the name that fit the row, the row's last line kept for "+n more".
			const double NameAdvance = MarginCap(DomainLine, X0, Y0 + 1.2 * Scale) * 1.9;
			const double LineCap = MarginCap(CapabilityLine, X0, Y0 + RowCm * 0.5);
			const int32 MaxLines = FMath::Max(0, FMath::FloorToInt32((RowCm + 0.1 - NameAdvance - LineCap) / (LineCap * 1.75)));
			const bool bMoreFits = NameAdvance + LineCap <= RowCm + 0.1;
			for (int32 Line = 0; Line < 1 + Domain.CapNames.Num(); ++Line)
			{
				const bool bName = Line == 0;
				const BpType::FRecipe& Recipe = bName ? DomainLine : CapabilityLine;
				const double Cap = MarginCap(Recipe, X0, V + 1.2 * Scale);
				if (!bName && Line > MaxLines)
				{
					// The column is full: the rest is counted.
					if (Line == MaxLines + 1 && bMoreFits) Put(FString::Printf(TEXT("+%d more"), Domain.CapNames.Num() - MaxLines), CapabilityLine, X0 + 0.8, V, Cap, BuildCyan.CopyWithNewOpacity(0.6f * Survey));
					break;
				}
				FString Full = bName ? Domain.Name : Domain.CapNames[Line - 1];
				Full = BuildCut(bName ? Full.ToUpper() : Full, Recipe, Cap, MaxW - (bName ? 0.0 : 0.8));
				const int32 Shown = FMath::Clamp(static_cast<int32>(Typed), 0, Full.Len());
				Typed -= Full.Len();
				const FVector2D Margin(X0 + (bName ? 0.0 : 0.8), V);
				V += bName ? Cap * 1.9 : Cap * 1.75;
				if (Shown <= 0) break;
				const FString Text = Full.Left(Shown);
				const double At = Domain.FlyAt.IsValidIndex(Line) ? Domain.FlyAt[Line] : 1.0e9;
				const float Fly = Progress(T, At, BuildFlyS);
				if (Fly >= 1.f) continue;
				// Where it lands: its wing's label row, or its room's far-left corner.
				FVector2D Land = Margin;
				double LandCap = Cap;
				if (Fly > 0.f && SheetPlan.IsValid())
				{
					if (bName && Wing)
					{
						Land = PlanToPaperCm(FVector2D(Wing->box.x, Wing->box.y)) - FVector2D(0.0, 2.4);
						LandCap = FMath::Max(1.9, TextFloorCm(Land));
					}
					else if (!bName)
					{
						const FString& CapRoom = Domain.CapIds[Line - 1];
						if (const FBpPlanRoom* Room = SheetPlan->rooms.FindByPredicate([&CapRoom](const FBpPlanRoom& R) { return R.id == CapRoom; }))
						{
							Land = PlanToPaperCm(FVector2D(Room->box.x, Room->box.y)) + RoomLandCm;
							LandCap = FMath::Max(0.9, TextFloorCm(Land));
						}
					}
				}
				const float E = EaseInOut(Fly);
				// A line the structure never placed recedes with the survey once the building stands.
				const float Alpha = (bBuildHasPlan && At >= 1.0e8 ? Survey : 1.f) * (Fly > 0.75f ? (1.f - Fly) / 0.25f : 1.f);
				const FVector2D P = FMath::Lerp(Margin, Land, static_cast<double>(E));
				// The flying size in 0.1 cm steps (WP-V3): every new size is a new set of glyphs for the font cache to rasterize
				// on the game thread, which a continuous size asked for on every redraw of a flight.
				const double FlyCap = E <= 0.f ? Cap : E >= 1.f ? LandCap : FMath::Max(FMath::Min(Cap, LandCap), FMath::GridSnap(FMath::Lerp(Cap, LandCap, static_cast<double>(E)), 0.1));
				Put(Text, Recipe, P.X, P.Y, FlyCap, (bName ? BuildPaper : BuildCyan).CopyWithNewOpacity((bName ? 1.f : 0.85f) * Alpha));
				// The typing caret.
				if (Shown < Full.Len() && Fly <= 0.f)
				{
					const double W = BuildWidthCm(Text.ToUpper(), Recipe, Cap);
					Pen.Fill(FVector2D(P.X + W + 0.15, P.Y), FVector2D(P.X + W + 0.15 + Cap * 0.45, P.Y + Cap), BuildCyan.CopyWithNewOpacity(0.8f));
				}
				// The domain's rule under its name.
				if (bName && Fly <= 0.f && Shown >= Full.Len()) Pen.Line(FVector2D(X0, P.Y + Cap * 1.35), FVector2D(X0 + FMath::Min(MaxW, BuildWidthCm(Full, Recipe, Cap)), P.Y + Cap * 1.35), 2.f, BuildCyan.CopyWithNewOpacity(0.5f * Alpha));
			}
		}
	}

	// ---- Judging: the batch in pencil brackets, provisional readings pencilled, final readings inked ----------------
	if (bWithPlan && SheetPlan.IsValid())
	{
		for (const FBpPlanTile& Tile : SheetPlan->tiles)
		{
			const FVector2D A = PlanToPaperCm(FVector2D(Tile.box.x, Tile.box.y)), B = PlanToPaperCm(FVector2D(Tile.box.x + Tile.box.w, Tile.box.y + Tile.box.h));
			const FBox2D Box(A, B);
			if (const FString* Ink = BuildInk.Find(Tile.id))
			{
				const float E = Progress(T, InkAt.FindRef(Tile.id), BuildInkS) * Settle;
				if (E > 0.f)
				{
					const FLinearColor C = HealthInk(*Ink);
					const FBox2D In(Box.Min + FVector2D(0.18, 0.18), Box.Max - FVector2D(0.18, 0.18));
					Pen.Fill(In.Min, In.Max, C.CopyWithNewOpacity(0.6f * E));
					Pen.Perimeter(In, E, 6.f, C.CopyWithNewOpacity(Settle), false);
				}
				if (E >= 1.f || !bBuild) continue;
			}
			if (!bBuild) continue;
			if (const FString* Pencil = BuildPencil.Find(Tile.id))
			{
				const float E = Progress(T, PencilAt.FindRef(Tile.id), BuildInkS);
				const FBox2D In(Box.Min + FVector2D(0.25, 0.25), Box.Max - FVector2D(0.25, 0.25));
				const FLinearColor C = HealthInk(*Pencil);
				Pen.Perimeter(In, E, 5.f, C.CopyWithNewOpacity(0.95f), true);
				// The pencil's hatch: diagonal strokes across the tile, drawn in as the pencil goes round.
				const double W = In.GetSize().X, H = In.GetSize().Y;
				for (double K = 0.6; K < W + H; K += 0.9)
				{
					const FVector2D From(In.Min.X + FMath::Max(0.0, K - H), In.Max.Y - FMath::Min(K, H));
					const FVector2D To(In.Min.X + FMath::Min(K, W), In.Max.Y - FMath::Max(0.0, K - W));
					if (K / (W + H) <= E) Pen.Line(From, To, 3.f, C.CopyWithNewOpacity(0.6f));
				}
			}
			if (BuildJudging.Contains(Tile.id))
			{
				// Being judged now (B's "the pencil marks what is being judged"): a soft halo round the tile, a pencil wash
				// on it, a firm pencil edge and heavy corner brackets, steady, so the batch reads at the target pose.
				const FVector2D Halo(JudgeHaloCm, JudgeHaloCm);
				Pen.Fill(Box.Min - Halo, Box.Max + Halo, BuildPaper.CopyWithNewOpacity(JudgeHaloA));
				Pen.Fill(Box.Min, Box.Max, BuildPaper.CopyWithNewOpacity(JudgeWashA));
				Pen.Perimeter(Box, 1.f, JudgeEdgePx, BuildPaper.CopyWithNewOpacity(JudgeEdgeA), false);
				Pen.Brackets(Box, JudgeBracketPx, BuildPaper);
			}
		}
	}

	// ---- The title block, near-right: the product, the phase and its count, the eight phases as a strip -------------
	if (bBuild)
	{
		const double U0 = BlockLeftCm + 0.9, Inner = BlockRightCm - BlockLeftCm - 1.8;
		const double StripH = 0.55, Pad = 0.9;
		const double FigCap = CapAt(BpType::Figure, (BlockLeftCm + BlockRightCm) * 0.5, BlockBottomCm - Pad);
		const double StripTop = BlockBottomCm - Pad - StripH - FigCap * 1.6;
		const double SubCap = CapAt(BpType::TitleSub, (BlockLeftCm + BlockRightCm) * 0.5, StripTop - 0.7);
		const double SubTop = StripTop - 0.7 - SubCap;
		const double TitleCap = CapAt(BpType::Title, (BlockLeftCm + BlockRightCm) * 0.5, SubTop - 0.9);
		const double TitleTop = SubTop - 0.9 - TitleCap;
		const double Top = TitleTop - Pad;
		const FLinearColor BlockInk = BuildCyan.CopyWithNewOpacity(0.55f);
		Pen.Perimeter(FBox2D(FVector2D(BlockLeftCm, Top), FVector2D(BlockRightCm, BlockBottomCm)), 1.f, 3.f, BlockInk, false);
		Pen.Line(FVector2D(BlockLeftCm, SubTop - 0.45), FVector2D(BlockRightCm, SubTop - 0.45), 2.f, BlockInk);
		// The name, cut to the block (a long one never pushes it off the paper).
		const FString Name = BuildName.IsEmpty() ? FBpLinkModule::Get().NameOf(FBpLinkModule::Get().GetProductSlug()) : BuildName;
		Put(BuildCut(Name.ToUpper(), BpType::Title, TitleCap, Inner), BpType::Title, U0, TitleTop, TitleCap, BuildPaper);
		const int32 Current = PhaseAt(bBuildFailed ? BuildFailPhase : BuildPhase);
		FString Sub;
		if (bBuildFailed) Sub = FString::Printf(TEXT("stopped at %s"), *FBpLinkModule::PhaseLabel(BuildFailPhase));
		else if (bBuildEnded) Sub = TEXT("done · in bp");
		else
		{
			Sub = FString::Printf(TEXT("onboarding · %s"), *FBpLinkModule::PhaseLabel(BuildPhase.IsEmpty() ? FString(TEXT("check")) : BuildPhase));
			if (BuildOf > 0 && BuildCountPhase == BuildPhase) Sub += FString::Printf(TEXT(" · %d of %d judged"), BuildN, BuildOf);
		}
		Put(BuildCut(Sub.ToUpper(), BpType::TitleSub, SubCap, Inner), BpType::TitleSub, U0, SubTop, SubCap, (bBuildFailed ? HealthBad : BuildCyan).CopyWithNewOpacity(0.95f));
		// The strip: a cell per phase, done ones filled, the current one amber (red where it stopped), the rest outlined.
		const int32 Count = UE_ARRAY_COUNT(Phases);
		const double Gap = 0.3, CellW = (Inner - Gap * (Count - 1)) / Count;
		for (int32 Index = 0; Index < Count; ++Index)
		{
			const FVector2D Min(U0 + Index * (CellW + Gap), StripTop), Max(Min.X + CellW, StripTop + StripH);
			const bool bDone = bBuildEnded && !bBuildFailed ? true : Index < Current;
			const bool bNow = Index == Current && !(bBuildEnded && !bBuildFailed);
			if (bDone) Pen.Fill(Min, Max, BuildCyan.CopyWithNewOpacity(0.7f));
			else if (bNow) Pen.Fill(Min, Max, (bBuildFailed ? HealthBad : BuildAmber).CopyWithNewOpacity(0.9f));
			else Pen.Perimeter(FBox2D(Min, Max), 1.f, 2.f, BuildCyan.CopyWithNewOpacity(0.4f), false);
		}
		const FString Step = Current >= 0 ? FString::Printf(TEXT("step %d of %d"), Current + 1, Count) : FString(TEXT("starting"));
		Put(Step.ToUpper(), BpType::Figure, U0, StripTop + StripH + FigCap * 0.6, FigCap, BuildCyan.CopyWithNewOpacity(0.7f));
	}

	if (Pen.Tris.Num() > 0)
	{
		FCanvasTriangleItem Item(Pen.Tris, GWhiteTexture);
		Item.BlendMode = SE_BLEND_AlphaBlend;
		Canvas->DrawItem(Item);
	}
	for (const FBuildText& Text : Texts)
	{
		FCanvasTextItem Item(Text.Px, FText::FromString(Text.Text), Text.Font, Text.Color);
		Item.HorizSpacingAdjust = Text.Tracking;
		Canvas->DrawItem(Item);
	}
}
