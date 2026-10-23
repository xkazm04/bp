// The light table (lynx-plan L3.2): a frame, the blueprint paper at the glass, and the sheet drawn from the plan BpLink
// read. The actor's origin is the floor under the table's centre. Its +X is away from the person at the near edge, +Y is
// to their right, so plan +x (wing order, left to right) runs along +Y and plan +y ("down the sheet") runs toward them
// (-X). The geometry always comes from FBpPlan; nothing here computes a layout (lynx-plan P3).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "BpTable.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogBpTable, Log, All);

class UCanvas;
class UCanvasRenderTarget2D;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UStaticMesh;
class UStaticMeshComponent;
class UWidgetComponent;
class SWidget;
struct FBpPlan;

UCLASS()
class BP_API ABpTable : public AActor
{
	GENERATED_BODY()

public:
	// ---- The named constants, in one place ----------------------------------------------------------------------------
	/** Plan units to centimetres on the paper: Kettle's 3170 x 1582 u extent becomes 104.6 x 52.2 cm. */
	static constexpr float BpPlanUnitCm = 0.033f;
	/** The table top's height above the floor, the default of the console variable bp.TableHeightCm (R4 option A). */
	static constexpr float DefaultTableHeightCm = 95.f;
	/** The glass panel the paper fills (the frame's glass opening is 110 x 70 cm). Width runs along +Y, depth along X. */
	static constexpr float PaperWidthCm = 106.f;
	static constexpr float PaperDepthCm = 66.f;
	/** The paper sits this far below the frame's top. */
	static constexpr float GlassRecessCm = 0.8f;
	/** The sheet render target; it covers the whole paper, so the paper samples it at its own UVs. */
	static constexpr int32 SheetWidthPx = 4096;
	static constexpr int32 SheetHeightPx = 2048;
	/** Cap height of the wing labels on the paper, sized for reading at about 1 m. The other text scales from it. */
	static constexpr float LabelCapHeightCm = 1.6f;
	/** The scale bar's length on the paper. */
	static constexpr float ScaleBarCm = 10.f;
	/** Grid pitch in plan units. */
	static constexpr float GridPlanUnits = 100.f;

	ABpTable();

	/** Frame mesh (pivot at the floor centre, bounds 120 x 80 x 95 cm). Missing: the greybox (a block and a rim). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UStaticMesh> FrameMesh;

	/** Paper material, with a Texture parameter `Sheet` and a Scalar `SheetStrength`. Missing: the greybox paper. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> PaperMaterial;

	/** Put on the frame mesh's slot `frame_glass_placeholder_REPLACE_IN_UE` (masked, opacity mask 0). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> HiddenMaterial;

	/** Plan coordinates to paper centimetres (origin the paper's far-left corner, u to the right, v toward the viewer). The
	 *  sheet's pixels and the widgets' places both go through this, so a label sits on its wing. */
	FVector2D PlanToPaperCm(const FVector2D& Plan) const;
	/** Paper centimetres to sheet render-target pixels. */
	static FVector2D PaperCmToSheetPx(const FVector2D& PaperCm);
	/** Paper centimetres to the actor's space, at a height above the floor. */
	static FVector PaperCmToLocal(const FVector2D& PaperCm, float ZCm);

protected:
	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<USceneComponent> Root;

	/** The frame mesh, or in the greybox the block under the glass. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UStaticMeshComponent> Frame;

	/** The greybox rim: four rails around the glass opening, 3 cm thick, their top at the table height. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TArray<TObjectPtr<UStaticMeshComponent>> GreyboxRim;

	/** The paper at the glass level. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UStaticMeshComponent> Paper;

	/** Greybox only: the sheet on a translucent engine material just above the plain paper. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UStaticMeshComponent> SheetOverlay;

	/** Engine content for the greybox, held hard so a cook takes it along. */
	UPROPERTY()
	TObjectPtr<UStaticMesh> EngineCube;
	UPROPERTY()
	TObjectPtr<UStaticMesh> EnginePlane;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineShapeMaterial;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineSheetMaterial;

	UPROPERTY(Transient)
	TObjectPtr<UCanvasRenderTarget2D> Sheet;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> PaperMid;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> OverlayMid;

	/** The title block (product name and first lens, or "waiting for the server"), the scale caption, the wing labels. */
	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> TitleLabel;
	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> ScaleLabel;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> WingLabels;

	/** Draws the sheet; bound to the render target's update, which runs once per plan rev. */
	UFUNCTION()
	void DrawSheet(UCanvas* Canvas, int32 Width, int32 Height);

	void LoadArt();
	void PlaceForHeight(float HeightCm);
	void ApplyPlan(const FBpPlan& Plan);
	void ShowNoPlan();
	void SetTitle(const FString& Line1, const FString& Line2);
	UWidgetComponent* MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm);
	void PlaceLabels();
	static float HeightCvarCm();

	bool bRealFrame = false;
	bool bRealPaper = false;
	bool bLoggedNoPlan = false;
	float PlacedHeightCm = -1.f;
	FString DrawnRev;
	/** The plan the sheet is drawn from (a copy; the module may replace its own on BpLink.Fetch). */
	TSharedPtr<FBpPlan> SheetPlan;
	FVector2D PlanMin = FVector2D::ZeroVector;
	FVector2D PlanSize = FVector2D::ZeroVector;
	/** Where each label sits on the paper, kept so a height change only moves them. */
	TArray<TPair<TWeakObjectPtr<UWidgetComponent>, FVector2D>> LabelPlaces;

	TSharedPtr<class STextBlock> TitleLine1;
	TSharedPtr<class STextBlock> TitleLine2;

	FDelegateHandle PlanHandle;
	FDelegateHandle FailedHandle;
};
