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
	/** bp.Projector as asked: 0 the desk console, 1 THE THROW, 2 THE LIGHT STAGE (behaves as 1 until it exists). */
	int32 Mode();
	/** A far surface is in use (Mode() > 0). */
	inline bool IsOn() { return Mode() > 0; }
	/** The surface the mode names (the throw's flat sheet for 1 and, for now, 2). */
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
