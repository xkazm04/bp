// The Quest fidelity tier (BpTier.h). What the tier changes in code, and only while it is on:
//   - the studio's haze cards (level actors on M_HazeShaft / M_HazeVeil instances) hide: they are large translucent
//     planes stacked in front of the walls, overdraw the headset's tiled GPU pays for every covered pixel twice per eye;
//   - the scan's veil stays hidden (BpMarks.cpp): the scan line alone is the scan's one additive card;
//   - the live hand shadow is captured at bp.QuestTier.HandShadowHz, only while a hand is by the paper (BpTable.cpp);
//   - the city backdrop draws one unlit texture instead of the imported lit master (bp.QuestTier.UnlitBackdrop);
//   - the frame's leftover glass quad collapses in the vertex shader instead of shading the paper's area (bp.QuestTier.CollapseQuad);
//   - bp.QuestTier.Glass 0 hides the table's glass over the paper; it stays on until the headset judges the look;
//   - every studio and frame slot on the imported glTF master (M_GLTF, a Substrate graph of ~5,900 SM6 pixel instructions)
//     draws its M_QuestLit / M_QuestUnlit stand-in instead (bp.QuestTier.CheapLit, default 1): quest_lit.py's
//     QuestLit/MI_QL_<material> carries that material's base colour texture and factor, emissive and a constant metallic;
//     a dynamic instance on the slot (the frame's) is copied onto a new one so BaseColorFactor and EmissiveStrength stay;
//   - bp.QuestTier.Lights (default 1, all lights as authored): 0 switches off the movable studio lights that reach neither
//     the paper (and the air 40 cm over it) nor the lamp, 2 the stationary ones too; for the owner's A/B on the headset.
// Each switch is read every tick and restores exactly what it changed when it goes back.
// bp.QuestTier.Report logs every visible primitive with its triangles and blend, the input for the next cut on device,
// and one line of what each switch swapped or switched off.
#include "BpTier.h"

#include "BpTable.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/LocalLightComponent.h"
#include "Components/RectLightComponent.h"
#include "Components/SkinnedMeshComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Engine.h"
#include "Engine/Light.h"
#include "Engine/SkinnedAsset.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/Texture.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "MaterialShared.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/PackageName.h"
#include "Rendering/SkeletalMeshRenderData.h"
#include "StaticMeshResources.h"
#include "TimerManager.h"
#include "UObject/StrongObjectPtr.h"

namespace
{
	TAutoConsoleVariable<int32> CVarQuestTier(
		TEXT("bp.QuestTier"),
		-1,
		TEXT("The Quest fidelity tier (standalone-plan S4): 1 on, 0 off, -1 on at a mobile feature level only (the APK). On the PC, 1 previews what the tier hides."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarHandShadowHz(
		TEXT("bp.QuestTier.HandShadowHz"),
		36.f,
		TEXT("The live hand shadow's capture rate while the Quest tier is on and a hand is by the paper (half of 72 Hz by default); 0 stops it. Read live."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTierGlass(
		TEXT("bp.QuestTier.Glass"),
		1,
		TEXT("The lit translucent glass over the paper while the Quest tier is on: 1 shown, 0 hidden."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTierUnlitBackdrop(
		TEXT("bp.QuestTier.UnlitBackdrop"),
		1,
		TEXT("While the Quest tier is on: 1 the city backdrop draws M_BackdropUnlit, 0 its imported material."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTierCollapseQuad(
		TEXT("bp.QuestTier.CollapseQuad"),
		1,
		TEXT("While the Quest tier is on: 1 the frame's hidden glass quad draws M_Collapsed (no pixels), 0 M_Hidden (masked, every pixel shaded and discarded)."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTierCheapLit(
		TEXT("bp.QuestTier.CheapLit"),
		1,
		TEXT("While the Quest tier is on: 1 every studio and frame slot on the imported glTF master (M_GLTF) draws its M_QuestLit / M_QuestUnlit instance (no normal map, fully rough, constant metallic), 0 the imported materials. Read live."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTierLights(
		TEXT("bp.QuestTier.Lights"),
		1,
		TEXT("While the Quest tier is on: 1 every light as authored; 0 the movable studio lights that reach neither the paper (nor the air 40 cm over it) nor the lamp are off; 2 the stationary ones too. Read live; going back restores them."),
		ECVF_Default);

	/** What Apply hid, so that switching the tier off shows exactly those again. */
	TWeakObjectPtr<UWorld> AppliedWorld;
	bool bAppliedOn = false;
	TArray<TWeakObjectPtr<UPrimitiveComponent>> HiddenByTier;

	/** A material slot the tier swapped, so that switching back restores exactly it. */
	struct FSwap
	{
		TWeakObjectPtr<UMeshComponent> Mesh;
		int32 Slot = 0;
		TWeakObjectPtr<UMaterialInterface> Original;
	};

	/** The tier's live switches, each applied only when it changes. */
	TWeakObjectPtr<UWorld> SwitchWorld;
	bool bGlassHidden = false, bBackdropSwapped = false, bQuadSwapped = false;
	TArray<TWeakObjectPtr<UPrimitiveComponent>> HiddenGlass;
	TArray<FSwap> BackdropSwaps, QuadSwaps;

	bool IsTableGlass(const UPrimitiveComponent& Prim)
	{
		for (int32 Index = 0; Index < Prim.GetNumMaterials(); ++Index)
		{
			const UMaterialInterface* Mat = Prim.GetMaterial(Index);
			const UMaterial* Base = Mat ? Mat->GetMaterial() : nullptr;
			if (Base && Base->GetName() == TEXT("M_TableGlass")) return true;
		}
		return false;
	}

	void SetSwap(UWorld* World, bool bWant, bool& bState, TArray<FSwap>& Swaps, const TCHAR* FromName, const TCHAR* ToPath, bool bTableOwned)
	{
		if (bWant == bState) return;
		bState = bWant;
		if (!bWant)
		{
			for (const FSwap& Each : Swaps)
			{
				if (UMeshComponent* Mesh = Each.Mesh.Get()) Mesh->SetMaterial(Each.Slot, Each.Original.Get());
			}
			UE_LOG(LogBpTable, Log, TEXT("BpTier: %s restored on %d slot(s)"), FromName, Swaps.Num());
			Swaps.Reset();
			return;
		}
		UMaterialInterface* To = LoadObject<UMaterialInterface>(nullptr, ToPath);
		if (!To)
		{
			UE_LOG(LogBpTable, Warning, TEXT("BpTier: %s is missing; %s stays"), ToPath, FromName);
			return;
		}
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			if (It->IsA<ABpTable>() != bTableOwned || (!bTableOwned && !It->IsA<AStaticMeshActor>())) continue;
			TArray<UStaticMeshComponent*> Meshes;
			It->GetComponents(Meshes);
			for (UStaticMeshComponent* Mesh : Meshes)
			{
				if (!Mesh || Mesh->IsA<UInstancedStaticMeshComponent>()) continue;
				for (int32 Slot = 0; Slot < Mesh->GetNumMaterials(); ++Slot)
				{
					UMaterialInterface* Mat = Mesh->GetMaterial(Slot);
					if (!Mat || Mat->GetName() != FromName) continue;
					Swaps.Add({ Mesh, Slot, Mat });
					Mesh->SetMaterial(Slot, To);
				}
			}
		}
		UE_LOG(LogBpTable, Log, TEXT("BpTier: %s swapped for %s on %d slot(s)"), FromName, ToPath, Swaps.Num());
	}

	// ---- bp.QuestTier.CheapLit

	/** A slot CheapLit swapped. The original is held strongly: the frame's slots are dynamic instances nothing else keeps. */
	struct FHeldSwap
	{
		TWeakObjectPtr<UMeshComponent> Mesh;
		int32 Slot = 0;
		TStrongObjectPtr<UMaterialInterface> Original;
	};
	bool bCheapLit = false;
	TArray<FHeldSwap> CheapSwaps;
	/** Of the slots swapped: how many found their MI_QL_ instance, how many were built from M_QuestLit at run time. */
	int32 CheapFromInstance = 0, CheapBuilt = 0;

	const TCHAR* const GltfMaster = TEXT("M_GLTF");
	const TCHAR* const QuestLitPath = TEXT("/Game/Bp/Materials/M_QuestLit.M_QuestLit");
	const TCHAR* const QuestLitDir = TEXT("/Game/Bp/Materials/QuestLit");
	/** The backdrop is bp.QuestTier.UnlitBackdrop's; CheapLit leaves it whichever way that switch stands. */
	const TCHAR* const BackdropMaterial = TEXT("city_backdrop_emissive");

	void CopyVector(const UMaterialInterface& From, UMaterialInstanceDynamic& To, const TCHAR* Name)
	{
		FLinearColor Value;
		if (From.GetVectorParameterValue(FHashedMaterialParameterInfo(FName(Name)), Value)) To.SetVectorParameterValue(Name, Value);
	}

	void CopyScalar(const UMaterialInterface& From, UMaterialInstanceDynamic& To, const TCHAR* Name)
	{
		float Value = 0.f;
		if (From.GetScalarParameterValue(FHashedMaterialParameterInfo(FName(Name)), Value)) To.SetScalarParameterValue(Name, Value);
	}

	/** The cheap stand-in for one M_GLTF slot: quest_lit.py's MI_QL_<name> (name: the slot's material, a dynamic instance's
	 *  parent), as it is or, for a dynamic instance, under a new one carrying the values code set on it; with no such
	 *  instance (art imported after quest_lit.py ran), M_QuestLit with the slot's own texture and factors, metallic 0
	 *  where a texture carried it. */
	UMaterialInterface* CheapFor(UMaterialInterface& Mat, UObject* Outer, bool& bOutBuilt)
	{
		UMaterialInstanceDynamic* Mid = Cast<UMaterialInstanceDynamic>(&Mat);
		const UMaterialInterface* Source = Mid && Mid->Parent ? Mid->Parent.Get() : &Mat;
		const FString Name = FString(TEXT("MI_QL_")) + Source->GetName();
		const FString Package = FString(QuestLitDir) / Name;
		UMaterialInterface* Cheap = FPackageName::DoesPackageExist(Package) ? LoadObject<UMaterialInterface>(nullptr, *(Package + TEXT(".") + Name)) : nullptr;
		bOutBuilt = Cheap == nullptr;
		if (!Cheap)
		{
			Cheap = LoadObject<UMaterialInterface>(nullptr, QuestLitPath);
			if (!Cheap) return nullptr;
		}
		if (!Mid && !bOutBuilt) return Cheap;
		UMaterialInstanceDynamic* Made = UMaterialInstanceDynamic::Create(Cheap, Outer);
		CopyVector(Mat, *Made, TEXT("BaseColorFactor"));
		CopyVector(Mat, *Made, TEXT("EmissiveFactor"));
		CopyScalar(Mat, *Made, TEXT("EmissiveStrength"));
		if (bOutBuilt)
		{
			UTexture* Base = nullptr;
			if (Mat.GetTextureParameterValue(FHashedMaterialParameterInfo(FName(TEXT("BaseColorTexture"))), Base) && Base) Made->SetTextureParameterValue(TEXT("BaseColorTexture"), Base);
			CopyScalar(Mat, *Made, TEXT("SpecularFactor"));
			UTexture* Orm = nullptr;
			const bool bOrm = Mat.GetTextureParameterValue(FHashedMaterialParameterInfo(FName(TEXT("MetallicRoughnessTexture"))), Orm) && Orm && !Orm->GetPathName().StartsWith(TEXT("/InterchangeAssets/"));
			float Metal = 0.f;
			Mat.GetScalarParameterValue(FHashedMaterialParameterInfo(FName(TEXT("MetallicFactor"))), Metal);
			Made->SetScalarParameterValue(TEXT("MetallicFactor"), bOrm ? 0.f : Metal);
		}
		return Made;
	}

	void SetCheapLit(UWorld* World, bool bWant)
	{
		if (bWant == bCheapLit) return;
		bCheapLit = bWant;
		if (!bWant)
		{
			for (const FHeldSwap& Each : CheapSwaps)
			{
				if (UMeshComponent* Mesh = Each.Mesh.Get()) Mesh->SetMaterial(Each.Slot, Each.Original.Get());
			}
			UE_LOG(LogBpTable, Log, TEXT("BpTier: cheap lit off, M_GLTF restored on %d slot(s)"), CheapSwaps.Num());
			CheapSwaps.Reset();
			CheapFromInstance = CheapBuilt = 0;
			return;
		}
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			if (!It->IsA<AStaticMeshActor>() && !It->IsA<ABpTable>()) continue;
			TArray<UStaticMeshComponent*> Meshes;
			It->GetComponents(Meshes);
			for (UStaticMeshComponent* Mesh : Meshes)
			{
				if (!Mesh) continue;
				for (int32 Slot = 0; Slot < Mesh->GetNumMaterials(); ++Slot)
				{
					UMaterialInterface* Mat = Mesh->GetMaterial(Slot);
					const UMaterial* Base = Mat ? Mat->GetMaterial() : nullptr;
					if (!Base || Base->GetName() != GltfMaster || Mat->GetName() == BackdropMaterial) continue;
					bool bBuilt = false;
					UMaterialInterface* Cheap = CheapFor(*Mat, Mesh, bBuilt);
					if (!Cheap) continue;
					CheapSwaps.Add({ Mesh, Slot, TStrongObjectPtr<UMaterialInterface>(Mat) });
					Mesh->SetMaterial(Slot, Cheap);
					++(bBuilt ? CheapBuilt : CheapFromInstance);
					if (bBuilt) UE_LOG(LogBpTable, Log, TEXT("BpTier:   no %s/MI_QL_%s (run quest_lit.py); built from M_QuestLit"), QuestLitDir, *Mat->GetName());
				}
			}
		}
		if (CheapSwaps.Num() == 0 && !LoadObject<UMaterialInterface>(nullptr, QuestLitPath)) UE_LOG(LogBpTable, Warning, TEXT("BpTier: %s is missing; M_GLTF stays"), QuestLitPath);
		UE_LOG(LogBpTable, Log, TEXT("BpTier: cheap lit on %d slot(s) (%d from MI_QL_ instances, %d built at run time)"), CheapSwaps.Num(), CheapFromInstance, CheapBuilt);
	}

	// ---- bp.QuestTier.Lights

	int32 LightsMode = 1;
	TArray<TWeakObjectPtr<ULightComponent>> LightsOff;
	/** The air over the paper a light must reach to stay: the paper's height and this much above it. */
	constexpr double LightsAirCm = 40.0;

	/** Where the paper and the lamp are, sampled: a grid over the paper at its height and LightsAirCm above it, the
	 *  lamp's bounds now and its stations (it travels between them). */
	void TablePoints(UWorld* World, TArray<FVector>& Out)
	{
		for (TActorIterator<ABpTable> It(World); It; ++It)
		{
			const FTransform Table = It->GetActorTransform();
			const double Z = It->GetPaperZ();
			for (int32 IX = 0; IX <= 4; ++IX)
			{
				for (int32 IY = 0; IY <= 8; ++IY)
				{
					const double X = (IX / 4.0 - 0.5) * ABpTable::PaperDepthCm, Y = (IY / 8.0 - 0.5) * ABpTable::PaperWidthCm;
					Out.Add(Table.TransformPosition(FVector(X, Y, Z)));
					Out.Add(Table.TransformPosition(FVector(X, Y, Z + LightsAirCm)));
				}
			}
			TArray<FVector> Stations;
			It->LampStationsLocal(Stations);
			for (const FVector& At : Stations)
			{
				Out.Add(Table.TransformPosition(At));
				Out.Add(Table.TransformPosition(At + FVector(0.0, 0.0, LightsAirCm)));
			}
		}
		for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
		{
			const UStaticMeshComponent* Comp = It->GetStaticMeshComponent();
			if (!Comp || !Comp->GetStaticMesh() || Comp->GetStaticMesh()->GetName() != TEXT("SM_LampAgent")) continue;
			const FBox Box = Comp->Bounds.GetBox();
			Out.Add(Box.GetCenter());
			for (int32 Corner = 0; Corner < 8; ++Corner)
			{
				Out.Add(FVector(Corner & 1 ? Box.Max.X : Box.Min.X, Corner & 2 ? Box.Max.Y : Box.Min.Y, Corner & 4 ? Box.Max.Z : Box.Min.Z));
			}
		}
	}

	/** Whether a local light reaches any of the points: within its attenuation radius and, for a spot, inside its outer
	 *  cone (a rect light: in front of it). */
	bool Reaches(const ULocalLightComponent& Light, const TArray<FVector>& Points)
	{
		const FVector From = Light.GetComponentLocation();
		const FVector Dir = Light.GetDirection();
		const USpotLightComponent* Spot = Cast<USpotLightComponent>(&Light);
		const double CosCone = Spot ? FMath::Cos(FMath::DegreesToRadians(static_cast<double>(Spot->OuterConeAngle))) : Light.IsA<URectLightComponent>() ? 0.0 : -1.0;
		for (const FVector& Point : Points)
		{
			const FVector To = Point - From;
			const double Dist = To.Size();
			if (Dist > Light.AttenuationRadius) continue;
			if (Dist < 1.0 || FVector::DotProduct(To / Dist, Dir) >= CosCone) return true;
		}
		return false;
	}

	/** The lights a Lights mode switches off: visible local lights on level light actors, movable (mode 0) or movable and
	 *  stationary (mode 2), that reach neither the paper nor the lamp. Static lights are baked and cannot switch. */
	void LightsFor(UWorld* World, int32 Mode, TArray<ULocalLightComponent*>& Out)
	{
		TArray<FVector> Points;
		TablePoints(World, Points);
		for (TActorIterator<ALight> It(World); It; ++It)
		{
			ULocalLightComponent* Light = Cast<ULocalLightComponent>(It->GetLightComponent());
			if (!Light || !Light->IsVisible()) continue;
			const bool bMovable = Light->Mobility == EComponentMobility::Movable;
			const bool bStationary = Light->Mobility == EComponentMobility::Stationary;
			if (!(bMovable || (Mode == 2 && bStationary)) || Reaches(*Light, Points)) continue;
			Out.Add(Light);
		}
	}

	void SetLights(UWorld* World, int32 Want)
	{
		if (Want != 0 && Want != 2) Want = 1;
		if (Want == LightsMode) return;
		LightsMode = Want;
		int32 Shown = 0;
		for (const TWeakObjectPtr<ULightComponent>& Each : LightsOff)
		{
			if (ULightComponent* Light = Each.Get()) { Light->SetVisibility(true); ++Shown; }
		}
		if (LightsOff.Num() > 0) UE_LOG(LogBpTable, Log, TEXT("BpTier: lights restored, %d light(s) on again"), Shown);
		LightsOff.Reset();
		if (Want == 1) return;
		TArray<ULocalLightComponent*> Off;
		LightsFor(World, Want, Off);
		TArray<FString> Names;
		for (ULocalLightComponent* Light : Off)
		{
			Light->SetVisibility(false);
			LightsOff.Add(Light);
			Names.Add(FString::Printf(TEXT("%s (%s)"), *Light->GetOwner()->GetActorNameOrLabel(), Light->Mobility == EComponentMobility::Movable ? TEXT("movable") : TEXT("stationary")));
		}
		UE_LOG(LogBpTable, Log, TEXT("BpTier: lights %d: %d light(s) off: %s"), Want, Off.Num(), *FString::Join(Names, TEXT(", ")));
	}

	/** A world going away releases what the switches hold, so no PIE world outlives its session. */
	void ResetSwitches()
	{
		SwitchWorld = nullptr;
		bGlassHidden = bBackdropSwapped = bQuadSwapped = bCheapLit = false;
		LightsMode = 1;
		HiddenGlass.Reset();
		BackdropSwaps.Reset();
		QuadSwaps.Reset();
		CheapSwaps.Reset();
		LightsOff.Reset();
		CheapFromInstance = CheapBuilt = 0;
	}

	void ApplySwitches(UWorld* World, bool bOn)
	{
		static const FDelegateHandle Cleanup = FWorldDelegates::OnWorldCleanup.AddLambda([](UWorld* Gone, bool, bool)
		{
			if (Gone && Gone == SwitchWorld.Get()) ResetSwitches();
		});
		if (SwitchWorld.Get() != World)
		{
			ResetSwitches();
			SwitchWorld = World;
		}
		const bool bHideGlass = bOn && CVarTierGlass.GetValueOnGameThread() == 0;
		if (bHideGlass != bGlassHidden)
		{
			bGlassHidden = bHideGlass;
			if (bHideGlass)
			{
				for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
				{
					UStaticMeshComponent* Comp = It->GetStaticMeshComponent();
					if (!Comp || !Comp->IsVisible() || !IsTableGlass(*Comp)) continue;
					Comp->SetVisibility(false);
					HiddenGlass.Add(Comp);
				}
			}
			else
			{
				for (const TWeakObjectPtr<UPrimitiveComponent>& Each : HiddenGlass)
				{
					if (UPrimitiveComponent* Prim = Each.Get()) Prim->SetVisibility(true);
				}
				HiddenGlass.Reset();
			}
			UE_LOG(LogBpTable, Log, TEXT("BpTier: table glass %s"), bHideGlass ? TEXT("hidden") : TEXT("shown"));
		}
		SetSwap(World, bOn && CVarTierUnlitBackdrop.GetValueOnGameThread() != 0, bBackdropSwapped, BackdropSwaps, TEXT("city_backdrop_emissive"), TEXT("/Game/Bp/Materials/M_BackdropUnlit.M_BackdropUnlit"), false);
		SetSwap(World, bOn && CVarTierCollapseQuad.GetValueOnGameThread() != 0, bQuadSwapped, QuadSwaps, TEXT("M_Hidden"), TEXT("/Game/Bp/Materials/M_Collapsed.M_Collapsed"), true);
		SetCheapLit(World, bOn && CVarTierCheapLit.GetValueOnGameThread() != 0);
		SetLights(World, bOn ? CVarTierLights.GetValueOnGameThread() : 1);
	}

	bool IsHazeCard(const UPrimitiveComponent& Prim)
	{
		if (!Prim.IsA<UStaticMeshComponent>() || Prim.GetOwner() == nullptr || Prim.GetOwner()->IsA<ABpTable>()) return false;
		for (int32 Index = 0; Index < Prim.GetNumMaterials(); ++Index)
		{
			const UMaterialInterface* Mat = Prim.GetMaterial(Index);
			const UMaterial* Base = Mat ? Mat->GetMaterial() : nullptr;
			if (Base && Base->GetName().StartsWith(TEXT("M_Haze"))) return true;
		}
		return false;
	}

	int64 TrianglesOf(const UPrimitiveComponent& Prim)
	{
		if (const UStaticMeshComponent* Mesh = Cast<UStaticMeshComponent>(&Prim))
		{
			const UStaticMesh* Asset = Mesh->GetStaticMesh();
			const FStaticMeshRenderData* Data = Asset ? Asset->GetRenderData() : nullptr;
			if (!Data || Data->LODResources.Num() == 0) return 0;
			const int64 One = Data->LODResources[0].GetNumTriangles();
			const UInstancedStaticMeshComponent* Ism = Cast<UInstancedStaticMeshComponent>(Mesh);
			return Ism ? One * Ism->GetInstanceCount() : One;
		}
		if (const USkinnedMeshComponent* Skin = Cast<USkinnedMeshComponent>(&Prim))
		{
			const USkinnedAsset* Asset = Skin->GetSkinnedAsset();
			const FSkeletalMeshRenderData* Data = Asset ? Asset->GetResourceForRendering() : nullptr;
			return Data && Data->LODRenderData.Num() > 0 ? static_cast<int64>(Data->LODRenderData[0].GetTotalFaces()) : 0;
		}
		return Prim.IsA<UWidgetComponent>() ? 2 : 0;
	}

	bool IsTranslucent(const UPrimitiveComponent& Prim)
	{
		if (Prim.IsA<UWidgetComponent>()) return true;
		for (int32 Index = 0; Index < Prim.GetNumMaterials(); ++Index)
		{
			const UMaterialInterface* Mat = Prim.GetMaterial(Index);
			if (Mat && IsTranslucentBlendMode(*Mat)) return true;
		}
		return false;
	}

	void Report(UWorld* World)
	{
		struct FRow { FString Name; int64 Tris; bool bTranslucent; };
		TArray<FRow> Rows;
		int64 Total = 0;
		int32 Translucent = 0, Components = 0;
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			if (It->IsHidden()) continue;
			TArray<UPrimitiveComponent*> Prims;
			It->GetComponents(Prims);
			for (const UPrimitiveComponent* Prim : Prims)
			{
				if (!Prim || !Prim->IsRegistered() || !Prim->IsVisible() || Prim->bHiddenInGame) continue;
				const int64 Tris = TrianglesOf(*Prim);
				const bool bTrans = IsTranslucent(*Prim);
				if (Tris == 0 && !bTrans) continue;
				++Components;
				Total += Tris;
				Translucent += bTrans ? 1 : 0;
				const UStaticMeshComponent* Mesh = Cast<UStaticMeshComponent>(Prim);
				const FString Asset = Mesh && Mesh->GetStaticMesh() ? Mesh->GetStaticMesh()->GetName() : Prim->GetClass()->GetName();
				Rows.Add({ FString::Printf(TEXT("%s.%s (%s)"), *It->GetName(), *Prim->GetName(), *Asset), Tris, bTrans });
			}
		}
		Rows.Sort([](const FRow& A, const FRow& B) { return A.Tris > B.Tris; });
		UE_LOG(LogBpTable, Log, TEXT("BpTier: report tier=%s visible_primitives=%d triangles_lod0=%lld translucent=%d hidden_by_tier=%d"),
			BpTier::IsOn(World) ? TEXT("on") : TEXT("off"), Components, Total, Translucent, HiddenByTier.Num());
		// While every light is on, what each Lights mode would switch off (a mode in force says it in `off`).
		FString Would;
		if (LightsMode == 1)
		{
			TArray<ULocalLightComponent*> Off0, Off2;
			LightsFor(World, 0, Off0);
			LightsFor(World, 2, Off2);
			Would = FString::Printf(TEXT(" (Lights 0 would switch off %d, Lights 2 %d)"), Off0.Num(), Off2.Num());
		}
		UE_LOG(LogBpTable, Log, TEXT("BpTier: switches cheap_lit=%d slot(s) (%d from MI_QL_, %d built) unlit_backdrop=%d quad=%d glass_hidden=%d lights=%d off=%d%s"),
			CheapSwaps.Num(), CheapFromInstance, CheapBuilt, BackdropSwaps.Num(), QuadSwaps.Num(), HiddenGlass.Num(), LightsMode, LightsOff.Num(), *Would);
		for (int32 Index = 0; Index < Rows.Num() && Index < 40; ++Index)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTier:   %8lld %s %s"), Rows[Index].Tris, Rows[Index].bTranslucent ? TEXT("T") : TEXT("o"), *Rows[Index].Name);
		}
	}

#if !UE_BUILD_SHIPPING
	/** bp.QuestTier.Hide: what it hid, so a clear shows exactly those again. */
	TArray<TWeakObjectPtr<AActor>> HiddenByAblation;

	FAutoConsoleCommandWithWorldAndArgs CmdHide(
		TEXT("bp.QuestTier.Hide"),
		TEXT("bp.QuestTier.Hide <substring>: hides every StaticMeshActor whose actor or mesh name contains it (case-insensitive), to ablate one mesh on the device; no argument shows them again. Logs what it hid. Non-Shipping builds only."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GEngine && (!World || !World->IsGameWorld()))
			{
				World = nullptr;
				for (const FWorldContext& Context : GEngine->GetWorldContexts())
				{
					if (Context.World() && Context.World()->IsGameWorld()) { World = Context.World(); break; }
				}
			}
			if (!World)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpTier: usage bp.QuestTier.Hide [substring] (needs a playing world)"));
				return;
			}
			if (Args.Num() == 0)
			{
				int32 Shown = 0;
				for (const TWeakObjectPtr<AActor>& Each : HiddenByAblation)
				{
					if (AActor* Actor = Each.Get()) { Actor->SetActorHiddenInGame(false); ++Shown; }
				}
				HiddenByAblation.Reset();
				UE_LOG(LogBpTable, Log, TEXT("BpTier: hide cleared, %d actor(s) shown again"), Shown);
				return;
			}
			const FString& Needle = Args[0];
			int32 Count = 0;
			for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
			{
				const UStaticMeshComponent* Comp = It->GetStaticMeshComponent();
				const UStaticMesh* Mesh = Comp ? Comp->GetStaticMesh() : nullptr;
				const FString MeshName = Mesh ? Mesh->GetName() : FString();
				if (It->IsHidden() || (!It->GetName().Contains(Needle) && !MeshName.Contains(Needle))) continue;
				It->SetActorHiddenInGame(true);
				HiddenByAblation.Add(*It);
				if (Count < 40) UE_LOG(LogBpTable, Log, TEXT("BpTier:   hid %s (%s)"), *It->GetName(), *MeshName);
				++Count;
			}
			UE_LOG(LogBpTable, Log, TEXT("BpTier: hide %s: %d actor(s) hidden"), *Needle, Count);
		}));
#endif

	FAutoConsoleCommandWithWorldAndArgs CmdReport(
		TEXT("bp.QuestTier.Report"),
		TEXT("bp.QuestTier.Report [delay_s]: every visible primitive in the playing world with its LOD0 triangles (times instances) and whether it draws translucent, largest first, and the totals (the S4 budget: draws under ~100, triangles under ~200k). A delay runs it later (from -ExecCmds, once the plan has drawn)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			// From the editor's console (PIE, the editor MCP) the world given is the editor's: report the playing one.
			if (GEngine && (!World || !World->IsGameWorld()))
			{
				World = nullptr;
				for (const FWorldContext& Context : GEngine->GetWorldContexts())
				{
					if (Context.World() && Context.World()->IsGameWorld()) { World = Context.World(); break; }
				}
			}
			if (!World)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpTier: usage bp.QuestTier.Report [delay_s] (needs a playing world)"));
				return;
			}
			const float Delay = Args.Num() > 0 ? FCString::Atof(*Args[0]) : 0.f;
			if (Delay <= 0.f)
			{
				Report(World);
				return;
			}
			FTimerHandle Later;
			const TWeakObjectPtr<UWorld> Weak(World);
			World->GetTimerManager().SetTimer(Later, FTimerDelegate::CreateLambda([Weak]() { if (UWorld* Each = Weak.Get()) Report(Each); }), Delay, false);
		}));
}

bool BpTier::IsOn(const UWorld* World)
{
	const int32 Want = CVarQuestTier.GetValueOnGameThread();
	if (Want >= 0) return Want > 0;
	return World && World->GetFeatureLevel() <= ERHIFeatureLevel::ES3_1;
}

float BpTier::HandShadowHz()
{
	return FMath::Max(0.f, CVarHandShadowHz.GetValueOnGameThread());
}

void BpTier::Apply(UWorld* World)
{
	if (!World) return;
	const bool bOn = IsOn(World);
	ApplySwitches(World, bOn);
	if (AppliedWorld.Get() == World && bAppliedOn == bOn) return;
	const bool bFirst = AppliedWorld.Get() != World;
	AppliedWorld = World;
	bAppliedOn = bOn;
	if (bFirst) HiddenByTier.Reset();
	if (!bOn)
	{
		for (const TWeakObjectPtr<UPrimitiveComponent>& Each : HiddenByTier)
		{
			if (UPrimitiveComponent* Prim = Each.Get()) Prim->SetVisibility(true);
		}
		if (!bFirst || HiddenByTier.Num() > 0) UE_LOG(LogBpTable, Log, TEXT("BpTier: quest tier off; %d haze card(s) shown again"), HiddenByTier.Num());
		HiddenByTier.Reset();
		return;
	}
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		TArray<UPrimitiveComponent*> Prims;
		It->GetComponents(Prims);
		for (UPrimitiveComponent* Prim : Prims)
		{
			if (!Prim || !Prim->IsVisible() || !IsHazeCard(*Prim)) continue;
			Prim->SetVisibility(false);
			HiddenByTier.Add(Prim);
		}
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTier: quest tier on (feature level %s, bp.QuestTier %d): %d haze card(s) hidden, scan veil off, live hand shadow at %.0f Hz"),
		World->GetFeatureLevel() <= ERHIFeatureLevel::ES3_1 ? TEXT("mobile") : TEXT("SM5+"), CVarQuestTier.GetValueOnGameThread(), HiddenByTier.Num(), HandShadowHz());
}
