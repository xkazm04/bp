// Switching rooms and the hands' room actions (spark vr-room-layers WP3; BpTable.h declares the API, the constants and
// the hands' rule). The person stays seated: a switch fades only the paper and the deck (BpRoom.cpp's room-to-room fade),
// never the view. Four routes switch: the wrist's list of rooms by urgency (BpWrist.cpp), a tap or a hold on the key
// plan's room (BpRoom.cpp tags its cells), the NEXT ROOM button at the queue's end (BpDeck.cpp), and a hold on the lamp
// agent's head, which turns to the person, says the next room and why in its caption, and switches. The lamp also answers
// a hold on a feature's glyph with one line from the store, and a lasso drawn on the map puts the open findings of the
// glyphs inside into the draft wave (BpLink AddToDraft: compose or PATCH, never a dispatch). Urgency is the owner's order:
// T0 then T1 findings, then open findings, then the plan's order; nothing here computes a layout or a health.
#include "BpTable.h"
#include "BpProjector.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpPawn.h"
#include "BpSheet.h"
#include "BpType.h"
#include "BpWords.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	/** Wave N3-W4: his arm stays low while he presents (he points with his beam only): no stand with the arm raised cleared the
	 *  sheet. Set with the stand (ABpTable::LampFootClearOfSheet), read by PlaceLamp. */
	bool GLampArmLow = false;

	TAutoConsoleVariable<float> CVarLampSwitchDelayS(
		TEXT("bp.LampSwitchDelayS"),
		ABpTable::LampSwitchDelayS,
		TEXT("After the lamp names the next room, the switch follows this many seconds later (a capture holds it)."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarLassoDrawS(
		TEXT("bp.LassoDrawS"),
		ABpTable::LassoDrawS,
		TEXT("BpRoom.Lasso draws its loop over this many seconds (a mid-draw capture slows it)."),
		ECVF_Default);

	/** The lamp's mesh (studio_level.py's LAMP_MESH): the level's actor that carries it is the lamp. */
	const TCHAR* const LampMeshName = TEXT("SM_LampAgent");
	/** The halo behind its head (ff_agent.py's tag); its lights are the point lights within LampLightReachCm of its head. */
	const FName LampHaloTag(TEXT("BpAgentHalo"));
	constexpr double LampLightReachCm = 40.0;
	/** The head's centre in the mesh's own space (cm, before the actor's scale): lamp-agent's manifest, a 23.45 cm figure
	 *  whose hood (13.6 cm across) tops it, so the hood's centre stands half its width under the top, over the pin. */
	const FVector LampHeadLocal(0.46, 0.0, 16.6);

	const FLinearColor SwitchCyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor SwitchAmber(FColor(0xFF, 0xB5, 0x47));

	float SwitchEase(float Alpha)
	{
		Alpha = FMath::Clamp(Alpha, 0.f, 1.f);
		return Alpha * Alpha * (3.f - 2.f * Alpha);
	}

	/** Wave U1: bp.Wow.GlimGlanceShare (BpLampLook.cpp), how much of the way Glim's glance turns. */
	float CVarGlimGlanceShareRead()
	{
		static const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Wow.GlimGlanceShare"));
		return Var ? Var->GetFloat() : 0.8f;
	}

	bool SwitchReduced()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}

	/** The caption's font at a cap height in its widget's pixels (BpType's family). */
	FSlateFontInfo CaptionFont(const TCHAR* Style, float CapPx)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
	}

	float CaptionWidth(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return static_cast<float>(Renderer->GetFontMeasureService()->Measure(Text, Font).X);
		}
		return Text.Len() * 0.5f * Font.Size * 96.f / 72.f;
	}

	/** A line break in the text first (its subject, then what is said of it), then words into lines of MaxW, at most
	 *  CaptionMaxLines; the last keeps the rest, cut with an ellipsis (BpType's rule). */
	constexpr int32 CaptionMaxLines = 3;
	TArray<FString> CaptionLines(const FString& Text, const FSlateFontInfo& Font, float MaxW)
	{
		TArray<FString> Parts, Lines;
		Text.ParseIntoArrayLines(Parts);
		for (const FString& Part : Parts)
		{
			TArray<FString> Words;
			Part.ParseIntoArrayWS(Words);
			FString Line;
			for (const FString& Word : Words)
			{
				const FString Try = Line.IsEmpty() ? Word : Line + TEXT(" ") + Word;
				if (CaptionWidth(Try, Font) <= MaxW || Line.IsEmpty()) { Line = Try; continue; }
				Lines.Add(Line);
				Line = Word;
			}
			if (!Line.IsEmpty()) Lines.Add(Line);
		}
		if (Lines.Num() > CaptionMaxLines)
		{
			FString Rest = Lines[CaptionMaxLines - 1];
			for (int32 Index = CaptionMaxLines; Index < Lines.Num(); ++Index) Rest += TEXT(" ") + Lines[Index];
			Lines.SetNum(CaptionMaxLines);
			Lines.Last() = Rest;
		}
		for (FString& Each : Lines)
		{
			if (CaptionWidth(Each, Font) <= MaxW) continue;
			for (int32 Keep = Each.Len() - 1; Keep > 0; --Keep)
			{
				const FString Cut = Each.Left(Keep).TrimEnd() + BpType::Ellipsis();
				if (CaptionWidth(Cut, Font) <= MaxW) { Each = Cut; break; }
			}
		}
		return Lines;
	}

	/** The hold's ring round the lamp's head: a faint full circle and an amber arc for the share held, clockwise from the
	 *  top (the wrist's progress ring, larger). */
	class SBpHoldRing : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SBpHoldRing) {}
			SLATE_ARGUMENT(float, Fill)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Fill = FMath::Clamp(Args._Fill, 0.f, 1.f); }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(240.0, 240.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const FVector2f Centre = Size * 0.5f;
			const float Radius = FMath::Min(Size.X, Size.Y) * 0.5f - 10.f;
			const auto Arc = [&](float From, float To, const FLinearColor& Color, float Thickness)
			{
				TArray<FVector2f> Points;
				const int32 Steps = FMath::Max(2, FMath::CeilToInt((To - From) * 96.f));
				for (int32 Step = 0; Step <= Steps; ++Step)
				{
					const float A = 2.f * UE_PI * FMath::Lerp(From, To, static_cast<float>(Step) / Steps) - 0.5f * UE_PI;
					Points.Add(Centre + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius);
				}
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thickness);
			};
			Arc(0.f, 1.f, SwitchCyan.CopyWithNewOpacity(0.3f), 6.f);
			if (Fill > 0.f) Arc(0.f, Fill, SwitchAmber, 10.f);
			return Layer + 1;
		}

	private:
		float Fill = 0.f;
	};

	/** Inside a closed polygon (paper cm), by the crossings of a ray along +u. */
	bool InsideLoop(const TArray<FVector2D>& Loop, const FVector2D& P)
	{
		bool bIn = false;
		for (int32 I = 0, J = Loop.Num() - 1; I < Loop.Num(); J = I++)
		{
			const FVector2D& A = Loop[I];
			const FVector2D& B = Loop[J];
			if ((A.Y > P.Y) != (B.Y > P.Y) && P.X < (B.X - A.X) * (P.Y - A.Y) / (B.Y - A.Y) + A.X) bIn = !bIn;
		}
		return bIn;
	}

	/** The convex hull of points (Andrew's monotone chain), anticlockwise in paper cm (v down). */
	TArray<FVector2D> Hull(TArray<FVector2D> Points)
	{
		Points.Sort([](const FVector2D& A, const FVector2D& B) { return A.X != B.X ? A.X < B.X : A.Y < B.Y; });
		const auto Cross = [](const FVector2D& O, const FVector2D& A, const FVector2D& B) { return (A.X - O.X) * (B.Y - O.Y) - (A.Y - O.Y) * (B.X - O.X); };
		TArray<FVector2D> Out;
		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const int32 Start = Out.Num();
			for (int32 Index = 0; Index < Points.Num(); ++Index)
			{
				const FVector2D& P = Points[Pass == 0 ? Index : Points.Num() - 1 - Index];
				while (Out.Num() >= Start + 2 && Cross(Out[Out.Num() - 2], Out.Last(), P) <= 0.0) Out.Pop();
				Out.Add(P);
			}
			Out.Pop();
		}
		return Out;
	}
}

// ---- Setup ----------------------------------------------------------------------------------------------------------------

void ABpTable::InitSwitch()
{
	const auto MakeWidget = [this](const TCHAR* Name, const FVector2D& Size)
	{
		UWidgetComponent* Widget = NewObject<UWidgetComponent>(this, Name);
		Widget->SetupAttachment(Root);
		Widget->SetWidgetSpace(EWidgetSpace::World);
		Widget->SetDrawSize(Size);
		Widget->SetDrawAtDesiredSize(false);
		Widget->SetPivot(FVector2D(0.5, 0.5));
		Widget->SetBlendMode(EWidgetBlendMode::Transparent);
		Widget->SetTwoSided(false);
		Widget->SetBackgroundColor(FLinearColor::Transparent);
		Widget->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Widget->SetCastShadow(false);
		Widget->SetWindowFocusable(false);
		Widget->SetManuallyRedraw(true);
		Widget->RegisterComponent();
		Widget->SetVisibility(false);
		return Widget;
	};
	LampCaption = MakeWidget(TEXT("LampCaption"), FVector2D(CaptionWidthCm * CaptionPxPerCm, CaptionHeightCm * CaptionPxPerCm));
	LampRing = MakeWidget(TEXT("LampRing"), FVector2D(240.0, 240.0));
	// The lasso's line and its picks, in the map walls' glass (BpRoom.cpp), at the paper's place.
	const auto MakeBars = [this](const TCHAR* Name)
	{
		UInstancedStaticMeshComponent* Bars = NewObject<UInstancedStaticMeshComponent>(this, Name);
		Bars->SetupAttachment(Root);
		Bars->SetMobility(EComponentMobility::Movable);
		Bars->SetStaticMesh(EngineCube);
		Bars->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Bars->SetCastShadow(false);
		Bars->NumCustomDataFloats = 5;
		if (MapWalls && MapWalls->GetMaterial(0)) Bars->SetMaterial(0, MapWalls->GetMaterial(0));
		Bars->RegisterComponent();
		return Bars;
	};
	LassoBars = MakeBars(TEXT("LassoBars"));
	LassoPicks = MakeBars(TEXT("LassoPicks"));
	// The loop itself in the pins' amber (M_PinBody, unlit), so it reads apart from the map's cyan walls.
	if (RoomBeads && RoomBeads->GetMaterial(0)) LassoBars->SetMaterial(0, RoomBeads->GetMaterial(0));
	RoomModeChanged.AddUObject(this, &ABpTable::OnSwitchRoomChanged);
	FindLamp();
	InitLegend();
}

FVector ABpTable::EyeLocal() const
{
	return FVector(-(TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0, PlacedHeightCm + ABpGameMode::TargetEyeAboveTopCm);
}

void ABpTable::FindLamp()
{
	if (!GetWorld()) return;
	for (TActorIterator<AActor> It(GetWorld()); It && !Lamp.IsValid(); ++It)
	{
		TArray<UStaticMeshComponent*> Meshes;
		It->GetComponents(Meshes);
		for (const UStaticMeshComponent* Mesh : Meshes)
		{
			if (Mesh->GetStaticMesh() && Mesh->GetStaticMesh()->GetName() == LampMeshName) Lamp = *It;
		}
	}
	if (!Lamp.IsValid())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: no lamp agent in this level (%s); the lamp's routes are off"), LampMeshName);
		return;
	}
	LampRest = Lamp->GetActorTransform();
	LampMobility = Lamp->GetRootComponent() ? static_cast<uint8>(Lamp->GetRootComponent()->Mobility.GetValue()) : 0;
	FVector Head;
	LampHead(Head);
	TArray<FString> Names;
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (*It == Lamp.Get() || !It->GetRootComponent()) continue;
		const bool bHalo = It->ActorHasTag(LampHaloTag);
		// Its own point lights (a spot light near it lights the table, and stays).
		const UPointLightComponent* Point = It->FindComponentByClass<UPointLightComponent>();
		const bool bLight = Point && !Point->IsA<USpotLightComponent>() && FVector::Dist(It->GetActorLocation(), Head) <= LampLightReachCm;
		if (!bHalo && !bLight) continue;
		LampGroup.Add(*It);
		LampGroupRest.Add(It->GetActorTransform());
		LampGroupRel.Add(It->GetActorTransform().GetRelativeTransform(LampRest));
		LampGroupMobility.Add(static_cast<uint8>(It->GetRootComponent()->Mobility.GetValue()));
		Names.Add(It->GetName());
	}
	const FVector At = GetActorTransform().InverseTransformPosition(LampRest.GetLocation());
	const FVector HeadAt = GetActorTransform().InverseTransformPosition(Head);
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lamp %s at table (%.1f, %.1f, %.1f) yaw %.0f, head at (%.1f, %.1f, %.1f); moves with it: %s"), *Lamp->GetName(), At.X, At.Y, At.Z,
		LampRest.Rotator().Yaw, HeadAt.X, HeadAt.Y, HeadAt.Z, *FString::Join(Names, TEXT(", ")));
	// Its site home clear of the console's slot (bp.Lamp.HomeX/HomeY, BpLampLook.cpp).
	ApplyLampHome();
}

FVector ABpTable::GetCaptionWorld() const
{
	// Where ApplyLampWidgets puts it (the component stays at the table's origin until it first shows).
	return GetActorTransform().TransformPosition(CaptionAt());
}

bool ABpTable::LampHead(FVector& OutWorld) const
{
	if (!Lamp.IsValid()) return false;
	OutWorld = Lamp->GetActorTransform().TransformPosition(LampHeadLocal);
	return true;
}

double ABpTable::LampYawToward(const FVector& From, const FVector& To)
{
	// The hood faces the mesh's +Y (studio_level.py: yaw 90 turns it to -X), so the yaw y turns it to (-sin y, cos y).
	const FVector D = To - From;
	return FMath::RadiansToDegrees(FMath::Atan2(-D.X, D.Y));
}

void ABpTable::PlaceLamp()
{
	if (!Lamp.IsValid()) return;
	const FTransform& Table = GetActorTransform();
	FVector RideAt, LeanAxis;
	double RideYaw = 0.0;
	float LeanDeg = 0.f;
	const bool bRide = LampRidePose(RideAt, RideYaw, LeanAxis, LeanDeg);
	const bool bHome = LampAway <= 0.f && LampLook <= 0.f && !bRide && !bLampAtStation && LampFace <= 0.f && LampProj <= 0.f && LampNodT < 0.f && LampGlance <= 0.f;
	const auto SetMovable = [](AActor* Actor, uint8 Mobility)
	{
		const EComponentMobility::Type Want = static_cast<EComponentMobility::Type>(Mobility);
		if (Actor && Actor->GetRootComponent() && Actor->GetRootComponent()->Mobility.GetValue() != Want) Actor->GetRootComponent()->SetMobility(Want);
	};
	if (bHome)
	{
		// Back exactly where the level put it, with the mobility it had (the site plan is as before).
		if (!bLampMovable) return;
		Lamp->SetActorTransform(LampRest);
		for (int32 Index = 0; Index < LampGroup.Num(); ++Index)
		{
			if (AActor* Each = LampGroup[Index].Get()) Each->SetActorTransform(LampGroupRest[Index]);
		}
		SetMovable(Lamp.Get(), LampMobility);
		for (int32 Index = 0; Index < LampGroup.Num(); ++Index) SetMovable(LampGroup[Index].Get(), LampGroupMobility[Index]);
		bLampMovable = false;
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: lamp back at its site place"));
		return;
	}
	if (!bLampMovable)
	{
		SetMovable(Lamp.Get(), static_cast<uint8>(EComponentMobility::Movable));
		for (const TWeakObjectPtr<AActor>& Each : LampGroup) SetMovable(Each.Get(), static_cast<uint8>(EComponentMobility::Movable));
		bLampMovable = true;
	}
	// The table's space: its place and yaw at rest, at the room spot facing between the deck and the eye, and turned to
	// what it talks about.
	const FVector RestAt = Table.InverseTransformPosition(LampRest.GetLocation());
	const double RestYaw = (Table.GetRotation().Inverse() * LampRest.GetRotation()).Rotator().Yaw;
	const FVector RoomAt(LampRoomXCm, LampRoomYCm, RestAt.Z - LampRoomDropCm);
	const FVector Eye = EyeLocal();
	const double RoomYaw = LampYawToward(RoomAt, FMath::Lerp(DeckPose(0.f, 0.f).GetLocation(), Eye, static_cast<double>(LampRoomFaceShare)));
	const float A = SwitchEase(LampAway);
	FVector At = FMath::Lerp(RestAt, RoomAt, static_cast<double>(A));
	double Yaw = RestYaw + FMath::FindDeltaAngleDegrees(RestYaw, RoomYaw) * A;
	// A ride (or a station it stands at) overrides the home place; a home-bound ride follows a home still moving.
	if (bRide)
	{
		At = RideAt;
		Yaw = RideYaw;
		if (bLampToHome) At += FMath::Lerp(RestAt, RoomAt, static_cast<double>(A)) - LampRideHome;
	}
	else if (bLampAtStation)
	{
		At = LampStationAtLocal + FVector(0.0, LampAsideCm, 0.0);
		Yaw = LampStationYaw;
	}
	// Waves PJ1/PJ2 (the device, 2026-11-10: from the seat Glim covered the far sheet's lower-left corner and its PREV): while a
	// sheet is far he stands at the foot of it, on the table's far rim LEFT of the sheet, so his whole silhouette stays outside
	// its rectangle from the seated eye (the sheet is at most about 22 degrees each side; he stands about 34 degrees left).
	if (LampProj > 0.f && !bRide && !bLampAtStation)
	{
		const FVector FootAt = LampFootClearOfSheet(FVector(TableDepthCm * 0.5 - 7.0, -(TableWidthCm * 0.5 - 14.0), RestAt.Z));
		At = FMath::Lerp(At, FootAt, static_cast<double>(SwitchEase(LampProj)));
	}
	if (LampLook > 0.f && !bRide) Yaw += FMath::FindDeltaAngleDegrees(Yaw, LampYawToward(At, LampLookAt)) * SwitchEase(LampLook);
	// Wave U1, "Glim alive": a partial glance toward where the person's ray points on the plan.
	if (LampGlance > 0.f && !bRide && !bLampAtStation) Yaw += FMath::FindDeltaAngleDegrees(Yaw, LampYawToward(At, LampGlanceAim)) * SwitchEase(LampGlance) * FMath::Clamp(CVarGlimGlanceShareRead(), 0.f, 1.f);
	// Wave PJ1: to the far sheet's point of interest while a sheet is thrown (TickLampManner eases LampProj).
	// Wave N3-W2: the eased point (LampProjAim), so the move from the loupe to APPROVE is a sweep.
	const FVector ProjAim = bLampProjAim ? LampProjAim : BpProjector::FarAimLocal();
	if (LampProj > 0.f && !bRide) Yaw += FMath::FindDeltaAngleDegrees(Yaw, LampYawToward(At, ProjAim)) * SwitchEase(LampProj);
	// V3: to the person while it listens or speaks (TickLampManner), and a nod toward them.
	if (LampFace > 0.f && !bRide) Yaw += FMath::FindDeltaAngleDegrees(Yaw, LampYawToward(At, Eye)) * SwitchEase(LampFace);
	FQuat Turn(FVector::UpVector, FMath::DegreesToRadians(Yaw - RestYaw));
	if (LeanDeg != 0.f && !LeanAxis.IsNearlyZero()) Turn = FQuat(LeanAxis.GetSafeNormal(), FMath::DegreesToRadians(LeanDeg)) * Turn;
	// Wave N3-W2: a decision open on the wall, Glim raises his arm toward what he points at (the loupe's region, the title, then
	// APPROVE): he tilts back from his base by the point's elevation over his head, at most bp.Glim.PointDeg, eased with his
	// turn. Facing the person (he listens or speaks) lowers it again; reduced motion: he only faces it.
	// Wave N3-W4: not where his raised arm would cross the sheet from the seat (LampFootClearOfSheet): he points with his beam.
	if (LampProj > 0.f && !bRide && !bLampAtStation && BpProjector::IsPointing() && !SwitchReduced() && !GLampArmLow)
	{
		FVector Head = At + FVector(0.0, 0.0, 30.0);
		if (Lamp.IsValid()) Head = Table.InverseTransformPosition(Lamp->GetActorTransform().TransformPosition(LampHeadLocal)) - Table.InverseTransformPosition(Lamp->GetActorLocation()) + At;
		const FVector To = ProjAim - Head;
		const double Elev = FMath::RadiansToDegrees(FMath::Atan2(To.Z, FVector2D(To.X, To.Y).Size()));
		// The point's elevation plus a gesture's 10 degrees (the wall stands near his head's height, so its elevation alone was
		// 1 to 5 degrees: no visible raise, PIE 2026-11-10).
		const double Raise = FMath::Clamp(Elev + 10.0, 0.0, static_cast<double>(BpProjector::PointMaxDeg())) * SwitchEase(LampProj) * (1.0 - SwitchEase(LampFace));
		if (Raise > 0.01)
		{
			const double Y = FMath::DegreesToRadians(Yaw);
			const FVector Facing(-FMath::Sin(Y), FMath::Cos(Y), 0.0);
			const FVector Across = FVector::CrossProduct(FVector::UpVector, Facing);
			// The nod's axis: a positive angle bows toward Facing, so a raise is the negative one.
			Turn = FQuat(Across, FMath::DegreesToRadians(-Raise)) * Turn;
		}
		static double RaiseShown = -1.0;
		if (FMath::Abs(Raise - RaiseShown) > 2.0 && SwitchEase(LampProj) >= 0.999f)
		{
			RaiseShown = Raise;
			UE_LOG(LogBpTable, Log, TEXT("BpProjector: Glim raises his arm %.1f deg toward %s (its elevation %.1f deg over his head)"), Raise, BpProjector::IsAsking() ? TEXT("APPROVE") : TEXT("what he presents"), Elev);
		}
	}
	if (LampNodT >= 0.f && !bRide)
	{
		// The hood faces (-sin y, cos y) (LampYawToward); it bows about the level axis across that, from its base.
		const double Y = FMath::DegreesToRadians(Yaw);
		const FVector Facing(-FMath::Sin(Y), FMath::Cos(Y), 0.0);
		const FVector Across = FVector::CrossProduct(FVector::UpVector, Facing);
		Turn = FQuat(Across, FMath::DegreesToRadians(LampNodDeg())) * Turn;
	}
	const FTransform World(Table.GetRotation() * Turn * Table.GetRotation().Inverse() * LampRest.GetRotation(), Table.TransformPosition(At), LampRest.GetScale3D());
	Lamp->SetActorTransform(World);
	for (int32 Index = 0; Index < LampGroup.Num(); ++Index)
	{
		if (AActor* Each = LampGroup[Index].Get()) Each->SetActorTransform(LampGroupRel[Index] * World);
	}
}

namespace
{
	TAutoConsoleVariable<float> CVarFootClearDeg(TEXT("bp.Glim.SheetClearDeg"), 3.f,
		TEXT("Wave N3-W3: while a sheet is far, the least angle (degrees, from the seated eye) between Glim's whole silhouette (his arm and hand included) and the sheet's edge; 0 turns the rule off (he stands at the far rim's left end, as before)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarFootEyeSlackCm(TEXT("bp.Glim.EyeSlackCm"), 15.f,
		TEXT("Wave N3-W4: Glim's stand by the far sheet must clear it from the seated eye and from eyes this far behind, in front of, left and right of it (cm, 0 to 40): a person who sits back or leans still sees him off the sheet."), ECVF_Default);

	/** Wave N3-W4: SM_LampAgent's parts in its own space (cm, before the actor's 1.05 scale), measured from its LOD0 vertices
	 *  (2026-11-10): the body (hood, torso, the stem to its back), the arm (out from the body at 0 to 45 degrees about +Z, 8 to
	 *  18 cm from the axis, 11 to 14 cm up) and the hand (18 to 27 cm out). Each is tested by its eight corners in his pose. */
	struct FLampPart { const TCHAR* Name; FBox Box; };
	const FLampPart LampParts[] = {
		{ TEXT("body"), FBox(FVector(-18.4, -5.9, -3.1), FVector(8.0, 8.0, 23.4)) },
		{ TEXT("arm"), FBox(FVector(5.0, -1.0, 11.0), FVector(18.0, 13.0, 14.0)) },
		{ TEXT("hand"), FBox(FVector(14.0, 4.0, 11.0), FVector(21.6, 14.5, 14.0)) },
	};
}

FVector ABpTable::LampFootClearOfSheet(const FVector& Want) const
{
	// Wave N3-W4 (the owner's device capture n3-dev-dec2: his raised arm and hand crossed the wall's left column while the PC
	// capture, framed narrower, showed him clear). The rule before tested a cylinder of his rest pose's reach about his axis;
	// now it projects his POSED parts (body, arm, hand: their corners in the very pose PlaceLamp gives him while he points)
	// from the eye onto the sheet's plane, for every point he points at on it, from the seated eye and from eyes around it.
	// Where the raised pose would cross the sheet, the arm stays low and he points with his beam only (GLampArmLow); where
	// even that crosses, he steps down the table's left side toward the seat.
	FTransform FarPose;
	FVector2D Size;
	const float MarginDeg = FMath::Clamp(CVarFootClearDeg.GetValueOnGameThread(), 0.f, 15.f);
	if (MarginDeg <= 0.f || !Lamp.IsValid() || !BpProjector::FarSheet(FarPose, Size))
	{
		GLampArmLow = false;
		return Want;
	}
	const float SlackCm = FMath::Clamp(CVarFootEyeSlackCm.GetValueOnGameThread(), 0.f, 40.f);
	const bool bMayRaise = BpProjector::PointMaxDeg() > 0.f && !SwitchReduced();
	static FString KeptKey;
	static FVector Kept = FVector::ZeroVector;
	static bool bKeptLow = false;
	const FString Key = FString::Printf(TEXT("%s|%s|%s|%.1f|%.0f|%d|%.1f"), *FarPose.GetLocation().ToString(), *FarPose.Rotator().ToString(), *Size.ToString(), MarginDeg, SlackCm, bMayRaise,
		BpProjector::PointMaxDeg()) + Want.ToString();
	if (Key == KeptKey)
	{
		GLampArmLow = bKeptLow;
		return Kept;
	}
	const FTransform& Table = GetActorTransform();
	const double RestYaw = (Table.GetRotation().Inverse() * LampRest.GetRotation()).Rotator().Yaw;
	// The mesh component's pose relative to the actor (the parts are in the mesh's space).
	FTransform MeshRel = FTransform::Identity;
	{
		TArray<UStaticMeshComponent*> Meshes;
		Lamp->GetComponents(Meshes);
		for (const UStaticMeshComponent* Mesh : Meshes)
		{
			if (Mesh->GetStaticMesh() && Mesh->GetStaticMesh()->GetName() == LampMeshName) MeshRel = Mesh->GetComponentTransform().GetRelativeTransform(Lamp->GetActorTransform());
		}
	}
	// What he points at: the sheet's points of interest, fixed in the sheet's own space so his stand does not move from one
	// sheet to the next (the title's top left, the loupe's middle column, what it touches, APPROVE under them, the centre).
	TArray<FVector> Aims;
	for (const FVector2D& Uv : { FVector2D(0.18, 0.2), FVector2D(0.5, 0.25), FVector2D(0.82, 0.25), FVector2D(0.4, 0.88), FVector2D(0.5, 0.5), FVector2D(0.15, 0.6) })
	{
		// A widget's x is the component's -Y, its y the component's -Z (UWidgetComponent's mapping).
		Aims.Add(FarPose.TransformPositionNoScale(FVector(0.0, -(Uv.X - 0.5) * Size.X, -(Uv.Y - 0.5) * Size.Y)));
	}
	// His pose at a stand P pointing at Aim, as PlaceLamp gives it with every ease at its end (turned to it; raised by the
	// point's elevation over his head plus the gesture's 10 degrees, at most bp.Glim.PointDeg).
	const FVector HeadOff = Table.InverseTransformVector(LampRest.TransformVector(LampHeadLocal));
	const auto PoseAt = [&](const FVector& P, const FVector& Aim, bool bRaise)
	{
		const double Yaw = LampYawToward(P, Aim);
		FQuat Turn(FVector::UpVector, FMath::DegreesToRadians(Yaw - RestYaw));
		if (bRaise)
		{
			const FVector To = Aim - (P + HeadOff);
			const double Elev = FMath::RadiansToDegrees(FMath::Atan2(To.Z, FVector2D(To.X, To.Y).Size()));
			const double Raise = FMath::Clamp(Elev + 10.0, 0.0, static_cast<double>(BpProjector::PointMaxDeg()));
			const double Y = FMath::DegreesToRadians(Yaw);
			const FVector Facing(-FMath::Sin(Y), FMath::Cos(Y), 0.0);
			Turn = FQuat(FVector::CrossProduct(FVector::UpVector, Facing), FMath::DegreesToRadians(-Raise)) * Turn;
		}
		// In the table's space (the table's own rotation cancels: Table^-1 * (Table * Turn * Table^-1 * Rest)).
		return FTransform(Turn * Table.GetRotation().Inverse() * LampRest.GetRotation(), P, LampRest.GetScale3D());
	};
	// The eyes: the seated one, and SlackCm behind, in front, left and right of it.
	const FVector Seat = EyeLocal();
	TArray<FVector> Eyes = { Seat };
	if (SlackCm > 0.f) for (const FVector& D : { FVector(-1.0, 0.0, 0.0), FVector(1.0, 0.0, 0.0), FVector(0.0, -1.0, 0.0), FVector(0.0, 1.0, 0.0) }) Eyes.Add(Seat + D * SlackCm);
	// One part's clearance (degrees; negative overlaps) from one eye: its corners cast from the eye onto the sheet's plane, their
	// box against the sheet's rectangle (the box of the cast corners holds the part's whole outline).
	const auto PartClear = [&](const FTransform& Pose, const FBox& Box, const FVector& Eye)
	{
		const FVector E = FarPose.InverseTransformPositionNoScale(Eye);
		FBox2D Cast(ForceInit);
		for (int32 C = 0; C < 8; ++C)
		{
			const FVector Corner((C & 1) ? Box.Max.X : Box.Min.X, (C & 2) ? Box.Max.Y : Box.Min.Y, (C & 4) ? Box.Max.Z : Box.Min.Z);
			const FVector S = FarPose.InverseTransformPositionNoScale(Pose.TransformPosition(MeshRel.TransformPosition(Corner)));
			// A corner at or beyond the sheet's plane (or behind the eye) cannot be cast: it counts as on the sheet.
			if (S.X <= 0.5 || S.X >= E.X - 0.5) return -90.0;
			const double T = E.X / (E.X - S.X);
			Cast += FVector2D(E.Y + (S.Y - E.Y) * T, E.Z + (S.Z - E.Z) * T);
		}
		const double Cm = FMath::Max(FMath::Max(-Size.X * 0.5 - Cast.Max.X, Cast.Min.X - Size.X * 0.5), FMath::Max(-Size.Y * 0.5 - Cast.Max.Y, Cast.Min.Y - Size.Y * 0.5));
		return FMath::RadiansToDegrees(FMath::Atan2(Cm, FMath::Max(1.0, E.X)));
	};
	// The least clearance of each part over every aim and eye, for a stand and an arm. And over every way he turns unraised:
	// while he speaks or listens he faces the person (LampFace), and his arm, which stands out of his side at 30 degrees from
	// his facing, then reaches across toward the sheet (the device capture's pose); the turn between sweeps it through the rest.
	TArray<FVector> Turns;
	for (int32 Step = 0; Step < 24; ++Step)
	{
		const double A = FMath::DegreesToRadians(Step * 15.0);
		Turns.Add(FVector(FMath::Cos(A), FMath::Sin(A), 0.0) * 100.0);
	}
	const auto StandClear = [&](const FVector& P, bool bRaise, double (&OutParts)[3])
	{
		for (double& Each : OutParts) Each = TNumericLimits<double>::Max();
		const auto Take = [&](const FTransform& Pose)
		{
			for (const FVector& Eye : Eyes)
			{
				for (int32 Part = 0; Part < 3; ++Part) OutParts[Part] = FMath::Min(OutParts[Part], PartClear(Pose, LampParts[Part].Box, Eye));
			}
		};
		for (const FVector& Aim : Aims) Take(PoseAt(P, Aim, bRaise));
		for (const FVector& Turn : Turns) Take(PoseAt(P, P + Turn, false));
		return FMath::Min3(OutParts[0], OutParts[1], OutParts[2]);
	};
	// Along the table's left side from Want toward the seat: the first place that clears by MarginDeg, with the arm raised if
	// that clears, else with it low; none clears: the place (arm low) that clears most.
	FVector Best = Want;
	double BestClear = -TNumericLimits<double>::Max();
	double BestParts[3] = { 0.0, 0.0, 0.0 };
	bool bClear = false, bLow = true;
	const double NearX = -(TableDepthCm * 0.5) + 8.0;
	int32 Steps = 0;
	for (double X = Want.X; X >= NearX; X -= 2.0)
	{
		const FVector P(X, Want.Y, Want.Z);
		double Parts[3];
		++Steps;
		if (bMayRaise && StandClear(P, true, Parts) >= MarginDeg)
		{
			Best = P; bLow = false; bClear = true;
			FMemory::Memcpy(BestParts, Parts, sizeof(Parts));
			BestClear = FMath::Min3(Parts[0], Parts[1], Parts[2]);
			break;
		}
		const double Low = StandClear(P, false, Parts);
		if (Low > BestClear) { BestClear = Low; Best = P; bLow = true; FMemory::Memcpy(BestParts, Parts, sizeof(Parts)); }
		if (Low >= MarginDeg) { bClear = true; break; }
	}
	// The same stand's clearance from the seated eye alone (what the captures show).
	double SeatParts[3] = { TNumericLimits<double>::Max(), TNumericLimits<double>::Max(), TNumericLimits<double>::Max() };
	TArray<FTransform> SeatPoses;
	for (const FVector& Aim : Aims) SeatPoses.Add(PoseAt(Best, Aim, !bLow));
	for (const FVector& Turn : Turns) SeatPoses.Add(PoseAt(Best, Best + Turn, false));
	for (const FTransform& Pose : SeatPoses)
	{
		for (int32 Part = 0; Part < 3; ++Part) SeatParts[Part] = FMath::Min(SeatParts[Part], PartClear(Pose, LampParts[Part].Box, Seat));
	}
	KeptKey = Key;
	Kept = Best;
	bKeptLow = bLow && bMayRaise;
	GLampArmLow = bKeptLow;
	UE_LOG(LogBpTable, Log, TEXT("BpProjector: Glim stands at table (%.0f, %.0f) %s the far sheet (%.0f x %.0f cm) with his arm %s; projected clearance from the seated eye: body %.1f, arm %.1f, hand %.1f deg; least over %d eyes (slack %.0f cm), %d aims and %d turns: body %.1f, arm %.1f, hand %.1f deg (rule %.1f; %d places tried from the far rim's end)"),
		Best.X, Best.Y, bClear ? TEXT("clear of") : TEXT("as clear as he can be of"), Size.X, Size.Y, bLow ? (bMayRaise ? TEXT("LOW (he points with his beam only)") : TEXT("low (no raise asked)")) : TEXT("RAISED"),
		SeatParts[0], SeatParts[1], SeatParts[2], Eyes.Num(), SlackCm, Aims.Num(), Turns.Num(), BestParts[0], BestParts[1], BestParts[2], MarginDeg, Steps);
	return Best;
}

FString ABpTable::LampCaptionFit(const FString& Text) const
{
	// One line of the plate, cut as CaptionLines cuts a line (BpType's rule), by the measured width SayLamp lays out to.
	const FSlateFontInfo Font = CaptionFont(TEXT("Bold"), CaptionCapCm * CaptionPxPerCm);
	const float MaxW = CaptionWidthCm * CaptionPxPerCm - 2.f * 22.f - 12.f;
	const FString Flat = Text.Replace(TEXT("\n"), TEXT(" "));
	if (CaptionWidth(Flat, Font) <= MaxW) return Flat;
	for (int32 Keep = Flat.Len() - 1; Keep > 0; --Keep)
	{
		const FString Cut = Flat.Left(Keep).TrimEnd() + BpType::Ellipsis();
		if (CaptionWidth(Cut, Font) <= MaxW) return Cut;
	}
	return Flat;
}

// ---- Urgency, the next room and the switch ----------------------------------------------------------------------------

TArray<ABpTable::FRoomRank> ABpTable::RoomsByUrgency() const
{
	TArray<FRoomRank> Ranks;
	if (!SheetPlan.IsValid()) return Ranks;
	const FBpPlan& Plan = *SheetPlan;
	for (int32 Index = 0; Index < Plan.rooms.Num(); ++Index)
	{
		FRoomRank Rank;
		Rank.Id = Plan.rooms[Index].id;
		Rank.Name = Plan.rooms[Index].name;
		Rank.Order = Index;
		Ranks.Add(Rank);
	}
	TMap<FString, int32> TileIndex;
	for (int32 Index = 0; Index < Plan.tiles.Num(); ++Index) TileIndex.Add(Plan.tiles[Index].id, Index);
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		const int32* Tile = TileIndex.Find(Proposal.feature);
		if (Proposal.status != TEXT("proposed") || !Tile || !TileRoom.IsValidIndex(*Tile) || !Ranks.IsValidIndex(TileRoom[*Tile])) continue;
		FRoomRank& Rank = Ranks[TileRoom[*Tile]];
		++Rank.Open;
		if (const int32* Tier = State.Tiers.Find(Proposal.id))
		{
			Rank.T0 += *Tier == 0 ? 1 : 0;
			Rank.T1 += *Tier == 1 ? 1 : 0;
		}
	}
	// T0 before T1 (stop-ship outranks before production), then the open findings, then the plan's order.
	Ranks.StableSort([](const FRoomRank& A, const FRoomRank& B)
	{
		if (A.T0 != B.T0) return A.T0 > B.T0;
		if (A.T1 != B.T1) return A.T1 > B.T1;
		if (A.Open != B.Open) return A.Open > B.Open;
		return A.Order < B.Order;
	});
	return Ranks;
}

FString ABpTable::RankWhy(const FRoomRank& Rank)
{
	const auto Count = [](int32 N, const TCHAR* What) { return FString::Printf(TEXT("%d %s %s"), N, What, N == 1 ? TEXT("finding") : TEXT("findings")); };
	if (Rank.T0 > 0 && Rank.T1 > 0) return FString::Printf(TEXT("%d T0 and %s"), Rank.T0, *Count(Rank.T1, TEXT("T1")));
	if (Rank.T0 > 0) return Count(Rank.T0, TEXT("T0"));
	if (Rank.T1 > 0) return Count(Rank.T1, TEXT("T1"));
	if (Rank.Open > 0) return Count(Rank.Open, TEXT("open"));
	return TEXT("nothing open");
}

FString ABpTable::NextRoom(FString& OutWhy) const
{
	OutWhy.Reset();
	const TArray<FRoomRank> Ranks = RoomsByUrgency();
	const FString Here = !RoomModeId.IsEmpty() ? RoomModeId : ShownRoomMode;
	const FRoomRank* Pick = Ranks.FindByPredicate([this, &Here](const FRoomRank& R) { return R.Id != Here && !RoomsVisited.Contains(R.Id); });
	if (!Pick)
	{
		// Every room seen this session: the one after this room in the order.
		const int32 At = Ranks.IndexOfByPredicate([&Here](const FRoomRank& R) { return R.Id == Here; });
		if (Ranks.Num() > 1) Pick = &Ranks[(At + 1) % Ranks.Num()];
		if (Pick && Pick->Id == Here) Pick = nullptr;
	}
	if (!Pick) return FString();
	OutWhy = RankWhy(*Pick);
	return Pick->Id;
}

bool ABpTable::SwitchRoom(const FString& InRoomId, const TCHAR* Route)
{
	const FBpPlanRoom* Room = FindRoom(InRoomId);
	if (!Room)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused switch by the %s: unknown room %s"), Route, *InRoomId);
		return false;
	}
	if (RoomModeId == InRoomId)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: switch by the %s: already in %s"), Route, *InRoomId);
		return false;
	}
	const FRoomRank* Rank = nullptr;
	const TArray<FRoomRank> Ranks = RoomsByUrgency();
	Rank = Ranks.FindByPredicate([&InRoomId](const FRoomRank& R) { return R.Id == InRoomId; });
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: switch %s -> %s \"%s\" by the %s (%s, rank %d of %d)"), RoomModeId.IsEmpty() ? TEXT("site") : *RoomModeId, *InRoomId, *Room->name, Route,
		Rank ? *RankWhy(*Rank) : TEXT("?"), Ranks.IndexOfByPredicate([&InRoomId](const FRoomRank& R) { return R.Id == InRoomId; }) + 1, Ranks.Num());
	return EnterRoomMode(InRoomId);
}

bool ABpTable::SwitchToNextRoom()
{
	FString Why;
	const FString Next = NextRoom(Why);
	if (Next.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused next: no other room"));
		return false;
	}
	return SwitchRoom(Next, TEXT("console"));
}

void ABpTable::OnSwitchRoomChanged(const FString& InRoomId)
{
	LampAwayTarget = InRoomId.IsEmpty() ? 0.f : 1.f;
	if (InRoomId.IsEmpty())
	{
		LampLine.Reset();
		LampCaptionClock = 0.f;
		LampLookTarget = 0.f;
		LampHoldFill = 0.f;
		PendingSwitch.Reset();
	}
	// A switch or an exit ends any lasso on the old map.
	LassoAuto.Reset();
	LassoAutoT = -1.f;
	LassoPath.Reset();
	bLassoStroke = bLassoDrawing = false;
	LassoLit = 0.f;
	if (LassoBars) LassoBars->ClearInstances();
	if (LassoPicks) LassoPicks->ClearInstances();
	SetActorTickInterval(0.f);
	ApplyLampWidgets();
}

// ---- The lamp's caption and its ring ----------------------------------------------------------------------------------

void ABpTable::SayLamp(const FString& Line, bool bNotice)
{
	LampLine = Line;
	bLampNotice = bNotice;
	// A line that is not the talk's (BpTalk.cpp sets it again after this for its own): the lamp's box shows it.
	bTalkCaption = false;
	bSheetCaption = false;
	LampCaptionClock = FMath::Max(LampCaptionS, PendingSwitch.IsEmpty() ? 0.f : CVarLampSwitchDelayS.GetValueOnGameThread() + 1.f);
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lamp says \"%s\""), *Line.Replace(TEXT("\n"), TEXT(" / ")));
	LayoutLampCaption();
	SetActorTickInterval(0.f);
	ApplyLampWidgets();
}

void ABpTable::LayoutLampCaption()
{
	if (!LampCaption) return;
	{
		// Night two V4: the sheet's family (BpSheet.h): its paper and ink, THE LAMP as a chip for who is speaking, the line
		// wrapped whole (never cut), the plate as tall as its lines; it still leaves by itself (LampCaptionClock).
		const float Cap = CaptionCapCm * CaptionPxPerCm;
		const FSlateFontInfo Font = CaptionFont(TEXT("Bold"), Cap), ChipFont = CaptionFont(TEXT("Bold"), Cap * 0.85f);
		// V7: TEXT SIZE scales the plate as a whole (ApplyLampWidgets), so it is laid out narrower: on the table it grows by the
		// square root of the size (26 cm at 1.0, 29.6 at 1.3, not 33.8), the larger words taking more lines upward; CaptionAt
		// keeps it whole inside the view.
		const float W = FMath::RoundToFloat(CaptionWidthCm * CaptionNarrow * CaptionPxPerCm / FMath::Sqrt(BpSheet::TextScale())), Pad = 20.f;
		const float Pitch = Cap / static_cast<float>(BpType::CapPerEm) * 1.2f, ChipH = Cap * 0.85f / static_cast<float>(BpType::CapPerEm) * 1.2f + 6.f;
		TArray<FString> Parts, Wrapped;
		LampLine.ParseIntoArrayLines(Parts);
		for (const FString& Part : Parts) Wrapped.Add(BpSheet::Wrap(Part, Font, W - 2.f * Pad - 14.f, 0));
		const FString Words = FString::Join(Wrapped, TEXT("\n"));
		const float H = FMath::CeilToFloat(14.f + ChipH + 8.f + BpSheet::Lines(Words) * Pitch + 14.f);
		LampCaption->SetDrawSize(FVector2D(W, H));
		LampCaption->SetSlateWidget(
			SNew(SBox).WidthOverride(W).HeightOverride(H)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.94f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f).Bar(BpSheet::Amber).BarPx(6.f)]
				+ SOverlay::Slot().Padding(FMargin(Pad + 6.f, 14.f, Pad, 14.f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left)[SNew(SBox).HeightOverride(ChipH).WidthOverride(BpSheet::ChipWidth(TEXT("GLIM"), ChipFont))[BpSheet::Chip(TEXT("GLIM"), ChipFont, ChipH, BpSheet::Amber)]]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 8.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(Words)).Font(Font).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
				]
			]);
		LampCaption->RequestRedraw();
		UE_LOG(LogBpTable, Log, TEXT("BpType: lamp caption cap_cm=%.2f; %.1f cm from the target eye: %.1f px"), CaptionCapCm,
			FVector::Dist(EyeLocal(), FVector(CaptionXCm, LampCaptionY, PlacedHeightCm + CaptionAboveTopCm)),
			CaptionCapCm * 800.0 / FVector::Dist(EyeLocal(), FVector(CaptionXCm, LampCaptionY, PlacedHeightCm + CaptionAboveTopCm)));
	}
}

FVector ABpTable::CaptionAt() const
{
	// Night two V4: the plate grows with its lines, upward from its old foot (plus 2 cm), so it never drops over the wing
	// names and the pin tags under it. V5: at home it follows the lamp's step aside, and rises by CaptionLiftCm until it
	// covers no pin tag, wing name or lifted thing from the seat (UpdateCaptionLift).
	const float GrowCm = LampCaption ? FMath::Max(0.f, static_cast<float>(LampCaption->GetDrawSize().Y) / CaptionPxPerCm - CaptionHeightCm) : 0.f;
	const bool bHome = LampTravelT < 0.f && !bLampAtStation && RoomModeId.IsEmpty();
	// V7: at a station the caption goes with the lamp's step beside the console's slot.
	const FVector2D Step = bHome ? LampStepCm : bLampAtStation ? FVector2D(0.0, LampAsideCm) : FVector2D::ZeroVector;
	FVector At(CaptionXCm + Step.X, LampCaptionY + Step.Y + (RoomModeId.IsEmpty() ? CaptionSlideCm : 0.f), PlacedHeightCm + CaptionAboveTopCm + (GrowCm * 0.5f + 2.f) * BpSheet::TextScale() + (RoomModeId.IsEmpty() ? CaptionLiftCm : 0.f));
	// V7: whole inside the comfortable view (BpView.Fov's 30 degrees either side, a degree to spare) at every text size and
	// wherever the lamp stands: it slides inward along the table's width before an edge would leave the view.
	const FVector Eye = EyeLocal();
	const double Ahead = FMath::Max(At.X - Eye.X, 1.0);
	const double HalfW = (LampCaption ? LampCaption->GetDrawSize().X / CaptionPxPerCm : CaptionWidthCm) * BpSheet::TextScale() * 0.5;
	const double Reach = FMath::Tan(FMath::DegreesToRadians(29.0)) * Ahead;
	if (Reach > HalfW) At.Y = FMath::Clamp(At.Y, Eye.Y - Reach + HalfW, Eye.Y + Reach - HalfW);
	return At;
}

void ABpTable::UpdateCaptionLift()
{
	if (!LampCaption) return;
	TArray<FBox2D> Keep;
	SeatKeepouts(Keep);
	const FVector Eye = EyeLocal();
	const float Was = CaptionLiftCm, WasSlide = CaptionSlideCm;
	// V7: at a station beside an open sheet the plate may rise over the sheet's top edge (above the lamp, not beside it).
	const float MaxLift = bLampAtStation ? CaptionMaxStationLiftCm : CaptionMaxLiftCm;
	FBox2D Slot;
	const bool bSlot = ConsoleSeatBox(Slot);
	// The search runs again only when what it reads changed (it is checked every LampStepCheckS while the lamp is home).
	{
		uint32 Hash = GetTypeHash(LampCaption->GetDrawSize().ToString()) ^ GetTypeHash(LampStepCm.ToString()) ^ GetTypeHash(LampAsideCm) ^ (bLampAtStation ? 7u : 3u) ^ GetTypeHash(CaptionNarrow);
		if (bSlot) Hash = HashCombine(Hash, GetTypeHash(Slot.ToString()));
		for (const FBox2D& K : Keep) Hash = HashCombine(Hash, GetTypeHash(FIntPoint(FMath::RoundToInt(K.Min.X * 4.0), FMath::RoundToInt(K.Min.Y * 4.0))) ^ GetTypeHash(FIntPoint(FMath::RoundToInt(K.Max.X * 4.0), FMath::RoundToInt(K.Max.Y * 4.0))));
		if (Hash == CaptionLiftHash) return;
		CaptionLiftHash = Hash;
	}
	const auto SeenAt = [&]()
	{
		const double W = LampCaption->GetDrawSize().X / CaptionPxPerCm * BpSheet::TextScale();
		const double H = LampCaption->GetDrawSize().Y / CaptionPxPerCm * BpSheet::TextScale();
		const FVector At = CaptionAt();
		const FVector Right = FVector::CrossProduct(FVector::UpVector, (At - Eye).GetSafeNormal()).GetSafeNormal() * (W * 0.5);
		const FVector Up = FVector(0.0, 0.0, H * 0.5);
		FBox Plate(ForceInit);
		for (const FVector& C : { At - Right - Up, At + Right - Up, At - Right + Up, At + Right + Up }) Plate += C;
		return SeatAngles(Plate);
	};
	// The plate's four corners as it stands square to the eye, at a lift; the least lift (0.5 cm steps) that covers nothing.
	// Wave P1 (the tour's stand-up step, cap/ev-tour-standup.png): at home with a sheet open no lift cleared the sheet's edge and
	// the plate stood over it. Then (an open sheet, not the bar) the plate slides along the table's width away from the slot,
	// the least slide then the least lift that covers nothing, and when the comfortable view leaves it no room beside the sheet
	// it is laid out narrower (CaptionNarrowScale, more lines upward) and tried again. The sheet wins over a tag or a name.
	const auto Search = [&](float Dir, bool bSheetOnly, float& OutLift, float& OutSlide)
	{
		for (float Slide = 0.f; Slide <= (Dir != 0.f ? CaptionMaxSlideCm : 0.f) + 1e-3f; Slide += 1.f)
		{
			CaptionSlideCm = Dir * Slide;
			for (float Lift = 0.f; Lift <= MaxLift + 1e-3f; Lift += 0.5f)
			{
				CaptionLiftCm = Lift;
				const FBox2D Seen = SeenAt();
				// V7: never over the top of the comfortable view (a lift past the console's top edge by more than a few degrees is out).
				if (Lift > CaptionMaxLiftCm && bSlot && Seen.Max.Y > Slot.Max.Y + 4.0) break;
				const bool bCovers = bSheetOnly ? Seen.Intersect(Slot) : Keep.ContainsByPredicate([&Seen](const FBox2D& K) { return Seen.Intersect(K); });
				if (!bCovers) { OutLift = Lift; OutSlide = CaptionSlideCm; return true; }
			}
		}
		return false;
	};
	CaptionSlideCm = 0.f;
	CaptionLiftCm = 0.f;
	const bool bSheet = bSlot && Slot.GetSize().Y > 8.0;
	float Best = CaptionMaxLiftCm, BestSlide = 0.f;
	FString How;
	bool bFound = Search(0.f, false, Best, BestSlide);
	if (!bFound && bSheet)
	{
		const float Dir = SeenAt().GetCenter().X < Slot.GetCenter().X ? -1.f : 1.f;
		bFound = Search(Dir, false, Best, BestSlide) || Search(Dir, true, Best, BestSlide);
		if (bFound) How = TEXT(" beside the open sheet");
		else if (CaptionNarrow == 1.f)
		{
			CaptionNarrow = CaptionNarrowScale;
			LayoutLampCaption();
			UE_LOG(LogBpTable, Log, TEXT("BpLampLook: no room for the caption beside the open sheet: laid out at %.0f%% width"), CaptionNarrow * 100.f);
			CaptionSlideCm = CaptionLiftCm = 0.f;
			bFound = Search(Dir, false, Best, BestSlide) || Search(Dir, true, Best, BestSlide);
			How = TEXT(" beside the open sheet, narrower");
		}
	}
	else if (!bSheet && CaptionNarrow != 1.f)
	{
		// The sheet closed: the plate takes its width back.
		CaptionNarrow = 1.f;
		LayoutLampCaption();
	}
	if (!bFound) { Best = CaptionMaxLiftCm; BestSlide = 0.f; }
	CaptionLiftCm = Best;
	CaptionSlideCm = BestSlide;
	if (CaptionLiftCm != Was || CaptionSlideCm != WasSlide)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp caption rises %.1f cm%s clear of the tags and names%s%s"), CaptionLiftCm,
			CaptionSlideCm != 0.f ? *FString::Printf(TEXT(" and slides %.0f cm %s"), FMath::Abs(CaptionSlideCm), CaptionSlideCm < 0.f ? TEXT("left") : TEXT("right")) : TEXT(""), *How,
			bFound ? TEXT("") : TEXT(" (no clear place: it covers something)"));
		ApplyLampWidgets();
	}
}

void ABpTable::ApplyLampWidgets()
{
	const FVector Eye = EyeLocal();
	if (LampCaption)
	{
		// The talk's lines read on the console's conversation sheet (night two V2), not in this box, while it shows them.
		// bp.Captions 1 (SETTINGS › ACCESSIBILITY › CAPTIONS ALWAYS): every line the lamp says, on the site plan too.
		const IConsoleVariable* Always = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Captions"));
		const bool bShow = !LampLine.IsEmpty() && (!RoomModeId.IsEmpty() || bLampNotice || (Always && Always->GetInt() != 0)) && !(bTalkCaption && TalkOnConsole()) && !bSheetCaption;
		if (LampCaption->IsVisible() != bShow) LampCaption->SetVisibility(bShow);
		// Night two V4: the plate grows with its lines, upward from its old foot (plus 2 cm), so it never drops over the wing
		// names and the pin tags under it.
		const FVector At = CaptionAt();
		LampCaption->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(BpSheet::TextScale() / CaptionPxPerCm)));
		const float Fade = FMath::Clamp(LampCaptionClock / 0.4f, 0.f, 1.f);
		LampCaption->SetTintColorAndOpacity(FLinearColor(0.95f, 0.95f, 0.95f, Fade));
		LampCaption->SetTranslucentSortPriority(14);
	}
	if (LampRing)
	{
		FVector Head;
		const bool bShow = LampHead(Head) && !RoomModeId.IsEmpty() && (LampHoldFill > 0.f || !PendingSwitch.IsEmpty());
		if (LampRing->IsVisible() != bShow) LampRing->SetVisibility(bShow);
		if (!bShow) return;
		const FVector At = GetActorTransform().InverseTransformPosition(Head);
		const FVector Near = At + (Eye - At).GetSafeNormal() * 3.0;
		LampRing->SetRelativeTransform(FTransform((Eye - Near).Rotation(), Near, FVector(LampRingCm / 240.0)));
		const float Fill = PendingSwitch.IsEmpty() ? LampHoldFill : 1.f;
		if (FMath::Abs(Fill - ShownHoldFill) >= 0.01f)
		{
			ShownHoldFill = Fill;
			LampRing->SetSlateWidget(SNew(SBpHoldRing).Fill(Fill));
			LampRing->RequestRedraw();
		}
		LampRing->SetTranslucentSortPriority(15);
	}
}

void ABpTable::SetLampHold(float Fraction)
{
	if (!PendingSwitch.IsEmpty()) return;
	const float Was = LampHoldFill;
	LampHoldFill = RoomModeId.IsEmpty() || !Lamp.IsValid() ? 0.f : FMath::Clamp(Fraction, 0.f, 1.f);
	if (LampHoldFill != Was) ApplyLampWidgets();
	if (LampHoldFill < 1.f) return;
	// Held: it turns to the person, names the next room and why, and the switch follows.
	FString Why;
	const FString Next = NextRoom(Why);
	const FBpPlanRoom* Room = FindRoom(Next);
	LampLookAt = EyeLocal();
	LampLookTarget = 1.f;
	if (!Room)
	{
		LampHoldFill = 0.f;
		SayLamp(TEXT("This is the only room"));
		return;
	}
	PendingSwitch = Next;
	PendingSwitchClock = CVarLampSwitchDelayS.GetValueOnGameThread();
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lamp held: next %s (%s), the switch in %.1f s"), *Next, *Why, PendingSwitchClock);
	SayLamp(FString::Printf(TEXT("Next: %s\n%s"), *Room->name, *Why));
}

void ABpTable::AskLamp(const FString& FeatureId)
{
	if (RoomModeId.IsEmpty() || !SheetPlan.IsValid())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused ask %s: not in room mode"), *FeatureId);
		return;
	}
	const FRoomSlot* Slot = RoomSlots.FindByPredicate([this, &FeatureId](const FRoomSlot& S) { return SheetPlan->tiles.IsValidIndex(S.Tile) && SheetPlan->tiles[S.Tile].id == FeatureId; });
	if (!Slot)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused ask %s: not on this room's map"), *FeatureId);
		return;
	}
	const FBpPlanTile& Tile = SheetPlan->tiles[Slot->Tile];
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	// Its open findings and the most urgent tier among them.
	int32 Open = 0, Top = 4;
	for (const FBpProposal& Proposal : State.Scan.proposals)
	{
		if (Proposal.status != TEXT("proposed") || Proposal.feature != FeatureId) continue;
		++Open;
		if (const int32* Tier = State.Tiers.Find(Proposal.id)) Top = FMath::Min(Top, *Tier);
	}
	const FString Findings = Open == 0 ? FString(TEXT("nothing open")) : FString::Printf(TEXT("%d open%s"), Open, Top < 4 ? *FString::Printf(TEXT(" (T%d)"), Top) : TEXT(""));
	// Its health by lens, as the plan reads it: the lenses in trouble, else the ones to watch, else all good.
	TArray<FString> Bad, Watch;
	int32 Good = 0;
	for (const FString& Lens : SheetPlan->lenses)
	{
		const FString* Reading = Tile.health.Find(Lens);
		if (!Reading) continue;
		if (*Reading == TEXT("bad")) Bad.Add(BpWords::Lens(Lens));
		else if (*Reading == TEXT("watch")) Watch.Add(BpWords::Lens(Lens));
		else if (*Reading == TEXT("good")) ++Good;
	}
	const FString Health = Bad.Num() > 0 ? FString::Join(Bad, TEXT(", ")) + TEXT(" bad") : Watch.Num() > 0 ? FString::Join(Watch, TEXT(", ")) + TEXT(" to watch")
		: Good > 0 ? FString(TEXT("all lenses good")) : FString(TEXT("not measured"));
	// Its last scan: the newest measurement on it.
	FString Last;
	for (const FBpMeasurement& Row : State.Scan.measurements)
	{
		if (Row.feature == FeatureId && Row.measured_at > Last) Last = Row.measured_at;
	}
	const FString Scan = Last.IsEmpty() ? FString(TEXT("never scanned")) : TEXT("last scan ") + Last.Left(10);
	LampLookAt = WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(Slot->GlyphBox.GetCenter(), 0.f));
	LampLookTarget = 1.f;
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: ask %s"), *FeatureId);
	++TourAsks;
	PresentLamp(LampLookAt, TEXT("ask"));
	SayLamp(FString::Printf(TEXT("%s:\n%s · %s · %s"), *Tile.name, *Findings, *Health, *Scan));
}

bool ABpTable::TickSwitch(float DeltaSeconds)
{
	bool bBusy = false;
	// The lamp's tour (BpTour.cpp) reads where the table is, at whatever rate the actor ticks.
	TickTour();
	const bool bReduced = SwitchReduced();
	// A ride along the edges (BpLampTravel.cpp), or its settle.
	bBusy |= TickLampTravel(DeltaSeconds);
	// Its manner: to the person while it listens or speaks, a nod on a decision answered (BpLampLook.cpp, V3).
	bBusy |= TickLampManner(DeltaSeconds);
	// The lamp to its place and turn.
	const float WasAway = LampAway, WasLook = LampLook;
	if (LampAway != LampAwayTarget) LampAway = bReduced ? LampAwayTarget : FMath::FInterpConstantTo(LampAway, LampAwayTarget, DeltaSeconds, 1.f / LampMoveS);
	if (LampLook != LampLookTarget) LampLook = bReduced ? LampLookTarget : FMath::FInterpConstantTo(LampLook, LampLookTarget, DeltaSeconds, 1.f / LampTurnS);
	if (LampAway != WasAway || LampLook != WasLook || (WasAway == 0.f && bLampMovable && LampAway <= 0.f && LampLook <= 0.f))
	{
		PlaceLamp();
		ApplyLampWidgets();
	}
	bBusy |= LampAway != LampAwayTarget || LampLook != LampLookTarget;
	// The caption's time, then the lamp turns back.
	if (LampCaptionClock > 0.f)
	{
		LampCaptionClock -= DeltaSeconds;
		if (LampCaptionClock <= 0.f)
		{
			LampCaptionClock = 0.f;
			LampLine.Reset();
			bLampNotice = false;
			LampLookTarget = 0.f;
			if (bTalkCaption) { bTalkCaption = false; TalkCaptionEnded(); }
			// The answer has had its time: its offer lapses, and the lamp goes back to rest.
			if (LampOffer != ELampOffer::None) { ClearLampOffer(); LampNotifyAsk(); }
			// A scan the theatre follows keeps the lamp at its room (BpScanTheatre.cpp); it goes home when the scan ends.
			if (TourStep < 0 && !bTheatreLamp && (bLampAtStation || LampTravelT >= 0.f)) LampGoHome(TEXT("caption ended"));
		}
		ApplyLampWidgets();
		bBusy = true;
	}
	// The lamp's switch.
	if (!PendingSwitch.IsEmpty())
	{
		PendingSwitchClock -= DeltaSeconds;
		bBusy = true;
		if (PendingSwitchClock <= 0.f)
		{
			const FString Next = PendingSwitch;
			PendingSwitch.Reset();
			LampHoldFill = 0.f;
			ApplyLampWidgets();
			SwitchRoom(Next, TEXT("lamp"));
		}
	}
	// BpRoom.Lasso's loop, drawn point by point, then closed.
	if (LassoAutoT >= 0.f)
	{
		bBusy = true;
		LassoAutoT += DeltaSeconds;
		const float DrawS = FMath::Max(CVarLassoDrawS.GetValueOnGameThread(), 0.01f);
		const int32 Upto = bReduced ? LassoAuto.Num() : FMath::Min(LassoAuto.Num(), FMath::CeilToInt(LassoAuto.Num() * LassoAutoT / DrawS));
		for (int32 Index = LassoAutoFed; Index < Upto; ++Index) LassoPoint(LassoAuto[Index]);
		LassoAutoFed = FMath::Max(LassoAutoFed, Upto);
		if (Upto >= LassoAuto.Num())
		{
			LassoAutoT = -1.f;
			LassoEnd();
		}
	}
	// A closed loop and its picks stay lit, then fade.
	if (LassoLit > 0.f)
	{
		LassoLit -= DeltaSeconds;
		bBusy = true;
		const float Show = FMath::Clamp(LassoLit / 0.5f, 0.f, 1.f);
		if (LassoPicks)
		{
			for (int32 Index = 0; Index < LassoPicks->GetInstanceCount(); ++Index) LassoPicks->SetCustomDataValue(Index, 3, DeckLightShow * Show, false);
			LassoPicks->MarkRenderStateDirty();
		}
		if (LassoLit <= 0.f)
		{
			LassoLit = 0.f;
			if (LassoBars) LassoBars->ClearInstances();
			if (LassoPicks) LassoPicks->ClearInstances();
		}
	}
	return bBusy || bLassoDrawing;
}

// ---- The flat view's pointing ---------------------------------------------------------------------------------------

void ABpTable::ShowPointer(bool bShow, const FVector& WorldTo)
{
	if (bShow)
	{
		// The posed right hand's tip to the point; on a feature's slot to its near edge, so the hand lies over as little of
		// the map as it can (FAH: aimed at a glyph, it lay over every name past it).
		FVector Local = GetActorTransform().InverseTransformPosition(WorldTo);
		const FVector2D On(Local.Y + PaperWidthCm * 0.5, PaperDepthCm * 0.5 - Local.X);
		if (const FRoomSlot* Slot = RoomSlots.FindByPredicate([&On](const FRoomSlot& S) { return S.Box.IsInside(On); }))
		{
			Local = WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(FVector2D(Slot->Box.GetCenter().X, Slot->Box.Max.Y - 1.5), 0.f));
		}
		AimCaptureTip(Local);
		DeckAimedTile = TEXT("*hold");
		return;
	}
	// Back to the key plan's room (ApplyDeckLight aims it there when what it aimed at is not the room shown).
	if (DeckAimedTile == TEXT("*hold"))
	{
		DeckAimedTile.Reset();
		ApplyDeckLight();
	}
}

// ---- The lasso --------------------------------------------------------------------------------------------------------

bool ABpTable::PaperAt(const FVector& WorldOrigin, const FVector& WorldDir, FVector2D& OutPaperCm) const
{
	const FTransform& Actor = GetActorTransform();
	const FVector Origin = Actor.InverseTransformPosition(WorldOrigin), Dir = Actor.InverseTransformVector(WorldDir);
	if (FMath::IsNearlyZero(Dir.Z)) return false;
	const double T = (PlacedHeightCm - GlassRecessCm - Origin.Z) / Dir.Z;
	if (T < 0.0) return false;
	const FVector Point = Origin + Dir * T;
	OutPaperCm = FVector2D(Point.Y + PaperWidthCm * 0.5, PaperDepthCm * 0.5 - Point.X);
	return true;
}

FVector ABpTable::PaperToWorld(const FVector2D& PaperCm) const
{
	return GetActorTransform().TransformPosition(FVector(PaperDepthCm * 0.5 - PaperCm.Y, PaperCm.X - PaperWidthCm * 0.5, PlacedHeightCm - GlassRecessCm));
}

void ABpTable::LassoBegin()
{
	if (RoomModeId.IsEmpty()) return;
	LassoPath.Reset();
	LassoLength = 0.0;
	bLassoStroke = true;
	bLassoDrawing = false;
	LassoLit = 0.f;
	if (LassoBars) LassoBars->ClearInstances();
	if (LassoPicks) LassoPicks->ClearInstances();
}

void ABpTable::LassoPoint(const FVector2D& PaperCm)
{
	if (!bLassoStroke) return;
	if (LassoPath.Num() > 0)
	{
		const double Step = FVector2D::Distance(LassoPath.Last(), PaperCm);
		if (Step < LassoStepCm) return;
		LassoLength += Step;
	}
	LassoPath.Add(PaperCm);
	if (!bLassoDrawing && LassoLength >= LassoStartCm)
	{
		bLassoDrawing = true;
		SetActorTickInterval(0.f);
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso drawing from (%.1f, %.1f)"), LassoPath[0].X, LassoPath[0].Y);
	}
	if (bLassoDrawing) DrawLasso(false, LassoShow);
}

bool ABpTable::LassoEnd()
{
	const bool bWas = bLassoDrawing;
	bLassoStroke = false;
	bLassoDrawing = false;
	if (!bWas)
	{
		LassoPath.Reset();
		return false;
	}
	DrawLasso(true, LassoShow);
	CommitLasso();
	LassoLit = LassoHoldS;
	SetActorTickInterval(0.f);
	return true;
}

void ABpTable::DrawLasso(bool bClosed, float Show)
{
	if (!LassoBars) return;
	// One glowing bar per step of the stroke (paper u along the table's +Y, v along -X), and the closing one.
	const auto Bar = [this, Show](const FVector2D& A, const FVector2D& B, TArray<FTransform>& Places, TArray<float>& Data)
	{
		const FVector LA = PaperCmToLocal(A, LassoLineCm * 0.5f), LB = PaperCmToLocal(B, LassoLineCm * 0.5f);
		const FVector Along = LB - LA;
		const double Len = Along.Size() + LassoLineCm;
		Places.Add(FTransform(FRotator(0.f, FMath::RadiansToDegrees(FMath::Atan2(Along.Y, Along.X)), 0.f), (LA + LB) * 0.5, FVector(Len, LassoLineCm, LassoLineCm) / 100.0));
		Data.Append({ static_cast<float>(Len), LassoLineCm, LassoLineCm, Show, 0.f });
	};
	TArray<FTransform> Places;
	TArray<float> Data;
	const int32 From = bClosed ? 0 : LassoBars->GetInstanceCount();
	for (int32 Index = FMath::Max(From, 0) + 1; Index < LassoPath.Num(); ++Index) Bar(LassoPath[Index - 1], LassoPath[Index], Places, Data);
	if (bClosed && LassoPath.Num() > 2) Bar(LassoPath.Last(), LassoPath[0], Places, Data);
	if (bClosed) LassoBars->ClearInstances();
	if (Places.Num() == 0) return;
	const int32 First = LassoBars->GetInstanceCount();
	LassoBars->AddInstances(Places, false, false, false);
	LassoBars->SetCustomData(First, First + Places.Num() - 1, Data, true);
	LassoBars->SetRelativeTransform(WingGroupTransform(0.f));
}

void ABpTable::CommitLasso()
{
	if (!SheetPlan.IsValid() || RoomModeId.IsEmpty() || LassoPath.Num() < 3) return;
	// The glyphs whose centre the loop holds, and their open findings (this session's declines left out).
	TSet<FString> Inside;
	TArray<FTransform> Lit;
	TArray<float> LitData;
	LassoPicked.Reset();
	for (const FRoomSlot& Slot : RoomSlots)
	{
		if (!SheetPlan->tiles.IsValidIndex(Slot.Tile) || !InsideLoop(LassoPath, Slot.GlyphBox.GetCenter())) continue;
		const FString& Id = SheetPlan->tiles[Slot.Tile].id;
		Inside.Add(Id);
		LassoPicked.Add(Id);
		const FBox2D Box = Slot.Box.ExpandBy(-0.35);
		const FVector Size(Box.GetSize().Y, Box.GetSize().X, DeckLightCm);
		Lit.Add(FTransform(FQuat::Identity, PaperCmToLocal(Box.GetCenter(), DeckLightCm * 0.5f), Size / 100.0));
		LitData.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), DeckLightShow, 0.35f });
	}
	if (LassoPicks)
	{
		LassoPicks->ClearInstances();
		if (Lit.Num() > 0)
		{
			LassoPicks->AddInstances(Lit, false, false, false);
			LassoPicks->SetCustomData(0, Lit.Num() - 1, LitData, true);
		}
		LassoPicks->SetRelativeTransform(WingGroupTransform(0.f));
	}
	TArray<FString> Findings;
	for (const FBpProposal& Proposal : FBpLinkModule::Get().GetScanState().Scan.proposals)
	{
		if (Proposal.status == TEXT("proposed") && Inside.Contains(Proposal.feature) && !DeckDeclined.Contains(Proposal.id)) Findings.Add(Proposal.id);
	}
	LassoLine = FString::Printf(TEXT("%d features [%s], %d open findings [%s]"), LassoPicked.Num(), *FString::Join(LassoPicked, TEXT(",")), Findings.Num(), *FString::Join(Findings, TEXT(",")));
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso closed round %d points: %s"), LassoPath.Num(), *LassoLine);
	if (Findings.Num() == 0)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso holds no open finding; nothing written"));
		return;
	}
	// The guard (as Approve's): the lasso only ever writes the draft; BpLink's SendWave refuses a dispatch route.
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso -> %s's draft wave (compose or PATCH; the table never dispatches a wave, on any product)"), *FBpLinkModule::Get().GetProductSlug());
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().AddToDraft(Findings, [Self, Findings](bool bOk, const FString& Wave, const FString& Note)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso %s"), bOk ? *FString::Printf(TEXT("in draft %s"), *Wave) : TEXT("not written"));
		if (!bOk || !Self.IsValid()) return;
		Self->LassoLine += FString::Printf(TEXT(" -> draft %s"), *Wave);
		for (const FString& Id : Findings) Self->DeckInDraft.Add(Id);
		Self->RefreshDeck();
	});
}

TArray<FVector2D> ABpTable::LassoLoop(const TArray<FString>& FeatureIds) const
{
	TArray<FVector2D> Loop;
	if (!SheetPlan.IsValid()) return Loop;
	// The asked features' slots (their glyph and name, LassoInsetCm in from the slot's outline), their hull, and LassoPadCm
	// round it: the hull's edges pushed out, its corners rounded (FAI: round the glyphs alone the loop ran through the names).
	TArray<FVector2D> Corners;
	for (const FRoomSlot& Slot : RoomSlots)
	{
		if (!SheetPlan->tiles.IsValidIndex(Slot.Tile) || !FeatureIds.Contains(SheetPlan->tiles[Slot.Tile].id)) continue;
		const FBox2D B = Slot.Box.ExpandBy(-LassoInsetCm);
		Corners.Append({ B.Min, FVector2D(B.Max.X, B.Min.Y), B.Max, FVector2D(B.Min.X, B.Max.Y) });
	}
	if (Corners.Num() == 0) return Loop;
	const TArray<FVector2D> H = Hull(Corners);
	TArray<FVector2D> Round;
	for (int32 Index = 0; Index < H.Num(); ++Index)
	{
		const FVector2D& Prev = H[(Index + H.Num() - 1) % H.Num()];
		const FVector2D& Here = H[Index];
		const FVector2D& Next = H[(Index + 1) % H.Num()];
		// The outward normals of the edge in and the edge out (the hull runs one way round), and the arc between them.
		const FVector2D In = (Here - Prev).GetSafeNormal(), Out = (Next - Here).GetSafeNormal();
		const FVector2D N0(In.Y, -In.X), N1(Out.Y, -Out.X);
		double A0 = FMath::Atan2(N0.Y, N0.X), A1 = FMath::Atan2(N1.Y, N1.X);
		while (A1 < A0) A1 += UE_TWO_PI;
		if (A1 - A0 > UE_PI) { const double Swap = A0; A0 = A1 - UE_TWO_PI; A1 = Swap; }
		const int32 Steps = FMath::Max(1, FMath::CeilToInt((A1 - A0) / FMath::DegreesToRadians(15.0)));
		for (int32 Step = 0; Step <= Steps; ++Step)
		{
			const double A = A0 + (A1 - A0) * Step / Steps;
			Round.Add(Here + LassoPadCm * FVector2D(FMath::Cos(A), FMath::Sin(A)));
		}
	}
	// Evenly every LassoStepCm along it, so a drawn stroke and the synthetic hand's path advance at an even pace.
	for (int32 Index = 0; Index < Round.Num(); ++Index)
	{
		const FVector2D& A = Round[Index];
		const FVector2D& B = Round[(Index + 1) % Round.Num()];
		const int32 Steps = FMath::Max(1, FMath::FloorToInt(FVector2D::Distance(A, B) / LassoStepCm));
		for (int32 Step = 0; Step < Steps; ++Step) Loop.Add(FMath::Lerp(A, B, static_cast<double>(Step) / Steps));
	}
	return Loop;
}

bool ABpTable::LassoFeatures(const TArray<FString>& FeatureIds)
{
	if (RoomModeId.IsEmpty() || ShownRoomMode != RoomModeId)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused lasso: not in room mode (or the map is not in yet)"));
		return false;
	}
	LassoAuto = LassoLoop(FeatureIds);
	if (LassoAuto.Num() < 3)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpRoom: refused lasso: none of [%s] is on this room's map"), *FString::Join(FeatureIds, TEXT(",")));
		LassoAuto.Reset();
		return false;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpRoom: lasso round [%s]: %d points over %.1f s"), *FString::Join(FeatureIds, TEXT(",")), LassoAuto.Num(), CVarLassoDrawS.GetValueOnGameThread());
	LassoBegin();
	LassoAutoT = 0.f;
	LassoAutoFed = 0;
	SetActorTickInterval(0.f);
	return true;
}
