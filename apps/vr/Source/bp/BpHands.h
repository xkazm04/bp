// The hands (lynx-plan L3.4, spark vr-hands-zoom WP4): point at a wing, a room or a crumb to highlight it; pinch on it and
// pull the pinch toward you to go a level in, push it away to go back; release a pinch on a crumb to jump to that level.
// A pull or a push is judged on the distance the pinch point has moved from where the pinch began, along the horizontal
// line from that point to the eye, never on speed, and one pinch makes at most one transition. Tracking loss is a state
// (registry hand-tracked-timing-windows, technique tracking-loss-as-a-game-state): a short gap coasts on the last trusted
// state, a longer one releases the pinch without a transition and holds the level, and the first samples after a gap are
// shown but not trusted for motion. Hands lead; the controllers' aim and trigger are the fallback.
//
// Three hands feed the same judging: the left and right of the headset (the Isdk hand rigs, or the controllers), and a
// synthetic one that the console drives (BpHands.Pinch, BpHands.Simulate) for runs without real hands.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BpHands.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogBpHands, Log, All);

class ABpPawn;
class ABpTable;
class UIsdkConditionalBool;
class UIsdkHandFingerPinchGrabRecognizer;
class UMaterialInstanceDynamic;

/** A hand's tracking, as the game sees it. */
UENUM()
enum class EBpTracking : uint8
{
	Tracked,
	/** A gap no longer than CoastS: the last trusted state holds, nothing is judged. */
	Coasting,
	/** The gap passed CoastS: the pinch is released without a transition and the level is held. */
	Lost,
	/** Samples are back; for SettleS they are shown but not trusted for motion. */
	Reacquiring
};

UCLASS(ClassGroup = (Bp), meta = (BlueprintSpawnableComponent))
class BP_API UBpHands : public UActorComponent
{
	GENERATED_BODY()

public:
	/** A pull toward the eye this far from the pinch's start enters the pinched wing or room. */
	static constexpr float PullEnterCm = 6.f;
	/** A push away from the eye this far from the pinch's start goes one level back. */
	static constexpr float PushBackCm = 6.f;
	/** The longest gap that coasts; a longer one is a loss. */
	static constexpr float CoastS = 0.3f;
	/** After a gap, samples are untrusted for motion this long. */
	static constexpr float SettleS = 0.2f;
	/** A lost hand's visual fades out over this long, then hides. */
	static constexpr float HandFadeS = 0.25f;
	/** The controller trigger's pinch: pressed above, released below (hysteresis). */
	static constexpr float TriggerPressed = 0.6f;
	static constexpr float TriggerReleased = 0.4f;
	/** The synthetic hand: where it stands on the line from the eye to its target (0 the eye, 1 the target), how far it
	 *  pulls and in what steps (one sample a frame), and how many frames it points before it pinches. */
	static constexpr float SyntheticReach = 0.4f;
	static constexpr float SyntheticPullCm = 9.f;
	static constexpr float SyntheticStepCm = 1.5f;
	static constexpr int32 SyntheticPointFrames = 3;
	/** BpHands.Simulate back gives up when no hand is tracked again within this long. */
	static constexpr float SimulateBackTimeoutS = 5.f;

	UBpHands();

	/** BpHands.* console commands, run one after another by the first UBpHands that ticks. */
	static TArray<FString>& PendingCommands();

	EBpTracking GetTracking(int32 Slot) const { return Slots[Slot].State; }

protected:
	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	enum : int32 { Left = 0, Right = 1, Synthetic = 2, SlotCount = 3 };
	enum class EInput : uint8 { None, Hands, Controllers };

	/** One frame of one hand. */
	struct FSample
	{
		bool bValid = false;
		/** The pointer ray (the hand's pointer pose, or the controller's aim). */
		bool bAims = false;
		FVector RayOrigin = FVector::ZeroVector;
		FVector RayDir = FVector::ForwardVector;
		/** Where the pinch is: the pointer pose's origin, or the controller. */
		FVector PinchPoint = FVector::ZeroVector;
		bool bPinching = false;
	};

	struct FSlot
	{
		EBpTracking State = EBpTracking::Lost;
		bool bEverTracked = false;
		float GapS = 0.f;
		float SettledS = 0.f;
		/** What the ray meets now (HitTest's kind and id). */
		FString HoverKind;
		FString HoverId;
		bool bPinch = false;
		/** The pinch already made its transition (or was judged to make none). */
		bool bFired = false;
		/** A pinch held through a loss: it must be seen released before a new one counts. */
		bool bNeedRelease = false;
		/** The pinch coasted across a gap: its start moves to the first trusted sample after it. */
		bool bRebase = false;
		FVector Onset = FVector::ZeroVector;
		FVector PullDir = FVector::ZeroVector;
		FString TargetKind;
		FString TargetId;
		float Fade = 1.f;
		bool bTriggerDown = false;
	};

	/** The synthetic hand's gesture in progress. */
	struct FGesture
	{
		enum class EStep : uint8 { Idle, Wait, Point, Pinch, Pull, Release, SimulateLost, SimulateBack };
		EStep Step = EStep::Idle;
		FString Id;
		FVector Hand = FVector::ZeroVector;
		FVector Aim = FVector::ZeroVector;
		FVector PullDir = FVector::ZeroVector;
		float PulledCm = 0.f;
		/** BpHands.Push: the same gesture away from the eye. */
		bool bPush = false;
		int32 Frames = 0;
		float ElapsedS = 0.f;
	};

	ABpTable* FindTable();
	FVector Eye() const;
	/** The horizontal unit vector from a point toward the eye (the pull direction). */
	FVector TowardEye(const FVector& Point) const;

	void ReadHeadset(float DeltaTime, FSample (&Out)[2]);
	FSample SyntheticSample();
	void Step(int32 Slot, const FSample& Sample, float DeltaTime);
	void Judge(int32 Slot, const FSample& Sample);
	void PinchStarted(FSlot& S, const FSample& Sample);
	void PinchEnded(FSlot& S);
	void Pull(FSlot& S);
	void Push(FSlot& S);
	void OnLost(int32 Slot);
	void OnBack(int32 Slot);
	void UpdateHighlight();
	void UpdateFades(float DeltaTime);
	void RunCommands(float DeltaTime);
	bool StartCommand(const FString& Command);
	void ActivateSynthetic();
	FString LevelName() const;
	static const TCHAR* SlotName(int32 Slot);

	FSlot Slots[SlotCount];
	FGesture Gesture;
	EInput Input = EInput::None;
	bool bSyntheticActive = false;
	/** BpHands.Simulate lost: every hand reports nothing until BpHands.Simulate back. */
	bool bForceLost = false;
	FString ShownKind;
	FString ShownId;
	bool bHighlightOwned = false;

	TWeakObjectPtr<ABpTable> Table;

	UPROPERTY(Transient)
	TObjectPtr<UIsdkHandFingerPinchGrabRecognizer> Pinch[2];
	/** Added to each hand visual's force-off group: true hides the hand once a loss has faded it out. */
	UPROPERTY(Transient)
	TObjectPtr<UIsdkConditionalBool> HideHand[2];
	/** The hand meshes' materials, per side, faded through their Opacity parameter where they have one. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> HandMidsLeft;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> HandMidsRight;
};
