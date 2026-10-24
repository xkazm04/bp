// The light table (lynx-plan L3.2, L3.3): a frame, the blueprint paper at the glass, the sheet drawn from the plan BpLink
// read, and the plan's rooms, bays and tiles standing on the paper as edge-glow volumes. The actor's origin is the floor under the table's centre. Its +X is away from the person at the near edge, +Y is
// to their right, so plan +x (wing order, left to right) runs along +Y and plan +y ("down the sheet") runs toward them
// (-X). The geometry always comes from FBpPlan; nothing here computes a layout (lynx-plan P3).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "BpTable.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogBpTable, Log, All);

class UCanvas;
class UCanvasRenderTarget2D;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;
class UStaticMesh;
class UStaticMeshComponent;
class UTexture2D;
class UWidgetComponent;
class SWidget;
struct FBpPlan;

UCLASS()
class BP_API ABpTable : public AActor
{
	GENERATED_BODY()

public:
	// ---- The named constants, in one place ----------------------------------------------------------------------------
	/** Plan units to centimetres on the paper: Kettle's islands extent, 3810 x 1678 u (spark vr-hands-zoom WP1), becomes
	 *  141.0 x 62.1 cm, which leaves 12.5 cm left and right for the scale bar, the compass and the title block, and 7 cm
	 *  above and below. */
	static constexpr float BpPlanUnitCm = 0.037f;
	/** The table top's height above the floor, the default of the console variable bp.TableHeightCm (R4 option A). */
	static constexpr float DefaultTableHeightCm = 95.f;
	/** The frame's outline (the owner's long table, 2026-10-24): width along +Y, depth along X. Its rim is 5 cm wide, so
	 *  the glass opening is 170 x 80 cm, and a 2 cm ledge carries the glow strip inside it. */
	static constexpr float TableWidthCm = 180.f;
	static constexpr float TableDepthCm = 90.f;
	/** The glass panel the paper fills, inside the strip. */
	static constexpr float PaperWidthCm = 166.f;
	static constexpr float PaperDepthCm = 76.f;
	/** The paper sits this far below the frame's top. */
	static constexpr float GlassRecessCm = 0.8f;
	/** The sheet render target; it covers the whole paper, so the paper samples it at its own UVs. Its aspect is the
	 *  paper's, so a pixel is square (0.41 mm). */
	static constexpr int32 SheetWidthPx = 4096;
	static constexpr int32 SheetHeightPx = static_cast<int32>(SheetWidthPx * PaperDepthCm / PaperWidthCm + 0.5f);
	/** The paper texture's tile (ArtSource/mat-blueprint-paper/manifest.json: 0.5 m, 16 cells, every 4th line stronger). */
	static constexpr float PaperTileCm = 50.f;
	/** The sheet's grid on the paper, from its far-left corner: a fine line every GridFineCm and a stronger one every
	 *  GridMajorEvery fine lines. Half the texture's cell, so every second fine line and every second major one lie on the
	 *  texture's own lines. */
	static constexpr float GridFineCm = PaperTileCm / 32.f;
	static constexpr int32 GridMajorEvery = 4;
	/** Cap height of the wing labels on the paper, sized for reading at about 1 m. The other text scales from it. */
	static constexpr float LabelCapHeightCm = 1.6f;
	/** The scale bar's length on the paper. */
	static constexpr float ScaleBarCm = 10.f;
	/** The volumes' heights above the paper (L3.3): a room is a shell, a bay a floor plate, a tile a block whose height is
	 *  the active lens's reading (bad tallest). Their footprints are the plan's boxes, never computed here. */
	static constexpr float RoomShellCm = 3.0f;
	static constexpr float BayFloorCm = 0.3f;
	static constexpr float TileBadCm = 2.4f;
	static constexpr float TileWatchCm = 1.4f;
	static constexpr float TileGoodCm = 0.6f;
	/** unmeasured, na, and a lens missing from the tile's health. */
	static constexpr float TileUnmeasuredCm = 0.1f;

	ABpTable();

	/** Frame mesh (pivot at the floor centre, bounds 180 x 90 x 95 cm, its length along its +X). Missing: the greybox (a
	 *  block and a rim). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UStaticMesh> FrameMesh;

	/** Paper material, with a Texture parameter `Sheet`, Scalars `SheetStrength`, `TilesU` and `TilesV` (the paper texture's
	 *  repeats across the paper). Missing: the greybox paper. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> PaperMaterial;

	/** Put on the frame mesh's slot `frame_glass_placeholder_REPLACE_IN_UE` (masked, opacity mask 0). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> HiddenMaterial;

	/** Edge-glow material for the volumes (translucent; Scalars `EdgeWidthCm`, `FaceOpacity`, `Intensity`; per-instance
	 *  custom data 0 to 2 = the instance's size in cm along its X, Y, Z). Missing: a translucent engine material. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> VolumeMaterial;

	/** Re-heights the tiles by `health[Lens]`; nothing moves in x or y. One of the plan's lenses; L3.5 calls this. */
	void SetActiveLens(const FString& Lens);
	const FString& GetActiveLens() const { return ActiveLens; }
	/** A tile's height above the paper for a reading (good, watch, bad, unmeasured, na). */
	static float TileHeightCm(const FString& Reading);

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

	/** The volumes, one instanced batch per kind, at the paper's level: an instance's Z is its height above the paper. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> Rooms;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> Bays;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> Tiles;

	/** Engine content for the greybox, held hard so a cook takes it along. */
	UPROPERTY()
	TObjectPtr<UStaticMesh> EngineCube;
	UPROPERTY()
	TObjectPtr<UStaticMesh> EnginePlane;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineShapeMaterial;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineSheetMaterial;
	UPROPERTY()
	TObjectPtr<UTexture2D> EngineWhiteTexture;

	UPROPERTY(Transient)
	TObjectPtr<UCanvasRenderTarget2D> Sheet;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> PaperMid;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> OverlayMid;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> VolumeMids;

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
	UWidgetComponent* MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm, float LiftCm);
	void PlaceLabels();
	void BuildVolumes(const FBpPlan& Plan);
	void ClearVolumes();
	static float HeightCvarCm();

	bool bRealFrame = false;
	bool bRealPaper = false;
	bool bLoggedNoPlan = false;
	float PlacedHeightCm = -1.f;
	FString DrawnRev;
	/** The lens the tiles' heights read; Plan.lenses[0] when a plan is applied. */
	FString ActiveLens;
	/** The plan the sheet is drawn from (a copy; the module may replace its own on BpLink.Fetch). */
	TSharedPtr<FBpPlan> SheetPlan;
	FVector2D PlanMin = FVector2D::ZeroVector;
	FVector2D PlanSize = FVector2D::ZeroVector;
	/** Where each label sits on the paper and how far above it, kept so a height change only moves them. */
	struct FLabelPlace
	{
		TWeakObjectPtr<UWidgetComponent> Label;
		FVector2D PaperCm;
		float LiftCm;
	};
	TArray<FLabelPlace> LabelPlaces;

	TSharedPtr<class STextBlock> TitleLine1;
	TSharedPtr<class STextBlock> TitleLine2;

	FDelegateHandle PlanHandle;
	FDelegateHandle FailedHandle;
};
