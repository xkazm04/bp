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

#include "BpTier.h"
#include "Components/PointLightComponent.h"
#include "Components/RectLightComponent.h"
#include "BpPawn.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Components/StaticMeshComponent.h"
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
		TEXT("Forces the lamp's light state for a capture: -1 follows the talk (default), 0 idle, 1 waiting on you, 2 listening, 3 thinking, 4 answering."));
	TAutoConsoleVariable<float> CVarLampHomeX(TEXT("bp.Lamp.HomeX"), 26.f,
		TEXT("The lamp's site home along the table (cm from its centre, + far), 10 to 45. Read live while it is home."));
	TAutoConsoleVariable<float> CVarLampHomeY(TEXT("bp.Lamp.HomeY"), -56.f,
		TEXT("The lamp's site home across the table (cm from its centre, - left), -115 to 115; V1 had -46 (over wing A's name), the level -9 (under the console's bar). Read live while it is home."));
	TAutoConsoleVariable<float> CVarLampHomeZ(TEXT("bp.Lamp.HomeZ"), 8.f,
		TEXT("The lamp's site home hovers this far over the level's height (cm), 0 to 40. Read live while it is home."));
	TAutoConsoleVariable<int32> CVarLampHomeClear(TEXT("bp.Lamp.HomeClear"), 0,
		TEXT("0 (default, V3 by capture: at HomeX/Y/Z the hovering lamp clears every wing name and pin tag from the seat, its body above the tag row); 1: at home the lamp steps outward until, from the seated eye, all of it stands left of the paper's far-left corner, where no wing name, raised wing or pin tag can be behind it (the tags stay inside the paper's corners), which with the lamp's pointing arm puts it at the edge of the view."));
	TAutoConsoleVariable<int32> CVarLampFace(TEXT("bp.Lamp.Face"), -1,
		TEXT("The lamp turns to the person: -1 while it listens or speaks (default; a glance only while it shows something), 0 never, 1 always (captures). bp.ReducedMotion 1 stills it."));
	TAutoConsoleVariable<float> CVarLampNodDeg(TEXT("bp.Lamp.NodDeg"), 7.f,
		TEXT("The lamp's nod on a stand-up decision answered: its bow in degrees, 0 (none) to 15. bp.ReducedMotion 1 stills it."));
	TAutoConsoleVariable<int32> CVarFrameStrips(TEXT("bp.Frame.StripLights"), 0,
		TEXT("The four rect lights along the paper's edges (StripNear/Far/Left/Right) while the Quest tier is on: 0 off (default; on the Quest's mobile path StripNear lit a blown spot on the frame's near rim), 1 as authored. Off the tier they always stay."));
	TAutoConsoleVariable<float> CVarFrameTone(TEXT("bp.Frame.Tone"), 0.7f,
		TEXT("The frame's body and trim base colour on the Quest tier, as a share of BpTable's (0.2 to 1.5, default 0.7: a calm dark finish). Read live."));
	TAutoConsoleVariable<int32> CVarFloor(TEXT("bp.Floor"), 1, TEXT("The studio floor under the table (one unlit quad): 1 shown, 0 hidden. Your room hides it with the studio."));
	TAutoConsoleVariable<float> CVarFloorGain(TEXT("bp.Floor.Gain"), 0.15f, TEXT("The studio floor's brightness, 0 to 1.5. Read live."));
	TAutoConsoleVariable<int32> CVarEngineWarnings(TEXT("bp.EngineWarnings"), 0,
		TEXT("The renderer's on-screen map warnings (the stereo method lines in non-Shipping builds among them): 0 suppressed (default), 1 shown."));

	const TCHAR* const QuestLampPath = TEXT("/Game/Bp/Materials/M_QuestLamp.M_QuestLamp");
	const TCHAR* const FloorMaterialPath = TEXT("/Game/Bp/Materials/M_StudioFloor.M_StudioFloor");
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
	TWeakObjectPtr<UPointLightComponent> Light;
	FLinearColor LightColour = FLinearColor::White;
	TWeakObjectPtr<UMaterialInstanceDynamic> Halo;
	FLinearColor HaloColour = FLinearColor::White;
	float HomeX = TNumericLimits<float>::Max(), HomeY = TNumericLimits<float>::Max(), HomeZ = TNumericLimits<float>::Max();
	int32 HomeClear = -1;
	/** The level's lamp height (table cm), read once: HomeZ hovers over it. */
	double BaseZ = TNumericLimits<double>::Max();
	/** The strip rect lights (found once, by place: at the top's height inside the frame), and whether they show. */
	TArray<TWeakObjectPtr<USceneComponent>> Strips;
	int32 StripsShown = -1;
	bool bStripsFound = false;
	/** The frame's body and trim slots' material as last toned, and the tone. */
	TWeakObjectPtr<UMaterialInterface> FrameToned[2];
	float FrameTone = -1.f;
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
	if (WantX == L.HomeX && WantY == L.HomeY && WantZ == L.HomeZ && Clear == L.HomeClear) return;
	L.HomeX = WantX;
	L.HomeY = WantY;
	L.HomeZ = WantZ;
	L.HomeClear = Clear;
	const FTransform& Table = GetActorTransform();
	FVector At = Table.InverseTransformPosition(LampRest.GetLocation());
	if (L.BaseZ == TNumericLimits<double>::Max()) L.BaseZ = At.Z;
	At.X = WantX;
	At.Y = WantY;
	At.Z = L.BaseZ + WantZ;
	const FVector Eye = EyeLocal();
	// Turned toward a point a third of the way from the seat's eye to the paper's centre: it faces the person, not the bar.
	const FVector Face = FMath::Lerp(Eye, FVector(0.0, 0.0, GetPaperZ()), 1.0 / 3.0);
	double Yaw = 0.0;
	const auto Put = [&]()
	{
		Yaw = LampYawToward(At, Face);
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
	};
	Put();
	// V3: from the seated eye the whole lamp (its bounds, the pointing arm and the halo with it) stands left of the paper's
	// far-left corner, by ClearDeg. The pin tags stand between the paper's far corners from that eye (TagInsidePaper) and the
	// wing names and raised wings over the paper, so nothing that has to be read is ever behind it, wherever it stands.
	double Stepped = 0.0;
	if (Clear)
	{
		constexpr double ClearDeg = 2.0;
		const FVector Corner = PaperCmToLocal(FVector2D::ZeroVector, GetPaperZ());
		const double Limit = FMath::Atan2(Corner.Y - Eye.Y, Corner.X - Eye.X) - FMath::DegreesToRadians(ClearDeg);
		FBox Box = Lamp->GetComponentsBoundingBox(true);
		for (const TWeakObjectPtr<AActor>& Each : LampGroup)
		{
			if (Each.IsValid() && Each->ActorHasTag(LampHaloTag)) Box += Each->GetComponentsBoundingBox(true);
		}
		if (Box.IsValid)
		{
			// The bounds' corners in the table's space; the one furthest right as the eye sees it decides the step.
			FVector Vertices[8];
			Box.GetVertices(Vertices);
			double Need = 0.0;
			for (const FVector& V : Vertices)
			{
				const FVector P = Table.InverseTransformPosition(V);
				if (P.X <= Eye.X) continue;
				const double Allowed = Eye.Y + (P.X - Eye.X) * FMath::Tan(Limit);
				Need = FMath::Min(Need, Allowed - P.Y);
			}
			if (Need < 0.0)
			{
				Stepped = FMath::Max(Need, -40.0);
				At.Y += Stepped;
				Put();
			}
		}
	}
	UE_LOG(LogBpTable, Log, TEXT("BpLampLook: lamp home at table (%.0f, %.0f, +%.0f) yaw %.0f%s"), At.X, At.Y, static_cast<double>(WantZ), Yaw,
		Stepped < 0.0 ? *FString::Printf(TEXT(", stepped %.0f cm out to clear the paper from the seat"), -Stepped) : TEXT(""));
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
		const FTransform Table = GetActorTransform();
		const FTransform At(FRotator(0.0, Table.Rotator().Yaw, 0.0), Table.GetLocation() + FVector(0.0, 0.0, FloorLiftCm), FVector(FloorCm / 100.0, FloorCm / 100.0, 1.0));
		if (!At.Equals(L.FloorAt, 0.01))
		{
			L.FloorAt = At;
			Floor->SetActorTransform(At);
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
	if (State < 0 || State > 4)
	{
		const int32 Talking = TalkLampState();
		State = Talking == 1 ? 2 : Talking == 2 ? 3 : Talking == 3 || IsVoicePlaying() ? 4 : LampOffer != ELampOffer::None && LampCaptionClock > 0.f ? 1 : 0;
	}
	const float SelfLight = FMath::Clamp(CVarLampSelfLight.GetValueOnGameThread(), 0.f, 3.f);
	const float Glow = FMath::Clamp(CVarLampGlow.GetValueOnGameThread(), 0.f, 3.f);
	const bool bReduced = LookReduced();
	const float Pulse = bReduced ? 0.f : FMath::Clamp(CVarLampPulse.GetValueOnGameThread(), 0.f, 2.f);
	if (State == L.State && SelfLight == L.SelfLight && Glow == L.Glow && Pulse == L.Pulse) return;
	const FLampLookState& Look = States[State];
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
