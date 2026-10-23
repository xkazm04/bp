// The bp game mode (lynx-plan L3.2): makes sure a light table stands in the level. A map that places ABpTable keeps its
// own; a level with none (the template's /Engine/Maps/Entry, until /Game/Maps/LightTable exists) gets one at the origin.
// Select it with GlobalDefaultGameMode in config, or per run with the URL option `?game=/Script/bp.BpGameMode`.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "BpGameMode.generated.h"

class ABpTable;

UCLASS()
class BP_API ABpGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	/** Standing at the near edge, eyes this high, looking down at the table (lynx-plan L3.2's capture pose). Used only
	 *  when the level has no PlayerStart. */
	static constexpr float ViewEyeHeightCm = 165.f;
	static constexpr float ViewBackFromCentreCm = 80.f;
	static constexpr float ViewPitchDeg = -45.f;

	virtual void StartPlay() override;
	virtual void RestartPlayer(AController* NewPlayer) override;

private:
	/** The level's first ABpTable, or one spawned at the origin. */
	ABpTable* EnsureTable();
};
