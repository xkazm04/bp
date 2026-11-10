// The pad (night two W1; BpPawn.h declares it). The owner on the Quest 3S, 2026-11-09: "we need bindings to thumb
// controllers and action buttons to create main menu and operate there, going clearly back, operating in blueprint without
// dependency of the pins and drag movement". Controllers add to the hands; the hands stay complete.
//
//   Either thumbstick  left/up: the previous sibling, right/down: the next (a wing on the site plan, a room in a wing, the
//                      deck's screen in room mode); with the console open, the four ways move its selection. A flick is one
//                      step; held, it repeats after bp.PadRepeatDelayS every bp.PadRepeatS; under bp.PadDeadZone nothing.
//   A (right)          select: enter the focused place, or press the console's selected control.
//   B (right)          a talk in flight cancelled first; else back: a console page to HOME, then the console closed, then Back().
//   Y (left), Menu     the console, opened or closed.
//   X (left)           held: talk to the lamp (BpTalk.cpp); a tap: the lamp about the place in view ("Plan my next step here").
//   Stick click        home: the site plan.
// The keys are polled each frame the way the trigger is (APlayerController key state: UE 5.8's OpenXR input builds its
// legacy actions for every XR key the Meta plugin binds, with no mapping asset), and BpPad.Press runs the same handler. A
// press is queued while the table eases, so a scripted sequence lands where it was meant to.
#include "BpPawn.h"

#include "BpLink.h"
#include "BpTable.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "InputCoreTypes.h"
#include "Schema/BpSchemaVocab.h"

namespace
{
	TAutoConsoleVariable<int32> CVarPad(TEXT("bp.Pad"), 1, TEXT("The controllers' buttons and sticks (BpPad.cpp): 1 read, 0 ignored (BpPad.Press still works)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarPadDeadZone(TEXT("bp.PadDeadZone"), 0.5f, TEXT("A thumbstick step needs this deflection (0.2 to 0.95); it is released under 0.6 of it."), ECVF_Default);
	TAutoConsoleVariable<float> CVarPadRepeatS(TEXT("bp.PadRepeatS"), 0.18f, TEXT("A held thumbstick repeats its step this often (seconds, 0.08 to 1)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarPadRepeatDelayS(TEXT("bp.PadRepeatDelayS"), 0.45f, TEXT("A held thumbstick waits this long before it repeats (seconds, 0.15 to 2)."), ECVF_Default);

	const TCHAR* const Buttons[] = { TEXT("A"), TEXT("B"), TEXT("X"), TEXT("Y"), TEXT("Menu"), TEXT("Up"), TEXT("Down"), TEXT("Left"), TEXT("Right"), TEXT("Home") };

	FString Canonical(const FString& Button)
	{
		for (const TCHAR* Each : Buttons) if (Button.Equals(Each, ESearchCase::IgnoreCase)) return Each;
		return FString();
	}

	FAutoConsoleCommandWithWorldAndArgs CmdPadPress(
		TEXT("BpPad.Press"),
		TEXT("BpPad.Press <A|B|X|Y|Menu|Up|Down|Left|Right|Home> [more...]: a controller press, through the same handler the buttons and sticks use (queued while the table eases)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
			ABpPawn* Pawn = PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
			if (Args.Num() == 0 || !Pawn)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpPad: usage BpPad.Press <A|B|X|Y|Menu|Up|Down|Left|Right|Home>... (a playing world with the bp pawn)"));
				return;
			}
			for (const FString& Each : Args) Pawn->PadPress(Each);
		}));
}

// ---- The table's side: the focus's siblings, the open decisions -----------------------------------------------------------

void ABpTable::FocusSiblings(FString& OutKind, TArray<FString>& OutIds) const
{
	OutKind.Reset();
	OutIds.Reset();
	if (!SheetPlan.IsValid() || !RoomModeId.IsEmpty()) return;
	struct FAt
	{
		FString Id;
		double Y;
		double X;
	};
	TArray<FAt> Items;
	if (Level == EBpLevel::L0)
	{
		// The wings left to right, as the paper reads them (plan +x runs to the person's right).
		OutKind = TEXT("wing");
		for (const FBpPlanWing& Wing : SheetPlan->wings) Items.Add({ Wing.id, 0.0, Wing.box.x + Wing.box.w * 0.5 });
	}
	else
	{
		// The entered wing's rooms, far to near (plan +y runs toward the person), then left to right.
		OutKind = TEXT("room");
		for (const FBpPlanRoom& Room : SheetPlan->rooms) if (Room.parentId == WingId) Items.Add({ Room.id, Room.box.y, Room.box.x });
	}
	Items.Sort([](const FAt& A, const FAt& B) { return A.Y != B.Y ? A.Y < B.Y : A.X < B.X; });
	for (const FAt& Each : Items) OutIds.Add(Each.Id);
}

int32 ABpTable::OpenDecisionCount() const
{
	int32 N = 0;
	for (const FBpProposal& P : FBpLinkModule::Get().GetScanState().Scan.proposals) N += P.status == BpVocab::Proposal::Status::Proposed ? 1 : 0;
	return N;
}

// ---- The pawn's side ------------------------------------------------------------------------------------------------------

void ABpPawn::PadPress(const FString& Button)
{
	const FString Name = Canonical(Button);
	if (Name.IsEmpty())
	{
		UE_LOG(LogBpTable, Warning, TEXT("BpPad: unknown button %s (A, B, X, Y, Menu, Up, Down, Left, Right, Home)"), *Button);
		return;
	}
	PadQueue.Add(Name);
}

void ABpPawn::TickPad(float DeltaSeconds)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	// The controllers' keys (a headset only: the flat view has BpPad.Press).
	if (PC && IsHeadsetOn() && CVarPad.GetValueOnGameThread() != 0)
	{
		struct FKeyButton { FKey Key; const TCHAR* Button; };
		const FKeyButton Keys[] = {
			{ EKeys::OculusTouch_Right_A_Click, TEXT("A") }, { EKeys::OculusTouch_Right_B_Click, TEXT("B") },
			{ EKeys::OculusTouch_Left_X_Click, TEXT("X") }, { EKeys::OculusTouch_Left_Y_Click, TEXT("Y") },
			{ EKeys::OculusTouch_Left_Menu_Click, TEXT("Menu") },
			{ EKeys::OculusTouch_Left_Thumbstick_Click, TEXT("Home") }, { EKeys::OculusTouch_Right_Thumbstick_Click, TEXT("Home") },
		};
		for (const FKeyButton& Each : Keys)
		{
			const bool bDown = PC->IsInputKeyDown(Each.Key);
			bool& bWas = PadKeysDown.FindOrAdd(Each.Key.GetFName());
			// X is push to talk (BpTalk.cpp): held, it talks to the lamp; a tap under ABpTable::TalkMinHoldS is the old X.
			if (FCString::Strcmp(Each.Button, TEXT("X")) == 0 && bDown != bWas)
			{
				UE_LOG(LogBpTable, Log, TEXT("BpPad: key %s %s"), *Each.Key.ToString(), bDown ? TEXT("down") : TEXT("up"));
				ABpTable* Talker = WristTable.Get();
				const bool bTap = Talker ? Talker->TalkHold(TEXT("x"), bDown) : !bDown;
				if (!bDown && bTap) PadQueue.Add(Each.Button);
				bWas = bDown;
				continue;
			}
			if (bDown && !bWas)
			{
				UE_LOG(LogBpTable, Log, TEXT("BpPad: key %s"), *Each.Key.ToString());
				PadQueue.Add(Each.Button);
			}
			// Night two V6: A held draws the pad's selection pressed until it is released (only on the change: no per-frame redraw).
			if (FCString::Strcmp(Each.Button, TEXT("A")) == 0 && bDown != bPadADown)
			{
				bPadADown = bDown;
				RefreshConsole();
			}
			bWas = bDown;
		}
		const float Dead = FMath::Clamp(CVarPadDeadZone.GetValueOnGameThread(), 0.2f, 0.95f);
		const double Now = FPlatformTime::Seconds();
		for (int32 Side = 0; Side < 2; ++Side)
		{
			const float SX = PC->GetInputAnalogKeyState(Side == 0 ? EKeys::OculusTouch_Left_Thumbstick_X : EKeys::OculusTouch_Right_Thumbstick_X);
			const float SY = PC->GetInputAnalogKeyState(Side == 0 ? EKeys::OculusTouch_Left_Thumbstick_Y : EKeys::OculusTouch_Right_Thumbstick_Y);
			FPadStick& Stick = PadSticks[Side];
			const float Mag = FMath::Max(FMath::Abs(SX), FMath::Abs(SY));
			// Held in a direction: past the dead zone to start, under 0.6 of it to let go (no chatter at the edge).
			int32 DX = 0, DY = 0;
			if (Mag >= Dead || ((Stick.DX != 0 || Stick.DY != 0) && Mag >= Dead * 0.6f))
			{
				if (FMath::Abs(SX) >= FMath::Abs(SY)) DX = SX > 0.f ? 1 : -1;
				else DY = SY > 0.f ? -1 : 1;
			}
			if (DX == 0 && DY == 0) { Stick = FPadStick(); continue; }
			const TCHAR* Button = DX > 0 ? TEXT("Right") : DX < 0 ? TEXT("Left") : DY < 0 ? TEXT("Up") : TEXT("Down");
			if (DX != Stick.DX || DY != Stick.DY)
			{
				Stick.DX = DX;
				Stick.DY = DY;
				Stick.NextAt = Now + FMath::Clamp(CVarPadRepeatDelayS.GetValueOnGameThread(), 0.15f, 2.f);
				PadQueue.Add(Button);
			}
			else if (Now >= Stick.NextAt)
			{
				Stick.NextAt = Now + FMath::Clamp(CVarPadRepeatS.GetValueOnGameThread(), 0.08f, 1.f);
				PadQueue.Add(Button);
			}
		}
	}
	// The level or room mode moved under the focus (the pad's, a hand's, the lamp's): once the pad has been used, the focus
	// lands on what the move went into or came out of. Read only when the place changed.
	ABpTable* Table = WristTable.Get();
	if (Table && bPadActive && Table->HasPlan() && (static_cast<uint8>(Table->GetBpLevel()) != PadSeenLevel || Table->GetWingId() != PadSeenWing || Table->GetRoomModeId() != PadSeenRoom))
	{
		PadSeenLevel = static_cast<uint8>(Table->GetBpLevel());
		PadSeenWing = Table->GetWingId();
		PadSeenRoom = Table->GetRoomModeId();
		FString Kind;
		TArray<FString> Ids;
		Table->FocusSiblings(Kind, Ids);
		const bool bValid = Ids.Num() == 0 ? PadFocusId.IsEmpty() : Kind == PadFocusKind && Ids.Contains(PadFocusId);
		// The stand-up owns the highlight while it is open (the plan follows its cards).
		if (!bValid && !IsStandupOpen()) SeedFocus();
	}
	// One queued press a frame, once the table has settled.
	if (PadQueue.Num() == 0) return;
	const FString& Next = PadQueue[0];
	const bool bConsolePress = bConsoleOpen || Next == TEXT("Y") || Next == TEXT("Menu");
	if (!bConsolePress && (!Table || !Table->HasPlan() || Table->IsLevelMoving() || Table->IsRoomModeMoving() || Table->IsDeckMoving())) return;
	const FString Button = Next;
	PadQueue.RemoveAt(0);
	RunPad(Button);
}

void ABpPawn::RunPad(const FString& Button)
{
	ABpTable* Table = WristTable.Get();
	bPadActive = true;
	UE_LOG(LogBpTable, Log, TEXT("BpPad: press %s (console %s, level L%d%s, focus %s)"), *Button, *GetConsoleLine(), Table ? static_cast<int32>(Table->GetBpLevel()) : -1,
		Table && !Table->GetRoomModeId().IsEmpty() ? *FString::Printf(TEXT(" room mode %s"), *Table->GetRoomModeId()) : TEXT(""), PadFocusId.IsEmpty() ? TEXT("none") : *GetFocusLine());
	// B first cancels a talk in flight (BpTalk.cpp: a turn being thought about, the listening, the lamp's spoken reply).
	if (Button == TEXT("B") && Table && Table->TalkCancel(TEXT("B"))) return;
	if (Button == TEXT("Y") || Button == TEXT("Menu"))
	{
		if (bConsoleOpen) CloseConsole();
		else OpenConsole(FString());
		return;
	}
	if (Button == TEXT("X"))
	{
		// The lamp about the place in view (the old wrist ASK's "Plan my next step here").
		if (Table && Table->HasPlan()) Table->AskPlanHere(TEXT("pad"));
		return;
	}
	if (Button == TEXT("Home"))
	{
		if (Table && Table->HasPlan()) Table->Home();
		return;
	}
	if (bConsoleOpen)
	{
		// The stand-up's own: left and right walk its cards, A approves after a confirm press, B goes back (BpStandup.cpp).
		if (StandupPad(Button)) return;
		if (Button == TEXT("A"))
		{
			if (ConsoleSel.IsEmpty()) ConsoleMove(0, 1);
			else ConsoleTap(ConsoleSel);
		}
		else if (Button == TEXT("B")) ConsoleBack();
		else if (Button == TEXT("Up")) ConsoleMove(0, -1);
		else if (Button == TEXT("Down")) ConsoleMove(0, 1);
		else if (Button == TEXT("Left")) ConsoleMove(-1, 0);
		else if (Button == TEXT("Right")) ConsoleMove(1, 0);
		return;
	}
	if (!Table || !Table->HasPlan()) return;
	if (Button == TEXT("B")) { Table->Back(); return; }
	if (Button == TEXT("A")) { PadSelect(); return; }
	PadStep(Button == TEXT("Left") || Button == TEXT("Up") ? -1 : 1);
}

void ABpPawn::PadStep(int32 Delta)
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	// Room mode: the deck's screens are the siblings (its lit feature follows the front screen on the map).
	if (!Table->GetRoomModeId().IsEmpty())
	{
		if (Delta > 0) Table->DeckNext();
		else Table->DeckPrev();
		UE_LOG(LogBpTable, Log, TEXT("BpPad: deck %s"), *Table->GetDeckLine());
		return;
	}
	FString Kind;
	TArray<FString> Ids;
	Table->FocusSiblings(Kind, Ids);
	if (Ids.Num() == 0) return;
	int32 At = PadFocusKind == Kind ? Ids.IndexOfByKey(PadFocusId) : INDEX_NONE;
	if (At == INDEX_NONE)
	{
		// The first step shows where the cursor is: the lifted room, else the first sibling.
		At = Kind == TEXT("room") ? FMath::Max(0, Ids.IndexOfByKey(Table->GetRoomId())) : 0;
	}
	else At = (At + Delta + Ids.Num()) % Ids.Num();
	PadFocusKind = Kind;
	PadFocusId = Ids[At];
	Table->SetHighlight(Kind, PadFocusId);
	UE_LOG(LogBpTable, Log, TEXT("BpPad: focus %s=%s (%d of %d)"), *Kind, *PadFocusId, At + 1, Ids.Num());
}

void ABpPawn::PadSelect()
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	if (!Table->GetRoomModeId().IsEmpty())
	{
		// A decision is a deliberate tap (the screen's APPROVE, or the wrist's): A never writes one.
		UE_LOG(LogBpTable, Log, TEXT("BpPad: select in room mode enters nothing (the deck's APPROVE and DECLINE take a tap; the wrist offers them)"));
		return;
	}
	FString Kind;
	TArray<FString> Ids;
	Table->FocusSiblings(Kind, Ids);
	if (PadFocusKind != Kind || !Ids.Contains(PadFocusId))
	{
		// No cursor yet: the first A shows it instead of entering something unseen.
		PadStep(0);
		return;
	}
	const FString Id = PadFocusId;
	if (Kind == TEXT("wing"))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpPad: select -> enter wing=%s"), *Id);
		Table->EnterWing(Id);
	}
	else if (Table->GetBpLevel() == EBpLevel::L2 && Table->GetRoomId() == Id)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpPad: select on the lifted room -> room mode room=%s"), *Id);
		Table->EnterRoomMode(Id);
	}
	else
	{
		UE_LOG(LogBpTable, Log, TEXT("BpPad: select -> enter room=%s"), *Id);
		Table->EnterRoom(Id);
	}
}

void ABpPawn::SeedFocus(const FString& Prefer)
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	FString Kind;
	TArray<FString> Ids;
	Table->FocusSiblings(Kind, Ids);
	const FString Was = PadFocusKind + TEXT("=") + PadFocusId;
	if (Ids.Num() == 0)
	{
		// Room mode: the deck is the focus; the table's highlight is the map's own.
		PadFocusKind.Reset();
		PadFocusId.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpPad: focus on the deck (was %s)"), *Was);
		return;
	}
	FString Pick = Ids.Contains(Prefer) ? Prefer : FString();
	if (Pick.IsEmpty() && Kind == TEXT("room"))
	{
		// In a wing: the lifted room, else the wing's most urgent.
		if (Ids.Contains(Table->GetRoomId())) Pick = Table->GetRoomId();
		for (const ABpTable::FRoomRank& Rank : Table->RoomsByUrgency()) { if (Pick.IsEmpty() && Ids.Contains(Rank.Id)) Pick = Rank.Id; }
	}
	if (Pick.IsEmpty() && Kind == TEXT("wing") && Ids.Contains(PadLastWing)) Pick = PadLastWing;
	if (Pick.IsEmpty()) Pick = Ids[0];
	if (Kind == TEXT("room")) PadLastWing = Table->GetWingId();
	PadFocusKind = Kind;
	PadFocusId = Pick;
	Table->SetHighlight(Kind, Pick);
	UE_LOG(LogBpTable, Log, TEXT("BpPad: focus %s=%s (was %s)"), *Kind, *Pick, *Was);
}

void ABpPawn::RestoreFocusHighlight()
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	FString Kind;
	TArray<FString> Ids;
	Table->FocusSiblings(Kind, Ids);
	// The stand-up's card is about a room: it gets the highlight back once the hands stop pointing.
	if (IsStandupOpen() && !GetStandupRoom().IsEmpty()) Table->SetHighlight(TEXT("room"), GetStandupRoom());
	else if (!PadFocusId.IsEmpty() && Kind == PadFocusKind && Ids.Contains(PadFocusId)) Table->SetHighlight(PadFocusKind, PadFocusId);
	else Table->SetHighlight(FString(), FString());
}
