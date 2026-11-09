// The Quest fidelity tier (BpTier.h). What the tier changes in code, and only while it is on:
//   - the studio's haze cards (level actors on M_HazeShaft / M_HazeVeil instances) hide: they are large translucent
//     planes stacked in front of the walls, overdraw the headset's tiled GPU pays for every covered pixel twice per eye;
//   - the scan's veil stays hidden (BpMarks.cpp): the scan line alone is the scan's one additive card;
//   - the live hand shadow is captured at bp.QuestTier.HandShadowHz, only while a hand is by the paper (BpTable.cpp);
//   - the city backdrop draws one unlit texture instead of the imported lit master (bp.QuestTier.UnlitBackdrop);
//   - the frame's leftover glass quad collapses in the vertex shader instead of shading the paper's area (bp.QuestTier.CollapseQuad);
//   - bp.QuestTier.Glass 0 hides the table's glass over the paper; it stays on until the headset judges the look.
// bp.QuestTier.Report logs every visible primitive with its triangles and blend, the input for the next cut on device.
#include "BpTier.h"

#include "BpTable.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SkinnedMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Engine.h"
#include "Engine/SkinnedAsset.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "MaterialShared.h"
#include "Materials/Material.h"
#include "Materials/MaterialInterface.h"
#include "Rendering/SkeletalMeshRenderData.h"
#include "StaticMeshResources.h"
#include "TimerManager.h"

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

	void ApplySwitches(UWorld* World, bool bOn)
	{
		if (SwitchWorld.Get() != World)
		{
			SwitchWorld = World;
			bGlassHidden = bBackdropSwapped = bQuadSwapped = false;
			HiddenGlass.Reset();
			BackdropSwaps.Reset();
			QuadSwaps.Reset();
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
