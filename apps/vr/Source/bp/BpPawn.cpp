#include "BpPawn.h"

#include "BpGameMode.h"
#include "BpHands.h"
#include "BpLink.h"
#include "BpTable.h"
#include "Camera/CameraComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/Engine.h"
#include "IXRTrackingSystem.h"
#include "IsdkFunctionLibrary.h"
#include "MotionControllerComponent.h"
#include "Rig/IsdkControllerRigComponent.h"
#include "Rig/IsdkHandRigComponent.h"
#include "StereoRendering.h"

namespace
{
	UMotionControllerComponent* MakeMotionController(ABpPawn* Pawn, USceneComponent* Parent, const TCHAR* Name, const TCHAR* Source)
	{
		UMotionControllerComponent* Controller = Pawn->CreateDefaultSubobject<UMotionControllerComponent>(Name);
		Controller->SetupAttachment(Parent);
		Controller->SetTrackingMotionSource(FName(Source));
		return Controller;
	}

	template <typename TRig>
	TRig* MakeRig(ABpPawn* Pawn, USceneComponent* Parent, const TCHAR* Name)
	{
		TRig* Rig = NewObject<TRig>(Pawn, Name);
		Rig->SetupAttachment(Parent);
		Rig->RegisterComponent();
		return Rig;
	}
}

ABpPawn::ABpPawn()
{
	PrimaryActorTick.bCanEverTick = false;

	Origin = CreateDefaultSubobject<USceneComponent>(TEXT("Origin"));
	RootComponent = Origin;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Origin);
	Camera->bLockToHmd = true;
	Camera->SetFieldOfView(ABpGameMode::PlayHFovDeg);

	HandGripLeft = MakeMotionController(this, Origin, TEXT("HandGripLeft"), TEXT("Left"));
	HandGripRight = MakeMotionController(this, Origin, TEXT("HandGripRight"), TEXT("Right"));

	ControllerGripLeft = MakeMotionController(this, Origin, TEXT("ControllerGripLeft"), TEXT("Left"));
	ControllerGripRight = MakeMotionController(this, Origin, TEXT("ControllerGripRight"), TEXT("Right"));
	ControllerAimLeft = MakeMotionController(this, Origin, TEXT("ControllerAimLeft"), TEXT("LeftAim"));
	ControllerAimRight = MakeMotionController(this, Origin, TEXT("ControllerAimRight"), TEXT("RightAim"));

	Hands = CreateDefaultSubobject<UBpHands>(TEXT("Hands"));

	static ConstructorHelpers::FObjectFinder<USkeletalMesh> LeftMesh(TEXT("/OculusInteraction/Models/Hands/SK_OpenXRHand_Left.SK_OpenXRHand_Left"));
	static ConstructorHelpers::FObjectFinder<USkeletalMesh> RightMesh(TEXT("/OculusInteraction/Models/Hands/SK_OpenXRHand_Right.SK_OpenXRHand_Right"));
	RestHandLeft = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("RestHandLeft"));
	RestHandRight = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("RestHandRight"));
	for (USkeletalMeshComponent* Rest : { RestHandLeft.Get(), RestHandRight.Get() })
	{
		Rest->SetupAttachment(Origin);
		Rest->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Rest->SetCastShadow(false);
	}
	if (LeftMesh.Succeeded()) RestHandLeft->SetSkeletalMeshAsset(LeftMesh.Object);
	if (RightMesh.Succeeded()) RestHandRight->SetSkeletalMeshAsset(RightMesh.Object);
	RestHandLeft->SetRelativeLocation(FVector(RestHandForwardCm, -RestHandSideCm, -RestHandDownCm));
	RestHandRight->SetRelativeLocation(FVector(RestHandForwardCm, RestHandSideCm, -RestHandDownCm));
	RestHandLeft->SetRelativeRotation(FRotator(0.f, RestHandYawDeg, 0.f));
	RestHandRight->SetRelativeRotation(FRotator(0.f, RestHandYawDeg, 0.f));
}

void ABpPawn::SetRestHandsVisible(bool bVisible)
{
	for (USkeletalMeshComponent* Rest : { RestHandLeft.Get(), RestHandRight.Get() })
	{
		if (Rest) Rest->SetVisibility(bVisible);
	}
}

bool ABpPawn::IsHeadsetOn()
{
	return GEngine && GEngine->XRSystem.IsValid() && GEngine->StereoRenderingDevice.IsValid() && GEngine->StereoRenderingDevice->IsStereoEnabled();
}

void ABpPawn::BeginPlay()
{
	// The Isdk rigs need a tracking data subsystem (an XR runtime, or PIE's stub hands); without one their BeginPlay
	// dereferences what it could not find. Made before Super::BeginPlay so they begin play with the pawn.
	if (UIsdkFunctionLibrary::FindTrackingDataSubsystem(GetWorld()).GetObject())
	{
		HandRigLeft = MakeRig<UIsdkHandRigComponentLeft>(this, HandGripLeft, TEXT("HandRigLeft"));
		HandRigRight = MakeRig<UIsdkHandRigComponentRight>(this, HandGripRight, TEXT("HandRigRight"));
		ControllerRigLeft = MakeRig<UIsdkControllerRigComponentLeft>(this, ControllerGripLeft, TEXT("ControllerRigLeft"));
		ControllerRigRight = MakeRig<UIsdkControllerRigComponentRight>(this, ControllerGripRight, TEXT("ControllerRigRight"));
	}
	else
	{
		UE_LOG(LogBpHands, Log, TEXT("BpHands: no Isdk tracking data in this world (no XR runtime); only the synthetic hand"));
	}
	Super::BeginPlay();
	if (IsHeadsetOn())
	{
		// The head sets the eye: the pawn stands on the floor under the play eye and the camera follows the headset.
		GEngine->XRSystem->SetTrackingOrigin(EHMDTrackingOrigin::LocalFloor);
		AddActorWorldOffset(FVector(0.0, 0.0, -ABpGameMode::PlayEyeHeightCm));
		Camera->bUsePawnControlRotation = false;
		RestHandLeft->DestroyComponent();
		RestHandRight->DestroyComponent();
	}
	else
	{
		// The flat view: the controller's rotation is the view (BpGameMode and BpView.Pose set it).
		Camera->bUsePawnControlRotation = true;
	}
	MakeWristPanel();
}

void ABpPawn::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (FBpLinkModule* Link = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Link->OnScanState().Remove(ScanHandle);
	Super::EndPlay(EndPlayReason);
}

FVector ABpPawn::GetPawnViewLocation() const
{
	return Camera ? Camera->GetComponentLocation() : GetActorLocation();
}

UIsdkHandRigComponent* ABpPawn::GetHandRig(int32 Side) const
{
	return Side == 0 ? HandRigLeft : HandRigRight;
}

UIsdkControllerRigComponent* ABpPawn::GetControllerRig(int32 Side) const
{
	return Side == 0 ? ControllerRigLeft : ControllerRigRight;
}

UMotionControllerComponent* ABpPawn::GetControllerAim(int32 Side) const
{
	return Side == 0 ? ControllerAimLeft : ControllerAimRight;
}
