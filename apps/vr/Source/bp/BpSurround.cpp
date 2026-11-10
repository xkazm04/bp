// Your room (BpSurround.h). What bp.Room 1 does, and bp.Room 0 undoes exactly:
//   - the studio goes: every primitive of the level is hidden in game, EXCEPT the table actor and the pawn (and anything
//     attached to them: the frame, the paper, the pins and labels, the console, the deck, the wrist, the hands; the flat
//     view's posed capture hands stand for the person and stay too), the lamp
//     agent with its halo and its own lights (the table's FindLamp group), and the table's glass (M_TableGlass). The rule
//     names no studio mesh, so whatever the level gains later (a floor under the table) goes with the studio too;
//   - the studio's lights go dark: every movable or stationary local light outside those actors that reaches neither the
//     paper (nor the air over it) nor the lamp (BpTier's test). A light that reaches the table stays: the frame keeps its
//     key light and the lamp its glow. Static lights are baked and cost nothing live; the sky light and a directional
//     light stay (the table's ambient). The height fog is hidden with the studio;
//   - the passthrough underlay (Meta XR's persistent passthrough layer) shows the real room where the studio was: the
//     eye buffer's cleared pixels carry alpha, and the plugin flags the projection layer to blend over the underlay;
//   - with no passthrough (a flat window, the PC build, a runtime without it, bp.Room.Passthrough 0) a plain dark room
//     stands around the table instead: six unlit planes (M_QuestUnlit, one draw each), so mode 1 is never a black void;
//     the lamp says so once a session.
// The change is a fade of bp.Room.FadeS: the studio hides in stages, the farthest pieces first (back: the nearest first),
// its lights dim with it and the passthrough's opacity rises. Under bp.ReducedMotion the meshes cut at once and only the
// light cross-fades. A reversal mid-fade runs back from where it is. Hiding uses bHiddenInGame, which nothing else in bp
// touches (the tier uses visibility), so each switch restores exactly what it hid.
#include "BpSurround.h"

#include "BpPawn.h"
#include "BpTable.h"
#include "BpTier.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/LocalLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "HAL/IConsoleManager.h"
#include "IXRTrackingSystem.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "OculusXRFunctionLibrary.h"
#include "OculusXRHMDRuntimeSettings.h"
#include "OculusXRPassthroughLayerComponent.h"
#include "OculusXRPassthroughSubsystem.h"
#include "OculusXRPersistentPassthroughInstance.h"
#include "StereoRendering.h"

namespace
{
	TAutoConsoleVariable<int32> CVarRoom(
		TEXT("bp.Room"),
		0,
		TEXT("Around the table: 0 the studio (default), 1 your room (the headset's passthrough; the studio fades out and its lights go dark). Saved; YOUR ROOM / STUDIO on the console."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomFadeS(
		TEXT("bp.Room.FadeS"),
		1.2f,
		TEXT("Your room's fade between the studio and the room, in seconds (0: a cut). Under bp.ReducedMotion the meshes cut and only the light fades."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarRoomPassthrough(
		TEXT("bp.Room.Passthrough"),
		1,
		TEXT("Your room: 1 the passthrough underlay where the headset has it, 0 never (the plain dark room instead, as on the PC). Read when the room is entered."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomOpacity(
		TEXT("bp.Room.Opacity"),
		1.f,
		TEXT("Your room: the passthrough's opacity at rest (0..1; below 1 the room darkens toward black). Read live."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomBrightness(
		TEXT("bp.Room.Brightness"),
		0.f,
		TEXT("Your room: the passthrough's brightness (-1..1, 0 as the cameras see it). Read live."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomContrast(
		TEXT("bp.Room.Contrast"),
		0.f,
		TEXT("Your room: the passthrough's contrast (-1..1, 0 as the cameras see it). Read live."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarRoomSaturation(
		TEXT("bp.Room.Saturation"),
		0.f,
		TEXT("Your room: the passthrough's saturation (-1..1, 0 as the cameras see it; -1 grey). Read live."),
		ECVF_Default);

	/** The plain dark room (no passthrough): its size around the table and its unlit colours (linear). */
	constexpr double FallbackHalfCm = 450.0;
	constexpr double FallbackHeightCm = 300.0;
	const FLinearColor FallbackFloor(0.030f, 0.033f, 0.042f);
	const FLinearColor FallbackWall(0.016f, 0.018f, 0.025f);
	const FLinearColor FallbackCeiling(0.010f, 0.011f, 0.016f);
	const TCHAR* const FallbackMaterialPath = TEXT("/Game/Bp/Materials/M_QuestUnlit.M_QuestUnlit");
	const TCHAR* const PlanePath = TEXT("/Engine/BasicShapes/Plane.Plane");

	/** A primitive the room hides: when (the fade's amount past which it is hidden) and whether it is hidden now. */
	struct FHid
	{
		TWeakObjectPtr<UPrimitiveComponent> Prim;
		float At = 0.f;
		bool bHidden = false;
	};
	/** A light the room dims and switches off, with its intensity as authored. */
	struct FDim
	{
		TWeakObjectPtr<ULocalLightComponent> Light;
		float Intensity = 0.f;
		bool bHidden = false;
	};

	enum class EPass : uint8 { None, Layer, Fallback };

	struct FState
	{
		TWeakObjectPtr<UWorld> World;
		/** 0 the studio, 1 the room; it moves toward the target at 1 / FadeS a second. */
		float Amount = 0.f;
		bool bTarget = false;
		bool bCollected = false;
		TArray<FHid> Hid;
		TArray<FDim> Dim;
		TArray<TWeakObjectPtr<USceneComponent>> Fog;
		bool bFogHidden = false;
		EPass Pass = EPass::None;
		FString Why;
		TWeakObjectPtr<AActor> Fallback;
		float LayerOpacity = -1.f;
		FVector4f LayerColour = FVector4f(0.f, 0.f, 0.f, 0.f);
		int32 Hidden = 0, Dark = 0;
		int32 Switches = 0;
	};
	FState S;
	bool bSaidFallback = false;

	bool Reduced()
	{
		const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Var && Var->GetInt() != 0;
	}

	ABpTable* FindTable(UWorld* World)
	{
		TActorIterator<ABpTable> It(World);
		return It ? *It : nullptr;
	}

	/** The actors that stay: the table, every pawn and the flat view's posed hands (the person), the lamp's group, the
	 *  fallback room, and what is attached to any. */
	bool Stays(const AActor& Actor, const TSet<const AActor*>& Keep)
	{
		for (const AActor* Each = &Actor; Each; Each = Each->GetAttachParentActor())
		{
			if (Keep.Contains(Each) || Each->IsA<APawn>() || Each->IsA<ABpTable>() || Each->ActorHasTag(ABpPawn::CaptureHandsTag) || Each->ActorHasTag(ABpPawn::CaptureWristTag)) return true;
		}
		return Actor.GetOwner() && Stays(*Actor.GetOwner(), Keep);
	}

	void Collect(UWorld* World)
	{
		S.Hid.Reset();
		S.Dim.Reset();
		S.Fog.Reset();
		S.bFogHidden = false;
		ABpTable* Table = FindTable(World);
		TSet<const AActor*> Keep;
		if (Table)
		{
			TArray<AActor*> Lamp;
			Table->LampActors(Lamp);
			for (const AActor* Each : Lamp) Keep.Add(Each);
		}
		if (S.Fallback.IsValid()) Keep.Add(S.Fallback.Get());
		const FVector Centre = Table ? Table->GetActorLocation() : FVector::ZeroVector;
		TArray<FVector> Points;
		BpTier::TablePoints(World, Points);
		struct FFar { UPrimitiveComponent* Prim; double Dist; };
		TArray<FFar> Far;
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			AActor* Actor = *It;
			if (Actor->IsHidden() || Stays(*Actor, Keep)) continue;
			TArray<UPrimitiveComponent*> Prims;
			Actor->GetComponents(Prims);
			for (UPrimitiveComponent* Prim : Prims)
			{
				if (!Prim || !Prim->IsRegistered() || !Prim->IsVisible() || Prim->bHiddenInGame || BpTier::IsTableGlass(*Prim)) continue;
				Far.Add({ Prim, FVector::Dist(Prim->Bounds.Origin, Centre) });
			}
			TArray<ULocalLightComponent*> Lights;
			Actor->GetComponents(Lights);
			for (ULocalLightComponent* Light : Lights)
			{
				if (!Light || !Light->IsVisible() || Light->bHiddenInGame || Light->Mobility == EComponentMobility::Static) continue;
				if (BpTier::LightReaches(*Light, Points)) continue;
				S.Dim.Add({ Light, Light->Intensity, false });
			}
			TArray<UExponentialHeightFogComponent*> Fogs;
			Actor->GetComponents(Fogs);
			for (UExponentialHeightFogComponent* Fog : Fogs)
			{
				if (Fog && Fog->IsVisible() && !Fog->bHiddenInGame) S.Fog.Add(Fog);
			}
		}
		// The farthest first: each piece's turn is its rank, spread over the first nine tenths of the fade.
		Far.Sort([](const FFar& A, const FFar& B) { return A.Dist > B.Dist; });
		for (int32 Index = 0; Index < Far.Num(); ++Index)
		{
			S.Hid.Add({ Far[Index].Prim, 0.9f * Index / FMath::Max(1, Far.Num()), false });
		}
		S.bCollected = true;
		UE_LOG(LogBpTable, Log, TEXT("BpSurround: your room hides %d primitive(s), dims %d light(s) and %d fog(s); keeps the table, the pawn, %d lamp actor(s) and the glass"),
			S.Hid.Num(), S.Dim.Num(), S.Fog.Num(), Keep.Num() - (S.Fallback.IsValid() ? 1 : 0));
	}

	AActor* MakeFallback(UWorld* World)
	{
		UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, PlanePath);
		UMaterialInterface* Unlit = LoadObject<UMaterialInterface>(nullptr, FallbackMaterialPath);
		if (!Plane || !Unlit)
		{
			UE_LOG(LogBpTable, Warning, TEXT("BpSurround: the plain room needs %s and %s; mode 1 without passthrough shows the clear colour"), PlanePath, FallbackMaterialPath);
			return nullptr;
		}
		ABpTable* Table = FindTable(World);
		const FTransform At = Table ? FTransform(FRotator(0.0, Table->GetActorRotation().Yaw, 0.0), Table->GetActorLocation()) : FTransform::Identity;
		FActorSpawnParameters Params;
		Params.Name = TEXT("BpYourRoomFallback");
		Params.ObjectFlags |= RF_Transient;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AActor* Room = World->SpawnActor<AActor>(AActor::StaticClass(), At, Params);
		if (!Room) return nullptr;
		USceneComponent* Root = NewObject<USceneComponent>(Room, TEXT("Root"));
		Room->SetRootComponent(Root);
		Root->RegisterComponent();
		Room->SetActorTransform(At);
		const auto Make = [&](const TCHAR* Name, const FVector& Where, const FVector& Inward, const FVector2D& SizeCm, const FLinearColor& Colour)
		{
			UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>(Room, Name);
			Mesh->SetStaticMesh(Plane);
			Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Mesh->SetCastShadow(false);
			Mesh->SetupAttachment(Root);
			Mesh->SetRelativeLocation(Where);
			Mesh->SetRelativeRotation(FRotationMatrix::MakeFromZX(Inward, FMath::Abs(Inward.Z) > 0.5 ? FVector::ForwardVector : FVector::UpVector).Rotator());
			// The engine plane is 100 cm square in its X and Y.
			Mesh->SetRelativeScale3D(FVector(SizeCm.X / 100.0, SizeCm.Y / 100.0, 1.0));
			UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Unlit, Mesh);
			Mid->SetVectorParameterValue(TEXT("EmissiveFactor"), Colour);
			Mid->SetScalarParameterValue(TEXT("EmissiveStrength"), 1.f);
			Mesh->SetMaterial(0, Mid);
			Mesh->RegisterComponent();
		};
		const double H = FallbackHalfCm, Z = FallbackHeightCm;
		Make(TEXT("Floor"), FVector(0.0, 0.0, 0.0), FVector::UpVector, FVector2D(2 * H, 2 * H), FallbackFloor);
		Make(TEXT("Ceiling"), FVector(0.0, 0.0, Z), -FVector::UpVector, FVector2D(2 * H, 2 * H), FallbackCeiling);
		Make(TEXT("WallFront"), FVector(H, 0.0, Z / 2), -FVector::ForwardVector, FVector2D(Z, 2 * H), FallbackWall);
		Make(TEXT("WallBack"), FVector(-H, 0.0, Z / 2), FVector::ForwardVector, FVector2D(Z, 2 * H), FallbackWall);
		Make(TEXT("WallLeft"), FVector(0.0, -H, Z / 2), FVector::RightVector, FVector2D(Z, 2 * H), FallbackWall);
		Make(TEXT("WallRight"), FVector(0.0, H, Z / 2), -FVector::RightVector, FVector2D(Z, 2 * H), FallbackWall);
		Room->SetActorHiddenInGame(true);
		return Room;
	}

	/** Whether this session can show the passthrough underlay, and why not when it cannot. */
	bool CanPass(UWorld* World, FString& OutWhy)
	{
		if (CVarRoomPassthrough.GetValueOnGameThread() == 0) { OutWhy = TEXT("bp.Room.Passthrough 0"); return false; }
		if (!GetDefault<UOculusXRHMDRuntimeSettings>()->bInsightPassthroughEnabled) { OutWhy = TEXT("passthrough is off in the Meta XR settings"); return false; }
		if (!GEngine || !GEngine->XRSystem.IsValid() || !GEngine->StereoRenderingDevice.IsValid() || !GEngine->StereoRenderingDevice->IsStereoEnabled())
		{
			OutWhy = TEXT("no headset session (a flat window)");
			return false;
		}
		if (!UOculusXRFunctionLibrary::IsPassthroughSupported()) { OutWhy = FString::Printf(TEXT("the XR runtime (%s) reports no passthrough"), *GEngine->XRSystem->GetSystemName().ToString()); return false; }
		if (!UOculusXRPassthroughSubsystem::GetPassthroughSubsystem(World)) { OutWhy = TEXT("no passthrough subsystem"); return false; }
		return true;
	}

	UOculusXRPersistentPassthroughInstance* Layer(UWorld* World)
	{
		UOculusXRPassthroughSubsystem* Sub = UOculusXRPassthroughSubsystem::GetPassthroughSubsystem(World);
		return Sub ? Sub->GetPersistentPassthrough() : nullptr;
	}

	void StartPass(UWorld* World)
	{
		FString Why;
		if (CanPass(World, Why))
		{
			UOculusXRPassthroughSubsystem* Sub = UOculusXRPassthroughSubsystem::GetPassthroughSubsystem(World);
			FOculusXRPersistentPassthroughParameters Params;
			Params.bVisible = true;
			Params.Priority = 0;
			UOculusXRPersistentPassthroughInstance* Made = Sub->InitializePersistentPassthrough(Params, FOculusXRPassthrough_LayerResumed_Single());
			if (Made && Made->GetShape())
			{
				Made->GetShape()->SetLayerPlacement(PassthroughLayerOrder_Underlay);
				S.Pass = EPass::Layer;
				S.Why.Reset();
				S.LayerOpacity = -1.f;
				S.LayerColour = FVector4f(0.f, 0.f, 0.f, 0.f);
				UE_LOG(LogBpTable, Log, TEXT("BpSurround: passthrough layer created (persistent, underlay) on %s"), *GEngine->XRSystem->GetSystemName().ToString());
				return;
			}
			Why = TEXT("the passthrough subsystem made no layer");
		}
		S.Pass = EPass::Fallback;
		S.Why = Why;
		UE_LOG(LogBpTable, Log, TEXT("BpSurround: no passthrough layer: %s; the plain dark room instead"), *Why);
		if (!S.Fallback.IsValid()) S.Fallback = MakeFallback(World);
		if (!bSaidFallback)
		{
			bSaidFallback = true;
			if (ABpTable* Table = FindTable(World)) Table->StandupSay(TEXT("No passthrough here, so a quiet dark room stands in for yours."));
		}
	}

	void StopPass(UWorld* World)
	{
		if (S.Pass == EPass::Layer)
		{
			if (UOculusXRPassthroughSubsystem* Sub = UOculusXRPassthroughSubsystem::GetPassthroughSubsystem(World)) Sub->DestroyPersistentPassthrough();
			UE_LOG(LogBpTable, Log, TEXT("BpSurround: passthrough layer destroyed (the studio is back)"));
		}
		S.Pass = EPass::None;
	}

	/** The layer's opacity follows the fade, its colour the live cvars; it is updated only when one of them moved. */
	void ApplyLayer(UWorld* World)
	{
		if (S.Pass != EPass::Layer) return;
		UOculusXRPersistentPassthroughInstance* Made = Layer(World);
		UOculusXRStereoLayerShapeReconstructed* Shape = Made ? Made->GetShape() : nullptr;
		if (!Shape) return;
		const float Opacity = FMath::Clamp(CVarRoomOpacity.GetValueOnGameThread(), 0.f, 1.f) * S.Amount;
		if (FMath::Abs(Opacity - S.LayerOpacity) > 0.02f || (Opacity != S.LayerOpacity && (S.Amount <= 0.f || S.Amount >= 1.f)))
		{
			S.LayerOpacity = Opacity;
			Shape->SetTextureOpacity(Opacity);
		}
		const FVector4f Colour(CVarRoomBrightness.GetValueOnGameThread(), CVarRoomContrast.GetValueOnGameThread(), CVarRoomSaturation.GetValueOnGameThread(), 1.f);
		if (Colour != S.LayerColour)
		{
			S.LayerColour = Colour;
			const bool bAdjust = Colour.X != 0.f || Colour.Y != 0.f || Colour.Z != 0.f;
			Shape->SetColorMapType(bAdjust ? ColorMapType_ColorAdjustment : ColorMapType_None);
			Shape->EnableColorMap(bAdjust);
			if (bAdjust) Shape->SetBrightnessContrastSaturation(Colour.Y, Colour.X, Colour.Z);
		}
	}

	/** Brings every hidden flag and light level in line with the amount. */
	void ApplyAmount(UWorld* World)
	{
		const bool bCut = Reduced();
		S.Hidden = 0;
		for (FHid& Each : S.Hid)
		{
			UPrimitiveComponent* Prim = Each.Prim.Get();
			if (!Prim) continue;
			const bool bHide = bCut ? (S.bTarget ? S.Amount > 0.f : S.Amount >= 1.f) : S.Amount > Each.At;
			if (bHide != Each.bHidden)
			{
				Each.bHidden = bHide;
				Prim->SetHiddenInGame(bHide);
			}
			S.Hidden += Each.bHidden ? 1 : 0;
		}
		S.Dark = 0;
		for (FDim& Each : S.Dim)
		{
			ULocalLightComponent* Light = Each.Light.Get();
			if (!Light) continue;
			const bool bOff = S.Amount >= 1.f;
			Light->SetIntensity(bOff || S.Amount <= 0.f ? Each.Intensity : Each.Intensity * (1.f - S.Amount));
			if (bOff != Each.bHidden)
			{
				Each.bHidden = bOff;
				Light->SetHiddenInGame(bOff);
			}
			S.Dark += Each.bHidden ? 1 : 0;
		}
		const bool bFog = S.Amount > 0.5f;
		if (bFog != S.bFogHidden)
		{
			S.bFogHidden = bFog;
			for (const TWeakObjectPtr<USceneComponent>& Each : S.Fog)
			{
				if (USceneComponent* Fog = Each.Get()) Fog->SetHiddenInGame(bFog);
			}
		}
		if (AActor* Room = S.Fallback.Get())
		{
			const bool bShow = S.Pass == EPass::Fallback && S.Amount > 0.f;
			if (Room->IsHidden() == bShow) Room->SetActorHiddenInGame(!bShow);
		}
		ApplyLayer(World);
	}

	void Reset()
	{
		S = FState();
	}
}

bool BpSurround::WantsRoom()
{
	return CVarRoom.GetValueOnGameThread() != 0;
}

float BpSurround::RoomAmount(const UWorld* World)
{
	return World && S.World.Get() == World ? S.Amount : 0.f;
}

void BpSurround::Tick(UWorld* World, float DeltaSeconds)
{
	if (!World) return;
	static const FDelegateHandle Cleanup = FWorldDelegates::OnWorldCleanup.AddLambda([](UWorld* Gone, bool, bool)
	{
		if (Gone && Gone == S.World.Get()) Reset();
	});
	if (S.World.Get() != World)
	{
		Reset();
		S.World = World;
	}
	const bool bWant = WantsRoom();
	if (bWant != S.bTarget)
	{
		S.bTarget = bWant;
		++S.Switches;
		if (bWant && S.Amount <= 0.f)
		{
			Collect(World);
			StartPass(World);
		}
		for (TActorIterator<ABpPawn> It(World); It; ++It) It->OnRoomChanged();
		// Wave N3-W3: your room on and off, said (not the saved room coming back as the app starts).
		if (World->GetTimeSeconds() > 3.0) for (TActorIterator<ABpTable> It(World); It; ++It) It->Narrate(bWant ? TEXT("your-room-on") : TEXT("your-room-off"), TEXT("the room switch"), true);
		UE_LOG(LogBpTable, Log, TEXT("BpSurround: bp.Room %d: %s over %.1f s%s"), bWant ? 1 : 0, bWant ? TEXT("the studio fades to your room") : TEXT("the studio comes back"),
			CVarRoomFadeS.GetValueOnGameThread(), Reduced() ? TEXT(" (reduced motion: the meshes cut, the light fades)") : TEXT(""));
	}
	const float Goal = S.bTarget ? 1.f : 0.f;
	if (S.Amount == Goal && (!S.bTarget || S.Pass != EPass::Layer)) return;
	const float FadeS = CVarRoomFadeS.GetValueOnGameThread();
	const float Before = S.Amount;
	S.Amount = FadeS <= 0.f ? Goal : FMath::Clamp(S.Amount + (S.bTarget ? 1.f : -1.f) * DeltaSeconds / FadeS, 0.f, 1.f);
	if (S.Amount == Before && S.Amount == Goal)
	{
		ApplyLayer(World);  // at rest in the room: only the live passthrough cvars
		return;
	}
	ApplyAmount(World);
	if (S.Amount == Goal)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpSurround: %s: %d primitive(s) hidden, %d light(s) off, fog %s, passthrough %s"), S.bTarget ? TEXT("in your room") : TEXT("in the studio"), S.Hidden, S.Dark,
			S.bFogHidden ? TEXT("hidden") : TEXT("shown"), S.Pass == EPass::Layer ? TEXT("layer") : S.Pass == EPass::Fallback ? TEXT("fallback room") : TEXT("off"));
		if (!S.bTarget)
		{
			StopPass(World);
			ApplyAmount(World);
			S.Hid.Reset();
			S.Dim.Reset();
			S.Fog.Reset();
			S.bCollected = false;
		}
	}
}

FString BpSurround::ReportLine()
{
	return FString::Printf(TEXT("room mode=%d amount=%.2f passthrough=%s%s room_hid=%d primitive(s) room_lights_off=%d fog_hidden=%d (switches %d)"),
		WantsRoom() ? 1 : 0, S.Amount,
		S.Pass == EPass::Layer ? TEXT("layer") : S.Pass == EPass::Fallback ? TEXT("fallback") : TEXT("off"),
		S.Why.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *S.Why),
		S.Hidden, S.Dark, S.bFogHidden ? S.Fog.Num() : 0, S.Switches);
}

void ABpTable::LampActors(TArray<AActor*>& Out) const
{
	if (AActor* Each = Lamp.Get()) Out.Add(Each);
	for (const TWeakObjectPtr<AActor>& Weak : LampGroup)
	{
		if (AActor* Each = Weak.Get()) Out.Add(Each);
	}
}
