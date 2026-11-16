// The light stage's surface: see BpStageMesh.h for what it is and how to use it.
//
// WINDING. UE's front face, read off the engine's own UKismetProceduralMeshLibrary::GenerateBoxMesh (its top face is
// quad 0,1,2,3 with normal +Z, split by ConvertQuadToTriangles into 0,1,3 and 1,2,3): for a triangle A,B,C the front
// normal is CrossProduct(C - A, B - A), the opposite of the right-handed habit. Checked: top face A(-x,+y) B(+x,+y)
// C(-x,-y): C - A = (0,-2y,0), B - A = (2x,0,0), cross = (0,0,4xy), i.e. +Z. Every triangle below follows that rule and
// SelfCheck re-proves it on the built arrays (Detail::FacesNormal).
//
// U DIRECTION, worked: facing +X, the wearer's right is +Y. Column yaw = Facing - Arc/2 + U * Arc, so U = 0 sits at yaw
// -60 for the default 120 degree arc: direction (cos -60, sin -60) = (0.5, -0.866), Y negative, the LEFT end as seen
// from the seat; U = 1 at yaw +60 is the right end. V = 0 is the top. So texel (0,0), the render target's top left,
// lands top left as the wearer sees it: no mirror.
#include "BpStageMesh.h"

#include "ProceduralMeshComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBpStage, Log, All);

namespace BpStage
{
namespace Detail
{
	struct FArrays
	{
		TArray<FVector> Vertices;
		TArray<int32> Triangles;
		TArray<FVector> Normals;
		TArray<FVector2D> UV0;
		TArray<FLinearColor> Colors;
		TArray<FProcMeshTangent> Tangents;
	};

	double ArcOf(const FShape& Shape) { return FMath::Clamp(Shape.ArcDeg, 1.0, 359.0); }
	double HeightOf(const FShape& Shape) { return FMath::Max(Shape.TopCm - Shape.BottomCm, 1.0); }
	double LeanTan(const FShape& Shape) { return FMath::Tan(FMath::DegreesToRadians(FMath::Clamp(Shape.LeanDeg, 0.0, 45.0))); }

	/** Triangle TriIndex faces the normal stored on its first vertex (the winding rule above). */
	bool FacesNormal(const FArrays& Arrays, int32 TriIndex)
	{
		const FVector& A = Arrays.Vertices[Arrays.Triangles[TriIndex * 3]];
		const FVector& B = Arrays.Vertices[Arrays.Triangles[TriIndex * 3 + 1]];
		const FVector& C = Arrays.Vertices[Arrays.Triangles[TriIndex * 3 + 2]];
		const FVector Front = FVector::CrossProduct(C - A, B - A);
		return FVector::DotProduct(Front, Arrays.Normals[Arrays.Triangles[TriIndex * 3]]) > 0.0;
	}

	void MakeSheet(const FShape& Shape, FArrays& Out)
	{
		const int32 Columns = FMath::Clamp(Shape.Columns, 1, 1024);
		const int32 Rows = FMath::Clamp(Shape.Rows, 1, 256);
		const double Arc = ArcOf(Shape);
		const double Height = HeightOf(Shape);
		const double Fade = FMath::Clamp(Shape.TopFadeCm, 0.0, Height);
		const double Slope = LeanTan(Shape);

		// Row heights from the top down: the top, the fade band's foot (so the top fade is exact, not spread over the
		// whole height), then Rows even steps to the bottom.
		TArray<double> Heights;
		Heights.Add(Shape.BottomCm + Height);
		const bool bFadeRow = Fade > 0.0 && Fade < Height;
		const double BodyTop = Shape.BottomCm + Height - (bFadeRow ? Fade : 0.0);
		if (bFadeRow)
		{
			Heights.Add(BodyTop);
		}
		for (int32 Row = 1; Row <= Rows; ++Row)
		{
			Heights.Add(BodyTop - (BodyTop - Shape.BottomCm) * (static_cast<double>(Row) / Rows));
		}

		const int32 Stride = Columns + 1;
		const int32 NumVerts = Heights.Num() * Stride;
		Out = FArrays();
		Out.Vertices.Reserve(NumVerts);
		Out.Normals.Reserve(NumVerts);
		Out.UV0.Reserve(NumVerts);
		Out.Colors.Reserve(NumVerts);
		Out.Tangents.Reserve(NumVerts);
		for (int32 Row = 0; Row < Heights.Num(); ++Row)
		{
			const double H = Heights[Row];
			const double Radius = RadiusAt(Shape, H);
			const double Bow = Slope * (H - Shape.BottomCm) / Height; // d(inward)/dz: 0 at the bottom, tan(Lean) at the top
			const double TopAlpha = Fade > 0.0 ? FMath::Clamp((Shape.BottomCm + Height - H) / Fade, 0.0, 1.0) : 1.0;
			for (int32 Col = 0; Col <= Columns; ++Col)
			{
				const double U = static_cast<double>(Col) / Columns;
				const double Rel = -0.5 * Arc + U * Arc; // degrees from the middle, negative to the wearer's left
				const double Yaw = FMath::DegreesToRadians(Shape.FacingYawDeg + Rel);
				const double Cos = FMath::Cos(Yaw);
				const double Sin = FMath::Sin(Yaw);
				const double SideAlpha = Shape.EdgeFadeDeg > 0.0 ? FMath::Clamp((0.5 * Arc - FMath::Abs(Rel)) / Shape.EdgeFadeDeg, 0.0, 1.0) : 1.0;
				Out.Vertices.Add(Shape.Center + FVector(Radius * Cos, Radius * Sin, H));
				Out.Normals.Add(FVector(-Cos, -Sin, -Bow).GetSafeNormal()); // toward the axis, tipped down as the top leans in
				Out.UV0.Add(FVector2D(U, (Shape.BottomCm + Height - H) / Height));
				Out.Colors.Add(FLinearColor(1.f, 1.f, 1.f, static_cast<float>(SideAlpha * TopAlpha)));
				Out.Tangents.Add(FProcMeshTangent(FVector(-Sin, Cos, 0.0), false)); // along +U (the arc, left to right)
			}
		}

		// TL, BL, TR and TR, BL, BR: at yaw 0 TL (r,0,top) BL (r,0,bot) TR (r,+dy,top) gives
		// Cross(TR - TL, BL - TL) = Cross((0,dy,0), (0,0,-h)) = (-dy*h, 0, 0): toward the axis, as wanted.
		Out.Triangles.Reserve((Heights.Num() - 1) * Columns * 6);
		for (int32 Row = 0; Row + 1 < Heights.Num(); ++Row)
		{
			for (int32 Col = 0; Col < Columns; ++Col)
			{
				const int32 TL = Row * Stride + Col;
				const int32 BL = TL + Stride;
				Out.Triangles.Append({ TL, BL, TL + 1, TL + 1, BL, BL + 1 });
			}
		}
	}

	bool MakeRimLine(const FRimLine& Line, FArrays& Out)
	{
		Out = FArrays();
		const FVector Chord = Line.End - Line.Start;
		const FVector ChordFlat(Chord.X, Chord.Y, 0.0);
		if (ChordFlat.IsNearlyZero())
		{
			return false;
		}
		const int32 Segments = FMath::Clamp(Line.Segments, 1, 256);
		const FVector Mid = 0.5 * (Line.Start + Line.End);
		FVector Away = FVector(-ChordFlat.Y, ChordFlat.X, 0.0).GetSafeNormal();
		if (FVector::DotProduct(Away, FVector(Mid.X - Line.Seat.X, Mid.Y - Line.Seat.Y, 0.0)) < 0.0)
		{
			Away = -Away;
		}

		TArray<FVector> Points;
		TArray<double> Along; // cumulative length
		for (int32 K = 0; K <= Segments; ++K)
		{
			const double S = static_cast<double>(K) / Segments;
			Points.Add(FMath::Lerp(Line.Start, Line.End, S) + Away * (Line.BulgeCm * 4.0 * S * (1.0 - S)));
			Along.Add(K == 0 ? 0.0 : Along[K - 1] + FVector::Dist(Points[K - 1], Points[K]));
		}
		const double Total = FMath::Max(Along.Last(), 1.0);
		const double Tilt = FMath::DegreesToRadians(FMath::Clamp(Line.TiltDeg, 0.0, 80.0));
		const double HalfWidth = 0.5 * FMath::Max(Line.WidthCm, 0.1);

		for (int32 K = 0; K <= Segments; ++K)
		{
			const double S = static_cast<double>(K) / Segments;
			const FVector Dir = (Chord + Away * (Line.BulgeCm * 4.0 * (1.0 - 2.0 * S))).GetSafeNormal();
			FVector Side = FVector(-Dir.Y, Dir.X, 0.0).GetSafeNormal();
			if (FVector::DotProduct(Side, Away) < 0.0)
			{
				Side = -Side;
			}
			const FVector Across = FMath::Cos(Tilt) * Side + FMath::Sin(Tilt) * FVector::UpVector; // near edge -> far edge
			const FVector Normal = FMath::Cos(Tilt) * FVector::UpVector - FMath::Sin(Tilt) * Side;  // up, toward the seat
			const double EndAlpha = Line.EndFadeCm > 0.0 ? FMath::Clamp(FMath::Min(Along[K], Total - Along[K]) / Line.EndFadeCm, 0.0, 1.0) : 1.0;
			const FLinearColor Color(1.f, 1.f, 1.f, static_cast<float>(EndAlpha));
			Out.Vertices.Add(Points[K] - Across * HalfWidth);
			Out.Vertices.Add(Points[K] + Across * HalfWidth);
			Out.UV0.Add(FVector2D(Along[K] / Total, 0.0));
			Out.UV0.Add(FVector2D(Along[K] / Total, 1.0));
			Out.Normals.Add(Normal);
			Out.Normals.Add(Normal);
			Out.Colors.Add(Color);
			Out.Colors.Add(Color);
			Out.Tangents.Add(FProcMeshTangent(Dir, false));
			Out.Tangents.Add(FProcMeshTangent(Dir, false));
		}

		// Near0, Near1, Far0 faces up when Cross(Away, Chord) points up. Worked flat, Away +X, Chord +Y: N0 (-h,0)
		// N1 (-h,dy) F0 (h,0): Cross(F0 - N0, N1 - N0) = Cross((2h,0,0), (0,dy,0)) = (0,0,2h*dy), up. Tilted, F0 - N0 is
		// 2h * (cos X + sin Z) and the cross is (cos Z - sin X) * 2h*dy: the Normal above. A chord the other way mirrors it.
		const bool bSwap = FVector::CrossProduct(Away, ChordFlat).Z < 0.0;
		for (int32 K = 0; K < Segments; ++K)
		{
			const int32 N0 = 2 * K;
			const int32 F0 = N0 + 1;
			const int32 N1 = N0 + 2;
			const int32 F1 = N0 + 3;
			if (bSwap)
			{
				Out.Triangles.Append({ N0, F0, N1, F0, F1, N1 });
			}
			else
			{
				Out.Triangles.Append({ N0, N1, F0, F0, N1, F1 });
			}
		}
		return true;
	}

	void Upload(UProceduralMeshComponent* Mesh, int32 SectionIndex, const FArrays& Arrays)
	{
		Mesh->CreateMeshSection_LinearColor(SectionIndex, Arrays.Vertices, Arrays.Triangles, Arrays.Normals, Arrays.UV0,
			Arrays.Colors, Arrays.Tangents, /*bCreateCollision*/ false);
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetCastShadow(false);
	}
} // namespace Detail

void BuildSheet(UProceduralMeshComponent* Mesh, int32 SectionIndex, const FShape& Shape)
{
	if (!Mesh)
	{
		return;
	}
	Detail::FArrays Arrays;
	Detail::MakeSheet(Shape, Arrays);
	Detail::Upload(Mesh, SectionIndex, Arrays);
}

void BuildRimLine(UProceduralMeshComponent* Mesh, int32 SectionIndex, const FRimLine& Line)
{
	Detail::FArrays Arrays;
	if (!Mesh || !Detail::MakeRimLine(Line, Arrays))
	{
		return;
	}
	Detail::Upload(Mesh, SectionIndex, Arrays);
}

double RadiusAt(const FShape& Shape, double HeightCm)
{
	// The bow: inward offset tan(Lean) * (h - bottom)^2 / (2 * height): vertical at the bottom, Lean at the top.
	const double Up = FMath::Clamp(HeightCm - Shape.BottomCm, 0.0, Detail::HeightOf(Shape));
	return Shape.RadiusCm - Detail::LeanTan(Shape) * Up * Up / (2.0 * Detail::HeightOf(Shape));
}

FVector UVToPoint(const FShape& Shape, const FVector2D& UV)
{
	const double Arc = Detail::ArcOf(Shape);
	const double Yaw = FMath::DegreesToRadians(Shape.FacingYawDeg - 0.5 * Arc + UV.X * Arc);
	const double H = Shape.BottomCm + Detail::HeightOf(Shape) * (1.0 - UV.Y);
	const double Radius = RadiusAt(Shape, H);
	return Shape.Center + FVector(Radius * FMath::Cos(Yaw), Radius * FMath::Sin(Yaw), H);
}

bool PointToUV(const FShape& Shape, const FVector& Point, FVector2D& OutUV)
{
	const FVector Rel = Point - Shape.Center;
	const double Arc = Detail::ArcOf(Shape);
	const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(Rel.Y, Rel.X));
	const double Delta = FMath::FindDeltaAngleDegrees(Shape.FacingYawDeg, Yaw); // -180..180, positive to the right
	OutUV = FVector2D((Delta + 0.5 * Arc) / Arc, (Shape.BottomCm + Detail::HeightOf(Shape) - Rel.Z) / Detail::HeightOf(Shape));
	return OutUV.X >= 0.0 && OutUV.X <= 1.0 && OutUV.Y >= 0.0 && OutUV.Y <= 1.0;
}

bool RayHit(const FShape& Shape, const FVector& Origin, const FVector& Direction, FVector2D& OutUV, double& OutDistanceCm)
{
	const FVector Dir = Direction.GetSafeNormal();
	const FVector P = Origin - Shape.Center;
	const double A = Dir.X * Dir.X + Dir.Y * Dir.Y; // the ray in plan: |P + t Dir|^2 = r^2
	if (A < 1e-9)
	{
		return false; // straight up or down never meets a vertical wall
	}
	const double B = 2.0 * (P.X * Dir.X + P.Y * Dir.Y);
	// With a lean the radius depends on the hit's height: a few fixed-point passes settle it (one pass when upright).
	const int32 Passes = Shape.LeanDeg > 0.0 ? 4 : 1;
	double Radius = Shape.RadiusCm;
	double Hit = -1.0;
	for (int32 Pass = 0; Pass < Passes; ++Pass)
	{
		const double C = P.X * P.X + P.Y * P.Y - Radius * Radius; // negative inside, the seat's case
		const double Disc = B * B - 4.0 * A * C;
		if (Disc < 0.0)
		{
			return false;
		}
		const double Root = FMath::Sqrt(Disc);
		const double Near = (-B - Root) / (2.0 * A); // negative when starting inside
		const double Far = (-B + Root) / (2.0 * A);
		Hit = Near > 0.0 ? Near : Far;
		if (Hit <= 0.0)
		{
			return false;
		}
		Radius = RadiusAt(Shape, P.Z + Hit * Dir.Z);
	}
	OutDistanceCm = Hit;
	return PointToUV(Shape, Origin + Hit * Dir, OutUV);
}

FVector2D AngularSizeDeg(const FShape& Shape, const FVector2D& UVMin, const FVector2D& UVMax, double EyeHeightCm)
{
	const double Height = Detail::HeightOf(Shape);
	const double HighCm = Shape.BottomCm + Height * (1.0 - FMath::Min(UVMin.Y, UVMax.Y));
	const double LowCm = Shape.BottomCm + Height * (1.0 - FMath::Max(UVMin.Y, UVMax.Y));
	const double HighAngle = FMath::Atan2(HighCm - EyeHeightCm, RadiusAt(Shape, HighCm));
	const double LowAngle = FMath::Atan2(LowCm - EyeHeightCm, RadiusAt(Shape, LowCm));
	return FVector2D(FMath::Abs(UVMax.X - UVMin.X) * Detail::ArcOf(Shape), FMath::RadiansToDegrees(HighAngle - LowAngle));
}

double CapHeightCm(double ArcMinutes, double DistanceCm)
{
	return DistanceCm * FMath::Tan(FMath::DegreesToRadians(ArcMinutes / 60.0));
}

void SelfCheck()
{
	auto Check = [](bool bOk, const TCHAR* What, double Value)
	{
		UE_LOG(LogBpStage, Log, TEXT("BpStage self-check %s: %s (%.4f)"), bOk ? TEXT("ok") : TEXT("FAILED"), What, Value);
		ensureMsgf(bOk, TEXT("BpStage self-check failed: %s (%.4f)"), What, Value);
	};

	const FShape Shape; // README concept 3: r 220, arc 120, 72..202 cm, centred on the eye's ground point at the origin
	const FVector Eye(0.0, 0.0, 115.0);
	FVector2D UV;
	double Distance = 0.0;

	Detail::FArrays Sheet;
	Detail::MakeSheet(Shape, Sheet);
	Check(Sheet.Triangles.Num() == 2 * 48 * 6, TEXT("sheet triangles x3 (48 columns, body row + top fade row)"), Sheet.Triangles.Num());
	Check(Detail::FacesNormal(Sheet, 0) && Detail::FacesNormal(Sheet, Sheet.Triangles.Num() / 3 - 1), TEXT("sheet faces its normals"), 0.0);
	Check(FVector::DotProduct(Sheet.Normals[24], Eye - Sheet.Vertices[24]) > 0.0, TEXT("sheet normal toward the eye"), 0.0);
	Check(FMath::IsNearlyEqual(Sheet.UV0[0].X, 0.0) && Sheet.Vertices[0].Y < 0.0, TEXT("U = 0 at the left end (Y < 0)"), Sheet.Vertices[0].Y);
	// Built before the check: MSVC evaluates the call's arguments right to left, so Rim.Normals[0] read inside the call ran
	// before MakeRimLine and indexed an empty array (the first run crashed here, 2026-11-10).
	Detail::FArrays Rim;
	const bool bRim = Detail::MakeRimLine(FRimLine(), Rim) && Rim.Normals.Num() > 0;
	const double RimX = bRim ? Rim.Normals[0].X : 0.0;
	Check(bRim && Detail::FacesNormal(Rim, 0) && Rim.Normals[0].Z > 0.0 && Rim.Normals[0].X < 0.0, TEXT("rim faces up and toward the seat"), RimX);

	const bool bBack = PointToUV(Shape, UVToPoint(Shape, FVector2D(0.25, 0.4)), UV);
	Check(bBack && UV.Equals(FVector2D(0.25, 0.4), 1e-6), TEXT("UV -> point -> UV"), UV.X);

	// Straight ahead from the eye: t = 220, U = 0.5, V = (202 - 115) / 130 = 0.6692.
	bool bHit = RayHit(Shape, Eye, FVector(1.0, 0.0, 0.0), UV, Distance);
	Check(bHit && FMath::IsNearlyEqual(UV.X, 0.5, 1e-6) && FMath::IsNearlyEqual(UV.Y, 87.0 / 130.0, 1e-6) && FMath::IsNearlyEqual(Distance, 220.0, 1e-3),
		TEXT("ahead: U 0.5, V 0.669, 220 cm"), Distance);
	// At the middle height (137 cm): direction (220, 0, 22), t = sqrt(220^2 + 22^2) = 221.10, U = 0.5, V = 0.5.
	bHit = RayHit(Shape, Eye, FVector(220.0, 0.0, 22.0), UV, Distance);
	Check(bHit && FMath::IsNearlyEqual(UV.X, 0.5, 1e-6) && FMath::IsNearlyEqual(UV.Y, 0.5, 1e-6), TEXT("mid height: U 0.5, V 0.5"), UV.Y);
	// Toward the left end, yaw -59: U = (-59 + 60) / 120 = 0.00833; yaw -61 is past the end: no hit.
	const double In = FMath::DegreesToRadians(-59.0);
	bHit = RayHit(Shape, Eye, FVector(FMath::Cos(In), FMath::Sin(In), 0.0), UV, Distance);
	Check(bHit && FMath::IsNearlyEqual(UV.X, 1.0 / 120.0, 1e-6), TEXT("left end: U 0.0083"), UV.X);
	const double Out = FMath::DegreesToRadians(-61.0);
	Check(!RayHit(Shape, Eye, FVector(FMath::Cos(Out), FMath::Sin(Out), 0.0), UV, Distance), TEXT("past the left end: no hit"), UV.X);
	// Above the top: toward (220, 0, 230) meets the wall at 230 cm, over 202: V < 0, no hit.
	Check(!RayHit(Shape, Eye, FVector(220.0, 0.0, 115.0), UV, Distance), TEXT("above the top: no hit"), UV.Y);

	// Whole sheet from the eye: 120 x (atan(87/220) + atan(43/220)) = 120 x 32.64 degrees.
	const FVector2D Whole = AngularSizeDeg(Shape, FVector2D(0.0, 0.0), FVector2D(1.0, 1.0), Eye.Z);
	Check(FMath::IsNearlyEqual(Whole.X, 120.0, 1e-6) && FMath::IsNearlyEqual(Whole.Y, 32.637, 0.01), TEXT("whole sheet 120 x 32.6 deg"), Whole.Y);
	// README: body caps 40' at 2.2 m are 2.6 cm, titles 60' are 3.8 cm.
	Check(FMath::IsNearlyEqual(CapHeightCm(40.0, 220.0), 2.560, 0.005), TEXT("40' cap at 220 cm"), CapHeightCm(40.0, 220.0));
	Check(FMath::IsNearlyEqual(CapHeightCm(60.0, 220.0), 3.840, 0.005), TEXT("60' cap at 220 cm"), CapHeightCm(60.0, 220.0));
}
} // namespace BpStage
