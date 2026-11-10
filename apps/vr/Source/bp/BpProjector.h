// The projector (wave PJ1; docs/concepts/vr-light-table/projector/README.md): the console's open sheet handed from the 40 x 22.5
// cm panel 75 cm from the eye to a far, large surface. THE THROW (bp.Projector 1) is a flat sheet about 240 x 135 cm, 3 m away
// over the table's far rim, read from the seat; THE LIGHT STAGE (bp.Projector 2, the next wave) is a second surface for the
// same sheets. Everything that hands a sheet to a far surface, tests the hand's ray against it and aims Glim at it goes through
// IBpFarSurface, so the stage is one more implementation, not a rewrite.
//
// The loupe: a 1280 px screen shown 15 degrees wide gets about 290 device pixels, enough for its structure and not its words.
// Each decoded screen keeps a small grey thumbnail (made on the decode's worker thread); a pair's region of change, or one
// screen's densest region, is found on those thumbnails and shown as a crop of the same texture (a UV sub-rect, no new decode).
#pragma once

#include "CoreMinimal.h"
#include "BpStageMesh.h"

class UTexture2D;

/** A far surface the console's sheet is drawn on. Its space: the table's (cm); the sheet's UV is (0,0) top left. */
class IBpFarSurface
{
public:
	virtual ~IBpFarSurface() {}
	virtual const TCHAR* Name() const = 0;
	/** Where the sheet stands (its centre, facing the eye: +X toward it, as a world-space widget's) and its size in cm, from the
	 *  eye and the table's forward (both in the table's space) and whether the room is the wearer's own (passthrough). */
	virtual void Place(const FVector& EyeLocal, const FVector& Forward, bool bPassthrough, FVector& OutCentre, FRotator& OutFacing, FVector2D& OutSizeCm) const = 0;
	/** A world ray against the sheet whose centre pose is Pose (unscaled) and size SizeCm: its UV, false when it misses. */
	virtual bool RayToUv(const FTransform& Pose, const FVector2D& SizeCm, const FVector& Origin, const FVector& Dir, FVector2D& OutUv) const = 0;
	/** A UV's world point on the sheet (Glim's aim, the beam's end). */
	virtual FVector UvToWorld(const FTransform& Pose, const FVector2D& SizeCm, const FVector2D& Uv) const = 0;
};

namespace BpProjector
{
	/** bp.Projector as asked: 0 the desk console, 1 THE THROW, 2 THE LIGHT STAGE. */
	int32 Mode();
	/** A far surface is in use (Mode() > 0). */
	inline bool IsOn() { return Mode() > 0; }
	/** The surface the mode names (the throw's flat sheet for 1, the stage's curve for 2). */
	const IBpFarSurface& Surface();
	/** The draw size for a surface of SizeCm at DistanceCm: about 36 px a degree (2x the Quest 3S's centre), at most 2048 wide. */
	FIntPoint DrawSizeFor(const FVector2D& SizeCm, float DistanceCm);
	/** The console's sheet is on the far surface now (PlaceConsole says), and the point Glim turns to (table space). */
	void SetFar(bool bFar, const FVector& AimLocal);
	bool IsFar();
	FVector FarAimLocal();
	/** The far sheet's centre (table space), for the capture pose that frames it (BpView.Pose far). */
	void SetFarCentre(const FVector& CentreLocal);
	FVector FarCentreLocal();
	/** The angular size that the far sheet's distance gives a cap height (cm) and a control (cm), for the legibility table. */
	float ArcMinutes(float Cm, float DistanceCm);

	// ---- Glim on the wall (wave N3-W2) ------------------------------------------------------------------------------------
	/** What Glim points at on the far sheet (table space): Present as a decision opens (the loupe's region, else its title), then
	 *  Ask (APPROVE) once he asks for the answer, bp.Projector.AskAfterS later. bPoint: a decision is open, so he raises his
	 *  arm toward it; otherwise he only turns (Ask = Present). FarAimLocal answers whichever holds now. */
	void SetFarAims(const FVector& PresentLocal, const FVector& AskLocal, bool bPoint);
	/** A decision is open on the far sheet (Glim raises his arm toward FarAimLocal). */
	bool IsPointing();
	/** Wave N3-W4: both points he will point at for the sheet now (Present, then Ask; equal when he only turns), so his stand
	 *  is chosen once for the two. False when no sheet has set them. */
	bool FarAims(FVector& OutPresent, FVector& OutAsk);
	/** FarAimLocal is the Ask aim now (he asks for the answer). */
	bool IsAsking();
	/** The far sheet's pose (table space, unscaled; a widget's facing: +X toward the eye) and size in cm, for the beam. */
	void SetFarSheet(const FTransform& PoseLocal, const FVector2D& SizeCm);
	bool FarSheet(FTransform& OutPoseLocal, FVector2D& OutSizeCm);
	/** bp.Projector.Beam (0 to 1): the beam from Glim's lens to the sheet while he presents; 0 none. */
	float BeamAmount();
	/** Wave U1, "the wall arrives": 0 to 1 while the far sheet is projected in (a bump: up and back), 0 at rest. The beam from
	 *  Glim's lens flicks brighter by it (BpLampLook.cpp's TickGlimBeam). */
	void SetArriveFlash(float Amount);
	float ArriveFlash();
	/** bp.Glim.PointDeg: the most Glim raises his arm (tilts back from his base) toward the sheet, degrees (0 none). */
	float PointMaxDeg();

	// ---- THE LIGHT STAGE (wave PJ2, bp.Projector 2) ---------------------------------------------------------------------------
	/** The stage is the surface in use (Mode() == 2). */
	inline bool IsStage() { return Mode() == 2; }
	/** The stage's shape as its surface last placed it, in the stage's own space: the pose Place returns is the seated eye's
	 *  ground point (72 cm under the table top, as the README's table), facing the table's forward; the shape is centred on
	 *  that pose's origin, facing +X (BpStageMesh.h). */
	const BpStage::FShape& StageShape();
	/** The active sheet's rectangle on the stage (its centre zone), in the stage's UV (0..1 over the whole arc and height). */
	FBox2D StageSheetUv();
	/** The stage's whole surface in the sheet's layout pixels, for a sheet SheetLayoutW layout px wide. */
	FVector2D StageLayoutSize(float SheetLayoutW);
	/** The stage's render target size for a layout of StageLayout px: the most that fits 4096 x 1024 at square texels. */
	FIntPoint StageDrawSize(const FVector2D& StageLayout);
	/** A key that changes when the stage's shape does (its mesh is rebuilt then, never per frame). */
	FString StageKey();
	/** The stage's cvars as one string (the console re-places the sheet when it changes). */
	FString StageCvars();

	// ---- The loupe ----------------------------------------------------------------------------------------------------------
	/** Called on the decode's worker thread: a grey thumbnail (ThumbW wide) of a BGRA image W x H. */
	TArray<uint8> MakeThumb(const uint8* Bgra, int32 W, int32 H, int32& OutTW, int32& OutTH);
	/** On the game thread, when the texture is made: its thumbnail is kept beside it (dropped with it). */
	void KeepThumb(UTexture2D* Texture, TArray<uint8>&& Thumb, int32 TW, int32 TH);
	/** The loupe's UV rectangle for a crop of aspect Aspect (its width over its height, in the image's pixels) and WidthFrac of
	 *  the image's width: the region where Before and After differ most (After null: Before's densest region). False when a
	 *  thumbnail is missing. Cached per pair. */
	bool LoupeRegion(const UTexture2D* Before, const UTexture2D* After, float Aspect, float WidthFrac, FBox2f& OutUv);
}
