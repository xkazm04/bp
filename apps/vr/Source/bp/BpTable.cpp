// The light table (lynx-plan L3.2, L3.3). See BpTable.h for the frame of reference and the named constants.
#include "BpTable.h"

#include "BpLink.h"
#include "CanvasItem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Canvas.h"
#include "Engine/Font.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture2D.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Materials/MaterialParameterCollection.h"
#include "Framework/Application/SlateApplication.h"
#include "GlobalRenderResources.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/PackageName.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"
#include "UObject/ConstructorHelpers.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

DEFINE_LOG_CATEGORY(LogBpTable);

namespace
{
	TAutoConsoleVariable<float> CVarTableHeightCm(
		TEXT("bp.TableHeightCm"),
		ABpTable::DefaultTableHeightCm,
		TEXT("Height of the light table's top above the floor, in cm (lynx-plan L3.2, R4 option A). The table re-places itself; the sheet is not redrawn."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarL0Volumes(
		TEXT("bp.L0Volumes"),
		1,
		TEXT("1: at L0 every room stands as a low glass extrusion with its bays as partitions (FC1, the concept's rest state); 0: the flat linework of lookdev 01 only."),
		ECVF_Default);

	// The palette (art-breakdown.md, style block).
	const FLinearColor BlueprintBlue(FColor(0x0B, 0x2A, 0x6B));
	const FLinearColor CyanWhite(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor WarmPaper(FColor(0xF3, 0xE9, 0xD2));
	/** The concept's amber (pins, the scan line's lead, highlights): ArtSource/survey-pin's pin_body. */
	const FLinearColor Amber(FColor(0xFF, 0xB5, 0x47));

	/** BpTable.Lens <id>: re-height the tiles of every table in the world by another of the plan's lenses (L3.5's switch
	 *  calls SetActiveLens; this is the console's way in until then). */
	FAutoConsoleCommandWithWorldAndArgs CmdTableLens(
		TEXT("BpTable.Lens"),
		TEXT("BpTable.Lens <lens id>: the tiles' heights read this lens (one of the plan's lenses); nothing moves in x or y."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (!World || Args.Num() == 0) return;
			for (TActorIterator<ABpTable> It(World); It; ++It) It->SetActiveLens(Args[0]);
		}));

	const TCHAR* const GlassPlaceholderSlot = TEXT("frame_glass_placeholder_REPLACE_IN_UE");

	/** The greybox rim's thickness and width (the frame's outline around its glass opening, 5 cm in). */
	constexpr float RimThicknessCm = 3.f;
	constexpr float FrameWidthCm = ABpTable::TableWidthCm;
	constexpr float FrameDepthCm = ABpTable::TableDepthCm;
	constexpr float OpeningWidthCm = FrameWidthCm - 10.f;
	constexpr float OpeningDepthCm = FrameDepthCm - 10.f;

	/** Text. Slate sizes fonts in points at 96 DPI (FreeType pixel size = size * 96/72); Roboto's cap height is 0.711 em.
	 *  A label's world scale is chosen so its cap height on the paper is the cap height asked for. */
	constexpr int32 LabelFontSize = 48;
	constexpr float SlatePxPerPoint = 96.f / 72.f;
	constexpr float RobotoCapPerEm = 0.711f;
	/** Roboto's ascender (1900/2048: a text line's box starts this far above the baseline) and the ink below the
	 *  baseline of g, p and y, both per em. A name fits a strip when its cap height and that descent do. */
	constexpr float RobotoAscPerEm = 0.928f;
	constexpr float RobotoInkDescPerEm = 0.21f;
	/** Room names sit in the room's header strip (the plan leaves 72 u above the first bay), bay names in the bay's
	 *  (46 u above the first tile): this far in from the box's left edge and below its top edge, to the cap's top. */
	constexpr float LevelLabelInsetCm = 0.6f;
	constexpr float LevelLabelGapCm = 0.25f;
	/** The breadcrumb's separator, and the anchor of the title block (its bottom-right corner) on the paper. */
	const TCHAR* const CrumbSeparator = TEXT("  ›  ");
	const FVector2D TitleAnchorCm(ABpTable::PaperWidthCm - 30.0, ABpTable::PaperDepthCm - 1.2);

	/** A text's size in Slate units, from the renderer's font measure, or Roboto's average advance when there is none
	 *  (a null-RHI run): only a hit region's width rests on it. */
	FVector2D MeasureText(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer())
			{
				return FVector2D(Renderer->GetFontMeasureService()->Measure(Text, Font));
			}
		}
		const float EmPx = Font.Size * SlatePxPerPoint;
		return FVector2D(Text.Len() * 0.55f * EmPx, 1.17f * EmPx);
	}

	/** Sheet pixels per paper centimetre (the render target covers the paper; its pixels are square). */
	constexpr double SheetPxPerCm = ABpTable::SheetWidthPx / ABpTable::PaperWidthCm;

	/** A font for the sheet whose cap height is CapCm on the paper (its size is in sheet pixels, so Slate's measure of a
	 *  text is its width in sheet pixels). */
	FSlateFontInfo SheetFont(const TCHAR* Style, double CapCm)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), static_cast<float>(CapCm * SheetPxPerCm / (RobotoCapPerEm * SlatePxPerPoint)), FName(Style));
	}

	/** Set by the table's constructor (the class default object's runs at startup). */
	TWeakObjectPtr<UObject> GTextFont;

	/** The sheet's text sizes (cap heights on the paper, cm; FC1). The wing titles stand above their wings as the concept's
	 *  small uppercase "WING 03" (lookdev 00): the wing's letter, its name, its counts. The title block sits near-left
	 *  ("SITE PLAN — LEVEL 0" in the concept), the breadcrumb near-right (the hands' way back, WP3), the compass in the left
	 *  margin and the scale bar in the right one. */
	constexpr double WingTagCapCm = 0.8;
	constexpr double WingNameCapCm = 1.25;
	constexpr double WingNameFloorCm = 0.9;
	constexpr double WingCountsCapCm = 0.75;
	constexpr double WingCountsFloorCm = 0.55;
	constexpr double TitleCapCm = 1.3;
	constexpr double TitleSubCapCm = 0.8;
	constexpr double CaptionCapCm = 0.6;
	constexpr double FigureCapCm = 0.6;
	/** Letter spacing of the small uppercase lines, in sheet pixels per character. */
	constexpr float TrackingPx = 4.f;
	/** The breadcrumb's line box: its bottom on the paper (it is right-aligned to TitleAnchorCm.X). The title block, the
	 *  breadcrumb and the scale bar sit where the target framing sees the paper's near margin (the paper's near corners
	 *  fall outside it). */
	constexpr double CrumbBottomCm = 74.6;
	/** The title block's place: its left edge and its last line's baseline. */
	constexpr double TitleLeftCm = 58.0;
	constexpr double TitleBaseCm = 75.3;
	/** The compass (left margin) and the scale bar (right margin). */
	const FVector2D CompassCm(6.25, 36.0);
	constexpr double CompassRadiusCm = 3.6;
	constexpr double ScaleBarLeftCm = 117.0;
	constexpr double ScaleBarVCm = 67.0;
	/** Annotation: the dimension lines' offset from a wing's box, their ticks, and their ink. */
	constexpr double DimOffsetCm = 0.6;
	constexpr double DimTickCm = 0.35;
	constexpr float DimOpacity = 0.38f;

	/** The tags' paper and ink. */
	const FLinearColor TagInk(FColor(0x0B, 0x2A, 0x6B));

	constexpr float GridFinePx = 2.f;
	constexpr float GridMajorPx = 3.f;
	constexpr float GridFineOpacity = 0.10f;
	constexpr float GridMajorOpacity = 0.22f;
	/** The wings' ink, and the rooms', bays' and tiles' flat outlines under it (the floor plan at rest, and the lifted
	 *  group's footprint on the paper under it): fainter and thinner, as the concept's L0 linework (lookdev 01). */
	constexpr float WingFillOpacity = 0.07f;
	constexpr float WingEdgeOpacity = 0.9f;
	constexpr float WingEdgePx = 5.f;
	constexpr float RoomEdgeOpacity = 0.55f;
	constexpr float RoomEdgePx = 3.f;
	constexpr float BayEdgeOpacity = 0.32f;
	constexpr float BayEdgePx = 2.f;
	constexpr float TileEdgeOpacity = 0.22f;
	constexpr float TileEdgePx = 2.f;
	/** A highlighted wing (SetHighlight): a heavier, full outline and a brighter fill. */
	constexpr float HighlightEdgePx = 8.f;
	constexpr float HighlightFillOpacity = 0.14f;

	/** Heights above the paper, so nothing z-fights it. */
	constexpr float OverlayLiftCm = 0.05f;
	constexpr float LabelLiftCm = 0.1f;

	/** The volumes: per-instance custom data 0 to 2 is the instance's size in cm (X, Y, Z), so M_EdgeGlow draws its edges
	 *  the same width on a 1 cm tile and a 20 cm room; 3 is Show (0 hidden, LevelDim dimmed, 1 lit, above 1 highlighted),
	 *  which the levels set. Bays are plates drawn as edges only; rooms and tiles keep a faint face. */
	constexpr int32 VolumeCustomFloats = 4;
	constexpr float BayFaceOpacity = 0.f;
	/** A lifted wing's room shells are glass (lookdev 02): their faces a third of M_EdgeGlow's default, so four stacked
	 *  shells seen at a grazing angle read as glass over the paper, not a grey wash (WP2's leftover). */
	constexpr float RoomFaceOpacity = 0.02f;
	/** The rest extrusions' glass (FC1): fainter than a lifted shell's faces, so thirteen low rooms read as glass on the
	 *  paper, not a wash; their edges carry them. */
	constexpr float RestFaceOpacity = 0.03f;
	/** The greybox's volumes: faces only, on UWidgetComponent's translucent engine material. */
	constexpr float GreyboxVolumeOpacity = 0.12f;
	/** Labels draw after the volumes (translucent sort), so a glowing edge never lies over a wing's name. */
	constexpr int32 LabelSortPriority = 1;

	/** A widget lying on the paper, facing up, its top toward the far edge (+X) and its right toward +Y. A world-space
	 *  widget faces its component's +X with its right along -Y: pitch 90 turns the face up, yaw 180 turns it to the viewer. */
	const FRotator LabelRotation(90.f, 180.f, 0.f);

	FString TitleCase(const FString& Slug)
	{
		return Slug.IsEmpty() ? Slug : Slug.Left(1).ToUpper() + Slug.Mid(1);
	}

	/** The soft reference loaded, or null with exactly one warning line naming the path. */
	template <typename T>
	T* LoadOrGreybox(const TSoftObjectPtr<T>& Ref, bool bLog)
	{
		const FSoftObjectPath Path = Ref.ToSoftObjectPath();
		T* Loaded = nullptr;
		if (Path.IsValid() && FPackageName::DoesPackageExist(Path.GetLongPackageName()))
		{
			Loaded = Ref.LoadSynchronous();
		}
		if (!Loaded && bLog)
		{
			UE_LOG(LogBpTable, Warning, TEXT("%s missing, greybox"), *Path.ToString());
		}
		return Loaded;
	}

	/** Two triangles per quad, in sheet pixels, for one FCanvasTriangleItem. */
	struct FSheetPen
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

		/** A stroke with square caps (half the width past each end), so outlines close at the corners. */
		void Line(const FVector2D& From, const FVector2D& To, float WidthPx, const FLinearColor& Color)
		{
			const FVector2D Dir = (To - From).GetSafeNormal();
			if (Dir.IsZero()) return;
			const FVector2D Along = Dir * (WidthPx * 0.5f);
			const FVector2D Across(-Along.Y, Along.X);
			const FVector2D A = From - Along, B = To + Along;
			Quad(A - Across, B - Across, B + Across, A + Across, Color);
		}

		void Fill(const FVector2D& Min, const FVector2D& Max, const FLinearColor& Color)
		{
			Quad(Min, FVector2D(Max.X, Min.Y), Max, FVector2D(Min.X, Max.Y), Color);
		}
	};
}

ABpTable::ABpTable()
{
	PrimaryActorTick.bCanEverTick = true;
	// The height cvar is read at this rate; nothing else ticks.
	PrimaryActorTick.TickInterval = 0.25f;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> PlaneFinder(TEXT("/Engine/BasicShapes/Plane.Plane"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> ShapeMaterialFinder(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	// UWidgetComponent's own unlit material: it shows the Texture parameter `SlateUI` with its alpha, cooked or not.
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> SheetMaterialFinder(TEXT("/Engine/EngineMaterials/Widget3DPassThrough_Translucent.Widget3DPassThrough_Translucent"));
	static ConstructorHelpers::FObjectFinder<UTexture2D> WhiteFinder(TEXT("/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture"));
	static ConstructorHelpers::FObjectFinder<UFont> FontFinder(TEXT("/Engine/EngineFonts/Roboto.Roboto"));
	EngineFont = FontFinder.Object;
	if (EngineFont) GTextFont = EngineFont;
	EngineCube = CubeFinder.Object;
	EnginePlane = PlaneFinder.Object;
	EngineShapeMaterial = ShapeMaterialFinder.Object;
	EngineSheetMaterial = SheetMaterialFinder.Object;
	EngineWhiteTexture = WhiteFinder.Object;

	FrameMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Bp/Art/LightTableFrame/SM_LightTableFrame.SM_LightTableFrame")));
	PaperMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_BlueprintPaper.M_BlueprintPaper")));
	HiddenMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_Hidden.M_Hidden")));
	VolumeMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_EdgeGlow.M_EdgeGlow")));
	PinMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Bp/Art/SurveyPin/final/StaticMeshes/SM_SurveyPin.SM_SurveyPin")));
	PinBodyMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_PinBody.M_PinBody")));
	TagMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_PinTag.M_PinTag")));
	ScanCollection = TSoftObjectPtr<UMaterialParameterCollection>(FSoftObjectPath(TEXT("/Game/Bp/Materials/MPC_BpScan.MPC_BpScan")));

	Frame = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Frame"));
	Frame->SetupAttachment(Root);
	Frame->SetStaticMesh(EngineCube);

	for (int32 Index = 0; Index < 4; ++Index)
	{
		UStaticMeshComponent* Rail = CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("GreyboxRim%d"), Index));
		Rail->SetupAttachment(Root);
		Rail->SetStaticMesh(EngineCube);
		GreyboxRim.Add(Rail);
	}

	Paper = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Paper"));
	Paper->SetupAttachment(Root);
	Paper->SetStaticMesh(EnginePlane);
	Paper->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Paper->SetCastShadow(false);

	SheetOverlay = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("SheetOverlay"));
	SheetOverlay->SetupAttachment(Root);
	SheetOverlay->SetStaticMesh(EnginePlane);
	SheetOverlay->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SheetOverlay->SetCastShadow(false);
	SheetOverlay->SetVisibility(false);

	// The engine cube (100 cm, pivot at its centre) scaled per instance; the instances come with the plan.
	const auto MakeVolumes = [this](const TCHAR* Name)
	{
		UInstancedStaticMeshComponent* Volumes = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		Volumes->SetupAttachment(Root);
		Volumes->SetMobility(EComponentMobility::Movable);
		Volumes->SetStaticMesh(EngineCube);
		Volumes->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Volumes->SetCastShadow(false);
		Volumes->NumCustomDataFloats = VolumeCustomFloats;
		return Volumes;
	};
	Rooms = MakeVolumes(TEXT("Rooms"));
	Bays = MakeVolumes(TEXT("Bays"));
	Tiles = MakeVolumes(TEXT("Tiles"));
	// The lifted room's shell while it is up (FC1): a copy of its Rooms instance under the room's lift.
	LiftedShell = MakeVolumes(TEXT("LiftedRoom"));
	// The rest extrusions carry a fifth float: the face factor (1 a room's faint glass, 0 a bay's partition, edges only).
	RestVolumes = MakeVolumes(TEXT("RestVolumes"));
	RestVolumes->NumCustomDataFloats = VolumeCustomFloats + 1;
	// The pins, tags included: placed in the actor's space (they follow a lifted wing or room by their transforms); custom
	// data 0 to 3 is the tag's atlas cell.
	Pins = MakeVolumes(TEXT("Pins"));
	Pins->NumCustomDataFloats = 4;
	Pins->SetStaticMesh(nullptr);
}

float ABpTable::HeightCvarCm()
{
	// Below the rim's thickness there is no table to place.
	return FMath::Max(CVarTableHeightCm.GetValueOnGameThread(), RimThicknessCm + 1.f);
}

FVector2D ABpTable::PlanToPaperCm(const FVector2D& Plan) const
{
	// The plan's extent, scaled by BpPlanUnitCm, centred on the paper.
	const FVector2D Margin = (FVector2D(PaperWidthCm, PaperDepthCm) - PlanSize * BpPlanUnitCm) * 0.5;
	return Margin + (Plan - PlanMin) * BpPlanUnitCm;
}

FVector2D ABpTable::PaperCmToSheetPx(const FVector2D& PaperCm)
{
	return FVector2D(PaperCm.X / PaperWidthCm * SheetWidthPx, PaperCm.Y / PaperDepthCm * SheetHeightPx);
}

FVector ABpTable::PaperCmToLocal(const FVector2D& PaperCm, float ZCm)
{
	return FVector(PaperDepthCm * 0.5 - PaperCm.Y, PaperCm.X - PaperWidthCm * 0.5, ZCm);
}

void ABpTable::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	// In the editor, show the frame (or the greybox) at the current height; nothing is logged or drawn here.
	if (UStaticMesh* Mesh = LoadOrGreybox(FrameMesh, false))
	{
		bRealFrame = true;
		Frame->SetStaticMesh(Mesh);
		for (UStaticMeshComponent* Rail : GreyboxRim) Rail->SetVisibility(false);
	}
	PlaceForHeight(HeightCvarCm());
}

void ABpTable::BeginPlay()
{
	Super::BeginPlay();
	LoadArt();
	PlaceForHeight(HeightCvarCm());

	// The title block, the wing titles and the breadcrumb are drawn into the sheet (FC1: mipped and anisotropically sampled,
	// where the widgets they replace were un-mipped render targets seen at a grazing angle). Before a plan there is no
	// sheet, so the wait is logged and said by the breadcrumb's line once a plan's sheet exists.
	SetTitle(TEXT("waiting for the server"), FString());
	LoadMarks();

	// BpLink fetched at startup (or is fetching): take its plan, now or when it lands; never ask the server again.
	FBpLinkModule& Link = FBpLinkModule::Get();
	PlanHandle = Link.OnPlan().AddUObject(this, &ABpTable::ApplyPlan);
	FailedHandle = Link.OnPlanFailed().AddUObject(this, &ABpTable::ShowNoPlan);
	ScanHandle = Link.OnScanState().AddUObject(this, &ABpTable::ReceiveScanState);
	if (const FBpPlan* Plan = Link.GetPlan())
	{
		ApplyPlan(*Plan);
	}
	else if (Link.GetPlanState() == EBpPlanState::Failed)
	{
		ShowNoPlan();
	}
}

void ABpTable::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (FBpLinkModule* Link = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink")))
	{
		Link->OnPlan().Remove(PlanHandle);
		Link->OnPlanFailed().Remove(FailedHandle);
		Link->OnScanState().Remove(ScanHandle);
	}
	Super::EndPlay(EndPlayReason);
}

void ABpTable::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Height = HeightCvarCm();
	if (!FMath::IsNearlyEqual(Height, PlacedHeightCm, 0.01f))
	{
		PlaceForHeight(Height);
		UE_LOG(LogBpTable, Log, TEXT("BpTable: height_cm=%d"), FMath::RoundToInt(Height));
	}
	// bp.L0Volumes switched: every rest extrusion's Show is written again.
	if (AppliedL0Volumes != CVarL0VolumesValue() && SheetPlan.IsValid())
	{
		AppliedL0Volumes = CVarL0VolumesValue();
		for (float& Shown : ShownRest) Shown = -1.f;
		ApplyLevelVisuals();
		UE_LOG(LogBpTable, Log, TEXT("BpTable: l0_volumes=%d rest_instances=%d"), AppliedL0Volumes, RestVolumes->GetInstanceCount());
	}
	// A level change eases at the frame rate, then the tick drops back to the cvar's rate (KickLevels starts it).
	if (IsLevelMoving())
	{
		AdvanceLevels(FMath::Min(DeltaSeconds, 0.05f));
		ApplyLevelVisuals();
		if (!IsLevelMoving() && !bScanLive && ScanStrength <= 0.f) SetActorTickInterval(0.25f);
	}
	// The scan line eases at the frame rate while a scan runs or fades (UpdateScan drops the tick back when it is done).
	if (bScanLive || ScanStrength > 0.f) UpdateScan(FMath::Min(DeltaSeconds, 0.1f));
}

void ABpTable::LoadArt()
{
	UStaticMesh* Mesh = LoadOrGreybox(FrameMesh, true);
	bRealFrame = Mesh != nullptr;
	Frame->SetStaticMesh(bRealFrame ? Mesh : EngineCube.Get());
	for (UStaticMeshComponent* Rail : GreyboxRim) Rail->SetVisibility(!bRealFrame);
	if (bRealFrame)
	{
		// The imported glass is a placeholder quad; the paper below is the sheet, so the quad is hidden.
		const int32 Slot = Frame->GetMaterialIndex(GlassPlaceholderSlot);
		if (Slot != INDEX_NONE)
		{
			if (UMaterialInterface* Hidden = LoadOrGreybox(HiddenMaterial, true)) Frame->SetMaterial(Slot, Hidden);
		}
	}

	UMaterialInterface* PaperMat = LoadOrGreybox(PaperMaterial, true);
	bRealPaper = PaperMat != nullptr;
	PaperMid = UMaterialInstanceDynamic::Create(bRealPaper ? PaperMat : EngineShapeMaterial.Get(), this);
	if (bRealPaper)
	{
		PaperMid->SetScalarParameterValue(TEXT("SheetStrength"), 0.f);
		// The paper texture at its own scale: one tile is PaperTileCm on the table.
		PaperMid->SetScalarParameterValue(TEXT("TilesU"), PaperWidthCm / PaperTileCm);
		PaperMid->SetScalarParameterValue(TEXT("TilesV"), PaperDepthCm / PaperTileCm);
	}
	else
	{
		PaperMid->SetVectorParameterValue(TEXT("Color"), BlueprintBlue);
	}
	Paper->SetMaterial(0, PaperMid);

	// The greybox shows the sheet on UWidgetComponent's engine material, in a plane just above the plain paper.
	OverlayMid = UMaterialInstanceDynamic::Create(EngineSheetMaterial, this);
	OverlayMid->SetVectorParameterValue(TEXT("TintColorAndOpacity"), FLinearColor::White);
	OverlayMid->SetScalarParameterValue(TEXT("OpacityFromTexture"), 1.f);
	SheetOverlay->SetMaterial(0, OverlayMid);
	SheetOverlay->SetVisibility(false);

	// The volumes: M_EdgeGlow, one instance per kind (bays without a face); the greybox is a faint translucent face.
	UInstancedStaticMeshComponent* const Kinds[5] = { Rooms, Bays, Tiles, RestVolumes, LiftedShell };
	VolumeMids.Reset();
	if (UMaterialInterface* Glow = LoadOrGreybox(VolumeMaterial, true))
	{
		for (UInstancedStaticMeshComponent* Kind : Kinds)
		{
			UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Glow, this);
			if (Kind == Bays) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), BayFaceOpacity);
			if (Kind == Rooms || Kind == LiftedShell) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), RoomFaceOpacity);
			if (Kind == RestVolumes) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), RestFaceOpacity);
			Kind->SetMaterial(0, Mid);
			VolumeMids.Add(Mid);
		}
	}
	else
	{
		UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(EngineSheetMaterial, this);
		Mid->SetTextureParameterValue(TEXT("SlateUI"), EngineWhiteTexture);
		Mid->SetVectorParameterValue(TEXT("TintColorAndOpacity"), CyanWhite.CopyWithNewOpacity(GreyboxVolumeOpacity));
		Mid->SetScalarParameterValue(TEXT("OpacityFromTexture"), 1.f);
		for (UInstancedStaticMeshComponent* Kind : Kinds) Kind->SetMaterial(0, Mid);
		VolumeMids.Add(Mid);
	}
}

void ABpTable::PlaceForHeight(float HeightCm)
{
	PlacedHeightCm = HeightCm;
	if (bRealFrame)
	{
		// The mesh's pivot is the floor centre and its top is its bounds' top (95 cm as modelled): the feet stay on the
		// floor and Z scales to the height.
		// The mesh is modelled with its length (TableWidthCm) along its +X; the table's width (left to right for the person at the
		// near edge) is this actor's +Y, so the mesh turns 90 degrees (first capture, 2026-10-23: the long side faced away).
		const float ModelTop = Frame->GetStaticMesh() ? Frame->GetStaticMesh()->GetBoundingBox().Max.Z : 0.f;
		Frame->SetRelativeLocation(FVector::ZeroVector);
		Frame->SetRelativeRotation(FRotator(0.0, 90.0, 0.0));
		Frame->SetRelativeScale3D(FVector(1.0, 1.0, ModelTop > 1.f ? HeightCm / ModelTop : 1.0));
	}
	else
	{
		// The engine cube is 100 cm with its pivot at the centre: a block from the floor to the rim, then the rim.
		const float BlockHeight = HeightCm - RimThicknessCm;
		Frame->SetRelativeRotation(FRotator::ZeroRotator);
		Frame->SetRelativeLocation(FVector(0.0, 0.0, BlockHeight * 0.5));
		Frame->SetRelativeScale3D(FVector(FrameDepthCm, FrameWidthCm, BlockHeight) / 100.0);
		const float RailZ = HeightCm - RimThicknessCm * 0.5f;
		const float SideRail = (FrameDepthCm - OpeningDepthCm) * 0.5f;
		const float EndRail = (FrameWidthCm - OpeningWidthCm) * 0.5f;
		const FVector Places[4] = {
			FVector((OpeningDepthCm + SideRail) * 0.5, 0.0, RailZ), FVector(-(OpeningDepthCm + SideRail) * 0.5, 0.0, RailZ),
			FVector(0.0, (OpeningWidthCm + EndRail) * 0.5, RailZ), FVector(0.0, -(OpeningWidthCm + EndRail) * 0.5, RailZ) };
		const FVector Sizes[4] = {
			FVector(SideRail, FrameWidthCm, RimThicknessCm), FVector(SideRail, FrameWidthCm, RimThicknessCm),
			FVector(OpeningDepthCm, EndRail, RimThicknessCm), FVector(OpeningDepthCm, EndRail, RimThicknessCm) };
		for (int32 Index = 0; Index < GreyboxRim.Num() && Index < 4; ++Index)
		{
			GreyboxRim[Index]->SetRelativeLocation(Places[Index]);
			GreyboxRim[Index]->SetRelativeScale3D(Sizes[Index] / 100.0);
		}
	}

	// The engine plane is 100 x 100 cm in XY, facing +Z, with U along its +X and V along its +Y, UV (0,0) at (-50,-50)
	// (read from /Engine/BasicShapes/Plane's mesh description, Lynx 2026-10-23). Yaw 90 turns U to +Y (left to right)
	// and V to -X (far edge to near), so the paper samples the sheet at its own UVs, UV (0,0) at the far-left corner.
	const float PaperZ = HeightCm - GlassRecessCm;
	const FVector PaperScale(PaperWidthCm / 100.0, PaperDepthCm / 100.0, 1.0);
	const FRotator PaperRotation(0.f, 90.f, 0.f);
	Paper->SetRelativeLocationAndRotation(FVector(0.0, 0.0, PaperZ), PaperRotation);
	Paper->SetRelativeScale3D(PaperScale);
	SheetOverlay->SetRelativeLocationAndRotation(FVector(0.0, 0.0, PaperZ + OverlayLiftCm), PaperRotation);
	SheetOverlay->SetRelativeScale3D(PaperScale);
	// The volumes stand on the paper: their instances are placed relative to it, so only the batches move (with the
	// height, and with a level's lift).
	ApplyLevelVisuals();
	PlaceLabels();
}

void ABpTable::PlaceLabels()
{
	const float PaperZ = PlacedHeightCm - GlassRecessCm;
	for (const FLabelPlace& Place : LabelPlaces)
	{
		if (UWidgetComponent* Label = Place.Label.Get()) Label->SetRelativeLocation(PaperCmToLocal(Place.PaperCm, PaperZ + Place.LiftCm));
	}
}

UWidgetComponent* ABpTable::MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm, float LiftCm, USceneComponent* Parent)
{
	UWidgetComponent* Label = NewObject<UWidgetComponent>(this);
	Label->SetupAttachment(Parent ? Parent : Root.Get());
	Label->SetWidgetSpace(EWidgetSpace::World);
	Label->SetDrawAtDesiredSize(true);
	Label->SetPivot(Pivot);
	Label->SetBlendMode(EWidgetBlendMode::Transparent);
	Label->SetTwoSided(false);
	Label->SetBackgroundColor(FLinearColor::Transparent);
	Label->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Label->SetCastShadow(false);
	Label->SetTranslucentSortPriority(LabelSortPriority);
	Label->SetWindowFocusable(false);
	// The text is static: drawn when asked, not every frame.
	Label->SetManuallyRedraw(true);
	Label->SetRelativeRotation(LabelRotation);
	// High draw resolution, small world scale: one widget pixel is this many cm.
	Label->SetRelativeScale3D(FVector(CapHeightCm / (LabelFontSize * SlatePxPerPoint * RobotoCapPerEm)));
	Label->RegisterComponent();
	Label->SetSlateWidget(Content);
	Label->RequestRedraw();
	if (Parent)
	{
		// On a batch: the batch already stands at the paper's height, so the place is relative to it.
		Label->SetRelativeLocation(PaperCmToLocal(PaperCm, LiftCm));
	}
	else
	{
		LabelPlaces.Add({ Label, PaperCm, LiftCm });
	}
	return Label;
}

void ABpTable::SetCrumbs(const TArray<TPair<FString, FString>>& Items)
{
	// The breadcrumb (WP3) lies in the sheet, right-aligned to TitleAnchorCm.X, its line box's bottom at CrumbBottomCm.
	// The last crumb is where you are (bold); the ones before it are the way back. Each crumb's box on the paper is its
	// hit region (HitTest, AimAt), measured with the font the sheet draws it in.
	const FSlateFontInfo Here = SheetFont(TEXT("Bold"), LabelCapHeightCm);
	const FSlateFontInfo Way = SheetFont(TEXT("Regular"), LabelCapHeightCm);
	TMap<FString, bool> WasLit;
	for (const FCrumb& Crumb : Crumbs) WasLit.Add(Crumb.Id, Crumb.bLit);
	Crumbs.Reset();
	const double SeparatorCm = MeasureText(CrumbSeparator, Way).X / SheetPxPerCm;
	double Total = 0.0, LineCm = 0.0;
	TArray<double> Widths;
	for (int32 Index = 0; Index < Items.Num(); ++Index)
	{
		const bool bHere = Index == Items.Num() - 1;
		const FVector2D Size = MeasureText(Items[Index].Value, bHere ? Here : Way) / SheetPxPerCm;
		Widths.Add(Size.X);
		LineCm = FMath::Max(LineCm, Size.Y);
		Total += Size.X + (Index > 0 ? SeparatorCm : 0.0);
		FCrumb Crumb;
		Crumb.Id = Items[Index].Key;
		Crumb.Text = Items[Index].Value;
		Crumb.bHere = bHere;
		Crumbs.Add(Crumb);
	}
	const double Bottom = CrumbBottomCm, Top = Bottom - LineCm;
	double Left = TitleAnchorCm.X - Total;
	for (int32 Index = 0; Index < Crumbs.Num(); ++Index)
	{
		Crumbs[Index].PaperCm = FBox2D(FVector2D(Left, Top), FVector2D(Left + Widths[Index], Bottom));
		Left += Widths[Index] + SeparatorCm;
	}
	RedrawSheet();
}

void ABpTable::SetTitle(const FString& Line1, const FString& Line2)
{
	TitleLensLine = Line2;
	// A plan's breadcrumb starts at the product; without one, a single line that is no way back.
	if (SheetPlan.IsValid()) UpdateBreadcrumb();
	else
	{
		TitleWaitLine = Line1;
		SetCrumbs({ TPair<FString, FString>(FString(), Line1) });
	}
}

void ABpTable::UpdateBreadcrumb()
{
	const FBpLinkModule& Link = FBpLinkModule::Get();
	TArray<TPair<FString, FString>> Items;
	Items.Emplace(TEXT("home"), Link.GetProductName().IsEmpty() ? TitleCase(Link.GetProductSlug()) : Link.GetProductName());
	if (Level != EBpLevel::L0)
	{
		if (const FBpPlanWing* Wing = FindWing(WingId)) Items.Emplace(TEXT("wing:") + WingId, Wing->letter + TEXT(" ") + Wing->name);
	}
	if (Level == EBpLevel::L2)
	{
		if (const FBpPlanRoom* Room = FindRoom(RoomId)) Items.Emplace(TEXT("room:") + RoomId, Room->name);
	}
	SetCrumbs(Items);
	// A highlighted crumb reads in the sheet's cyan.
	for (FCrumb& Crumb : Crumbs) Crumb.bLit = HighlightKind == TEXT("crumb") && !Crumb.Id.IsEmpty() && Crumb.Id == HighlightId;
}

FString ABpTable::GetBreadcrumb() const
{
	TArray<FString> Texts;
	for (const FCrumb& Crumb : Crumbs) Texts.Add(Crumb.Text);
	return FString::Join(Texts, TEXT(" › "));
}

void ABpTable::ApplyPlan(const FBpPlan& Plan)
{
	// Once per plan rev: a second BpLink.Fetch of the same rev changes nothing.
	if (Sheet && SheetPlan.IsValid() && Plan.rev == DrawnRev) return;

	TArray<const FBpPlanWing*> Wings;
	for (const FBpPlanWing& Wing : Plan.wings) Wings.Add(&Wing);
	Wings.Sort([](const FBpPlanWing& A, const FBpPlanWing& B) { return A.order < B.order; });
	if (Wings.Num() == 0)
	{
		ShowNoPlan();
		return;
	}

	SheetPlan = MakeShared<FBpPlan>(Plan);
	FVector2D Max(-UE_BIG_NUMBER, -UE_BIG_NUMBER);
	PlanMin = FVector2D(UE_BIG_NUMBER, UE_BIG_NUMBER);
	for (const FBpPlanWing* Wing : Wings)
	{
		PlanMin = FVector2D(FMath::Min(PlanMin.X, Wing->box.x), FMath::Min(PlanMin.Y, Wing->box.y));
		Max = FVector2D(FMath::Max(Max.X, Wing->box.x + Wing->box.w), FMath::Max(Max.Y, Wing->box.y + Wing->box.h));
	}
	PlanSize = Max - PlanMin;

	// Draw the sheet: the render target's update calls DrawSheet once.
	if (!Sheet)
	{
		Sheet = NewObject<UCanvasRenderTarget2D>(this);
		Sheet->ClearColor = FLinearColor::Transparent;
		Sheet->RenderTargetFormat = RTF_RGBA8;
		// Mips, so the fine grid and thin outlines minify instead of shimmering at the far edge.
		Sheet->bAutoGenerateMips = true;
		// TF_Default takes the render-target group's filter, anisotropic (BaseDeviceProfiles.ini): the sheet is seen at
		// a grazing angle toward the far edge, where trilinear blurred the far wings' text (r4 section 2).
		Sheet->MipsSamplerFilter = TF_Trilinear;
		Sheet->Filter = TF_Default;
		Sheet->OnCanvasRenderTargetUpdate.AddDynamic(this, &ABpTable::DrawSheet);
		Sheet->InitAutoFormat(SheetWidthPx, SheetHeightPx);
	}
	else
	{
		Sheet->UpdateResource();
	}
	DrawnRev = Plan.rev;
	if (bRealPaper)
	{
		PaperMid->SetTextureParameterValue(TEXT("Sheet"), Sheet);
		PaperMid->SetScalarParameterValue(TEXT("SheetStrength"), 1.f);
	}
	else
	{
		OverlayMid->SetTextureParameterValue(TEXT("SlateUI"), Sheet);
		SheetOverlay->SetVisibility(true);
	}

	// The wing titles are drawn in the sheet (DrawSheetText), from the plan and RefreshWingCounts.
	TArray<FString> Order;
	for (const FBpPlanWing* Wing : Wings) Order.Add(Wing->letter);
	LabelPlaces.RemoveAll([](const FLabelPlace& Place) { return !Place.Label.IsValid(); });

	ActiveLens = Plan.lenses.Num() > 0 ? Plan.lenses[0] : FString();
	UE_LOG(LogBpTable, Log, TEXT("BpTable: wings=%d order=%s height_cm=%d"), Wings.Num(), *FString::Join(Order, TEXT(",")), FMath::RoundToInt(PlacedHeightCm));

	BuildVolumes(*SheetPlan);
	UE_LOG(LogBpTable, Log, TEXT("BpTable: instances rooms=%d bays=%d tiles=%d lens=%s"),
		Rooms->GetInstanceCount(), Bays->GetInstanceCount(), Tiles->GetInstanceCount(), *ActiveLens);

	// The levels: room and bay names on their batches, everything at L0, the counts for the first lens, the title.
	BuildLevelLabels(*SheetPlan);
	ResetLevels();
	RefreshWingCounts();
	SetTitle(FString(), ActiveLens);
	BuildPins(FBpLinkModule::Get().GetScanState());

	// BpLevel.* commands that came before the plan (-ExecCmds at startup) run now, in order.
	TArray<FString> Pending = MoveTemp(PendingLevelCommands());
	PendingLevelCommands().Reset();
	for (const FString& Command : Pending)
	{
		if (GEngine) GEngine->Exec(GetWorld(), *Command);
	}
}

void ABpTable::BuildLevelLabels(const FBpPlan& Plan)
{
	for (UWidgetComponent* Old : RoomLabels)
	{
		if (Old) Old->DestroyComponent();
	}
	for (UWidgetComponent* Old : BayLabels)
	{
		if (Old) Old->DestroyComponent();
	}
	RoomLabels.Reset();
	BayLabels.Reset();
	LabelAlpha.Reset();
	RoomWing.Reset();
	BayRoom.Reset();
	TileRoom.Reset();
	BayHeaderCm.Reset();
	BayNameFits.Reset();

	// Who belongs to whom, by parentId (counting, not a layout).
	TMap<FString, int32> RoomOf, BayOf;
	for (int32 Index = 0; Index < Plan.rooms.Num(); ++Index)
	{
		RoomOf.Add(Plan.rooms[Index].id, Index);
		RoomWing.Add(Plan.rooms[Index].parentId);
	}
	for (int32 Index = 0; Index < Plan.bays.Num(); ++Index)
	{
		BayOf.Add(Plan.bays[Index].id, Index);
		const int32* Room = RoomOf.Find(Plan.bays[Index].parentId);
		BayRoom.Add(Room ? *Room : INDEX_NONE);
	}
	BayHeaderCm.Init(0.f, Plan.bays.Num());
	for (int32 Index = 0; Index < Plan.bays.Num(); ++Index) BayHeaderCm[Index] = Plan.bays[Index].box.h * BpPlanUnitCm;
	for (const FBpPlanTile& Tile : Plan.tiles)
	{
		const int32* Bay = BayOf.Find(Tile.parentId);
		TileRoom.Add(Bay ? BayRoom[*Bay] : INDEX_NONE);
		if (Bay)
		{
			const float Header = (Tile.box.y - Plan.bays[*Bay].box.y) * BpPlanUnitCm;
			BayHeaderCm[*Bay] = FMath::Min(BayHeaderCm[*Bay], Header);
		}
	}

	// Room names: in the room's header strip, on the shell's top, at the label floor before the lift (the lift only
	// enlarges them). Wrapped to the room's width; at L1 nothing else stands on a shell's top.
	const double CmPerSlate = LabelCapHeightCm / (LabelFontSize * SlatePxPerPoint * RobotoCapPerEm);
	const double EmCm = LabelCapHeightCm / RobotoCapPerEm;
	for (const FBpPlanRoom& Room : Plan.rooms)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Room.box.x, Room.box.y));
		const double WidthCm = Room.box.w * BpPlanUnitCm - 2.0 * LevelLabelInsetCm;
		const FVector2D Corner = A + FVector2D(LevelLabelInsetCm, LevelLabelGapCm - (RobotoAscPerEm - RobotoCapPerEm) * EmCm);
		UWidgetComponent* Label = MakeLabel(SNew(SBox).WidthOverride(static_cast<float>(FMath::Max(1.0, WidthCm) / CmPerSlate))
			[
				SNew(STextBlock).Text(FText::FromString(Room.name)).AutoWrapText(true)
					.Font(FCoreStyle::GetDefaultFontStyle("Regular", LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper))
			],
			Corner, FVector2D(0.0, 0.0), LabelCapHeightCm, RoomShellCm + LabelLiftCm, Rooms);
		Label->SetVisibility(false);
		RoomLabels.Add(Label);
	}

	// Bay names: sized and judged once for their wing's lift (FitBayLabels), shown only at L2 and only where they fit.
	for (const FBpPlanBay& Bay : Plan.bays)
	{
		UWidgetComponent* Label = MakeLabel(SNew(STextBlock).Text(FText::FromString(Bay.name))
				.Font(FCoreStyle::GetDefaultFontStyle("Regular", LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper)),
			PlanToPaperCm(FVector2D(Bay.box.x, Bay.box.y)), FVector2D(0.0, 0.0), LabelCapHeightCm, BayFloorCm + LabelLiftCm, Bays);
		Label->SetVisibility(false);
		BayLabels.Add(Label);
	}
	BayNameFits.Init(false, Plan.bays.Num());
	FitBayLabels();
}

void ABpTable::FitBayLabels()
{
	if (!SheetPlan.IsValid()) return;
	const FSlateFontInfo Font = FCoreStyle::GetDefaultFontStyle("Regular", LabelFontSize);
	for (int32 Index = 0; Index < SheetPlan->bays.Num() && Index < BayLabels.Num(); ++Index)
	{
		const FBpPlanBay& Bay = SheetPlan->bays[Index];
		// Under its wing's lift (a fixed scale per wing), a local cap of LabelCapHeightCm / scale is the floor on the
		// table. Judged once, at the plan, so a bay name never moves between levels.
		const int32 Room = BayRoom.IsValidIndex(Index) ? BayRoom[Index] : INDEX_NONE;
		const FBpPlanWing* Wing = RoomWing.IsValidIndex(Room) ? FindWing(RoomWing[Room]) : nullptr;
		float WingScale = 1.f;
		FVector Centre, Slide;
		if (Wing) WingLift(*Wing, WingScale, Centre, Slide);
		const double CapCm = LabelCapHeightCm / WingScale;
		const double EmCm = CapCm / RobotoCapPerEm;
		const double CmPerSlate = CapCm / (LabelFontSize * SlatePxPerPoint * RobotoCapPerEm);
		const double Width = MeasureText(Bay.name, Font).X * CmPerSlate;
		const double Needed = LevelLabelGapCm + (RobotoCapPerEm + RobotoInkDescPerEm) * EmCm;
		BayNameFits[Index] = Width <= Bay.box.w * BpPlanUnitCm - 2.0 * LevelLabelInsetCm && Needed <= BayHeaderCm[Index];
		const FVector2D Corner = PlanToPaperCm(FVector2D(Bay.box.x, Bay.box.y))
			+ FVector2D(LevelLabelInsetCm, LevelLabelGapCm - (RobotoAscPerEm - RobotoCapPerEm) * EmCm);
		BayLabels[Index]->SetRelativeLocation(PaperCmToLocal(Corner, BayFloorCm + LabelLiftCm));
		BayLabels[Index]->SetRelativeScale3D(FVector(CmPerSlate));
	}
	TArray<FString> Fit;
	for (int32 Index = 0; Index < BayNameFits.Num(); ++Index)
	{
		if (BayNameFits[Index]) Fit.Add(SheetPlan->bays[Index].id);
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTable: bay names fit at the label floor %d/%d [%s]"), Fit.Num(), BayNameFits.Num(), *FString::Join(Fit, TEXT(", ")));
}

void ABpTable::RefreshWingCounts()
{
	if (!SheetPlan.IsValid()) return;
	WingCounts.Reset();
	for (const FBpPlanWing& WingNode : SheetPlan->wings)
	{
		const FString& Wing = WingNode.id;
		int32 RoomCount = 0, Features = 0, Bad = 0;
		for (int32 Room = 0; Room < RoomWing.Num(); ++Room) RoomCount += RoomWing[Room] == Wing ? 1 : 0;
		for (int32 Tile = 0; Tile < SheetPlan->tiles.Num() && Tile < TileRoom.Num(); ++Tile)
		{
			if (TileRoom[Tile] == INDEX_NONE || RoomWing[TileRoom[Tile]] != Wing) continue;
			++Features;
			const FString* Reading = SheetPlan->tiles[Tile].health.Find(ActiveLens);
			Bad += Reading && *Reading == TEXT("bad") ? 1 : 0;
		}
		FString Line = FString::Printf(TEXT("%d %s · %d %s"), RoomCount, RoomCount == 1 ? TEXT("room") : TEXT("rooms"),
			Features, Features == 1 ? TEXT("feature") : TEXT("features"));
		if (Bad > 0) Line += FString::Printf(TEXT(" · %d bad"), Bad);
		WingCounts.Add(Wing, Line.ToUpper());
	}
	RedrawSheet();
}

float ABpTable::TileHeightCm(const FString& Reading)
{
	if (Reading == TEXT("bad")) return TileBadCm;
	if (Reading == TEXT("watch")) return TileWatchCm;
	if (Reading == TEXT("good")) return TileGoodCm;
	return TileUnmeasuredCm;
}

void ABpTable::BuildVolumes(const FBpPlan& Plan)
{
	ClearVolumes();
	// A plan box as one instance of the 100 cm cube: its footprint on the paper (X toward the far edge, Y to the right,
	// as PaperCmToLocal maps it), its height above the paper, and its size in cm as the material's custom data.
	TArray<FTransform> Transforms;
	TArray<float> Sizes;
	const auto Add = [&](const FBpPlanBox& Box, float HeightCm)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Box.x, Box.y)), B = PlanToPaperCm(FVector2D(Box.x + Box.w, Box.y + Box.h));
		const FVector Size(B.Y - A.Y, B.X - A.X, HeightCm);
		Transforms.Add(FTransform(FQuat::Identity, PaperCmToLocal((A + B) * 0.5, HeightCm * 0.5f), Size / 100.0));
		// Show starts at 0: nothing stands at L0 (the levels raise it).
		Sizes.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), 0.f });
	};
	const auto Fill = [&](UInstancedStaticMeshComponent* Kind)
	{
		Kind->SetNumCustomDataFloats(VolumeCustomFloats);
		if (Transforms.Num() > 0)
		{
			Kind->AddInstances(Transforms, false, false, false);
			Kind->SetCustomData(0, Transforms.Num() - 1, Sizes, true);
		}
		Transforms.Reset();
		Sizes.Reset();
	};

	for (const FBpPlanRoom& Room : Plan.rooms) Add(Room.box, RoomShellCm);
	Fill(Rooms);
	for (const FBpPlanBay& Bay : Plan.bays) Add(Bay.box, BayFloorCm);
	Fill(Bays);
	// Tile i is Plan.tiles[i], so SetActiveLens can re-height it from the plan alone.
	for (const FBpPlanTile& Tile : Plan.tiles)
	{
		const FString* Reading = Tile.health.Find(ActiveLens);
		Add(Tile.box, TileHeightCm(Reading ? *Reading : FString()));
	}
	Fill(Tiles);

	// The rooms at rest (FC1, element 4): each room a low extrusion, each bay a lower partition inside it, all on the
	// paper; custom data 4 is the face factor (1 a room's faint glass, 0 a partition's edges only).
	TMap<FString, int32> RoomOf;
	for (int32 Index = 0; Index < Plan.rooms.Num(); ++Index) RoomOf.Add(Plan.rooms[Index].id, Index);
	RestRoom.Reset();
	TArray<float> Rest;
	const auto AddRest = [&](const FBpPlanBox& Box, float HeightCm, float Face, int32 Room)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Box.x, Box.y)), B = PlanToPaperCm(FVector2D(Box.x + Box.w, Box.y + Box.h));
		const FVector Size(B.Y - A.Y, B.X - A.X, HeightCm);
		Transforms.Add(FTransform(FQuat::Identity, PaperCmToLocal((A + B) * 0.5, HeightCm * 0.5f), Size / 100.0));
		Rest.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), 0.f, Face });
		RestRoom.Add(Room);
	};
	for (int32 Index = 0; Index < Plan.rooms.Num(); ++Index) AddRest(Plan.rooms[Index].box, RestRoomCm, 1.f, Index);
	for (const FBpPlanBay& Bay : Plan.bays)
	{
		const int32* Room = RoomOf.Find(Bay.parentId);
		AddRest(Bay.box, RestRoomCm * BayPartitionRatio, 0.f, Room ? *Room : INDEX_NONE);
	}
	RestVolumes->SetNumCustomDataFloats(VolumeCustomFloats + 1);
	if (Transforms.Num() > 0)
	{
		RestVolumes->AddInstances(Transforms, false, false, false);
		RestVolumes->SetCustomData(0, Transforms.Num() - 1, Rest, true);
	}
	Transforms.Reset();
}

const UObject* ABpTable::TextFontObject()
{
	return GTextFont.Get();
}

int32 ABpTable::CVarL0VolumesValue()
{
	return CVarL0Volumes.GetValueOnGameThread();
}

void ABpTable::ClearVolumes()
{
	RestVolumes->ClearInstances();
	LiftedShell->ClearInstances();
	Rooms->ClearInstances();
	Bays->ClearInstances();
	Tiles->ClearInstances();
}

void ABpTable::SetActiveLens(const FString& Lens)
{
	if (!SheetPlan.IsValid() || !SheetPlan->lenses.Contains(Lens))
	{
		UE_LOG(LogBpTable, Warning, TEXT("BpTable: lens %s is not one of the plan's lenses"), *Lens);
		return;
	}
	ActiveLens = Lens;
	TitleLensLine = ActiveLens;
	// The wings' "bad" counts read the lens too; their text changes, never their place.
	RefreshWingCounts();

	// Only the height changes: the footprint (x, y and the scale across it) is kept from the instance as it stands.
	const int32 Count = FMath::Min(Tiles->GetInstanceCount(), SheetPlan->tiles.Num());
	TArray<FTransform> Transforms;
	Transforms.SetNum(Count);
	int32 Moved = 0;
	for (int32 Index = 0; Index < Count; ++Index)
	{
		FTransform Before;
		Tiles->GetInstanceTransform(Index, Before);
		const FString* Reading = SheetPlan->tiles[Index].health.Find(ActiveLens);
		const float HeightCm = TileHeightCm(Reading ? *Reading : FString());
		const FVector Location = Before.GetLocation(), Scale = Before.GetScale3D();
		// HeightCm * (1 / 100) is how BuildVolumes' FVector division rounds, so a lens and back is bit for bit.
		Transforms[Index] = FTransform(FQuat::Identity, FVector(Location.X, Location.Y, HeightCm * 0.5f), FVector(Scale.X, Scale.Y, HeightCm * (1.0 / 100.0)));
		Tiles->SetCustomDataValue(Index, 2, HeightCm);
		const FVector After = Transforms[Index].GetLocation();
		if (After.X != Location.X || After.Y != Location.Y) ++Moved;
	}
	if (Count > 0) Tiles->BatchUpdateInstancesTransforms(0, Transforms, false, true);
	UE_LOG(LogBpTable, Log, TEXT("BpTable: lens=%s tiles=%d moved=%d"), *ActiveLens, Count, Moved);
}

void ABpTable::ShowNoPlan()
{
	// A table that already shows a plan keeps it; one that never had one says what it waits for.
	if (SheetPlan.IsValid()) return;
	ClearVolumes();
	SetTitle(TEXT("waiting for the server"), FString());
	if (!bLoggedNoPlan)
	{
		bLoggedNoPlan = true;
		UE_LOG(LogBpTable, Warning, TEXT("BpTable: no plan (waiting for the server)"));
	}
}

void ABpTable::DrawSheet(UCanvas* Canvas, int32 Width, int32 Height)
{
	if (!Canvas || !SheetPlan.IsValid()) return;
	FSheetPen Pen;
	const auto Px = [this](double X, double Y) { return PaperCmToSheetPx(PlanToPaperCm(FVector2D(X, Y))); };
	const auto PaperPx = [](double U, double V) { return PaperCmToSheetPx(FVector2D(U, V)); };

	// The paper's grid over the whole sheet: quiet fine lines, a stronger line every GridMajorEvery. Butt ends (the pen's
	// square caps would overlap at every crossing and dot the grid).
	const auto GridLine = [&Pen](const FVector2D& From, const FVector2D& To, float WidthPx, const FLinearColor& Color)
	{
		const FVector2D Across = FVector2D(From.Y - To.Y, To.X - From.X).GetSafeNormal() * (WidthPx * 0.5f);
		Pen.Quad(From - Across, To - Across, To + Across, From + Across, Color);
	};
	const FLinearColor GridFine = CyanWhite.CopyWithNewOpacity(GridFineOpacity);
	const FLinearColor GridMajor = CyanWhite.CopyWithNewOpacity(GridMajorOpacity);
	for (int32 Line = 1; Line * GridFineCm < PaperWidthCm; ++Line)
	{
		const bool bMajor = Line % GridMajorEvery == 0;
		GridLine(PaperPx(Line * GridFineCm, 0.0), PaperPx(Line * GridFineCm, PaperDepthCm), bMajor ? GridMajorPx : GridFinePx, bMajor ? GridMajor : GridFine);
	}
	for (int32 Line = 1; Line * GridFineCm < PaperDepthCm; ++Line)
	{
		const bool bMajor = Line % GridMajorEvery == 0;
		GridLine(PaperPx(0.0, Line * GridFineCm), PaperPx(PaperWidthCm, Line * GridFineCm), bMajor ? GridMajorPx : GridFinePx, bMajor ? GridMajor : GridFine);
	}

	// The floor plan: each wing's soft fill, its tiles', bays' and rooms' flat outlines, then the wing's outline. While a wing is
	// lifted every other wing's ink is dimmed (SheetInkFactor); the lifted one's stays, the footprint under it.
	const auto Outline = [&Pen, &Px](const FBpPlanBox& Box, float WidthPx, const FLinearColor& Color)
	{
		const FVector2D A = Px(Box.x, Box.y), B = Px(Box.x + Box.w, Box.y + Box.h);
		Pen.Line(A, FVector2D(B.X, A.Y), WidthPx, Color);
		Pen.Line(FVector2D(B.X, A.Y), B, WidthPx, Color);
		Pen.Line(B, FVector2D(A.X, B.Y), WidthPx, Color);
		Pen.Line(FVector2D(A.X, B.Y), A, WidthPx, Color);
	};
	for (const FBpPlanWing& Wing : SheetPlan->wings)
	{
		const float Ink = SheetInkFactor(Wing.id);
		const bool bLit = !SheetHighlightWing.IsEmpty() && Wing.id == SheetHighlightWing;
		Pen.Fill(Px(Wing.box.x, Wing.box.y), Px(Wing.box.x + Wing.box.w, Wing.box.y + Wing.box.h),
			CyanWhite.CopyWithNewOpacity((bLit ? HighlightFillOpacity : WingFillOpacity) * Ink));
	}
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
	{
		const int32 Room = TileRoom.IsValidIndex(Index) ? TileRoom[Index] : INDEX_NONE;
		const float Ink = RoomWing.IsValidIndex(Room) ? SheetInkFactor(RoomWing[Room]) : 1.f;
		Outline(SheetPlan->tiles[Index].box, TileEdgePx, CyanWhite.CopyWithNewOpacity(TileEdgeOpacity * Ink));
	}
	for (int32 Index = 0; Index < SheetPlan->bays.Num(); ++Index)
	{
		const int32 Room = BayRoom.IsValidIndex(Index) ? BayRoom[Index] : INDEX_NONE;
		const float Ink = RoomWing.IsValidIndex(Room) ? SheetInkFactor(RoomWing[Room]) : 1.f;
		Outline(SheetPlan->bays[Index].box, BayEdgePx, CyanWhite.CopyWithNewOpacity(BayEdgeOpacity * Ink));
	}
	for (const FBpPlanRoom& Room : SheetPlan->rooms)
	{
		Outline(Room.box, RoomEdgePx, CyanWhite.CopyWithNewOpacity(RoomEdgeOpacity * SheetInkFactor(Room.parentId)));
	}
	for (const FBpPlanWing& Wing : SheetPlan->wings)
	{
		const bool bLit = !SheetHighlightWing.IsEmpty() && Wing.id == SheetHighlightWing;
		Outline(Wing.box, bLit ? HighlightEdgePx : WingEdgePx, CyanWhite.CopyWithNewOpacity(bLit ? 1.f : WingEdgeOpacity * SheetInkFactor(Wing.id)));
	}

	// The ornament and the text (FC1): its lines join the same triangle batch, its text is drawn after them.
	DrawSheetText(Canvas, Pen.Tris);
}

void ABpTable::DrawSheetText(UCanvas* Canvas, TArray<FCanvasUVTri>& Tris)
{
	// The paper reads the sheet's alpha as ink, and text writes alpha only when the canvas is told to.
	if (Canvas->Canvas) Canvas->Canvas->SetWriteDestinationAlpha(true);
	FSheetPen Pen;
	Pen.Tris = MoveTemp(Tris);
	const auto PaperPx = [](double U, double V) { return PaperCmToSheetPx(FVector2D(U, V)); };
	const auto LineCm = [&Pen, &PaperPx](double U0, double V0, double U1, double V1, float WidthPx, const FLinearColor& Color)
	{
		Pen.Line(PaperPx(U0, V0), PaperPx(U1, V1), WidthPx, Color);
	};

	// Text is laid out in paper cm by its cap's top edge, and drawn after the lines. Slate measures it in sheet pixels.
	struct FSheetText
	{
		FString Text;
		FVector2D Px;
		FSlateFontInfo Font;
		FLinearColor Color;
		float Tracking;
	};
	TArray<FSheetText> Texts;
	const auto Width = [](const FString& Text, const FSlateFontInfo& Font, float Tracking)
	{
		return (MeasureText(Text, Font).X + Tracking * Text.Len()) / SheetPxPerCm;
	};
	const auto Put = [&Texts, &Width](const FString& Text, double U, double CapTopV, double CapCm, const TCHAR* Style, const FLinearColor& Color, double Align, float Tracking)
	{
		const FSlateFontInfo Font = SheetFont(Style, CapCm);
		const double W = Width(Text, Font, Tracking);
		// A line box starts the ascender above the baseline, which is the cap height below the cap's top.
		const double Top = CapTopV - (RobotoAscPerEm - RobotoCapPerEm) * (CapCm / RobotoCapPerEm);
		Texts.Add({ Text, PaperCmToSheetPx(FVector2D(U - W * Align, Top)), Font, Color, Tracking });
		return W;
	};
	/** The cap height at which Text fits MaxCm, from CapCm down to FloorCm in 0.05 cm steps (never under the floor). */
	const auto Fit = [&Width](const FString& Text, const TCHAR* Style, double CapCm, double FloorCm, double MaxCm, float TrackPerCap)
	{
		for (double Cap = CapCm; Cap > FloorCm; Cap -= 0.05)
		{
			if (Width(Text, SheetFont(Style, Cap), static_cast<float>(TrackPerCap * Cap)) <= MaxCm) return Cap;
		}
		return FloorCm;
	};
	const auto Ink = [](const FLinearColor& Color, float Opacity) { return Color.CopyWithNewOpacity(Opacity); };
	const bool bDimmed = !SheetDimWing.IsEmpty();
	const float TextInk = bDimmed ? LevelDim : 1.f;

	// ---- The wing titles, above each wing (lookdev 00's "WING 03"): the letter, the name, the counts --------------------
	for (const FBpPlanWing& Wing : SheetPlan->wings)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Wing.box.x, Wing.box.y));
		const FVector2D B = PlanToPaperCm(FVector2D(Wing.box.x + Wing.box.w, Wing.box.y + Wing.box.h));
		const double MaxCm = B.X - A.X - 0.2;
		const float Track = TrackingPx;
		double Base = A.Y - 0.45;
		const FString Counts = WingCounts.FindRef(Wing.id);
		const double CountsCap = Fit(Counts, TEXT("Regular"), WingCountsCapCm, WingCountsFloorCm, MaxCm, Track);
		Put(Counts, A.X, Base - CountsCap, CountsCap, TEXT("Regular"), Ink(CyanWhite, 0.8f * TextInk), 0.0, static_cast<float>(Track * CountsCap));
		Base -= CountsCap + 0.5;
		const FString Name = Wing.name.ToUpper();
		const double NameCap = Fit(Name, TEXT("Bold"), WingNameCapCm, WingNameFloorCm, MaxCm, Track);
		Put(Name, A.X, Base - NameCap, NameCap, TEXT("Bold"), Ink(WarmPaper, TextInk), 0.0, static_cast<float>(Track * NameCap));
		Base -= NameCap + 0.45;
		Put(FString::Printf(TEXT("WING %s"), *Wing.letter), A.X, Base - WingTagCapCm, WingTagCapCm, TEXT("Regular"),
			Ink(CyanWhite, 0.75f * TextInk), 0.0, static_cast<float>(2.0 * Track * WingTagCapCm));

		// Dimensions, from the plan's boxes only: the wing's width under it (its figure in plan units), and a chain down
		// its left side ticked at every room's edge.
		const FLinearColor Dim = Ink(CyanWhite, DimOpacity * TextInk);
		const double Dv = B.Y + DimOffsetCm;
		LineCm(A.X, B.Y + 0.2, A.X, Dv + 0.35, 2.f, Dim);
		LineCm(B.X, B.Y + 0.2, B.X, Dv + 0.35, 2.f, Dim);
		LineCm(A.X, Dv, B.X, Dv, 2.f, Dim);
		for (const double U : { A.X, B.X }) LineCm(U - DimTickCm, Dv + DimTickCm, U + DimTickCm, Dv - DimTickCm, 3.f, Dim);
		Put(FString::Printf(TEXT("%d"), FMath::RoundToInt(Wing.box.w)), (A.X + B.X) * 0.5, Dv + 0.3, FigureCapCm, TEXT("Regular"), Dim, 0.5, 0.f);
		const double Du = A.X - DimOffsetCm;
		LineCm(Du, A.Y, Du, B.Y, 2.f, Dim);
		TSet<int32> Edges;
		for (const FBpPlanRoom& Room : SheetPlan->rooms)
		{
			if (Room.parentId != Wing.id) continue;
			Edges.Add(FMath::RoundToInt(Room.box.y));
			Edges.Add(FMath::RoundToInt(Room.box.y + Room.box.h));
		}
		Edges.Add(FMath::RoundToInt(Wing.box.y));
		Edges.Add(FMath::RoundToInt(Wing.box.y + Wing.box.h));
		for (const int32 Y : Edges)
		{
			const double V = PlanToPaperCm(FVector2D(Wing.box.x, Y)).Y;
			LineCm(Du - DimTickCm, V + DimTickCm, Du + DimTickCm, V - DimTickCm, 3.f, Dim);
		}
	}

	// ---- The title block, near-left: the level's plan, the product, the scale and the lens --------------------------
	{
		const TCHAR* Names[] = { TEXT("SITE PLAN — LEVEL 0"), TEXT("WING PLAN — LEVEL 1"), TEXT("ROOM PLAN — LEVEL 2") };
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FString Product = (Link.GetProductName().IsEmpty() ? Link.GetProductSlug() : Link.GetProductName()).ToUpper();
		const FString Caption = FString::Printf(TEXT("SCALE 1 CM = %d PLAN UNITS%s%s"), FMath::RoundToInt(1.0 / BpPlanUnitCm),
			TitleLensLine.IsEmpty() ? TEXT("") : TEXT("  ·  LENS "), *TitleLensLine.ToUpper());
		const double Base3 = TitleBaseCm, Top3 = Base3 - CaptionCapCm;
		const double Top2 = Top3 - 0.55 - TitleSubCapCm;
		const double Top1 = Top2 - 0.75 - TitleCapCm;
		double W = Put(Names[static_cast<int32>(Level)], TitleLeftCm, Top1, TitleCapCm, TEXT("Bold"), Ink(WarmPaper, 1.f), 0.0, static_cast<float>(TrackingPx * TitleCapCm));
		W = FMath::Max(W, Put(Product, TitleLeftCm, Top2, TitleSubCapCm, TEXT("Regular"), Ink(CyanWhite, 0.9f), 0.0, static_cast<float>(2.0 * TrackingPx * TitleSubCapCm)));
		W = FMath::Max(W, Put(Caption, TitleLeftCm, Top3, CaptionCapCm, TEXT("Regular"), Ink(CyanWhite, 0.75f), 0.0, static_cast<float>(TrackingPx * CaptionCapCm)));
		// The block's frame and the rule under its first line, as a drawing's title block.
		const FLinearColor FrameInk = Ink(CyanWhite, 0.55f);
		const double L = TitleLeftCm - 0.7, R = TitleLeftCm + W + 0.7, T = Top1 - 0.7, Bm = Base3 + 0.55, Rule = Top2 - 0.4;
		LineCm(L, T, R, T, 3.f, FrameInk);
		LineCm(R, T, R, Bm, 3.f, FrameInk);
		LineCm(R, Bm, L, Bm, 3.f, FrameInk);
		LineCm(L, Bm, L, T, 3.f, FrameInk);
		LineCm(L, Rule, R, Rule, 2.f, FrameInk);
	}

	// ---- The compass rose, in the left margin: two rings, the cross and its ticks, a north arrow toward the far edge ----
	{
		const FLinearColor Rose = Ink(CyanWhite, 0.8f);
		const FVector2D C = CompassCm;
		const double R = CompassRadiusCm;
		constexpr int32 Sides = 96;
		for (int32 Side = 0; Side < Sides; ++Side)
		{
			const double A0 = 2.0 * UE_DOUBLE_PI * Side / Sides, A1 = 2.0 * UE_DOUBLE_PI * (Side + 1) / Sides;
			LineCm(C.X + R * FMath::Cos(A0), C.Y + R * FMath::Sin(A0), C.X + R * FMath::Cos(A1), C.Y + R * FMath::Sin(A1), 3.f, Rose);
			LineCm(C.X + 0.72 * R * FMath::Cos(A0), C.Y + 0.72 * R * FMath::Sin(A0), C.X + 0.72 * R * FMath::Cos(A1), C.Y + 0.72 * R * FMath::Sin(A1), 2.f, Ink(CyanWhite, 0.5f));
		}
		for (int32 Tick = 0; Tick < 32; ++Tick)
		{
			const double A = 2.0 * UE_DOUBLE_PI * Tick / 32, In = (Tick % 8 == 0) ? 0.8 : (Tick % 4 == 0 ? 0.88 : 0.93);
			LineCm(C.X + R * In * FMath::Cos(A), C.Y + R * In * FMath::Sin(A), C.X + R * FMath::Cos(A), C.Y + R * FMath::Sin(A), 2.f, Rose);
		}
		LineCm(C.X, C.Y + R * 1.15, C.X, C.Y - R * 1.15, 2.f, Rose);
		LineCm(C.X - R * 1.15, C.Y, C.X + R * 1.15, C.Y, 2.f, Rose);
		// The north arrow: one half filled, one half outlined (paper v runs toward the viewer, so north is -v).
		const FVector2D N = PaperPx(C.X, C.Y - R * 0.95), S = PaperPx(C.X, C.Y + R * 0.35);
		const FVector2D Lf = PaperPx(C.X - R * 0.22, C.Y), Rt = PaperPx(C.X + R * 0.22, C.Y);
		Pen.Quad(N, Rt, S, S, Ink(CyanWhite, 0.85f));
		Pen.Line(N, Lf, 3.f, Rose);
		Pen.Line(Lf, S, 3.f, Rose);
		Put(TEXT("N"), C.X, C.Y - R * 1.15 - 0.35 - 1.0, 1.0, TEXT("Bold"), Ink(WarmPaper, 1.f), 0.5, 0.f);
	}

	// ---- The scale bar, near-right under the last wings: ScaleBarCm on the table, alternate centimetres filled ---------
	{
		const FLinearColor Bar = Ink(CyanWhite, 0.85f);
		const double U0 = ScaleBarLeftCm, V = ScaleBarVCm, H = 0.35;
		const int32 Cms = FMath::RoundToInt(ScaleBarCm);
		LineCm(U0, V, U0 + Cms, V, 2.f, Bar);
		LineCm(U0, V + H, U0 + Cms, V + H, 2.f, Bar);
		for (int32 Cm = 0; Cm <= Cms; ++Cm)
		{
			LineCm(U0 + Cm, V - (Cm == 0 || Cm == 5 || Cm == 10 || Cm == Cms ? 0.4 : 0.0), U0 + Cm, V + H, 2.f, Bar);
			if (Cm < Cms && Cm % 2 == 0) Pen.Fill(PaperPx(U0 + Cm, V), PaperPx(U0 + Cm + 1, V + H), Ink(CyanWhite, 0.6f));
			if (Cm == 0 || Cm == 5 || Cm == 10 || Cm == Cms) Put(FString::Printf(TEXT("%d"), Cm), U0 + Cm, V - 0.55 - FigureCapCm, FigureCapCm, TEXT("Regular"), Bar, 0.5, 0.f);
		}
		Put(TEXT("CM"), U0 + Cms * 0.5, V + H + 0.4, FigureCapCm, TEXT("Regular"), Ink(CyanWhite, 0.7f), 0.5, static_cast<float>(TrackingPx * FigureCapCm));
	}

	if (Pen.Tris.Num() > 0)
	{
		FCanvasTriangleItem Item(Pen.Tris, GWhiteTexture);
		Item.BlendMode = SE_BLEND_AlphaBlend;
		Canvas->DrawItem(Item);
	}

	// ---- The breadcrumb, near-right (WP3's way back; its boxes are SetCrumbs' hit regions) ----------------------------
	{
		const FSlateFontInfo Way = SheetFont(TEXT("Regular"), LabelCapHeightCm);
		for (int32 Index = 0; Index < Crumbs.Num(); ++Index)
		{
			const FCrumb& Crumb = Crumbs[Index];
			const FLinearColor Color = Crumb.bLit ? CyanWhite : WarmPaper;
			Texts.Add({ Crumb.Text, PaperCmToSheetPx(Crumb.PaperCm.Min), SheetFont(Crumb.bHere ? TEXT("Bold") : TEXT("Regular"), LabelCapHeightCm), Color, 0.f });
			if (Index + 1 < Crumbs.Num())
			{
				Texts.Add({ CrumbSeparator, PaperCmToSheetPx(FVector2D(Crumb.PaperCm.Max.X, Crumb.PaperCm.Min.Y)), Way, WarmPaper, 0.f });
			}
		}
	}

	for (const FSheetText& Text : Texts)
	{
		FCanvasTextItem Item(Text.Px, FText::FromString(Text.Text), Text.Font, Text.Color);
		Item.HorizSpacingAdjust = Text.Tracking;
		Canvas->DrawItem(Item);
	}
}
