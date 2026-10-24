// The player (lynx-plan L3.4, spark vr-hands-zoom WP4): a camera at the play pose, the Interaction SDK's hand rigs, the
// controller rigs as the fallback, and UBpHands, which turns what they report into the table's levels. BpGameMode makes
// it the default pawn. Without a headset the camera is the flat view BpView.Pose moves; with one it follows the head.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "BpPawn.generated.h"

class UBpHands;
class UCameraComponent;
class UIsdkControllerRigComponent;
class UIsdkHandRigComponent;
class UMotionControllerComponent;
class USkeletalMeshComponent;

UCLASS()
class BP_API ABpPawn : public APawn
{
	GENERATED_BODY()

public:
	ABpPawn();

	virtual FVector GetPawnViewLocation() const override;

	UCameraComponent* GetCamera() const { return Camera; }
	/** 0 left, 1 right. */
	UIsdkHandRigComponent* GetHandRig(int32 Side) const;
	UIsdkControllerRigComponent* GetControllerRig(int32 Side) const;
	UMotionControllerComponent* GetControllerAim(int32 Side) const;

	/** The flat view's stand-in hands (the SDK's hand meshes at rest at the near edge): shown while the synthetic hand
	 *  is tracked, hidden when it is lost. */
	void SetRestHandsVisible(bool bVisible);

	/** Where the rest hands lie, from the eye of the play pose: forward, to each side, down (cm), and the yaw that points
	 *  the SDK meshes' fingers away from the viewer, palms down. */
	static constexpr float RestHandForwardCm = 24.f;
	static constexpr float RestHandSideCm = 22.f;
	static constexpr float RestHandDownCm = 62.f;
	static constexpr float RestHandYawDeg = 90.f;

	/** True when a headset is rendering: the camera follows it and the pawn's origin is the floor under the play eye. */
	static bool IsHeadsetOn();

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<USceneComponent> Origin;

	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UCameraComponent> Camera;

	/** The grip poses the Isdk rigs hang under (it looks for a UMotionControllerComponent above itself), per side. The
	 *  rigs are made in BeginPlay, and only when the world has Isdk tracking data. */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> HandGripLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> HandGripRight;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UIsdkHandRigComponent> HandRigLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UIsdkHandRigComponent> HandRigRight;

	/** The controllers: their grip (the rig's parent) and their aim pose (the pointer when the controllers lead). */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> ControllerGripLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> ControllerGripRight;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> ControllerAimLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UMotionControllerComponent> ControllerAimRight;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UIsdkControllerRigComponent> ControllerRigLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UIsdkControllerRigComponent> ControllerRigRight;

	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<UBpHands> Hands;

	/** Without a headset there are no tracked hands to draw; these stand in for them (and are removed with a headset). */
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<USkeletalMeshComponent> RestHandLeft;
	UPROPERTY(VisibleAnywhere, Category = "Bp|Pawn")
	TObjectPtr<USkeletalMeshComponent> RestHandRight;
};
