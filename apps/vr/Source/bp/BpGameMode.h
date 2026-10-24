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
	/** ABpPawn (the camera, the hands and the controllers) is the default pawn. */
	ABpGameMode();

	/** The play pose: standing at the near edge (the table's -X side), eyes this high above the floor and this far behind
	 *  the edge, looking down at the sheet. Used only when the level has no PlayerStart. */
	static constexpr float PlayEyeHeightCm = 165.f;
	static constexpr float PlayBehindNearEdgeCm = 20.f;
	static constexpr float PlayPitchDeg = -50.f;
	/** The engine's default horizontal field of view; the headset sets its own. */
	static constexpr float PlayHFovDeg = 90.f;

	/** The target pose (console `BpView.Pose target`, PIE and editor captures only): the framing of the concept
	 *  docs/concepts/vr-light-table/target-light-table.jpg, found by comparing captures with it side by side. Its eye
	 *  height is above the table top, so it follows bp.TableHeightCm. */
	static constexpr float TargetEyeAboveTopCm = 43.f;
	static constexpr float TargetBehindNearEdgeCm = 30.f;
	static constexpr float TargetPitchDeg = -31.f;
	static constexpr float TargetHFovDeg = 70.f;

	virtual void StartPlay() override;
	virtual void RestartPlayer(AController* NewPlayer) override;

	/** Puts the first player's view in a named pose ("play" or "target") at the world's first table and logs
	 *  `BpView: pose=<name> eye_cm=(x,y,z) pitch=<deg> hfov=<deg>`. False for an unknown name or no player. */
	static bool ApplyPose(UWorld* World, const FString& Name);

private:
	/** The level's first ABpTable, or one spawned at the origin. */
	ABpTable* EnsureTable();
};
