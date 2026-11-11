// The lamp travels (the companion moves round the table). When it presents something (a tour step, an answer about a room, a
// scan) it goes to a station near that place, then turns to it: an eased ride along the far and side edges with a slight
// arc and a whole-body lean, about a second, then a settle. The stations are a fixed row along the far and side edges, never
// the seat's near zone, the person's sight lines or the hands' working area over the paper: a ride follows the row, never a chord across the table.
// The static SM_LampAgent stays (decision D2 of companion-lamp-plan.md, the reason in this wave's report): it leans and turns whole.
// Reduced motion: the lamp dims out and appears at the station, a short cut, no travel. Nothing here ticks at rest (TickLampTravel
// runs under TickSwitch only while a ride or a settle is in progress), and no draw is added.
#include "BpTable.h"

#include "BpLink.h"
#include "BpProjector.h"
#include "Components/PrimitiveComponent.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "HAL/IConsoleManager.h"
#include "TimerManager.h"

namespace
{
	TAutoConsoleVariable<int32> CVarLampTravel(TEXT("bp.LampTravel"), 1, TEXT("The lamp travels to a station near what it presents: 1 travels, 0 it stays home and only turns."));
	TAutoConsoleVariable<float> CVarLampTravelS(TEXT("bp.LampTravelS"), 1.f, TEXT("One ride's time in seconds, 0.3 to 3 (a long ride scales up to 1.5 times)."));
	TAutoConsoleVariable<float> CVarLampArcCm(TEXT("bp.LampArcCm"), 7.f, TEXT("The ride's arc height over the straight line, 0 to 25 cm."));
	TAutoConsoleVariable<float> CVarLampLeanDeg(TEXT("bp.LampLeanDeg"), 6.f, TEXT("The whole-body lean into the ride at its fastest, 0 to 20 degrees."));

	/** The ride's rail along the far and side edges, the table's axes (X far, Y right), as hand-placed points: a Catmull-Rom
	 *  through them is the rail. Near limit X 22 keeps every station out of the seat's near zone; X 40 stands at the far edge. */
	const FVector2D RailPoints[] = { { 22.0, -72.0 }, { 34.0, -72.0 }, { 40.0, -56.0 }, { 40.0, -24.0 }, { 40.0, 24.0 }, { 40.0, 56.0 }, { 34.0, 72.0 }, { 22.0, 72.0 } };
	/** The stations, as indexes into RailPoints: left side, far left, far centre, far right, right side. */
	const int32 StationRail[] = { 0, 2, 3, 5, 7 };
	const int32 StationCount = UE_ARRAY_COUNT(StationRail);
	/** A station within this of the best one is near enough: the lamp does not fidget between neighbours. */
	constexpr double StationHysteresisCm = 25.0;
	/** Room-mode: only the left two (the deck stands dead ahead and its spines to the right, the far centre behind it). */
	constexpr int32 RoomStations = 2;

	constexpr int32 RailSamplesPerSpan = 12;

	FVector2D RailAt(double T)
	{
		// Catmull-Rom across the points; the path uses evenly many samples per span.
		const int32 N = UE_ARRAY_COUNT(RailPoints);
		const int32 I = FMath::Clamp(static_cast<int32>(T), 0, N - 2);
		const double U = FMath::Clamp(T - I, 0.0, 1.0);
		const FVector2D P0 = RailPoints[FMath::Max(I - 1, 0)], P1 = RailPoints[I], P2 = RailPoints[I + 1], P3 = RailPoints[FMath::Min(I + 2, N - 1)];
		const double U2 = U * U, U3 = U2 * U;
		return 0.5 * (2.0 * P1 + (P2 - P0) * U + (2.0 * P0 - 5.0 * P1 + 4.0 * P2 - P3) * U2 + (3.0 * P1 - P0 - 3.0 * P2 + P3) * U3);
	}

	/** A ride's position along its length by time: a smootherstep with rest at both ends, the arc's weight, and the lean's. */
	double Smoother(double A) { A = FMath::Clamp(A, 0.0, 1.0); return A * A * A * (A * (A * 6.0 - 15.0) + 10.0); }

	bool TravelReduced()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}

	void WithLampTables(UWorld* World, TFunctionRef<void(ABpTable&)> Fn)
	{
		if (!World) return;
		for (TActorIterator<ABpTable> It(World); It; ++It) Fn(**It);
	}

	FAutoConsoleCommandWithWorldAndArgs CmdLampStation(TEXT("BpLamp.Station"),
		TEXT("BpLamp.Station <0..4|home> [x y]: the lamp rides to that station (left side, far left, far centre, far right, right side) or home, facing paper point x y (table cm) when given."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0) return;
			WithLampTables(World, [&Args](ABpTable& T)
			{
				if (Args[0].Equals(TEXT("home"), ESearchCase::IgnoreCase)) { T.LampGoHome(TEXT("console")); return; }
				const FVector2D Aim = Args.Num() > 2 ? FVector2D(FCString::Atod(*Args[1]), FCString::Atod(*Args[2])) : FVector2D::ZeroVector;
				T.LampToStation(FCString::Atoi(*Args[0]), FVector(Aim, T.GetPaperZ()));
			});
		}));
}

FVector ABpTable::LampHomeAt(double& OutYaw) const
{
	const FTransform& Table = GetActorTransform();
	const FVector RestAt = Table.InverseTransformPosition(LampRest.GetLocation());
	const double RestYaw = (Table.GetRotation().Inverse() * LampRest.GetRotation()).Rotator().Yaw;
	const FVector RoomAt(LampRoomXCm, LampRoomYCm, RestAt.Z - LampRoomDropCm);
	const double RoomYaw = LampYawToward(RoomAt, FMath::Lerp(DeckPose(0.f, 0.f).GetLocation(), EyeLocal(), static_cast<double>(LampRoomFaceShare)));
	const float A = FMath::Clamp(LampAway, 0.f, 1.f);
	const double E = A * A * (3.f - 2.f * A);
	OutYaw = RestYaw + FMath::FindDeltaAngleDegrees(RestYaw, RoomYaw) * E;
	return FMath::Lerp(RestAt, RoomAt, E);
}

double ABpTable::GetPaperZ() const
{
	return PlacedHeightCm - GlassRecessCm;
}

FVector ABpTable::LampStationAt(int32 Station, const FVector& HomeAt) const
{
	const FVector2D Rail = RailPoints[StationRail[FMath::Clamp(Station, 0, StationCount - 1)]];
	const double RestZ = GetActorTransform().InverseTransformPosition(LampRest.GetLocation()).Z;
	return FVector(Rail, RestZ - LampRoomDropCm);
}

void ABpTable::LampStationsLocal(TArray<FVector>& Out) const
{
	if (!Lamp.IsValid()) return;
	double Yaw = 0.0;
	const FVector Home = LampHomeAt(Yaw);
	for (int32 Index = 0; Index < StationCount; ++Index) Out.Add(LampStationAt(Index, Home));
}

int32 ABpTable::PickLampStation(const FVector& TargetLocal) const
{
	double Yaw = 0.0;
	const FVector Home = LampHomeAt(Yaw);
	const int32 Count = RoomModeId.IsEmpty() ? StationCount : RoomStations;
	// The station with the shortest throw to the target: its hood still faces it from the edge.
	int32 Best = 0;
	double BestDist = TNumericLimits<double>::Max();
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const double D = FVector2D::Distance(FVector2D(LampStationAt(Index, Home)), FVector2D(TargetLocal));
		if (D < BestDist) { BestDist = D; Best = Index; }
	}
	// Staying at a neighbour no further than the hysteresis saves a fidget.
	if (LampStation != INDEX_NONE && LampStation < Count)
	{
		const double Here = FVector2D::Distance(FVector2D(LampStationAt(LampStation, Home)), FVector2D(TargetLocal));
		if (Here <= BestDist + StationHysteresisCm) return LampStation;
	}
	return Best;
}

void ABpTable::PresentLamp(const FVector& TargetLocal, const TCHAR* Why)
{
	if (!Lamp.IsValid()) return;
	if (CVarLampTravel.GetValueOnGameThread() == 0)
	{
		// Off: it stays where it is and turns, as it always did.
		LampLookAt = TargetLocal;
		LampLookTarget = 1.f;
		SetActorTickInterval(0.f);
		return;
	}
	LampToStation(PickLampStation(TargetLocal), TargetLocal, Why);
}

void ABpTable::LampToStation(int32 Station, const FVector& TargetLocal, const TCHAR* Why)
{
	if (!Lamp.IsValid()) return;
	Station = FMath::Clamp(Station, 0, StationCount - 1);
	// G2 (cap\u1-after-decision.png, his hand on the wall's HOLD row): with a sheet on the far wall the stand-up's "the lamp
	// beside the room" sent him to a station on the plan (station 2, table (40, -60), beside payments), where PlaceLamp's
	// clear-of-the-sheet stand (LampFootClearOfSheet) does not apply; there he faces the person after an answer (the nod) and
	// his arm, out of his side, crosses the sheet's left column from the seat. While a sheet is far he keeps that clear stand
	// and points with his beam: no station ride (the raised room still shows where); one he is at already ends.
	if (BpProjector::IsFar() && (RoomModeId.IsEmpty() || bDeckWallPoint))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLamp: no ride to station %d (%s): a sheet is on the far wall, Glim keeps his stand clear of it"), Station, Why);
		if (bLampAtStation || LampTravelT >= 0.f) LampGoHome(TEXT("a sheet is far"));
		return;
	}
	double HomeYaw = 0.0;
	const FVector Home = LampHomeAt(HomeYaw);
	const FVector Base = LampStationAt(Station, Home);
	LampFaceTarget = TargetLocal;
	// V7: beside the console's slot rather than behind it, from the start of the ride (TickLampStep judges it again there).
	const double Aside = LampStation == Station && bLampAtStation ? LampAsideWant : StationAside(Base, TargetLocal.Y);
	const FVector To = Base + FVector(0.0, Aside, 0.0);
	const double ToYaw = LampYawToward(To, TargetLocal);
	// Already there: the lamp only turns (LampYawToward's own ride is the look).
	if (LampStation == Station && LampTravelT < 0.f && bLampAtStation)
	{
		LampLookAt = TargetLocal;
		LampLookTarget = 1.f;
		SetActorTickInterval(0.f);
		return;
	}
	LampStation = Station;
	LampAsideCm = LampAsideWant = Aside;
	bLampToHome = false;
	// The caption on the lamp's side of the site plan (in a room the deck stands right of centre: it keeps its left place).
	LampCaptionY = RoomModeId.IsEmpty() && Station >= 3 ? -CaptionYCm : CaptionYCm;
	GetWorldTimerManager().ClearTimer(LampHomeTimer);
	LampLook = 0.f;
	LampLookTarget = 0.f;
	StartLampRide(To, ToYaw, FString::Printf(TEXT("station %d (%s)"), Station, Why));
}

void ABpTable::LampGoHome(const TCHAR* Why)
{
	if (!Lamp.IsValid()) return;
	GetWorldTimerManager().ClearTimer(LampHomeTimer);
	if (!bLampAtStation && LampTravelT < 0.f) return;
	double HomeYaw = 0.0;
	const FVector Home = LampHomeAt(HomeYaw);
	LampStation = INDEX_NONE;
	LampAsideCm = LampAsideWant = 0.0;
	LampCaptionY = CaptionYCm;
	LampFaceTarget = FVector::ZeroVector;
	bLampToHome = true;
	LampLook = 0.f;
	LampLookTarget = 0.f;
	StartLampRide(Home, HomeYaw, FString::Printf(TEXT("home (%s)"), Why));
}

void ABpTable::StartLampRide(const FVector& To, double ToYaw, const FString& What)
{
	const FTransform& Table = GetActorTransform();
	const FVector From = Table.InverseTransformPosition(Lamp->GetActorLocation());
	const double FromYaw = (Table.GetRotation().Inverse() * Lamp->GetActorQuat()).Rotator().Yaw;
	// The path: from where the lamp stands, onto the rail at its nearest sample, along the rail to the sample nearest the
	// goal, then onto the goal. Short hops (home to a station beside it) barely touch the rail.
	LampPath.Reset();
	LampPathLen.Reset();
	const int32 Samples = (UE_ARRAY_COUNT(RailPoints) - 1) * RailSamplesPerSpan;
	const auto Nearest = [Samples](const FVector2D& P)
	{
		int32 Best = 0;
		double BestD = TNumericLimits<double>::Max();
		for (int32 Index = 0; Index <= Samples; ++Index)
		{
			const double D = FVector2D::DistSquared(RailAt(static_cast<double>(Index) / RailSamplesPerSpan), P);
			if (D < BestD) { BestD = D; Best = Index; }
		}
		return Best;
	};
	const int32 Start = Nearest(FVector2D(From));
	const int32 End = Nearest(FVector2D(To));
	LampPath.Add(FVector2D(From));
	const int32 Step = End >= Start ? 1 : -1;
	for (int32 Index = Start; Index != End + Step; Index += Step) LampPath.Add(RailAt(static_cast<double>(Index) / RailSamplesPerSpan));
	LampPath.Add(FVector2D(To));
	double Sum = 0.0;
	LampPathLen.Add(0.0);
	for (int32 Index = 1; Index < LampPath.Num(); ++Index)
	{
		Sum += FVector2D::Distance(LampPath[Index - 1], LampPath[Index]);
		LampPathLen.Add(Sum);
	}
	LampRideFromZ = From.Z;
	LampRideToZ = To.Z;
	LampRideFromYaw = FromYaw;
	LampRideToYaw = FromYaw + FMath::FindDeltaAngleDegrees(FromYaw, ToYaw);
	LampRideTo = To;
	LampRideHome = bLampToHome ? To : FVector::ZeroVector;
	const float Base = FMath::Clamp(CVarLampTravelS.GetValueOnGameThread(), 0.3f, 3.f);
	// A ride across the whole table takes longer than a hop, a long one at most 1.5 times the base.
	LampRideS = Base * FMath::Lerp(0.8f, 1.5f, FMath::Clamp(static_cast<float>(Sum) / 200.f, 0.f, 1.f));
	bLampAtStation = false;
	LampTravelT = 0.f;
	LampSettleT = -1.f;
	const bool bReduced = TravelReduced();
	bLampRideCut = bReduced;
	if (bLampMovable == false && Lamp->GetRootComponent() && Lamp->GetRootComponent()->Mobility != EComponentMobility::Movable)
	{
		Lamp->GetRootComponent()->SetMobility(EComponentMobility::Movable);
		for (const TWeakObjectPtr<AActor>& Each : LampGroup) if (Each.IsValid() && Each->GetRootComponent()) Each->GetRootComponent()->SetMobility(EComponentMobility::Movable);
		bLampMovable = true;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: ride to %s: from (%.0f, %.0f) to (%.0f, %.0f) along %.0f cm in %.2f s%s"), *What, From.X, From.Y, To.X, To.Y, Sum, LampRideS, bReduced ? TEXT(" (reduced motion: a cut)") : TEXT(""));
	SetActorTickInterval(0.f);
}

void ABpTable::ArriveLamp()
{
	LampTravelT = -1.f;
	bLampRideCut = false;
	if (bLampToHome)
	{
		bLampToHome = false;
		bLampAtStation = false;
		LampLook = 0.f;
		UE_LOG(LogBpTable, Log, TEXT("BpLamp: home"));
	}
	else
	{
		bLampAtStation = true;
		// The station itself; PlaceLamp adds the step beside the console's slot (LampAsideCm).
		LampStationAtLocal = LampRideTo - FVector(0.0, LampAsideCm, 0.0);
		LampStationYaw = LampRideToYaw;
		// Already facing it: the look is complete, and it says what it is pointing at.
		LampLookAt = LampFaceTarget;
		LampLook = 1.f;
		LampLookTarget = 1.f;
		// A presented thing with no caption (a scan) has no caption clock to send the lamp back; the timer does it.
		if (LampCaptionClock <= 0.f) GetWorldTimerManager().SetTimer(LampHomeTimer, FTimerDelegate::CreateWeakLambda(this, [this]() { if (LampCaptionClock <= 0.f && !bTheatreLamp) LampGoHome(TEXT("idle")); }), LampStationIdleS, false);
		UE_LOG(LogBpTable, Log, TEXT("BpLamp: at station %d"), LampStation);
	}
}

bool ABpTable::TickLampTravel(float DeltaSeconds)
{
	if (LampSettleT >= 0.f)
	{
		LampSettleT += DeltaSeconds;
		if (LampSettleT >= LampSettleS) { LampSettleT = -1.f; LampLeanAxis = FVector::ZeroVector; LampLeanNow = 0.f; }
		PlaceLamp();
		ApplyLampWidgets();
		return true;
	}
	if (LampTravelT < 0.f) return false;
	LampTravelT += DeltaSeconds;
	if (bLampRideCut)
	{
		// Reduced motion: hidden for a beat at the start, shown at the place. No path, no lean.
		const bool bShow = LampTravelT >= LampCutS;
		SetLampHidden(!bShow);
		if (!bShow) return true;
		ArriveLamp();
		PlaceLamp();
		ApplyLampWidgets();
		return true;
	}
	if (LampTravelT >= LampRideS)
	{
		ArriveLamp();
		LampSettleT = 0.f;
		PlaceLamp();
		ApplyLampWidgets();
		return true;
	}
	PlaceLamp();
	ApplyLampWidgets();
	return true;
}

void ABpTable::SetLampHidden(bool bHide)
{
	if (bLampHidden == bHide || !Lamp.IsValid()) return;
	bLampHidden = bHide;
	Lamp->SetActorHiddenInGame(bHide);
	for (const TWeakObjectPtr<AActor>& Each : LampGroup) if (Each.IsValid()) Each->SetActorHiddenInGame(bHide);
}

bool ABpTable::LampRidePose(FVector& OutAt, double& OutYaw, FVector& OutLeanAxis, float& OutLeanDeg) const
{
	if (LampTravelT < 0.f && LampSettleT < 0.f) return false;
	if (bLampRideCut)
	{
		OutAt = LampRideTo;
		OutYaw = LampRideToYaw;
		OutLeanDeg = 0.f;
		return true;
	}
	if (LampTravelT >= 0.f)
	{
		const double Alpha = FMath::Clamp(LampTravelT / LampRideS, 0.f, 1.f);
		const double S = Smoother(Alpha) * LampPathLen.Last();
		int32 Index = 1;
		while (Index < LampPathLen.Num() - 1 && LampPathLen[Index] < S) ++Index;
		const double SegLen = FMath::Max(LampPathLen[Index] - LampPathLen[Index - 1], 0.01);
		const FVector2D P = FMath::Lerp(LampPath[Index - 1], LampPath[Index], (S - LampPathLen[Index - 1]) / SegLen);
		const FVector2D Dir = (LampPath[Index] - LampPath[Index - 1]).GetSafeNormal();
		double Z = FMath::Lerp(LampRideFromZ, LampRideToZ, Alpha) + FMath::Sin(UE_PI * Alpha) * FMath::Clamp(CVarLampArcCm.GetValueOnGameThread(), 0.f, 25.f);
		OutAt = FVector(P, Z);
		OutYaw = LampRideFromYaw + (LampRideToYaw - LampRideFromYaw) * Smoother(Alpha);
		OutLeanAxis = FVector::CrossProduct(FVector::UpVector, FVector(Dir, 0.0));
		OutLeanDeg = FMath::Sin(UE_PI * Alpha) * FMath::Clamp(CVarLampLeanDeg.GetValueOnGameThread(), 0.f, 20.f);
		const_cast<ABpTable*>(this)->LampLeanAxis = OutLeanAxis;
		const_cast<ABpTable*>(this)->LampLeanNow = OutLeanDeg;
		return true;
	}
	// The settle: the lean comes back past upright a touch, then rests.
	OutAt = LampRideTo;
	OutYaw = LampRideToYaw;
	OutLeanAxis = LampLeanAxis;
	const double Settle = FMath::Clamp(LampSettleT / LampSettleS, 0.f, 1.f);
	OutLeanDeg = -FMath::Sin(UE_PI * Settle) * FMath::Clamp(CVarLampLeanDeg.GetValueOnGameThread(), 0.f, 20.f) * 0.35f;
	return true;
}
