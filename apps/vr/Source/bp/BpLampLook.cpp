// The lamp's look, its home and the studio floor (night two V1). Everything here writes only when what it reads changed, so
// at rest it costs a few comparisons per table tick and no draw beyond the floor's one quad.
//   - On the Quest tier (bp.Lamp.SelfLit 1; 2 everywhere, 0 never) every lamp slot on M_LampAgentFid draws M_QuestLamp
//     (v1_scene.py): unlit, legacy material inputs, a fixed key and its own glow. The Fid master is an explicit Substrate
//     Slab, and on the mobile base pass an explicit Substrate opaque material writes scene alpha 1 where every
//     legacy-converted one writes 0; over the passthrough underlay (bp.Room 1) that alpha let the real room through the
//     whole lamp (the device's "invisible lamp", 2026-11-10). Unlit, it is also a light source that no studio light has to
//     reach as it travels.
//   - The light states, on the voice wave's hooks (TalkLampState) and the lamp's own (its offer, its caption, a voice line):
//     idle breathes slowly, waiting on you beckons in amber, listening turns to the console's cyan, thinking pales and
//     quickens, answering is bright with a speech-rate flutter. The pulse runs in the material's clock (no tick); a state
//     sets GlowColor, PulseHz, PulseAmp and HotColor once, the halo's colour and the lamp's point light's colour (never its
//     intensity: BpTalk drives that while listening). bp.ReducedMotion keeps the colours and stills the pulse.
//   - Home: bp.Lamp.HomeX / HomeY (table cm) move its site place clear of the console's slot, turned toward the seat.
//   - The studio floor: one unlit quad (M_StudioFloor, T_StudioFloor) under the table, following it. It is no part of
//     the table, so your room (BpSurround.cpp) hides it with the studio. bp.Floor, bp.Floor.Gain.
//   - bp.EngineWarnings 0 (default) suppresses the renderer's on-screen map warnings, among them the non-Shipping stereo
//     lines "StereoView: Instanced / Stereo rendering method: Multi-view (mobile)" (SceneRendering.cpp) that hung red in
//     the headset's upper left.
#include "BpTable.h"

#include "BpSurround.h"
#include "BpTier.h"
#include "Components/PointLightComponent.h"
#include "Components/RectLightComponent.h"
#include "BpPawn.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/StrongObjectPtr.h"

namespace
{
	TAutoConsoleVariable<int32> CVarLampSelfLit(TEXT("bp.Lamp.SelfLit"), 1,
		TEXT("The lamp's self-lit material (M_QuestLamp): 1 on the Quest tier (default), 2 always, 0 never (its lit Substrate master; invisible over passthrough on the headset). Read live."));
	TAutoConsoleVariable<float> CVarLampSelfLight(TEXT("bp.Lamp.SelfLight"), 1.f,
		TEXT("The self-lit lamp's body brightness, 0 to 3 (1: as tuned against the studio at night). Read live."));
	TAutoConsoleVariable<float> CVarLampGlow(TEXT("bp.Lamp.Glow"), 1.f, TEXT("The self-lit lamp's hood and lens glow, 0 to 3. Read live."));
	TAutoConsoleVariable<float> CVarLampPulse(TEXT("bp.Lamp.Pulse"), 1.f,
		TEXT("The light states' pulse depth, 0 (steady) to 2; bp.ReducedMotion 1 stills it. Read live."));
	TAutoConsoleVariable<int32> CVarLampState(TEXT("bp.Lamp.State"), -1,
		TEXT("Forces the lamp's light state for a capture: -1 follows the talk (default), 0 idle, 1 waiting on you, 2 listening, 3 thinking, 4 answering, 5 scanning (the lens colour of a scan the lamp follows)."));
	TAutoConsoleVariable<float> CVarLampHomeX(TEXT("bp.Lamp.HomeX"), 26.f,
		TEXT("The lamp's site home along the table (cm from its centre, + far), 10 to 45. Read live while it is home."));
	TAutoConsoleVariable<float> CVarLampHomeY(TEXT("bp.Lamp.HomeY"), -56.f,
		TEXT("The lamp's site home across the table (cm from its centre, - left), -115 to 115; V1 had -46 (over wing A's name), the level -9 (under the console's bar). Read live while it is home."));
	TAutoConsoleVariable<float> CVarLampHomeZ(TEXT("bp.Lamp.HomeZ"), 8.f,
		TEXT("The lamp's site home hovers this far over the level's height (cm), 0 to 40. Read live while it is home."));
	TAutoConsoleVariable<int32> CVarLampHomeClear(TEXT("bp.Lamp.HomeClear"), 1,
		TEXT("0 (default, V3 by capture: at HomeX/Y/Z the hovering lamp clears every wing name and pin tag from the seat, its body above the tag row); 1: at home the lamp steps outward until, from the seated eye, all of it stands left of the paper's far-left corner, where no wing name, raised wing or pin tag can be behind it (the tags stay inside the paper's corners), which with the lamp's pointing arm puts it at the edge of the view."));
	TAutoConsoleVariable<int32> CVarLampFace(TEXT("bp.Lamp.Face"), -1,
		TEXT("The lamp turns to the person: -1 while it listens or speaks (default; a glance only while it shows something), 0 never, 1 always (captures). bp.ReducedMotion 1 stills it."));
	TAutoConsoleVariable<float> CVarLampNodDeg(TEXT("bp.Lamp.NodDeg"), 7.f,
		TEXT("The lamp's nod on a stand-up decision answered: its bow in degrees, 0 (none) to 15. bp.ReducedMotion 1 stills it."));
	TAutoConsoleVariable<int32> CVarFrameStrips(TEXT("bp.Frame.StripLights"), 0,
		TEXT("The four rect lights along the paper's edges (StripNear/Far/Left/Right) while the Quest tier is on: 0 off (default; on the Quest's mobile path StripNear lit a blown spot on the frame's near rim), 1 as authored. Off the tier they always stay."));
	TAutoConsoleVariable<float> CVarFrameTone(TEXT("bp.Frame.Tone"), 0.7f,
		TEXT("The frame's body and trim base colour on the Quest tier, as a share of BpTable's (0.2 to 1.5, default 0.7: a calm dark finish). Read live."));
	TAutoConsoleVariable<int32> CVarFrameSelfLit(TEXT("bp.Frame.SelfLit"), 1,
		TEXT("The frame and legs on the Quest tier: 1 (default) M_QuestFrame, unlit with its own fixed key, a darker underside and a highlight along the top front edge, so the frame looks the same in the studio and in your room with no light reaching it; 0 M_QuestLit (lit by whatever light reaches it). Read live."));
	TAutoConsoleVariable<float> CVarFrameLight(TEXT("bp.Frame.Light"), 0.6f,
		TEXT("The self-lit frame's brightness (M_QuestFrame's Light), 0.1 to 5, default 0.6 (by capture from the seat: the rail's top reads 40 of 255 where the lit frame read 48 in the studio, its top front edge 77, its underside 29). Read live."));
	TAutoConsoleVariable<float> CVarFrameBevel(TEXT("bp.Frame.Bevel"), 0.5f,
		TEXT("The self-lit frame's highlight along its top front edge, 0 (none) to 1.5, default 0.5. Read live."));
	TAutoConsoleVariable<float> CVarRoomShadow(TEXT("bp.Room.Shadow"), 0.3f,
		TEXT("Your room: the table's contact shadow on the floor, its darkness at the centre 0 (none, not drawn) to 1, default 0.3; it falls to nothing 25 cm beyond the legs. One unlit translucent quad, drawn only in your room. Read live."));
	TAutoConsoleVariable<int32> CVarFloor(TEXT("bp.Floor"), 1, TEXT("The studio floor under the table (one unlit quad): 1 shown, 0 hidden. Your room hides it with the studio."));
	TAutoConsoleVariable<float> CVarFloorGain(TEXT("bp.Floor.Gain"), 0.15f, TEXT("The studio floor's brightness, 0 to 1.5. Read live."));
	TAutoConsoleVariable<int32> CVarEngineWarnings(TEXT("bp.EngineWarnings"), 0,
		TEXT("The renderer's on-screen map warnings (the stereo method lines in non-Shipping builds among them): 0 suppressed (default), 1 shown."));

	const TCHAR* const QuestLampPath = TEXT("/Game/Bp/Materials/M_QuestLamp.M_QuestLamp");
	const TCHAR* const FloorMaterialPath = TEXT("/Game/Bp/Materials/M_StudioFloor.M_StudioFloor");
	const TCHAR* const QuestFramePath = TEXT("/Game/Bp/Materials/M_QuestFrame.M_QuestFrame");
	const TCHAR* const ContactShadowPath = TEXT("/Game/Bp/Materials/M_ContactShadow.M_ContactShadow");
	/** The contact shadow (V5): the legs' footprint (v1_scene.py's LEGS, centres at x +-36.5, y +-75, 5 cm across, so their
	 *  outer edges at +-39 and +-77.5), the shadow falling to nothing ShadowFeatherCm beyond it, the quad a little larger. */
	const FVector2D ShadowFootHalfCm(39.0, 77.5);
	constexpr double ShadowFeatherCm = 25.0;
	constexpr double ShadowLiftCm = 0.4;
	const TCHAR* const PlanePath = TEXT("/Engine/BasicShapes/Plane.Plane");
	const TCHAR* const FidMaster = TEXT("M_LampAgentFid");
	const FName LampHaloTag(TEXT("BpAgentHalo"));
	/** v1_scene.py's FLOOR_CM: the floor texture's square, centred on the table. */
	constexpr double FloorCm = 520.0;
	constexpr double FloorLiftCm = 0.3;

	/** A light state's look: the glow's colour, its core's, the pulse, and a brightness factor. */
	struct FLampLookState
	{
		const TCHAR* Name;
		FLinearColor Glow;
		FLinearColor Hot;
		float PulseHz;
		float PulseAmp;
		float Gain;
	};
	// Linear colours. Idle is the level's #FFA85A warm amber; waiting the attention amber #FFB547; listening the console's
	// cyan #BFE8FF; thinking a paler, whiter gold; answering bright warm white.
	const FLampLookState States[] = {
		{ TEXT("idle"),      FLinearColor(1.00f, 0.39f, 0.10f), FLinearColor(1.00f, 0.86f, 0.62f), 0.20f, 0.10f, 1.00f },
		{ TEXT("waiting"),   FLinearColor(1.00f, 0.46f, 0.06f), FLinearColor(1.00f, 0.80f, 0.45f), 0.60f, 0.28f, 1.05f },
		{ TEXT("listening"), FLinearColor(0.52f, 0.80f, 1.00f), FLinearColor(0.85f, 0.95f, 1.00f), 0.00f, 0.00f, 1.00f },
		{ TEXT("thinking"),  FLinearColor(1.00f, 0.72f, 0.38f), FLinearColor(1.00f, 0.95f, 0.85f), 1.30f, 0.35f, 0.95f },
		{ TEXT("answering"), FLinearColor(1.00f, 0.55f, 0.22f), FLinearColor(1.00f, 0.96f, 0.86f), 3.20f, 0.14f, 1.30f },
		// Wave C1: reading a room for a scan, its glow the lens's accent (TheatreTint replaces this colour), a slow sweep pulse.
		{ TEXT("scanning"),  FLinearColor(0.04f, 0.58f, 1.00f), FLinearColor(0.90f, 0.97f, 1.00f), 0.80f, 0.18f, 1.15f },
	};

	bool LookReduced()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}

	void CopyScalar(const UMaterialInterface& From, UMaterialInstanceDynamic& To, const TCHAR* Name)
	{
		float Value = 0.f;
		if (From.GetScalarParameterValue(FHashedMaterialParameterInfo(FName(Name)), Value)) To.SetScalarParameterValue(Name, Value);
	}

	void CopyVector(const UMaterialInterface& From, UMaterialInstanceDynamic& To, const TCHAR* Name)
	{
		FLinearColor Value;
		if (From.GetVectorParameterValue(FHashedMaterialParameterInfo(FName(Name)), Value)) To.SetVectorParameterValue(Name, Value);
	}

	void CopyTexture(const UMaterialInterface& From, UMaterialInstanceDynamic& To, const TCHAR* Name)
	{
		UTexture* Value = nullptr;
		if (From.GetTextureParameterValue(FHashedMaterialParameterInfo(FName(Name)), Value) && Value) To.SetTextureParameterValue(Name, Value);
	}
}

/** What the lamp's look holds: the swapped slots and their originals (assets, held), the state shown, the floor. Nothing of
 *  the world is held strongly, and EndPlay drops it all, so no PIE world outlives its session. */
struct FBpLampLook
{
	struct FSlot
	{
		int32 Index = 0;
		TStrongObjectPtr<UMaterialInterface> Original;
		TWeakObjectPtr<UMaterialInstanceDynamic> Self;
	};
	TWeakObjectPtr<UStaticMeshComponent> Mesh;
	TArray<FSlot> Slots;
	bool bSelfLit = false;
	float SelfLight = -1.f, Glow = -1.f, Pulse = -1.f;
	bool bReduced = false;
	int32 State = -1;
	FLinearColor Tint = FLinearColor::Transparent;
	TWeakObjectPtr<UPointLightComponent> Light;
	FLinearColor LightColour = FLinearColor::White;
	TWeakObjectPtr<UMaterialInstanceDynamic> Halo;
	FLinearColor HaloColour = FLinearColor::White;
	float HomeX = TNumericLimits<float>::Max(), HomeY = TNumericLimits<float>::Max(), HomeZ = TNumericLimits<float>::Max();
	int32 HomeClear = -1;
	/** The step aside ApplyLampHome last placed the lamp at (table cm from home). */
	FVector2D StepApplied = FVector2D::ZeroVector;
	/** The level's lamp height (table cm), read once: HomeZ hovers over it. */
	double BaseZ = TNumericLimits<double>::Max();
	/** The strip rect lights (found once, by place: at the top's height inside the frame), and whether they show. */
	TArray<TWeakObjectPtr<USceneComponent>> Strips;
	int32 StripsShown = -1;
	bool bStripsFound = false;
	/** The frame's body and trim slots' material as last toned, and the tone. */
	TWeakObjectPtr<UMaterialInterface> FrameToned[2];
	float FrameTone = -1.f;
	/** V5: the frame's slots on M_QuestFrame, each with the material it replaced (held: a dynamic instance nothing else keeps). */
	struct FFrameSlot
	{
		int32 Index = 0;
		TStrongObjectPtr<UMaterialInterface> Was;
		TWeakObjectPtr<UMaterialInstanceDynamic> Self;
	};
	TArray<FFrameSlot> FrameSelf;
	float FrameLight = -1.f, FrameBevel = -1.f;
	bool bSaidNoFrame = false;
	/** V5: your room's contact shadow, and the darkness last written. */
	TWeakObjectPtr<AActor> Shadow;
	TWeakObjectPtr<UMaterialInstanceDynamic> ShadowMid;
	float ShadowShown = -1.f;
	TWeakObjectPtr<AActor> Floor;
	TWeakObjectPtr<UMaterialInstanceDynamic> FloorMid;
	FTransform FloorAt;
	int32 FloorShown = -1;
	float FloorGain = -1.f;
	int32 Warnings = -1;
};

void ABpTable::ApplyLampHome()
{
	if (!Lamp.IsValid()) return;
	if (!LampLookState.IsValid()) LampLookState = MakeShared<FBpLampLook>();
	FBpLampLook& L = *LampLookState;
	const float WantX = FMath::Clamp(CVarLampHomeX.GetValueOnGameThread(), 10.f, 45.f);
	const float WantY = FMath::Clamp(CVarLampHomeY.GetValueOnGameThread(), -115.f, 115.f);
	const float WantZ = FMath::Clamp(CVarLampHomeZ.GetValueOnGameThread(), 0.f, 40.f);
	const int32 Clear = CVarLampHomeClear.GetValueOnGameThread() != 0 ? 1 : 0;
	// V5: the step aside (TickLampStep) is part of the home place; with HomeClear 0 there is none.
	const FVector2D Step = Clear ? LampStepCm : FVector2D::ZeroVector;
	const bool bOnlyStep = WantX == L.HomeX && WantY == L.HomeY && WantZ == L.HomeZ && Clear == L.HomeClear;
	if (bOnlyStep && Step == L.StepApplied) return;
	L.HomeX = WantX;
	L.HomeY = WantY;
	L.HomeZ = WantZ;
	L.HomeClear = Clear;
	L.StepApplied = Step;
	const FTransform& Table = GetActorTransform();
	FVector At = Table.InverseTransformPosition(LampRest.GetLocation());
	if (L.BaseZ == TNumericLimits<double>::Max()) L.BaseZ = At.Z;
	At.X = WantX + Step.X;
	At.Y = WantY + Step.Y;
	At.Z = L.BaseZ + WantZ;
	const FVector Eye = EyeLocal();
	// Turned toward a point a third of the way from the seat's eye to the paper's centre: it faces the person, not the bar.
	const FVector Face = FMath::Lerp(Eye, FVector(0.0, 0.0, GetPaperZ()), 1.0 / 3.0);
	const double Yaw = LampYawToward(At, Face);
	LampRest = FTransform(Table.GetRotation() * FQuat(FVector::UpVector, FMath::DegreesToRadians(Yaw)), Table.TransformPosition(At), LampRest.GetScale3D());
	for (int32 Index = 0; Index < LampGroup.Num(); ++Index)
	{
		LampGroupRest[Index] = LampGroupRel[Index] * LampRest;
		LampGroupMobility[Index] = static_cast<uint8>(EComponentMobility::Movable);
	}
	// Movable for good: its baked place is no longer its home (on the tier it is self-lit and needs no lightmap).
	LampMobility = static_cast<uint8>(EComponentMobility::Movable);
	if (Lamp->GetRootComponent()) Lamp->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	for (const TWeakObjectPtr<AActor>& Each : LampGroup)
	{
		if (Each.IsValid() && Each->GetRootComponent()) Each->GetRootComponent()->SetMobility(EComponentMobility::Movable);
	}
	bLampMovable = true;
	PlaceLamp();
	// The caption follows the lamp (ApplyLampWidgets reads LampStepCm).
	ApplyLampWidgets();
	if (!bOnlyStep) UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp home at table (%.0f, %.0f, +%.0f) yaw %.0f; steps aside %s"), WantX, WantY, static_cast<double>(WantZ), Yaw, Clear ? TEXT("on") : TEXT("off"));
}

// ---- The lamp steps aside (V5) ------------------------------------------------------------------------------------------
// At home, when from the seated eye the lamp's body (its bounds with the halo: the pointing arm is part of the mesh) would
// cover what must be read (SeatKeepouts: a pin tag, a wing name, the lifted wing or room, the lift's plate), it moves along
// a path down the table's left side and across its far side, to the nearest place where it covers none of them and its head
// stays in the comfortable view: within LampViewDeg of the seated rest gaze both ways (BpView.Fov's 30), or, where home itself
// is further out, no further than home. Where no place is clear it takes the one that covers least. It glides there and
// back (LampStepRate), a cut under bp.ReducedMotion; the target is judged every LampStepCheckS.
namespace
{
	constexpr double LampViewDeg = 30.0;
	constexpr double LampStepEveryCm = 2.0;
	/** The path: from home toward the near end of the left side (at most LampNearRunCm), and away: on to the far side's
	 *  line (table X LampFarLaneCm, the frame's far edge), then right along it (at most LampFarRightCm). */
	constexpr double LampNearRunCm = 30.0;
	constexpr double LampFarLaneCm = 46.0;
	constexpr double LampFarRightCm = 50.0;
	constexpr double LampStepCheckS = 0.15;
	constexpr float LampStepRate = 5.f;
	/** A cover smaller than this (square degrees) counts as none (a corner's touch). */
	constexpr double LampCoverFloor = 0.05;
}

bool ABpTable::TickLampStep(float DeltaSeconds)
{
	if (!Lamp.IsValid() || !LampLookState.IsValid() || CVarLampHomeClear.GetValueOnGameThread() == 0)
	{
		if (LampStepCm.IsZero() && LampStepWant.IsZero()) return false;
		LampStepCm = LampStepWant = FVector2D::ZeroVector;
		ApplyLampHome();
		return false;
	}
	FBpLampLook& L = *LampLookState;
	if (L.BaseZ == TNumericLimits<double>::Max()) return false;
	// Only at home on the site plan with nothing else moving it (a ride, a station, room mode, a turn to the person).
	const bool bHome = LampTravelT < 0.f && !bLampAtStation && RoomModeId.IsEmpty() && LampAway <= 0.f && LampLook <= 0.f && LampFace <= 0.f && LampNodT < 0.f;
	const double Now = FPlatformTime::Seconds();
	if (!bHome)
	{
		// Away from home (a station, a ride) the step is held; the caption still keeps clear on the site plan.
		const bool bStanding = bLampAtStation && LampTravelT < 0.f;
		if (Now - LampStepCheckAt >= LampStepCheckS)
		{
			LampStepCheckAt = Now;
			if (RoomModeId.IsEmpty()) UpdateCaptionLift();
			// V7: at a station, beside the console's slot rather than behind it (judged again as a sheet opens or closes).
			if (bStanding)
			{
				const double Want = StationAside(LampStationAtLocal, LampFaceTarget.Y);
				if (FMath::Abs(Want - LampAsideWant) > 0.5)
				{
					UE_LOG(LogBpTable, Log, TEXT("BpLampLook: at station %d the lamp stands %s (%.0f cm along the table's width)"), LampStation,
						FMath::IsNearlyZero(Want) ? TEXT("back on its station") : Want < 0.0 ? TEXT("left of the console's slot") : TEXT("right of the console's slot"), Want);
					LampAsideWant = Want;
				}
			}
		}
		if (!bStanding || LampAsideCm == LampAsideWant) return false;
		if (LookReduced()) LampAsideCm = LampAsideWant;
		else
		{
			LampAsideCm = FMath::FInterpTo(LampAsideCm, LampAsideWant, static_cast<double>(DeltaSeconds), static_cast<double>(LampStepRate));
			if (FMath::Abs(LampAsideCm - LampAsideWant) < 0.1) LampAsideCm = LampAsideWant;
		}
		PlaceLamp();
		ApplyLampWidgets();
		return LampAsideCm != LampAsideWant;
	}
	if (Now - LampStepCheckAt >= LampStepCheckS)
	{
		LampStepCheckAt = Now;
		const FTransform& Table = GetActorTransform();
		// The lamp's body where it stands, brought back to home (it stands at home + LampStepCm): the corners of its mesh's own
		// box as the mesh stands (an axis-aligned box of the turned mesh, with the halo's card, covered twice the lamp and
		// sent it away from places it did not cover; the soft halo is no body).
		const UStaticMeshComponent* BodyMesh = L.Mesh.Get();
		FVector HeadWorld;
		if (BodyMesh && BodyMesh->GetStaticMesh() && LampHead(HeadWorld))
		{
			const FVector Back(-LampStepCm.X, -LampStepCm.Y, 0.0);
			const FBox Own = BodyMesh->GetStaticMesh()->GetBoundingBox();
			const FTransform MeshT = BodyMesh->GetComponentTransform();
			FVector Body[8];
			Own.GetVertices(Body);
			for (FVector& C : Body) C = Table.InverseTransformPosition(MeshT.TransformPosition(C)) + Back;
			const FVector Head = Table.InverseTransformPosition(HeadWorld) + Back;
			TArray<FBox2D> Keep;
			SeatKeepouts(Keep);
			// The rest gaze (BpView.Fov): the eye toward the paper's centre.
			const FVector Eye = EyeLocal();
			const FVector Fwd = (FVector(0.0, 0.0, GetPaperZ()) - Eye).GetSafeNormal();
			const FVector Right = FVector::CrossProduct(FVector::UpVector, Fwd).GetSafeNormal();
			const FVector Up = FVector::CrossProduct(Fwd, Right);
			const auto ViewOff = [&](const FVector& P)
			{
				const FVector D = (P - Eye).GetSafeNormal();
				return FMath::Max(FMath::Abs(FMath::RadiansToDegrees(FMath::Atan2(FVector::DotProduct(D, Right), FVector::DotProduct(D, Fwd)))),
					FMath::Abs(FMath::RadiansToDegrees(FMath::Asin(FMath::Clamp(FVector::DotProduct(D, Up), -1.0, 1.0)))));
			};
			const double HomeOff = ViewOff(Head);
			const double ViewLimit = FMath::Max(LampViewDeg, HomeOff + 0.5);
			const auto Cover = [&](const FVector2D& Step)
			{
				FBox2D Seen(ForceInit);
				for (const FVector& C : Body)
				{
					const FVector D = C + FVector(Step, 0.0) - Eye;
					Seen += FVector2D(FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)), FMath::RadiansToDegrees(FMath::Atan2(D.Z, FVector2D(D.X, D.Y).Size())));
				}
				double Sum = 0.0;
				for (const FBox2D& K : Keep)
				{
					const double W = FMath::Min(Seen.Max.X, K.Max.X) - FMath::Max(Seen.Min.X, K.Min.X);
					const double H = FMath::Min(Seen.Max.Y, K.Max.Y) - FMath::Max(Seen.Min.Y, K.Min.Y);
					if (W > 0.0 && H > 0.0) Sum += W * H;
				}
				return Sum;
			};
			// Path length s: negative toward the near end, positive away, then right along the far side.
			const double FarRun = FMath::Max(0.0, LampFarLaneCm - L.HomeX);
			const auto StepAt = [FarRun](double S) { return S <= FarRun ? FVector2D(S, 0.0) : FVector2D(FarRun, S - FarRun); };
			FVector2D Best = FVector2D::ZeroVector;
			double BestCover = TNumericLimits<double>::Max(), BestS = TNumericLimits<double>::Max();
			const double Reach = FMath::Max(LampNearRunCm, FarRun + LampFarRightCm);
			for (double S = 0.0; S <= Reach + 1e-6; S += LampStepEveryCm)
			{
				for (const double Sign : { 1.0, -1.0 })
				{
					const double At = S * Sign;
					if (At < -LampNearRunCm - 1e-6 || At > FarRun + LampFarRightCm + 1e-6 || (S == 0.0 && Sign < 0.0)) continue;
					const FVector2D Step = StepAt(At);
					if (S > 0.0 && ViewOff(Head + FVector(Step, 0.0)) > ViewLimit) continue;
					const double C = Cover(Step);
					const double Score = C <= LampCoverFloor ? 0.0 : C;
					if (Score < BestCover - 1e-6)
					{
						Best = Step;
						BestCover = Score;
						BestS = S;
					}
				}
				// The nearest clear place is found: nothing further on can be nearer.
				if (BestCover == 0.0) break;
			}
			if (!Best.Equals(LampStepWant, 0.5))
			{
				UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp steps %s to home + (%.0f, %.0f) cm, %.0f cm along its path; head %.0f deg off the rest gaze at home%s"), Best.IsZero() ? TEXT("back") : TEXT("aside"),
					Best.X, Best.Y, BestS, HomeOff, BestCover > 0.0 ? *FString::Printf(TEXT(" (no clear place: it covers %.1f sq deg)"), BestCover) : TEXT(""));
				LampStepWant = Best;
			}
		}
		// Its caption: clear of the tags, the names and the lifted things, where the lamp stands now.
		UpdateCaptionLift();
	}
	if (LampStepCm == LampStepWant) return false;
	const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
	if (Reduced && Reduced->GetInt() != 0) LampStepCm = LampStepWant;
	else
	{
		LampStepCm = FMath::Vector2DInterpTo(LampStepCm, LampStepWant, DeltaSeconds, LampStepRate);
		if (FVector2D::Distance(LampStepCm, LampStepWant) < 0.1) LampStepCm = LampStepWant;
	}
	ApplyLampHome();
	return LampStepCm != LampStepWant;
}

bool ABpTable::ConsoleSeatBox(FBox2D& Out) const
{
	const APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
	const APawn* Pawn = PC ? PC->GetPawn() : nullptr;
	if (!Pawn) return false;
	TArray<UWidgetComponent*> Widgets;
	Pawn->GetComponents(Widgets);
	for (const UWidgetComponent* Widget : Widgets)
	{
		if (!Widget || Widget->GetName() != TEXT("ConsolePanel") || !Widget->IsVisible()) continue;
		// The quad's own four corners (its draw size about its pivot, in the component's space), not its world box.
		const FVector2D Size = Widget->GetDrawSize();
		const FVector2D Pivot = Widget->GetPivot();
		const FTransform& T = Widget->GetComponentTransform();
		const FTransform& Table = GetActorTransform();
		FBox Local(ForceInit);
		for (const FVector2D& C : { FVector2D(0.0, 0.0), FVector2D(1.0, 0.0), FVector2D(0.0, 1.0), FVector2D(1.0, 1.0) })
		{
			Local += Table.InverseTransformPosition(T.TransformPosition(FVector(0.0, (Pivot.X - C.X) * Size.X, (Pivot.Y - C.Y) * Size.Y)));
		}
		Out = SeatAngles(Local);
		return true;
	}
	return false;
}

namespace
{
	/** The clear margin between the lamp's body and the console's slot, degrees from the seat. */
	constexpr double LampSlotMarginDeg = 1.0;
	constexpr double LampAsideMaxCm = 110.0;
}

double ABpTable::StationAside(const FVector& StationLocal, double TargetY) const
{
	// Nothing to judge by (no lamp mesh, no head, no console shown): the step it has stays.
	if (!Lamp.IsValid() || !LampLookState.IsValid()) return LampAsideWant;
	const UStaticMeshComponent* BodyMesh = LampLookState->Mesh.Get();
	FVector HeadWorld;
	FBox2D Slot;
	if (!BodyMesh || !BodyMesh->GetStaticMesh() || !LampHead(HeadWorld)) return LampAsideWant;
	if (!ConsoleSeatBox(Slot)) return 0.0;
	const FTransform& Table = GetActorTransform();
	// The body and head in the lamp's own space, then stood at each candidate place turned to the thing it shows, as PlaceLamp
	// stands it at a station (its turn changes with the place: judged with the lamp's turn there, the step does not flip).
	const FTransform LampT = Lamp->GetActorTransform();
	const FBox Own = BodyMesh->GetStaticMesh()->GetBoundingBox();
	const FTransform MeshT = BodyMesh->GetComponentTransform();
	FVector Body[8];
	Own.GetVertices(Body);
	for (FVector& C : Body) C = LampT.InverseTransformPosition(MeshT.TransformPosition(C));
	const FVector HeadRel = LampT.InverseTransformPosition(HeadWorld);
	const double RestYaw = (Table.GetRotation().Inverse() * LampRest.GetRotation()).Rotator().Yaw;
	const FVector Aim = LampFaceTarget.IsZero() ? FVector(0.0, TargetY, GetPaperZ()) : LampFaceTarget;
	const auto StandAtPlace = [&](const FVector& At)
	{
		const FQuat Turn(FVector::UpVector, FMath::DegreesToRadians(LampYawToward(At, Aim) - RestYaw));
		return FTransform(Table.GetRotation() * Turn * Table.GetRotation().Inverse() * LampRest.GetRotation(), Table.TransformPosition(At), LampT.GetScale3D());
	};
	const auto StandAt = [&](double Dy) { return StandAtPlace(StationLocal + FVector(0.0, Dy, 0.0)); };
	const FVector Eye = EyeLocal();
	const FVector Fwd = (FVector(0.0, 0.0, GetPaperZ()) - Eye).GetSafeNormal();
	const FVector Right = FVector::CrossProduct(FVector::UpVector, Fwd).GetSafeNormal();
	const auto HeadOff = [&](const FTransform& T)
	{
		const FVector D = (Table.InverseTransformPosition(T.TransformPosition(HeadRel)) - Eye).GetSafeNormal();
		return FMath::Abs(FMath::RadiansToDegrees(FMath::Atan2(FVector::DotProduct(D, Right), FVector::DotProduct(D, Fwd))));
	};
	// The comfortable view as at home (V5's rule): BpView.Fov's 30 degrees, or no further out than the lamp's own home.
	const double ViewLimit = FMath::Max(LampViewDeg, HeadOff(StandAtPlace(Table.InverseTransformPosition(LampRest.GetLocation()))) + 0.5);
	const auto InView = [&](double Dy) { return HeadOff(StandAt(Dy)) <= ViewLimit; };
	// How much of the slot (square degrees, with the margin) the body covers standing there; 0 is clear.
	const auto Cover = [&](double Dy)
	{
		const FTransform T = StandAt(Dy);
		FBox2D Seen(ForceInit);
		for (const FVector& C : Body)
		{
			const FVector D = Table.InverseTransformPosition(T.TransformPosition(C)) - Eye;
			Seen += FVector2D(FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)), FMath::RadiansToDegrees(FMath::Atan2(D.Z, FVector2D(D.X, D.Y).Size())));
		}
		const double W = FMath::Min(Seen.Max.X, Slot.Max.X + LampSlotMarginDeg) - FMath::Max(Seen.Min.X, Slot.Min.X - LampSlotMarginDeg);
		const double H = FMath::Min(Seen.Max.Y, Slot.Max.Y) - FMath::Max(Seen.Min.Y, Slot.Min.Y);
		return W > 0.0 && H > 0.0 ? W * H : 0.0;
	};
	double Best = 0.0, BestCover = Cover(0.0);
	if (BestCover <= 0.0) return 0.0;
	// Its own side first (the arm keeps pointing inward at the thing), then the other; the nearest clear place in view, else
	// the place in view that covers least (a whole open sheet can be wider than the view leaves room for on one side).
	const double Own1 = TargetY < 0.0 ? -1.0 : 1.0;
	for (const double Sign : { Own1, -Own1 })
	{
		for (double Cm = LampStepEveryCm; Cm <= LampAsideMaxCm + 1e-6; Cm += LampStepEveryCm)
		{
			if (!InView(Sign * Cm)) break;
			const double C = Cover(Sign * Cm);
			if (C <= 0.0) return Sign * Cm;
			if (C < BestCover - 0.5) { Best = Sign * Cm; BestCover = C; }
		}
	}
	return Best;
}

void ABpTable::TickLampLook()
{
	UWorld* World = GetWorld();
	if (!World) return;
	if (!LampLookState.IsValid()) LampLookState = MakeShared<FBpLampLook>();
	FBpLampLook& L = *LampLookState;

	// ---- the engine's on-screen warnings
	const int32 Warnings = CVarEngineWarnings.GetValueOnGameThread() != 0 ? 1 : 0;
	if (Warnings != L.Warnings && GEngine)
	{
		L.Warnings = Warnings;
		GEngine->bSuppressMapWarnings = Warnings == 0;
		UE_LOG(LogBpTable, Log, TEXT("BpLampLook: engine screen warnings %s"), Warnings ? TEXT("shown") : TEXT("suppressed"));
	}

	// ---- the studio floor: one quad under the table, following it
	const int32 FloorWant = CVarFloor.GetValueOnGameThread() != 0 ? 1 : 0;
	if (!L.Floor.IsValid() && FloorWant)
	{
		UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, PlanePath);
		UMaterialInterface* FloorMat = LoadObject<UMaterialInterface>(nullptr, FloorMaterialPath);
		if (Plane && FloorMat)
		{
			FActorSpawnParameters Params;
			Params.Name = MakeUniqueObjectName(World, AActor::StaticClass(), TEXT("BpStudioFloor"));
			Params.ObjectFlags |= RF_Transient;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			// No owner: it is the studio's, so your room hides it with the studio (BpSurround keeps what the table owns).
			AActor* Floor = World->SpawnActor<AActor>(AActor::StaticClass(), FTransform::Identity, Params);
			if (Floor)
			{
				UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>(Floor, TEXT("Floor"));
				Mesh->SetMobility(EComponentMobility::Movable);
				Mesh->SetStaticMesh(Plane);
				Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
				Mesh->SetCastShadow(false);
				Mesh->bReceivesDecals = false;
				L.FloorMid = UMaterialInstanceDynamic::Create(FloorMat, Mesh);
				Mesh->SetMaterial(0, L.FloorMid.Get());
				Floor->SetRootComponent(Mesh);
				Mesh->RegisterComponent();
				L.Floor = Floor;
				L.FloorAt = FTransform(FVector(1e9));
				L.FloorShown = -1;
				L.FloorGain = -1.f;
				UE_LOG(LogBpTable, Log, TEXT("BpLampLook: studio floor placed (%.0f cm square, one unlit quad)"), FloorCm);
			}
		}
		else if (L.FloorShown != -2)
		{
			L.FloorShown = -2;
			UE_LOG(LogBpTable, Warning, TEXT("BpLampLook: %s is missing (run v1_scene.py); no studio floor"), FloorMaterialPath);
		}
	}
	if (AActor* Floor = L.Floor.Get())
	{
		// The table's yaw and place on the floor plane (its own origin stands on the floor: SM_LightTableFrame's feet are at 0).
		// Wave Q1 (the real headset, 2026-11-10: the floor gone for the rest of a session once a wearer was seated): a seated
		// eye sinks the table (BpView.Seat clamps its feet between the level's floor and SeatTopMinCm under it), and a quad at
		// the sunk feet lay under the studio's own floor, which the Quest draws black. The quad stays on the level's floor
		// (the table's home height) whenever the table sinks, its pool and leg shadows still centred on the table and turned
		// with it; the legs pass through it as they pass through the studio's floor.
		const FTransform Table = GetActorTransform();
		const double FloorZ = FMath::Max(Table.GetLocation().Z, GetHomeTransform().GetLocation().Z);
		const FTransform At(FRotator(0.0, Table.Rotator().Yaw, 0.0), FVector(Table.GetLocation().X, Table.GetLocation().Y, FloorZ + FloorLiftCm), FVector(FloorCm / 100.0, FloorCm / 100.0, 1.0));
		if (!At.Equals(L.FloorAt, 0.01))
		{
			L.FloorAt = At;
			Floor->SetActorTransform(At);
			UE_LOG(LogBpTable, Log, TEXT("BpLampLook: studio floor follows the table: at (%.0f, %.0f, %.1f) yaw %.0f (the table's feet %.1f cm %s the level's floor)"), At.GetLocation().X, At.GetLocation().Y, At.GetLocation().Z,
				At.Rotator().Yaw, FMath::Abs(GetHomeTransform().GetLocation().Z - Table.GetLocation().Z), Table.GetLocation().Z < GetHomeTransform().GetLocation().Z ? TEXT("under") : TEXT("on"));
		}
		if (FloorWant != L.FloorShown)
		{
			L.FloorShown = FloorWant;
			Floor->GetRootComponent()->SetVisibility(FloorWant != 0, true);
		}
		const float Gain = FMath::Clamp(CVarFloorGain.GetValueOnGameThread(), 0.f, 1.5f);
		if (Gain != L.FloorGain && L.FloorMid.IsValid())
		{
			L.FloorGain = Gain;
			L.FloorMid->SetScalarParameterValue(TEXT("Gain"), Gain);
		}
	}

	// ---- the frame (V3): the strip rect lights off on the tier, and the frame's calm dark finish there
	const bool bTier = BpTier::IsOn(World);
	const int32 StripsWant = !bTier || CVarFrameStrips.GetValueOnGameThread() != 0 ? 1 : 0;
	if (StripsWant != L.StripsShown)
	{
		if (!L.bStripsFound)
		{
			// By place, not by name (a cooked level has no labels): a rect light at the top's height inside the frame.
			L.bStripsFound = true;
			const FTransform Table = GetActorTransform();
			for (TActorIterator<AActor> It(World); It; ++It)
			{
				TArray<URectLightComponent*> Rects;
				It->GetComponents(Rects);
				for (URectLightComponent* Rect : Rects)
				{
					const FVector P = Table.InverseTransformPosition(Rect->GetComponentLocation());
					if (FMath::Abs(P.X) <= TableDepthCm * 0.5 + 2.0 && FMath::Abs(P.Y) <= TableWidthCm * 0.5 + 2.0 && FMath::Abs(P.Z - PlacedHeightCm) <= 3.0 && Rect->IsVisible())
					{
						L.Strips.Add(Rect);
					}
				}
			}
		}
		L.StripsShown = StripsWant;
		for (const TWeakObjectPtr<USceneComponent>& Strip : L.Strips)
		{
			if (Strip.IsValid()) Strip->SetVisibility(StripsWant != 0);
		}
		UE_LOG(LogBpTable, Log, TEXT("BpLampLook: frame strip lights %s (%d)"), StripsWant ? TEXT("as authored") : TEXT("off on the Quest tier"), L.Strips.Num());
	}
	if (Frame && bRealFrame)
	{
		const float Tone = bTier ? FMath::Clamp(CVarFrameTone.GetValueOnGameThread(), 0.2f, 1.5f) : 1.f;
		const TCHAR* const Slots[2] = { TEXT("frame_atlas"), TEXT("frame_aluminium") };
		// V5: on the tier the frame and legs draw M_QuestFrame (v5_scene.py), unlit with their form shaded in, so no studio
		// light has to reach them and your room (which switches the studio's lights off) shows them as the studio does. A
		// slot swapped away by anyone else (the tier going off restores M_GLTF) is let go, never put back over theirs.
		const bool bFrameSelf = bTier && CVarFrameSelfLit.GetValueOnGameThread() != 0;
		bool bFrameChanged = false;
		for (int32 Each = 0; Each < 2; ++Each)
		{
			const int32 Index = Frame->GetMaterialIndex(Slots[Each]);
			if (Index == INDEX_NONE) continue;
			UMaterialInterface* Cur = Frame->GetMaterial(Index);
			const int32 Mine = L.FrameSelf.IndexOfByPredicate([Index](const FBpLampLook::FFrameSlot& Slot) { return Slot.Index == Index; });
			const bool bIsMine = Mine != INDEX_NONE && L.FrameSelf[Mine].Self.Get() == Cur;
			if (Mine != INDEX_NONE && !bIsMine)
			{
				L.FrameSelf.RemoveAt(Mine);
			}
			else if (!bFrameSelf && bIsMine)
			{
				Frame->SetMaterial(Index, L.FrameSelf[Mine].Was.Get());
				L.FrameSelf.RemoveAt(Mine);
				bFrameChanged = true;
				continue;
			}
			if (!bFrameSelf || bIsMine || !Cur) continue;
			UMaterialInterface* Master = LoadObject<UMaterialInterface>(nullptr, QuestFramePath);
			if (!Master)
			{
				if (!L.bSaidNoFrame) UE_LOG(LogBpTable, Warning, TEXT("BpLampLook: %s is missing (run v5_scene.py); the frame stays lit"), QuestFramePath);
				L.bSaidNoFrame = true;
				break;
			}
			UMaterialInstanceDynamic* Self = UMaterialInstanceDynamic::Create(Master, Frame);
			CopyTexture(*Cur, *Self, TEXT("BaseColorTexture"));
			CopyScalar(*Cur, *Self, TEXT("QuestBaseScale"));
			CopyVector(*Cur, *Self, TEXT("BaseColorFactor"));
			// The top front edge in the mesh's own space: the paper's near side (the table's -X) as the mesh stands in it.
			if (const UStaticMesh* FrameMeshNow = Frame->GetStaticMesh())
			{
				const FBoxSphereBounds Bounds = FrameMeshNow->GetBounds();
				const FVector Near = Frame->GetRelativeTransform().InverseTransformVectorNoScale(FVector(-1.0, 0.0, 0.0));
				Self->SetScalarParameterValue(TEXT("EdgeY"), static_cast<float>(Bounds.Origin.Y + FMath::Sign(Near.Y) * Bounds.BoxExtent.Y));
				Self->SetScalarParameterValue(TEXT("EdgeZ"), static_cast<float>(Bounds.Origin.Z + Bounds.BoxExtent.Z));
			}
			L.FrameSelf.Add({ Index, TStrongObjectPtr<UMaterialInterface>(Cur), TWeakObjectPtr<UMaterialInstanceDynamic>(Self) });
			Frame->SetMaterial(Index, Self);
			bFrameChanged = true;
		}
		if (bFrameChanged)
		{
			L.FrameToned[0] = L.FrameToned[1] = nullptr;
			L.FrameLight = L.FrameBevel = -1.f;
			UE_LOG(LogBpTable, Log, TEXT("BpLampLook: frame %s (%d slot(s) on M_QuestFrame)"), L.FrameSelf.Num() > 0 ? TEXT("self-lit") : TEXT("on its lit material"), L.FrameSelf.Num());
		}
		const float FrameLight = FMath::Clamp(CVarFrameLight.GetValueOnGameThread(), 0.1f, 5.f);
		const float FrameBevel = FMath::Clamp(CVarFrameBevel.GetValueOnGameThread(), 0.f, 1.5f);
		if (FrameLight != L.FrameLight || FrameBevel != L.FrameBevel)
		{
			L.FrameLight = FrameLight;
			L.FrameBevel = FrameBevel;
			for (const FBpLampLook::FFrameSlot& Slot : L.FrameSelf)
			{
				if (UMaterialInstanceDynamic* Self = Slot.Self.Get())
				{
					Self->SetScalarParameterValue(TEXT("Light"), FrameLight);
					Self->SetScalarParameterValue(TEXT("BevelGain"), FrameBevel);
				}
			}
		}
		const FLinearColor Colours[2] = { FrameBodyColor(), FrameTrimColorValue() };
		for (int32 Each = 0; Each < 2; ++Each)
		{
			const int32 Index = Frame->GetMaterialIndex(Slots[Each]);
			UMaterialInstanceDynamic* Mid = Index == INDEX_NONE ? nullptr : Cast<UMaterialInstanceDynamic>(Frame->GetMaterial(Index));
			if (!Mid || (Mid == L.FrameToned[Each].Get() && Tone == L.FrameTone)) continue;
			Mid->SetVectorParameterValue(TEXT("BaseColorFactor"), FLinearColor(Colours[Each].R * Tone, Colours[Each].G * Tone, Colours[Each].B * Tone, 1.f));
			L.FrameToned[Each] = Mid;
		}
		if (Tone != L.FrameTone) UE_LOG(LogBpTable, Log, TEXT("BpLampLook: frame tone %.2f"), Tone);
		L.FrameTone = Tone;
	}

	// ---- your room's contact shadow (V5): one unlit translucent quad under the table, drawn only while your room shows
	const float ShadowWant = FMath::Clamp(CVarRoomShadow.GetValueOnGameThread(), 0.f, 1.f) * BpSurround::RoomAmount(World);
	if (ShadowWant > 0.f && !L.Shadow.IsValid())
	{
		UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, PlanePath);
		UMaterialInterface* ShadowMat = LoadObject<UMaterialInterface>(nullptr, ContactShadowPath);
		if (Plane && ShadowMat)
		{
			FActorSpawnParameters Params;
			Params.Name = MakeUniqueObjectName(World, AActor::StaticClass(), TEXT("BpContactShadow"));
			Params.ObjectFlags |= RF_Transient;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			// Owned by the table, so your room keeps it (BpSurround keeps what the table owns).
			Params.Owner = this;
			if (AActor* Shadow = World->SpawnActor<AActor>(AActor::StaticClass(), FTransform::Identity, Params))
			{
				UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>(Shadow, TEXT("Shadow"));
				Mesh->SetMobility(EComponentMobility::Movable);
				Mesh->SetStaticMesh(Plane);
				Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
				Mesh->SetCastShadow(false);
				Mesh->bReceivesDecals = false;
				// Under every other translucent thing (it lies on the floor, beneath them all).
				Mesh->SetTranslucentSortPriority(-4);
				L.ShadowMid = UMaterialInstanceDynamic::Create(ShadowMat, Mesh);
				const FVector2D QuadHalf = ShadowFootHalfCm + FVector2D(ShadowFeatherCm + 3.0, ShadowFeatherCm + 3.0);
				L.ShadowMid->SetVectorParameterValue(TEXT("QuadCm"), FLinearColor(QuadHalf.X * 2.0, QuadHalf.Y * 2.0, 0.f, 0.f));
				L.ShadowMid->SetVectorParameterValue(TEXT("FootHalfCm"), FLinearColor(ShadowFootHalfCm.X, ShadowFootHalfCm.Y, 0.f, 0.f));
				L.ShadowMid->SetScalarParameterValue(TEXT("Feather"), ShadowFeatherCm);
				Mesh->SetMaterial(0, L.ShadowMid.Get());
				Shadow->SetRootComponent(Mesh);
				Mesh->RegisterComponent();
				// The table's yaw and place on the floor plane (its feet stand at its origin), the quad over the footprint.
				const FTransform Table = GetActorTransform();
				Shadow->SetActorTransform(FTransform(FRotator(0.0, Table.Rotator().Yaw, 0.0), Table.GetLocation() + FVector(0.0, 0.0, ShadowLiftCm),
					FVector(QuadHalf.X * 2.0 / 100.0, QuadHalf.Y * 2.0 / 100.0, 1.0)));
				L.Shadow = Shadow;
				L.ShadowShown = -1.f;
				UE_LOG(LogBpTable, Log, TEXT("BpLampLook: contact shadow placed (%.0f x %.0f cm, one unlit translucent quad, your room only)"), QuadHalf.X * 2.0, QuadHalf.Y * 2.0);
			}
		}
		else if (L.ShadowShown != -2.f)
		{
			L.ShadowShown = -2.f;
			UE_LOG(LogBpTable, Warning, TEXT("BpLampLook: %s is missing (run v5_scene.py); no contact shadow"), ContactShadowPath);
		}
	}
	if (AActor* Shadow = L.Shadow.Get())
	{
		const FTransform Table = GetActorTransform();
		const FVector At = Table.GetLocation() + FVector(0.0, 0.0, ShadowLiftCm);
		if (!Shadow->GetActorLocation().Equals(At, 0.01)) Shadow->SetActorLocationAndRotation(At, FRotator(0.0, Table.Rotator().Yaw, 0.0));
		if (ShadowWant != L.ShadowShown)
		{
			if ((ShadowWant > 0.f) != (L.ShadowShown > 0.f)) Shadow->GetRootComponent()->SetVisibility(ShadowWant > 0.f, true);
			if (L.ShadowMid.IsValid()) L.ShadowMid->SetScalarParameterValue(TEXT("Strength"), ShadowWant);
			L.ShadowShown = ShadowWant;
		}
	}

	if (!Lamp.IsValid()) return;
	// ---- home
	if (LampTravelT < 0.f && !bLampAtStation) ApplyLampHome();

	// ---- the self-lit material
	if (!L.Mesh.IsValid())
	{
		TArray<UStaticMeshComponent*> Meshes;
		Lamp->GetComponents(Meshes);
		for (UStaticMeshComponent* Mesh : Meshes)
		{
			if (Mesh && Mesh->GetStaticMesh() && Mesh->GetStaticMesh()->GetName() == TEXT("SM_LampAgent")) L.Mesh = Mesh;
		}
		for (const TWeakObjectPtr<AActor>& Each : LampGroup)
		{
			AActor* Actor = Each.Get();
			if (!Actor) continue;
			if (UPointLightComponent* Point = Actor->FindComponentByClass<UPointLightComponent>(); Point && !L.Light.IsValid())
			{
				L.Light = Point;
				L.LightColour = Point->GetLightColor();
			}
			if (Actor->ActorHasTag(LampHaloTag) && !L.Halo.IsValid())
			{
				if (UStaticMeshComponent* HaloMesh = Actor->FindComponentByClass<UStaticMeshComponent>(); HaloMesh && HaloMesh->GetMaterial(0))
				{
					L.Halo = HaloMesh->CreateDynamicMaterialInstance(0);
					if (L.Halo.IsValid()) L.Halo->GetVectorParameterValue(FHashedMaterialParameterInfo(FName(TEXT("Color"))), L.HaloColour);
				}
			}
		}
	}
	UStaticMeshComponent* Mesh = L.Mesh.Get();
	if (!Mesh) return;
	const int32 SelfMode = CVarLampSelfLit.GetValueOnGameThread();
	const bool bSelf = SelfMode >= 2 || (SelfMode == 1 && BpTier::IsOn(World));
	if (bSelf != L.bSelfLit)
	{
		L.bSelfLit = bSelf;
		if (bSelf)
		{
			UMaterialInterface* Master = LoadObject<UMaterialInterface>(nullptr, QuestLampPath);
			if (!Master)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpLampLook: %s is missing (run v1_scene.py); the lamp keeps its lit material"), QuestLampPath);
			}
			for (int32 Index = 0; Master && Index < Mesh->GetNumMaterials(); ++Index)
			{
				UMaterialInterface* Mat = Mesh->GetMaterial(Index);
				const UMaterial* Base = Mat ? Mat->GetMaterial() : nullptr;
				if (!Base || Base->GetName() != FidMaster) continue;
				UMaterialInstanceDynamic* Self = UMaterialInstanceDynamic::Create(Master, Mesh);
				for (const TCHAR* Name : { TEXT("UseTexture"), TEXT("AOMix"), TEXT("GlowStrength"), TEXT("GlowScale") }) CopyScalar(*Mat, *Self, Name);
				for (const TCHAR* Name : { TEXT("BaseColor"), TEXT("GlowColor") }) CopyVector(*Mat, *Self, Name);
				for (const TCHAR* Name : { TEXT("BaseTex"), TEXT("ORMTex") }) CopyTexture(*Mat, *Self, Name);
				// The lens (agent_glow) gets the hot core; the hood's inside glows evenly.
				Self->SetScalarParameterValue(TEXT("HotCore"), Mat->GetName().Contains(TEXT("agent_glow")) ? 1.f : 0.f);
				L.Slots.Add({ Index, TStrongObjectPtr<UMaterialInterface>(Mat), TWeakObjectPtr<UMaterialInstanceDynamic>(Self) });
				Mesh->SetMaterial(Index, Self);
			}
		}
		else
		{
			for (const FBpLampLook::FSlot& Slot : L.Slots) Mesh->SetMaterial(Slot.Index, Slot.Original.Get());
			L.Slots.Reset();
		}
		L.SelfLight = L.Glow = L.Pulse = -1.f;
		L.State = -1;
		UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp %s (%d slot(s) on M_QuestLamp)"), bSelf ? TEXT("self-lit") : TEXT("on its lit material"), L.Slots.Num());
	}

	// ---- the light state
	int32 State = CVarLampState.GetValueOnGameThread();
	if (State < 0 || State > 5)
	{
		const int32 Talking = TalkLampState();
		State = Talking == 1 ? 2 : Talking == 2 ? 3 : Talking == 3 || IsVoicePlaying() ? 4 : LampOffer != ELampOffer::None && LampCaptionClock > 0.f ? 1 : 0;
		// Wave C1: resting, the lamp at work on a scan reads in the lens's colour.
		if (State == 0 && bTheatre && bTheatreLamp) State = 5;
	}
	const float SelfLight = FMath::Clamp(CVarLampSelfLight.GetValueOnGameThread(), 0.f, 3.f);
	const float Glow = FMath::Clamp(CVarLampGlow.GetValueOnGameThread(), 0.f, 3.f);
	const bool bReduced = LookReduced();
	const float Pulse = bReduced ? 0.f : FMath::Clamp(CVarLampPulse.GetValueOnGameThread(), 0.f, 2.f);
	const FLinearColor Tint = State == 5 ? TheatreTint : FLinearColor::Transparent;
	if (State == L.State && SelfLight == L.SelfLight && Glow == L.Glow && Pulse == L.Pulse && Tint.Equals(L.Tint)) return;
	FLampLookState Look = States[State];
	if (State == 5) Look.Glow = Tint;
	L.Tint = Tint;
	if (State != L.State) UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp light %s"), Look.Name);
	L.State = State;
	L.SelfLight = SelfLight;
	L.Glow = Glow;
	L.Pulse = Pulse;
	for (const FBpLampLook::FSlot& Slot : L.Slots)
	{
		UMaterialInstanceDynamic* Self = Slot.Self.Get();
		if (!Self) continue;
		Self->SetScalarParameterValue(TEXT("SelfLight"), SelfLight);
		Self->SetScalarParameterValue(TEXT("GlowGain"), Glow * Look.Gain);
		Self->SetScalarParameterValue(TEXT("PulseHz"), Look.PulseHz);
		Self->SetScalarParameterValue(TEXT("PulseAmp"), Look.PulseAmp * Pulse);
		Self->SetVectorParameterValue(TEXT("HotColor"), Look.Hot);
		// The hood's inside and the lens take the state's colour; the shell and the joints have no glow to colour.
		FLinearColor Was;
		if (Slot.Original->GetVectorParameterValue(FHashedMaterialParameterInfo(FName(TEXT("GlowColor"))), Was) && Was.GetMax() > 0.f) Self->SetVectorParameterValue(TEXT("GlowColor"), Look.Glow);
	}
	// The light it casts and the halo behind its head follow the colour (idle: exactly as authored).
	if (UPointLightComponent* Light = L.Light.Get())
	{
		const FLinearColor Want = State == 0 ? L.LightColour : FMath::Lerp(L.LightColour, Look.Glow, 0.6f);
		Light->SetLightColor(Want);
	}
	if (L.Halo.IsValid()) L.Halo->SetVectorParameterValue(TEXT("Color"), State == 0 ? L.HaloColour : Look.Glow * L.HaloColour.GetMax());
}

// ---- The lamp's manner (V3) ------------------------------------------------------------------------------------------------
// While it listens (spoken to) or speaks to the person, the lamp turns to them; while it is showing something (at a station,
// riding, or looking at a presented place) a speaking lamp only glances (FaceGlance) and keeps pointing. A stand-up decision
// answered gets one nod. On the existing hooks: the talk's lamp state, the voice line, and the pawn's stand-up answers. At
// rest this is two comparisons and one poll of the answers' map a tick, and no draw.
namespace
{
	constexpr float FaceS = 0.45f;
	constexpr float FaceGlance = 0.35f;
	constexpr float NodS = 0.7f;
}

float ABpTable::LampNodDeg() const
{
	if (LampNodT < 0.f) return 0.f;
	// One dip and back, eased at both ends.
	const float A = FMath::Clamp(LampNodT / NodS, 0.f, 1.f);
	return FMath::Clamp(CVarLampNodDeg.GetValueOnGameThread(), 0.f, 15.f) * FMath::Sin(UE_PI * A) * FMath::Sin(UE_PI * A);
}

bool ABpTable::TickLampManner(float DeltaSeconds)
{
	if (!Lamp.IsValid()) return false;
	const bool bReduced = LookReduced();
	const double Now = FPlatformTime::Seconds();
	if (LampNodSince <= 0.0) LampNodSince = Now;
	// A decision answered since the last look: a nod (to the person).
	if (LampNodT < 0.f && !bReduced && RoomModeId.IsEmpty())
	{
		const APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
		const ABpPawn* Pawn = PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
		if (Pawn && Pawn->StandupAnsweredSince(LampNodSince))
		{
			LampNodSince = Now;
			if (CVarLampNodDeg.GetValueOnGameThread() > 0.f)
			{
				LampNodT = 0.f;
				UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp nods (a decision answered)"));
			}
		}
	}
	else if (bReduced)
	{
		LampNodSince = Now;
	}
	const int32 Mode = CVarLampFace.GetValueOnGameThread();
	const int32 Talking = TalkLampState();
	const bool bListening = Talking == 1;
	const bool bSpeaking = Talking == 3 || IsVoicePlaying();
	const bool bShowing = bLampAtStation || LampTravelT >= 0.f || LampLookTarget > 0.f;
	float Want = Mode == 0 ? 0.f : Mode >= 1 ? 1.f : bListening || LampNodT >= 0.f ? 1.f : bSpeaking ? (bShowing ? FaceGlance : 1.f) : 0.f;
	// Room mode keeps its own pose (between the deck and the eye) and reduced motion stills the turn.
	if (bReduced || !RoomModeId.IsEmpty()) Want = 0.f;
	const float WasFace = LampFace;
	if (LampFace != Want) LampFace = bReduced ? Want : FMath::FInterpConstantTo(LampFace, Want, DeltaSeconds, 1.f / FaceS);
	const bool bNodding = LampNodT >= 0.f;
	if (bNodding)
	{
		LampNodT += DeltaSeconds;
		if (LampNodT >= NodS) LampNodT = -1.f;
	}
	if (LampFace != WasFace || bNodding)
	{
		// Home with nothing else moving: PlaceLamp puts it back exactly at its home once both are done.
		PlaceLamp();
		ApplyLampWidgets();
	}
	return LampFace != Want || LampNodT >= 0.f;
}
