// The player (lynx-plan L3.4, spark vr-hands-zoom WP4): a camera at the play pose, the Interaction SDK's hand rigs, the
// controller rigs as the fallback, and UBpHands, which turns what they report into the table's levels. BpGameMode makes
// it the default pawn. Without a headset the camera is the flat view BpView.Pose moves; with one it follows the head.
#pragma once

#include "CoreMinimal.h"
#include "BpType.h"
#include "GameFramework/Pawn.h"
#include "BpPawn.generated.h"

class UBpHands;
class UWidgetComponent;
struct FBpScanState;
struct FBpOnboardingState;
struct FBpFocusList;
class UCameraComponent;
class UIsdkControllerRigComponent;
class UIsdkHandRigComponent;
class UMotionControllerComponent;
class USkeletalMeshComponent;

/** Whether the headset is on the head, as far as the runtime has said (XR_EXT_user_presence, or nothing). */
enum class EBpHeadPresence : uint8 { Unknown, Off, On };

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

	/** The posed capture hands (spark vr-fidelity-40 FC2, element 12): static meshes the level places at the near edge,
	 *  tagged CaptureHandsTag, with a CaptureWristTag point on the left wrist. The flat view shows them instead of the rest
	 *  hands and hangs the wrist panel on that point; a headset removes them (they are visual only, no tracking). */
	static const FName CaptureHandsTag;
	static const FName CaptureWristTag;

	/** Your room switched (BpSurround.cpp, bp.Room): the console's YOUR ROOM / STUDIO redraws, whoever switched it. */
	void OnRoomChanged() { RefreshConsole(); }

	/** The wrist panel (spark vr-fidelity-40 FC1, element 11): the concept's "Packages", the latest wave's packages with
	 *  their progress rings, read from GET .../waves and the findings' statuses (BpLink's scan state). With no posed hand
	 *  it hangs above the left rest hand, at WristPanel*Cm from the eye, turned to face it; SetWristParent moves it onto a
	 *  hand (the posed capture pair, or a tracked wrist). Its size on the arm and its pixel density: */
	static constexpr float WristPanelWidthCm = 13.f;  // FO: 13 x 10.5 (from 11 x 9.5), room for readable sub-lines (element 11)
	static constexpr float WristPanelHeightCm = 10.5f;
	float WristTintShown = -1.f;
	static constexpr float WristPanelPxPerCm = 50.f;
	static constexpr float WristPanelForwardCm = 26.f;
	static constexpr float WristPanelSideCm = -23.f;
	static constexpr float WristPanelDownCm = -31.f;
	/** On the posed capture hand (FE, element 11; FF re-anchored the wrist point to the watch's face): the panel stands
	 *  off it by this offset (cm, the table's axes: X away from the person, Y to their right, Z up) at WristCaptureScale
	 *  of its size, so it lies over the forearm left of the watch, its rows over the paper (over the white rail its light
	 *  text washed out), in front of the sleeve and wholly inside the target frame, as the concept's (placed by capture).
	 *  FQ (the judge, three rounds: "floats over the table instead of being docked to the wrist"): it rises off the forearm
	 *  between the watch and the eye, its left edge at the watch, about 8.6 cm wide, as the concept's. FAB (the judges,
	 *  11: still "floating below the hand"): over the sleeve, its right edge against the watch, as a panel mounted on the
	 *  forearm by the watch (the posed forearm points at the eye, so the sleeve is all of it the target frame sees), below
	 *  the frame's lit rail (over it the rail read through the glass across a row). FAF (the judges: "floats detached below
	 *  the wrist"): on the wrist itself, over the watch and the sleeve's cuff, rolled along the forearm, so the forearm reads
	 *  through the glass under it. */
	static constexpr float WristCaptureOffsetXCm = -3.f;  // FAF: (-3, 1.5, 3.5) x0.6, roll -14 (FAB -4, -1.5, 1, roll -8; FQ -6, 11, 5 x0.66, roll 10)
	static constexpr float WristCaptureOffsetYCm = 1.5f;
	static constexpr float WristCaptureOffsetZCm = 3.5f;
	static constexpr float WristCaptureScale = 0.6f;
	/** FO (element 11, the concept's panel "angled along the forearm"): from square to the eye, the panel rolls this far
	 *  about the view axis so its bottom edge follows the forearm, then tilts back this far about its own horizontal axis,
	 *  lying toward the forearm's top. By capture. */
	static constexpr float WristCaptureRollDeg = -14.f;  // FAF (FAB -8)
	static constexpr float WristCaptureTiltDeg = 0.f;
	/** The panel's up leans with the target pose's view (ABpGameMode::TargetPitchDeg), so it reads square to the eye. */
	void SetWristParent(USceneComponent* Parent, FName Socket, const FTransform& Relative);

	/** Night two W1 (the owner: "the wrist panel is overpopulated with options, we need to migrate into the main frame and
	 *  keep wrist for quick decisions"): the wrist keeps MENU (the console), SEAT, TOUR, the armed scan's START and CANCEL,
	 *  a refusal's DISMISS, the lamp's offer, the decision waiting on the deck or the card with APPROVE and DECLINE, and the
	 *  scan band; the old tabs (PROJECTS, PACKAGES, ASK, ROOMS, SCAN) are the console's pages. Its controls' ids are
	 *  "wrist:<act>" (PanelAct's acts, and wrist:menu); the old "wrist:tab:<name>" opens the console on that page. The hands
	 *  find them by ray (WristHit) and the synthetic hand aims at them (WristAim). The saved focuses' arming survives: a
	 *  first pinch on a focus (the console's SCAN page, or the lamp's "Scan this") arms it, START on the wrist or a second
	 *  pinch on the row starts the directed scan (ABpTable::StartDirected), anything else disarms. */
	static constexpr int32 WristRoomsPerPage = 5;
	bool WristHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const;
	/** The panel's centre in the world (BpView.Pose wrist aims at it). */
	FVector GetWristWorld() const;
	bool WristAim(const FString& Id, FVector& OutWorld) const;
	void WristTap(const FString& Id);
	/** Opens the Scan tab with that focus armed for the place the table shows, as a first pinch on its row would (the lamp's
	 *  "Scan this"): a second pinch starts it. */
	void WristArmFocus(const FString& FocusId);
	/** The control a hand's ray is on (UBpHands, the aim cursor): it lights, since no cursor is drawn over the panel. */
	void SetWristHover(const FString& Id, bool bDown = false);
	/** The wrist panel's text classes where it stands (BpView.TextCard): its buttons, the decision's kicker and title, the
	 *  scan band. */
	void WristTextClasses(TArray<BpType::FClassSample>& Out) const;

	// ---- The console (BpConsole.cpp; night two W1, the owner: "create main menu and operate there") ---------------------
	/** The main menu, in the deck's slot on the table (ABpTable::ConsoleSlotPose), in the sheet's language. At rest a slim
	 *  bar ConsoleWidthCm x ConsoleBarHeightCm: MENU, the product, one status phrase and BACK when there is somewhere to go
	 *  back to; on the site plan it stands along the slot's top edge (the plan below stays clear), in room mode just under
	 *  the deck (ConsoleBarGapCm below its lower edge, clear of its screens). Opened, the full panel ConsoleWidthCm x
	 *  ConsoleHeightCm in the slot: HOME's tiles, then each page a titled list of ConsoleRowsPerPage rows a page with a
	 *  pager and BACK top left; in room mode the deck is held hidden while it is open. One opaque world widget laid out at
	 *  ConsoleLayoutPxPerCm and drawn at ConsolePxPerCm, redrawn only when what it shows changes. Its controls' ids are
	 *  "console:<act>": the console's own (menu, close, home, back, page:next, page:prev, open:<page>, bar:back) and the
	 *  shared acts of PanelAct. */
	static constexpr float ConsoleWidthCm = 40.f;
	static constexpr float ConsoleHeightCm = 22.5f;
	static constexpr float ConsoleBarHeightCm = 2.75f;
	static constexpr float ConsoleBarGapCm = 0.5f;
	static constexpr float ConsoleLayoutPxPerCm = 32.f;
	static constexpr float ConsolePxPerCm = 21.f;
	static constexpr int32 ConsoleRowsPerPage = 5;
	bool ConsoleHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const;
	bool ConsoleAim(const FString& Id, FVector& OutWorld) const;
	void ConsoleTap(const FString& Id);
	void SetConsoleHover(const FString& Id, bool bDown = false);
	/** Opens the console on a page ("home" when empty or unknown); CloseConsole puts it back to its bar. */
	void OpenConsole(const FString& Page);
	void CloseConsole();
	bool IsConsoleOpen() const { return bConsoleOpen; }
	/** The open page's key ("home" on the MENU's tiles; meaningful while IsConsoleOpen). */
	const FString& GetConsolePage() const { return ConsolePageKey; }
	/** The tour's mark (BpTour.cpp, wave T1): the control a step asks for ("console:menu", "console:bar:back") wears the amber
	 *  edge the pad's selection wears, until the step ends (empty clears it). One redraw when it changes. */
	void SetConsoleMark(const FString& Id);
	/** For checks: "bar" or "<page> p<n>/<pages> sel=<id>". */
	FString GetConsoleLine() const;
	/** BpConsole.Stat: the console's line, its draws, and whether its widget (and the wrist's) ticks now. */
	void LogConsoleStat() const;
	/** BpConsole.Rows: the open page's rows, logged (night two W2a: a headless check of the PC LINK and SCAN pages). */
	void LogConsoleRows();
	/** The console's text classes where it stands (BpView.TextCard). */
	void ConsoleTextClasses(TArray<BpType::FClassSample>& Out) const;
	// ---- The stand-up (BpStandup.cpp; night two W2b, "Morning at the desk") -----------------------------------------------
	/** The console's STAND-UP page is the morning ritual: the deck's cards one at a time (GET /api/companion/morning, or the
	 *  build's sample with no PC), each decision answered with `shown`, the plan following each card, then the day's plan and
	 *  the hand-over. Its acts are "standup:<act>" (PanelAct routes them): next, prev, approve, defer, hold, decline, plan,
	 *  handover, grant, cancel, revoke, skip, retry, done. */
	bool IsStandupOpen() const;
	void StandupAct(const FString& Act);
	/** For checks: "<sheet> <n>/<m> <kind> <card id>[ armed=<verdict>][ <answer>]", or "closed". */
	FString GetStandupLine() const;
	/** The room the stand-up's card raised on the plan (empty: none). */
	FString GetStandupRoom() const;
	/** The live grant this headset knows (handed over), or null. */
	const struct FBpPolicy* LiveGrant() const;
	/** The tour's last step (BpTour.cpp): the stand-up opens on its first decision card; the tour asks whether one was answered. */
	bool OpenStandupForTour();
	bool StandupAnsweredSince(double Since) const;
	FString StandupLastVerdictWords() const;
	/** A spoken request raised a pending companion card (BpTalk.cpp): the STAND-UP page opens on it, as the stand-up's plan
	 *  shows one (GET /api/companion/cards; answered with `shown`). */
	void StandupShowCompanionCards();
	/** The pending companion cards read from the PC and merged into the stand-up's sheets before the close card (opening, every
	 *  re-read of the morning, a spoken request); bJumpToNewest shows the newest one. */
	void StandupReadCards(bool bJumpToNewest);
	/** The companion's requests waiting (the open stand-up's unanswered ones, else the last read), for HOME's tile and the wrist. */
	int32 StandupPendingRequests() const;
	/** A read of the pending cards only (HOME opening, linked): the count above, nothing shown. */
	void StandupPeekRequests();
	/** Wave EV: what came of earlier approvals, read before the page opens (at most every ten minutes), for the MENU's STAND-UP
	 *  tile and the bar ("2 built since yesterday"); empty once today's stand-up has been held, or when nothing came of them. */
	void StandupPeekYesterday();
	FString StandupYesterdayWords() const;
	/** Wave EV: an ask to read a new project is out to the PC (PROJECTS' ADD A PROJECT): the folder's name for the bar and the
	 *  wrist ("ASKED YOUR PC · <name>"). BpConsole.cpp. */
	bool OnboardAskWaiting(FString& OutName) const;
	/** The talk's state moved (BpTalk.cpp): the console's bar and the wrist redraw if what they show changed. */
	void TalkChanged();
	/** The console may show the conversation (bp.TalkSheet on, and no stand-up or consent sheet open): the lamp's own caption
	 *  box then stays quiet for the talk's lines. */
	bool ConsoleShowsTalk() const;

	/** The acts the console and the wrist share (the wrist's tabs' behaviour, kept): room:<id>, project:<slug>, focus:<id>,
	 *  scan:start, scan:cancel, scan:dismiss, ask:next|here|scan|act, seat, tour, voice:minus|plus, music:minus|plus,
	 *  approve, decline, toggle:face|hand|motion. */
	void PanelAct(const FString& Act);

	// ---- The pad (BpPad.cpp): controllers add to the hands, never replace them ------------------------------------------
	/** One press of a controller button or stick step: A, B, X, Y, Menu, Up, Down, Left, Right, Home. The keys polled each
	 *  frame and the console command BpPad.Press run this same handler; a press is queued while the table eases. */
	void PadPress(const FString& Button);
	/** The focus cursor: the wing or room the pad stands on at the table's level, drawn with the table's highlight. The hands
	 *  own the highlight while one aims at something; when it stops, this puts the focus back (empty: cleared). */
	void RestoreFocusHighlight();
	/** For checks: "<kind>=<id>" or "". */
	FString GetFocusLine() const { return PadFocusId.IsEmpty() ? FString() : PadFocusKind + TEXT("=") + PadFocusId; }

	// ---- The headset session (BpHeadset.cpp; docs/concepts/vr-light-table/headset-plan.md) ------------------------------
	/** Seated calibration (BpView.Seat, the wrist's SEAT, and once at start with a headset): reads the eye where it is and
	 *  moves the table (ABpTable::MoveTable) so that eye stands at the target pose's, TargetEyeAboveTopCm over the top and
	 *  TargetBehindNearEdgeCm behind the near edge, the table turned to the way the head faces. The view never moves. The
	 *  top stays between SeatTopMinCm and the floor's own table height (a standing eye gets the table as built, the gap
	 *  logged). Without a headset it seats the flat view's eye the same way, for checks. EyeAboveFloorCm over 0 seats as if
	 *  the eye stood that high (BpView.Seat's argument). Logs `BpView: seat ...`. */
	bool Seat(float EyeAboveFloorCm = -1.f);
	/** BpView.Bench: puts the view of a headset lying still at the seated target view (measurements with nobody wearing it). */
	bool Bench(float PitchDeg, float YawDeg);
	static constexpr float SeatTopMinCm = 55.f;
	/** A runtime whose floor is wrong (Steam Link on a Quest 3S, Lynx 2026-10-29: a seated eye read 67.5 cm over it) puts a
	 *  headset eye under SeatEyeMinCm. The seat then corrects the floor once, raising the pawn (the tracking origin) so the
	 *  eye stands SeatedEyeCm over it, as a runtime's recenter does, and seats the table to that eye. */
	static constexpr float SeatEyeMinCm = 95.f;
	static constexpr float SeatedEyeCm = 120.f;
	/** The start's seat waits for the head to be tracked: it tries every SeatRetryS, at most SeatTries times. */
	static constexpr float SeatRetryS = 0.5f;
	static constexpr int32 SeatTries = 20;
	/** The frame meter (headset-plan code item 4; bp.FrameMeter): the GPU's and the game thread's p50 over FrameWindowS,
	 *  in a strip over the wrist panel, against the 90 Hz bar (R5: 11.1 ms). `stat unit` does not read in stereo. */
	static constexpr float FrameWindowS = 2.f;
	static constexpr float FrameBarMs = 11.1f;

	virtual void Tick(float DeltaSeconds) override;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

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
	/** The level has the posed capture hands: the rest hands stay hidden. */
	bool bCaptureHands = false;

	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> WristPanel;
	/** BpWrist.cpp: builds the panel's content from the scan state when what it shows changed. */
	void MakeWristPanel();
	void ReceiveScanState(const FBpScanState& State);
	FString WristKey;
	FString WristHover;
	/** Night two V6: a pinch closed on the hovered wrist control and not yet released: it draws pressed. */
	bool bWristHoverDown = false;
	FDelegateHandle ScanHandle;
	/** The room the table shows (empty on the site plan), and each control's box in the panel's pixels as last laid out. */
	FDelegateHandle WristOnboardingHandle;
	FDelegateHandle WristProductHandle;
	void OnWristOnboarding(const FBpOnboardingState& State);
	/** The saved focuses (P5; the console's SCAN page): the focus armed (its id, and the place and words it would run with),
	 *  when it was armed, what the last start said, and whether that was a refusal or failure (a card on the wrist until
	 *  dismissed) rather than news. */
	FDelegateHandle WristAskHandle;
	FString WristArmedFocus;
	FString WristArmedTarget;
	FString WristArmedLabel;
	double WristArmedAt = 0.0;
	FString WristScanWords;
	bool bWristScanRefused = false;
	bool bWristScanStarting = false;
	FDelegateHandle WristBandHandle;
	FDelegateHandle WristFocusHandle;
	void OnWristFocuses(const FBpFocusList& List);
	void WristDisarm();
	/** The pinch that armed a row, bouncing, must not also confirm it: a second pinch sooner than this does nothing. */
	static constexpr double WristConfirmGuardS = 0.4;
	void OnWristProduct(const FString& Slug);
	/** The PC link (night two W2a): the wrist's one word and the console's PC LINK page follow it. */
	FDelegateHandle WristLinkHandle;
	void OnWristLink(const struct FBpLinkStatus& Status);
	/** What the armed row's second press runs: `focus:<id>` (a directed scan), `scan:this` (a plain scan of the place) or
	 *  `scan:every` (every lens); WristArmedFocus holds the focus id, or `@this` / `@every`. Empty when nothing is armed. */
	FString ArmedAct() const;
	/** The SCAN page's last word on a cancel (its job's words), and the clock that redraws the page each second while a job
	 *  runs on it (a timer, only while the page is open). */
	FString ConsoleScanWords;
	FTimerHandle ConsoleClockTimer;
	void TickConsoleClock();
	/** The bar's SHOW ON PC: the table's place to the web (BpLink ShowOnPc); its answer in words, shown on the bar a while. */
	void ShowOnPc();
	FString ConsoleBarWords;
	double ConsoleBarWordsUntil = 0.0;
	FString WristRoomMode;
	struct FWristBox
	{
		FString Id;
		FBox2f Box;
	};
	TArray<FWristBox> WristBoxes;
	TWeakObjectPtr<class ABpTable> WristTable;
	FDelegateHandle RoomHandle;
	void OnWristRoomChanged(const FString& RoomId);
	/** The panel again from the scan state BpLink holds (ReceiveScanState's work); the console's too. */
	void RefreshWrist();
	/** The wave the packages show (BpWrist.cpp: the deck's draft, else the last dispatched, else the newest draft), whether it
	 *  is a draft, and per package its name, meta line, tiers and built share. */
	struct FPackageRow { FString Name; FString Meta; FString Tiers; float Fraction; int32 Count; };
	const struct FBpWave* PackagesState(TArray<FPackageRow>& OutRows, bool& bOutDraft, FString& OutKey) const;
	/** The wrist's own drawing (BpWrist.cpp): the quick decisions. */
	void DrawWrist();
	/** Faces the eye (bp.WristFace 1), on the hand bp.WristHand names, hidden while that hand is not tracked. */
	void TickWristFace(float DeltaSeconds);
	bool bWristFaceInit = false;
	FQuat WristFaceQuat = FQuat::Identity;
	int32 WristHandShown = -1;
	FString WristDecisionKey;

	// ---- The console's state (BpConsole.cpp) ------------------------------------------------------------------------------
	friend struct FBpConsolePages;
	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> ConsolePanel;
	bool bConsoleOpen = false;
	/** The conversation with the lamp fills the console's panel (night two V2) while a talk is on show and no page holds it. */
	bool bConsoleTalk = false;
	FString ConsolePageKey;
	int32 ConsolePageAt = 0;
	FString ConsoleSel;
	bool bConsolePadSel = false;
	FString ConsoleHover;
	FString ConsoleMark;
	/** Night two V6: the hovered console control held by a pinch (bConsoleHoverDown), or the pad's selection held by A
	 *  (bPadADown): it draws pressed until the release. */
	bool bConsoleHoverDown = false;
	bool bPadADown = false;
	FString ConsoleKey;
	FString ConsolePlaceKey;
	int32 ConsoleDraws = 0;
	bool bConsoleTourShown = false;
	bool bConsolePlanShown = false;
	struct FConsoleBox
	{
		FString Id;
		FBox2f Box;
	};
	TArray<FConsoleBox> ConsoleBoxes;
	/** The layout's size in its own pixels (the bar's or the panel's). */
	FVector2f ConsoleLayout = FVector2f::ZeroVector;
	void MakeConsole();
	void RefreshConsole();
	void PlaceConsole();
	/** Each frame, cheaply: the table's level and room mode (the bar's place and BACK), the deck's hold. */
	void TickConsoleLive();
	/** The pad's arrow on the open console: the nearest control in that direction. */
	void ConsoleMove(int32 DX, int32 DY);
	bool ConsoleBack();
	FString ConsoleStatus() const;

	// ---- The stand-up's state (BpStandup.cpp): made when the page opens, released when it closes ---------------------------
	TSharedPtr<struct FBpStandupState> Standup;
	/** The finding's screen on the decision card: one texture at a time, released when the card leaves or the page closes. */
	UPROPERTY(Transient)
	TObjectPtr<class UTexture2D> StandupShot;
	/** The screen released last, kept one release longer: a widget that still paints it this frame never holds a freed texture
	 *  (the deck's card crashed on exactly that, 2026-11-10). */
	UPROPERTY(Transient)
	TObjectPtr<class UTexture2D> StandupShotKept;
	/** The YESTERDAY sheet's screens (wave EV): the outcome's before and after at once, each decoded halved (640x360 from a
	 *  1280x720 shot, 900 KB each); released when the outcome or the sheet leaves, the last pair kept one release longer. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<class UTexture2D>> StandupOutcomeShots;
	UPROPERTY(Transient)
	TArray<TObjectPtr<class UTexture2D>> StandupOutcomeKept;
	/** The grant this headset made or read (GET policies), kept past the page: the bar and the wrist say "Handed over until". */
	TSharedPtr<struct FBpPolicy> StandupGrant;
	FTimerHandle StandupTimer;
	FTimerHandle StandupGrantTimer;
	void StandupOpened();
	void StandupClosed();
	void StandupLoad();
	void StandupBuildSheets();
	void StandupShowSheet();
	void StandupLoadShot();
	/** YESTERDAY (wave EV): the outcome shown raised on the plan, and its two screens loaded and released. */
	void StandupShowOutcome();
	void StandupLoadOutcomeShots();
	void StandupReleaseOutcomeShots();
public:
	/** Night two V7: the finding's "before" screen, one path for the stand-up's decision sheet and a room's decision card
	 *  (BpDeck.cpp): the Shot row of the scan the table holds for the proposal (the product on the table only), and its PNG
	 *  fetched, decoded off the game thread, halved to at most 800 px wide and made a transient texture. Done runs on the game
	 *  thread with the texture (null when it could not be read) and whether it is a sample screen. BpStandup.cpp. */
	static const struct FBpShot* FindBeforeShot(const FString& Proposal);
	static void FetchBeforeShot(const FString& Product, const FString& Path, TFunction<void(class UTexture2D* Texture, bool bSample)> Done);
private:
	void StandupReleaseShot();
	void StandupVerdict(const FString& Verdict, const TCHAR* Route);
	void StandupPlanDay();
	void StandupGrantNow();
	void StandupRevoke();
	void StandupReadPolicies();
	void StandupTickSince();
	void StandupSaveAnswers() const;
	FString StandupShown() const;
	FString StandupKey() const;
	/** The page's body on the console (the card as a sheet), its controls added to ConsoleBoxes. */
	void DrawStandup(const TSharedRef<class SCanvas>& Canvas);
	/** The conversation with the lamp on the console's panel (BpConsole.cpp, night two V2): the state, the heard words, the
	 *  reply whole (or the lamp's own line), the level while listening. */
	void DrawConversation(const TSharedRef<class SCanvas>& Canvas, const FString& Word, const FString& Heard, const FString& Reply, const FString& Line, float Level, bool bSample);
	/** The pad on the open stand-up: false when it is not the stand-up's to take. */
	bool StandupPad(const FString& Button);
	/** The wrist's card for the stand-up (the decision on screen, or the hand-over), false when none. */
	bool StandupWristCard(FString& OutKicker, FString& OutTitle, FString& OutWords, TArray<TPair<FString, FString>>& OutButtons) const;
	FString StandupBarStatus() const;

	// ---- The pad's state (BpPad.cpp) --------------------------------------------------------------------------------------
	FString PadFocusKind;
	FString PadFocusId;
	TArray<FString> PadQueue;
	struct FPadStick
	{
		int32 DX = 0;
		int32 DY = 0;
		double NextAt = 0.0;
	};
	FPadStick PadSticks[2];
	TMap<FName, bool> PadKeysDown;
	void TickPad(float DeltaSeconds);
	void RunPad(const FString& Button);
	void PadStep(int32 Delta);
	void PadSelect();
	void SeedFocus(const FString& Prefer = FString());
	uint8 PadLevelShown = 0;
	/** The pad has been used this session (the focus is drawn from then on), the wing the focus last stood in, and the place
	 *  TickPad last saw (the focus is re-seeded when it moves). */
	bool bPadActive = false;
	FString PadLastWing;
	uint8 PadSeenLevel = 255;
	FString PadSeenWing;
	FString PadSeenRoom;
	FString PadRoomModeShown;

	// ---- The music bed (BpAudio.cpp) -------------------------------------------------------------------------------------
	UPROPERTY(Transient)
	TObjectPtr<class UAudioComponent> Music;
	UPROPERTY(Transient)
	TObjectPtr<class USoundWaveProcedural> MusicWave;
	TSharedPtr<TArray<uint8>, ESPMode::ThreadSafe> MusicData;
	int32 MusicRate = 32000;
	int32 MusicOffset = 0;
	int32 MusicBytes = 0;
	int64 MusicAt = 0;
	int32 MusicLoops = 0;
	float MusicLevelShown = -1.f;
	bool bMusicLoading = false;
	bool bMusicMissing = false;
	bool bMusicDucked = false;
	bool bMusicPaused = false;
	void TickMusic();
	void FeedMusic();

	// ---- The headset session (BpHeadset.cpp) ------------------------------------------------------------------------------
	FTimerHandle SeatTimer;
	int32 SeatTried = 0;
	void SeatAtStart();
public:
	/** The headset put on or taken off (FCoreDelegates; BpView.FakeHead fakes them). The seat waits for the head: a launch with
	 *  the headset on the desk must not seat to a false eye. The first time it is really put on, a seat made before that (with
	 *  the head only assumed) is undone and made again; later doffing and donning never re-seat (the wrist's SEAT is there). */
	void OnHeadOn();
	void OnHeadOff();
	/** BpView.FakeHead unknown: a runtime that says nothing about the head (the guard's check). */
	void ForgetHead();
private:
	FDelegateHandle HeadOnHandle;
	FDelegateHandle HeadOffHandle;
	EBpHeadPresence HeadPresence = EBpHeadPresence::Unknown;
	bool bHeadEverOn = false;
	/** A seat was made while the head was only assumed (no presence signal) and took a floor correction: redone on the first put-on. */
	bool bSeatProvisional = false;
	/** The floor correction a seat has taken, undone with the seat it belongs to. */
	double SeatFloorFixCm = 0.0;
	/** The wrist panel's transform on the left grip (bp.Wrist*; BpWrist.cpp), live: applied when a value changes. */
	void ApplyWristPose();
	FString WristPoseApplied;
	UPROPERTY(Transient)
	TObjectPtr<USceneComponent> WristSimGrip;
	/** The wrist's pose cvars and the voice level, followed each frame (the panel re-attached, its label redrawn). */
	void TickWristLive();
	UPROPERTY(Transient)
	TObjectPtr<UWidgetComponent> FrameMeter;
	struct FFrameSample
	{
		double At;
		float GpuMs;
		float GameMs;
		float FrameMs;
	};
	TArray<FFrameSample> FrameSamples;
	double FrameShownAt = 0.0;
	void MakeFrameMeter();
	void TickFrameMeter(float DeltaSeconds);
};
