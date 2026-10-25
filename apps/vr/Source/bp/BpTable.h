// The light table (lynx-plan L3.2 to L3.4): a frame, the blueprint paper at the glass, the sheet drawn from the plan BpLink
// read, and the plan's rooms, bays and tiles as edge-glow volumes that rise off the paper level by level (BpLevels.cpp),
// with the marks on top (BpMarks.cpp: pins, the scan line, the decision card). The actor's origin is the floor under the table's centre. Its +X is away from the person at the near edge, +Y is
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
	 *  141.0 x 62.1 cm, which leaves 12.5 cm left and right for the scale bar, the compass and the title block. */
	static constexpr float BpPlanUnitCm = 0.037f;
	/** The plan sits this far from the paper's far edge (FE, element 3): the row of wing labels above the wings and the
	 *  pins' tags above it need the room, the near margin under the hands does not (Kettle: 10.5 cm far, 3.4 cm near).
	 *  A plan that would leave less than PlanNearMinCm near stays centred. level_check.py's MARGIN follows it. */
	static constexpr float PlanFarMarginCm = 10.5f;
	static constexpr float PlanNearMinCm = 3.f;
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
	/** The paper's grid, from its far-left corner: a fine line every GridFineCm and a stronger one every GridMajorEvery
	 *  fine lines (M_BlueprintPaper draws it, fg_holo.py follows these). Half the texture's cell, so every second fine line and every second major one lie on the
	 *  texture's own lines. */
	static constexpr float GridFineCm = PaperTileCm / 32.f;
	static constexpr int32 GridMajorEvery = 4;
	/** Cap height of the breadcrumb and the room and bay names, sized for reading at about 1 m (the wing titles and the
	 *  title block have their own, BpTable.cpp). */
	static constexpr float LabelCapHeightCm = 1.6f;
	/** The scale bar's length on the paper. */
	static constexpr float ScaleBarCm = 20.f;
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
	/** The lifted room's clamp (spark vr-fidelity-40 FC1): from the target and play eyes (ABpGameMode), the lifted room's top
	 *  far edge must project onto the table at least this far inside the frame's far rim, so a far room never floats past
	 *  it. When it would not, the room's lift slides it toward the viewer as it rises (the lift's transform only: its
	 *  instance in Rooms stays in its place in plan space, a copy rides the lift). */
	static constexpr float RoomLiftRimMarginCm = 2.f;

	/** The rooms at rest (FC1, element 4, bp.L0Volumes 1): every room's four walls stand this high in thin glass, open at
	 *  the top, and each bay's far boundary inside it is a partition wall at BayPartitionRatio of that height, PartitionCm
	 *  thick, across the bay's width (FM: the judge's "thin, taller cyan-edged walls with internal partitions"; a bay box
	 *  drawn whole made a second tray inside each room). A lifted wing leaves its rest walls behind, hidden. */
	static constexpr float RestRoomCm = 4.5f;  // FP: 4.5 (FO 3.5, FM 6.5, FK 2.2): cells, not trays, with the pointed room still standing out (by capture)
	static constexpr float BayPartitionRatio = 0.85f;
	static constexpr float PartitionCm = 0.08f;
	/** A partition's glass face (M_EdgeGlow's custom data 4; a room's walls are 1). */
	static constexpr float PartitionFace = 0.6f;
	/** The line-weight hierarchy at rest (FC3): the rooms' glass edges at RestRoomShow, the partitions' at
	 *  RestPartitionShow, the tile cells' at TileCellShow (the edge glow's Show scales its opacity), under the wing outlines
	 *  the sheet draws strongest. */
	static constexpr float RestRoomShow = 0.8f;
	static constexpr float RestPartitionShow = 0.7f;  // FM: 0.7 (from 0.45), a wall now, not a nested tray
	/** The finer grid (FO, element 4: the concept's "crisp grid of rooms"): each tile's box, grown by TileCellGrowU on every
	 *  side (half the plan's 10 u gutter between tiles, so neighbouring cells share one wall), stands as a low open cell
	 *  TileCellCm high, edges only. The plan's boxes place every cell; nothing is laid out here. */
	static constexpr float TileCellCm = 1.8f;  // FP: 1.8 (FO 1.2), with TileCellShow, crisper cell edges
	static constexpr float TileCellGrowU = 5.f;
	static constexpr float TileCellShow = 0.6f;  // FP: 0.6 (FO 0.45)
	/** The lifted room's shell glows this much over a lit shell (M_EdgeGlow's Show above 1 scales its emissive; FE). */
	static constexpr float LiftedRoomShow = 1.8f;
	/** The pointed room at L0 (FK, element 6: the concept's raised room under the fingertip). A room highlight
	 *  (SetHighlight("room", id): the hands' point, or BpLevel.Highlight) is a display state over the plan: the room's rest
	 *  extrusions are hidden and a copy of them stands HighlightRiseCm taller on the same footprint, at HighlightRestShow,
	 *  with the lifted room's glass. No instance moves in plan space; clearing it restores every Show exactly. */
	static constexpr float HighlightRiseCm = 10.5f;  // FO: 10.5 (FM 5.5, FK 2.5): four times the rest walls, the scene's focal point
	static constexpr float HighlightRestShow = 1.8f;
	/** FP (element 6, the judge: the raised room "looks empty, and the finger points below it"): the pointed room's copy is
	 *  lifted whole, its floor HighlightLiftCm off the paper with its cells and furniture on it (a display copy of the room's
	 *  glyphs, as of its walls), on a glass floor plate; a faint plinth of HighlightPlinthShow joins it to its footprint. Its
	 *  walls' tops stay at RestRoomCm + HighlightRiseCm. */
	static constexpr float HighlightLiftCm = 4.f;
	static constexpr float HighlightFloorCm = 0.25f;
	static constexpr float HighlightFloorShow = 1.2f;
	static constexpr float HighlightPlinthShow = 0.35f;
	/** The lifted copy's furniture glows this much over its rest Show (M_Glyph's custom data 0). */
	static constexpr float HighlightGlyphShow = 2.0f;
	/** While a room is pointed at rest, every other room's walls, cells and furniture dim to this (FO, element 6: the
	 *  concept's neighbours recede around the raised room). Clearing the highlight restores them. */
	static constexpr float PointedDim = 0.5f;
	/** The other rooms' furniture dims only this far (FP: at PointedDim the additive glyphs went to grey smears, the judge's
	 *  wings A and B); the walls carry the focal contrast. */
	static constexpr float PointedGlyphDim = 0.9f;

	/** The fixture glyphs (FC3, element 5; ArtSource/fixture-kit): each tile at rest holds the glyph of its feature's kind,
	 *  centred on its box, its footprint at most GlyphFill of the box and its height at most GlyphMaxCm (the shorter side
	 *  of the box scales it; the height is capped on its own, so a tall shelf reads as a low cabinet). */
	static constexpr float GlyphFill = 0.8f;
	static constexpr float GlyphMaxCm = 2.5f;  // FM: 2.5 (from 1.1) for FN's kit, which the old cap squashed about fourfold

	/** Pins (FC1, element 7): survey-pin stands on each feature that has an open (`proposed`) finding: an amber bead on the
	 *  plan, a stem and a paper tag on top (ArtSource/survey-pin: 6.38 cm tall, a 2.2 x 1.4 cm tag centred on the stem,
	 *  facing the mesh's +-Y, its faces UV'd 0..1). The tag shows its finding from the tag atlas. It stands PinScale times
	 *  its modelled size so the tag's text reads from the table's edge. */
	static constexpr float PinScale = 3.0f;  // FM: 3.0 (from 2.4), the judge's "enlarge pin tags" (element 7)
	/** Tags that would overlap from the target eye merge into the first one's (FC3): within TagClearUCm across, and along
	 *  the paper within the depth the tag's height covers seen from the target eye (BpType's floor sets the tag's size). */
	static constexpr float TagClearUCm = 8.3f;  // FM: with PinScale, the tag's width (6.6 cm) and a gap
	/** The pins' display rule (FE, element 7): every feature with an open finding has its amber bead; a feature carries a
	 *  standing pin with a tag only when one of its open findings is of high urgency, risk PinTagRiskMin or more
	 *  (blueprint-ui.md, the swarm's decisions: "urgency from risk (7 or more high, 4 or more medium)"). The rule picks
	 *  which tags show, never which findings exist: the tag names the feature's riskiest finding and counts the rest. */
	static constexpr int32 PinTagRiskMin = 7;
	/** A tag never stands over the wing labels (FE): a tagged pin whose tag the target eye would see over the label row
	 *  rises on a longer stem until the tag's foot clears the row's far edge by TagRowGapCm (paper cm, seen from the eye). */
	static constexpr float TagRowGapCm = 0.6f;
	/** The beads on the plan (every pin) and the stems under a risen pin: the pin's own amber, the bead PinBeadCm across,
	 *  the stem PinStemCm thick (the pin's stem at PinScale). */
	static constexpr float PinBeadCm = 1.1f;
	static constexpr float PinStemCm = 0.12f;  // FK halved it (element 7: the concept's stems are hairlines)
	/** Each bead's halo (FG, element 7: the concept's beads glow): a sphere this many times the bead, additive, brightest
	 *  over the bead and gone at its rim (M_PinHalo). */
	static constexpr float PinHaloScale = 3.2f;
	/** The mesh's tag faces its +-Y; this turns it to the viewer at the near edge. */
	static constexpr float PinYawDeg = 90.f;
	/** The tag atlas: TagAtlasCols x TagAtlasRows cells of TagCellWidthPx x TagCellHeightPx (the tag's 2.2 : 1.4). */
	static constexpr int32 TagCellWidthPx = 256;
	static constexpr int32 TagCellHeightPx = 162;
	static constexpr int32 TagAtlasCols = 8;
	static constexpr int32 TagAtlasRows = 8;

	/** The scan line (FC1, element 8): a band across the scanned place at the row of the feature being read, eased toward
	 *  it at ScanEaseCmPerS (paper cm); it fades over ScanFadeS when the job ends. Its bright core is ScanHalfWidthCm half
	 *  wide, its soft halo five times that (FM; FC3 had fourteen; the profile is fg_holo.py's), and it runs ScanOverrunCm past
	 *  the scanned place's ends. */
	static constexpr float ScanHalfWidthCm = 0.18f;  // FM: a bright thin core (the judge: "not a thick soft band")
	static constexpr float ScanOverrunCm = 2.f;
	static constexpr float ScanEaseCmPerS = 12.f;
	static constexpr float ScanFadeS = 1.2f;
	/** The scan's veil (FP, element 15, the judge's "the scan line throws visible glow into the air"): a sheet of haze
	 *  ScanVeilHeightCm tall standing on the line across the paper, brightest at its foot, at ScanVeilGlow times the line's
	 *  strength (M_HazeVeil's Glow, falloff ScanVeilPow). Nothing in it is data beyond the line's row. */
	static constexpr float ScanVeilHeightCm = 16.f;
	static constexpr float ScanVeilGlow = 0.6f;
	static constexpr float ScanVeilPow = 2.5f;

	/** The decision card (FC1, element 10): a world-space panel near the lamp agent, drawn at CardPxPerCm (FE: about twice
	 *  what the target capture resolves at its distance, r4 section 5; at 40 the widget was minified fourfold, unmipped,
	 *  and its text went soft). */
	static constexpr float CardWidthCm = 37.f;
	static constexpr float CardHeightCm = 23.f;  // FP: 23 (from 21) for the larger header and buttons
	/** FK took it to 32 (from 24); FM to 16, about twice what the target capture resolves there, since the widget's
	 *  target has no mips and fourfold minification aliased its text (element 10, "blurry"). bp.CardPxPerCm overrides it. */
	static constexpr float CardPxPerCm = 16.f;
	/** Where it floats, in the actor's space: x and y, and z above the table top (the target framing puts it right of the
	 *  lamp agent's head, as the concept's card; FE placed it by capture, FG moved it 7 cm left so it covers the end of
	 *  FI's reaching arm, as the concept's card hides the agent's hand). */
	static constexpr float CardPlaceXCm = 36.f;
	static constexpr float CardPlaceYCm = 40.f;  // FP: 40 (FK 32), clear of the agent's reaching arm (element 10, by capture)
	static constexpr float CardAboveTopCm = 25.f;

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

	/** The pin (ArtSource/survey-pin, imported; pivot the needle tip, standing +Z). Missing: no pins. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UStaticMesh> PinMesh;

	/** The pin body's material on the instanced batch (unlit amber, fc1_marks.py). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> PinBodyMaterial;

	/** The beads' halo (unlit, additive; fg_holo.py). Missing: no halos. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> PinHaloMaterial;

	/** The tags' material (Texture parameter `Atlas`, Scalar `TagGlow`; per-instance custom data 0, 1 = the cell's UV
	 *  offset, 2, 3 = its UV size). Missing: no tags. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> TagMaterial;

	/** The scan veil's material (M_HazeVeil: Vector Color, Scalars Glow, Pow, FadeCm). Missing: no veil. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> ScanVeilMaterial;

	/** The scan line's parameters (vectors ScanCentre, ScanAxis, ScanSide), read by the paper and the edge glow. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<class UMaterialParameterCollection> ScanCollection;

	/** The sheet's type faces (BpType.h): Barlow Semi Condensed Medium ("Regular") and SemiBold ("Bold"). Missing: Roboto. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<class UFontFace> TypeRegularFace;
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<class UFontFace> TypeBoldFace;

	/** The fixture glyphs (ArtSource/fixture-kit, imported; pivot the base centre, standing +Z), by feature kind; `generic`
	 *  stands for a kind the kit has no glyph for. Missing: no glyphs. */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TMap<FString, TSoftObjectPtr<UStaticMesh>> GlyphMeshes;
	/** The glyphs' material (unlit, additive; Scalar `GlyphGlow`; per-instance custom data 0 = Show). */
	UPROPERTY(EditAnywhere, Category = "Bp|Table")
	TSoftObjectPtr<UMaterialInterface> GlyphMaterial;

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
	/** HitTest's inverse, for the synthetic hand (BpHands.Pinch): the world point at the centre of a wing, a room or a
	 *  crumb ("home", "wing:<id>", "room:<id>") as it is drawn now, on the plane HitTest would meet it on. False for an
	 *  unknown id or no plan. */
	bool AimAt(const FString& Id, FVector& OutWorld) const;
	/** The decision card: shows the open finding it asks about (the lifted room's first, else the first in store order),
	 *  or hides. */
	void ShowCard(bool bShow);
	/** POST a lens scan of a wing, room or feature (by its plan id) the way the web does; the scan line follows it. */
	void StartScan(const FString& Id, const FString& Lens);

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
	/** The lifted room's shell while it is up: a copy of its Rooms instance under the room's lift (FC1). */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> LiftedShell;
	/** The rooms and their bays at rest, low (RestRoomCm), on the paper; they never lift. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> RestVolumes;
	/** The pointed room's rest extrusions, raised (HighlightRiseCm) while a room highlight is set at rest (FK). */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> HighlightShell;
	/** The pointed room's furniture, lifted with its copy (FP): one batch per glyph batch, empty unless a room is pointed. */
	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> GlyphLift;
	/** The scan's light in the air (FP, element 15): a vertical haze veil (M_HazeVeil) standing on the scan line. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UStaticMeshComponent> ScanVeil;
	UPROPERTY()
	TObjectPtr<class UMaterialInstanceDynamic> ScanVeilMid;
	/** The tagged pins, their tags included: one batch. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> Pins;
	/** Every pin's bead on the plan, and the stems under the risen pins (FE). */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> PinBeads;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> PinStems;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Table")
	TObjectPtr<UInstancedStaticMeshComponent> PinHalos;

	/** Engine content for the greybox, held hard so a cook takes it along. */
	UPROPERTY()
	TObjectPtr<UStaticMesh> EngineCube;
	UPROPERTY()
	TObjectPtr<UStaticMesh> EnginePlane;
	UPROPERTY()
	TObjectPtr<UStaticMesh> EngineSphere;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineShapeMaterial;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> EngineSheetMaterial;
	UPROPERTY()
	TObjectPtr<UTexture2D> EngineWhiteTexture;
	/** The sheet's and the tags' font: canvas text needs a UFont (a Slate style font has no font object, and
	 *  FCanvasTextItem draws nothing without one). */
	UPROPERTY()
	TObjectPtr<class UFont> EngineFont;
	/** The sheet's font (BpType.h), built from the type faces at BeginPlay: a runtime-cached UFont whose typefaces are
	 *  named "Regular" and "Bold". */
	UPROPERTY(Transient)
	TObjectPtr<class UFont> TypeFont;

	/** The fixture glyphs at rest, one instanced batch per kind (FC3), and their material. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Glyphs;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> GlyphMid;
	/** Per glyph batch: each instance's room (plan index) and the Show last written to it. */
	TArray<TArray<int32>> GlyphRoom;
	TArray<TArray<float>> ShownGlyph;

	UPROPERTY(Transient)
	TObjectPtr<UCanvasRenderTarget2D> Sheet;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> PaperMid;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> OverlayMid;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> VolumeMids;

	/** The tag atlas: every tag's text, drawn once per change of the pins. */
	UPROPERTY(Transient)
	TObjectPtr<UCanvasRenderTarget2D> TagAtlas;
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> TagMid;
	UPROPERTY(Transient)
	TObjectPtr<class UMaterialParameterCollection> ScanParams;
	/** The decision card. */
	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> Card;
	/** Room names (on the room shells, under Rooms) and bay names (on the bay plates, under Bays): they ride the lift. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> RoomLabels;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> BayLabels;

	/** Draws the sheet; bound to the render target's update, which runs once per plan rev. */
	UFUNCTION()
	void DrawSheet(UCanvas* Canvas, int32 Width, int32 Height);
	/** The sheet's text (FC1): title block, wing titles, the scale bar's figures, the breadcrumb. Lines go in Tris. */
	void DrawSheetText(UCanvas* Canvas, TArray<struct FCanvasUVTri>& Tris);
	/** Draws the tags' text into the atlas. */
	UFUNCTION()
	void DrawTags(UCanvas* Canvas, int32 Width, int32 Height);

	void LoadArt();
	/** TypeFont from the type faces, or Roboto (with one warning) when they are missing. */
	void BuildTypeFont();
	/** The glyph batches from the plan's tiles and the kinds BpLink read (FC3). */
	void BuildGlyphs(const FBpPlan& Plan);
	/** The glyphs' Show per instance for the levels: as their room's rest extrusion. */
	void ApplyGlyphs(float WingEase);
	/** The pointed room's furniture copied onto its lifted floor (FP), or every lifted copy cleared (INDEX_NONE). */
	void LiftGlyphs(int32 Room);
	/** BpType's floor: the smallest cap height (paper cm) a text whose baseline stands at PaperCm may have, so its cap
	 *  subtends BpType::FloorPx in the target capture and BpType::FloorArcmin from the play eye. */
	double TextFloorCm(const FVector2D& PaperCm) const;
	/** How deep a wall of HeightCm standing at paper v hides the paper behind it, seen from the target eye (cm, along v). */
	double CoverCm(double V, double HeightCm) const;
	void PlaceForHeight(float HeightCm);
	void ApplyPlan(const FBpPlan& Plan);
	void ShowNoPlan();
	void SetTitle(const FString& Line1, const FString& Line2);
	// The marks (BpMarks.cpp): pins, the scan line and the decision card, from the scan side BpLink polls.
	void LoadMarks();
	void ReceiveScanState(const struct FBpScanState& State);
	void BuildPins(const struct FBpScanState& State);
	void PlacePins();
	void UpdateScan(float DeltaSeconds);
	void WriteScanParams(float Strength);
	void RefreshCard();
	/** Where a room's contents are drawn now, relative to the actor: the paper, or its lifted wing's or room's group. */
	FTransform GroupTransformForRoom(int32 Room) const;
	/** The rest extrusions' Show per instance, for the levels. */
	void ApplyRestVolumes(float WingEase);
	/** The lifted room's slide toward the viewer at full lift (RoomLiftRimMarginCm's clamp), actor cm. */
	float RoomSlideCm(const FString& Room) const;
	/** The lifted wing's group transform now (the paper's when none is lifted). */
	FTransform LiftedWingTransform() const;
	/** How far a room has risen (0 at rest, 1 lifted), eased. */
	float RoomRiseEase(int32 Room) const;
	/** bp.L0Volumes. */
	static int32 CVarL0VolumesValue();
public:
	/** The font canvas text is drawn with: the sheet's (BpType.h), Roboto until it is built. */
	static const UObject* TextFontObject();
private:
	/** A label on the paper, or, with a Parent, on a volume batch: then its place is in the batch's space and it rides
	 *  the batch's lift. */
	UWidgetComponent* MakeLabel(const TSharedRef<SWidget>& Content, const FVector2D& PaperCm, const FVector2D& Pivot, float CapHeightCm, float LiftCm, USceneComponent* Parent = nullptr);
	void PlaceLabels();
	/** The wing labels over the rest walls (FM): what DrawSheetText set (name, tag line, paper place, caps), made as flat
	 *  widgets at Tick when it changed. */
	struct FWingLabel
	{
		FString Wing;
		FString Name;
		FString Tag;
		double U = 0.0;
		double NameBase = 0.0;
		double NameCap = 0.0;
		double TagCap = 0.0;
	};
	TArray<FWingLabel> WingLabelSpecs;
	FString WingLabelsKey;
	bool bWingLabelsDirty = false;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWidgetComponent>> WingLabels;
	void BuildWingLabels();
	/** A component's relative location set exactly (no round trip through world space), its world transform after it. */
	static void PlaceExactly(USceneComponent* Component, const FVector& Relative);
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
	/** Where the plan's extent starts on the paper (cm): centred across, PlanFarMarginCm from the far edge. */
	FVector2D PlanMarginCm() const;
	const struct FBpPlanWing* FindWing(const FString& Id) const;
	const struct FBpPlanRoom* FindRoom(const FString& Id) const;
	/** The sheet ink's opacity factor for a wing: LevelDim for every wing but the lifted one. */
	float SheetInkFactor(const FString& Wing) const;

	bool bRealFrame = false;
	bool bRealPaper = false;
	bool bLoggedNoPlan = false;
	/** The next sheet draw logs each text's cap against its floor (BpType.h), once per plan. */
	bool bReportType = false;
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

	/** The title block (FC1: drawn into the sheet): the waiting line before a plan, and the lens. */
	FString TitleWaitLine;
	FString TitleLensLine;
	/** Each wing's aggregate line (rooms, features, bad under the active lens), by wing id: logged, not drawn (FC3). */
	TMap<FString, FString> WingCounts;
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
		FString Text;
		bool bHere = false;
		bool bLit = false;
		FBox2D PaperCm;
	};
	TArray<FCrumb> Crumbs;

	/** The lifted room's slide toward the viewer (actor cm, along -X) at full lift: RoomLiftRimMarginCm's clamp. */
	float LiftedRoomSlideCm = 0.f;
	/** The level the sheet's title block was last drawn for, and the bp.L0Volumes value last applied. */
	EBpLevel SheetLevel = EBpLevel::L0;
	int32 AppliedL0Volumes = -1;
	/** Rest extrusions' last Show per instance. */
	TArray<float> ShownRest;
	/** Each rest instance's room (plan index), its ink (RestRoomShow, RestPartitionShow or TileCellShow) and its face
	 *  factor (custom data 4). */
	TArray<int32> RestRoom;
	TArray<float> RestInk;
	TArray<float> RestFace;
	/** The room (plan index) HighlightShell stands for, or none. */
	int32 HighlightRestRoom = INDEX_NONE;

	// ---- Marks state (BpMarks.cpp) ------------------------------------------------------------------------------------
	struct FPin
	{
		int32 Tile = INDEX_NONE;
		int32 Room = INDEX_NONE;
		FString Line1;
		FString Line2;
		/** The open findings on this feature. */
		int32 Findings = 0;
		/** The riskiest open finding on it (its tag's first line) and its risk. */
		int32 Risk = 0;
		/** Whether it stands with a tag (the display rule, then FC3's merge: a tag that would overlap a nearer one's from
		 *  the target eye gives its count to that one), its atlas cell, and how far it rises on its stem (paper cm). */
		bool bTagged = true;
		int32 Cell = INDEX_NONE;
		float RaiseCm = 0.f;
	};
	TArray<FPin> PinList;
	/** The far edge (paper v, cm) of the wing labels the sheet last drew: the risen tags clear it (FE). */
	double WingLabelTopV = -1.0e9;  // unset; the floating labels (FM) put the row past the paper (v < 0)
	/** Each tagged pin's rise so its tag clears the label row from the target eye. */
	void RaisePins();
	/** Where a label of Width (paper cm) on the row from VTop to VBase starts, at U0 or as near it as keeps it, up to
	 *  MaxU, off every tagged pin's stem as the target eye sees the stem cross that row (FM); where none is clear, across
	 *  the fewest stems. */
	double SlideOffStems(double Lo, double Pref, double Width, double MaxU, double VTop, double VBase) const;
	FString PinsKey;
	/** The running measure job the scan line follows, the plan box its scope covers, and the line's place (plan y) now
	 *  and where it heads. */
	FString ScanJob;
	FString ScanRun;
	FBox2D ScanPlanBox = FBox2D(ForceInit);
	FString ScanWing;
	double ScanY = 0.0;
	double ScanTargetY = 0.0;
	float ScanStrength = 0.f;
	bool bScanLive = false;
	bool bCardShown = false;
	FString CardProposal;

	FDelegateHandle PlanHandle;
	FDelegateHandle FailedHandle;
	FDelegateHandle ScanHandle;
};
