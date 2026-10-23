#include "BpGameMode.h"

#include "BpTable.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Controller.h"
#include "GameFramework/PlayerStart.h"

ABpTable* ABpGameMode::EnsureTable()
{
	UWorld* World = GetWorld();
	if (!World) return nullptr;
	for (TActorIterator<ABpTable> It(World); It; ++It)
	{
		return *It;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ABpTable* Table = World->SpawnActor<ABpTable>(ABpTable::StaticClass(), FTransform::Identity, Params);
	UE_LOG(LogBpTable, Log, TEXT("BpTable: the level has none; BpGameMode placed one at the origin"));
	return Table;
}

void ABpGameMode::RestartPlayer(AController* NewPlayer)
{
	ABpTable* Table = EnsureTable();
	const bool bHasStart = GetWorld() && TActorIterator<APlayerStart>(GetWorld());
	if (!NewPlayer || bHasStart || !Table)
	{
		Super::RestartPlayer(NewPlayer);
		return;
	}
	// No PlayerStart: stand the player at the table's near edge (its -X side), looking down at it.
	const FTransform& T = Table->GetActorTransform();
	const FVector Eye = T.TransformPosition(FVector(-ViewBackFromCentreCm, 0.0, ViewEyeHeightCm));
	const FRotator View(ViewPitchDeg, T.Rotator().Yaw, 0.f);
	RestartPlayerAtTransform(NewPlayer, FTransform(FRotator(0.f, View.Yaw, 0.f), Eye));
	NewPlayer->SetControlRotation(View);
}

void ABpGameMode::StartPlay()
{
	EnsureTable();
	Super::StartPlay();
}
