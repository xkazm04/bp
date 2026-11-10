// The light stage's surface (projector concept 3, docs/concepts/vr-light-table/projector/README.md): a curved sheet of
// light standing behind the table's far edge like a cyclorama, centred on the seated eye, and the cyan line of light on
// the far rim it rises out of. Geometry only: built into a UProceduralMeshComponent once, and again only when a
// parameter changes, never per frame (48 columns x 1 row is 96 triangles, plus 2 for the top fade band per column).
//
// HOW TO USE IT
// 1. bp.Build.cs: add "ProceduralMeshComponent" to PrivateDependencyModuleNames (this header only forward-declares the
//    component, so Private is enough). The plugin's .uplugin says "EnabledByDefault": true, so bp.uproject needs no
//    change; listing { "Name": "ProceduralMeshComponent", "Enabled": true } under "Plugins" is harmless and explicit.
// 2. Coordinates are the component's local space, in cm: X forward, Y right, Z up (UE's left-handed frame). Center is
//    the seated eye's GROUND point (floor level); heights are measured up from Center.Z. FacingYawDeg 0 faces +X.
//    UV0: U 0..1 left to right as the wearer sees it, V 0..1 top to bottom, over the whole arc and height, so a widget
//    render target maps on unmirrored. Vertex colour is white; its alpha is the edge fade (1 inside, 0 at the two ends
//    over EdgeFadeDeg and at the top over TopFadeCm).
// 3. Material (unlit, the render target as a Texture parameter "Sheet"). Try A first:
//    A. Opaque-masked, cheap: Blend Mode Masked, Shading Model Unlit, Emissive = Sheet.rgb * VertexColor.A * Brightness,
//       Opacity Mask = VertexColor.A, Opacity Mask Clip Value 0.02, and Details > Mobile > "Use Alpha to Coverage" on
//       (UMaterial::bUseAlphaToCoverage; it turns the fade into MSAA coverage under the Quest's 4x MSAA). No overdraw
//       beyond one opaque layer, it writes alpha 1 so passthrough never shows through the sheet, and the colour itself
//       fades to black at the edges. "Dither Opacity Mask" also works but needs TAA, which the Quest does not run, so it
//       stipples there.
//    B. Translucent, softer but costly: Blend Mode Translucent (or Additive for a pure "light" look), Unlit, Emissive as
//       in A, Opacity = VertexColor.A; turn off "Output Velocity" and keep it out of separate translucency. A 120 degree
//       sheet at 2.2 m covers most of each eye's view, so this is a full-screen blended layer every frame; and a
//       material that writes scene alpha below 1 lets the passthrough underlay show THROUGH the sheet. Measure on the
//       headset before keeping it.
//    The rim line: the same recipe with a constant cyan in place of the texture (Additive suits it; it is tiny).
// 4. From an actor's BeginPlay (sketch):
//      UProceduralMeshComponent* Stage = NewObject<UProceduralMeshComponent>(this, TEXT("Stage"));
//      Stage->SetupAttachment(GetRootComponent());
//      Stage->RegisterComponent();
//      BpStage::FShape Shape;                       // README defaults: r 220, arc 120, 72..202 cm, top fade 25 cm
//      Shape.Center = EyeGroundLocal;               // the seat's eye, dropped to the floor, in this actor's space
//      BpStage::BuildSheet(Stage, 0, Shape);
//      BpStage::FRimLine Rim;                       // the far rim's two corners at table height, the seat
//      Rim.Start = FarLeftLocal; Rim.End = FarRightLocal; Rim.Seat = Shape.Center;
//      BpStage::BuildRimLine(Stage, 1, Rim);
//      UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(StageMaterial, this);
//      Mid->SetTextureParameterValue(TEXT("Sheet"), SheetRenderTarget);
//      Stage->SetMaterial(0, Mid);
//      Stage->SetMaterial(1, RimMaterial);
//    Hand ray: move it into the component's space first (InverseTransformPosition / InverseTransformVectorNoScale on
//    Stage->GetComponentTransform()), then BpStage::RayHit gives the UV to feed the widget, and the distance.
// The README's build note suggests a UWidgetComponent in cylinder mode for the content; this mesh is the alternative
// (one render target over the whole arc, fades in vertex alpha), and RayHit/UVToPoint serve either one.
#pragma once

#include "CoreMinimal.h"

class UProceduralMeshComponent;

namespace BpStage
{
	/** The curved sheet: a cylinder segment around a vertical axis through Center, seen from inside. */
	struct FShape
	{
		FVector Center = FVector::ZeroVector; // the seated eye's ground point
		double FacingYawDeg = 0.0;            // the arc's middle, as a yaw (0 = +X, positive turns right)
		double RadiusCm = 220.0;              // at the bottom edge
		double ArcDeg = 120.0;                // whole arc, centred on FacingYawDeg (kept under 360)
		double BottomCm = 72.0;               // above Center.Z
		double TopCm = 202.0;                 // above Center.Z
		int32 Columns = 48;                   // segments along the arc
		int32 Rows = 1;                       // segments below the top fade band; raise it only with LeanDeg
		double LeanDeg = 0.0;                 // the top bows in toward the eye: vertical at the bottom, LeanDeg at the top
		double EdgeFadeDeg = 15.0;            // alpha 1 -> 0 over the last degrees at each end
		double TopFadeCm = 25.0;              // alpha 1 -> 0 over the last cm at the top (gets its own row)
	};

	/** The line of light on the far rim: a flat ribbon between two points, tilted up toward the seat. */
	struct FRimLine
	{
		FVector Start = FVector(140.0, -120.0, 72.0);
		FVector End = FVector(140.0, 120.0, 72.0);
		FVector Seat = FVector::ZeroVector; // which side is "toward the seat" (only its X and Y matter)
		double WidthCm = 2.0;
		double BulgeCm = 0.0;   // midpoint offset from the straight segment, positive away from the seat (a shallow arc)
		double TiltDeg = 30.0;  // the ribbon's far edge raised, so it faces up and toward the seat
		double EndFadeCm = 20.0;
		int32 Segments = 32;
	};

	/** Builds (or rebuilds) the sheet into SectionIndex of Mesh. No collision, no shadow. */
	void BuildSheet(UProceduralMeshComponent* Mesh, int32 SectionIndex, const FShape& Shape);

	/** Builds (or rebuilds) the rim line into SectionIndex of Mesh (use another section than the sheet's). */
	void BuildRimLine(UProceduralMeshComponent* Mesh, int32 SectionIndex, const FRimLine& Line);

	/** The sheet's radius at a height above Center.Z (RadiusCm when LeanDeg is 0). */
	double RadiusAt(const FShape& Shape, double HeightCm);

	/** A point on the sheet, in the mesh's space, for a UV (0,0 top left as seen from the seat). */
	FVector UVToPoint(const FShape& Shape, const FVector2D& UV);

	/** The UV of the sheet point in the direction and height of Point (projected along the radius). False outside. */
	bool PointToUV(const FShape& Shape, const FVector& Point, FVector2D& OutUV);

	/** A ray (the hand's, in the mesh's space) against the sheet: the first hit going forward, from inside the cylinder
	 *  (always the case from the seat) or outside. False when it misses the arc or the height range. */
	bool RayHit(const FShape& Shape, const FVector& Origin, const FVector& Direction, FVector2D& OutUV, double& OutDistanceCm);

	/** Horizontal and vertical degrees a UV rectangle subtends: horizontally from the axis, vertically from an eye at
	 *  EyeHeightCm above Center.Z on the axis. */
	FVector2D AngularSizeDeg(const FShape& Shape, const FVector2D& UVMin, const FVector2D& UVMax, double EyeHeightCm);

	/** The cm a cap height of ArcMinutes takes at DistanceCm: d x tan(arc minutes / 60 deg). */
	double CapHeightCm(double ArcMinutes, double DistanceCm);

	/** Logs and ensures the known values (winding, UV round trip, three rays, angular size, cap heights). */
	void SelfCheck();
}
