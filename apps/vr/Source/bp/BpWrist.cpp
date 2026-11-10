// The wrist panel (spark vr-fidelity-40 FC1, element 11; BpPawn.h). Night two W1 (the owner on the Quest 3S, 2026-11-09:
// "the wrist panel is overpopulated with options, we need to migrate into the main frame and keep wrist for quick
// decisions"; "wrist screen needs 90 degrees move in clock direction to face direction of my sight"): it keeps MENU (the
// console, BpConsole.cpp, where the old tabs went), SEAT, TOUR, and one card for what waits for a yes or a no: the armed
// scan (START, CANCEL), a scan's refusal (DISMISS), the decision on the deck or the card (APPROVE, DECLINE, calling what
// they call), else the lamp's offer; under it the scan band. Fewer, larger targets, every text over the 22' floor. With a
// headset it turns to face the eye by itself (bp.WristFace 1), on the hand bp.WristHand names, hidden while that hand is
// not tracked. The packages' wave (PackagesState) is read here for the console's PACKAGES page.
#include "BpPawn.h"

#include "BpAudio.h"
#include "BpGameMode.h"
#include "BpSheet.h"
#include "BpLink.h"
#include "BpTable.h"
#include "BpType.h"
#include "BpWords.h"
#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "MotionControllerComponent.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SCanvas.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	// The panel on the grip with a headset, set live (ABpPawn::ApplyWristPose). The grip's axes: X toward the thumb, Y out
	// of the palm, Z toward the wrist. 2026-11-08 (the owner, on the Quest 3S): the old pose (FRotator(-60, 180, 0), offset (0,
	// 0, 6)) faced 131 degrees away from the eye with a resting hand (palm down, forearm toward the paper, 30 cm forward and 40
	// down from the eye); turned 40% of that toward the eye it stands 79 degrees off, the turn a person makes is 40% shorter.
	// 2026-11-09 (night two W1): with bp.WristFace 1 (the default) only the offset holds and the panel turns to the eye by
	// itself; these rotations are bp.WristFace 0's fixed pose. Only the arm can confirm them.
	TAutoConsoleVariable<float> CVarWristPitch(TEXT("bp.WristPitchDeg"), -32.2f, TEXT("bp.WristFace 0: the wrist panel's pitch on the grip (degrees)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristYaw(TEXT("bp.WristYawDeg"), -110.4f, TEXT("bp.WristFace 0: the wrist panel's yaw on the grip (degrees)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristRoll(TEXT("bp.WristRollDeg"), -54.6f, TEXT("bp.WristFace 0: the wrist panel's roll on the grip (degrees)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristOffsetX(TEXT("bp.WristOffsetXCm"), -2.3f, TEXT("The wrist panel's offset along the grip's X, toward the thumb (cm)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristOffsetY(TEXT("bp.WristOffsetYCm"), -9.2f, TEXT("The wrist panel's offset along the left grip's Y, out of the palm (cm; negative: out of the back of the hand; mirrored on the right hand)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristOffsetZ(TEXT("bp.WristOffsetZCm"), 1.8f, TEXT("The wrist panel's offset along the grip's Z, toward the wrist (cm)."), ECVF_Default);
	TAutoConsoleVariable<int32> CVarWristPreview(TEXT("bp.WristPreview"), 0, TEXT("A flat check of the wrist pose: 1 hangs the panel from a modelled resting left hand (30 cm forward, 18 left, 40 down from the eye, palm down, forearm forward) with the bp.Wrist* pose, so a flat capture shows the angle."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristTint(TEXT("bp.WristTint"), 1.f, TEXT("The wrist sheet's brightness, 0.4 to 1.5 (1: the capture's)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristPreviewDeg(TEXT("bp.WristPreviewDeg"), 0.f, TEXT("With bp.WristPreview 1: the hand turned this far along the arc that squares the panel to the eye (degrees)."), ECVF_Default);
	TAutoConsoleVariable<int32> CVarWristFace(TEXT("bp.WristFace"), 1, TEXT("1 (default): the wrist panel turns to face the eye by itself (its normal at the eye, its up the head's up, smoothed), at the bp.WristOffset* point on the grip; 0: the fixed pose of bp.WristPitchDeg/YawDeg/RollDeg. Saved; settings' WRIST toggles it."), ECVF_Default);
	TAutoConsoleVariable<int32> CVarWristHand(TEXT("bp.WristHand"), 0, TEXT("The hand the wrist panel is on: 0 left (default), 1 right. Saved; settings' HAND toggles it."), ECVF_Default);
	TAutoConsoleVariable<float> CVarWristFaceRate(TEXT("bp.WristFaceRate"), 14.f, TEXT("How fast the facing wrist panel follows the eye (1/s, 2 to 60; higher is stiffer)."), ECVF_Default);

	/** The sheet's family (BpType.h; FE): a font whose cap height is CapPx pixels, Roboto until the table built it. */
	FSlateFontInfo CapFont(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Font = ABpTable::TextFontObject()) return FSlateFontInfo(Font, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}

	bool IsBuilt(const FString& Status)
	{
		return Status == TEXT("done") || Status == TEXT("accepted") || Status == TEXT("released");
	}

	// ---- The quick-decision layout, in the panel's pixels (WristPanelWidthCm x WristPanelHeightCm at WristPanelPxPerCm) -----
	// The type: buttons' caps 32 px, the card's title 30, its kicker, words and the band 26 (the five old styles under the
	// 22' floor, 18 to 21 px, are gone): at the posed capture hand (0.6 of the size, about 45 cm out) 26 px is 24'.
	constexpr float WristW = ABpPawn::WristPanelWidthCm * ABpPawn::WristPanelPxPerCm;
	constexpr float WristH = ABpPawn::WristPanelHeightCm * ABpPawn::WristPanelPxPerCm;
	constexpr float WX0 = 26.f;
	constexpr float WX1 = WristW - 26.f;
	constexpr float WGap = 14.f;
	constexpr float WTopY0 = 24.f, WTopY1 = 100.f;
	constexpr float WCardY0 = 116.f;
	constexpr float WBandH = 92.f;
	constexpr float WBtnH = 80.f;
	constexpr float WButtonCap = 32.f, WTitleCap = 30.f, WTextCap = 26.f;

	ABpPawn* WristPawn(UWorld* World)
	{
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdWristTap(
		TEXT("BpWrist.Tap"),
		TEXT("BpWrist.Tap <wrist:menu|wrist:seat|wrist:tour|wrist:approve|wrist:decline|wrist:scan:start|wrist:scan:cancel|wrist:scan:dismiss|wrist:ask:act|wrist:<any PanelAct act>|wrist:tab:<projects|rooms|packages|scan|ask|settings>>: what a hand's tap on that control of the wrist panel does (an old tab id opens the console on that page)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = WristPawn(World);
			if (Args.Num() == 0 || !Pawn)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpWrist: usage BpWrist.Tap <id> (a playing world with the bp pawn)"));
				return;
			}
			Pawn->WristTap(Args[0]);
		}));
}

void ABpPawn::MakeWristPanel()
{
	WristPanel = NewObject<UWidgetComponent>(this, TEXT("WristPanel"));
	WristPanel->SetWidgetSpace(EWidgetSpace::World);
	WristPanel->SetDrawSize(FVector2D(WristPanelWidthCm * WristPanelPxPerCm, WristPanelHeightCm * WristPanelPxPerCm));
	WristPanel->SetDrawAtDesiredSize(false);
	WristPanel->SetPivot(FVector2D(0.5, 0.5));
	// Wave 4: opaque (the sheet is the whole quad), cheaper than the glass it replaces and the type no longer fights the forearm.
	WristPanel->SetBlendMode(EWidgetBlendMode::Opaque);
	WristPanel->SetTwoSided(false);
	WristPanel->SetBackgroundColor(FLinearColor::Transparent);
	WristPanel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	WristPanel->SetCastShadow(false);
	WristPanel->SetWindowFocusable(false);
	WristPanel->SetManuallyRedraw(true);
	// bp.WristTint: the sheet's brightness for a device check (TickWristLive applies it live).
	WristPanel->SetTintColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, 1.f));
	const FVector Offset(WristPanelForwardCm, WristPanelSideCm, WristPanelDownCm);
	if (IsHeadsetOn())
	{
		// A headset: on the grip of the hand bp.WristHand names (ApplyWristPose holds the transform, live on the bp.Wrist* cvars).
		ApplyWristPose();
	}
	else
	{
		const float Pitch = FMath::DegreesToRadians(-ABpGameMode::TargetPitchDeg);
		const FVector ViewUp(FMath::Sin(Pitch), 0.0, FMath::Cos(Pitch));
		AActor* Wrist = nullptr;
		for (TActorIterator<AActor> It(GetWorld()); It && !Wrist; ++It) if (It->ActorHasTag(CaptureWristTag)) Wrist = *It;
		TActorIterator<ABpTable> Table(GetWorld());
		if (Wrist && Table)
		{
			// On the posed left hand: at the wrist point, turned to the target pose's eye (the pose the capture is judged from).
			const FTransform T = Table->GetActorTransform();
			const FVector Eye = T.TransformPosition(FVector(-(ABpTable::TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0,
				ABpTable::DefaultTableHeightCm + ABpGameMode::TargetEyeAboveTopCm));
			const FVector At = Wrist->GetActorLocation() + T.TransformVectorNoScale(FVector(WristCaptureOffsetXCm, WristCaptureOffsetYCm, WristCaptureOffsetZCm));
			SetWristParent(Wrist->GetRootComponent(), NAME_None, FTransform::Identity);
			// Then rolled about the view axis and tilted back about its own horizontal axis (FO), along the forearm.
			FQuat Facing = FRotationMatrix::MakeFromXZ(Eye - At, T.TransformVector(ViewUp)).ToQuat();
			Facing = FQuat(Facing.GetAxisX(), FMath::DegreesToRadians(WristCaptureRollDeg)) * Facing;
			Facing = FQuat(Facing.GetAxisY(), FMath::DegreesToRadians(WristCaptureTiltDeg)) * Facing;
			WristPanel->SetWorldTransform(FTransform(Facing, At, FVector(WristCaptureScale / WristPanelPxPerCm)));
		}
		else
		{
			SetWristParent(Origin.Get(), NAME_None, FTransform(FRotationMatrix::MakeFromXZ(-Offset, ViewUp).Rotator(), Offset, FVector(1.0 / WristPanelPxPerCm)));
		}
	}
	WristPanel->RegisterComponent();
	// No tick of its own while idle (night two W1): a change asks for one render, then it stops again.
	WristPanel->SetTickMode(ETickMode::Disabled);
	if (TActorIterator<ABpTable> It(GetWorld()); It)
	{
		WristTable = *It;
		RoomHandle = It->OnRoomModeChanged().AddUObject(this, &ABpPawn::OnWristRoomChanged);
		WristRoomMode = It->GetRoomModeId();
		WristBandHandle = It->OnScanBandChanged().AddUObject(this, &ABpPawn::RefreshWrist);
		WristAskHandle = It->OnLampAskChanged().AddUObject(this, &ABpPawn::RefreshWrist);
	}
	FBpLinkModule& Link = FBpLinkModule::Get();
	ScanHandle = Link.OnScanState().AddUObject(this, &ABpPawn::ReceiveScanState);
	// The console's PROJECTS page follows the products, their onboarding and the open product (WP-V1).
	WristOnboardingHandle = Link.OnOnboarding().AddUObject(this, &ABpPawn::OnWristOnboarding);
	WristProductHandle = Link.OnProduct().AddUObject(this, &ABpPawn::OnWristProduct);
	WristFocusHandle = Link.OnFocuses().AddUObject(this, &ABpPawn::OnWristFocuses);
	WristLinkHandle = Link.OnLinkStatus().AddUObject(this, &ABpPawn::OnWristLink);
	MakeConsole();
	ReceiveScanState(Link.GetScanState());
}

void ABpPawn::OnWristOnboarding(const FBpOnboardingState&)
{
	RefreshWrist();
}

void ABpPawn::OnWristFocuses(const FBpFocusList&)
{
	RefreshWrist();
}

void ABpPawn::OnWristLink(const FBpLinkStatus&)
{
	RefreshWrist();
}

FString ABpPawn::ArmedAct() const
{
	if (WristArmedFocus.IsEmpty()) return FString();
	if (WristArmedFocus == TEXT("@this")) return TEXT("scan:this");
	if (WristArmedFocus == TEXT("@every")) return TEXT("scan:every");
	return TEXT("focus:") + WristArmedFocus;
}

void ABpPawn::WristArmFocus(const FString& FocusId)
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	WristArmedFocus = FocusId;
	WristArmedTarget = Table->DirectedTarget();
	WristArmedLabel = Table->DirectedLabel(WristArmedTarget);
	WristArmedAt = FPlatformTime::Seconds();
	WristScanWords.Reset();
	bWristScanRefused = false;
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist armed %s by the lamp: Scan %s"), *FocusId, *WristArmedLabel);
	RefreshWrist();
}

void ABpPawn::WristDisarm()
{
	WristArmedFocus.Reset();
	WristArmedTarget.Reset();
	WristArmedLabel.Reset();
}

void ABpPawn::OnWristProduct(const FString&)
{
	// Another product: its rooms are not this one's (the table left room mode), and the packages are its own.
	WristRoomMode.Reset();
	// Its focuses are its own, and what was armed was for the old product's place.
	WristDisarm();
	WristScanWords.Reset();
	bWristScanRefused = bWristScanStarting = false;
	RefreshWrist();
}

void ABpPawn::OnWristRoomChanged(const FString& RoomId)
{
	WristRoomMode = RoomId;
	// The armed words named the room the table showed; it shows another now.
	WristDisarm();
	RefreshWrist();
}

bool ABpPawn::WristHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (!WristPanel || !WristPanel->IsVisible() || WristBoxes.Num() == 0) return false;
	const FTransform& T = WristPanel->GetComponentTransform();
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	// A one-sided mesh: a ray from behind passes through (the panel's back never takes a hit; before 2026-11-08 a ray
	// crossing it from behind stole the pinch from the table).
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (Denom >= -KINDA_SMALL_NUMBER) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	// UWidgetComponent's mapping (as the deck's): widget x = -local Y, y = -local Z, from its pivot, in draw pixels.
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const FVector2f Px(static_cast<float>(-Local.Y + WristW * 0.5f), static_cast<float>(-Local.Z + WristH * 0.5f));
	for (const FWristBox& Each : WristBoxes)
	{
		if (Each.Box.IsInside(Px))
		{
			OutId = Each.Id;
			return true;
		}
	}
	return false;
}

FVector ABpPawn::GetWristWorld() const
{
	return WristPanel ? WristPanel->GetComponentLocation() : GetActorLocation();
}

bool ABpPawn::WristAim(const FString& Id, FVector& OutWorld) const
{
	const FWristBox* Box = WristBoxes.FindByPredicate([&Id](const FWristBox& Each) { return Each.Id == Id; });
	if (!WristPanel || !Box) return false;
	const FVector2f C = Box->Box.GetCenter();
	OutWorld = WristPanel->GetComponentTransform().TransformPosition(FVector(0.0, -(C.X - WristW * 0.5f), -(C.Y - WristH * 0.5f)));
	return true;
}

void ABpPawn::WristTap(const FString& Id)
{
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist tap %s"), *Id);
	if (!Id.StartsWith(TEXT("wrist:")))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist tap %s does nothing here"), *Id);
		return;
	}
	const FString Act = Id.Mid(6);
	// MENU: the console, open or closed.
	if (Act == TEXT("menu"))
	{
		if (bConsoleOpen) CloseConsole();
		else OpenConsole(FString());
		return;
	}
	// The old tabs are the console's pages now (the deck's scan pill, scripts that tap "wrist:tab:scan").
	if (Act.StartsWith(TEXT("tab:")))
	{
		OpenConsole(Act.Mid(4));
		return;
	}
	if (Act.StartsWith(TEXT("page:")))
	{
		ConsoleTap(TEXT("console:") + Act);
		return;
	}
	PanelAct(Act);
}

void ABpPawn::PanelAct(const FString& Act)
{
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: act %s"), *Act);
	ABpTable* Table = WristTable.Get();
	// The stand-up's controls (BpStandup.cpp), from the console's sheet, the wrist and the bar's TAKE BACK.
	if (Act.StartsWith(TEXT("standup:")))
	{
		StandupAct(Act.Mid(8));
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("open:")))
	{
		OpenConsole(Act.Mid(5));
		return;
	}
	// The levels: heard at once, and an armed row stays armed.
	if (Act == TEXT("voice:minus") || Act == TEXT("voice:plus"))
	{
		BpAudio::StepVoiceLevel(Act.EndsWith(TEXT("plus")) ? BpAudio::VoiceStep : -BpAudio::VoiceStep);
		if (Table) Table->PreviewVoice();
		RefreshWrist();
		return;
	}
	if (Act == TEXT("music:minus") || Act == TEXT("music:plus"))
	{
		BpAudio::StepMusicLevel(Act.EndsWith(TEXT("plus")) ? BpAudio::MusicStep : -BpAudio::MusicStep);
		RefreshWrist();
		return;
	}
	// START on the wrist: the armed row's second pinch.
	if (Act == TEXT("scan:start"))
	{
		if (WristArmedFocus.IsEmpty()) { UE_LOG(LogBpTable, Log, TEXT("BpPawn: scan:start with nothing armed")); return; }
		PanelAct(ArmedAct());
		return;
	}
	// The PC link (the console's PC LINK page, BpConsole.cpp): pair, cancel, unpair, ask where.
	if (Act.StartsWith(TEXT("link:")))
	{
		FBpLinkModule& Link = FBpLinkModule::Get();
		const FString What = Act.Mid(5);
		if (What == TEXT("pair")) Link.Pair();
		else if (What == TEXT("cancel")) Link.CancelPair();
		else if (What == TEXT("unpair")) Link.Unpair();
		else if (What == TEXT("where")) Link.Where();
		RefreshWrist();
		return;
	}
	// A job's CANCEL on the SCAN page: DELETE .../scans/<job> (scope scan); the sample's stops the local walk.
	if (Act.StartsWith(TEXT("job:cancel:")))
	{
		const FString JobId = Act.Mid(11);
		if (JobId == TEXT("sample"))
		{
			if (Table) Table->CancelSampleScan();
			ConsoleScanWords = TEXT("The sample scan stopped.");
			RefreshWrist();
			return;
		}
		ConsoleScanWords = TEXT("Cancelling…");
		TWeakObjectPtr<ABpPawn> Self(this);
		FBpLinkModule::Get().CancelScan(JobId, [Self](int32, const FString& Words)
		{
			if (ABpPawn* Pawn = Self.Get())
			{
				Pawn->ConsoleScanWords = Words;
				Pawn->RefreshWrist();
			}
		});
		RefreshWrist();
		return;
	}
	// A finding in the SCAN page's feed: its decision screen when the room's deck has it, else the decision card asks about it.
	if (Act.StartsWith(TEXT("finding:")) && Table)
	{
		const FString Id = Act.Mid(8);
		const FBpProposal* Found = FBpLinkModule::Get().GetScanState().Scan.proposals.FindByPredicate([&Id](const FBpProposal& P) { return P.id == Id; });
		const bool bDeck = Found && Table->DeckFocusProposal(Id, Found->feature);
		if (!bDeck)
		{
			Table->AskCard(Id);
			Table->ShowCard(true);
		}
		UE_LOG(LogBpTable, Log, TEXT("BpPawn: finding %s opened on the %s"), *Id, bDeck ? TEXT("deck") : TEXT("decision card"));
		CloseConsole();
		return;
	}
	// A row armed: only that row goes on. Anything else disarms, and the rest of the scan's controls do only that.
	if (!WristArmedFocus.IsEmpty() && Act != ArmedAct() && !Act.StartsWith(TEXT("toggle:")))
	{
		WristDisarm();
		if (Act.StartsWith(TEXT("focus:")) || Act.StartsWith(TEXT("scan:")))
		{
			RefreshWrist();
			return;
		}
	}
	if (Act == TEXT("scan:dismiss"))
	{
		WristScanWords.Reset();
		bWristScanRefused = false;
		RefreshWrist();
		return;
	}
	if (Act == TEXT("scan:cancel"))
	{
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("ask:")) && Table)
	{
		const FString What = Act.Mid(4);
		if (What == TEXT("next")) Table->AskNextStep(TEXT("console"));
		else if (What == TEXT("here")) Table->AskPlanHere(TEXT("console"));
		else if (What == TEXT("scan")) Table->AskScanThis(TEXT("console"));
		else if (What == TEXT("act")) Table->LampAct(TEXT("wrist"));
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("project:")))
	{
		FBpLinkModule& Link = FBpLinkModule::Get();
		const FString Slug = Act.Mid(8);
		if (Slug == Link.GetProductSlug())
		{
			UE_LOG(LogBpTable, Log, TEXT("BpPawn: project %s is open already"), *Slug);
			return;
		}
		const FBpProductEntry* Entry = Link.FindProduct(Slug);
		UE_LOG(LogBpTable, Log, TEXT("BpPawn: %s %s (the table switches product)"), Entry && Entry->IsBuilding() ? TEXT("watch") : TEXT("open"), *Slug);
		Link.SetProduct(Slug);
		return;
	}
	// SCAN THIS and EVERY LENS (owner, 2026-11-09: a plain and an every-lens scan may start on a live product from VR), through
	// the same armed step a directed scan takes: the first press arms (the wrist shows START), a second press starts it.
	if ((Act == TEXT("scan:this") || Act == TEXT("scan:every")) && Table)
	{
		const FString Token = Act == TEXT("scan:this") ? TEXT("@this") : TEXT("@every");
		const double Now = FPlatformTime::Seconds();
		if (WristArmedFocus != Token || Table->DirectedTarget() != WristArmedTarget)
		{
			WristArmedFocus = Token;
			WristArmedTarget = Table->DirectedTarget();
			WristArmedLabel = Table->DirectedLabel(WristArmedTarget);
			WristArmedAt = Now;
			WristScanWords.Reset();
			bWristScanRefused = false;
			UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist armed %s: %s"), *Act, Token == TEXT("@this") ? *FString::Printf(TEXT("Scan %s with %s"), *WristArmedLabel, *BpWords::Lens(Table->GetActiveLens())) : TEXT("Scan everything with every lens"));
		}
		else if (Now - WristArmedAt < WristConfirmGuardS)
		{
			return;
		}
		else
		{
			const FString Target = WristArmedTarget;
			WristDisarm();
			bWristScanStarting = true;
			WristScanWords.Reset();
			bWristScanRefused = false;
			TWeakObjectPtr<ABpPawn> Self(this);
			const auto Done = [Self](bool bOk, const FString& Words)
			{
				ABpPawn* Pawn = Self.Get();
				if (!Pawn) return;
				Pawn->bWristScanStarting = false;
				Pawn->WristScanWords = Words;
				Pawn->bWristScanRefused = !bOk;
				Pawn->RefreshWrist();
			};
			if (Token == TEXT("@this")) Table->StartPlain(Target, FString(), Done);
			else Table->StartEveryLens(Done);
		}
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("focus:")) && Table)
	{
		const FString FocusId = Act.Mid(6);
		const FBpFocusList& List = FBpLinkModule::Get().GetFocusList();
		const FBpSavedFocus* Focus = List.Focuses.FindByPredicate([&FocusId](const FBpSavedFocus& F) { return F.Id == FocusId; });
		const double Now = FPlatformTime::Seconds();
		if (!Focus)
		{
			WristDisarm();
			WristScanWords = TEXT("That focus is gone. Open the page again.");
			bWristScanRefused = true;
		}
		else if (WristArmedFocus != FocusId || Table->DirectedTarget() != WristArmedTarget)
		{
			// First pinch, or the table moved under an armed row: the words must say what will happen now.
			WristArmedFocus = FocusId;
			WristArmedTarget = Table->DirectedTarget();
			WristArmedLabel = Table->DirectedLabel(WristArmedTarget);
			WristArmedAt = Now;
			WristScanWords.Reset();
			bWristScanRefused = false;
			UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist armed %s: Scan %s for: %s"), *FocusId, *WristArmedLabel, *Focus->Note);
		}
		else if (Now - WristArmedAt < WristConfirmGuardS)
		{
			// The pinch that armed it, bouncing: a real model run must not start on one.
			return;
		}
		else
		{
			const FString Target = WristArmedTarget;
			WristDisarm();
			bWristScanStarting = true;
			WristScanWords.Reset();
			bWristScanRefused = false;
			TWeakObjectPtr<ABpPawn> Self(this);
			Table->StartDirected(FocusId, Target, [Self](bool bOk, const FString& Words)
			{
				ABpPawn* Pawn = Self.Get();
				if (!Pawn) return;
				Pawn->bWristScanStarting = false;
				Pawn->WristScanWords = Words;
				Pawn->bWristScanRefused = !bOk;
				Pawn->RefreshWrist();
			});
		}
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("room:")) && Table)
	{
		Table->SwitchRoom(Act.Mid(5), TEXT("console"));
		return;
	}
	if (Act == TEXT("seat"))
	{
		Seat();
		return;
	}
	if (Act == TEXT("tour") && Table)
	{
		// Start, or stop while it runs (BpTour.Stop's door, by hand).
		if (Table->IsTourRunning()) Table->StopTour(TEXT("the menu"));
		else Table->StartTour();
		RefreshWrist();
		return;
	}
	if ((Act == TEXT("approve") || Act == TEXT("decline")) && Table)
	{
		Table->DecideWaiting(Act == TEXT("approve"), TEXT("wrist"));
		RefreshWrist();
		return;
	}
	if (Act.StartsWith(TEXT("toggle:")))
	{
		const FString What = Act.Mid(7);
		const TCHAR* Name = What == TEXT("face") ? TEXT("bp.WristFace") : What == TEXT("hand") ? TEXT("bp.WristHand") : What == TEXT("motion") ? TEXT("bp.ReducedMotion") : nullptr;
		if (IConsoleVariable* Var = Name ? IConsoleManager::Get().FindConsoleVariable(Name) : nullptr)
		{
			Var->Set(Var->GetInt() != 0 ? 0 : 1, ECVF_SetByConsole);
			UE_LOG(LogBpTable, Log, TEXT("BpPawn: %s %d"), Name, Var->GetInt());
		}
		RefreshWrist();
		return;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: act %s does nothing here"), *Act);
}

void ABpPawn::WristTextClasses(TArray<BpType::FClassSample>& Out) const
{
	if (!WristPanel) return;
	// The panel's caps in its pixels (DrawWrist's), at its centre, rising along its up; its world scale is cm a pixel.
	const FTransform& T = WristPanel->GetComponentTransform();
	const double CmPerPx = T.GetScale3D().X;
	const auto Add = [&](const TCHAR* Name, double CapPx) { Out.Add({ Name, CapPx * CmPerPx, T.GetLocation(), T.GetUnitAxis(EAxis::Z) }); };
	Add(TEXT("wrist button"), WButtonCap);
	Add(TEXT("wrist title"), WTitleCap);
	Add(TEXT("wrist kicker"), WTextCap);
	Add(TEXT("wrist words"), WTextCap);
	Add(TEXT("wrist scan band"), WTextCap);
}

void ABpPawn::ApplyWristPose()
{
	if (!WristPanel) return;
	const bool bHeadset = IsHeadsetOn();
	const int32 Preview = CVarWristPreview.GetValueOnGameThread();
	if (!bHeadset && Preview <= 0) return;
	const int32 Hand = CVarWristHand.GetValueOnGameThread() != 0 ? 1 : 0;
	FRotator Rot(CVarWristPitch.GetValueOnGameThread(), CVarWristYaw.GetValueOnGameThread(), CVarWristRoll.GetValueOnGameThread());
	FVector Off(CVarWristOffsetX.GetValueOnGameThread(), CVarWristOffsetY.GetValueOnGameThread(), CVarWristOffsetZ.GetValueOnGameThread());
	if (Hand == 1)
	{
		// The right grip mirrors the left across the plane of the palm's normal (OpenXR's grip +X points out of the left palm
		// and into the right one): the offset's Y and the fixed pose's yaw and roll flip.
		Off.Y = -Off.Y;
		Rot = FRotator(Rot.Pitch, -Rot.Yaw, -Rot.Roll);
	}
	const float Turn = CVarWristPreviewDeg.GetValueOnGameThread();
	const FString Applied = FString::Printf(TEXT("%.2f/%.2f/%.2f %.2f,%.2f,%.2f p%d %.1f h%d %s"), Rot.Pitch, Rot.Yaw, Rot.Roll, Off.X, Off.Y, Off.Z, Preview, Turn, Hand, *GetActorLocation().ToString());
	if (Applied == WristPoseApplied) return;
	const bool bLog = !WristPoseApplied.IsEmpty();
	WristPoseApplied = Applied;
	bWristFaceInit = false;
	const FTransform Relative(Rot, Off, FVector(1.0 / WristPanelPxPerCm));
	if (bHeadset)
	{
		SetWristParent(Hand == 1 ? HandGripRight.Get() : HandGripLeft.Get(), NAME_None, Relative);
	}
	else
	{
		// The flat check: a stand-in for the resting grip, 30 cm forward, 18 to the side and 40 down from the eye, X toward the
		// thumb, Y out of the palm (down), Z toward the wrist (back), turned along the arc that squares the panel to the eye.
		if (!WristSimGrip)
		{
			WristSimGrip = NewObject<USceneComponent>(this, TEXT("WristSimGrip"));
			WristSimGrip->SetupAttachment(Origin);
			WristSimGrip->RegisterComponent();
			SetWristParent(WristSimGrip.Get(), NAME_None, Relative);
		}
		const FVector GripAt(30.0, Hand == 1 ? 18.0 : -18.0, -40.0);
		FQuat Grip = FRotationMatrix::MakeFromXZ(FVector(0.0, Hand == 1 ? -1.0 : 1.0, 0.0), FVector(-1.0, 0.0, 0.0)).ToQuat();
		const FTransform Neutral(Grip, GripAt);
		const FVector PanelAt = Neutral.TransformPosition(Off);
		const FVector Normal = Grip.RotateVector(Rot.Vector());
		const FVector ToEye = (FVector::ZeroVector - PanelAt).GetSafeNormal();
		const FVector Axis = FVector::CrossProduct(Normal, ToEye).GetSafeNormal();
		if (!Axis.IsNearlyZero() && Turn != 0.f) Grip = FQuat(Axis, FMath::DegreesToRadians(Turn)) * Grip;
		WristSimGrip->SetRelativeLocationAndRotation(GripAt, Grip);
		SetWristParent(WristSimGrip.Get(), NAME_None, Relative);
		const double Off1 = FMath::RadiansToDegrees(FMath::Acos(FVector::DotProduct(Grip.RotateVector(Rot.Vector()).GetSafeNormal(), ToEye)));
		if (bLog) UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist preview turn %.1f deg: the fixed pose faces %.1f deg off the eye"), Turn, Off1);
	}
	if (bLog) UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist pose pitch=%.1f yaw=%.1f roll=%.1f offset=(%.1f, %.1f, %.1f) hand=%s applied"), Rot.Pitch, Rot.Yaw, Rot.Roll, Off.X, Off.Y, Off.Z, Hand == 1 ? TEXT("right") : TEXT("left"));
}

void ABpPawn::TickWristFace(float DeltaSeconds)
{
	if (!WristPanel) return;
	const bool bHeadset = IsHeadsetOn();
	const bool bPreview = CVarWristPreview.GetValueOnGameThread() > 0;
	if (!bHeadset && !bPreview) return;
	// Hidden while its hand is not tracked (hands or controller: the grip reports either); the ray test skips a hidden panel.
	const int32 Hand = CVarWristHand.GetValueOnGameThread() != 0 ? 1 : 0;
	const UMotionControllerComponent* Grip = Hand == 1 ? HandGripRight.Get() : HandGripLeft.Get();
	const bool bTracked = !bHeadset || (Grip && Grip->IsTracked());
	if (WristPanel->IsVisible() != bTracked)
	{
		WristPanel->SetVisibility(bTracked, true);
		UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist %s (the %s hand %s)"), bTracked ? TEXT("shown") : TEXT("hidden"), Hand == 1 ? TEXT("right") : TEXT("left"), bTracked ? TEXT("is tracked") : TEXT("is not tracked"));
	}
	if (!bTracked || CVarWristFace.GetValueOnGameThread() == 0)
	{
		// bp.WristFace 0: the fixed pose ApplyWristPose set, relative to the grip.
		if (bWristFaceInit)
		{
			bWristFaceInit = false;
			WristPoseApplied.Reset();
			ApplyWristPose();
		}
		return;
	}
	// The panel's normal at the eye, its up the head's up; smoothed so a trembling hand does not shake the text.
	const FVector At = WristPanel->GetComponentLocation();
	const FVector Eye = GetPawnViewLocation();
	const FVector HeadUp = Camera ? Camera->GetUpVector() : FVector::UpVector;
	const FVector ToEye = Eye - At;
	if (ToEye.IsNearlyZero()) return;
	const FQuat Want = FRotationMatrix::MakeFromXZ(ToEye, HeadUp).ToQuat();
	if (!bWristFaceInit)
	{
		WristFaceQuat = Want;
		bWristFaceInit = true;
	}
	else
	{
		const float Rate = FMath::Clamp(CVarWristFaceRate.GetValueOnGameThread(), 2.f, 60.f);
		WristFaceQuat = FQuat::Slerp(WristFaceQuat, Want, 1.f - FMath::Exp(-Rate * DeltaSeconds));
	}
	WristPanel->SetWorldRotation(WristFaceQuat);
}

void ABpPawn::SetWristHover(const FString& Id)
{
	if (Id == WristHover) return;
	WristHover = Id;
	DrawWrist();
}

void ABpPawn::TickWristLive()
{
	ApplyWristPose();
	if (WristPanel)
	{
		const float Tint = FMath::Clamp(CVarWristTint.GetValueOnGameThread(), 0.4f, 1.5f);
		if (Tint != WristTintShown)
		{
			WristTintShown = Tint;
			WristPanel->SetTintColorAndOpacity(FLinearColor(Tint, Tint, Tint, 1.f));
		}
	}
	// The hand moved to the other side (settings' HAND, or adb): the pose again.
	const int32 Hand = CVarWristHand.GetValueOnGameThread() != 0 ? 1 : 0;
	if (Hand != WristHandShown)
	{
		WristHandShown = Hand;
		WristPoseApplied.Reset();
		ApplyWristPose();
	}
	// The decision the wrist offers follows the deck's front screen and the card, which change without a delegate.
	if (ABpTable* Table = WristTable.Get())
	{
		FString Id, Title, Where;
		const FString Key = Table->WaitingDecision(Id, Title, Where) ? Where + Id : FString();
		if (Key != WristDecisionKey)
		{
			WristDecisionKey = Key;
			DrawWrist();
		}
	}
}

void ABpPawn::SetWristParent(USceneComponent* Parent, FName Socket, const FTransform& Relative)
{
	if (!WristPanel || !Parent) return;
	if (WristPanel->IsRegistered()) WristPanel->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform, Socket);
	else WristPanel->SetupAttachment(Parent, Socket);
	WristPanel->SetRelativeTransform(Relative);
}

void ABpPawn::ReceiveScanState(const FBpScanState&)
{
	RefreshWrist();
}

void ABpPawn::RefreshWrist()
{
	DrawWrist();
	RefreshConsole();
}

const FBpWave* ABpPawn::PackagesState(TArray<FPackageRow>& OutRows, bool& bOutDraft, FString& OutKey) const
{
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	// The wave shown: the draft the screen deck last wrote to (spark vr-room-layers WP2: the wrist reflects each Approve),
	// else the last dispatched, else the newest draft.
	const FBpWave* Wave = State.Waves.FindByPredicate([](const FBpWave& Each) { return Each.status == TEXT("draft") && Each.id == FBpLinkModule::Get().GetFocusWaveId(); });
	for (const FBpWave& Each : State.Waves)
	{
		if (Wave && Wave->id == FBpLinkModule::Get().GetFocusWaveId()) break;
		const bool bDispatched = Each.status == TEXT("dispatched");
		if (!Wave) { Wave = &Each; continue; }
		const bool bWaveDispatched = Wave->status == TEXT("dispatched");
		if (bDispatched != bWaveDispatched) { if (bDispatched) Wave = &Each; continue; }
		const FString& A = bDispatched ? Each.dispatched_at : Each.created_at;
		const FString& B = bDispatched ? Wave->dispatched_at : Wave->created_at;
		if (A > B) Wave = &Each;
	}
	TMap<FString, FString> Status;
	for (const FBpProposal& Proposal : State.Scan.proposals) Status.Add(Proposal.id, Proposal.status);
	OutKey = Wave ? Wave->id + Wave->status : FString(TEXT("none"));
	if (Wave)
	{
		for (const FBpWavePackage& Package : Wave->packages)
		{
			int32 Built = 0;
			// FAF: the package's findings by triage tier (store v4), as the ledger's T0..T3 chips; untriaged ones are not counted.
			int32 ByTier[4] = { 0, 0, 0, 0 };
			for (const FString& Id : Package.ids)
			{
				Built += IsBuilt(Status.FindRef(Id)) ? 1 : 0;
				if (const int32* Tier = State.Tiers.Find(Id)) ++ByTier[FMath::Clamp(*Tier, 0, 3)];
			}
			TArray<FString> Chips;
			for (int32 Tier = 0; Tier < 4; ++Tier) if (ByTier[Tier] > 0) Chips.Add(FString::Printf(TEXT("T%d %d"), Tier, ByTier[Tier]));
			const float Fraction = Package.ids.Num() > 0 ? static_cast<float>(Built) / Package.ids.Num() : 0.f;
			OutRows.Add({ Package.name, FString::Printf(TEXT("%d %s · %s · %s"), Package.ids.Num(), Package.ids.Num() == 1 ? TEXT("finding") : TEXT("findings"), *Package.model, *Package.effort),
				FString::Join(Chips, TEXT("  ")), Fraction, Package.ids.Num() });
			OutKey += FString::Printf(TEXT("|%s:%d/%d:%s"), *Package.id, Built, Package.ids.Num(), *Package.name);
		}
	}
	// A draft (composed, not dispatched) has queued nothing, so its rings say "draft" rather than a built share (FAD).
	bOutDraft = Wave && Wave->status == TEXT("draft");
	return Wave;
}

void ABpPawn::DrawWrist()
{
	if (!WristPanel) return;
	ABpTable* Table = WristTable.Get();
	const bool bPlan = Table && Table->HasPlan();
	// What the card shows, most pressing first: an armed scan, a scan's refusal, the decision waiting, the lamp's offer.
	enum class ECard : uint8 { Armed, Refused, Decision, Offer, Calm, Standup };
	FString DecisionId, DecisionTitle, DecisionWhere;
	const bool bDecision = bPlan && Table->WaitingDecision(DecisionId, DecisionTitle, DecisionWhere);
	const FString Offer = bPlan ? Table->LampOfferLabel() : FString();
	// The stand-up (night two W2b): the decision on its sheet with the same answers, else "handed over" with TAKE BACK.
	FString SuKicker, SuTitle, SuWords;
	TArray<TPair<FString, FString>> SuButtons;
	const bool bStandupCard = StandupWristCard(SuKicker, SuTitle, SuWords, SuButtons);
	const bool bStandupFirst = bStandupCard && IsStandupOpen();
	const ECard Card = bStandupFirst ? ECard::Standup : !WristArmedFocus.IsEmpty() ? ECard::Armed : bWristScanRefused && !WristScanWords.IsEmpty() ? ECard::Refused
		: bDecision ? ECard::Decision : !Offer.IsEmpty() ? ECard::Offer : bStandupCard ? ECard::Standup : ECard::Calm;
	FString BandHead, BandBody;
	if (bPlan) Table->ScanBand(BandHead, BandBody);
	const bool bSample = !FBpLinkModule::Get().HasPcLink() && FBpLinkModule::Get().HasSampleFocuses();
	const bool bTour = bPlan && Table->IsTourRunning();
	// The link in one word (night two W2a): CABLE, WI-FI, OFFLINE or PAIRING, at the card's top right.
	const FString LinkWord = FBpLinkModule::RouteWord(FBpLinkModule::Get().GetLinkStatus());
	FString Key = FString::Printf(TEXT("c%d|%s|%s|%s|%s|%s|%s|%d|%d|%s|%s|%s"), static_cast<int32>(Card), *WristArmedFocus, *WristArmedLabel, *WristScanWords, *DecisionId, *DecisionTitle,
		*DecisionWhere, bTour, bConsoleOpen, *BandHead, *BandBody, *LinkWord);
	if (Card == ECard::Offer) Key += TEXT("|o") + Offer + Table->GetLampAnswer();
	if (Card == ECard::Standup)
	{
		Key += TEXT("|s") + SuKicker + SuTitle + SuWords;
		for (const TPair<FString, FString>& B : SuButtons) Key += TEXT("/") + B.Key;
	}
	Key += TEXT("|h") + WristHover;
	if (Key == WristKey) return;
	WristKey = Key;
	WristBoxes.Reset();

	TSharedRef<SCanvas> Over = SNew(SCanvas);
	const auto Put = [&Over](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Over->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const FSlateFontInfo ButtonFont = CapFont(TEXT("Bold"), WButtonCap), TitleFont = CapFont(TEXT("Bold"), WTitleCap);
	const FSlateFontInfo KickerFont = CapFont(TEXT("Bold"), WTextCap), WordsFont = CapFont(TEXT("Regular"), WTextCap);
	// A button: filled (the primary), outlined, or quiet; its word centred.
	enum class EBtn : uint8 { Fill, Edge, Amber };
	const auto Button = [&](const FBox2f& Box, const FString& Word, EBtn Look, const FString& Id)
	{
		const FLinearColor Fill = Look == EBtn::Fill ? BpSheet::Accent : Look == EBtn::Amber ? BpSheet::Amber : BpSheet::PaperLo.CopyWithNewOpacity(0.55f);
		const FLinearColor Edge = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(0.85f) : FLinearColor::Transparent;
		const FLinearColor Ink = Look == EBtn::Edge ? BpSheet::InkHi : BpSheet::PaperLo;
		Put(Box, SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(Fill).Edge(Edge).EdgePx(2.5f)]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Word, ButtonFont, Box.GetSize().X - 24.f))).Font(ButtonFont).ColorAndOpacity(FSlateColor(Ink))
			]);
		WristBoxes.Add({ TEXT("wrist:") + Id, Box });
	};

	// The top row: MENU (the console), SEAT, TOUR.
	{
		const float W = (WX1 - WX0 - 2.f * WGap);
		const float MenuW = W * 0.42f, SideW = (W - MenuW) * 0.5f;
		Button(FBox2f(FVector2f(WX0, WTopY0), FVector2f(WX0 + MenuW, WTopY1)), bConsoleOpen ? TEXT("CLOSE") : TEXT("MENU"), EBtn::Fill, TEXT("menu"));
		Button(FBox2f(FVector2f(WX0 + MenuW + WGap, WTopY0), FVector2f(WX0 + MenuW + WGap + SideW, WTopY1)), TEXT("SEAT"), EBtn::Edge, TEXT("seat"));
		Button(FBox2f(FVector2f(WX1 - SideW, WTopY0), FVector2f(WX1, WTopY1)), bTour ? TEXT("STOP TOUR") : TEXT("TOUR"), EBtn::Edge, TEXT("tour"));
	}

	// The band (the scan on the table or just run) along the foot; the card fills the rest.
	const bool bBand = !BandHead.IsEmpty();
	const float CardY1 = bBand ? WristH - 24.f - WBandH - WGap : WristH - 24.f;
	const FBox2f CardBox(FVector2f(WX0, WCardY0), FVector2f(WX1, CardY1));
	const float TextW = WX1 - WX0 - 2.f * 22.f;
	FString Kicker, Title, Words;
	FLinearColor KickerInk = BpSheet::Accent, CardEdge = BpSheet::Ink.CopyWithNewOpacity(0.45f);
	struct FCardButton { FString Word; EBtn Look; FString Id; };
	TArray<FCardButton> Buttons;
	switch (Card)
	{
	case ECard::Armed:
	{
		const FBpFocusList& List = FBpLinkModule::Get().GetFocusList();
		const FBpSavedFocus* Armed = List.Focuses.FindByPredicate([this](const FBpSavedFocus& F) { return F.Id == WristArmedFocus; });
		Kicker = bSample ? TEXT("SAMPLE SCAN · READY") : TEXT("SCAN · READY");
		KickerInk = BpSheet::Amber;
		CardEdge = BpSheet::Amber;
		const FString Place = WristArmedLabel.IsEmpty() ? FString(TEXT("this place")) : WristArmedLabel;
		if (WristArmedFocus == TEXT("@this"))
		{
			Title = FString::Printf(TEXT("Scan %s"), *Place);
			Words = FString::Printf(TEXT("%s · %s"), bPlan ? *BpWords::Lens(Table->GetActiveLens()) : TEXT("the lens shown"), bSample ? TEXT("a sample: nothing is read or written") : TEXT("a plain scan on your PC"));
		}
		else if (WristArmedFocus == TEXT("@every"))
		{
			Title = TEXT("Scan everything with every lens");
			Words = TEXT("One job on your PC reads each enabled lens.");
		}
		else
		{
			Title = FString::Printf(TEXT("Scan %s for:"), *Place);
			Words = Armed ? Armed->Note : FString();
		}
		Buttons = { { TEXT("START"), EBtn::Amber, TEXT("scan:start") }, { TEXT("CANCEL"), EBtn::Edge, TEXT("scan:cancel") } };
		break;
	}
	case ECard::Refused:
		Kicker = TEXT("THE SCAN DID NOT START");
		KickerInk = BpSheet::Red;
		CardEdge = BpSheet::Red;
		Words = WristScanWords;
		Buttons = { { TEXT("DISMISS"), EBtn::Edge, TEXT("scan:dismiss") } };
		break;
	case ECard::Decision:
		Kicker = DecisionWhere == TEXT("deck") ? TEXT("DECISION · ON THE SCREEN") : TEXT("DECISION · ON THE CARD");
		Title = DecisionTitle;
		Buttons = { { TEXT("APPROVE"), EBtn::Amber, TEXT("approve") }, { TEXT("DECLINE"), EBtn::Edge, TEXT("decline") } };
		break;
	case ECard::Standup:
		Kicker = SuKicker;
		KickerInk = BpSheet::Amber;
		CardEdge = BpSheet::Amber;
		Title = SuTitle;
		Words = SuWords;
		for (int32 Index = 0; Index < SuButtons.Num(); ++Index)
		{
			const bool bTake = SuButtons[Index].Value == TEXT("standup:revoke");
			Buttons.Add({ SuButtons[Index].Key, Index == 0 && !bTake ? EBtn::Amber : bTake ? EBtn::Amber : EBtn::Edge, SuButtons[Index].Value });
		}
		break;
	case ECard::Offer:
		Kicker = TEXT("THE LAMP SUGGESTS");
		Words = Table->GetLampAnswer();
		Buttons = { { Offer.ToUpper(), EBtn::Amber, TEXT("ask:act") } };
		break;
	default:
		Kicker = TEXT("NOTHING WAITING");
		KickerInk = BpSheet::Ink.CopyWithNewOpacity(0.7f);
		Words = bPlan ? TEXT("Rooms, scans, projects and settings are in the menu.") : TEXT("The table is reading the plan.");
		break;
	}
	// The card: its kicker, its title and words, its buttons along its foot.
	{
		const float BtnY0 = CardBox.Max.Y - 18.f - WBtnH;
		const float LinesH = (Buttons.Num() > 0 ? BtnY0 : CardBox.Max.Y) - CardBox.Min.Y - 16.f;
		const float LinkW = BpSheet::TextWidth(LinkWord, KickerFont);
		const FLinearColor LinkInk = LinkWord == TEXT("PAIRING") ? BpSheet::Amber : LinkWord == TEXT("OFFLINE") ? BpSheet::Ink.CopyWithNewOpacity(0.7f) : BpSheet::Accent;
		TSharedRef<SVerticalBox> Lines = SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Kicker, KickerFont, TextW - LinkW - 28.f))).Font(KickerFont).ColorAndOpacity(FSlateColor(KickerInk))]
				+ SHorizontalBox::Slot().AutoWidth()[SNew(STextBlock).Text(FText::FromString(LinkWord)).Font(KickerFont).ColorAndOpacity(FSlateColor(LinkInk))]
			];
		// The title takes up to two lines (three with no words under it), the words what is left.
		const float TitlePitch = WTitleCap / static_cast<float>(BpType::CapPerEm) * 1.2f, WordsPitch = WTextCap / static_cast<float>(BpType::CapPerEm) * 1.2f;
		const float Room = LinesH - WTextCap / static_cast<float>(BpType::CapPerEm) * 1.2f - 18.f;
		int32 TitleLines = 0;
		if (!Title.IsEmpty())
		{
			TitleLines = FMath::Clamp(FMath::FloorToInt(Room / TitlePitch), 1, Words.IsEmpty() ? 3 : 2);
			Lines->AddSlot().AutoHeight().Padding(0.f, 10.f, 0.f, 0.f)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(Title, TitleFont, TextW, TitleLines))).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))
			];
		}
		if (!Words.IsEmpty())
		{
			const int32 WordLines = FMath::Max(1, FMath::FloorToInt((Room - TitleLines * TitlePitch) / WordsPitch));
			Lines->AddSlot().AutoHeight().Padding(0.f, 8.f, 0.f, 0.f)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(Words, WordsFont, TextW, WordLines))).Font(WordsFont).ColorAndOpacity(FSlateColor(BpSheet::Ink))
			];
		}
		Put(CardBox, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.35f)).Edge(CardEdge).EdgePx(2.f));
		Put(FBox2f(CardBox.Min + FVector2f(22.f, 16.f), FVector2f(CardBox.Max.X - 22.f, CardBox.Min.Y + 16.f + LinesH)), SNew(SBox).Clipping(EWidgetClipping::ClipToBounds)[Lines]);
		// Each button as wide as its word needs, the row's spare width shared out evenly (three answers fit: APPROVE is wider).
		const int32 N = Buttons.Num();
		const float RowW = CardBox.GetSize().X - 2.f * 18.f - FMath::Max(0, N - 1) * WGap;
		TArray<float> Widths;
		float Need = 0.f;
		for (const FCardButton& Each : Buttons) { Widths.Add(BpSheet::TextWidth(Each.Word, ButtonFont) + 30.f); Need += Widths.Last(); }
		const float Spare = N > 0 ? (RowW - Need) / N : 0.f;
		float X0 = CardBox.Min.X + 18.f;
		for (int32 Index = 0; Index < N; ++Index)
		{
			const float BW = Spare >= 0.f ? Widths[Index] + Spare : RowW / N;
			Button(FBox2f(FVector2f(X0, BtnY0), FVector2f(X0 + BW, BtnY0 + WBtnH)), Buttons[Index].Word, Buttons[Index].Look, Buttons[Index].Id);
			X0 += BW + WGap;
		}
	}
	if (bBand)
	{
		const FBox2f Band(FVector2f(WX0, WristH - 24.f - WBandH), FVector2f(WX1, WristH - 24.f));
		Put(Band, SNew(BpSheet::SPlate).Fill(FLinearColor::Transparent).Edge(BpSheet::Amber.CopyWithNewOpacity(0.7f)).EdgePx(2.f).Bar(BpSheet::Amber).BarPx(6.f));
		Put(FBox2f(Band.Min + FVector2f(22.f, 10.f), Band.Max - FVector2f(14.f, 8.f)),
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(BandHead.ToUpper(), KickerFont, TextW))).Font(KickerFont).ColorAndOpacity(FSlateColor(BpSheet::Amber))]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(BandBody, WordsFont, TextW))).Font(WordsFont).ColorAndOpacity(FSlateColor(BpSheet::Ink))]);
	}
	// The control a hand's ray is on: an amber edge, what a pinch would act on (the aim cursor stops short of the panel).
	if (const FWristBox* Hovered = WristBoxes.FindByPredicate([this](const FWristBox& Each) { return Each.Id == WristHover; }))
	{
		Put(Hovered->Box.ExpandBy(4.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(5.f));
	}
	WristPanel->SetSlateWidget(
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(BpSheet::SSheet)]
		+ SOverlay::Slot()[Over]);
	WristPanel->RequestRenderUpdate();
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist link=%s card=%s%s%s"), *LinkWord, Card == ECard::Armed ? TEXT("armed") : Card == ECard::Refused ? TEXT("refused") : Card == ECard::Decision ? TEXT("decision") : Card == ECard::Offer ? TEXT("offer") : Card == ECard::Standup ? *FString::Printf(TEXT("standup \"%s\""), *SuKicker) : TEXT("calm"),
		Card == ECard::Decision ? *FString::Printf(TEXT(" %s on the %s"), *DecisionId, *DecisionWhere) : TEXT(""), bBand ? *FString::Printf(TEXT(" band \"%s\""), *BandHead) : TEXT(""));
}
