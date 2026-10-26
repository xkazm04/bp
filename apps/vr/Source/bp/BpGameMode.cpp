#include "BpGameMode.h"

#include "BpPawn.h"
#include "BpTable.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Controller.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerStart.h"
#include "HAL/IConsoleManager.h"

namespace
{
	/** A pose relative to the table: the eye's height above the floor, its distance behind the near edge, the view's pitch
	 *  and horizontal field of view. */
	struct FBpPose
	{
		float EyeHeightCm;
		float BehindNearEdgeCm;
		float PitchDeg;
		float HFovDeg;
	};

	float TableTopCm()
	{
		const IConsoleVariable* Height = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.TableHeightCm"));
		return Height ? Height->GetFloat() : ABpTable::DefaultTableHeightCm;
	}

	bool FindPose(const FString& Name, FBpPose& Out)
	{
		if (Name.Equals(TEXT("play"), ESearchCase::IgnoreCase))
		{
			Out = { ABpGameMode::PlayEyeHeightCm, ABpGameMode::PlayBehindNearEdgeCm, ABpGameMode::PlayPitchDeg, ABpGameMode::PlayHFovDeg };
			return true;
		}
		// The screen deck's close-up (spark vr-room-layers WP2, readability judging): the target eye, turned to the deck's
		// front screen (which faces that eye, so it is seen straight on), at a narrow field (ApplyPose aims it).
		if (Name.Equals(TEXT("deck"), ESearchCase::IgnoreCase))
		{
			Out = { TableTopCm() + ABpGameMode::TargetEyeAboveTopCm, ABpGameMode::TargetBehindNearEdgeCm, ABpGameMode::TargetPitchDeg, 36.f };
			return true;
		}
		if (Name.Equals(TEXT("target"), ESearchCase::IgnoreCase))
		{
			Out = { TableTopCm() + ABpGameMode::TargetEyeAboveTopCm, ABpGameMode::TargetBehindNearEdgeCm, ABpGameMode::TargetPitchDeg, ABpGameMode::TargetHFovDeg };
			return true;
		}
		return false;
	}

	/** The pose's eye and view in the world, at the table's near edge (its -X side). */
	void PoseView(const ABpTable& Table, const FBpPose& Pose, FVector& Eye, FRotator& View)
	{
		const FTransform& T = Table.GetActorTransform();
		Eye = T.TransformPosition(FVector(-(ABpTable::TableDepthCm * 0.5 + Pose.BehindNearEdgeCm), 0.0, Pose.EyeHeightCm));
		View = FRotator(Pose.PitchDeg, T.Rotator().Yaw, 0.f);
	}

	void LogPose(const FString& Name, const FVector& Eye, const FBpPose& Pose)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpView: pose=%s eye_cm=(%.0f,%.0f,%.0f) pitch=%.0f hfov=%.0f"),
			*Name.ToLower(), Eye.X, Eye.Y, Eye.Z, Pose.PitchDeg, Pose.HFovDeg);
	}

	/** BpView.Pose target|play: PIE and editor captures only; the headset sets its own view. */
	FAutoConsoleCommandWithWorldAndArgs CmdViewPose(
		TEXT("BpView.Pose"),
		TEXT("BpView.Pose target|play|deck: put the view in the concept's framing (target), back at the play pose (play), or on the screen deck's front screen from the target eye (deck). For PIE captures."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0 || !ABpGameMode::ApplyPose(World, Args[0]))
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpView: usage BpView.Pose target|play (needs a playing world with a player and a table)"));
			}
		}));
}

ABpGameMode::ABpGameMode()
{
	DefaultPawnClass = ABpPawn::StaticClass();
}

bool ABpGameMode::ApplyPose(UWorld* World, const FString& Name)
{
	FBpPose Pose;
	if (!FindPose(Name, Pose)) return false;
	// From the editor's console (or an editor tool) the world is the editor's; the pose belongs to the playing one.
	if (GEngine && (!World || !World->IsGameWorld()))
	{
		World = nullptr;
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			if (Context.World() && Context.World()->IsGameWorld())
			{
				World = Context.World();
				break;
			}
		}
	}
	if (!World) return false;
	APlayerController* PC = World->GetFirstPlayerController();
	TActorIterator<ABpTable> Table(World);
	if (!PC || !Table) return false;

	FVector Eye;
	FRotator View;
	PoseView(**Table, Pose, Eye, View);
	if (Name.Equals(TEXT("deck"), ESearchCase::IgnoreCase)) View = (Table->GetDeckFrontWorld() - Eye).Rotation();
	if (APawn* Pawn = PC->GetPawn())
	{
		// The eye is the pawn's view point; the default pawn's sits at its origin, so the offset is usually zero.
		const FVector EyeOffset = Pawn->GetPawnViewLocation() - Pawn->GetActorLocation();
		Pawn->SetActorLocation(Eye - EyeOffset, false, nullptr, ETeleportType::TeleportPhysics);
	}
	PC->SetControlRotation(View);
	if (PC->PlayerCameraManager) PC->PlayerCameraManager->SetFOV(Pose.HFovDeg);
	LogPose(Name, Eye, Pose);
	return true;
}

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
	// No PlayerStart: stand the player in the play pose, looking down at the table.
	FBpPose Pose;
	FindPose(TEXT("play"), Pose);
	FVector Eye;
	FRotator View;
	PoseView(*Table, Pose, Eye, View);
	RestartPlayerAtTransform(NewPlayer, FTransform(FRotator(0.f, View.Yaw, 0.f), Eye));
	NewPlayer->SetControlRotation(View);
	LogPose(TEXT("play"), Eye, Pose);
}

void ABpGameMode::StartPlay()
{
	EnsureTable();
	Super::StartPlay();
}
