// The light table (lynx-plan L3.2 to L3.4): a frame, the blueprint paper at the glass, the sheet drawn from the plan BpLink
// read, and the plan's rooms, bays and tiles as edge-glow volumes that rise off the paper level by level (BpLevels.cpp). The actor's origin is the floor under the table's centre. Its +X is away from the person at the near edge, +Y is
// to their right, so plan +x (wing order, left to right) runs along +Y and plan +y ("down the sheet") runs toward them
// (-X). The geometry always comes from FBpPlan; nothing here computes a layout (lynx-plan P3).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "BpTable.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogBpTable, Log, All);

/** The zoom levels (lynx-plan L3.4): L0 the site (wing footprints and counts), L1 one wing lifted with its room shells,
 *  L2 one room of it lifted further with its bays and tiles. */
UENUM(BlueprintType)
enum class EBpLevel : uint8
{
	L0,
	L1,
	L2
};

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
	/** The levels (BpLevels.cpp; spark vr-hands-zoom WP3, the owner's "Lift"): the entered wing rises WingLiftCm off the
	 *  paper and grows WingLiftScale about its footprint's centre, the entered room a further RoomLiftCm, and the rest of
	 *  the sheet dims to LevelDim. Each step eases over LevelEaseS (instant under bp.ReducedMotion 1). */
	static constexpr float WingLiftCm = 4.f;
	static constexpr float WingLiftScale = 1.5f;
	static constexpr float RoomLiftCm = 6.f;
	static constexpr float LevelEaseS = 0.35f;
	static constexpr float LevelDim = 0.4f;
	/** The fit-to-paper clamp: a lifted wing keeps this much paper around it. Its scale is the lesser of WingLiftScale
	 *  and what fits the paper less this margin, and its centre slides inward until it does. */
	static constexpr float WingLiftMarginCm = 1.f;

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
	 *  custom data 0 to 2 = the instance's size in cm along its X, Y, Z, 3 = Show: 0 folds the instance away, above 1
	 *  brightens it). Missing: a translucent engine material, which ignores Show. */
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

	// ---- Levels (BpLevels.cpp): the API the hands (WP4) and the BpLevel.* console commands call ------------------------
	/** L0 -> L1. From L1 or L2 in another wing, home first (every step logged). */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	bool EnterWing(const FString& InWingId);
	/** L1 -> L2; the room must be in the entered wing. From L0 it enters the room's wing first; from L2 it leaves the
	 *  current room first. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	bool EnterRoom(const FString& InRoomId);
	/** A wing's or a room's id, as BpLevel.Enter takes it. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	bool Enter(const FString& Id);
	/** One level up. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	void Back();
	/** To L0, one logged step at a time. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	void Home();
	/** Not a UFUNCTION: it hides AActor::GetLevel (the ULevel), which UHT will not let a UFUNCTION redeclare. Through an
	 *  AActor pointer GetLevel is still the ULevel; scripts and Blueprints read GetBpLevel. */
	EBpLevel GetLevel() const { return Level; }
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	EBpLevel GetBpLevel() const { return Level; }
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	FString GetWingId() const { return WingId; }
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	FString GetRoomId() const { return RoomId; }
	/** True while a level change is still easing. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	bool IsLevelMoving() const;
	/** The breadcrumb's first line as shown. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	FString GetBreadcrumb() const;
	/** What a world-space ray points at, analytically: the lifted room's plane (L2), the lifted wing's plane (L1 and L2),
	 *  then the paper, each at its current lift, looked up in plan space. OutKind is "room" or "wing" (OutId the plan id)
	 *  or "crumb" (OutId "home", "wing:<id>" or "room:<id>"). False when the ray meets none. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	bool HitTest(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutKind, FString& OutId) const;
	/** Brightens one wing, room or crumb (HitTest's kinds and ids); an empty Id clears it. */
	UFUNCTION(BlueprintCallable, Category = "Bp|Levels")
	void SetHighlight(const FString& Kind, const FString& Id);
	/** BpLevel.* console commands sent before the plan arrived; ApplyPlan runs them in order. */
	static TArray<FString>& PendingLevelCommands();
	bool HasPlan() const { return SheetPlan.IsValid(); }

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
	/** Room names (on the room shells, under Rooms) and bay names (on the bay plates, under Bays): they ride the lift. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> RoomLabels;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> BayLabels;

	/** Draws the sheet; bound to the render target's update, which runs once per plan rev. */
	UFUNCTION()
	void DrawSheet(UCanvas* Canvas, int32 Width, int32 Height);

	void LoadArt();
	void PlaceForHeight(float HeightCm);
	void ApplyPlan(const FBpPlan& Plan);
	void ShowNoPlan();
	void SetTitle(const FString& Line1, const FString& Line2);
	/** A label on the paper, or, with a Parent, on a volume batch: then its place is in the batch's space and it rides
	 *  the batch's lift. */
	UWidgetComponent* MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm, float LiftCm, USceneComponent* Parent = nullptr);
	void PlaceLabels();
	void BuildVolumes(const FBpPlan& Plan);
	void ClearVolumes();
	static float HeightCvarCm();

	// Levels (BpLevels.cpp).
	void BuildLevelLabels(const FBpPlan& Plan);
	void RefreshWingCounts();
	void ResetLevels();
	void LogStep(EBpLevel From, EBpLevel To);
	/** Moves the eased state toward the logical one: the room settles before the wing comes down, and the wing is up
	 *  before the room rises, so going back retraces going in. True while anything still moves. */
	bool AdvanceLevels(float DeltaSeconds);
	void ApplyLevelVisuals();
	void UpdateBreadcrumb();
	void KickLevels();
	void RedrawSheet();
	void SetCrumbs(const TArray<TPair<FString, FString>>& Items);
	/** Sizes and places the bay names for a wing scale, and judges which fit their header strip at the label floor. */
	void FitBayLabels();
	/** A wing's lift: its scale after the fit-to-paper clamp, its footprint's centre and the slide (local cm). */
	void WingLift(const struct FBpPlanWing& Wing, float& OutScale, FVector& OutCentre, FVector& OutSlide) const;
	void SetLabelAlpha(UWidgetComponent* Label, float Alpha);
	/** The lifted wing at eased progress E (0 at rest): the Rooms batch's transform relative to the root. */
	FTransform WingGroupTransform(float E) const;
	FVector2D PaperCmToPlan(const FVector2D& PaperCm) const;
	const struct FBpPlanWing* FindWing(const FString& Id) const;
	const struct FBpPlanRoom* FindRoom(const FString& Id) const;
	/** The sheet ink's opacity factor for a wing: LevelDim for every wing but the lifted one. */
	float SheetInkFactor(const FString& Wing) const;

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

	/** The title block's first line is the breadcrumb (one text per crumb, separators between), its second the lens. */
	TSharedPtr<class SHorizontalBox> TitleLine1;
	TSharedPtr<class STextBlock> TitleLine2;
	/** Each wing's aggregate line (rooms, features, bad under the active lens), in WingLabels' order. */
	TArray<TSharedPtr<class STextBlock>> WingCounts;
	TArray<FString> WingLabelIds;
	/** Each bay's header strip (plan box top to its first tile), local cm, where its name goes if it fits. */
	TArray<float> BayHeaderCm;
	/** The opacity each level-driven label was last given. */
	TMap<const UWidgetComponent*, float> LabelAlpha;

	// ---- Level state: the logical level (changed at once, and logged) and the eased one that follows it --------------
	EBpLevel Level = EBpLevel::L0;
	FString WingId;
	FString RoomId;
	FString AnimWing;
	FString AnimRoom;
	float WingAlpha = 0.f;
	float RoomAlpha = 0.f;
	/** The lifted wing's footprint centre (local cm), its scale after the fit-to-paper clamp and the slide that keeps it
	 *  on the paper. */
	FVector AnimWingCentre = FVector::ZeroVector;
	float AnimWingScale = 1.f;
	FVector AnimWingSlide = FVector::ZeroVector;
	/** The lifted room's instance, and its and its name's resting places, put back bit for bit when it settles. */
	int32 LiftedRoom = INDEX_NONE;
	FTransform LiftedRoomRest;
	FVector LiftedRoomLabelRest = FVector::ZeroVector;
	/** What the sheet was last drawn with: the lifted wing (the others dimmed) and the highlighted wing. */
	FString SheetDimWing;
	FString SheetHighlightWing;
	FString HighlightKind;
	FString HighlightId;
	/** Last Show value (custom data 3) per instance, so custom data is written only when it changes. */
	TArray<float> ShownRooms;
	TArray<float> ShownBays;
	TArray<float> ShownTiles;
	/** Plan indices: each room's wing, each bay's room and each tile's room. */
	TArray<FString> RoomWing;
	TArray<int32> BayRoom;
	TArray<int32> TileRoom;
	/** The wing scale the bay names were judged at, and whether each fits its header strip at the label floor. */
	TArray<bool> BayNameFits;
	/** The breadcrumb's crumbs: id ("home", "wing:<id>", "room:<id>"), the text block, the hit region on the paper (cm). */
	struct FCrumb
	{
		FString Id;
		TSharedPtr<class STextBlock> Text;
		FBox2D PaperCm;
	};
	TArray<FCrumb> Crumbs;

	FDelegateHandle PlanHandle;
	FDelegateHandle FailedHandle;
};
