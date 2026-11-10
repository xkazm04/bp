// The projector's surface and the loupe (BpProjector.h). The console's own code places the sheet (BpConsole.cpp's PlaceConsole)
// and lays it out; this file only answers where a far surface stands, what a ray hits on it, and where a screen changed.
#include "BpProjector.h"

#include "BpGameMode.h"
#include "BpTable.h"
#include "Engine/Texture2D.h"
#include "HAL/IConsoleManager.h"

namespace
{
	TAutoConsoleVariable<int32> CVarProjector(TEXT("bp.Projector"), 0,
		TEXT("The main screen (wave PJ1): 0 the desk console (default), 1 THE THROW (the open sheet far and large over the table's far rim), 2 THE LIGHT STAGE (wave PJ2: a curved sheet of light around the seat, bp.Stage.*). Saved; SETTINGS > MAIN SCREEN."), ECVF_Default);
	TAutoConsoleVariable<float> CVarDistance(TEXT("bp.Projector.DistanceCm"), 260.f,
		TEXT("THE THROW: the sheet's distance from the seated eye, cm (150 to 500). 260 by default: at 300 the studio's shelf ladder stood in front of the sheet's left edge (cap/pj1-f3-y-kf011.png); 260 clears it at the same angular size."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWidth(TEXT("bp.Projector.WidthCm"), 208.f,
		TEXT("THE THROW: the sheet's width at DistanceCm, cm (100 to 400; its height is 9/16 of it; 208 at 260 cm is the README's 240 at 300: 43.5 x 25.3 degrees)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarLift(TEXT("bp.Projector.LiftCm"), 6.f,
		TEXT("THE THROW: the sheet's centre above the seated eye at DistanceCm, cm (-40 to 80). 6 by default (was 17: on the device the sheet's top sat at the edge of the lenses' view, the resting gaze being 10 degrees down)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarRoomDistance(TEXT("bp.Projector.RoomDistanceCm"), 200.f,
		TEXT("THE THROW in your own room (bp.Room 1, passthrough): the sheet comes to this distance, cm (120 to 400), at the same angular size, since a real wall may be nearer than 3 m."), ECVF_Default);

	// Wave PJ2, THE LIGHT STAGE (README concept 3): heights are above a floor 72 cm under the table top (the README's table), so
	// the stage's foot is the far rim's height whatever bp.TableHeightCm is.
	TAutoConsoleVariable<float> CVarStageRadius(TEXT("bp.Stage.RadiusCm"), 220.f,
		TEXT("THE LIGHT STAGE (bp.Projector 2): the curved sheet's radius around the seated eye, cm (150 to 400)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageArc(TEXT("bp.Stage.ArcDeg"), 120.f,
		TEXT("THE LIGHT STAGE: the arc it wraps around the seat, degrees (60 to 160); the outer 15 degrees each side fade out."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageBottom(TEXT("bp.Stage.BottomCm"), 60.f,
		TEXT("THE LIGHT STAGE: its foot, cm above a floor 72 cm under the table top (72 = the far rim's height; 40 to 140). 60 by default: -14 degrees from the seated eye, still above the far rim's -20, so the content can sit low (the device: the resting gaze is 10 degrees down)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageContentTop(TEXT("bp.Stage.ContentTopDeg"), 10.f,
		TEXT("THE LIGHT STAGE: the active sheet's top, degrees above the seated eye's horizon (-5 to 25; 10 is 20 above the resting gaze)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageTop(TEXT("bp.Stage.TopCm"), 202.f,
		TEXT("THE LIGHT STAGE: its top, cm on the same scale (bottom + 60 to 300); its last 25 cm fade out."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageCentre(TEXT("bp.Stage.CentreDeg"), 55.f,
		TEXT("THE LIGHT STAGE: the centre zone's widest (the active sheet, 16:9; its height from its foot to ContentTopDeg sets it first), degrees (30 to 70)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStageRoomRadius(TEXT("bp.Stage.RoomRadiusCm"), 180.f,
		TEXT("THE LIGHT STAGE in your own room (bp.Room 1): the radius comes in to this, cm (120 to 400), at the same angular size."), ECVF_Default);

	BpStage::FShape GStage;
	FBox2D GStageSheet(FVector2D(0.3, 0.2), FVector2D(0.7, 0.9));

	bool GFar = false;
	FVector GFarAim = FVector::ZeroVector;
	FVector GFarCentre = FVector::ZeroVector;

	/** THE THROW: one flat sheet facing the eye. */
	class FThrowSurface final : public IBpFarSurface
	{
	public:
		virtual const TCHAR* Name() const override { return TEXT("throw"); }
		virtual void Place(const FVector& EyeLocal, const FVector& Forward, bool bPassthrough, FVector& OutCentre, FRotator& OutFacing, FVector2D& OutSizeCm) const override
		{
			const float Far = FMath::Clamp(CVarDistance.GetValueOnGameThread(), 150.f, 500.f);
			const float D = bPassthrough ? FMath::Min(Far, FMath::Clamp(CVarRoomDistance.GetValueOnGameThread(), 120.f, 400.f)) : Far;
			// The angular size is kept when the sheet comes nearer (the room's distance): its size and lift scale with it.
			const float K = D / Far;
			const float W = FMath::Clamp(CVarWidth.GetValueOnGameThread(), 100.f, 400.f) * K;
			const float Lift = FMath::Clamp(CVarLift.GetValueOnGameThread(), -40.f, 80.f) * K;
			FVector Fwd = Forward;
			Fwd.Z = 0.0;
			Fwd = Fwd.GetSafeNormal();
			if (Fwd.IsNearlyZero()) Fwd = FVector::ForwardVector;
			OutCentre = EyeLocal + Fwd * D + FVector::UpVector * Lift;
			OutFacing = (EyeLocal - OutCentre).Rotation();
			OutSizeCm = FVector2D(W, W * 9.f / 16.f);
		}
		virtual bool RayToUv(const FTransform& Pose, const FVector2D& SizeCm, const FVector& Origin, const FVector& Dir, FVector2D& OutUv) const override
		{
			const FVector Normal = Pose.GetUnitAxis(EAxis::X);
			const double Denom = FVector::DotProduct(Dir, Normal);
			if (Denom >= -KINDA_SMALL_NUMBER) return false;
			const double Along = FVector::DotProduct(Pose.GetLocation() - Origin, Normal) / Denom;
			if (Along < 0.0) return false;
			// A widget's mapping: its x is -local Y, its y -local Z, from its centre.
			const FVector Local = Pose.InverseTransformPositionNoScale(Origin + Dir * Along);
			OutUv = FVector2D(-Local.Y / SizeCm.X + 0.5, -Local.Z / SizeCm.Y + 0.5);
			return OutUv.X >= 0.0 && OutUv.Y >= 0.0 && OutUv.X <= 1.0 && OutUv.Y <= 1.0;
		}
		virtual FVector UvToWorld(const FTransform& Pose, const FVector2D& SizeCm, const FVector2D& Uv) const override
		{
			return Pose.TransformPositionNoScale(FVector(0.0, -(Uv.X - 0.5) * SizeCm.X, -(Uv.Y - 0.5) * SizeCm.Y));
		}
	};

	/** THE LIGHT STAGE (wave PJ2): a curved sheet of light around the seat (BpStageMesh.h). Its pose is the seated eye's ground
	 *  point facing the table's forward; the active sheet is its centre zone, and a sheet UV outside 0..1 is still on the stage
	 *  (the flanks: the ray is taken, no control is there). */
	class FStageSurface final : public IBpFarSurface
	{
	public:
		virtual const TCHAR* Name() const override { return TEXT("stage"); }
		virtual void Place(const FVector& EyeLocal, const FVector& Forward, bool bPassthrough, FVector& OutCentre, FRotator& OutFacing, FVector2D& OutSizeCm) const override
		{
			// The README's table is 72 cm high and the seated eye 43 cm over its top: 115 cm over the stage's floor.
			const double EyeH = 72.0 + ABpGameMode::TargetEyeAboveTopCm;
			const double R = FMath::Clamp(CVarStageRadius.GetValueOnGameThread(), 150.f, 400.f);
			const double RoomR = FMath::Clamp(CVarStageRoomRadius.GetValueOnGameThread(), 120.f, 400.f);
			// Your room: a real wall may be nearer than 2.2 m; the stage comes in and keeps its angular size (scaled about the eye).
			const double K = bPassthrough ? FMath::Min(1.0, RoomR / R) : 1.0;
			const double Bottom = FMath::Clamp(CVarStageBottom.GetValueOnGameThread(), 40.f, 140.f);
			const double Top = FMath::Clamp(static_cast<double>(CVarStageTop.GetValueOnGameThread()), Bottom + 60.0, Bottom + 300.0);
			BpStage::FShape Shape;
			Shape.RadiusCm = R * K;
			Shape.ArcDeg = FMath::Clamp(CVarStageArc.GetValueOnGameThread(), 60.f, 160.f);
			Shape.BottomCm = EyeH + (Bottom - EyeH) * K;
			Shape.TopCm = EyeH + (Top - EyeH) * K;
			Shape.TopFadeCm = 25.0 * K;
			Shape.EdgeFadeDeg = 15.0;
			Shape.Columns = FMath::Clamp(FMath::RoundToInt(Shape.ArcDeg / 2.5), 24, 64);
			GStage = Shape;
			// The centre zone (the active sheet, 16:9). On the device the wall's top sat at the edge of the lenses' view (the seated
			// gaze rests 10 degrees down): the content's top is ContentTopDeg above the horizon (10: 20 above the resting gaze) and
			// its foot 4 cm over the stage's; the stage above it is glow and the top fade. Narrowed to CentreDeg at most.
			const double ArcLen = Shape.RadiusCm * FMath::DegreesToRadians(Shape.ArcDeg);
			const double Height = Shape.TopCm - Shape.BottomCm;
			const double ContentTop = FMath::Min(Shape.TopCm - Shape.TopFadeCm, EyeH + Shape.RadiusCm * FMath::Tan(FMath::DegreesToRadians(FMath::Clamp(CVarStageContentTop.GetValueOnGameThread(), -5.f, 25.f))));
			const double ContentBottom = Shape.BottomCm + 4.0 * K;
			double H = FMath::Max(20.0, ContentTop - ContentBottom);
			double W = H * 16.0 / 9.0;
			const double MaxW = Shape.RadiusCm * FMath::DegreesToRadians(FMath::Clamp(CVarStageCentre.GetValueOnGameThread(), 30.f, FMath::Min(70.f, static_cast<float>(Shape.ArcDeg) - 30.f)));
			if (W > MaxW) { W = MaxW; H = W * 9.0 / 16.0; }
			const double V1 = (Shape.TopCm - ContentBottom) / Height;
			GStageSheet = FBox2D(FVector2D(0.5 - 0.5 * W / ArcLen, V1 - H / Height), FVector2D(0.5 + 0.5 * W / ArcLen, V1));
			FVector Fwd = Forward;
			Fwd.Z = 0.0;
			Fwd = Fwd.GetSafeNormal();
			if (Fwd.IsNearlyZero()) Fwd = FVector::ForwardVector;
			OutCentre = FVector(EyeLocal.X, EyeLocal.Y, EyeLocal.Z - EyeH);
			OutFacing = FRotator(0.0, Fwd.Rotation().Yaw, 0.0);
			OutSizeCm = FVector2D(W, H);
		}
		virtual bool RayToUv(const FTransform& Pose, const FVector2D& SizeCm, const FVector& Origin, const FVector& Dir, FVector2D& OutUv) const override
		{
			FVector2D StageUv;
			double Distance = 0.0;
			if (!BpStage::RayHit(GStage, Pose.InverseTransformPositionNoScale(Origin), Pose.InverseTransformVectorNoScale(Dir), StageUv, Distance)) return false;
			OutUv = (StageUv - GStageSheet.Min) / GStageSheet.GetSize();
			return true;
		}
		virtual FVector UvToWorld(const FTransform& Pose, const FVector2D& SizeCm, const FVector2D& Uv) const override
		{
			return Pose.TransformPositionNoScale(BpStage::UVToPoint(GStage, GStageSheet.Min + Uv * GStageSheet.GetSize()));
		}
	};

	FAutoConsoleCommand GStageSelfCheck(TEXT("BpStage.SelfCheck"), TEXT("Wave PJ2: runs THE LIGHT STAGE's geometry self-check (BpStageMesh.cpp) and logs each result."),
		FConsoleCommandDelegate::CreateStatic(&BpStage::SelfCheck));

	/** A screen's grey thumbnail, kept while its texture lives. */
	struct FThumb
	{
		TArray<uint8> Grey;
		int32 W = 0, H = 0;
	};
	TMap<TWeakObjectPtr<UTexture2D>, FThumb> GThumbs;
	TMap<FString, FBox2f> GRegions;
	constexpr int32 ThumbW = 160;
}

namespace BpProjector
{
	int32 Mode() { return FMath::Clamp(CVarProjector.GetValueOnGameThread(), 0, 2); }

	const IBpFarSurface& Surface()
	{
		static const FThrowSurface Throw;
		static const FStageSurface Stage;
		if (Mode() == 2) return Stage;
		return Throw;
	}

	const BpStage::FShape& StageShape() { return GStage; }
	FBox2D StageSheetUv() { return GStageSheet; }

	FVector2D StageLayoutSize(float SheetLayoutW)
	{
		// The sheet's layout px per cm, over the whole arc and height: square in cm, as the mesh's UV is.
		const double PerCm = SheetLayoutW / FMath::Max(1.0, GStageSheet.GetSize().X * GStage.RadiusCm * FMath::DegreesToRadians(GStage.ArcDeg));
		return FVector2D(GStage.RadiusCm * FMath::DegreesToRadians(GStage.ArcDeg) * PerCm, (GStage.TopCm - GStage.BottomCm) * PerCm);
	}

	FIntPoint StageDrawSize(const FVector2D& StageLayout)
	{
		const double S = FMath::Min(4096.0 / FMath::Max(1.0, StageLayout.X), 1024.0 / FMath::Max(1.0, StageLayout.Y));
		// The width on a 16 px step, the height at the same scale (so a texel is square and the layout maps exactly).
		const int32 W = FMath::Clamp(FMath::FloorToInt(StageLayout.X * S / 16.0) * 16, 16, 4096);
		return FIntPoint(W, FMath::Clamp(FMath::FloorToInt(StageLayout.Y * W / FMath::Max(1.0, StageLayout.X)), 16, 1024));
	}

	FString StageKey()
	{
		return FString::Printf(TEXT("%.1f %.1f %.1f %.1f %.1f %d"), GStage.RadiusCm, GStage.ArcDeg, GStage.BottomCm, GStage.TopCm, GStage.TopFadeCm, GStage.Columns);
	}

	FString StageCvars()
	{
		return FString::Printf(TEXT("%g|%g|%g|%g|%g|%g"), CVarStageRadius.GetValueOnGameThread(), CVarStageArc.GetValueOnGameThread(), CVarStageBottom.GetValueOnGameThread(),
			CVarStageTop.GetValueOnGameThread(), CVarStageCentre.GetValueOnGameThread(), CVarStageRoomRadius.GetValueOnGameThread()) + FString::Printf(TEXT("|%g"), CVarStageContentTop.GetValueOnGameThread());
	}

	FIntPoint DrawSizeFor(const FVector2D& SizeCm, float DistanceCm)
	{
		const float Deg = 2.f * FMath::RadiansToDegrees(FMath::Atan2(SizeCm.X * 0.5f, FMath::Max(1.f, DistanceCm)));
		const int32 W = FMath::Clamp(FMath::RoundToInt(Deg * 36.f / 16.f) * 16, 640, 2048);
		return FIntPoint(W, FMath::RoundToInt(W * SizeCm.Y / FMath::Max(1.0, SizeCm.X)));
	}

	void SetFar(bool bFar, const FVector& AimLocal)
	{
		GFar = bFar;
		GFarAim = AimLocal;
	}
	bool IsFar() { return GFar; }
	FVector FarAimLocal() { return GFarAim; }
	void SetFarCentre(const FVector& CentreLocal) { GFarCentre = CentreLocal; }
	FVector FarCentreLocal() { return GFarCentre; }

	float ArcMinutes(float Cm, float DistanceCm) { return FMath::RadiansToDegrees(FMath::Atan2(Cm, FMath::Max(1.f, DistanceCm))) * 60.f; }

	TArray<uint8> MakeThumb(const uint8* Bgra, int32 W, int32 H, int32& OutTW, int32& OutTH)
	{
		TArray<uint8> Out;
		OutTW = OutTH = 0;
		if (!Bgra || W <= 0 || H <= 0) return Out;
		OutTW = FMath::Min(ThumbW, W);
		OutTH = FMath::Max(1, FMath::RoundToInt(static_cast<float>(H) * OutTW / W));
		Out.SetNumZeroed(OutTW * OutTH);
		for (int32 Y = 0; Y < OutTH; ++Y)
		{
			const int32 Y0 = Y * H / OutTH, Y1 = FMath::Max(Y0 + 1, (Y + 1) * H / OutTH);
			for (int32 X = 0; X < OutTW; ++X)
			{
				const int32 X0 = X * W / OutTW, X1 = FMath::Max(X0 + 1, (X + 1) * W / OutTW);
				uint32 Sum = 0, N = 0;
				// A box average, every other pixel (enough for a map of where things are).
				for (int32 SY = Y0; SY < Y1; SY += 2)
				{
					for (int32 SX = X0; SX < X1; SX += 2)
					{
						const uint8* P = Bgra + (static_cast<int64>(SY) * W + SX) * 4;
						Sum += (P[0] + 2u * P[1] + P[2]) / 4u;
						++N;
					}
				}
				Out[Y * OutTW + X] = static_cast<uint8>(N ? Sum / N : 0);
			}
		}
		return Out;
	}

	void KeepThumb(UTexture2D* Texture, TArray<uint8>&& Thumb, int32 TW, int32 TH)
	{
		for (auto It = GThumbs.CreateIterator(); It; ++It) if (!It.Key().IsValid()) It.RemoveCurrent();
		if (!Texture || Thumb.Num() != TW * TH || TW <= 0) return;
		FThumb& Kept = GThumbs.FindOrAdd(Texture);
		Kept.Grey = MoveTemp(Thumb);
		Kept.W = TW;
		Kept.H = TH;
	}

	bool LoupeRegion(const UTexture2D* Before, const UTexture2D* After, float Aspect, float WidthFrac, FBox2f& OutUv)
	{
		const FThumb* A = Before ? GThumbs.Find(TWeakObjectPtr<UTexture2D>(const_cast<UTexture2D*>(Before))) : nullptr;
		const FThumb* B = After ? GThumbs.Find(TWeakObjectPtr<UTexture2D>(const_cast<UTexture2D*>(After))) : nullptr;
		if (!A || (After && !B)) return false;
		const FString Key = FString::Printf(TEXT("%p|%p|%.3f|%.3f"), Before, After, Aspect, WidthFrac);
		if (const FBox2f* Cached = GRegions.Find(Key)) { OutUv = *Cached; return true; }
		const int32 W = A->W, H = A->H;
		// The score: where the pair differs (After sampled on Before's grid), or one screen's horizontal edges (its words).
		TArray<int32> Score;
		Score.SetNumZeroed(W * H);
		int32 Hot = 0;
		for (int32 Y = 0; Y < H; ++Y)
		{
			for (int32 X = 0; X < W; ++X)
			{
				const int32 G = A->Grey[Y * W + X];
				int32 S = 0;
				if (B && X + 1 < W)
				{
					// Where the words changed, not where a fill did: the pair's edge maps differ (a button turning blue is two
					// edges; a field's value changing is many).
					const int32 BX = FMath::Min(B->W - 1, X * B->W / W), BY = FMath::Min(B->H - 1, Y * B->H / H), BX1 = FMath::Min(B->W - 1, (X + 1) * B->W / W);
					const bool EdgeA = FMath::Abs(G - A->Grey[Y * W + X + 1]) > 24;
					const bool EdgeB = FMath::Abs(B->Grey[BY * B->W + BX] - B->Grey[BY * B->W + BX1]) > 24;
					S = EdgeA != EdgeB ? 1 : 0;
				}
				else if (X + 1 < W)
				{
					S = FMath::Abs(G - A->Grey[Y * W + X + 1]) > 24 ? 1 : 0;
				}
				Score[Y * W + X] = S;
				Hot += S;
			}
		}
		// The window: WidthFrac of the width, its height from the loupe's aspect; the one holding the most score wins (a summed
		// area table, every placement). Nothing differs: the window is Before's densest words instead.
		if (B && Hot < 4) return LoupeRegion(Before, nullptr, Aspect, WidthFrac, OutUv);
		const int32 WW = FMath::Clamp(FMath::RoundToInt(W * WidthFrac), 4, W);
		const int32 WH = FMath::Clamp(FMath::RoundToInt(WW / FMath::Max(0.2f, Aspect)), 2, H);
		TArray<int32> Sat;
		Sat.SetNumZeroed((W + 1) * (H + 1));
		for (int32 Y = 0; Y < H; ++Y)
		{
			int32 Row = 0;
			for (int32 X = 0; X < W; ++X)
			{
				Row += Score[Y * W + X];
				Sat[(Y + 1) * (W + 1) + X + 1] = Sat[Y * (W + 1) + X + 1] + Row;
			}
		}
		int32 Best = -1, BX = 0, BY = 0;
		// Below the screen's top quarter (an app's header and page title: the largest words on it already, and where two
		// generated screens differ most only because their framing moved).
		for (int32 Y = FMath::Min(H / 4, H - WH); Y + WH <= H; ++Y)
		{
			for (int32 X = 0; X + WW <= W; ++X)
			{
				const int32 Sum = Sat[(Y + WH) * (W + 1) + X + WW] - Sat[Y * (W + 1) + X + WW] - Sat[(Y + WH) * (W + 1) + X] + Sat[Y * (W + 1) + X];
				if (Sum > Best) { Best = Sum; BX = X; BY = Y; }
			}
		}
		OutUv = FBox2f(FVector2f(static_cast<float>(BX) / W, static_cast<float>(BY) / H), FVector2f(static_cast<float>(BX + WW) / W, static_cast<float>(BY + WH) / H));
		GRegions.Add(Key, OutUv);
		UE_LOG(LogBpTable, Log, TEXT("BpProjector: loupe %s: uv (%.3f, %.3f) to (%.3f, %.3f), %d of %d cells hot in it (%d in the screen), thumbs %dx%d"),
			B ? TEXT("the pair's change") : TEXT("the screen's densest words"), OutUv.Min.X, OutUv.Min.Y, OutUv.Max.X, OutUv.Max.Y, Best, WW * WH, Hot, W, H);
		return true;
	}
}
