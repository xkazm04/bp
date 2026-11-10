// The projector's surface and the loupe (BpProjector.h). The console's own code places the sheet (BpConsole.cpp's PlaceConsole)
// and lays it out; this file only answers where a far surface stands, what a ray hits on it, and where a screen changed.
#include "BpProjector.h"

#include "BpTable.h"
#include "Engine/Texture2D.h"
#include "HAL/IConsoleManager.h"

namespace
{
	TAutoConsoleVariable<int32> CVarProjector(TEXT("bp.Projector"), 0,
		TEXT("The main screen (wave PJ1): 0 the desk console (default), 1 THE THROW (the open sheet far and large over the table's far rim), 2 THE LIGHT STAGE (not built yet: behaves as 1). Saved; SETTINGS > MAIN SCREEN."), ECVF_Default);
	TAutoConsoleVariable<float> CVarDistance(TEXT("bp.Projector.DistanceCm"), 260.f,
		TEXT("THE THROW: the sheet's distance from the seated eye, cm (150 to 500). 260 by default: at 300 the studio's shelf ladder stood in front of the sheet's left edge (cap/pj1-f3-y-kf011.png); 260 clears it at the same angular size."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWidth(TEXT("bp.Projector.WidthCm"), 208.f,
		TEXT("THE THROW: the sheet's width at DistanceCm, cm (100 to 400; its height is 9/16 of it; 208 at 260 cm is the README's 240 at 300: 43.5 x 25.3 degrees)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarLift(TEXT("bp.Projector.LiftCm"), 17.f,
		TEXT("THE THROW: the sheet's centre above the seated eye at DistanceCm, cm (-40 to 80)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarRoomDistance(TEXT("bp.Projector.RoomDistanceCm"), 200.f,
		TEXT("THE THROW in your own room (bp.Room 1, passthrough): the sheet comes to this distance, cm (120 to 400), at the same angular size, since a real wall may be nearer than 3 m."), ECVF_Default);

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
		return Throw;
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
