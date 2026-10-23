// The light table (lynx-plan L3.2). See BpTable.h for the frame of reference and the named constants.
#include "BpTable.h"

#include "BpLink.h"
#include "CanvasItem.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/StaticMesh.h"
#include "GlobalRenderResources.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/PackageName.h"
#include "Styling/CoreStyle.h"
#include "UObject/ConstructorHelpers.h"
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

	// The palette (art-breakdown.md, style block).
	const FLinearColor BlueprintBlue(FColor(0x0B, 0x2A, 0x6B));
	const FLinearColor CyanWhite(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor WarmPaper(FColor(0xF3, 0xE9, 0xD2));

	const TCHAR* const GlassPlaceholderSlot = TEXT("frame_glass_placeholder_REPLACE_IN_UE");

	/** The greybox rim's thickness and width (outer 120 x 80 cm around the 110 x 70 cm glass opening). */
	constexpr float RimThicknessCm = 3.f;
	constexpr float FrameWidthCm = 120.f;
	constexpr float FrameDepthCm = 80.f;
	constexpr float OpeningWidthCm = 110.f;
	constexpr float OpeningDepthCm = 70.f;

	/** Text. Slate sizes fonts in points at 96 DPI (FreeType pixel size = size * 96/72); Roboto's cap height is 0.711 em.
	 *  A label's world scale is chosen so its cap height on the paper is the cap height asked for. */
	constexpr int32 LabelFontSize = 48;
	constexpr float SlatePxPerPoint = 96.f / 72.f;
	constexpr float RobotoCapPerEm = 0.711f;
	/** The title's lens line and the scale caption, relative to LabelCapHeightCm. */
	constexpr float SmallTextRatio = 0.75f;

	/** Heights above the paper, so nothing z-fights it. */
	constexpr float OverlayLiftCm = 0.05f;
	constexpr float LabelLiftCm = 0.1f;

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
	EngineCube = CubeFinder.Object;
	EnginePlane = PlaneFinder.Object;
	EngineShapeMaterial = ShapeMaterialFinder.Object;
	EngineSheetMaterial = SheetMaterialFinder.Object;

	FrameMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/Bp/Art/LightTableFrame/SM_LightTableFrame.SM_LightTableFrame")));
	PaperMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_BlueprintPaper.M_BlueprintPaper")));
	HiddenMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(TEXT("/Game/Bp/Materials/M_Hidden.M_Hidden")));

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

	// The title block and the scale caption exist from the start; the wing labels come with the plan.
	TSharedRef<SVerticalBox> Title = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
		[
			SAssignNew(TitleLine1, STextBlock)
				.Font(FCoreStyle::GetDefaultFontStyle("Bold", LabelFontSize))
				.ColorAndOpacity(FSlateColor(WarmPaper))
				.Justification(ETextJustify::Right)
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
		[
			SAssignNew(TitleLine2, STextBlock)
				.Font(FCoreStyle::GetDefaultFontStyle("Regular", FMath::RoundToInt(LabelFontSize * SmallTextRatio)))
				.ColorAndOpacity(FSlateColor(WarmPaper))
				.Justification(ETextJustify::Right)
		];
	TitleLabel = MakeLabel(Title, FVector2D(PaperWidthCm - 1.5, PaperDepthCm - 1.2), FVector2D(1.0, 1.0), LabelCapHeightCm);
	SetTitle(TEXT("waiting for the server"), FString());

	const FString Caption = FString::Printf(TEXT("%d cm"), FMath::RoundToInt(ScaleBarCm));
	ScaleLabel = MakeLabel(SNew(STextBlock).Text(FText::FromString(Caption))
			.Font(FCoreStyle::GetDefaultFontStyle("Regular", LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper)),
		FVector2D(2.0, PaperDepthCm - 3.4), FVector2D(0.0, 1.0), LabelCapHeightCm * SmallTextRatio);
	PlaceLabels();

	// BpLink fetched at startup (or is fetching): take its plan, now or when it lands; never ask the server again.
	FBpLinkModule& Link = FBpLinkModule::Get();
	PlanHandle = Link.OnPlan().AddUObject(this, &ABpTable::ApplyPlan);
	FailedHandle = Link.OnPlanFailed().AddUObject(this, &ABpTable::ShowNoPlan);
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
}

void ABpTable::PlaceForHeight(float HeightCm)
{
	PlacedHeightCm = HeightCm;
	if (bRealFrame)
	{
		// The mesh's pivot is the floor centre and its top is its bounds' top (95 cm as modelled): the feet stay on the
		// floor and Z scales to the height.
		const float ModelTop = Frame->GetStaticMesh() ? Frame->GetStaticMesh()->GetBoundingBox().Max.Z : 0.f;
		Frame->SetRelativeLocation(FVector::ZeroVector);
		Frame->SetRelativeScale3D(FVector(1.0, 1.0, ModelTop > 1.f ? HeightCm / ModelTop : 1.0));
	}
	else
	{
		// The engine cube is 100 cm with its pivot at the centre: a block from the floor to the rim, then the rim.
		const float BlockHeight = HeightCm - RimThicknessCm;
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
	PlaceLabels();
}

void ABpTable::PlaceLabels()
{
	const float LabelZ = PlacedHeightCm - GlassRecessCm + LabelLiftCm;
	for (const TPair<TWeakObjectPtr<UWidgetComponent>, FVector2D>& Place : LabelPlaces)
	{
		if (UWidgetComponent* Label = Place.Key.Get()) Label->SetRelativeLocation(PaperCmToLocal(Place.Value, LabelZ));
	}
}

UWidgetComponent* ABpTable::MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm)
{
	UWidgetComponent* Label = NewObject<UWidgetComponent>(this);
	Label->SetupAttachment(Root);
	Label->SetWidgetSpace(EWidgetSpace::World);
	Label->SetDrawAtDesiredSize(true);
	Label->SetPivot(Pivot);
	Label->SetBlendMode(EWidgetBlendMode::Transparent);
	Label->SetTwoSided(false);
	Label->SetBackgroundColor(FLinearColor::Transparent);
	Label->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Label->SetCastShadow(false);
	Label->SetWindowFocusable(false);
	// The text is static: drawn when asked, not every frame.
	Label->SetManuallyRedraw(true);
	Label->SetRelativeRotation(LabelRotation);
	// High draw resolution, small world scale: one widget pixel is this many cm.
	Label->SetRelativeScale3D(FVector(CapHeightCm / (LabelFontSize * SlatePxPerPoint * RobotoCapPerEm)));
	Label->RegisterComponent();
	Label->SetSlateWidget(Content);
	Label->RequestRedraw();
	LabelPlaces.Add({ Label, PaperCm });
	return Label;
}

void ABpTable::SetTitle(const FString& Line1, const FString& Line2)
{
	if (TitleLine1.IsValid()) TitleLine1->SetText(FText::FromString(Line1));
	if (TitleLine2.IsValid())
	{
		TitleLine2->SetText(FText::FromString(Line2));
		TitleLine2->SetVisibility(Line2.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible);
	}
	if (TitleLabel) TitleLabel->RequestRedraw();
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

	// The wing labels: letter and name, inside each wing's top-left corner.
	for (UWidgetComponent* Old : WingLabels)
	{
		if (Old) Old->DestroyComponent();
	}
	WingLabels.Reset();
	LabelPlaces.RemoveAll([](const TPair<TWeakObjectPtr<UWidgetComponent>, FVector2D>& Place) { return !Place.Key.IsValid(); });
	TArray<FString> Order;
	for (const FBpPlanWing* Wing : Wings)
	{
		Order.Add(Wing->letter);
		const FVector2D Corner = PlanToPaperCm(FVector2D(Wing->box.x, Wing->box.y)) + FVector2D(0.6, 0.6);
		WingLabels.Add(MakeLabel(SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%s  %s"), *Wing->letter, *Wing->name)))
				.Font(FCoreStyle::GetDefaultFontStyle("Regular", LabelFontSize)).ColorAndOpacity(FSlateColor(WarmPaper)),
			Corner, FVector2D(0.0, 0.0), LabelCapHeightCm));
	}
	PlaceLabels();

	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Name = Link.GetProductName().IsEmpty() ? TitleCase(Link.GetProductSlug()) : Link.GetProductName();
	SetTitle(Name, Plan.lenses.Num() > 0 ? FString::Printf(TEXT("lens: %s"), *Plan.lenses[0]) : FString());

	UE_LOG(LogBpTable, Log, TEXT("BpTable: wings=%d order=%s height_cm=%d"), Wings.Num(), *FString::Join(Order, TEXT(",")), FMath::RoundToInt(PlacedHeightCm));
}

void ABpTable::ShowNoPlan()
{
	// A table that already shows a plan keeps it; one that never had one says what it waits for.
	if (SheetPlan.IsValid()) return;
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
	const FVector2D Max = PlanMin + PlanSize;

	// A faint grid every GridPlanUnits over the plan's extent.
	const FLinearColor Grid = CyanWhite.CopyWithNewOpacity(0.12f);
	for (double X = PlanMin.X; X <= Max.X + 0.5; X += GridPlanUnits) Pen.Line(Px(X, PlanMin.Y), Px(X, Max.Y), 2.f, Grid);
	for (double Y = PlanMin.Y; Y <= Max.Y + 0.5; Y += GridPlanUnits) Pen.Line(Px(PlanMin.X, Y), Px(Max.X, Y), 2.f, Grid);

	// Each wing: a soft fill, then its outline.
	for (const FBpPlanWing& Wing : SheetPlan->wings)
	{
		const FVector2D A = Px(Wing.box.x, Wing.box.y), B = Px(Wing.box.x + Wing.box.w, Wing.box.y + Wing.box.h);
		Pen.Fill(A, B, CyanWhite.CopyWithNewOpacity(0.07f));
		const FLinearColor Edge = CyanWhite.CopyWithNewOpacity(0.9f);
		Pen.Line(A, FVector2D(B.X, A.Y), 5.f, Edge);
		Pen.Line(FVector2D(B.X, A.Y), B, 5.f, Edge);
		Pen.Line(B, FVector2D(A.X, B.Y), 5.f, Edge);
		Pen.Line(FVector2D(A.X, B.Y), A, 5.f, Edge);
	}

	// The scale bar, near-left: ScaleBarCm on the table, which is ScaleBarCm / BpPlanUnitCm plan units. Its caption is a
	// widget (ScaleLabel).
	const FLinearColor Ink = CyanWhite.CopyWithNewOpacity(0.85f);
	const double BarU = 2.0, BarV = PaperDepthCm - 2.6;
	const double BarCm = (ScaleBarCm / BpPlanUnitCm) * BpPlanUnitCm;
	Pen.Line(PaperPx(BarU, BarV), PaperPx(BarU + BarCm, BarV), 4.f, Ink);
	for (int32 Cm = 0; Cm <= FMath::RoundToInt(BarCm); ++Cm)
	{
		const double Tick = (Cm % 5 == 0) ? 0.8 : 0.4;
		Pen.Line(PaperPx(BarU + Cm, BarV), PaperPx(BarU + Cm, BarV - Tick), 3.f, Ink);
	}

	// The compass rose, far-right, lines only: a ring, the cross, and a north chevron toward the far edge.
	const FVector2D C(PaperWidthCm - 4.0, 3.6);
	const double R = 2.2;
	constexpr int32 Sides = 64;
	for (int32 Side = 0; Side < Sides; ++Side)
	{
		const double A0 = 2.0 * UE_DOUBLE_PI * Side / Sides, A1 = 2.0 * UE_DOUBLE_PI * (Side + 1) / Sides;
		Pen.Line(PaperPx(C.X + R * FMath::Cos(A0), C.Y + R * FMath::Sin(A0)), PaperPx(C.X + R * FMath::Cos(A1), C.Y + R * FMath::Sin(A1)), 2.f, Ink);
	}
	Pen.Line(PaperPx(C.X, C.Y + R * 1.2), PaperPx(C.X, C.Y - R * 1.3), 3.f, Ink);
	Pen.Line(PaperPx(C.X - R * 1.2, C.Y), PaperPx(C.X + R * 1.2, C.Y), 3.f, Ink);
	Pen.Line(PaperPx(C.X - R * 0.35, C.Y - R * 0.85), PaperPx(C.X, C.Y - R * 1.3), 3.f, Ink);
	Pen.Line(PaperPx(C.X + R * 0.35, C.Y - R * 0.85), PaperPx(C.X, C.Y - R * 1.3), 3.f, Ink);

	if (Pen.Tris.Num() == 0) return;
	FCanvasTriangleItem Item(Pen.Tris, GWhiteTexture);
	Item.BlendMode = SE_BLEND_AlphaBlend;
	Canvas->DrawItem(Item);
}
