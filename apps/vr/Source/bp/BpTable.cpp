// The light table (lynx-plan L3.2, L3.3). See BpTable.h for the frame of reference and the named constants.
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpType.h"
#include "CanvasItem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Canvas.h"
#include "Engine/Font.h"
#include "Engine/FontFace.h"
#include "Fonts/CompositeFont.h"
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

	/** Text. Slate sizes fonts in points at 96 DPI (FreeType pixel size = size * 96/72); the family's metrics are
	 *  BpType's. A label's world scale is chosen so its cap height on the paper is the cap height asked for. */
	constexpr int32 LabelFontSize = 48;
	constexpr float SlatePxPerPoint = 96.f / 72.f;
	constexpr float TypeCapPerEm = static_cast<float>(BpType::CapPerEm);
	/** A text line's box starts the ascender above the baseline; g, p and y reach the descender below it. A name fits a
	 *  strip when its cap height and that descent do. */
	constexpr float TypeAscPerEm = static_cast<float>(BpType::AscPerEm);
	constexpr float TypeInkDescPerEm = static_cast<float>(BpType::DescPerEm);
	/** Room names sit in the room's header strip (the plan leaves 72 u above the first bay), bay names in the bay's
	 *  (46 u above the first tile): this far in from the box's left edge and below its top edge, to the cap's top. */
	constexpr float LevelLabelInsetCm = 0.6f;
	constexpr float LevelLabelGapCm = 0.25f;
	/** The breadcrumb's separator, and its right edge (TitleAnchorCm.X) on the paper. */
	const TCHAR* const CrumbSeparator = TEXT("  ›  ");
	const FVector2D TitleAnchorCm(ABpTable::PaperWidthCm - 30.0, ABpTable::PaperDepthCm - 1.2);

	/** A text's size in Slate units, from the renderer's font measure, or the family's average capital advance when there
	 *  is none (a null-RHI run): only a hit region's width rests on it. */
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
		return FVector2D(Text.Len() * 0.533f * EmPx, 1.2f * EmPx);
	}

	/** Sheet pixels per paper centimetre (the render target covers the paper; its pixels are square). */
	constexpr double SheetPxPerCm = ABpTable::SheetWidthPx / ABpTable::PaperWidthCm;

	/** A font for the sheet whose cap height is CapCm on the paper (its size is in sheet pixels, so Slate's measure of a
	 *  text is its width in sheet pixels). */
	FSlateFontInfo SheetFont(const TCHAR* Style, double CapCm)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), static_cast<float>(CapCm * SheetPxPerCm / (TypeCapPerEm * SlatePxPerPoint)), FName(Style));
	}

	/** Roboto from the table's constructor (the class default object's runs at startup), the sheet's font from BeginPlay. */
	TWeakObjectPtr<UObject> GTextFont;

	/** A Slate font in the sheet's family, for the widget labels (Roboto's while the family is not built). */
	FSlateFontInfo LabelFont(const TCHAR* Style, float Size)
	{
		if (const UObject* Font = ABpTable::TextFontObject()) return FSlateFontInfo(Font, Size, FName(Style));
		return FCoreStyle::GetDefaultFontStyle(FName(Style), Size);
	}

	/** The sheet's text (FC1, set by BpType's recipes since FC3). Above each wing its tag and name (lookdev 00's "WING 03"),
	 *  clear of the rest walls' glowing tops; the room names in their header strips where they meet the floor; the title
	 *  block, with the scale bar in it, on the paper the shortest wing leaves empty (off the hands' path in the target
	 *  framing); the breadcrumb near-right (the hands' way back, WP3); the compass in the left margin. */
	constexpr double WingLabelGapCm = 1.1;
	constexpr double WingLabelClearCm = 0.4;
	constexpr double WingTagGapCm = 0.45;
	/** The paper above the highest tag line that stays clear of the frame's glow strip. */
	constexpr double PaperTopClearCm = 0.3;
	constexpr double RoomNameInsetCm = 0.6;
	/** A room name's baseline sits this far above the room's first bay (its descenders and a gap). */
	constexpr double RoomNameFootCm = 0.2;
	constexpr double RoomNameClearCm = 0.35;
	/** The title block: this far below the shortest wing, its padding, its rows' gaps, the scale bar's height. */
	constexpr double TitleBelowWingCm = 3.5;
	constexpr double TitlePadCm = 0.9;
	constexpr double TitleRowGapCm = 1.0;
	constexpr double ScaleBarHeightCm = 0.35;
	/** The breadcrumb's line box: its bottom on the paper (it is right-aligned to TitleAnchorCm.X, near-right, where the
	 *  target framing still sees the paper). */
	constexpr double CrumbBottomCm = 74.6;
	/** The compass (left margin). */
	const FVector2D CompassCm(6.25, 36.0);
	constexpr double CompassRadiusCm = 3.6;
	/** Annotation: the dimension lines' offset from a wing's box, their ticks, and their ink (lines only since FC3: their
	 *  figures could not meet the floor beside the wings). */
	constexpr double DimOffsetCm = 0.6;
	constexpr double DimTickCm = 0.35;
	constexpr float DimOpacity = 0.3f;

	/** The tags' paper and ink. */
	const FLinearColor TagInk(FColor(0x0B, 0x2A, 0x6B));

	/** The line-weight hierarchy (FC3): the wing outline strongest and alone in a glow, the rooms medium, the bays and the
	 *  tiles' cells fine. Widths in sheet pixels (24.7 a centimetre). The grid is M_BlueprintPaper's own since FG: drawn
	 *  analytically at the screen's pixel (fg_holo.py), it stays crisp where the sheet's raster grid blurred or shimmered. */
	constexpr float WingFillOpacity = 0.07f;
	constexpr float WingEdgeOpacity = 1.f;
	constexpr float WingEdgePx = 7.f;
	/** The wing outline's glow: two wider, fainter strokes under it. */
	constexpr float WingGlowPx[2] = { 34.f, 16.f };
	constexpr float WingGlowOpacity[2] = { 0.06f, 0.14f };
	constexpr float RoomEdgeOpacity = 0.62f;
	constexpr float RoomEdgePx = 4.f;
	constexpr float BayEdgeOpacity = 0.3f;
	constexpr float BayEdgePx = 2.f;
	constexpr float TileEdgeOpacity = 0.16f;
	constexpr float TileEdgePx = 2.f;
	/** A highlighted wing (SetHighlight): a heavier, full outline and a brighter fill. */
	constexpr float HighlightEdgePx = 10.f;
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
	/** The rest extrusions' glass (FC1; FE raised it with the edges, so a room reads as a faintly lit glass block). */
	constexpr float RestFaceOpacity = 0.04f;
	/** The lifted room's glass (FE): a stronger face than its siblings', as the concept's raised room. */
	constexpr float LiftedFaceOpacity = 0.15f;
	/** The edges' emissive scale per batch (M_EdgeGlow's Intensity, its default 1.4; FE, elements 4 and 6, against the
	 *  concept's bright cyan edges): the rest extrusions brightest, as the concept's rooms on the sheet; the lifted wing's
	 *  shells and the lifted room's tiles under them; the lifted room's shell carries LiftedRoomShow on top. All of it
	 *  is above the bloom threshold (0.7, fid_look.py), the sheet's text below it (PaperInkGlow). */
	constexpr float RestEdgeIntensity = 3.2f;
	constexpr float ShellEdgeIntensity = 2.4f;
	constexpr float LiftedEdgeIntensity = 3.0f;
	/** The paper (M_BlueprintPaper; FE, element 1): the light box brighter toward its centre (PaperGlow over the texture,
	 *  VignetteEdge left at the corners; the concept's paper glows in the middle and falls off to the rim), and the ink at
	 *  PaperInkGlow: 1 keeps the sheet's text under the bloom threshold, so bloom never smears it (r6 section 2), where 1.5
	 *  bloomed every label. */
	constexpr float PaperGlow = 1.6f;
	constexpr float PaperVignetteEdge = 0.4f;
	constexpr float PaperInkGlow = 1.0f;
	/** The fixture glyphs' glow (M_Glyph's GlyphGlow, its default 0.45; FE: the concept's furniture glows inside the rooms). */
	constexpr float GlyphGlow = 1.0f;
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
	// The beads' sphere: the engine's 224-triangle unit sphere (radius 1 cm), not BasicShapes' 960 (FE: 31 beads).
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereFinder(TEXT("/Engine/ArtTools/RenderToTexture/Meshes/S_1_Unit_Sphere.S_1_Unit_Sphere"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> ShapeMaterialFinder(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	// UWidgetComponent's own unlit material: it shows the Texture parameter `SlateUI` with its alpha, cooked or not.
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> SheetMaterialFinder(TEXT("/Engine/EngineMaterials/Widget3DPassThrough_Translucent.Widget3DPassThrough_Translucent"));
	static ConstructorHelpers::FObjectFinder<UTexture2D> WhiteFinder(TEXT("/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture"));
	static ConstructorHelpers::FObjectFinder<UFont> FontFinder(TEXT("/Engine/EngineFonts/Roboto.Roboto"));
	EngineFont = FontFinder.Object;
	if (EngineFont && !GTextFont.IsValid()) GTextFont = EngineFont;
	EngineCube = CubeFinder.Object;
	EnginePlane = PlaneFinder.Object;
	EngineSphere = SphereFinder.Object;
	EngineShapeMaterial = ShapeMaterialFinder.Object;
	EngineSheetMaterial = SheetMaterialFinder.Object;
	EngineWhiteTexture = WhiteFinder.Object;

	FrameMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Bp/Art/LightTableFrame/SM_LightTableFrame.SM_LightTableFrame")));
	PaperMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_BlueprintPaper.M_BlueprintPaper")));
	HiddenMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_Hidden.M_Hidden")));
	VolumeMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_EdgeGlow.M_EdgeGlow")));
	PinMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Bp/Art/SurveyPin/final/StaticMeshes/SM_SurveyPin.SM_SurveyPin")));
	PinBodyMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_PinBody.M_PinBody")));
	PinHaloMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_PinHalo.M_PinHalo")));
	TagMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_PinTag.M_PinTag")));
	ScanCollection = TSoftObjectPtr<UMaterialParameterCollection>(FSoftObjectPath(TEXT("/Game/Bp/Materials/MPC_BpScan.MPC_BpScan")));
	TypeRegularFace = TSoftObjectPtr<UFontFace>(FSoftObjectPath(TEXT("/Game/Bp/Fonts/BarlowSemiCondensed-Medium.BarlowSemiCondensed-Medium")));
	TypeBoldFace = TSoftObjectPtr<UFontFace>(FSoftObjectPath(TEXT("/Game/Bp/Fonts/BarlowSemiCondensed-SemiBold.BarlowSemiCondensed-SemiBold")));
	// The kit's meshes by the plan's feature kinds (the kit's own mesh names; fixture-kit's hand-over: user_flow a desk
	// and chair, capability a round table and four chairs, ops shelving, integration a sofa, generic a plant).
	for (const TCHAR* Kind : { TEXT("user_flow"), TEXT("capability"), TEXT("ops"), TEXT("integration"), TEXT("generic") })
	{
		GlyphMeshes.Add(Kind, TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(FString::Printf(TEXT("/Game/Bp/Art/FixtureKit/final/StaticMeshes/%s.%s"), Kind, Kind))));
	}
	GlyphMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_Glyph.M_Glyph")));

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
	// The beads and the stems (FE): engine shapes in the pin's amber, no custom data; the unit sphere (radius 1 cm) and
	// the cube (100 cm, pivot at its centre), a square stem 2.4 mm across reading as the pin's round one.
	PinBeads = MakeVolumes(TEXT("PinBeads"));
	PinBeads->NumCustomDataFloats = 0;
	PinBeads->SetStaticMesh(EngineSphere);
	PinStems = MakeVolumes(TEXT("PinStems"));
	PinStems->NumCustomDataFloats = 0;
	// Each bead's halo (FG): the unit sphere again, PinHaloScale times the bead, additive (M_PinHalo).
	PinHalos = MakeVolumes(TEXT("PinHalos"));
	PinHalos->NumCustomDataFloats = 0;
	PinHalos->SetStaticMesh(EngineSphere);
}

float ABpTable::HeightCvarCm()
{
	// Below the rim's thickness there is no table to place.
	return FMath::Max(CVarTableHeightCm.GetValueOnGameThread(), RimThicknessCm + 1.f);
}

FVector2D ABpTable::PlanToPaperCm(const FVector2D& Plan) const
{
	// The plan's extent, scaled by BpPlanUnitCm, at PlanMarginCm.
	return PlanMarginCm() + (Plan - PlanMin) * BpPlanUnitCm;
}

FVector2D ABpTable::PlanMarginCm() const
{
	const FVector2D Centred = (FVector2D(PaperWidthCm, PaperDepthCm) - PlanSize * BpPlanUnitCm) * 0.5;
	// A plan too deep to leave PlanNearMinCm near of the far margin stays centred.
	const bool bRoom = 2.0 * Centred.Y >= PlanFarMarginCm + PlanNearMinCm;
	return FVector2D(Centred.X, bRoom ? static_cast<double>(PlanFarMarginCm) : Centred.Y);
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
		// The room names keep clear of the rest walls, which come and go with it.
		RedrawSheet();
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
	BuildTypeFont();
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
		PaperMid->SetScalarParameterValue(TEXT("PaperGlow"), PaperGlow);
		PaperMid->SetScalarParameterValue(TEXT("VignetteEdge"), PaperVignetteEdge);
		PaperMid->SetScalarParameterValue(TEXT("InkGlow"), PaperInkGlow);
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
			if (Kind == Rooms) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), RoomFaceOpacity);
			if (Kind == LiftedShell) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), LiftedFaceOpacity);
			if (Kind == RestVolumes) Mid->SetScalarParameterValue(TEXT("FaceOpacity"), RestFaceOpacity);
			Mid->SetScalarParameterValue(TEXT("Intensity"), Kind == RestVolumes ? RestEdgeIntensity : Kind == LiftedShell ? LiftedEdgeIntensity : ShellEdgeIntensity);
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

	// The glyphs' material; the batches come with the plan (BuildGlyphs).
	GlyphMid = nullptr;
	if (UMaterialInterface* Glyph = LoadOrGreybox(GlyphMaterial, true))
	{
		GlyphMid = UMaterialInstanceDynamic::Create(Glyph, this);
		GlyphMid->SetScalarParameterValue(TEXT("GlyphGlow"), GlyphGlow);
	}
}

void ABpTable::BuildTypeFont()
{
	UFontFace* Regular = LoadOrGreybox(TypeRegularFace, true);
	UFontFace* Bold = LoadOrGreybox(TypeBoldFace, true);
	if (!Regular || !Bold)
	{
		UE_LOG(LogBpTable, Warning, TEXT("BpTable: the sheet's type faces are missing, its text is Roboto"));
		return;
	}
	// A runtime-cached font of the two faces under the role names the canvas and Slate ask for.
	TypeFont = NewObject<UFont>(this, TEXT("SheetType"));
	TypeFont->FontCacheType = EFontCacheType::Runtime;
	FCompositeFont& Composite = TypeFont->GetMutableInternalCompositeFont();
	Composite.DefaultTypeface.Fonts.Add_GetRef(FTypefaceEntry(TEXT("Regular"))).Font = FFontData(Regular);
	Composite.DefaultTypeface.Fonts.Add_GetRef(FTypefaceEntry(TEXT("Bold"))).Font = FFontData(Bold);
	GTextFont = TypeFont;
	UE_LOG(LogBpTable, Log, TEXT("BpTable: type Barlow Semi Condensed (Regular=%s, Bold=%s), floor %.0f px at the target pose and %.0f arcmin at the play pose"),
		*Regular->GetName(), *Bold->GetName(), BpType::FloorPx, BpType::FloorArcmin);
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

void ABpTable::PlaceExactly(USceneComponent* Component, const FVector& Relative)
{
	// SetRelativeLocation moves through world space and derives the relative location back from it, which is off by a
	// unit in the last place for some places (level_check, FC3: a lifted room's name came back 1 ULP from where it
	// started). Set directly, the relative location is the one asked for and the world one follows from it the same way
	// every time, so a lift and its return are exact.
	Component->SetRelativeLocation_Direct(Relative);
	Component->UpdateComponentToWorld();
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
	Label->SetRelativeScale3D(FVector(CapHeightCm / (LabelFontSize * SlatePxPerPoint * TypeCapPerEm)));
	Label->RegisterComponent();
	Label->SetSlateWidget(Content);
	Label->RequestRedraw();
	if (Parent)
	{
		// On a batch: the batch already stands at the paper's height, so the place is relative to it.
		PlaceExactly(Label, PaperCmToLocal(PaperCm, LiftCm));
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
	BuildGlyphs(*SheetPlan);
	ResetLevels();
	RefreshWingCounts();
	SetTitle(FString(), ActiveLens);
	BuildPins(FBpLinkModule::Get().GetScanState());

	// The sheet once more, with every index in place, logging its type against the floor (the legibility table).
	bReportType = true;
	RedrawSheet();

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
	const double CmPerSlate = LabelCapHeightCm / (LabelFontSize * SlatePxPerPoint * TypeCapPerEm);
	const double EmCm = LabelCapHeightCm / TypeCapPerEm;
	for (const FBpPlanRoom& Room : Plan.rooms)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Room.box.x, Room.box.y));
		const double WidthCm = Room.box.w * BpPlanUnitCm - 2.0 * LevelLabelInsetCm;
		const FVector2D Corner = A + FVector2D(LevelLabelInsetCm, LevelLabelGapCm - (TypeAscPerEm - TypeCapPerEm) * EmCm);
		UWidgetComponent* Label = MakeLabel(SNew(SBox).WidthOverride(static_cast<float>(FMath::Max(1.0, WidthCm) / CmPerSlate))
			[
				SNew(STextBlock).Text(FText::FromString(Room.name)).AutoWrapText(true)
					.Font(LabelFont(TEXT("Regular"), LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper))
			],
			Corner, FVector2D(0.0, 0.0), LabelCapHeightCm, RoomShellCm + LabelLiftCm, Rooms);
		Label->SetVisibility(false);
		RoomLabels.Add(Label);
	}

	// Bay names: sized and judged once for their wing's lift (FitBayLabels), shown only at L2 and only where they fit.
	for (const FBpPlanBay& Bay : Plan.bays)
	{
		UWidgetComponent* Label = MakeLabel(SNew(STextBlock).Text(FText::FromString(Bay.name))
				.Font(LabelFont(TEXT("Regular"), LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper)),
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
	const FSlateFontInfo Font = LabelFont(TEXT("Regular"), LabelFontSize);
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
		const double EmCm = CapCm / TypeCapPerEm;
		const double CmPerSlate = CapCm / (LabelFontSize * SlatePxPerPoint * TypeCapPerEm);
		const double Width = MeasureText(Bay.name, Font).X * CmPerSlate;
		const double Needed = LevelLabelGapCm + (TypeCapPerEm + TypeInkDescPerEm) * EmCm;
		BayNameFits[Index] = Width <= Bay.box.w * BpPlanUnitCm - 2.0 * LevelLabelInsetCm && Needed <= BayHeaderCm[Index];
		const FVector2D Corner = PlanToPaperCm(FVector2D(Bay.box.x, Bay.box.y))
			+ FVector2D(LevelLabelInsetCm, LevelLabelGapCm - (TypeAscPerEm - TypeCapPerEm) * EmCm);
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
	// Not drawn since FC3 (a counts line beside a far wing cannot meet BpType's floor in the margin it has): logged.
	TArray<FString> Lines;
	for (const TPair<FString, FString>& Pair : WingCounts) Lines.Add(Pair.Key + TEXT(" ") + Pair.Value);
	UE_LOG(LogBpTable, Log, TEXT("BpTable: wing counts lens=%s [%s]"), *ActiveLens, *FString::Join(Lines, TEXT("; ")));
	// The title block names the lens.
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
	RestInk.Reset();
	TArray<float> Rest;
	const auto AddRest = [&](const FBpPlanBox& Box, float HeightCm, float Face, int32 Room)
	{
		const FVector2D A = PlanToPaperCm(FVector2D(Box.x, Box.y)), B = PlanToPaperCm(FVector2D(Box.x + Box.w, Box.y + Box.h));
		const FVector Size(B.Y - A.Y, B.X - A.X, HeightCm);
		Transforms.Add(FTransform(FQuat::Identity, PaperCmToLocal((A + B) * 0.5, HeightCm * 0.5f), Size / 100.0));
		Rest.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), 0.f, Face });
		RestRoom.Add(Room);
		RestInk.Add(Face > 0.f ? RestRoomShow : RestPartitionShow);
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

namespace
{
	/** An eye of BpGameMode's poses in the table's space: where it stands, its axes, its focal length in pixels. */
	struct FTypeEye
	{
		FVector Eye;
		FVector Forward;
		FVector Right;
		FVector Up;
		double FocalPx;

		FTypeEye(double BehindNearEdgeCm, double EyeZCm, double PitchDeg, double HFovDeg, double WidthPx)
		{
			Eye = FVector(-(ABpTable::TableDepthCm * 0.5 + BehindNearEdgeCm), 0.0, EyeZCm);
			const double Pitch = FMath::DegreesToRadians(PitchDeg);
			Forward = FVector(FMath::Cos(Pitch), 0.0, FMath::Sin(Pitch));
			Right = FVector(0.0, 1.0, 0.0);
			Up = FVector(-FMath::Sin(Pitch), 0.0, FMath::Cos(Pitch));
			FocalPx = WidthPx * 0.5 / FMath::Tan(FMath::DegreesToRadians(HFovDeg * 0.5));
		}

		FVector2D Project(const FVector& P) const
		{
			const FVector D = P - Eye;
			const double Depth = FMath::Max(FVector::DotProduct(D, Forward), 1.0);
			return FVector2D(FVector::DotProduct(D, Right), -FVector::DotProduct(D, Up)) * (FocalPx / Depth);
		}

		/** The segment's length in the capture, pixels. */
		double Px(const FVector& A, const FVector& B) const { return FVector2D::Distance(Project(A), Project(B)); }

		/** The angle the segment subtends, arcminutes. */
		double Arcmin(const FVector& A, const FVector& B) const
		{
			const double Cos = FVector::DotProduct((A - Eye).GetSafeNormal(), (B - Eye).GetSafeNormal());
			return FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Cos, -1.0, 1.0))) * 60.0;
		}
	};

	/** The captures' width (1600 x 900, BpView.Pose target through PoF capture_viewport). */
	constexpr double CaptureWidthPx = 1600.0;
}

double ABpTable::TextFloorCm(const FVector2D& PaperCm) const
{
	const double Top = PlacedHeightCm > 0.f ? PlacedHeightCm : DefaultTableHeightCm;
	const FTypeEye Target(ABpGameMode::TargetBehindNearEdgeCm, Top + ABpGameMode::TargetEyeAboveTopCm, ABpGameMode::TargetPitchDeg, ABpGameMode::TargetHFovDeg, CaptureWidthPx);
	const FTypeEye Play(ABpGameMode::PlayBehindNearEdgeCm, ABpGameMode::PlayEyeHeightCm, ABpGameMode::PlayPitchDeg, ABpGameMode::PlayHFovDeg, CaptureWidthPx);
	// Text stands upright for the person at the near edge: its cap rises from the baseline toward the far edge (-v).
	const double PaperZ = Top - GlassRecessCm;
	const FVector Base = PaperCmToLocal(PaperCm, PaperZ);
	const auto Meets = [&](double Cap)
	{
		const FVector CapTop = PaperCmToLocal(PaperCm - FVector2D(0.0, Cap), PaperZ);
		return Target.Px(Base, CapTop) >= BpType::FloorPx && Play.Arcmin(Base, CapTop) >= BpType::FloorArcmin;
	};
	double Lo = 0.02, Hi = 12.0;
	for (int32 Step = 0; Step < 32; ++Step)
	{
		const double Mid = (Lo + Hi) * 0.5;
		if (Meets(Mid)) Hi = Mid;
		else Lo = Mid;
	}
	return Hi;
}

double ABpTable::CoverCm(double V, double HeightCm) const
{
	// Seen from the target eye, a wall's top hides the paper behind it out to where the eye's ray over it lands.
	const double EyeAbove = ABpGameMode::TargetEyeAboveTopCm + GlassRecessCm;
	const double Along = (PaperDepthCm * 0.5 - V) + (TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm);
	return HeightCm * FMath::Max(Along, 0.0) / FMath::Max(EyeAbove - HeightCm, 1.0);
}

void ABpTable::BuildGlyphs(const FBpPlan& Plan)
{
	for (UInstancedStaticMeshComponent* Old : Glyphs)
	{
		if (Old) Old->DestroyComponent();
	}
	Glyphs.Reset();
	GlyphRoom.Reset();
	ShownGlyph.Reset();
	if (!GlyphMid) return;

	// Tile i's kind is its feature's (structure.features[].kind, found by the tile's id): the data picks the glyph and the
	// box places it; nothing here lays anything out. A kind the kit has no glyph for takes the generic one.
	const FBpLinkModule& Link = FBpLinkModule::Get();
	TMap<FString, int32> BatchOf;
	TArray<TArray<FTransform>> Places;
	TMap<FString, int32> Counts;
	for (int32 Index = 0; Index < Plan.tiles.Num(); ++Index)
	{
		const FBpPlanTile& Tile = Plan.tiles[Index];
		const FString* Found = Link.FindFeatureKind(Tile.id);
		FString Kind = Found ? *Found : FString(TEXT("generic"));
		if (!GlyphMeshes.Contains(Kind)) Kind = TEXT("generic");
		const int32* Known = BatchOf.Find(Kind);
		int32 Batch = Known ? *Known : INDEX_NONE;
		if (Batch == INDEX_NONE)
		{
			UStaticMesh* Mesh = LoadOrGreybox(GlyphMeshes[Kind], true);
			if (!Mesh) continue;
			// A unique name: a plan read again rebuilds the batches while the old ones wait for collection.
			const FName Name = MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), FName(*FString::Printf(TEXT("Glyphs_%s"), *Kind)));
			UInstancedStaticMeshComponent* Glyph = NewObject<UInstancedStaticMeshComponent>(this, Name);
			Glyph->SetupAttachment(Root);
			Glyph->SetMobility(EComponentMobility::Movable);
			Glyph->SetStaticMesh(Mesh);
			Glyph->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Glyph->SetCastShadow(false);
			Glyph->NumCustomDataFloats = 1;
			for (int32 Slot = 0; Slot < Mesh->GetStaticMaterials().Num(); ++Slot) Glyph->SetMaterial(Slot, GlyphMid);
			Glyph->RegisterComponent();
			Batch = Glyphs.Add(Glyph);
			BatchOf.Add(Kind, Batch);
			Places.AddDefaulted();
			GlyphRoom.AddDefaulted();
		}
		const UStaticMesh* Mesh = Glyphs[Batch]->GetStaticMesh();
		// The mesh's footprint and height (the kit stands +Z; its long side lies along the mesh's X or Y): the long side
		// turns along the box's long side (all of Kettle's tiles are wider than deep, the paper's u, the actor's +Y).
		// Uniform across the paper, the height capped apart.
		const FBox Bounds = Mesh->GetBoundingBox();
		const FVector Size = Bounds.GetSize();
		const bool bTurn = Size.X > Size.Y;
		const double Long = FMath::Max(FMath::Max(Size.X, Size.Y), 0.01), Short = FMath::Max(FMath::Min(Size.X, Size.Y), 0.01);
		const double BoxLong = FMath::Max(Tile.box.w, Tile.box.h) * BpPlanUnitCm, BoxShort = FMath::Min(Tile.box.w, Tile.box.h) * BpPlanUnitCm;
		const double Flat = FMath::Min(GlyphFill * BoxLong / Long, GlyphFill * BoxShort / Short);
		const double Tall = FMath::Min(Flat, GlyphMaxCm / FMath::Max(Size.Z, 0.01));
		const FVector2D Centre = PlanToPaperCm(FVector2D(Tile.box.x + Tile.box.w * 0.5, Tile.box.y + Tile.box.h * 0.5));
		// The pivot is the base centre, so only the footprint's own offset is taken out.
		const FRotator Yaw(0.f, bTurn ? 90.f : 0.f, 0.f);
		const FVector Offset(Bounds.GetCenter().X * Flat, Bounds.GetCenter().Y * Flat, 0.0);
		Places[Batch].Add(FTransform(Yaw, PaperCmToLocal(Centre, 0.f) - Yaw.RotateVector(Offset), FVector(Flat, Flat, Tall)));
		GlyphRoom[Batch].Add(TileRoom.IsValidIndex(Index) ? TileRoom[Index] : INDEX_NONE);
		Counts.FindOrAdd(Kind)++;
	}
	for (int32 Batch = 0; Batch < Glyphs.Num(); ++Batch)
	{
		Glyphs[Batch]->AddInstances(Places[Batch], false, false, false);
		TArray<float> Show;
		Show.Init(0.f, Places[Batch].Num());
		if (Show.Num() > 0) Glyphs[Batch]->SetCustomData(0, Show.Num() - 1, Show, true);
		// -1 forces ApplyGlyphs to write every instance once.
		TArray<float> Unwritten;
		Unwritten.Init(-1.f, Show.Num());
		ShownGlyph.Add(Unwritten);
	}
	TArray<FString> Line;
	for (const TPair<FString, int32>& Pair : Counts) Line.Add(FString::Printf(TEXT("%s=%d"), *Pair.Key, Pair.Value));
	UE_LOG(LogBpTable, Log, TEXT("BpTable: glyphs batches=%d [%s]"), Glyphs.Num(), *FString::Join(Line, TEXT(" ")));
}

void ABpTable::ApplyGlyphs(float WingEase)
{
	// As the room's rest extrusion: lit at L0, folding away with a lifted wing, dimmed elsewhere while one is up.
	const bool bOn = CVarL0VolumesValue() != 0;
	for (int32 Batch = 0; Batch < Glyphs.Num() && Batch < GlyphRoom.Num(); ++Batch)
	{
		bool bDirty = false;
		for (int32 Index = 0; Index < GlyphRoom[Batch].Num(); ++Index)
		{
			const int32 Room = GlyphRoom[Batch][Index];
			const FString Wing = RoomWing.IsValidIndex(Room) ? RoomWing[Room] : FString();
			float Show = 0.f;
			if (bOn) Show = AnimWing.IsEmpty() ? 1.f : (Wing == AnimWing ? 1.f - WingEase : FMath::Lerp(1.f, LevelDim, WingEase));
			if (ShownGlyph[Batch][Index] == Show) continue;
			ShownGlyph[Batch][Index] = Show;
			Glyphs[Batch]->SetCustomDataValue(Index, 0, Show, false);
			bDirty = true;
		}
		Glyphs[Batch]->SetRelativeTransform(WingGroupTransform(0.f));
		if (bDirty) Glyphs[Batch]->MarkRenderStateDirty();
	}
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
		const float Ink = bLit ? 1.f : SheetInkFactor(Wing.id);
		// The glow is the wing outline's alone (the strongest line), under it.
		for (int32 Pass = 0; Pass < 2; ++Pass) Outline(Wing.box, WingGlowPx[Pass], CyanWhite.CopyWithNewOpacity(WingGlowOpacity[Pass] * Ink));
		Outline(Wing.box, bLit ? HighlightEdgePx : WingEdgePx, CyanWhite.CopyWithNewOpacity(bLit ? 1.f : WingEdgeOpacity * Ink));
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

	// Text is laid out in paper cm by its cap's top edge, set by a recipe (BpType.h) at a cap height, and drawn after the
	// lines. Slate measures it in sheet pixels; tracking is in sheet pixels per character.
	struct FSheetText
	{
		FString Text;
		FVector2D Px;
		FSlateFontInfo Font;
		FLinearColor Color;
		float Tracking;
	};
	TArray<FSheetText> Texts;
	const auto TrackPx = [](const BpType::FRecipe& Recipe, double CapCm) { return static_cast<float>(Recipe.TrackEm * CapCm / BpType::CapPerEm * SheetPxPerCm); };
	const auto WidthCm = [&TrackPx](const FString& Text, const BpType::FRecipe& Recipe, double CapCm)
	{
		return (MeasureText(Text, SheetFont(Recipe.Face, CapCm)).X + TrackPx(Recipe, CapCm) * Text.Len()) / SheetPxPerCm;
	};
	const auto Cased = [](const BpType::FRecipe& Recipe, const FString& Text) { return Recipe.bUpper ? Text.ToUpper() : Text; };
	/** Text (already cased) with its cap's top at CapTopV and its left (Align 0), centre (0.5) or right (1) at U. */
	const auto Put = [&](const FString& Text, const BpType::FRecipe& Recipe, double U, double CapTopV, double CapCm, const FLinearColor& Color, double Align)
	{
		const double W = WidthCm(Text, Recipe, CapCm);
		const double Top = CapTopV - (BpType::AscPerEm - BpType::CapPerEm) * (CapCm / BpType::CapPerEm);
		Texts.Add({ Text, PaperCmToSheetPx(FVector2D(U - W * Align, Top)), SheetFont(Recipe.Face, CapCm), Color, TrackPx(Recipe, CapCm) });
		return W;
	};
	/** The floor over a line that may run from U0 to U1 at baseline V: the paper under the eye's centre line (u at the
	 *  paper's middle) is seen most foreshortened, so the floor is taken where the line comes nearest it. */
	const auto FloorAt = [this](double U0, double U1, double V) { return TextFloorCm(FVector2D(FMath::Clamp(PaperWidthCm * 0.5, U0, FMath::Max(U0, U1)), V)); };
	/** BpType's fit: the recipe's cap, raised to the floor; when the text does not fit MaxCm, the cap steps down toward the
	 *  floor, then the text is cut at a word with an ellipsis (blueprint-ui's fitStamp: two words kept at least, a trailing
	 *  "&" dropped too), then Last. Empty when nothing fits at the floor: the text is dropped. */
	const auto Fit = [&](const FString& Raw, const BpType::FRecipe& Recipe, double Floor, double MaxCm, const FString& Last, double& OutCap)
	{
		const FString Text = Cased(Recipe, Raw);
		TArray<FString> Cands = { Text };
		TArray<FString> Words;
		Text.ParseIntoArray(Words, TEXT(" "));
		for (int32 Keep = Words.Num() - 1; Keep >= 2; --Keep)
		{
			FString Cut = FString::Join(TArrayView<const FString>(Words.GetData(), Keep), TEXT(" "));
			while (!Cut.IsEmpty() && FString(TEXT(",;:&")).Contains(Cut.Right(1))) Cut = Cut.LeftChop(1).TrimEnd();
			Cands.Add(Cut + BpType::Ellipsis());
		}
		if (!Last.IsEmpty()) Cands.Add(Cased(Recipe, Last));
		const double Pref = FMath::Max(Recipe.CapCm, Floor);
		for (const FString& Cand : Cands)
		{
			for (double Cap = Pref; ; Cap = FMath::Max(Cap - 0.05, Floor))
			{
				if (WidthCm(Cand, Recipe, Cap) <= MaxCm)
				{
					OutCap = Cap;
					return Cand;
				}
				if (Cap <= Floor) break;
			}
		}
		OutCap = 0.0;
		return FString();
	};
	// The legibility table (FC3): what each text was set at against its floor, once per plan.
	const bool bReport = bReportType;
	const auto Report = [&](const TCHAR* Class, const FString& Text, double U, double V, double Cap, double Floor)
	{
		if (bReport)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpType: %s \"%s\" cap_cm=%.2f floor_cm=%.2f at=(%.1f,%.1f)%s"), Class, *Text, Cap, Floor, U, V,
				Text.IsEmpty() ? TEXT(" dropped") : TEXT(""));
		}
	};
	const auto Ink = [](const FLinearColor& Color, float Opacity) { return Color.CopyWithNewOpacity(Opacity); };
	const bool bDimmed = !SheetDimWing.IsEmpty();
	const float TextInk = bDimmed ? LevelDim : 1.f;
	const bool bWalls = CVarL0VolumesValue() != 0;

	// ---- The wings' labels, above each wing (lookdev 00's "WING 03"): the tag, then the name ----------------------------
	TArray<const FBpPlanWing*> Wings;
	TArray<bool> TagFits;
	TArray<TPair<FString, FVector3d>> TagPlaces;
	// The labels' far edge (paper v): the pins' tags rise clear of it (RaisePins).
	double LabelTop = PlanMarginCm().Y;
	for (const FBpPlanWing& Wing : SheetPlan->wings) Wings.Add(&Wing);
	Wings.Sort([](const FBpPlanWing& A, const FBpPlanWing& B) { return A.order < B.order; });
	for (int32 Index = 0; Index < Wings.Num(); ++Index)
	{
		const FBpPlanWing& Wing = *Wings[Index];
		const FVector2D A = PlanToPaperCm(FVector2D(Wing.box.x, Wing.box.y));
		const FVector2D B = PlanToPaperCm(FVector2D(Wing.box.x + Wing.box.w, Wing.box.y + Wing.box.h));
		// A label may run over the gap to the next wing (the last, to the paper's edge).
		const double Right = Index + 1 < Wings.Num() ? PlanToPaperCm(FVector2D(Wings[Index + 1]->box.x, 0.0)).X : PaperWidthCm;
		const double MaxCm = Right - A.X - WingLabelGapCm;
		// Clear of the rest walls: from the target eye a room's far wall hides the paper just behind it, and its glowing
		// top would run through a name set there.
		const double NameBase = A.Y - (bWalls ? CoverCm(A.Y, RestRoomCm) : 0.0) - WingLabelClearCm;
		FString Key;
		if (!Wing.id.Split(TEXT(":"), nullptr, &Key, ESearchCase::CaseSensitive, ESearchDir::FromEnd)) Key = Wing.id;
		double NameCap = 0.0;
		const double NameFloor = FloorAt(A.X, A.X + MaxCm, NameBase);
		const FString Name = Fit(Wing.name, BpType::WingName, NameFloor, MaxCm, Key, NameCap);
		Report(TEXT("wing-name"), Name, A.X, NameBase, NameCap, NameFloor);
		if (Name.IsEmpty()) continue;
		Put(Name, BpType::WingName, A.X, NameBase - NameCap, NameCap, Ink(WarmPaper, TextInk), 0.0);
		LabelTop = FMath::Min(LabelTop, NameBase - NameCap);
		// The tag line above it ("WING A") is drawn only when every wing's fits under the paper's top at the floor: a class
		// is kept or dropped whole, never for some wings (Kettle's centre wings leave it no room: dropped, logged).
		const double TagBase = NameBase - NameCap - WingTagGapCm;
		const double TagFloor = FloorAt(A.X, A.X + MaxCm, TagBase);
		TagFits.Add(TagBase - FMath::Max(BpType::WingTag.CapCm, TagFloor) >= PaperTopClearCm);
		TagPlaces.Add({ FString::Printf(TEXT("WING %s"), *Wing.letter), FVector3d(A.X, TagBase, FMath::Max(BpType::WingTag.CapCm, TagFloor)) });

		// Dimensions, from the plan's boxes only: the wing's width under it, and a chain down its left side ticked at
		// every room's edge. Fine lines, no figures.
		const FLinearColor Dim = Ink(CyanWhite, DimOpacity * TextInk);
		const double Dv = B.Y + DimOffsetCm;
		LineCm(A.X, B.Y + 0.2, A.X, Dv + 0.35, 2.f, Dim);
		LineCm(B.X, B.Y + 0.2, B.X, Dv + 0.35, 2.f, Dim);
		LineCm(A.X, Dv, B.X, Dv, 2.f, Dim);
		for (const double U : { A.X, B.X }) LineCm(U - DimTickCm, Dv + DimTickCm, U + DimTickCm, Dv - DimTickCm, 3.f, Dim);
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

	const bool bTags = TagFits.Num() > 0 && !TagFits.Contains(false);
	for (const TPair<FString, FVector3d>& Tag : TagPlaces)
	{
		const FVector3d& At = Tag.Value;
		Report(TEXT("wing-tag"), bTags ? Tag.Key : FString(), At.X, At.Y, At.Z, At.Z);
		if (bTags) Put(Tag.Key, BpType::WingTag, At.X, At.Y - At.Z, At.Z, Ink(CyanWhite, TextInk), 0.0);
		if (bTags) LabelTop = FMath::Min(LabelTop, At.Y - At.Z);
	}
	if (LabelTop != WingLabelTopV)
	{
		WingLabelTopV = LabelTop;
		RaisePins();
		PlacePins();
	}

	// ---- The room names, in each room's header strip (the plan leaves it above the first bay) where they meet the floor
	// and keep clear of the room's far wall; a lifted wing's rooms carry their own names on their shells ----------------
	for (int32 Index = 0; Index < SheetPlan->rooms.Num(); ++Index)
	{
		const FBpPlanRoom& Room = SheetPlan->rooms[Index];
		if (bDimmed && Room.parentId == SheetDimWing) continue;
		const FVector2D A = PlanToPaperCm(FVector2D(Room.box.x, Room.box.y));
		const FVector2D B = PlanToPaperCm(FVector2D(Room.box.x + Room.box.w, Room.box.y + Room.box.h));
		double FirstBay = Room.box.y + Room.box.h;
		for (int32 Bay = 0; Bay < SheetPlan->bays.Num(); ++Bay)
		{
			if (BayRoom.IsValidIndex(Bay) && BayRoom[Bay] == Index) FirstBay = FMath::Min(FirstBay, SheetPlan->bays[Bay].box.y);
		}
		const double Base = PlanToPaperCm(FVector2D(Room.box.x, FirstBay)).Y - RoomNameFootCm;
		// The wall's glowing top is wider than its line and blooms: a further RoomNameClearCm.
		const double Clear = A.Y + (bWalls ? CoverCm(A.Y, RestRoomCm) : 0.0) + RoomNameClearCm;
		const double MaxCm = B.X - A.X - 2.0 * RoomNameInsetCm;
		const double Floor = FloorAt(A.X + RoomNameInsetCm, A.X + RoomNameInsetCm + MaxCm, Base);
		// The strip's height caps the cap too: the recipe's size or less, never under the floor.
		BpType::FRecipe Recipe = BpType::RoomName;
		Recipe.CapCm = FMath::Min(Recipe.CapCm, Base - Clear);
		double Cap = 0.0;
		FString Name = Recipe.CapCm >= Floor ? Fit(Room.name, Recipe, Floor, MaxCm, FString(), Cap) : FString();
		Report(TEXT("room-name"), Name, A.X + RoomNameInsetCm, Base, Cap, Floor);
		if (Name.IsEmpty()) continue;
		Put(Name, BpType::RoomName, A.X + RoomNameInsetCm, Base - Cap, Cap, Ink(WarmPaper, 0.92f * SheetInkFactor(Room.parentId)), 0.0);
	}

	// ---- The title block, on the paper below the shortest wing: the level's plan, the product and lens, the scale bar ----
	{
		const FBpPlanWing* Shortest = nullptr;
		for (const FBpPlanWing* Wing : Wings)
		{
			if (!Shortest || Wing->box.y + Wing->box.h < Shortest->box.y + Shortest->box.h) Shortest = Wing;
		}
		const FVector2D SA = PlanToPaperCm(FVector2D(Shortest->box.x, Shortest->box.y));
		const FVector2D SB = PlanToPaperCm(FVector2D(Shortest->box.x + Shortest->box.w, Shortest->box.y + Shortest->box.h));
		const double Cx = (SA.X + SB.X) * 0.5;
		const TCHAR* Names[] = { TEXT("SITE PLAN — LEVEL 0"), TEXT("WING PLAN — LEVEL 1"), TEXT("ROOM PLAN — LEVEL 2") };
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FString Product = Link.GetProductName().IsEmpty() ? Link.GetProductSlug() : Link.GetProductName();
		const FString Sub = Cased(BpType::TitleSub, TitleLensLine.IsEmpty() ? Product : FString::Printf(TEXT("%s  ·  lens %s"), *Product, *TitleLensLine));
		const FString Title = Names[static_cast<int32>(Level)];
		const double Top = SB.Y + TitleBelowWingCm;
		// Each row's cap meets the floor at its own baseline; the floor is taken across the block's likely width.
		const double U0 = Cx - 12.0, U1 = Cx + 12.0;
		const double TitleTop = Top + TitlePadCm * 1.4;
		double TitleCap = BpType::Title.CapCm;
		for (int32 Pass = 0; Pass < 3; ++Pass) TitleCap = FMath::Max(BpType::Title.CapCm, FloorAt(U0, U1, TitleTop + TitleCap));
		const double SubTop = TitleTop + TitleCap + TitleRowGapCm;
		double SubCap = BpType::TitleSub.CapCm;
		for (int32 Pass = 0; Pass < 3; ++Pass) SubCap = FMath::Max(BpType::TitleSub.CapCm, FloorAt(U0, U1, SubTop + SubCap));
		const double FigTop = SubTop + SubCap + TitleRowGapCm;
		double FigCap = BpType::Figure.CapCm;
		for (int32 Pass = 0; Pass < 3; ++Pass) FigCap = FMath::Max(BpType::Figure.CapCm, FloorAt(U0, U1, FigTop + FigCap));
		const double BarV = FigTop + FigCap + 0.6;
		const double Bottom = BarV + ScaleBarHeightCm + TitlePadCm;
		const double TitleW = WidthCm(Title, BpType::Title, TitleCap), SubW = WidthCm(Sub, BpType::TitleSub, SubCap);
		const double UnitW = WidthCm(TEXT("CM"), BpType::Figure, FigCap);
		const double BarW = ScaleBarCm + 1.0 + UnitW;
		const double Inner = FMath::Max(FMath::Max(TitleW, SubW), BarW);
		const double L = Cx - Inner * 0.5 - TitlePadCm, R = Cx + Inner * 0.5 + TitlePadCm;
		Put(Title, BpType::Title, Cx, TitleTop, TitleCap, Ink(WarmPaper, 1.f), 0.5);
		Put(Sub, BpType::TitleSub, Cx, SubTop, SubCap, Ink(CyanWhite, 0.9f), 0.5);
		Report(TEXT("title"), Title, Cx, TitleTop + TitleCap, TitleCap, FloorAt(U0, U1, TitleTop + TitleCap));
		Report(TEXT("title-sub"), Sub, Cx, SubTop + SubCap, SubCap, FloorAt(U0, U1, SubTop + SubCap));
		// The block's frame and the rule under its title, as a drawing's title block.
		const FLinearColor FrameInk = Ink(CyanWhite, 0.55f);
		const double Rule = SubTop - TitleRowGapCm * 0.5;
		LineCm(L, Top, R, Top, 3.f, FrameInk);
		LineCm(R, Top, R, Bottom, 3.f, FrameInk);
		LineCm(R, Bottom, L, Bottom, 3.f, FrameInk);
		LineCm(L, Bottom, L, Top, 3.f, FrameInk);
		LineCm(L, Rule, R, Rule, 2.f, FrameInk);
		// The scale bar: ScaleBarCm on the table, alternate centimetres filled, its figures above it.
		const FLinearColor Bar = Ink(CyanWhite, 0.85f);
		const double B0 = Cx - BarW * 0.5;
		const int32 Cms = FMath::RoundToInt(ScaleBarCm);
		LineCm(B0, BarV, B0 + Cms, BarV, 2.f, Bar);
		LineCm(B0, BarV + ScaleBarHeightCm, B0 + Cms, BarV + ScaleBarHeightCm, 2.f, Bar);
		for (int32 Cm = 0; Cm <= Cms; ++Cm)
		{
			const bool bMajor = Cm == 0 || Cm == 5 || Cm == 10 || Cm == Cms;
			LineCm(B0 + Cm, BarV - (bMajor ? 0.3 : 0.0), B0 + Cm, BarV + ScaleBarHeightCm, 2.f, Bar);
			if (Cm < Cms && Cm % 2 == 0) Pen.Fill(PaperPx(B0 + Cm, BarV), PaperPx(B0 + Cm + 1, BarV + ScaleBarHeightCm), Ink(CyanWhite, 0.6f));
			if (bMajor) Put(FString::Printf(TEXT("%d"), Cm), BpType::Figure, B0 + Cm, FigTop, FigCap, Bar, 0.5);
		}
		Put(TEXT("CM"), BpType::Figure, B0 + Cms + 1.0, BarV + ScaleBarHeightCm - FigCap, FigCap, Ink(CyanWhite, 0.7f), 0.0);
		Report(TEXT("figure"), TEXT("0 5 10 20 CM"), B0, FigTop + FigCap, FigCap, FloorAt(U0, U1, FigTop + FigCap));
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
		const double NBase = C.Y - R * 1.15 - 0.35;
		const double NCap = FMath::Max(1.0, TextFloorCm(FVector2D(C.X, NBase)));
		Put(TEXT("N"), BpType::Title, C.X, NBase - NCap, NCap, Ink(WarmPaper, 1.f), 0.5);
	}

	if (Pen.Tris.Num() > 0)
	{
		FCanvasTriangleItem Item(Pen.Tris, GWhiteTexture);
		Item.BlendMode = SE_BLEND_AlphaBlend;
		Canvas->DrawItem(Item);
	}

	// ---- The breadcrumb, near-right (WP3's way back; its boxes are SetCrumbs' hit regions) ----------------------------
	{
		const FSlateFontInfo Way = SheetFont(BpType::Crumb.Face, LabelCapHeightCm);
		for (int32 Index = 0; Index < Crumbs.Num(); ++Index)
		{
			const FCrumb& Crumb = Crumbs[Index];
			const FLinearColor Color = Crumb.bLit ? CyanWhite : WarmPaper;
			Texts.Add({ Crumb.Text, PaperCmToSheetPx(Crumb.PaperCm.Min), SheetFont(Crumb.bHere ? TEXT("Bold") : BpType::Crumb.Face, LabelCapHeightCm), Color, 0.f });
			if (Index + 1 < Crumbs.Num())
			{
				Texts.Add({ CrumbSeparator, PaperCmToSheetPx(FVector2D(Crumb.PaperCm.Max.X, Crumb.PaperCm.Min.Y)), Way, WarmPaper, 0.f });
			}
		}
		if (bReport && Crumbs.Num() > 0)
		{
			Report(TEXT("crumb"), GetBreadcrumb(), Crumbs[0].PaperCm.Min.X, Crumbs[0].PaperCm.Max.Y, LabelCapHeightCm, TextFloorCm(FVector2D(Crumbs[0].PaperCm.Min.X, CrumbBottomCm)));
		}
	}

	for (const FSheetText& Text : Texts)
	{
		FCanvasTextItem Item(Text.Px, FText::FromString(Text.Text), Text.Font, Text.Color);
		Item.HorizSpacingAdjust = Text.Tracking;
		Canvas->DrawItem(Item);
	}
	bReportType = false;
}
