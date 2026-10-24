// The table's marks (spark vr-fidelity-40 FC1): the pins on the features that carry open findings, the scan line that
// follows a running lens scan, and the decision card that asks about one finding. All three read the scan side BpLink
// polls (GET .../scans, .../scan, .../waves); nothing here invents a finding, a job or a place. Places are the plan's
// boxes, as the sheet draws them (BpTable.h's frame of reference).
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpType.h"
#include "CanvasItem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GlobalRenderResources.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialParameterCollection.h"
#include "Misc/PackageName.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	const FLinearColor Navy(FColor(0x0B, 0x2A, 0x6B));
	const FLinearColor CardInk(FColor(0x14, 0x22, 0x3C));
	const FLinearColor CardPaper(FColor(0xF3, 0xE9, 0xD2));
	const FLinearColor AmberInk(FColor(0xFF, 0xB5, 0x47));
	const FLinearColor Cyan(FColor(0xBF, 0xE8, 0xFF));

	/** A finding is open (it has a pin, and the card may ask about it) while it waits for a decision. */
	bool IsOpen(const FBpProposal& Proposal)
	{
		return Proposal.status == TEXT("proposed");
	}

	template <typename T>
	T* LoadSoft(const TSoftObjectPtr<T>& Ref)
	{
		const FSoftObjectPath Path = Ref.ToSoftObjectPath();
		if (!Path.IsValid() || !FPackageName::DoesPackageExist(Path.GetLongPackageName()))
		{
			UE_LOG(LogBpTable, Warning, TEXT("%s missing, that mark is not drawn"), *Path.ToString());
			return nullptr;
		}
		return Ref.LoadSynchronous();
	}

	FVector2D Measure(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return FVector2D(Renderer->GetFontMeasureService()->Measure(Text, Font));
		}
		return FVector2D(Text.Len() * 0.55f * Font.Size * 1.333f, 1.17f * Font.Size * 1.333f);
	}

	/** A font whose cap height is CapPx pixels (Roboto: cap 0.711 em, Slate's points at 96 DPI). */
	FSlateFontInfo CapFont(const TCHAR* Style, float CapPx)
	{
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}

	/** Canvas text in the sheet's family, which needs a font object (ABpTable::TextFontObject; BpType's metrics). */
	FSlateFontInfo CanvasFont(const TCHAR* Style, float CapPx)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
	}

	/** The survey pin as modelled (ArtSource/survey-pin): its height, and its tag's height (the tag sits at the top). */
	constexpr double PinModelCm = 6.38;
	constexpr double PinTagModelCm = 1.4;

	/** The first paragraph under a markdown heading of the finding's body ("## Impact"), one line, or empty. */
	FString Section(const FString& Body, const FString& Heading)
	{
		TArray<FString> Lines;
		Body.ParseIntoArrayLines(Lines, false);
		for (int32 Index = 0; Index < Lines.Num(); ++Index)
		{
			if (Lines[Index].TrimStartAndEnd() != TEXT("## ") + Heading) continue;
			for (int32 Next = Index + 1; Next < Lines.Num(); ++Next)
			{
				const FString Line = Lines[Next].TrimStartAndEnd();
				if (Line.StartsWith(TEXT("#"))) return FString();
				if (!Line.IsEmpty()) return Line;
			}
		}
		return FString();
	}

	/**
	 * A small isometric drawing of a room for the decision card (the concept's thumbnail): the room's box, its bays as
	 * floor plates and its tiles as blocks at their heights under the active lens, all from the plan's boxes; the tile the
	 * finding is about in amber.
	 */
	class SBpRoomSketch : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SBpRoomSketch) {}
		SLATE_END_ARGS()

		struct FBlock
		{
			FVector Min;
			FVector Max;
			bool bAccent = false;
		};

		void Construct(const FArguments&) {}
		void SetBlocks(TArray<FBlock> In) { Blocks = MoveTemp(In); Invalidate(EInvalidateWidgetReason::Paint); }

		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(300.0, 230.0); }

		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			if (Blocks.Num() == 0) return Layer;
			// Isometric: plan x to the right-down, plan y to the left-down, height up.
			const float C = FMath::Cos(FMath::DegreesToRadians(30.f)), S = 0.5f;
			const auto Project = [C, S](const FVector& P) { return FVector2f(static_cast<float>((P.X - P.Y) * C), static_cast<float>((P.X + P.Y) * S - P.Z)); };
			FBox2f Bounds(ForceInit);
			for (const FBlock& Block : Blocks)
			{
				for (int32 Corner = 0; Corner < 8; ++Corner)
				{
					Bounds += Project(FVector(Corner & 1 ? Block.Max.X : Block.Min.X, Corner & 2 ? Block.Max.Y : Block.Min.Y, Corner & 4 ? Block.Max.Z : Block.Min.Z));
				}
			}
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const FVector2f Extent = Bounds.GetSize();
			const float Scale = FMath::Min((Size.X - 8.f) / FMath::Max(Extent.X, 1.f), (Size.Y - 8.f) / FMath::Max(Extent.Y, 1.f));
			const FVector2f Offset = (Size - Extent * Scale) * 0.5f - Bounds.Min * Scale;
			const auto Px = [&](const FVector& P) { return Project(P) * Scale + Offset; };
			for (const FBlock& Block : Blocks)
			{
				const FVector A = Block.Min, B = Block.Max;
				const FVector P[8] = { FVector(A.X, A.Y, A.Z), FVector(B.X, A.Y, A.Z), FVector(B.X, B.Y, A.Z), FVector(A.X, B.Y, A.Z),
					FVector(A.X, A.Y, B.Z), FVector(B.X, A.Y, B.Z), FVector(B.X, B.Y, B.Z), FVector(A.X, B.Y, B.Z) };
				const int32 Edges[12][2] = { {0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7} };
				const FLinearColor Color = Block.bAccent ? AmberInk : Navy.CopyWithNewOpacity(0.75f);
				for (const auto& Edge : Edges)
				{
					TArray<FVector2f> Line = { Px(P[Edge[0]]), Px(P[Edge[1]]) };
					FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Line, ESlateDrawEffect::None, Color, true, Block.bAccent ? 3.f : 1.6f);
				}
			}
			return Layer + 1;
		}

	private:
		TArray<FBlock> Blocks;
	};

	/** Runs Fn on every table with a plan; before any has one (-ExecCmds at startup) the command waits for the plan, as
	 *  BpLevel.* does. */
	void WithPlannedTables(UWorld* World, const FString& Command, TFunctionRef<void(ABpTable&)> Fn)
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
			UE_LOG(LogBpTable, Log, TEXT("BpTable: deferred \"%s\" until the plan arrives"), *Command);
		}
	}

	/** BpScan.Start <wing|room|bay|feature id> [lens]: POST a lens scan as the web does; the scan line follows the job. */
	FAutoConsoleCommandWithWorldAndArgs CmdScanStart(
		TEXT("BpScan.Start"),
		TEXT("BpScan.Start <wing, room, bay or feature id> [lens]: start a lens scan through apps/server (POST .../scans, the web's route); the table's scan line follows it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0) return;
			const FString Lens = Args.Num() > 1 ? Args[1] : FString();
			WithPlannedTables(World, TEXT("BpScan.Start ") + FString::Join(Args, TEXT(" ")), [&Args, &Lens](ABpTable& Table) { Table.StartScan(Args[0], Lens); });
		}));

	/** BpCard.Show [1|0]: show or hide the decision card. */
	FAutoConsoleCommandWithWorldAndArgs CmdCardShow(
		TEXT("BpCard.Show"),
		TEXT("BpCard.Show [1|0]: show (default) or hide the decision card, which asks about one open finding."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const bool bShow = Args.Num() == 0 || Args[0] != TEXT("0");
			WithPlannedTables(World, TEXT("BpCard.Show ") + FString(bShow ? TEXT("1") : TEXT("0")), [bShow](ABpTable& Table) { Table.ShowCard(bShow); });
		}));
}

void ABpTable::LoadMarks()
{
	// The tags' text: an atlas the mesh's own tag samples at the instance's cell (its tag faces are UV'd 0..1,
	// ArtSource/survey-pin), so the pins and their tags are one batch: the body one draw per pass, the tag one more.
	if (UMaterialInterface* Material = LoadSoft(TagMaterial))
	{
		TagAtlas = NewObject<UCanvasRenderTarget2D>(this);
		TagAtlas->ClearColor = FLinearColor::Transparent;
		TagAtlas->RenderTargetFormat = RTF_RGBA8;
		TagAtlas->bAutoGenerateMips = true;
		TagAtlas->MipsSamplerFilter = TF_Trilinear;
		TagAtlas->Filter = TF_Default;
		TagAtlas->OnCanvasRenderTargetUpdate.AddDynamic(this, &ABpTable::DrawTags);
		TagAtlas->InitAutoFormat(TagCellWidthPx * TagAtlasCols, TagCellHeightPx * TagAtlasRows);
		TagMid = UMaterialInstanceDynamic::Create(Material, this);
		TagMid->SetTextureParameterValue(TEXT("Atlas"), TagAtlas);
	}
	if (UStaticMesh* Mesh = LoadSoft(PinMesh))
	{
		Pins->SetStaticMesh(Mesh);
		// The glTF instances' parent is not flagged for instancing: M_PinBody stands in on the body (fc1_marks.py), the tag
		// material on the tag.
		const int32 BodySlot = Pins->GetMaterialIndex(TEXT("pin_body"));
		if (BodySlot != INDEX_NONE)
		{
			if (UMaterialInterface* Body = LoadSoft(PinBodyMaterial)) Pins->SetMaterial(BodySlot, Body);
		}
		const int32 TagSlot = Pins->GetMaterialIndex(TEXT("pin_tag"));
		if (TagSlot != INDEX_NONE && TagMid) Pins->SetMaterial(TagSlot, TagMid);
	}
	ScanParams = LoadSoft(ScanCollection);
	WriteScanParams(0.f);

	// The decision card: a world-space panel, hidden until asked for (BpCard.Show), facing the target eye.
	Card = NewObject<UWidgetComponent>(this, TEXT("DecisionCard"));
	Card->SetupAttachment(Root);
	Card->SetWidgetSpace(EWidgetSpace::World);
	Card->SetDrawSize(FVector2D(CardWidthCm * CardPxPerCm, CardHeightCm * CardPxPerCm));
	Card->SetDrawAtDesiredSize(false);
	Card->SetPivot(FVector2D(0.5, 0.5));
	Card->SetBlendMode(EWidgetBlendMode::Transparent);
	Card->SetTwoSided(false);
	Card->SetBackgroundColor(FLinearColor::Transparent);
	Card->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Card->SetCastShadow(false);
	Card->SetWindowFocusable(false);
	Card->SetManuallyRedraw(true);
	Card->SetTranslucentSortPriority(2);
	// A little over 1, so the card's paper sits above the bloom threshold as the concept's card glows.
	Card->SetTintColorAndOpacity(FLinearColor(1.15f, 1.15f, 1.15f, 1.f));
	Card->SetRelativeScale3D(FVector(1.0 / CardPxPerCm));
	Card->RegisterComponent();
	Card->SetVisibility(false);
}

void ABpTable::ReceiveScanState(const FBpScanState& State)
{
	if (!SheetPlan.IsValid()) return;
	BuildPins(State);

	// The scan line: the first running measure job (a queued one has not started reading).
	const FBpScanJob* Job = State.Jobs.FindByPredicate([](const FBpScanJob& J) { return J.kind == TEXT("measure") && J.status == TEXT("running"); });
	if (Job)
	{
		if (Job->id != ScanJob)
		{
			ScanJob = Job->id;
			// The scope's features' tiles: their union is the place the line crosses.
			ScanPlanBox = FBox2D(ForceInit);
			ScanWing.Reset();
			TSet<FString> Features(Job->scope.features);
			for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
			{
				const FBpPlanTile& Tile = SheetPlan->tiles[Index];
				if (Job->scope.kind != TEXT("all") && !Features.Contains(Tile.id)) continue;
				ScanPlanBox += FVector2D(Tile.box.x, Tile.box.y);
				ScanPlanBox += FVector2D(Tile.box.x + Tile.box.w, Tile.box.y + Tile.box.h);
				const int32 Room = TileRoom.IsValidIndex(Index) ? TileRoom[Index] : INDEX_NONE;
				const FString Wing = RoomWing.IsValidIndex(Room) ? RoomWing[Room] : FString();
				ScanWing = ScanWing.IsEmpty() || ScanWing == Wing ? Wing : TEXT("*");
			}
			ScanY = ScanTargetY = ScanPlanBox.bIsValid ? ScanPlanBox.Min.Y : 0.0;
			UE_LOG(LogBpTable, Log, TEXT("BpTable: scan job=%s lens=%s scope=%s:%s features=%d"), *Job->id, *Job->lens, *Job->scope.kind, *Job->scope.id, Job->scope.features.Num());
		}
		ScanRun = Job->run_id;
		// The feature being read: the run's latest reading or measured row (blueprint-ui.md, Views: "current").
		const FBpActivity* Current = nullptr;
		for (const FBpActivity& Row : State.Scan.activity)
		{
			if (Row.run_id != ScanRun || (Row.kind != TEXT("reading") && Row.kind != TEXT("measured")) || Row.feature.IsEmpty()) continue;
			if (!Current || Row.id > Current->id) Current = &Row;
		}
		if (Current)
		{
			const int32 Tile = SheetPlan->tiles.IndexOfByPredicate([Current](const FBpPlanTile& T) { return T.id == Current->feature; });
			if (Tile != INDEX_NONE)
			{
				const FBpPlanBox& Box = SheetPlan->tiles[Tile].box;
				const double Target = Box.y + Box.h * (Current->kind == TEXT("measured") ? 1.0 : 0.5);
				if (Target != ScanTargetY) UE_LOG(LogBpTable, Log, TEXT("BpTable: scan current=%s (%s)"), *Current->feature, *Current->kind);
				ScanTargetY = Target;
			}
		}
		bScanLive = ScanPlanBox.bIsValid;
	}
	else
	{
		if (bScanLive) UE_LOG(LogBpTable, Log, TEXT("BpTable: scan job=%s ended"), *ScanJob);
		bScanLive = false;
		ScanJob.Reset();
	}
	if (bScanLive || ScanStrength > 0.f) SetActorTickInterval(0.f);
	if (bCardShown) RefreshCard();
}

void ABpTable::BuildPins(const FBpScanState& State)
{
	if (!SheetPlan.IsValid() || !State.bHasScan) return;
	// One pin per feature with an open finding; its tag names the first such finding (store order) and the lens, and
	// how many more the feature has.
	TMap<FString, int32> TileOf;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index) TileOf.Add(SheetPlan->tiles[Index].id, Index);
	TArray<FPin> Next;
	TMap<int32, int32> PinOfTile;
	FString Key;
	int32 Open = 0;
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		if (!IsOpen(Proposal)) continue;
		++Open;
		Key += Proposal.id + TEXT(",");
		const int32* Tile = TileOf.Find(Proposal.feature);
		if (!Tile) continue;
		if (const int32* Pin = PinOfTile.Find(*Tile))
		{
			++Next[*Pin].Findings;
			continue;
		}
		if (Next.Num() >= TagAtlasCols * TagAtlasRows) continue;
		FPin Pin;
		Pin.Tile = *Tile;
		Pin.Room = TileRoom.IsValidIndex(*Tile) ? TileRoom[*Tile] : INDEX_NONE;
		Pin.Line1 = Proposal.id.ToUpper();
		Pin.Findings = 1;
		PinOfTile.Add(*Tile, Next.Num());
		Next.Add(Pin);
	}
	// Tags that would overlap from the target eye merge (FC3): in store order, a pin within TagClearUCm across of a tagged
	// pin, and nearer or farther than it by less than the paper its tag hides from the target eye, gives its tag up to
	// that pin, whose second line counts the findings it then carries. Every pin still stands on its own feature.
	const double TagTopCm = PinModelCm * PinScale, TagCm = PinTagModelCm * PinScale;
	const double EyeAbove = ABpGameMode::TargetEyeAboveTopCm + GlassRecessCm;
	const auto PaperOf = [this](const FPin& Pin)
	{
		const FBpPlanBox& Box = SheetPlan->tiles[Pin.Tile].box;
		return PlanToPaperCm(FVector2D(Box.x + Box.w * 0.5, Box.y + Box.h * 0.5));
	};
	int32 Merged = 0;
	for (int32 Index = 0; Index < Next.Num(); ++Index)
	{
		const FVector2D Here = PaperOf(Next[Index]);
		for (int32 Earlier = 0; Earlier < Index; ++Earlier)
		{
			if (!Next[Earlier].bTagged) continue;
			const FVector2D There = PaperOf(Next[Earlier]);
			const double Along = (PaperDepthCm * 0.5 - FMath::Min(Here.Y, There.Y)) + (TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm);
			// More than the tag's own cover: a tag nearer the centre line also climbs the screen, and the tags kept need a gap.
			const double Hidden = 1.6 * TagCm * Along / FMath::Max(EyeAbove - TagTopCm, 1.0);
			if (FMath::Abs(Here.X - There.X) >= TagClearUCm || FMath::Abs(Here.Y - There.Y) >= Hidden) continue;
			Next[Index].bTagged = false;
			Next[Earlier].Findings += Next[Index].Findings;
			++Merged;
			break;
		}
	}
	for (FPin& Pin : Next)
	{
		// The second line only counts: a lens name at the tag's floor does not fit the tag (BpType.h).
		Pin.Line2 = Pin.bTagged && Pin.Findings > 1 ? FString::Printf(TEXT("+%d"), Pin.Findings - 1) : FString();
	}
	if (Key == PinsKey && PinList.Num() == Next.Num()) return;
	UE_LOG(LogBpTable, Log, TEXT("BpTable: pin tags merged=%d of %d (tags that would overlap from the target eye)"), Merged, Next.Num());
	PinsKey = Key;
	PinList = MoveTemp(Next);
	Pins->ClearInstances();
	TArray<FTransform> Places;
	Places.Init(FTransform::Identity, PinList.Num());
	if (Pins->GetStaticMesh() && Places.Num() > 0)
	{
		Pins->SetNumCustomDataFloats(4);
		Pins->AddInstances(Places, false, false, false);
		// Each pin's tag reads its own cell of the atlas: custom data 0, 1 its UV offset, 2, 3 its UV size.
		TArray<float> Cells;
		for (int32 Index = 0; Index < PinList.Num(); ++Index)
		{
			const int32 Col = Index % TagAtlasCols, Row = Index / TagAtlasCols;
			Cells.Append({ static_cast<float>(Col) / TagAtlasCols, static_cast<float>(Row) / TagAtlasRows, 1.f / TagAtlasCols, 1.f / TagAtlasRows });
		}
		Pins->SetCustomData(0, PinList.Num() - 1, Cells, true);
	}
	if (TagAtlas) TagAtlas->UpdateResource();
	PlacePins();
	UE_LOG(LogBpTable, Log, TEXT("BpTable: pins=%d tagged=%d open_findings=%d (pins on the features that carry them)"),
		Pins->GetInstanceCount(), TagMid ? Pins->GetInstanceCount() : 0, Open);
}

void ABpTable::PlacePins()
{
	if (!SheetPlan.IsValid() || PinList.Num() == 0) return;
	TArray<FTransform> PinPlaces;
	for (const FPin& Pin : PinList)
	{
		const FBpPlanTile& Tile = SheetPlan->tiles[Pin.Tile];
		const FTransform Group = GroupTransformForRoom(Pin.Room);
		// On its tile: the paper at rest, the lifted room's tile top when its room is up.
		const float Rise = RoomRiseEase(Pin.Room);
		const FString* Reading = Tile.health.Find(ActiveLens);
		const float StandCm = Rise * TileHeightCm(Reading ? *Reading : FString());
		const FVector2D Centre = PlanToPaperCm(FVector2D(Tile.box.x + Tile.box.w * 0.5, Tile.box.y + Tile.box.h * 0.5));
		const FVector Foot = Group.TransformPosition(PaperCmToLocal(Centre, StandCm));
		PinPlaces.Add(FTransform(FRotator(0.f, PinYawDeg, 0.f), Foot, FVector(Pin.bTagged ? PinScale : PinScale * MergedPinRatio)));
	}
	if (Pins->GetInstanceCount() == PinPlaces.Num()) Pins->BatchUpdateInstancesTransforms(0, PinPlaces, false, true);
}

void ABpTable::DrawTags(UCanvas* Canvas, int32 Width, int32 Height)
{
	if (!Canvas) return;
	// Text writes the target's alpha only when the canvas is told to (FCanvasTextItem::Draw).
	if (Canvas->Canvas) Canvas->Canvas->SetWriteDestinationAlpha(true);
	// Each tag a paper card with an amber rule along its top, the finding's id in bold over its lens.
	TArray<FCanvasUVTri> Tris;
	const auto Fill = [&Tris](const FVector2D& Min, const FVector2D& Max, const FLinearColor& Color)
	{
		FCanvasUVTri T;
		T.V0_Color = T.V1_Color = T.V2_Color = Color;
		T.V0_Pos = Min; T.V1_Pos = FVector2D(Max.X, Min.Y); T.V2_Pos = Max;
		Tris.Add(T);
		T.V0_Pos = Min; T.V1_Pos = Max; T.V2_Pos = FVector2D(Min.X, Max.Y);
		Tris.Add(T);
	};
	struct FTagText { FString Text; FVector2D Px; FSlateFontInfo Font; FLinearColor Color; float Tracking; };
	TArray<FTagText> Texts;
	const float Pad = 10.f;
	// One cap for both lines: BpType::PinTag's, which at PinScale meets the floor at the farthest pin (the fc3 legibility
	// table); a line that does not fit at it is dropped, never set smaller.
	const float Cap = static_cast<float>(BpType::PinTag.CapCm);
	const float Track = static_cast<float>(BpType::PinTag.TrackEm / BpType::CapPerEm) * Cap;
	// A line box's top is (ascender - cap) above the cap's top.
	const auto Top = [Cap](float CapTop) { return CapTop - static_cast<float>((BpType::AscPerEm - BpType::CapPerEm) / BpType::CapPerEm) * Cap; };
	const FLinearColor CountInk = AmberInk * 0.55f + Navy * 0.45f;
	for (int32 Index = 0; Index < PinList.Num(); ++Index)
	{
		// A merged pin's tag stays blank (transparent): its findings are counted on the tag it merged into.
		if (!PinList[Index].bTagged) continue;
		const FVector2D Cell(Index % TagAtlasCols * TagCellWidthPx, Index / TagAtlasCols * TagCellHeightPx);
		// A pixel of margin so the mips never bleed one card into the next.
		const FVector2D Min = Cell + FVector2D(4.0, 4.0), Max = Cell + FVector2D(TagCellWidthPx - 4.0, TagCellHeightPx - 4.0);
		Fill(Min, Max, CardPaper);
		Fill(Min, FVector2D(Max.X, Min.Y + 8.0), AmberInk);
		const float Room = TagCellWidthPx - 8.f - 2.f * Pad;
		const FSlateFontInfo Bold = CanvasFont(TEXT("Bold"), Cap);
		const auto Fits = [&](const FString& Text) { return !Text.IsEmpty() && Measure(Text, Bold).X + Track * Text.Len() <= Room; };
		if (Fits(PinList[Index].Line1)) Texts.Add({ PinList[Index].Line1, FVector2D(Min.X + Pad, Top(Min.Y + 26.f)), Bold, Navy, Track });
		if (Fits(PinList[Index].Line2)) Texts.Add({ PinList[Index].Line2, FVector2D(Min.X + Pad, Top(Min.Y + 26.f + Cap + 20.f)), Bold, CountInk, Track });
	}
	if (Tris.Num() > 0)
	{
		FCanvasTriangleItem Item(Tris, GWhiteTexture);
		Item.BlendMode = SE_BLEND_AlphaBlend;
		Canvas->DrawItem(Item);
	}
	for (const FTagText& Text : Texts)
	{
		FCanvasTextItem Item(Text.Px, FText::FromString(Text.Text), Text.Font, Text.Color);
		Item.HorizSpacingAdjust = Text.Tracking;
		Canvas->DrawItem(Item);
	}
}

void ABpTable::UpdateScan(float DeltaSeconds)
{
	// The line eases toward the row being read, and fades in while the job runs, out when it ends.
	const double Step = ScanEaseCmPerS / BpPlanUnitCm * DeltaSeconds;
	ScanY += FMath::Clamp(ScanTargetY - ScanY, -Step, Step);
	ScanStrength = bScanLive ? FMath::Min(1.f, ScanStrength + DeltaSeconds / 0.3f) : FMath::Max(0.f, ScanStrength - DeltaSeconds / ScanFadeS);
	WriteScanParams(ScanStrength);
	if (!bScanLive && ScanStrength <= 0.f && !IsLevelMoving()) SetActorTickInterval(0.25f);
}

void ABpTable::WriteScanParams(float Strength)
{
	if (!ScanParams) return;
	UWorld* World = GetWorld();
	if (!World) return;
	FVector Centre = FVector::ZeroVector, Axis = FVector::ForwardVector, Side = FVector::RightVector;
	double HalfLength = 0.0, HalfWidth = ScanHalfWidthCm;
	if (SheetPlan.IsValid() && ScanPlanBox.bIsValid)
	{
		// The scanned place's group: the paper, or its wing's while that wing is lifted (the line then crosses the lifted
		// volumes, scaled with them).
		FTransform Group = WingGroupTransform(0.f);
		if (!ScanWing.IsEmpty() && ScanWing == AnimWing) Group = LiftedWingTransform();
		const FTransform& Actor = GetActorTransform();
		const FVector2D Mid = PlanToPaperCm(FVector2D(ScanPlanBox.GetCenter().X, ScanY));
		Centre = Actor.TransformPosition(Group.TransformPosition(PaperCmToLocal(Mid, 0.f)));
		// Plan y runs toward the viewer (local -X), plan x to the right (local +Y).
		Axis = Actor.TransformVectorNoScale(FVector(-1.0, 0.0, 0.0));
		Side = Actor.TransformVectorNoScale(FVector(0.0, 1.0, 0.0));
		HalfLength = (ScanPlanBox.GetSize().X * 0.5 * BpPlanUnitCm + ScanOverrunCm) * Group.GetScale3D().Y;
		HalfWidth = ScanHalfWidthCm * Group.GetScale3D().X;
	}
	UKismetMaterialLibrary::SetVectorParameterValue(World, ScanParams, TEXT("ScanCentre"), FLinearColor(Centre.X, Centre.Y, Centre.Z, HalfWidth));
	UKismetMaterialLibrary::SetVectorParameterValue(World, ScanParams, TEXT("ScanAxis"), FLinearColor(Axis.X, Axis.Y, Axis.Z, Strength));
	UKismetMaterialLibrary::SetVectorParameterValue(World, ScanParams, TEXT("ScanSide"), FLinearColor(Side.X, Side.Y, Side.Z, HalfLength));
}

void ABpTable::StartScan(const FString& Id, const FString& Lens)
{
	if (!SheetPlan.IsValid())
	{
		UE_LOG(LogBpTable, Warning, TEXT("BpScan: refused, no plan yet"));
		return;
	}
	// The scope as the web names it (blueprint-ui.md, Scope ids): a wing by its WING_DEFS key, a room by its domain, a bay
	// by its capability, a feature by its slug; its features are the plan's tiles under it.
	FString Kind, ScopeId, Label;
	TArray<FString> Features;
	const auto TilesWhere = [this, &Features](TFunctionRef<bool(int32 Tile)> Keep)
	{
		for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
		{
			if (Keep(Index)) Features.Add(SheetPlan->tiles[Index].id);
		}
	};
	TMap<FString, int32> BayIndex;
	for (int32 Index = 0; Index < SheetPlan->bays.Num(); ++Index) BayIndex.Add(SheetPlan->bays[Index].id, Index);
	if (const FBpPlanWing* Wing = FindWing(Id))
	{
		Kind = TEXT("wing");
		Id.Split(TEXT(":"), nullptr, &ScopeId, ESearchCase::CaseSensitive, ESearchDir::FromEnd);
		if (ScopeId.IsEmpty()) ScopeId = Id;
		Label = Wing->name;
		TilesWhere([this, &Id](int32 Tile) { return TileRoom.IsValidIndex(Tile) && RoomWing.IsValidIndex(TileRoom[Tile]) && RoomWing[TileRoom[Tile]] == Id; });
	}
	else if (const FBpPlanRoom* Room = FindRoom(Id))
	{
		Kind = TEXT("room");
		ScopeId = Id;
		Label = Room->name;
		const int32 RoomIndex = SheetPlan->rooms.IndexOfByPredicate([&Id](const FBpPlanRoom& R) { return R.id == Id; });
		TilesWhere([this, RoomIndex](int32 Tile) { return TileRoom.IsValidIndex(Tile) && TileRoom[Tile] == RoomIndex; });
	}
	else if (const int32* Bay = BayIndex.Find(Id))
	{
		Kind = TEXT("bay");
		ScopeId = Id;
		Label = SheetPlan->bays[*Bay].name;
		TilesWhere([this, &Id](int32 Tile) { return SheetPlan->tiles[Tile].parentId == Id; });
	}
	else if (const FBpPlanTile* Tile = SheetPlan->tiles.FindByPredicate([&Id](const FBpPlanTile& T) { return T.id == Id; }))
	{
		Kind = TEXT("feature");
		ScopeId = Id;
		Label = Tile->name;
		Features.Add(Id);
	}
	else
	{
		UE_LOG(LogBpTable, Warning, TEXT("BpScan: refused, %s is no wing, room, bay or feature of the plan"), *Id);
		return;
	}
	const FString UseLens = Lens.IsEmpty() ? ActiveLens : Lens;
	UE_LOG(LogBpTable, Log, TEXT("BpScan: POST scans lens=%s scope=%s:%s label=\"%s\" features=%d"), *UseLens, *Kind, *ScopeId, *Label, Features.Num());
	FBpLinkModule::Get().PostScan(UseLens, Kind, ScopeId, Label, Features, [](int32 Status, const FString& Body)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpScan: POST scans answered %d %.160s"), Status, *Body);
	});
}

void ABpTable::ShowCard(bool bShow)
{
	bCardShown = bShow;
	if (!Card) return;
	if (bShow) RefreshCard();
	Card->SetVisibility(bShow && !CardProposal.IsEmpty());
	if (bShow && CardProposal.IsEmpty()) UE_LOG(LogBpTable, Log, TEXT("BpTable: card none (no open finding to ask about)"));
}

void ABpTable::RefreshCard()
{
	if (!Card || !SheetPlan.IsValid()) return;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	TMap<FString, int32> TileOf;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index) TileOf.Add(SheetPlan->tiles[Index].id, Index);
	// The finding the card asks about: the first open one in the lifted room, else the first open one in store order.
	const FBpProposal* Ask = nullptr;
	const int32 Lifted = AnimRoom.IsEmpty() ? INDEX_NONE : SheetPlan->rooms.IndexOfByPredicate([this](const FBpPlanRoom& R) { return R.id == AnimRoom; });
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		const int32* Tile = TileOf.Find(Proposal.feature);
		if (!IsOpen(Proposal) || !Tile) continue;
		if (!Ask) Ask = &Proposal;
		if (Lifted != INDEX_NONE && TileRoom.IsValidIndex(*Tile) && TileRoom[*Tile] == Lifted) { Ask = &Proposal; break; }
	}
	if (!Ask)
	{
		CardProposal.Reset();
		Card->SetVisibility(false);
		return;
	}
	const FString Key = Ask->id + Ask->status + ActiveLens;
	if (Key == CardProposal && Card->GetSlateWidget().IsValid()) return;
	CardProposal = Key;

	const int32 TileIndex = TileOf[Ask->feature];
	const int32 RoomIndex = TileRoom.IsValidIndex(TileIndex) ? TileRoom[TileIndex] : INDEX_NONE;
	const FBpPlanRoom* Room = SheetPlan->rooms.IsValidIndex(RoomIndex) ? &SheetPlan->rooms[RoomIndex] : nullptr;
	const FBpPlanWing* Wing = Room ? FindWing(Room->parentId) : nullptr;
	const FString Target = FString::Printf(TEXT("Wing %s — %s"), Wing ? *Wing->letter : TEXT("?"), Room ? *Room->name : TEXT("?"));
	const FString Header = FString::Printf(TEXT("PROPOSED %s  ·  %s LENS"), *Ask->kind.Replace(TEXT("-"), TEXT(" ")).ToUpper(), *Ask->lens.ToUpper());
	const FString Impact = Section(Ask->body, TEXT("Impact"));
	TArray<FString> Meta;
	if (!Ask->size.IsEmpty()) Meta.Add(TEXT("size ") + Ask->size);
	if (Ask->risk > 0.0) Meta.Add(FString::Printf(TEXT("risk %d/10"), FMath::RoundToInt(Ask->risk)));
	Meta.Add(SheetPlan->tiles[TileIndex].name);

	// The thumbnail: the room, its bays and tiles (heights under the active lens), the finding's tile in amber.
	TArray<SBpRoomSketch::FBlock> Blocks;
	if (Room)
	{
		const double U = 1.0 / BpPlanUnitCm;
		Blocks.Add({ FVector(Room->box.x, Room->box.y, 0.0), FVector(Room->box.x + Room->box.w, Room->box.y + Room->box.h, RoomShellCm * U), false });
		for (const FBpPlanBay& Bay : SheetPlan->bays)
		{
			if (Bay.parentId == Room->id) Blocks.Add({ FVector(Bay.box.x, Bay.box.y, 0.0), FVector(Bay.box.x + Bay.box.w, Bay.box.y + Bay.box.h, BayFloorCm * U), false });
		}
		for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
		{
			if (!TileRoom.IsValidIndex(Index) || TileRoom[Index] != RoomIndex) continue;
			const FBpPlanTile& Tile = SheetPlan->tiles[Index];
			const FString* Reading = Tile.health.Find(ActiveLens);
			Blocks.Add({ FVector(Tile.box.x + 6.0, Tile.box.y + 6.0, 0.0), FVector(Tile.box.x + Tile.box.w - 6.0, Tile.box.y + Tile.box.h - 6.0,
				TileHeightCm(Reading ? *Reading : FString()) * U), Index == TileIndex });
		}
	}
	TSharedRef<SBpRoomSketch> Sketch = SNew(SBpRoomSketch);
	Sketch->SetBlocks(Blocks);

	static const FSlateRoundedBoxBrush Panel(CardPaper.CopyWithNewOpacity(0.9f), 22.f, AmberInk.CopyWithNewOpacity(0.7f), 3.f);
	static const FSlateRoundedBoxBrush Approve(AmberInk, 12.f);
	static const FSlateRoundedBoxBrush Decline(FLinearColor::Transparent, 12.f, CardInk.CopyWithNewOpacity(0.7f), 2.5f);
	const auto Button = [](const FSlateBrush* Brush, const FString& Text)
	{
		return SNew(SBorder).BorderImage(Brush).Padding(FMargin(28.f, 14.f)).HAlign(HAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Text)).Font(CapFont(TEXT("Bold"), 28.f)).ColorAndOpacity(FSlateColor(CardInk))
			];
	};
	Card->SetSlateWidget(
		SNew(SBorder).BorderImage(&Panel).Padding(FMargin(38.f, 30.f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.f)
				[
					SNew(STextBlock).Text(FText::FromString(Header)).Font(CapFont(TEXT("Bold"), 22.f)).ColorAndOpacity(FSlateColor(CardInk.CopyWithNewOpacity(0.65f)))
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(STextBlock).Text(FText::FromString(Ask->id.ToUpper())).Font(CapFont(TEXT("Regular"), 22.f)).ColorAndOpacity(FSlateColor(CardInk.CopyWithNewOpacity(0.65f)))
				]
			]
			+ SVerticalBox::Slot().FillHeight(1.f).Padding(0.f, 16.f, 0.f, 0.f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.f).Padding(0.f, 0.f, 20.f, 0.f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(FText::FromString(Target)).AutoWrapText(true).Font(CapFont(TEXT("Bold"), 40.f)).ColorAndOpacity(FSlateColor(CardInk))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 16.f, 0.f, 0.f)
					[
						SNew(STextBlock).Text(FText::FromString(Ask->title)).AutoWrapText(true).Font(CapFont(TEXT("Regular"), 31.f)).ColorAndOpacity(FSlateColor(CardInk))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 10.f, 0.f, 0.f)
					[
						SNew(STextBlock).Text(FText::FromString(Impact)).AutoWrapText(true).Font(CapFont(TEXT("Regular"), 24.f)).ColorAndOpacity(FSlateColor(CardInk.CopyWithNewOpacity(0.75f)))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 10.f, 0.f, 0.f)
					[
						SNew(STextBlock).Text(FText::FromString(FString::Join(Meta, TEXT("  ·  ")))).Font(CapFont(TEXT("Regular"), 20.f)).ColorAndOpacity(FSlateColor(CardInk.CopyWithNewOpacity(0.6f)))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top)
				[
					SNew(SBox).WidthOverride(300.f).HeightOverride(230.f)
					[
						Sketch
					]
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 18.f, 0.f, 0.f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.f).Padding(0.f, 0.f, 14.f, 0.f)
				[
					Button(&Approve, TEXT("✓  APPROVE"))
				]
				+ SHorizontalBox::Slot().FillWidth(1.f).Padding(14.f, 0.f, 0.f, 0.f)
				[
					Button(&Decline, TEXT("✕  DECLINE"))
				]
			]
		]);
	Card->RequestRedraw();
	Card->SetVisibility(bCardShown);
	// Near the lamp agent at the far edge, right of it and above the rim, turned to face the target eye.
	const FVector Place(CardPlaceXCm, CardPlaceYCm, PlacedHeightCm + CardAboveTopCm);
	const FVector Eye(-(TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0, PlacedHeightCm + ABpGameMode::TargetEyeAboveTopCm);
	Card->SetRelativeLocationAndRotation(Place, FRotationMatrix::MakeFromXZ(Eye - Place, FVector::UpVector).Rotator());
	UE_LOG(LogBpTable, Log, TEXT("BpTable: card proposal=%s target=\"%s\" status=%s"), *Ask->id, *Target, *Ask->status);
}
