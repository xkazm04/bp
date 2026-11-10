// The console (night two W1; BpPawn.h declares it): the app's main menu, in the deck's slot on the table, in the sheet's
// language (BpSheet.h: the drawing set's paper, ink and accents; BpType.h's family). The owner on the Quest 3S, 2026-11-09:
// "we need bindings to thumb controllers and action buttons to create main menu and operate there, going clearly back,
// operating in blueprint without dependency of the pins and drag movement"; "the wrist panel is overpopulated with
// options, we need to migrate into the main frame".
//
// At rest it is a bar: MENU, the product, one status phrase, YOUR ROOM / STUDIO (BpSurround.h), BACK whenever the table has somewhere to go back to. Opened it
// is a panel of pages: HOME's tiles, then each page a titled list, ConsoleRowsPerPage rows a page with a pager, BACK top
// left and CLOSE top right. The pages are a registry (FBpConsolePages::Registry): one entry per page with its title, its
// rows builder, HOME's one-line summary of it, what it does when it opens, and an optional tap handler; a row's press is an
// act, the console's own (open:<page>, home, close, page:next|prev) or one PanelAct shares with the wrist, so a page moved
// here from the wrist calls the same functions the wrist's tab called.
//
// The type, laid out at 32 px a cm and read from the seated eye 75 cm away: rows' and buttons' words 28 px caps (0.875 cm,
// 40': in the 36' to 48' comfortable band), the title 36, every smaller word 24 (0.75 cm, 34'); nothing is under 24.
#include "BpPawn.h"

#include "BpAudio.h"
#include "BpGameMode.h"
#include "BpProjector.h"
#include "BpLink.h"
#include "BpSheet.h"
#include "BpTable.h"
#include "BpTourBook.h"
#include "BpType.h"
#include "BpWords.h"
#include "Components/WidgetComponent.h"
#include "Containers/Ticker.h"
#include "Engine/TextureRenderTarget2D.h"
#include "EngineUtils.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"
#include "HAL/IConsoleManager.h"
#include "Misc/App.h"
#include "Schema/BpSchemaVocab.h"
#include "TimerManager.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SDPIScaler.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SCanvas.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

/** One row of a page: its press (empty: words only), its words, and its look. */
struct FBpConsoleRow
{
	FString Act;
	FString Label;
	FString Detail;
	FString Tag;
	/** 0 plain, 1 the one the table shows (an accent bar), 2 amber (waiting, building, armed), 3 red (refused, stopped),
	 *  4 a note (words across the row, no plate), 5 the pairing code (its Label large and spaced, its Tag at the right). */
	uint8 Tone = 0;
	struct FButton
	{
		FString Word;
		FString Act;
		bool bPrimary = false;
	};
	/** Buttons at the right instead of a press of the whole row: a value's minus and plus, a toggle's state. */
	TArray<FButton> Buttons;
	/** Wave C1: tone 6, the room a scan reads now: its name large, its Detail small and its Tag (the lens) a chip in Ink. */
	FLinearColor Ink = FLinearColor::Transparent;
};

/** One page: what HOME's tile and the title call it, how it fills its rows, what it does when it opens, and how it takes a
 *  press (null: the shared acts). A later page is one more entry in Registry() and one more tile on HOME. */
struct FBpConsolePage
{
	const TCHAR* Key;
	const TCHAR* Title;
	const TCHAR* Letter;
	void (*Rows)(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& OutSub);
	FString (*Summary)(ABpPawn& Pawn);
	void (*OnOpen)(ABpPawn& Pawn);
	bool (*Tap)(ABpPawn& Pawn, const FString& Act);
};

namespace
{
	// ---- The layout grid (layout px, 32 a cm): the panel 1280 x 720, the bar 1280 x 88 ----------------------------------
	constexpr float PX = ABpPawn::ConsoleLayoutPxPerCm;
	constexpr float LW = ABpPawn::ConsoleWidthCm * PX;
	constexpr float LH = ABpPawn::ConsoleHeightCm * PX;
	constexpr float BarLH = ABpPawn::ConsoleBarHeightCm * PX;
	constexpr float Pad = 40.f;
	constexpr float HeadY0 = 24.f, HeadY1 = 94.f;
	constexpr float SubY = 100.f;
	/** A row holds a 28 px label over a 24 px detail (their line boxes 48 and 41 px: Barlow's 1.2 em). */
	constexpr float RowsY0 = 156.f, RowH = 92.f, RowGap = 4.f;
	constexpr float PagerY0 = 642.f, PagerY1 = 702.f;
	constexpr float CapLabel = 28.f, CapSmall = 24.f, CapTitle = 36.f, CapBar = 28.f, CapBarStatus = 26.f;
	/** The pairing code's caps (PC LINK): 52 px, 1.6 cm, read from the seat and from the PC beside it. */
	constexpr float CapCode = 52.f;

	FSlateFontInfo Font(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Object = ABpTable::TextFontObject()) return FSlateFontInfo(Object, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}

	TAutoConsoleVariable<int32> CVarTalkSheet(TEXT("bp.TalkSheet"), 1, TEXT("The conversation with the lamp (heard words, state, the whole reply) on the console's panel: 1 on (default), 0 the lamp's own caption box as before."), ECVF_Default);
	/** A line's pitch for a cap height (Barlow's 1.2 em). */
	float Pitch(float CapPx) { return CapPx / static_cast<float>(BpType::CapPerEm) * 1.2f; }
	int32 LineCount(const FString& Wrapped) { int32 N = 1; for (const TCHAR C : Wrapped) N += C == TEXT('\n') ? 1 : 0; return Wrapped.IsEmpty() ? 0 : N; }
	FString DayWord()
	{
		static const TCHAR* const Months[] = { TEXT("JAN"), TEXT("FEB"), TEXT("MAR"), TEXT("APR"), TEXT("MAY"), TEXT("JUN"), TEXT("JUL"), TEXT("AUG"), TEXT("SEP"), TEXT("OCT"), TEXT("NOV"), TEXT("DEC") };
		const FDateTime Now = FDateTime::Now();
		return FString::Printf(TEXT("%d %s"), Now.GetDay(), Months[FMath::Clamp(Now.GetMonth(), 1, 12) - 1]);
	}


	TAutoConsoleVariable<int32> CVarConsole(TEXT("bp.Console"), 1, TEXT("The console (the main menu in the deck's slot): 1 shown (default), 0 hidden (a profiling baseline: its draw is the difference)."), ECVF_Default);

	/** The text size the console was last placed at (PlaceConsole; TickConsoleLive places it again when bp.TextSize moves). */
	float ConsoleScaleShown = 0.f;

	FString Percent(float Level) { return FString::Printf(TEXT("%d%%"), FMath::RoundToInt(Level * 100.f)); }

	int32 CvarInt(const TCHAR* Name)
	{
		const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name);
		return Var ? Var->GetInt() : 0;
	}

	ABpPawn* ConsolePawn(UWorld* World)
	{
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdConsoleTap(
		TEXT("BpConsole.Tap"),
		TEXT("BpConsole.Tap <console:<act>>: what a hand's tap on that control of the console does (console:menu, console:close, console:home, console:open:<page>, console:page:next, console:bar:back, console:<a PanelAct act>)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = ConsolePawn(World);
			if (Args.Num() == 0 || !Pawn) { UE_LOG(LogBpTable, Warning, TEXT("BpConsole: usage BpConsole.Tap console:<act>")); return; }
			Pawn->ConsoleTap(Args[0].StartsWith(TEXT("console:")) ? Args[0] : TEXT("console:") + Args[0]);
		}));
	FAutoConsoleCommandWithWorld CmdConsoleStat(
		TEXT("BpConsole.Stat"),
		TEXT("BpConsole.Stat: logs the console's state, how many times it has been drawn, and whether its widget ticks now (idle: it does not)."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (ABpPawn* Pawn = ConsolePawn(World)) Pawn->LogConsoleStat();
		}));
	FAutoConsoleCommandWithWorld CmdConsoleRows(
		TEXT("BpConsole.Rows"),
		TEXT("BpConsole.Rows: logs the open page's sub-line and every row (label, detail, tag, buttons), for a headless check of what the console says."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (ABpPawn* Pawn = ConsolePawn(World)) Pawn->LogConsoleRows();
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdConsoleOpen(
		TEXT("BpConsole.Open"),
		TEXT("BpConsole.Open [page]: opens the console on a page (home, rooms, scan, standup, ask, projects, packages, settings, link, tour, talk, access); BpConsole.Open close puts it back to its bar."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = ConsolePawn(World);
			if (!Pawn) return;
			if (Args.Num() > 0 && Args[0] == TEXT("close")) Pawn->CloseConsole();
			else Pawn->OpenConsole(Args.Num() > 0 ? Args[0] : FString());
		}));
}

namespace
{
	// ---- ADD A PROJECT on PROJECTS (wave EV; table-link-v2.md section 14, S4) -----------------------------------------------
	// Linked and holding `onboard`, PROJECTS lists the folders the PC offers under the projects. A pick shows the terms; ASK sends
	// them as `shown`; the PC's Headsets page confirms (the run starts only there); the headset polls the ask every AskPollS while
	// it waits (never per frame; not while the app has lost the headset's focus) and, confirmed, switches to the new product and
	// draws its build-up from the feed. The state lives here, one table per app.
	struct FBpAddProject
	{
		bool bReading = false;
		bool bRead = false;
		int32 Status = 0;
		FString Error;
		TArray<FBpLinkModule::FOnboardCandidate> Candidates;
		int32 Held = 0;
		/** The folder picked (the confirm sheet shows while nothing was asked yet). */
		FString PickId, PickName, PickHint;
		bool bSending = false;
		/** The ask out, and what became of it: waiting, confirmed, declined, expired; or refused (the start's error). */
		FString Request;
		double AskedAt = 0.0;
		FString State;
		FString Words;
		FString Slug;
		FTSTicker::FDelegateHandle Poll;
		int32 Polls = 0;
	};
	FBpAddProject GAdd;
	/** The contract's ASK_TTL_MS, and the poll's period while an ask waits. */
	constexpr double AskTtlS = 600.0;
	constexpr float AskPollS = 2.f;
	TAutoConsoleVariable<int32> CVarAddProject(TEXT("bp.AddProject"), 1, TEXT("PROJECTS' ADD A PROJECT (wave EV): 1 shown when linked (default), 0 hidden."), ECVF_Default);

	/** The terms the confirm sheet shows, which are also what the ask says it showed. What the adopt job writes into the folder
	 *  (onboarding-job.server.ts's prompt: its map under .ai/lens-scan and .claude/lens-scan, a .gitignore line, no commit) is
	 *  said as an instruction, because it is one: the run is not sandboxed to it (table-link-v2.md section 12). */
	FString AddTerms(const FString& Name)
	{
		return FString::Printf(TEXT("Ask your PC to read %s? You confirm it there: on your PC open Headsets and press CONFIRM. Your PC then starts an agent that reads this folder and draws it on the table. It takes a few minutes and spends from your account. The agent is told to write only its map into the folder (.ai/lens-scan, .claude/lens-scan and a .gitignore line) and to commit nothing."), *Name);
	}
	FString AddStateWord(const FString& State)
	{
		if (State == TEXT("new")) return TEXT("NEW");
		if (State == TEXT("registered")) return TEXT("READ BEFORE");
		if (State == TEXT("onboarding")) return TEXT("BEING READ");
		return State.ToUpper();
	}
}

// ---- The pages ----------------------------------------------------------------------------------------------------------

struct FBpConsolePages
{
	static const TArray<FBpConsolePage>& Registry()
	{
		static const TArray<FBpConsolePage> Pages = {
			{ TEXT("rooms"), TEXT("ROOMS"), TEXT("A"), &RoomsRows, &RoomsSummary, nullptr, nullptr },
			{ TEXT("scan"), TEXT("SCAN"), TEXT("B"), &ScanRows, &ScanSummary, &ScanOpen, nullptr },
			{ TEXT("standup"), TEXT("STAND-UP"), TEXT("C"), &StandupRows, &StandupSummary, &StandupOpen, nullptr },
			{ TEXT("ask"), TEXT("ASK"), TEXT("D"), &AskRows, &AskSummary, nullptr, nullptr },
			{ TEXT("projects"), TEXT("PROJECTS"), TEXT("E"), &ProjectsRows, &ProjectsSummary, &ProjectsOpen, &ProjectsTap },
			{ TEXT("packages"), TEXT("PACKAGES"), TEXT("F"), &PackagesRows, &PackagesSummary, nullptr, nullptr },
			{ TEXT("settings"), TEXT("SETTINGS"), TEXT("G"), &SettingsRows, &SettingsSummary, nullptr, nullptr },
			{ TEXT("link"), TEXT("PC LINK"), TEXT("H"), &LinkRows, &LinkSummary, &LinkOpen, nullptr },
			// Wave T1: the tour and its chapters (BpTour.cpp, BpTourBook.h), a tile so a judge on a shared headset finds it in one tap.
			{ TEXT("tour"), TEXT("TOUR"), TEXT("I"), &TourRows, &TourSummary, nullptr, &TourTap },
		};
		return Pages;
	}

	static const FBpConsolePage* Find(const FString& Key)
	{
		// TALK is the consent sheet (BpTalk.cpp): opened by the first hold to talk and from SETTINGS, never a HOME tile.
		static const FBpConsolePage Talk = { TEXT("talk"), TEXT("TALK TO GLIM"), TEXT("T"), &TalkRows, &TalkSummary, nullptr, nullptr };
		if (Key == Talk.Key) return &Talk;
		// ACCESSIBILITY (night two V4): SETTINGS' first row opens it, never a HOME tile.
		static const FBpConsolePage Access = { TEXT("access"), TEXT("ACCESSIBILITY"), TEXT("G"), &AccessRows, &AccessSummary, nullptr, nullptr };
		if (Key == Access.Key) return &Access;
		// SCAN RESULT (wave C1): opened by a scan's end (BpScanTheatre.cpp), the bar's chip or the wrist's band; never a HOME tile.
		static const FBpConsolePage Result = { TEXT("scanresult"), TEXT("SCAN RESULT"), TEXT("B"), &ResultRows, &ResultSummary, &ResultOpen, &ResultTap };
		if (Key == Result.Key) return &Result;
		return Registry().FindByPredicate([&Key](const FBpConsolePage& Page) { return Key == Page.Key; });
	}

	// TALK: the consent sheet, in plain words (voice-io on-device-vs-cloud: disclosed, chosen affirmatively, revocable in one
	// step, visibly active while in use). Nothing is recorded or sent before ALLOW.
	static void TalkRows(ABpPawn&, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		const int32 Consent = ABpTable::TalkConsent();
		Sub = Consent == 1 ? FString(TEXT("Allowed · SETTINGS › TALK turns it off")) : FString(TEXT("Your choice · you can change it in SETTINGS"));
		Out.Add(Note(TEXT("Hold X, pinch and hold Glim, or hold TALK on your wrist, and speak. Let go to send. Glim says LISTENING while the microphone is on.")));
		Out.Add(Note(TEXT("Your voice goes to your PC, and from your PC to a cloud speech service that turns it into words. Glim's answer is spoken the same way."), 2));
		Out.Add(Note(TEXT("Nothing you say is kept, on this headset or on your PC. The microphone is on only while you hold.")));
		FBpConsoleRow Row;
		Row.Label = TEXT("Talk to Glim?");
		Row.Detail = TEXT("Without it, MENU › ASK still asks Glim");
		Row.Buttons = { { TEXT("NOT NOW"), TEXT("talk:notnow") }, { TEXT("ALLOW"), TEXT("talk:allow"), true } };
		Row.Tone = Consent == 1 ? 1 : 0;
		Out.Add(Row);
	}
	static FString TalkSummary(ABpPawn&) { return ABpTable::TalkConsent() == 1 ? TEXT("Allowed") : TEXT("Not allowed"); }

	// ACCESSIBILITY (night two V4, a judged special award): one group, each a console variable saved in the app's own file
	// (BpAudio.cpp's FBpStore list): REDUCED MOTION (bp.ReducedMotion), TEXT SIZE (bp.TextSize: the console, the wrist and the
	// captions scaled as a whole), CAPTIONS (bp.Captions), HAND (bp.WristHand). The choice in force is the amber one.
	static float TextSizeNow()
	{
		const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.TextSize"));
		return Var ? Var->GetFloat() : 1.f;
	}
	static void AccessRows(ABpPawn&, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		Sub = TEXT("Each choice is kept on this headset and takes effect at once");
		const auto Choice = [&Out](const TCHAR* Label, const TCHAR* Detail, std::initializer_list<FBpConsoleRow::FButton> Buttons)
		{
			FBpConsoleRow Row;
			Row.Label = Label;
			Row.Detail = Detail;
			Row.Buttons = Buttons;
			Out.Add(Row);
		};
		const bool bReduced = CvarInt(TEXT("bp.ReducedMotion")) != 0;
		Choice(TEXT("REDUCED MOTION"), TEXT("Motion eases, or changes at once"), { { TEXT("FULL"), TEXT("set:motion:0"), !bReduced }, { TEXT("REDUCED"), TEXT("set:motion:1"), bReduced } });
		const float Size = TextSizeNow();
		Choice(TEXT("TEXT SIZE"), TEXT("The console, the wrist and the captions"), { { TEXT("100%"), TEXT("set:text:1.0"), Size < 1.07f }, { TEXT("115%"), TEXT("set:text:1.15"), Size >= 1.07f && Size < 1.22f }, { TEXT("130%"), TEXT("set:text:1.3"), Size >= 1.22f } });
		const bool bAlways = CvarInt(TEXT("bp.Captions")) != 0;
		Choice(TEXT("CAPTIONS"), TEXT("Glim's lines in words, always or with his voice"), { { TEXT("ALWAYS"), TEXT("set:captions:1"), bAlways }, { TEXT("WITH VOICE"), TEXT("set:captions:0"), !bAlways } });
		const bool bRight = CvarInt(TEXT("bp.WristHand")) != 0;
		Choice(TEXT("HAND"), TEXT("The wrist panel's hand"), { { TEXT("LEFT"), TEXT("set:hand:0"), !bRight }, { TEXT("RIGHT"), TEXT("set:hand:1"), bRight } });
	}
	static FString AccessSummary(ABpPawn&)
	{
		return FString::Printf(TEXT("Motion %s · text %d%% · captions %s · %s hand"), CvarInt(TEXT("bp.ReducedMotion")) != 0 ? TEXT("reduced") : TEXT("full"), FMath::RoundToInt(TextSizeNow() * 100.f),
			CvarInt(TEXT("bp.Captions")) != 0 ? TEXT("always") : TEXT("with voice"), CvarInt(TEXT("bp.WristHand")) != 0 ? TEXT("right") : TEXT("left"));
	}

	static ABpTable* Table(ABpPawn& Pawn) { return Pawn.WristTable.Get(); }
	static bool Plan(ABpPawn& Pawn) { return Table(Pawn) && Table(Pawn)->HasPlan(); }
	static FBpConsoleRow Note(const FString& Words, uint8 Tone = 4) { FBpConsoleRow Row; Row.Label = Words; Row.Tone = Tone; return Row; }

	// ROOMS: the product's rooms by urgency (the wrist's ROOMS tab), the one shown marked; a press switches to it.
	static void RoomsRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		if (!Plan(Pawn)) { Sub = TEXT("Waiting for the plan"); Out.Add(Note(TEXT("The rooms come with the plan; it has not arrived yet."))); return; }
		const TArray<ABpTable::FRoomRank> Ranks = Table(Pawn)->RoomsByUrgency();
		const FString Shown = Table(Pawn)->GetRoomModeId();
		int32 Urgent = 0;
		if (!Shown.IsEmpty())
		{
			// The next room by the lamp's own pick (it was a 0.8 s point on the lamp before talking took the lamp's hold).
			FBpConsoleRow Next;
			Next.Act = TEXT("room:next");
			Next.Label = TEXT("NEXT ROOM");
			Next.Detail = TEXT("Glim picks it and says why");
			Next.Tag = TEXT("GO");
			Out.Add(Next);
		}
		for (int32 At = 0; At < Ranks.Num(); ++At)
		{
			const ABpTable::FRoomRank& Rank = Ranks[At];
			FBpConsoleRow Row;
			Row.Act = TEXT("room:") + Rank.Id;
			Row.Label = FString::Printf(TEXT("%d  %s"), At + 1, *Rank.Name);
			TArray<FString> Counts;
			if (Rank.T0 > 0) Counts.Add(FString::Printf(TEXT("T0 %d"), Rank.T0));
			if (Rank.T1 > 0) Counts.Add(FString::Printf(TEXT("T1 %d"), Rank.T1));
			Counts.Add(Rank.Open > 0 ? FString::Printf(TEXT("%d OPEN"), Rank.Open) : FString(TEXT("NOTHING OPEN")));
			Row.Tag = FString::Join(Counts, TEXT(" · "));
			Row.Detail = Rank.Id == Shown ? TEXT("On the table now") : FString();
			Row.Tone = Rank.Id == Shown ? 1 : Rank.T0 + Rank.T1 > 0 ? 2 : 0;
			Urgent += Rank.T0 + Rank.T1 > 0 ? 1 : 0;
			Out.Add(Row);
		}
		Sub = Urgent > 0 ? FString::Printf(TEXT("By urgency · %d rooms · %d with urgent findings · a press steps inside"), Ranks.Num(), Urgent)
			: FString::Printf(TEXT("By urgency · %d rooms · a press steps inside"), Ranks.Num());
	}
	static FString RoomsSummary(ABpPawn& Pawn)
	{
		if (!Plan(Pawn)) return TEXT("Waiting for the plan");
		int32 Open = 0;
		const TArray<ABpTable::FRoomRank> Ranks = Table(Pawn)->RoomsByUrgency();
		for (const ABpTable::FRoomRank& Rank : Ranks) Open += Rank.Open;
		return FString::Printf(TEXT("%d rooms · %d open findings"), Ranks.Num(), Open);
	}

	// SCAN (night two W2a, the web's Agents panel at the table): the start actions (SCAN THIS, EVERY LENS: a press arms, a
	// second starts, as the directed scan's row does), every running and queued scanner as a row (lens, scope, n of m features,
	// the feature being read, its clock) with CANCEL (DELETE .../scans/<job>), finished ones for ScanLingerS, the saved focuses
	// (directed), and the findings as they land, newest first (a press opens one on the deck or the decision card). From the
	// bundle the page drives the sample walk and says "sample".
	static constexpr double ScanLingerS = 20.0;
	static bool ScanReady() { const FBpLinkModule& L = FBpLinkModule::Get(); return L.HasPcLink() || L.HasSampleFocuses(); }
	static void ScanOpen(ABpPawn& Pawn)
	{
		if (ScanReady()) FBpLinkModule::Get().GetFocuses();
		Pawn.ConsoleScanWords.Reset();
		// The jobs' clocks: one redraw a second while this page is open (a timer; it stops itself when the page closes).
		if (UWorld* World = Pawn.GetWorld()) World->GetTimerManager().SetTimer(Pawn.ConsoleClockTimer, &Pawn, &ABpPawn::TickConsoleClock, 1.f, true);
	}
	static FString Clock(double Seconds)
	{
		const int32 S = FMath::Max(0, FMath::FloorToInt(Seconds));
		return S >= 3600 ? FString::Printf(TEXT("%d:%02d:%02d"), S / 3600, (S / 60) % 60, S % 60) : FString::Printf(TEXT("%d:%02d"), S / 60, S % 60);
	}
	static double SecondsSince(const FString& Iso)
	{
		FDateTime At;
		return FDateTime::ParseIso8601(*Iso, At) ? (FDateTime::UtcNow() - At).GetTotalSeconds() : -1.0;
	}
	/** One job's progress as jobProgress reads it: features read of its run, of how many, and the one being read. */
	static void JobProgress(const FBpScanState& State, const FBpScanJob& Job, int32 PlanTiles, int32& Read, int32& Of, FString& Current)
	{
		Read = 0;
		Of = Job.scope.kind == BpVocab::ScanScope::Kind::All ? PlanTiles : Job.scope.features.Num();
		Current.Reset();
		if (Job.run_id.IsEmpty()) return;
		const bool bAnyLens = Job.lens == TEXT("all");
		TSet<FString> Seen;
		for (const FBpMeasurement& M : State.Scan.measurements) if (M.run_id == Job.run_id && (bAnyLens || M.lens == Job.lens)) Seen.Add(M.feature);
		for (const FBpActivity& A : State.Scan.activity)
		{
			if (A.run_id != Job.run_id || A.feature.IsEmpty()) continue;
			if (A.kind == BpVocab::Activity::Kind::Measured) Seen.Add(A.feature);
			if (A.kind == BpVocab::Activity::Kind::Reading || A.kind == BpVocab::Activity::Kind::Measured) Current = A.feature;
		}
		Read = Seen.Num();
	}
	static FString JobStatusWord(const FString& Status)
	{
		if (Status == BpVocab::ScanJob::Status::Running) return TEXT("RUNNING");
		if (Status == BpVocab::ScanJob::Status::Queued) return TEXT("QUEUED");
		if (Status == BpVocab::ScanJob::Status::Done) return TEXT("DONE");
		if (Status == BpVocab::ScanJob::Status::Failed) return TEXT("FAILED");
		if (Status == BpVocab::ScanJob::Status::Cancelled) return TEXT("CANCELLED");
		return Status.ToUpper();
	}
	/** The scanners the page lists: measure and propose jobs queued or running, and the ones that ended in the last ScanLingerS. */
	static TArray<const FBpScanJob*> ScanJobs(bool& bAnyLive)
	{
		bAnyLive = false;
		TArray<const FBpScanJob*> Out;
		for (const FBpScanJob& Job : FBpLinkModule::Get().GetScanState().Jobs)
		{
			if (Job.kind != BpVocab::ScanJob::Kind::Measure && Job.kind != BpVocab::ScanJob::Kind::Propose) continue;
			const bool bLive = Job.status == BpVocab::ScanJob::Status::Running || Job.status == BpVocab::ScanJob::Status::Queued;
			const double Ended = SecondsSince(Job.ended_at);
			if (!bLive && !(Ended >= 0.0 && Ended < ScanLingerS)) continue;
			bAnyLive |= bLive || Ended >= 0.0;
			Out.Add(&Job);
		}
		// Running first, then queued, then the finished ones; within each, the newest first.
		Out.Sort([](const FBpScanJob& A, const FBpScanJob& B)
		{
			const auto Rank = [](const FBpScanJob& J) { return J.status == BpVocab::ScanJob::Status::Running ? 0 : J.status == BpVocab::ScanJob::Status::Queued ? 1 : 2; };
			return Rank(A) != Rank(B) ? Rank(A) < Rank(B) : A.queued_at > B.queued_at;
		});
		return Out;
	}
	static void ScanRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		ABpTable* T = Table(Pawn);
		const bool bSample = !Link.HasPcLink();
		const FString Place = T ? T->DirectedLabel(T->DirectedTarget()) : FString();
		const FString PlaceWords = Place.IsEmpty() ? FString(TEXT("the site")) : Place;
		const FString LensWords = T ? BpWords::Lens(T->GetActiveLens()) : FString();
		bool bAnyLive = false;
		const TArray<const FBpScanJob*> Jobs = bSample ? TArray<const FBpScanJob*>() : ScanJobs(bAnyLive);
		int32 Running = 0, Queued = 0;
		for (const FBpScanJob* Job : Jobs)
		{
			Running += Job->status == BpVocab::ScanJob::Status::Running ? 1 : 0;
			Queued += Job->status == BpVocab::ScanJob::Status::Queued ? 1 : 0;
		}
		if (!ScanReady() && !Link.IsFromBundle())
		{
			Sub = TEXT("Scans run on your PC");
			Out.Add(Note(TEXT("Waiting for your PC's scan list (PC LINK says how this headset reaches it)")));
			return;
		}
		Sub = Pawn.bWristScanStarting ? FString(TEXT("Starting the scan"))
			: bSample ? FString::Printf(TEXT("Sample · %s · it reads and writes nothing"), *PlaceWords)
			: FString::Printf(TEXT("On your PC · %d running · %d queued · %s"), Running, Queued, *PlaceWords);
		// What the last start or cancel said: a refusal stays until dismissed.
		if (Pawn.bWristScanRefused && !Pawn.WristScanWords.IsEmpty())
		{
			FBpConsoleRow Row;
			Row.Act = TEXT("scan:dismiss");
			Row.Label = TEXT("The scan did not start");
			Row.Detail = Pawn.WristScanWords;
			Row.Tag = TEXT("DISMISS");
			Row.Tone = 3;
			Out.Add(Row);
		}
		else if (!Pawn.ConsoleScanWords.IsEmpty()) Out.Add(Note(Pawn.ConsoleScanWords));
		// The start actions: SCAN THIS (the place shown, the lens shown) and EVERY LENS; the armed one says PRESS AGAIN.
		{
			const bool bThis = Pawn.WristArmedFocus == TEXT("@this"), bEvery = Pawn.WristArmedFocus == TEXT("@every");
			// V7: the row and its button name the same scope, by where the person is ("SCAN THIS ROOM", "Scan this room: Billing").
			const FString Scope = T ? T->DirectedScope(T->DirectedTarget()) : FString(TEXT("everything"));
			const bool bSite = Scope == TEXT("everything");
			const FString Named = bSite || Place.IsEmpty() ? FString(TEXT("Scan ")) + Scope : FString::Printf(TEXT("Scan %s: %s"), *Scope, *Place);
			FBpConsoleRow Row;
			Row.Label = bThis ? Named + TEXT("?") : bEvery ? FString(TEXT("Every lens, everything?")) : Named;
			Row.Detail = bThis || bEvery ? FString(TEXT("Press again to start · anything else cancels"))
				: bSample ? FString::Printf(TEXT("%s · a sample walk"), *LensWords) : FString::Printf(TEXT("%s · or every lens at once"), *LensWords);
			Row.Tone = bThis || bEvery ? 2 : 0;
			Row.Buttons = { { bThis ? FString(TEXT("START")) : (TEXT("SCAN ") + Scope.ToUpper()), TEXT("scan:this"), bThis } };
			if (!bSample) Row.Buttons.Add({ bEvery ? TEXT("START") : TEXT("EVERY LENS"), TEXT("scan:every"), bEvery });
			Out.Add(Row);
		}
		// The scanners.
		if (bSample)
		{
			FString Head, Body;
			if (T) T->ScanBand(Head, Body);
			if (!Head.IsEmpty() && T && T->IsScanRunning())
			{
				ReadingRow(*T, Out);
				FBpConsoleRow Row;
				Row.Label = Head;
				Row.Detail = Body;
				Row.Tag = TEXT("SAMPLE");
				Row.Tone = 2;
				Row.Buttons = { { TEXT("CANCEL"), TEXT("job:cancel:sample") } };
				Out.Add(Row);
			}
		}
		else
		{
			const int32 Tiles = T && T->HasPlan() ? T->PlanTileCount() : 0;
			if (T && Running > 0) ReadingRow(*T, Out);
			for (const FBpScanJob* Job : Jobs)
			{
				const bool bRunning = Job->status == BpVocab::ScanJob::Status::Running, bQueued = Job->status == BpVocab::ScanJob::Status::Queued;
				int32 Read = 0, Of = 0;
				FString Current;
				JobProgress(Link.GetScanState(), *Job, Tiles, Read, Of, Current);
				FBpConsoleRow Row;
				const FString Lens = Job->lens == TEXT("all") ? FString(TEXT("Every lens")) : BpWords::Lens(Job->lens);
				Row.Label = FString::Printf(TEXT("%s · %s"), *Lens, Job->scope.label.IsEmpty() ? TEXT("Everything") : *Job->scope.label);
				TArray<FString> Parts;
				if (!Job->focus.IsEmpty()) Parts.Add(TEXT("Directed"));
				if (bQueued) Parts.Add(FString::Printf(TEXT("waiting %s"), *Clock(SecondsSince(Job->queued_at))));
				else
				{
					Parts.Add(Of > 0 ? FString::Printf(TEXT("%d of %d"), FMath::Min(Read, Of), Of) : FString::Printf(TEXT("%d read"), Read));
					if (bRunning && !Current.IsEmpty() && T) { const FString Name = T->DirectedLabel(Current); Parts.Add(TEXT("reading ") + (Name.IsEmpty() ? Current : Name)); }
					if (bRunning) Parts.Add(Clock(SecondsSince(Job->started_at.IsEmpty() ? Job->queued_at : Job->started_at)));
				}
				Row.Detail = FString::Join(Parts, TEXT(" · "));
				Row.Tag = JobStatusWord(Job->status);
				Row.Tone = bRunning ? 1 : bQueued ? 2 : Job->status == BpVocab::ScanJob::Status::Done ? 0 : 3;
				if (bRunning || bQueued) Row.Buttons = { { TEXT("CANCEL"), TEXT("job:cancel:") + Job->id } };
				Out.Add(Row);
			}
			if (Jobs.Num() == 0) Out.Add(Note(TEXT("No scanner is running on your PC.")));
		}
		// The saved focuses (a directed scan): a press arms one for the place shown, a second starts it.
		const FBpFocusList& List = Link.GetFocusList();
		for (const FBpSavedFocus& F : List.Focuses)
		{
			FBpConsoleRow Row;
			Row.Act = TEXT("focus:") + F.Id;
			Row.Label = F.Note.Replace(TEXT("\n"), TEXT(" "));
			const FString* Short = Link.FindLensShort(F.Lens);
			Row.Detail = FString::Printf(TEXT("Directed · %s · %s"), Short ? **Short : *BpWords::Lens(F.Lens).Left(3).ToUpper(), *BpWords::Lens(F.Lens));
			const bool bArmed = F.Id == Pawn.WristArmedFocus;
			Row.Tag = bArmed ? (bSample ? TEXT("PRESS AGAIN: SAMPLE") : TEXT("PRESS AGAIN TO START")) : FString(TEXT("FOCUS"));
			Row.Tone = bArmed ? 2 : 0;
			Out.Add(Row);
		}
		if (!List.Error.IsEmpty() && List.Focuses.Num() == 0) Out.Add(Note(List.Error));
		// The findings as they land, newest first.
		const FBpScanState& State = Link.GetScanState();
		TArray<const FBpProposal*> Feed;
		for (const FBpProposal& P : State.Scan.proposals) Feed.Add(&P);
		Feed.Sort([](const FBpProposal& A, const FBpProposal& B) { return A.created_at > B.created_at; });
		if (Feed.Num() > 0) Out.Add(Note(bSample ? TEXT("The sample's findings, newest first") : TEXT("Findings as they land, newest first"), 4));
		for (int32 Index = 0; Index < Feed.Num() && Index < ScanFeedRows; ++Index)
		{
			const FBpProposal& P = *Feed[Index];
			FBpConsoleRow Row;
			Row.Act = TEXT("finding:") + P.id;
			Row.Label = P.title.IsEmpty() ? P.id : P.title;
			const int32* Tier = State.Tiers.Find(P.id);
			const FString Age = SecondsSince(P.created_at) >= 0.0 && SecondsSince(P.created_at) < 3600.0 ? FString::Printf(TEXT(" · %s ago"), *Clock(SecondsSince(P.created_at))) : FString();
			Row.Detail = FString::Printf(TEXT("%s · %s%s"), *BpWords::Lens(P.lens), Tier ? *BpWords::TierSays(*Tier) : TEXT("untriaged"), *Age);
			Row.Tag = Tier ? FString::Printf(TEXT("T%d"), *Tier) : FString(TEXT("OPEN"));
			Row.Tone = Tier && *Tier <= 1 ? 2 : 0;
			Out.Add(Row);
		}
	}
	static constexpr int32 ScanFeedRows = 6;
	/** Wave C1: the running scan's life on the SCAN page: the room being read named large with its n of m, the clock, and the
	 *  lens as a chip in its colour. */
	static void ReadingRow(ABpTable& T, TArray<FBpConsoleRow>& Out)
	{
		ABpTable::FScanReading Reading;
		if (!T.GetScanReading(Reading) || Reading.Room.IsEmpty()) return;
		FBpConsoleRow Row;
		Row.Tone = 6;
		Row.Label = Reading.Room;
		const double Since = T.GetWorld() ? T.GetWorld()->GetTimeSeconds() - Reading.StartedAt : 0.0;
		Row.Detail = FString::Printf(TEXT("READING · ROOM %d OF %d · %s"), Reading.At, Reading.Of, *Clock(Since));
		Row.Tag = BpWords::Lens(Reading.Lens).ToUpper();
		const FString* Hex = FBpLinkModule::Get().FindLensAccent(Reading.Lens);
		Row.Ink = Hex && Hex->StartsWith(TEXT("#")) && Hex->Len() >= 7 ? FLinearColor::FromSRGBColor(FColor::FromHex(*Hex)) : BpSheet::Accent;
		Out.Add(Row);
	}

	// SCAN RESULT (wave C1): what the scan read and found, the three most severe as rows that raise their room, DECIDE THEM
	// (the stand-up) and CLOSE. A cancelled or failed scan says so with what it read before it stopped.
	static void ResultOpen(ABpPawn& Pawn) { if (ABpTable* T = Table(Pawn)) T->ScanResultSeen(); }
	static FString ResultSummary(ABpPawn& Pawn)
	{
		ABpTable::FScanResult R;
		ABpTable* T = Table(Pawn);
		return T && T->GetScanResult(R) ? ABpTable::ScanResultWords(R) : FString(TEXT("No scan has ended here yet"));
	}
	static void ResultRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		ABpTable* T = Table(Pawn);
		ABpTable::FScanResult R;
		if (!T || !T->GetScanResult(R))
		{
			Sub = TEXT("No scan has ended here yet");
			Out.Add(Note(TEXT("Start one on the SCAN page: Glim follows it room by room, and its result opens here.")));
			return;
		}
		const FString Lens = BpWords::Lens(R.Lens);
		Sub = FString::Printf(TEXT("%s · %s · %s%s"), *R.Place, *Lens, *Clock(R.Seconds), R.bSample ? TEXT(" · a sample: nothing was read or written") : TEXT(""));
		{
			// What it read and what it found, one row: the rooms and features (or where it stopped), then the new findings by
			// severity as chips (a chip raises the first of its kind).
			FBpConsoleRow Row;
			const FString Found = R.New == 0 ? FString(TEXT("nothing new")) : FString::Printf(TEXT("%d new %s"), R.New, R.New == 1 ? TEXT("finding") : TEXT("findings"));
			Row.Label = R.bFailed || R.bCancelled ? FString::Printf(TEXT("%s after %d of %d %s · %s"), R.bFailed ? TEXT("Failed") : TEXT("Stopped"), R.RoomsRead, R.RoomsTotal, R.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms"), *Found)
				: FString::Printf(TEXT("%d %s read · %s"), R.RoomsRead, R.RoomsRead == 1 ? TEXT("room") : TEXT("rooms"), *Found);
			Row.Detail = FString::Printf(TEXT("%d %s in %s%s"), R.Features, R.Features == 1 ? TEXT("feature") : TEXT("features"), *Clock(R.Seconds), R.New == 0 ? TEXT(" · the rooms keep what they had") : TEXT(""));
			Row.Tone = R.bFailed || R.bCancelled ? 3 : 1;
			static const TCHAR* const Words[3] = { TEXT("STOP-SHIP"), TEXT("BEFORE RELEASE"), TEXT("LATER") };
			for (int32 S = 0; S < 3; ++S) if (R.Severity[S] > 0) Row.Buttons.Add({ FString::Printf(TEXT("%s %d"), Words[S], R.Severity[S]), FString::Printf(TEXT("result:sev:%d"), S), S == 0 });
			if (Row.Buttons.Num() == 0) Row.Tag = R.bFailed ? TEXT("FAILED") : R.bCancelled ? TEXT("STOPPED") : TEXT("DONE");
			Out.Add(Row);
		}
		// The three most severe: a press raises the finding's room on the plan and the lamp goes beside it.
		const FBpScanState& State = FBpLinkModule::Get().GetScanState();
		for (const FString& Id : R.Top)
		{
			const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Id](const FBpProposal& Each) { return Each.id == Id; });
			if (!P) continue;
			const int32 Sev = ABpTable::ScanSeverity(*P, State.Tiers.Find(Id));
			FBpConsoleRow Row;
			Row.Act = TEXT("result:raise:") + Id;
			Row.Label = P->title.IsEmpty() ? P->id : P->title;
			const FString Room = T->StandupRoomOf(P->feature);
			Row.Detail = FString::Printf(TEXT("%s · %s"), Room.IsEmpty() ? *P->feature : *T->StandupPlaceName(Room), *BpWords::Lens(P->lens));
			Row.Tag = Sev == 0 ? TEXT("STOP-SHIP") : Sev == 1 ? TEXT("BEFORE RELEASE") : TEXT("LATER");
			Row.Tone = Sev == 0 ? 3 : Sev == 1 ? 2 : 0;
			Out.Add(Row);
		}
		FBpConsoleRow Act;
		Act.Label = R.New > 0 ? FString(TEXT("Decide them")) : FString(TEXT("Nothing to decide"));
		Act.Detail = R.New > 0 ? FString(TEXT("The stand-up, one decision at a time")) : FString(TEXT("CLOSE puts the menu back to its bar"));
		if (R.New > 0) Act.Buttons.Add({ TEXT("DECIDE THEM"), TEXT("result:decide"), true });
		Act.Buttons.Add({ TEXT("CLOSE"), TEXT("result:close") });
		Out.Add(Act);
	}
	static bool ResultTap(ABpPawn& Pawn, const FString& Act)
	{
		ABpTable* T = Table(Pawn);
		if (!T || !Act.StartsWith(TEXT("result:"))) return false;
		ABpTable::FScanResult R;
		T->GetScanResult(R);
		T->ScanResultSeen();
		if (Act == TEXT("result:close")) { Pawn.CloseConsole(); return true; }
		// DECIDE THEM (wave P1): the stand-up at the first decision that came from this scan, else the room's deck at the first.
		if (Act == TEXT("result:decide")) { Pawn.OpenStandupForFindings(R.Found); return true; }
		if (Act.StartsWith(TEXT("result:raise:"))) { T->ScanResultRaise(Act.Mid(13)); return true; }
		if (Act.StartsWith(TEXT("result:sev:")))
		{
			// The first finding of that severity among the result's rows.
			const int32 Want = FCString::Atoi(*Act.Mid(11));
			const FBpScanState& State = FBpLinkModule::Get().GetScanState();
			for (const FString& Id : R.Top)
			{
				const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Id](const FBpProposal& Each) { return Each.id == Id; });
				if (P && ABpTable::ScanSeverity(*P, State.Tiers.Find(Id)) == Want) { T->ScanResultRaise(Id); break; }
			}
			return true;
		}
		return false;
	}
	static FString ScanSummary(ABpPawn&)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		if (!Link.HasPcLink()) return Link.HasSampleFocuses() ? FString(TEXT("Sample scan · reads nothing")) : FString(TEXT("Needs your PC"));
		bool bAny = false;
		int32 Live = 0;
		for (const FBpScanJob* Job : ScanJobs(bAny)) Live += Job->status == BpVocab::ScanJob::Status::Running || Job->status == BpVocab::ScanJob::Status::Queued ? 1 : 0;
		return Live > 0 ? FString::Printf(TEXT("%d %s at work"), Live, Live == 1 ? TEXT("scanner") : TEXT("scanners")) : FString(TEXT("Nothing running · start one"));
	}

	// PC LINK (night two W2a, table link v2): how this headset reaches the PC, the pairing (PAIR shows the code and the exact
	// command the owner types on the PC; CANCEL; UNPAIR), what it may do, and the Wi-Fi door it learned.
	static void LinkOpen(ABpPawn&) {}
	static void LinkRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		// Night two V7: the page speaks to the wearer. What is connected now, the next step in one sentence, the code large while
		// pairing, PAIR and UNPAIR; a command the PC needs is only a small secondary line labelled FOR THE PC. Since 2026-11-10 the
		// PC's Headsets page takes the code (the terminal's approve still works: the FOR THE PC line).
		const FBpLinkStatus& S = FBpLinkModule::Get().GetLinkStatus();
		const bool bLinked = S.Route != EBpLinkRoute::None;
		const auto ForPc = [](const FString& Command) { return Note(TEXT("FOR THE PC  ·  ") + Command); };
		Sub = TEXT("What this headset reads, and what it may do on your PC");
		{
			FBpConsoleRow Row;
			Row.Label = S.Route == EBpLinkRoute::Cable ? FString(TEXT("YOUR PC · CABLE")) : S.Route == EBpLinkRoute::Wifi ? FString(TEXT("YOUR PC · WI-FI"))
				: S.bDecided || S.bBundleOnly ? FString(TEXT("THE SAMPLE")) : FString(TEXT("LOOKING FOR YOUR PC"));
			Row.Detail = S.bBundleOnly ? FString(TEXT("This build reads its sample only."))
				: !bLinked ? FString(TEXT("Start the server on your PC, then plug in the headset's cable."))
				: S.Pair == EBpPairState::Paired ? FString(TEXT("Your own projects come from your PC."))
				: FString(TEXT("Your projects come from your PC. Pair to decide and scan here."));
			Row.Tag = FBpLinkModule::RouteWord(S);
			Row.Tone = bLinked ? 1 : 2;
			Out.Add(Row);
			if (!bLinked && !S.bBundleOnly) Out.Add(ForPc(TEXT("npm run server")));
		}
		if (S.Pair == EBpPairState::Waiting)
		{
			FBpConsoleRow Code;
			Code.Label = S.Code;
			FDateTime Until;
			const double Left = FDateTime::ParseIso8601(*S.CodeExpiresAt, Until) ? (Until - FDateTime::UtcNow()).GetTotalSeconds() : -1.0;
			Code.Tag = Left >= 0.0 ? FString::Printf(TEXT("%s LEFT"), *Clock(Left)) : FString(TEXT("WAITING"));
			Code.Tone = 5;
			Out.Add(Code);
			FBpConsoleRow Cancel;
			// Wave EV: the PC's Headsets page takes the code (apps/web/src/headsets); the terminal stays the small FOR THE PC line.
			Cancel.Label = TEXT("Type this code on your PC");
			Cancel.Detail = TEXT("Open Developer's Blueprint on your PC, go to Headsets, and type this code there. It lasts two minutes.");
			Cancel.Buttons = { { TEXT("CANCEL"), TEXT("link:cancel") } };
			Out.Add(Cancel);
			Out.Add(ForPc(FString::Printf(TEXT("npm run server -- pair approve %s --scope %s"), *S.Code, FBpLinkModule::ApproveScopes)));
		}
		else if (S.Pair == EBpPairState::Asking)
		{
			Out.Add(Note(TEXT("Asking your PC for a code"), 2));
		}
		else if (S.Pair == EBpPairState::Paired)
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("Paired");
			TArray<FString> Can;
			for (const FString& Scope : S.Scopes) Can.Add(FBpLinkModule::ScopeWords(Scope));
			FDateTime Until;
			const FString Till = FDateTime::ParseIso8601(*S.ExpiresAt, Until) ? FString::Printf(TEXT(" Until %s."), *Until.ToString(TEXT("%d.%m.%Y"))) : FString();
			Row.Detail = Till.IsEmpty() ? FString(TEXT("UNPAIR ends it.")) : Till.TrimStart() + TEXT(" UNPAIR ends it.");
			Row.Buttons = { { TEXT("UNPAIR"), TEXT("link:unpair") } };
			Out.Add(Row);
			Out.Add(Note(Can.Num() > 0 ? TEXT("It may ") + FString::Join(Can, TEXT(", ")) + TEXT(".") : FString(TEXT("Your PC has not said what it may do yet."))));
		}
		else
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("Not paired");
			Row.Detail = bLinked ? FString(TEXT("PAIR shows a code; you approve it on your PC.")) : FString(TEXT("Connect your PC first, then PAIR."));
			Row.Buttons = { { TEXT("PAIR"), TEXT("link:pair"), bLinked } };
			Out.Add(Row);
		}
		{
			FBpConsoleRow Row;
			Row.Label = S.WifiUrl.IsEmpty() ? FString(TEXT("Without the cable: not yet")) : FString(TEXT("Without the cable: ready"));
			Row.Detail = S.WifiUrl.IsEmpty() ? FString(TEXT("Your PC offers Wi-Fi when its server runs with Wi-Fi on."))
				: FString(TEXT("Once paired, it reaches your PC over Wi-Fi, no cable."));
			if (S.Route == EBpLinkRoute::Cable) Row.Buttons = { { TEXT("ASK PC"), TEXT("link:where") } };
			Out.Add(Row);
			if (S.WifiUrl.IsEmpty() && S.Pair != EBpPairState::Waiting && bLinked) Out.Add(ForPc(TEXT("npm run server -- --lan")));
		}
		// The link's own notes are written for whoever runs the PC; with nothing connected the first row already says what to do.
		if (!S.Message.IsEmpty() && S.Pair != EBpPairState::Waiting && bLinked) Out.Add(Note(S.Message, S.bMessageBad ? 3 : 4));
	}
	static FString LinkSummary(ABpPawn&)
	{
		const FBpLinkStatus& S = FBpLinkModule::Get().GetLinkStatus();
		if (S.Pair == EBpPairState::Waiting) return FString::Printf(TEXT("Code %s · approve it on the PC"), *S.Code);
		// Short by rule on the tile (night two V2): the long route words ("Not connected: showing the sample") stay on the page.
		if (S.Route == EBpLinkRoute::None) return TEXT("Not connected · the sample");
		return FString::Printf(TEXT("%s · %s"), *FBpLinkModule::RouteWords(S), S.Pair == EBpPairState::Paired ? TEXT("paired") : TEXT("not paired"));
	}

	// STAND-UP (night two W2b, BpStandup.cpp): the morning ritual. Its body is a sheet, not rows (ABpPawn::DrawStandup); this
	// gives the header's sub-line: where the morning comes from and what it covers.
	static void StandupOpen(ABpPawn& Pawn) { Pawn.StandupOpened(); }
	static void StandupRows(ABpPawn& Pawn, TArray<FBpConsoleRow>&, FString& Sub)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		if (!Link.HasPcLink()) Sub = TEXT("Sample morning · nothing you decide here is sent");
		else if (!Link.CanDecide()) Sub = TEXT("From your PC · pair with decide to answer here (PC LINK)");
		else Sub = FString::Printf(TEXT("From your PC · %s · every answer goes with the words it showed"), *FBpLinkModule::RouteWords(Link.GetLinkStatus()));
		if (Pawn.LiveGrant()) Sub += TEXT(" · ") + Pawn.StandupBarStatus();
	}
	static FString StandupSummary(ABpPawn& Pawn)
	{
		if (Pawn.LiveGrant()) return Pawn.StandupBarStatus();
		const int32 Waiting = Plan(Pawn) ? Table(Pawn)->OpenDecisionCount() : 0;
		// Wave EV: what came of yesterday's approvals leads, before the page is opened.
		if (const FString Yesterday = Pawn.StandupYesterdayWords(); !Yesterday.IsEmpty()) return Yesterday.Left(1).ToUpper() + Yesterday.Mid(1);
		if (!FBpLinkModule::Get().HasPcLink()) return TEXT("The sample morning · 3 decisions");
		// The companion's requests pending on the PC count here too (night two V2).
		const int32 Requests = Pawn.StandupPendingRequests();
		if (Requests > 0) return FString::Printf(TEXT("%d %s · %d %s"), Waiting, Waiting == 1 ? TEXT("decision") : TEXT("decisions"), Requests, Requests == 1 ? TEXT("request") : TEXT("requests"));
		return Waiting > 0 ? FString::Printf(TEXT("The morning · %d %s waiting"), Waiting, Waiting == 1 ? TEXT("decision") : TEXT("decisions")) : FString(TEXT("The morning · nothing waiting"));
	}

	// ASK: the lamp's three asks (the wrist's ASK tab), its last answer, and what that answer offers.
	static void AskRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		if (!Plan(Pawn)) { Sub = TEXT("Glim"); Out.Add(Note(TEXT("Glim answers once the plan has arrived."))); return; }
		ABpTable* T = Table(Pawn);
		Sub = T->IsLampAsking() ? FString(TEXT("Asking the companion")) : FString(TEXT("Ask Glim; he answers from the store, and with the companion on your PC"));
		const TCHAR* Asks[][2] = { { TEXT("What should I do next?"), TEXT("ask:next") }, { TEXT("Plan my next step here"), TEXT("ask:here") }, { TEXT("Scan this"), TEXT("ask:scan") } };
		for (const auto& Ask : Asks)
		{
			FBpConsoleRow Row;
			Row.Label = Ask[0];
			Row.Act = Ask[1];
			Out.Add(Row);
		}
		if (!T->GetLampAnswer().IsEmpty()) Out.Add(Note(T->GetLampAnswer()));
		if (!T->LampOfferLabel().IsEmpty())
		{
			FBpConsoleRow Row;
			Row.Act = TEXT("ask:act");
			Row.Label = T->LampOfferLabel();
			Row.Tag = TEXT("DO IT");
			Row.Tone = 2;
			Out.Add(Row);
		}
		// The page's free space: talking, drawn (night two V2), when the rows leave room for it.
		if (Out.Num() < ABpPawn::ConsoleRowsPerPage - 1)
		{
			FBpConsoleRow Hint;
			Hint.Tone = 6;
			Hint.Label = TEXT("Or ask in your own words");
			Hint.Detail = ABpTable::TalkConsent() == 1 ? FString(TEXT("Hold X, or pinch and hold Glim, and speak. Let go to send.")) : FString(TEXT("Talking to Glim is off: SETTINGS › TALK turns it on."));
			Hint.Tag = TEXT("2");
			Out.Add(Hint);
		}
	}
	static FString AskSummary(ABpPawn& Pawn)
	{
		return Plan(Pawn) && !Table(Pawn)->LampOfferLabel().IsEmpty() ? Table(Pawn)->LampOfferLabel() : FString(TEXT("Three questions for Glim"));
	}

	// PROJECTS: every product and its onboarding (the wrist's PROJECTS tab), the open one marked; a press switches to it.
	static void ProjectsRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FBpOnboardingState& Onboarding = Link.GetOnboarding();
		const FString Open = Link.GetProductSlug();
		int32 Building = 0;
		for (const FBpProductEntry& E : Onboarding.Products) Building += E.IsBuilding() ? 1 : 0;
		Sub = FString::Printf(TEXT("%d projects on your PC · %s open"), Onboarding.Products.Num(), *Link.NameOf(Open));
		if (Building > 0) Sub += FString::Printf(TEXT(" · %d onboarding"), Building);
		if (Onboarding.Products.Num() == 0)
		{
			Sub = FString::Printf(TEXT("%s open%s"), *Link.NameOf(Open), Link.IsFromBundle() ? TEXT(" · the sample") : TEXT(""));
			if (!Link.IsFromBundle()) { Out.Add(Note(TEXT("Reading the projects"))); return; }
			FBpConsoleRow Empty;
			Empty.Tone = 6;
			Empty.Label = TEXT("One sample project on this headset");
			Empty.Detail = TEXT("Your real projects are listed here once this headset is linked to your PC.");
			Empty.Tag = TEXT("1");
			Empty.Buttons = { { TEXT("OPEN PC LINK"), TEXT("open:link"), true } };
			Out.Add(Empty);
			// Wave EV: adding one of your own needs the PC (the sample has no onboarding).
			Out.Add(Note(TEXT("ADD A PROJECT")));
			FBpConsoleRow Add;
			Add.Label = TEXT("Add a project needs your PC");
			Add.Detail = TEXT("PC LINK connects it; then your PC offers the folders next to your projects.");
			Add.Buttons = { { TEXT("OPEN PC LINK"), TEXT("open:link"), true } };
			Out.Add(Add);
			return;
		}
		// Wave EV: an ask in hand (picked, waiting, or answered) takes the page.
		if (AddRows(Pawn, Out, Sub)) return;
		TArray<const FBpProductEntry*> Order;
		for (const FBpProductEntry& E : Onboarding.Products) if (E.IsBuilding()) Order.Add(&E);
		for (const FBpProductEntry& E : Onboarding.Products) if (!E.IsBuilding()) Order.Add(&E);
		for (const FBpProductEntry* P : Order)
		{
			const FBpProductEntry& E = *P;
			const bool bHere = E.Slug == Open;
			FBpConsoleRow Row;
			Row.Act = TEXT("project:") + E.Slug;
			Row.Label = E.Name.IsEmpty() ? E.Slug : E.Name;
			if (E.State == TEXT("queued")) Row.Detail = TEXT("Queued");
			else if (E.IsBuilding())
			{
				Row.Detail = E.Phase.IsEmpty() ? FString(TEXT("Building")) : FString::Printf(TEXT("Building · %s"), *FBpLinkModule::PhaseLabel(E.Phase));
				if (E.Of > 0 && (E.ProgressPhase.IsEmpty() || E.ProgressPhase == E.Phase)) Row.Detail += FString::Printf(TEXT(" %d/%d"), E.N, E.Of);
			}
			else if (E.IsStopped())
			{
				Row.Detail = E.Phase.IsEmpty() ? FString(TEXT("Stopped")) : FString::Printf(TEXT("Stopped at %s"), *FBpLinkModule::PhaseLabel(E.Phase));
				// Wave EV: the failure in the PC's fixed words, and what the person can do (it stays registered).
				if (!E.Error.IsEmpty()) Row.Detail += TEXT(": ") + E.Error;
				if (!E.bHasMap) Row.Detail += TEXT(" · it stays on your PC: read it again from Projects there");
			}
			else Row.Detail = E.bHasMap ? TEXT("Ready") : TEXT("No map yet");
			// The built-in sample says so (night two W2a): the PC's own products are the real ones.
			if (E.Slug == TEXT("kettle")) Row.Detail = TEXT("The sample · ") + Row.Detail;
			Row.Tag = bHere ? TEXT("HERE") : E.IsBuilding() ? TEXT("WATCH") : TEXT("OPEN");
			Row.Tone = bHere ? 1 : E.IsBuilding() || E.State == TEXT("queued") ? 2 : E.IsStopped() ? 3 : 0;
			Out.Add(Row);
		}
		AddListRows(Pawn, Out);
	}

	// ---- ADD A PROJECT (wave EV) ------------------------------------------------------------------------------------------
	static void ProjectsOpen(ABpPawn& Pawn)
	{
		// The folders are read each time the page opens (ids change when the PC restarts); never while an ask is in hand.
		if (GAdd.PickId.IsEmpty() && GAdd.Request.IsEmpty()) AddRead(Pawn);
	}
	static void AddRead(ABpPawn& Pawn)
	{
		FBpLinkModule& Link = FBpLinkModule::Get();
		if (!Link.CanOnboard() || CVarAddProject.GetValueOnGameThread() == 0 || GAdd.bReading) return;
		GAdd.bReading = true;
		TWeakObjectPtr<ABpPawn> Self(&Pawn);
		Link.GetOnboardCandidates([Self](const FBpLinkModule::FOnboardCandidates& Read)
		{
			GAdd.bReading = false;
			GAdd.bRead = true;
			GAdd.Status = Read.Status;
			GAdd.Error = Read.Error;
			GAdd.Candidates = Read.Candidates;
			GAdd.Held = Read.Held;
			UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: %d folders offered, %d held%s"), Read.Candidates.Num(), Read.Held, Read.Error.IsEmpty() ? TEXT("") : *(TEXT(", ") + Read.Error));
			if (ABpPawn* P = Self.Get()) P->RefreshConsole();
		});
	}
	/** The list's part of the page: under the projects, ADD A PROJECT and the folders the PC offers (or why there are none). */
	static void AddListRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		if (CVarAddProject.GetValueOnGameThread() == 0 || !Link.HasPcLink()) return;
		Out.Add(Note(TEXT("ADD A PROJECT")));
		if (!Link.CanOnboard())
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("This headset may not add projects");
			Row.Detail = TEXT("On your PC: Headsets, pair again with 'Add projects' ticked.");
			Row.Buttons = { { TEXT("PC LINK"), TEXT("open:link"), false } };
			Row.Tone = 2;
			Out.Add(Row);
			return;
		}
		// "Your PC is reading <name>" stands while its read runs; once it is done or stopped, its project's row says so instead.
		const FBpProductEntry* Reading = GAdd.State == TEXT("confirmed") ? Link.FindProduct(GAdd.Slug) : nullptr;
		if (!GAdd.Words.IsEmpty() && !(Reading && !Reading->IsBuilding())) Out.Add(Note(GAdd.Words, GAdd.State == TEXT("refused") ? 3 : 4));
		// Not read yet (or read again after an answer changed the offer): one read, guarded against a second while it is out.
		if (!GAdd.bRead) { AddRead(Pawn); Out.Add(Note(TEXT("Asking your PC which folders it offers"))); return; }
		if (!GAdd.Error.IsEmpty()) { FBpConsoleRow Row; Row.Label = GAdd.Error; Row.Tone = 3; Row.Buttons = { { TEXT("TRY AGAIN"), TEXT("add:read"), true } }; Out.Add(Row); return; }
		if (GAdd.Candidates.Num() == 0) Out.Add(Note(TEXT("Your PC offers no folders next to your projects.")));
		for (const FBpLinkModule::FOnboardCandidate& C : GAdd.Candidates)
		{
			FBpConsoleRow Row;
			Row.Act = TEXT("add:pick:") + C.Id;
			Row.Label = C.Name;
			Row.Detail = C.Hint;
			Row.Tag = AddStateWord(C.State);
			Row.Tone = C.State == TEXT("onboarding") ? 2 : 0;
			Out.Add(Row);
		}
		if (GAdd.Held > 0) Out.Add(Note(FString::Printf(TEXT("%d more %s carry their own agent settings: start those on your PC."), GAdd.Held, GAdd.Held == 1 ? TEXT("folder") : TEXT("folders"))));
	}
	/** The ask in hand takes the page: the confirm sheet, the wait, or what the PC answered. False: the list shows. */
	static bool AddRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		if (GAdd.PickId.IsEmpty()) return false;
		const FString Name = GAdd.PickName;
		if (GAdd.Request.IsEmpty() && GAdd.State.IsEmpty())
		{
			// The confirm sheet, in the hand-over sheet's pattern: fixed terms, then ASK and CANCEL.
			Sub = TEXT("ADD A PROJECT · CONFIRM · nothing is asked before ASK");
			FBpConsoleRow Head;
			Head.Label = FString::Printf(TEXT("Ask your PC to read %s?"), *Name);
			Head.Detail = GAdd.PickHint;
			Head.Tone = 2;
			Out.Add(Head);
			Out.Add(Note(TEXT("You confirm it there: on your PC open Headsets and press CONFIRM. Your PC then starts an agent that reads this folder and draws it on the table.")));
			Out.Add(Note(TEXT("It takes a few minutes and spends from your account.")));
			Out.Add(Note(TEXT("The agent is told to write only its map into the folder (.ai/lens-scan, .claude/lens-scan, a .gitignore line) and to commit nothing.")));
			FBpConsoleRow Act;
			Act.Label = GAdd.bSending ? TEXT("Asking your PC") : TEXT("Ask, or go back to the list");
			Act.Buttons = { { GAdd.bSending ? TEXT("ASKING") : TEXT("ASK"), GAdd.bSending ? FString() : FString(TEXT("add:ask")), true }, { TEXT("CANCEL"), TEXT("add:cancel"), false } };
			Out.Add(Act);
			return true;
		}
		if (GAdd.State == TEXT("waiting"))
		{
			Sub = TEXT("ADD A PROJECT · ASKED YOUR PC · you can do something else meanwhile");
			const double Left = AskTtlS - (FPlatformTime::Seconds() - GAdd.AskedAt);
			FBpConsoleRow Head;
			Head.Label = TEXT("Waiting for your click on your PC · Headsets · CONFIRM");
			Head.Detail = FString::Printf(TEXT("%s · %s left"), *Name, *Clock(Left));
			Head.Tag = TEXT("WAITING");
			Head.Tone = 2;
			Out.Add(Head);
			Out.Add(Note(TEXT("The bar and your wrist say it while you do something else. CANCEL only stops waiting here; the ask lapses by itself.")));
			FBpConsoleRow Act;
			Act.Label = Name;
			Act.Buttons = { { TEXT("CANCEL"), TEXT("add:cancel"), false } };
			Out.Add(Act);
			return true;
		}
		// Answered: declined (its reason, amber), expired or gone ("did not answer in time"), refused (the server's sentence).
		Sub = TEXT("ADD A PROJECT · YOUR PC ANSWERED");
		FBpConsoleRow Head;
		Head.Label = GAdd.Words;
		Head.Detail = Name;
		Head.Tone = GAdd.State == TEXT("refused") ? 3 : 2;
		Out.Add(Head);
		FBpConsoleRow Act;
		Act.Label = TEXT("Ask again, or go back to the list");
		Act.Buttons = { { TEXT("ASK AGAIN"), TEXT("add:again"), true }, { TEXT("THE LIST"), TEXT("add:cancel"), false } };
		Out.Add(Act);
		return true;
	}
	static void AddStopPoll()
	{
		if (GAdd.Poll.IsValid()) FTSTicker::GetCoreTicker().RemoveTicker(GAdd.Poll);
		GAdd.Poll.Reset();
	}
	/** What became of the ask, from one answer of GET /api/onboarding/requests/<request> (or the ask's own refusal). */
	static void AddAnswered(ABpPawn& Pawn, const FBpLinkModule::FOnboardAsk& Ask)
	{
		const FString Was = GAdd.State;
		if (Ask.Status == 200 && Ask.State == TEXT("waiting")) { GAdd.State = TEXT("waiting"); }
		else if (Ask.Status == 200 && Ask.State == TEXT("confirmed") && !Ask.Slug.IsEmpty())
		{
			AddStopPoll();
			GAdd.State = TEXT("confirmed");
			GAdd.Slug = Ask.Slug;
			GAdd.Words = FString::Printf(TEXT("Your PC is reading %s. Its plan draws on the table as it goes."), *GAdd.PickName);
			UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: confirmed on the PC: %s, job %s; the table switches to it"), *Ask.Slug, *Ask.Job);
			if (ABpTable* T = Pawn.WristTable.Get()) T->StandupSay(FString::Printf(TEXT("Your PC confirmed it.\nReading %s now."), *GAdd.PickName));
			const FString Slug = Ask.Slug;
			GAdd.PickId.Reset();
			GAdd.Request.Reset();
			GAdd.bRead = false;
			FBpLinkModule::Get().SetProduct(Slug);
		}
		else if (Ask.Status == 200 && Ask.State == TEXT("declined"))
		{
			AddStopPoll();
			GAdd.State = TEXT("declined");
			GAdd.Words = Ask.Reason.IsEmpty() ? FString(TEXT("Your PC declined it.")) : FString::Printf(TEXT("Your PC declined it: %s."), *Ask.Reason.TrimChar(TEXT('.')));
		}
		else if ((Ask.Status == 200 && Ask.State == TEXT("expired")) || Ask.Status == 404)
		{
			AddStopPoll();
			GAdd.State = TEXT("expired");
			GAdd.Words = TEXT("Your PC did not answer in time.");
		}
		// Anything else (no answer this time): keep waiting; the ask's own clock still ends it.
		if (GAdd.State == TEXT("waiting") && FPlatformTime::Seconds() - GAdd.AskedAt > AskTtlS + 10.0)
		{
			AddStopPoll();
			GAdd.State = TEXT("expired");
			GAdd.Words = TEXT("Your PC did not answer in time.");
		}
		if (GAdd.State != Was) UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: the ask is %s%s"), *GAdd.State, GAdd.Words.IsEmpty() ? TEXT("") : *(TEXT(": ") + GAdd.Words));
		Pawn.RefreshConsole();
		Pawn.DrawWrist();
	}
	static void AddStartPoll(ABpPawn& Pawn)
	{
		AddStopPoll();
		TWeakObjectPtr<ABpPawn> Self(&Pawn);
		GAdd.Poll = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Self](float)
		{
			ABpPawn* P = Self.Get();
			if (!P || GAdd.State != TEXT("waiting") || GAdd.Request.IsEmpty()) { GAdd.Poll.Reset(); return false; }
			// The headset taken off or the app in the background: no poll (the next one when focus is back).
			if (FApp::UseVRFocus() && !FApp::HasVRFocus()) return true;
			++GAdd.Polls;
			const FString Request = GAdd.Request;
			FBpLinkModule::Get().GetOnboardAsk(Request, [Self, Request](const FBpLinkModule::FOnboardAsk& Ask)
			{
				ABpPawn* Q = Self.Get();
				if (!Q || GAdd.Request != Request) return;
				AddAnswered(*Q, Ask);
			});
			return true;
		}), AskPollS);
	}
	static bool ProjectsTap(ABpPawn& Pawn, const FString& Act)
	{
		if (!Act.StartsWith(TEXT("add:"))) return false;
		FBpLinkModule& Link = FBpLinkModule::Get();
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: %s"), *Act);
		if (Act == TEXT("add:read")) { AddRead(Pawn); return true; }
		if (Act.StartsWith(TEXT("add:pick:")))
		{
			const FString Id = Act.Mid(9);
			const FBpLinkModule::FOnboardCandidate* C = GAdd.Candidates.FindByPredicate([&Id](const FBpLinkModule::FOnboardCandidate& Each) { return Each.Id == Id; });
			if (!C) return true;
			GAdd.PickId = C->Id;
			GAdd.PickName = C->Name;
			GAdd.PickHint = C->Hint;
			GAdd.State.Reset();
			GAdd.Words.Reset();
			GAdd.Request.Reset();
			Pawn.ConsolePageAt = 0;
			return true;
		}
		if (Act == TEXT("add:cancel"))
		{
			// CANCEL stops waiting here only (the ask lapses on the PC by itself).
			AddStopPoll();
			const bool bWasWaiting = GAdd.State == TEXT("waiting");
			GAdd.PickId.Reset();
			GAdd.Request.Reset();
			GAdd.State.Reset();
			GAdd.Words = bWasWaiting ? FString(TEXT("Stopped waiting. The ask lapses on your PC by itself.")) : FString();
			Pawn.ConsolePageAt = 0;
			AddRead(Pawn);
			return true;
		}
		if (Act == TEXT("add:again"))
		{
			GAdd.State.Reset();
			GAdd.Words.Reset();
			GAdd.Request.Reset();
		}
		if ((Act == TEXT("add:ask") || Act == TEXT("add:again")) && !GAdd.PickId.IsEmpty() && !GAdd.bSending)
		{
			// `shown`: the name and hint as displayed, and the terms' sentence.
			const FString Shown = FString::Printf(TEXT("%s\n%s\n%s"), *GAdd.PickName, *GAdd.PickHint, *AddTerms(GAdd.PickName));
			GAdd.bSending = true;
			TWeakObjectPtr<ABpPawn> Self(&Pawn);
			const FString Name = GAdd.PickName;
			Link.AskOnboard(GAdd.PickId, Shown, [Self, Name](const FBpLinkModule::FOnboardAsk& Ask)
			{
				GAdd.bSending = false;
				ABpPawn* P = Self.Get();
				if (!P) return;
				if (Ask.Status == 202 && !Ask.Request.IsEmpty())
				{
					GAdd.Request = Ask.Request;
					GAdd.AskedAt = FPlatformTime::Seconds();
					GAdd.State = TEXT("waiting");
					GAdd.Polls = 0;
					UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: asked your PC to read %s (request %s); waiting for CONFIRM on its Headsets page"), *Name, *Ask.Request);
					if (ABpTable* T = P->WristTable.Get()) T->StandupSay(TEXT("Asked your PC.\nConfirm it there: Headsets, CONFIRM."));
					AddStartPoll(*P);
				}
				else if (Ask.Status == 409 && !Ask.Slug.IsEmpty())
				{
					// Already being read: watch that one.
					UE_LOG(LogBpTable, Log, TEXT("BpConsole: add a project: %s is already being read (%s): watching it"), *Name, *Ask.Slug);
					GAdd.PickId.Reset();
					GAdd.State.Reset();
					GAdd.Words = FString::Printf(TEXT("%s is being read already: watching it."), *Name);
					GAdd.bRead = false;
					if (FBpLinkModule::Get().GetProductSlug() != Ask.Slug) FBpLinkModule::Get().SetProduct(Ask.Slug);
				}
				else
				{
					// 403 (a held folder), 404 (the list is stale: read again), 429 (the bound), 400: the server's sentence.
					GAdd.State = TEXT("refused");
					GAdd.Words = !Ask.Error.IsEmpty() ? Ask.Error : FBpLinkModule::AnswerWords(Ask.Status, FString());
					if (Ask.Status == 429 && Ask.RetryAfterS > 0) GAdd.Words += FString::Printf(TEXT(" Try again in %d minutes."), FMath::Max(1, Ask.RetryAfterS / 60));
					if (Ask.Status == 404) { GAdd.PickId.Reset(); GAdd.State.Reset(); GAdd.bRead = false; AddRead(*P); }
				}
				P->RefreshConsole();
				P->DrawWrist();
			});
			return true;
		}
		return true;
	}
	static FString ProjectsSummary(ABpPawn&)
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const int32 N = Link.GetOnboarding().Products.Num();
		return N > 0 ? FString::Printf(TEXT("%d projects · %s open"), N, *Link.NameOf(Link.GetProductSlug())) : FString::Printf(TEXT("%s open"), *Link.NameOf(Link.GetProductSlug()));
	}

	// PACKAGES: the latest wave's packages (the wrist's PACKAGES tab), each with its findings and how much of it is built.
	static void PackagesRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		TArray<ABpPawn::FPackageRow> Rows;
		bool bDraft = false;
		FString Key;
		const FBpWave* Wave = Pawn.PackagesState(Rows, bDraft, Key);
		Sub = Wave ? FString::Printf(TEXT("%s · %s"), *Wave->name, *Wave->status) : FString(TEXT("No wave yet"));
		if (Rows.Num() == 0)
		{
			FBpConsoleRow Empty;
			Empty.Tone = 6;
			Empty.Label = TEXT("No packages yet");
			Empty.Detail = TEXT("A draft starts when you approve a decision. The stand-up brings this morning's.");
			Empty.Tag = TEXT("0");
			Empty.Buttons = { { TEXT("START THE STAND-UP"), TEXT("open:standup"), true } };
			Out.Add(Empty);
			return;
		}
		for (const ABpPawn::FPackageRow& R : Rows)
		{
			FBpConsoleRow Row;
			Row.Label = R.Name;
			Row.Detail = R.Tiers.IsEmpty() ? R.Meta : FString::Printf(TEXT("%s · %s"), *R.Meta, *R.Tiers);
			Row.Tag = bDraft ? FString(TEXT("DRAFT")) : FString::Printf(TEXT("%d%% BUILT"), FMath::RoundToInt(R.Fraction * 100.f));
			Row.Tone = bDraft ? 0 : R.Fraction >= 1.f ? 1 : 2;
			Out.Add(Row);
		}
	}
	static FString PackagesSummary(ABpPawn& Pawn)
	{
		TArray<ABpPawn::FPackageRow> Rows;
		bool bDraft = false;
		FString Key;
		const FBpWave* Wave = Pawn.PackagesState(Rows, bDraft, Key);
		return Wave ? FString::Printf(TEXT("%d packages · %s"), Rows.Num(), *Wave->status) : FString(TEXT("No draft yet"));
	}

	// SETTINGS: both levels, the table's seat and tour, the wrist, motion; the PC link's state on the sub-line.
	static FString LinkLine()
	{
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FBpLinkStatus& S = Link.GetLinkStatus();
		if (S.Route == EBpLinkRoute::None) return FString::Printf(TEXT("PC link: %s · nothing is sent"), *FBpLinkModule::RouteWords(S));
		return FString::Printf(TEXT("PC link: %s · %s"), *FBpLinkModule::RouteWords(S), S.Pair == EBpPairState::Paired ? TEXT("paired: scans, decisions and the stand-up reach your PC") : TEXT("not paired: PC LINK pairs it"));
	}
	static void SettingsRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		Sub = LinkLine();
		{
			// The PC link's own page, from settings.
			const FBpLinkStatus& S = FBpLinkModule::Get().GetLinkStatus();
			FBpConsoleRow Row;
			Row.Act = TEXT("open:link");
			Row.Label = TEXT("PC LINK");
			Row.Detail = FString::Printf(TEXT("%s · %s"), *FBpLinkModule::RouteWords(S), S.Pair == EBpPairState::Paired ? TEXT("paired") : S.Pair == EBpPairState::Waiting ? TEXT("a code is waiting") : TEXT("not paired"));
			Row.Tag = FBpLinkModule::RouteWord(S);
			Row.Tone = S.Route != EBpLinkRoute::None ? 0 : 2;
			Out.Add(Row);
		}
		{
			// The accessibility group (night two V4), on the first page: its own sheet holds motion, text size, captions, hand.
			FBpConsoleRow Row;
			Row.Act = TEXT("open:access");
			Row.Label = TEXT("ACCESSIBILITY");
			Row.Detail = AccessSummary(Pawn);
			Out.Add(Row);
		}
		const auto Value =[&Out](const TCHAR* Label, const TCHAR* Detail, float Level, const TCHAR* Minus, const TCHAR* Plus)
		{
			FBpConsoleRow Row;
			Row.Label = Label;
			Row.Detail = Detail;
			Row.Tag = Percent(Level);
			Row.Tone = Level <= 0.f ? 2 : 0;
			Row.Buttons = { { TEXT("−"), Minus }, { TEXT("+"), Plus } };
			Out.Add(Row);
		};
		Value(TEXT("VOICE"), TEXT("Glim's voice"), BpAudio::VoiceLevel(), TEXT("voice:minus"), TEXT("voice:plus"));
		Value(TEXT("MUSIC"), BpAudio::MusicLevel() > 0.f ? TEXT("The background music") : TEXT("Off: no stream"), BpAudio::MusicLevel(), TEXT("music:minus"), TEXT("music:plus"));
		{
			// Wave N3-W3: what Glim says unasked (bp.Narration, saved): every step, the tour only, or nothing.
			const int32 Mode = BpAudio::Narration();
			FBpConsoleRow Row;
			Row.Label = TEXT("NARRATION");
			Row.Detail = Mode == BpAudio::NarrationAll ? TEXT("Glim says a line for every step") : Mode == BpAudio::NarrationTourOnly ? TEXT("Glim speaks on the tour only") : TEXT("Off: captions only");
			Row.Buttons = { { TEXT("ALL"), TEXT("set:narration:2"), Mode == BpAudio::NarrationAll }, { TEXT("TOUR ONLY"), TEXT("set:narration:1"), Mode == BpAudio::NarrationTourOnly }, { TEXT("OFF"), TEXT("set:narration:0"), Mode == 0 } };
			Out.Add(Row);
		}
		const bool bTour = Plan(Pawn) && Table(Pawn)->IsTourRunning();
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("TABLE");
			Row.Detail = TEXT("To your seat · Glim's tour");
			Row.Buttons = { { TEXT("SEAT"), TEXT("seat") }, { bTour ? TEXT("STOP TOUR") : TEXT("TOUR"), TEXT("tour"), bTour } };
			Out.Add(Row);
		}
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("WRIST");
			Row.Detail = TEXT("How it turns (its hand: ACCESSIBILITY)");
			Row.Buttons = { { CvarInt(TEXT("bp.WristFace")) != 0 ? TEXT("FACES YOU") : TEXT("FIXED"), TEXT("toggle:face") } };
			Out.Add(Row);
		}
		{
			// The controls legend beside the table (BpLegend.cpp, wave Q1).
			const bool bLegend = CvarInt(TEXT("bp.Legend")) != 0;
			FBpConsoleRow Row;
			Row.Label = TEXT("LEGEND");
			Row.Detail = bLegend ? TEXT("What each control does, at the table's right") : TEXT("Off: the controls are in the tour");
			Row.Buttons = { { bLegend ? TEXT("ON") : TEXT("OFF"), TEXT("toggle:legend"), bLegend } };
			Out.Add(Row);
		}
		{
			// Waves PJ1/PJ2, the main screen: the open sheet on the desk (as before), thrown far and large on the wall, or on the
			// light stage (a curved sheet around the seat).
			const int32 Mode = CvarInt(TEXT("bp.Projector"));
			FBpConsoleRow Row;
			Row.Label = TEXT("MAIN SCREEN");
			Row.Detail = Mode == 0 ? TEXT("The sheet opens on the desk, close") : Mode == 1 ? TEXT("The sheet is thrown on the wall, far and large") : TEXT("The sheet stands on a curved stage of light around you");
			// Wave N3-W1: the owner chose the wall (2026-11-10); the stage is parked, reachable by `bp.Projector 2` only.
			Row.Buttons = { { TEXT("DESK"), TEXT("set:screen:0"), Mode == 0 }, { TEXT("WALL"), TEXT("set:screen:1"), Mode == 1 } };
			Out.Add(Row);
		}
		{
			// Your room (BpSurround.cpp, night two W4): the table in the wearer's own room, or the studio; on the bar too.
			const bool bRoom = CvarInt(TEXT("bp.Room")) != 0;
			FBpConsoleRow Row;
			Row.Label = TEXT("ROOM");
			Row.Detail = bRoom ? TEXT("The table stands in your own room") : TEXT("The studio around the table");
			Row.Buttons = { { bRoom ? TEXT("YOUR ROOM") : TEXT("STUDIO"), TEXT("toggle:room") } };
			Out.Add(Row);
		}
		{
			// Talk to the lamp (BpTalk.cpp): ON turns it off in one press; OFF opens the sheet, where ALLOW is the choice.
			const bool bOn = ABpTable::TalkConsent() == 1;
			FBpConsoleRow Row;
			Row.Label = TEXT("TALK");
			Row.Detail = bOn ? TEXT("Your voice goes to your PC and a cloud speech service") : TEXT("Off: nothing is recorded");
			Row.Buttons = { { bOn ? TEXT("ON") : TEXT("OFF"), bOn ? TEXT("talk:off") : TEXT("open:talk"), bOn } };
			Out.Add(Row);
		}
	}
	static FString SettingsSummary(ABpPawn&)
	{
		return FString::Printf(TEXT("Voice %s · music %s"), *Percent(BpAudio::VoiceLevel()), *Percent(BpAudio::MusicLevel()));
	}

	// TOUR (wave T1): the first tour (REPLAY), then a chapter per page that has something to teach, in the MENU's order (this
	// registry's; TALK and ACCESSIBILITY are SETTINGS' rows, so they sort with it), each with its page's letter, about how long,
	// and NEW until seen (finished, or stopped past half way).
	static int32 MenuOrder(const FString& PageKey)
	{
		const TArray<FBpConsolePage>& Pages = Registry();
		int32 At = Pages.IndexOfByPredicate([&PageKey](const FBpConsolePage& P) { return PageKey == P.Key; });
		if (At == INDEX_NONE) At = Pages.IndexOfByPredicate([](const FBpConsolePage& P) { return FCString::Strcmp(P.Key, TEXT("settings")) == 0; });
		return At == INDEX_NONE ? Pages.Num() : At;
	}
	static TArray<const BpTourBook::FChapter*> ChaptersInMenuOrder()
	{
		TArray<const BpTourBook::FChapter*> Out;
		for (const BpTourBook::FChapter& C : BpTourBook::Chapters()) if (Find(C.Page)) Out.Add(&C);
		Out.StableSort([](const BpTourBook::FChapter& A, const BpTourBook::FChapter& B) { return MenuOrder(A.Page) < MenuOrder(B.Page); });
		return Out;
	}
	static void TourRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		ABpTable* T = Table(Pawn);
		const bool bRunning = T && T->IsTourRunning();
		const FString Running = !bRunning ? FString() : T->TourChapterId().IsEmpty() ? FString(TEXT("core")) : T->TourChapterId();
		const TSet<FString> Seen = ABpTable::TourSeen();
		Sub = bRunning ? FString::Printf(TEXT("Running: %s · %s · STOP TOUR ends it"), *T->TourTitle(), *T->TourProgress())
			: FString(TEXT("The first tour, and a short chapter for each part of the menu"));
		{
			FBpConsoleRow Row;
			Row.Label = FString::Printf(TEXT("THE FIRST TOUR · about %d s"), BpTourBook::CoreSeconds);
			Row.Detail = TEXT("Open a room, decide, BACK, MENU, the morning, talk");
			Row.Tone = Running == TEXT("core") ? 1 : 0;
			Row.Buttons = { { Running == TEXT("core") ? TEXT("STOP") : TEXT("REPLAY"), Running == TEXT("core") ? TEXT("tour:stop") : TEXT("tour:core"), true } };
			Out.Add(Row);
		}
		for (const BpTourBook::FChapter* C : ChaptersInMenuOrder())
		{
			const FBpConsolePage* Page = Find(C->Page);
			const bool bHere = Running == C->Id, bSeen = Seen.Contains(C->Id);
			FBpConsoleRow Row;
			Row.Act = bHere ? FString(TEXT("tour:stop")) : FString(TEXT("tour:chapter:")) + C->Id;
			Row.Label = FString::Printf(TEXT("%s  ·  %s"), Page ? Page->Letter : TEXT("?"), C->Title);
			Row.Detail = FString::Printf(TEXT("%s · about %d s"), C->What, C->Seconds);
			Row.Tag = bHere ? FString(TEXT("RUNNING")) : bSeen ? FString() : FString(TEXT("NEW"));
			Row.Tone = bHere ? 1 : bSeen ? 0 : 2;
			Out.Add(Row);
		}
	}
	static FString TourSummary(ABpPawn& Pawn)
	{
		if (Plan(Pawn) && Table(Pawn)->IsTourRunning()) return FString::Printf(TEXT("Running · %s"), *Table(Pawn)->TourTitle());
		const TSet<FString> Seen = ABpTable::TourSeen();
		int32 New = 0;
		for (const BpTourBook::FChapter* C : ChaptersInMenuOrder()) New += Seen.Contains(C->Id) ? 0 : 1;
		return New > 0 ? FString::Printf(TEXT("The first tour · %d new %s"), New, New == 1 ? TEXT("chapter") : TEXT("chapters")) : FString(TEXT("The first tour · every chapter"));
	}
	static bool TourTap(ABpPawn& Pawn, const FString& Act)
	{
		ABpTable* T = Table(Pawn);
		if (!T || !T->HasPlan()) return false;
		if (Act == TEXT("tour:core"))
		{
			// The first tour starts on the table: the MENU goes back to its bar for it.
			Pawn.CloseConsole();
			T->StartTour(FString());
			return true;
		}
		if (Act.StartsWith(TEXT("tour:chapter:")))
		{
			T->StartChapter(Act.Mid(13));
			return true;
		}
		return false;
	}
};

// ---- The widget ----------------------------------------------------------------------------------------------------------

void ABpPawn::MakeConsole()
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	ConsolePanel = NewObject<UWidgetComponent>(this, TEXT("ConsolePanel"));
	ConsolePanel->SetupAttachment(Table->GetRootComponent());
	ConsolePanel->SetWidgetSpace(EWidgetSpace::World);
	ConsolePanel->SetDrawAtDesiredSize(false);
	ConsolePanel->SetPivot(FVector2D(0.5, 0.5));
	// Opaque and unlit (the widget's own material): the sheet is the whole quad, so nothing behind it is drawn twice.
	ConsolePanel->SetBlendMode(EWidgetBlendMode::Opaque);
	ConsolePanel->SetTwoSided(false);
	ConsolePanel->SetBackgroundColor(FLinearColor::Transparent);
	ConsolePanel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ConsolePanel->SetCastShadow(false);
	ConsolePanel->SetWindowFocusable(false);
	ConsolePanel->SetManuallyRedraw(true);
	ConsolePanel->SetTintColorAndOpacity(FLinearColor(0.95f, 0.95f, 0.95f, 1.f));
	ConsolePanel->RegisterComponent();
	// No tick of its own while idle: a change asks for one render (RequestRenderUpdate), after which it stops again.
	ConsolePanel->SetTickMode(ETickMode::Disabled);
	// Wave PJ2: THE LIGHT STAGE's surface, on the table as the panel is (it follows a re-seat with it); hidden until a sheet is
	// on it. Opaque-masked unlit (M_BpStage: the panel's render target, the edge fade in vertex alpha, alpha to coverage); the
	// rim's line additive (M_BpStageRim). No collision, no shadow, no tick.
	ConsoleStage = NewObject<UProceduralMeshComponent>(this, TEXT("ConsoleStage"));
	ConsoleStage->SetupAttachment(Table->GetRootComponent());
	ConsoleStage->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ConsoleStage->SetCastShadow(false);
	ConsoleStage->SetVisibility(false);
	ConsoleStage->RegisterComponent();
	ConsoleStage->SetComponentTickEnabled(false);
	// The slim bar at the desk while the sheet is far (modes 1 and 2): the bar's own small widget, drawn with the panel.
	ConsoleNearBar = NewObject<UWidgetComponent>(this, TEXT("ConsoleNearBar"));
	ConsoleNearBar->SetupAttachment(Table->GetRootComponent());
	ConsoleNearBar->SetWidgetSpace(EWidgetSpace::World);
	ConsoleNearBar->SetDrawAtDesiredSize(false);
	ConsoleNearBar->SetPivot(FVector2D(0.5, 0.5));
	ConsoleNearBar->SetBlendMode(EWidgetBlendMode::Opaque);
	ConsoleNearBar->SetTwoSided(false);
	ConsoleNearBar->SetBackgroundColor(FLinearColor::Transparent);
	ConsoleNearBar->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ConsoleNearBar->SetCastShadow(false);
	ConsoleNearBar->SetWindowFocusable(false);
	ConsoleNearBar->SetManuallyRedraw(true);
	ConsoleNearBar->SetTintColorAndOpacity(FLinearColor(0.95f, 0.95f, 0.95f, 1.f));
	ConsoleNearBar->SetVisibility(false);
	ConsoleNearBar->RegisterComponent();
	ConsoleNearBar->SetTickMode(ETickMode::Disabled);
	ConsolePageKey = TEXT("home");
	PlaceConsole();
}

void ABpPawn::PlaceStage(const FTransform& Pose)
{
	if (!ConsoleStage) return;
	ABpTable* Table = WristTable.Get();
	ConsoleStage->SetRelativeTransform(Pose);
	// The shape, its place on the table and the table's place in the room (a re-seat moves the studio around it).
	const FVector TableAt = Table ? Table->GetActorLocation() : FVector::ZeroVector;
	const FString Key = BpProjector::StageKey() + FString::Printf(TEXT(" %.1f %.1f %.1f | %.0f %.0f %.0f %.1f"), Pose.GetLocation().X, Pose.GetLocation().Y, Pose.GetLocation().Z,
		TableAt.X, TableAt.Y, TableAt.Z, Table ? Table->GetActorRotation().Yaw : 0.0);
	const bool bRebuilt = Key != ConsoleStageMeshKey && Table;
	if (bRebuilt)
	{
		ConsoleStageMeshKey = Key;
		// Built once per shape, never per frame: 2 x Columns quads for the sheet, 32 for the rim.
		BpStage::BuildSheet(ConsoleStage, 0, BpProjector::StageShape());
		// The rim's line: the table's far edge, at its top, in the stage's own space (the frame's rim, 1 cm in from its edge).
		const FVector Eye = Table->ConsoleEyeLocal();
		const double TopZ = Eye.Z - ABpGameMode::TargetEyeAboveTopCm + 0.4;
		const double FarX = ABpTable::TableDepthCm * 0.5 - 1.5;
		BpStage::FRimLine Rim;
		Rim.Start = Pose.InverseTransformPositionNoScale(FVector(FarX, -ABpTable::TableWidthCm * 0.5 + 4.0, TopZ));
		Rim.End = Pose.InverseTransformPositionNoScale(FVector(FarX, ABpTable::TableWidthCm * 0.5 - 4.0, TopZ));
		Rim.Seat = FVector::ZeroVector;
		Rim.WidthCm = 1.2;
		Rim.TiltDeg = 35.0;
		Rim.EndFadeCm = 25.0;
		BpStage::BuildRimLine(ConsoleStage, 1, Rim);
		if (!ConsoleStageMat)
		{
			UMaterialInterface* Master = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Bp/Materials/M_BpStage.M_BpStage"));
			if (!Master)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpStage: M_BpStage is missing (apps/vr/tools/mcp-steps/py/pj2_stage.py makes it); the widget's opaque material stands in, no edge fade"));
				Master = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineMaterials/Widget3DPassThrough_Opaque.Widget3DPassThrough_Opaque"));
			}
			ConsoleStageMat = Master ? UMaterialInstanceDynamic::Create(Master, this) : nullptr;
			if (UMaterialInterface* RimMat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Bp/Materials/M_BpStageRim.M_BpStageRim"))) ConsoleStage->SetMaterial(1, RimMat);
		}
		if (ConsoleStageMat) ConsoleStage->SetMaterial(0, ConsoleStageMat);
		const BpStage::FShape& S = BpProjector::StageShape();
		const FBox2D Sheet = BpProjector::StageSheetUv();
		const double EyeH = 72.0 + ABpGameMode::TargetEyeAboveTopCm;
		const FVector2D Whole = BpStage::AngularSizeDeg(S, FVector2D(0.0, 0.0), FVector2D(1.0, 1.0), EyeH);
		const FVector2D Centre = BpStage::AngularSizeDeg(S, Sheet.Min, Sheet.Max, EyeH);
		UE_LOG(LogBpTable, Log, TEXT("BpStage: built: radius %.0f cm, arc %.0f deg, %.0f to %.0f cm (top fade %.0f), %d columns: %.1f x %.1f deg from the eye; centre zone %.1f x %.1f deg (u %.3f to %.3f, v %.3f to %.3f); %d + %d triangles"),
			S.RadiusCm, S.ArcDeg, S.BottomCm, S.TopCm, S.TopFadeCm, S.Columns, Whole.X, Whole.Y, Centre.X, Centre.Y, Sheet.Min.X, Sheet.Max.X, Sheet.Min.Y, Sheet.Max.Y,
			ConsoleStage->GetProcMeshSection(0) ? ConsoleStage->GetProcMeshSection(0)->ProcIndexBuffer.Num() / 3 : 0, ConsoleStage->GetProcMeshSection(1) ? ConsoleStage->GetProcMeshSection(1)->ProcIndexBuffer.Num() / 3 : 0);
	}
	const bool bShowNow = !ConsoleStage->IsVisible();
	if (bShowNow) ConsoleStage->SetVisibility(true);
	// The studio around it is judged again when it appears or moves (a re-seat), never per frame.
	if (bShowNow || bRebuilt) StageCull(true);
}

void ABpPawn::StageCull(bool bOn)
{
	for (const TWeakObjectPtr<UPrimitiveComponent>& Each : StageHidden)
	{
		if (UPrimitiveComponent* Prim = Each.Get()) Prim->SetHiddenInGame(false);
	}
	const int32 Shown = StageHidden.Num();
	StageHidden.Reset();
	ABpTable* Table = WristTable.Get();
	UWorld* World = GetWorld();
	if (!bOn || !Table || !World || !ConsoleStage)
	{
		if (Shown > 0) UE_LOG(LogBpTable, Log, TEXT("BpStage: %d studio primitives shown again"), Shown);
		return;
	}
	// What stays whatever the stage does: the table and what it owns, the pawn, the lamp's group (Glim), the posed hands.
	TSet<const AActor*> Keep;
	{
		TArray<AActor*> Lamp;
		Table->LampActors(Lamp);
		for (const AActor* Each : Lamp) Keep.Add(Each);
	}
	const auto Stays = [&Keep](const AActor* Actor)
	{
		for (int32 Depth = 0; Actor && Depth < 8; ++Depth)
		{
			for (const AActor* Each = Actor; Each; Each = Each->GetAttachParentActor())
			{
				if (Keep.Contains(Each) || Each->IsA<APawn>() || Each->IsA<ABpTable>() || Each->ActorHasTag(ABpPawn::CaptureHandsTag) || Each->ActorHasTag(ABpPawn::CaptureWristTag)) return true;
			}
			Actor = Actor->GetOwner();
		}
		return false;
	};
	const BpStage::FShape& S = BpProjector::StageShape();
	const double EyeH = 72.0 + ABpGameMode::TargetEyeAboveTopCm;
	const double Opaque = 0.5 * S.ArcDeg - S.EdgeFadeDeg;
	const double FootDeg = FMath::RadiansToDegrees(FMath::Atan2(S.BottomCm - EyeH, S.RadiusCm));
	const double TopDeg = FMath::RadiansToDegrees(FMath::Atan2(S.TopCm - S.TopFadeCm - EyeH, S.RadiusCm));
	const FTransform& Pose = ConsoleStage->GetComponentTransform();
	int32 Behind = 0, Front = 0;
	FString Names;
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		if (Stays(*It)) continue;
		TArray<UPrimitiveComponent*> Prims;
		It->GetComponents(Prims);
		for (UPrimitiveComponent* Prim : Prims)
		{
			if (!Prim || !Prim->IsVisible() || Prim->bHiddenInGame || !Prim->IsRegistered()) continue;
			const FBox Box = Prim->Bounds.GetBox();
			if (!Box.IsValid || Box.GetExtent().GetMax() > 400.0) continue; // floors, walls, sky: not a prop
			FVector Corners[8];
			Box.GetVertices(Corners);
			bool bAllIn = true, bAllFar = true, bAllNear = true;
			double NearFlat = TNumericLimits<double>::Max(), LowElev = 90.0, HighElev = -90.0;
			for (const FVector& Corner : Corners)
			{
				const FVector L = Pose.InverseTransformPositionNoScale(Corner);
				const double Flat = FVector2D(L.X, L.Y).Size();
				const double Yaw = FMath::RadiansToDegrees(FMath::Atan2(L.Y, L.X));
				const double Elev = FMath::RadiansToDegrees(FMath::Atan2(L.Z - EyeH, FMath::Max(1.0, Flat)));
				bAllIn &= FMath::Abs(Yaw) <= Opaque && Elev >= FootDeg && Elev <= TopDeg;
				bAllFar &= Flat > S.RadiusCm;
				bAllNear &= Flat < S.RadiusCm;
				NearFlat = FMath::Min(NearFlat, Flat);
				LowElev = FMath::Min(LowElev, Elev);
				HighElev = FMath::Max(HighElev, Elev);
			}
			// In front of the stage: between the table's far rim and the stage (wholly beyond the rim, wholly nearer than the
			// stage: what stands on the table stays), its centre's bearing inside the arc and its height overlapping the stage's
			// (a pendant shade and its cord, a pen pot on a studio desk after a re-seat).
			const FVector C = Pose.InverseTransformPositionNoScale(Box.GetCenter());
			const double CYaw = FMath::RadiansToDegrees(FMath::Atan2(C.Y, C.X));
			const double RimFlat = ABpTable::TableDepthCm * 0.5 + ABpTable::TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm + 5.0;
			// "Nearer" is any part of it (a pendant hanging across the stage's radius, StudioPendant2, still covered the right flank).
			const bool bFront = NearFlat < S.RadiusCm && NearFlat > RimFlat && FMath::Abs(CYaw) <= 0.5 * S.ArcDeg && HighElev >= FootDeg && LowElev <= TopDeg;
			const bool bBehind = bAllFar && bAllIn;
			if (!bFront && !bBehind) continue;
			Prim->SetHiddenInGame(true);
			StageHidden.Add(Prim);
			(bFront ? Front : Behind) += 1;
			if (Names.Len() < 400) Names += FString::Printf(TEXT("%s%s.%s"), Names.IsEmpty() ? TEXT("") : TEXT(", "), *It->GetActorNameOrLabel(), *Prim->GetName());
		}
	}
	UE_LOG(LogBpTable, Log, TEXT("BpStage: hid %d studio primitives it covers and %d standing in front of it: %s"), Behind, Front, *Names);
}

void ABpPawn::PlaceNearBar(bool bShow)
{
	ABpTable* Table = WristTable.Get();
	if (!ConsoleNearBar || !Table) return;
	if (!bShow)
	{
		if (ConsoleNearBar->IsVisible()) ConsoleNearBar->SetVisibility(false);
		NearBarBoxes.Reset();
		return;
	}
	// Where the bar stands when nothing is open (PlaceConsole's desk branch): the slot's top edge, or under the deck in room mode.
	const float S = BpSheet::TextScale();
	const bool bRoom = !Table->GetRoomModeId().IsEmpty();
	const FVector2D Draw(FMath::RoundToInt(ConsoleWidthCm * ConsolePxPerCm), FMath::RoundToInt(ConsoleBarHeightCm * ConsolePxPerCm));
	if (ConsoleNearBar->GetDrawSize() != Draw) ConsoleNearBar->SetDrawSize(Draw);
	const FTransform Slot = Table->ConsoleSlotPose();
	const FVector Up = Slot.GetRotation().GetUpVector();
	FVector At = Slot.GetLocation() + (bRoom ? -Up * (ABpTable::DeckHeightCm * 0.5f + ConsoleBarGapCm + ConsoleBarHeightCm * S * 0.5f) : Up * (ABpTable::DeckHeightCm * 0.5f - ConsoleBarHeightCm * S * 0.5f));
	const FVector Eye = Table->ConsoleEyeLocal();
	// At the slot's top edge it stood in front of the far sheet from the seat (cap/pj2-s-su1-far.png): while a sheet is far it
	// comes down to NearBarDropDeg below the eye's horizon at the same distance and bearing, under the far sheet's foot (the
	// stage's -13 degrees, the wall's -11) and still over the table.
	{
		constexpr double NearBarDropDeg = 25.0;
		const FVector To = At - Eye;
		const double Dist = To.Size();
		const FVector Flat = FVector(To.X, To.Y, 0.0).GetSafeNormal();
		const double Drop = FMath::DegreesToRadians(NearBarDropDeg);
		At = Eye + (Flat * FMath::Cos(Drop) - FVector::UpVector * FMath::Sin(Drop)) * Dist;
	}
	ConsoleNearBar->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(S / ConsolePxPerCm)));
	if (!ConsoleNearBar->IsVisible())
	{
		ConsoleNearBar->SetVisibility(true);
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: the near bar stays at the desk while the sheet is far (%.0f cm from the eye)"), FVector::Dist(Eye, At));
	}
}

bool ABpPawn::NearBarHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (!ConsoleNearBar || !ConsoleNearBar->IsVisible() || NearBarBoxes.Num() == 0) return false;
	const FTransform& T = ConsoleNearBar->GetComponentTransform();
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (Denom >= -KINDA_SMALL_NUMBER) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const FVector2D Draw = ConsoleNearBar->GetDrawSize();
	const float ToLayout = ConsoleLayoutPxPerCm / ConsolePxPerCm;
	const FVector2f Px(static_cast<float>((-Local.Y + Draw.X * 0.5) * ToLayout), static_cast<float>((-Local.Z + Draw.Y * 0.5) * ToLayout));
	if (Px.X < 0.f || Px.Y < 0.f || Px.X > LW || Px.Y > BarLH) return false;
	for (int32 Index = NearBarBoxes.Num() - 1; Index >= 0; --Index)
	{
		if (NearBarBoxes[Index].Box.IsInside(Px)) { OutId = NearBarBoxes[Index].Id; return true; }
	}
	OutId = TEXT("console:panel");
	return true;
}

void ABpPawn::PlaceConsole()
{
	ABpTable* Table = WristTable.Get();
	if (!ConsolePanel || !Table) return;
	const bool bRoom = !Table->GetRoomModeId().IsEmpty();
	// The panel: a page open, or the conversation with the lamp (night two V2) filling it.
	const bool bPanel = bConsoleOpen || bConsoleTalk;
	// SETTINGS › ACCESSIBILITY's TEXT SIZE (night two V4): the console scaled as a whole (its layout holds by construction); the
	// panel keeps its foot where it was and grows upward, the bar keeps its edge on the slot's.
	const float S = BpSheet::TextScale();
	ConsoleScaleShown = S;
	ConsoleProjShown = BpProjector::Mode();
	// Wave PJ1, the projector: an open sheet goes to the far surface (bp.Projector 1: THE THROW), at the size and distance the
	// surface gives it, drawn at about 36 px a degree; the bar stays the desk's.
	if (bPanel && BpProjector::IsOn())
	{
		const bool bPassthrough = CvarInt(TEXT("bp.Room")) != 0;
		const FVector Eye = Table->ConsoleEyeLocal();
		const IBpFarSurface& Surface = BpProjector::Surface();
		FVector Centre;
		FRotator Facing;
		FVector2D SizeCm;
		Surface.Place(Eye, Table->ConsoleSlotPose().GetLocation() - Eye, bPassthrough, Centre, Facing, SizeCm);
		if (BpProjector::IsStage())
		{
			// Wave PJ2, THE LIGHT STAGE: the panel draws the whole stage (the sheet in its centre zone, the flanks) into one render
			// target of at most 4096 x 1024, and is not drawn itself: the stage's curved mesh shows that target. The panel's pose
			// is the stage's (the eye's ground point, facing the table's forward), so the ray and Glim's aim go through it.
			const FVector2D StageLayout = BpProjector::StageLayoutSize(LW);
			const FIntPoint Px = BpProjector::StageDrawSize(StageLayout);
			const FVector2D Draw(Px.X, Px.Y);
			if (ConsolePanel->GetDrawSize() != Draw) ConsolePanel->SetDrawSize(Draw);
			ConsoleLayout = FVector2f(LW, LH);
			ConsoleStageLayout = FVector2f(static_cast<float>(StageLayout.X), static_cast<float>(StageLayout.Y));
			ConsoleDrawPerLayout = static_cast<float>(Px.X / StageLayout.X);
			ConsoleFarSizeCm = SizeCm;
			bConsoleFar = true;
			bConsoleStage = true;
			const FTransform Pose(Facing, Centre);
			ConsolePanel->SetRelativeTransform(Pose);
			// Still "visible" (a hidden widget component never redraws), but in no pass: only its render target is used.
			ConsolePanel->SetRenderInMainPass(false);
			ConsolePanel->SetRenderInDepthPass(false);
			ConsolePanel->SetTickWhenOffscreen(true);
			PlaceStage(Pose);
			Table->SetDeckHeld(false);
			const FVector SheetMid = BpProjector::Surface().UvToWorld(Pose, SizeCm, FVector2D(0.5, 0.5));
			BpProjector::SetFar(true, SheetMid);
			BpProjector::SetFarCentre(SheetMid);
			// Wave N3-W2: the beam is the wall's only (the stage is parked).
			BpProjector::SetFarSheet(FTransform::Identity, FVector2D::ZeroVector);
			const float Dist = BpProjector::StageShape().RadiusCm;
			const FString FarKey = FString::Printf(TEXT("stage %.0f %.0f %d %dx%d"), SizeCm.X, Dist, bPassthrough, Px.X, Px.Y);
			if (FarKey != ConsolePlaceKey)
			{
				ConsolePlaceKey = FarKey;
				const float PxPerDeg = Px.X / static_cast<float>(BpProjector::StageShape().ArcDeg);
				UE_LOG(LogBpTable, Log, TEXT("BpProjector: the sheet on the stage (THE LIGHT STAGE): %.0f x %.0f cm on a %.0f cm radius (%.1f deg wide), stage drawn %dx%d (%.1f px a degree, %.1f MB), the stage %.0f x %.0f layout px%s"),
					SizeCm.X, SizeCm.Y, Dist, FMath::RadiansToDegrees(SizeCm.X / Dist), Px.X, Px.Y, PxPerDeg, Px.X * Px.Y * 4.f / (1024.f * 1024.f), StageLayout.X, StageLayout.Y,
					bPassthrough ? TEXT("; your room: brought in, no wall known") : TEXT(""));
			}
			PlaceNearBar(true);
			return;
		}
		bConsoleStage = false;
		if (ConsoleStage && ConsoleStage->IsVisible()) { ConsoleStage->SetVisibility(false); StageCull(false); }
		ConsolePanel->SetRenderInMainPass(true);
		ConsolePanel->SetRenderInDepthPass(true);
		const float Dist = FVector::Dist(Eye, Centre);
		const FIntPoint Px = BpProjector::DrawSizeFor(SizeCm, Dist);
		const FVector2D Draw(Px.X, Px.Y);
		if (ConsolePanel->GetDrawSize() != Draw) ConsolePanel->SetDrawSize(Draw);
		ConsoleLayout = FVector2f(LW, LH);
		ConsoleDrawPerLayout = Px.X / LW;
		ConsoleFarSizeCm = SizeCm;
		bConsoleFar = true;
		ConsolePanel->SetRelativeTransform(FTransform(Facing, Centre, FVector(SizeCm.X / Px.X)));
		// Wave N3-W4: a room's deck on the wall gives the console its place there while the console is open.
		Table->SetDeckHeld(Table->IsDeckOnWall());
		BpProjector::SetFar(true, Centre);
		BpProjector::SetFarCentre(Centre);
		// Wave N3-W2: the wall's rectangle for Glim's beam (table space, unscaled).
		BpProjector::SetFarSheet(FTransform(Facing, Centre), SizeCm);
		const FString FarKey = FString::Printf(TEXT("far %s %.0f %.0f %d"), Surface.Name(), SizeCm.X, Dist, bPassthrough);
		if (FarKey != ConsolePlaceKey)
		{
			ConsolePlaceKey = FarKey;
			UE_LOG(LogBpTable, Log, TEXT("BpProjector: the sheet on the %s (%s): %.0f x %.0f cm, %.0f cm from the eye (%.1f x %.1f deg), centre %.0f cm above the eye, drawn %dx%d (%.1f px a degree)%s"),
				Surface.Name(), TEXT("THE THROW"), SizeCm.X, SizeCm.Y, Dist,
				2.f * FMath::RadiansToDegrees(FMath::Atan2(SizeCm.X * 0.5f, Dist)), 2.f * FMath::RadiansToDegrees(FMath::Atan2(SizeCm.Y * 0.5f, Dist)), Centre.Z - Eye.Z, Px.X, Px.Y,
				Px.X / (2.f * FMath::RadiansToDegrees(FMath::Atan2(SizeCm.X * 0.5f, Dist))), bPassthrough ? TEXT("; your room: brought nearer, no wall known") : TEXT(""));
		}
		PlaceNearBar(true);
		return;
	}
	bConsoleFar = false;
	bConsoleStage = false;
	if (ConsoleStage && ConsoleStage->IsVisible()) { ConsoleStage->SetVisibility(false); StageCull(false); }
	ConsolePanel->SetRenderInMainPass(true);
	ConsolePanel->SetRenderInDepthPass(true);
	PlaceNearBar(false);
	BpProjector::SetFar(false, FVector::ZeroVector);
	ConsoleDrawPerLayout = ConsolePxPerCm / ConsoleLayoutPxPerCm;
	const FString Key = FString::Printf(TEXT("%d%d%d %.2f"), bConsoleOpen, bConsoleTalk, bRoom, S);
	// The draw size follows what it shows (the bar's or the panel's), at ConsolePxPerCm.
	const float HeightCm = bPanel ? ConsoleHeightCm : ConsoleBarHeightCm;
	const FVector2D Draw(FMath::RoundToInt(ConsoleWidthCm * ConsolePxPerCm), FMath::RoundToInt(HeightCm * ConsolePxPerCm));
	if (ConsolePanel->GetDrawSize() != Draw) ConsolePanel->SetDrawSize(Draw);
	ConsoleLayout = FVector2f(LW, bPanel ? LH : BarLH);
	const FTransform Slot = Table->ConsoleSlotPose();
	const FVector Up = Slot.GetRotation().GetUpVector();
	FVector At = Slot.GetLocation();
	if (!bPanel)
	{
		// The site plan: along the slot's top edge, the plan below it clear. Room mode: under the deck, clear of its screens.
		At += bRoom ? -Up * (ABpTable::DeckHeightCm * 0.5f + ConsoleBarGapCm + ConsoleBarHeightCm * S * 0.5f) : Up * (ABpTable::DeckHeightCm * 0.5f - ConsoleBarHeightCm * S * 0.5f);
	}
	else
	{
		At += Up * (ConsoleHeightCm * (S - 1.f) * 0.5f);
	}
	const FVector Eye = Table->ConsoleEyeLocal();
	ConsolePanel->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(S / ConsolePxPerCm)));
	// The deck gives the slot to the open console in room mode, and has it back when it closes.
	Table->SetDeckHeld(bPanel && bRoom);
	if (Key != ConsolePlaceKey)
	{
		ConsolePlaceKey = Key;
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: %s %s (%.0f x %.1f cm, %.0f cm from the eye)"), bConsoleTalk && !bConsoleOpen ? TEXT("conversation") : bPanel ? TEXT("panel") : TEXT("bar"),
			bPanel ? TEXT("in the deck's slot") : bRoom ? TEXT("under the deck") : TEXT("along the slot's top edge"), ConsoleWidthCm, HeightCm, FVector::Dist(Eye, At));
	}
}

bool ABpPawn::ConsoleShowsTalk() const
{
	// The stand-up and the consent sheet keep the panel (a card a spoken request raised takes the conversation's place).
	return CVarTalkSheet.GetValueOnGameThread() != 0 && !(bConsoleOpen && (ConsolePageKey == TEXT("standup") || ConsolePageKey == TEXT("talk")));
}

void ABpPawn::TickConsoleLive()
{
	ABpTable* Table = WristTable.Get();
	if (!ConsolePanel || !Table) return;
	const bool bShow = CVarConsole.GetValueOnGameThread() != 0;
	if (ConsolePanel->IsVisible() != bShow)
	{
		ConsolePanel->SetVisibility(bShow);
		if (!bShow && bConsoleOpen) CloseConsole();
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: %s (bp.Console)"), bShow ? TEXT("shown") : TEXT("hidden"));
	}
	// The table's level, room mode and tour: the bar's place, its BACK and its status phrase. Nothing is built or drawn
	// unless one of them changed (the console's own key decides the redraw).
	const uint8 Level = static_cast<uint8>(Table->GetBpLevel());
	const bool bTour = Table->IsTourRunning();
	const bool bPlan = Table->HasPlan();
	if (Level != PadLevelShown || Table->GetRoomModeId() != PadRoomModeShown || bTour != bConsoleTourShown || bPlan != bConsolePlanShown)
	{
		const bool bRoomChanged = Table->GetRoomModeId() != PadRoomModeShown;
		PadLevelShown = Level;
		PadRoomModeShown = Table->GetRoomModeId();
		bConsoleTourShown = bTour;
		bConsolePlanShown = bPlan;
		if (bRoomChanged) PlaceConsole();
		RefreshConsole();
	}
	// Wave T1: the tour's step moved (the bar says how far it is); one redraw when it does.
	static FString TourShown;
	const FString TourNow = bTour ? Table->TourTitle() + Table->TourProgress() : FString();
	if (TourNow != TourShown) { TourShown = TourNow; RefreshConsole(); }
	// The text size changed (SETTINGS › ACCESSIBILITY, or adb): the console's scale and place again; nothing is redrawn.
	if (BpSheet::TextScale() != ConsoleScaleShown) PlaceConsole();
	// Wave PJ1: the main screen's mode (SETTINGS > MAIN SCREEN, adb) and the far sheet's cvars: placed and drawn again, live.
	static FString FarShown;
	const FString FarNow = FString::Printf(TEXT("%d|%d|%s|%s|%s|%s"), BpProjector::Mode(), CvarInt(TEXT("bp.Room")),
		*IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Projector.DistanceCm"))->GetString(), *IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Projector.WidthCm"))->GetString(),
		*IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Projector.LiftCm"))->GetString(), *IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Projector.RoomDistanceCm"))->GetString()) + BpProjector::StageCvars();
	// Wave PJ2: the stage's mesh shows the panel's render target; the target is made (or remade at a new size) by the panel's
	// draw, so its pointer is handed over when it changes (a compare, nothing drawn).
	if (bConsoleStage && ConsoleStageMat)
	{
		UTexture* Rt = ConsolePanel->GetRenderTarget();
		static TWeakObjectPtr<UTexture> RtShown;
		if (Rt && Rt != RtShown.Get())
		{
			RtShown = Rt;
			ConsoleStageMat->SetTextureParameterValue(TEXT("Sheet"), Rt);
			ConsoleStageMat->SetTextureParameterValue(TEXT("SlateUI"), Rt);
			UE_LOG(LogBpTable, Log, TEXT("BpStage: the stage shows the panel's render target %dx%d"), static_cast<int32>(Rt->GetSurfaceWidth()), static_cast<int32>(Rt->GetSurfaceHeight()));
		}
	}
	if (FarNow != FarShown)
	{
		const bool bModeChanged = BpProjector::Mode() != ConsoleProjShown;
		FarShown = FarNow;
		PlaceConsole();
		if (bModeChanged)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpProjector: main screen %s"), BpProjector::Mode() == 0 ? TEXT("DESK") : BpProjector::Mode() == 1 ? TEXT("WALL (the throw)") : TEXT("STAGE (the light stage)"));
			ConsoleKey.Reset();
			RefreshConsole();
		}
	}
}

void ABpPawn::OpenConsole(const FString& Page)
{
	const FBpConsolePage* Found = FBpConsolePages::Find(Page.ToLower());
	const FString Key = Found ? FString(Found->Key) : FString(TEXT("home"));
	const bool bWas = bConsoleOpen;
	bConsoleOpen = true;
	if (Key != ConsolePageKey || !bWas)
	{
		// Leaving the stand-up (another page): its screen is released and its timers stop.
		if (bWas && ConsolePageKey == TEXT("standup") && Key != TEXT("standup")) StandupClosed();
		ConsolePageKey = Key;
		ConsolePageAt = 0;
		ConsoleSel.Reset();
		if (Found && Found->OnOpen) Found->OnOpen(*this);
		// HOME's STAND-UP tile counts the companion's requests pending on the PC (one read, linked only).
		if (Key == TEXT("home")) StandupPeekRequests();
		// Wave N3-W3: Glim says what the page is for (the menu itself only as the console opens; the stand-up and the scan
		// result speak their own lines).
		if (ABpTable* Table = WristTable.Get(); Table && (Key != TEXT("home") || !bWas)) Table->Narrate(TEXT("page-") + Key, TEXT("a console page opened"));
	}
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: open %s"), *ConsolePageKey);
	PlaceConsole();
	RefreshConsole();
	DrawWrist();
}

void ABpPawn::CloseConsole()
{
	if (!bConsoleOpen) return;
	bConsoleOpen = false;
	ConsoleSel.Reset();
	ConsoleHover.Reset();
	if (ConsolePageKey == TEXT("standup")) StandupClosed();
	if (ABpTable* Table = WristTable.Get()) Table->NarrateCut(TEXT("the console closed"));
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: closed"));
	PlaceConsole();
	RefreshConsole();
	DrawWrist();
}

bool ABpPawn::ConsoleBack()
{
	if (!bConsoleOpen) return false;
	if (ConsolePageKey != TEXT("home"))
	{
		OpenConsole(TEXT("home"));
		return true;
	}
	CloseConsole();
	return true;
}

void ABpPawn::LogConsoleStat() const
{
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: stat %s, drawn %d times, console widget ticking=%d visible=%d; wrist widget ticking=%d"), *GetConsoleLine(), ConsoleDraws,
		ConsolePanel ? ConsolePanel->IsComponentTickEnabled() : -1, ConsolePanel ? ConsolePanel->IsVisible() : -1, WristPanel ? WristPanel->IsComponentTickEnabled() : -1);
}

void ABpPawn::LogConsoleRows()
{
	const FBpConsolePage* Page = bConsoleOpen ? FBpConsolePages::Find(ConsolePageKey) : nullptr;
	if (!Page)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: rows: %s (no list page open)"), *GetConsoleLine());
		return;
	}
	TArray<FBpConsoleRow> Rows;
	FString Sub;
	Page->Rows(*this, Rows, Sub);
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: rows %s \"%s\" (%d rows)"), Page->Key, *Sub, Rows.Num());
	for (const FBpConsoleRow& Row : Rows)
	{
		TArray<FString> Buttons;
		for (const FBpConsoleRow::FButton& B : Row.Buttons) Buttons.Add(B.Word + TEXT("=") + B.Act);
		UE_LOG(LogBpTable, Log, TEXT("BpConsole:   [%d] %s | %s | %s%s%s"), Row.Tone, *Row.Label, *Row.Detail, *Row.Tag,
			Row.Act.IsEmpty() ? TEXT("") : *(TEXT(" | act ") + Row.Act), Buttons.Num() ? *(TEXT(" | ") + FString::Join(Buttons, TEXT(", "))) : TEXT(""));
	}
}

FString ABpPawn::GetConsoleLine() const
{
	if (!bConsoleOpen) return TEXT("bar");
	return FString::Printf(TEXT("%s p%d sel=%s"), *ConsolePageKey, ConsolePageAt + 1, ConsoleSel.IsEmpty() ? TEXT("none") : *ConsoleSel);
}

FString ABpPawn::ConsoleStatus() const
{
	ABpTable* Table = WristTable.Get();
	if (!Table || !Table->HasPlan()) return TEXT("Reading the plan");
	// Talking to the lamp says so here as well as on the lamp and the wrist (voice-io: visibly active while in use).
	if (!Table->TalkStateWord().IsEmpty()) return FString::Printf(TEXT("%s · %s"), *Table->TalkStateWord(), *Table->TalkStateLine());
	// Wave EV: an ask out to the PC says so while the person does something else.
	if (GAdd.State == TEXT("waiting")) return FString::Printf(TEXT("Asked your PC · %s · confirm it on Headsets"), *GAdd.PickName);
	FString Head, Body;
	Table->ScanBand(Head, Body);
	if (!WristArmedFocus.IsEmpty()) return FString::Printf(TEXT("A scan of %s is ready on your wrist"), WristArmedLabel.IsEmpty() ? TEXT("this place") : *WristArmedLabel);
	if (Table->IsScanRunning() && !Body.IsEmpty()) return FString::Printf(TEXT("%s: %s"), Head.StartsWith(TEXT("SAMPLE")) ? TEXT("Sample scan") : TEXT("Scanning"), *Body);
	// Wave T1: which tour runs, and how far it is (STOP TOUR stands beside it).
	if (Table->IsTourRunning()) return Table->TourChapterId().IsEmpty() ? FString::Printf(TEXT("First tour %s"), *Table->TourProgress().Replace(TEXT(" of "), TEXT("/")))
		: FString::Printf(TEXT("%s %s"), *Table->TourTitle(), *Table->TourProgress().Replace(TEXT(" of "), TEXT("/")));
	if (!Table->GetRoomModeId().IsEmpty())
	{
		const int32 N = Table->DeckOpenIds().Num();
		const FString Place = Table->DirectedLabel(Table->GetRoomModeId());
		// The room's name is on its map's title block; the bar says what waits on the screens.
		return N > 0 ? FString::Printf(TEXT("%d %s on the screens"), N, N == 1 ? TEXT("decision") : TEXT("decisions")) : FString::Printf(TEXT("Nothing to decide in %s"), *Place);
	}
	const int32 Waiting = Table->OpenDecisionCount();
	FString Words = Waiting > 0 ? FString::Printf(TEXT("%d %s waiting"), Waiting, Waiting == 1 ? TEXT("decision") : TEXT("decisions")) : FString(TEXT("Nothing waiting"));
	// Wave EV: before today's stand-up, what came of yesterday's approvals leads the bar ("2 built since yesterday").
	if (const FString Yesterday = StandupYesterdayWords(); !Yesterday.IsEmpty() && Table->GetBpLevel() == EBpLevel::L0) Words = Yesterday.Left(1).ToUpper() + Yesterday.Mid(1) + TEXT(" · ") + Words;
	if (Table->GetBpLevel() != EBpLevel::L0) return FString::Printf(TEXT("%s · %s"), *Table->DirectedLabel(Table->DirectedTarget()), *Words);
	return Words;
}

bool ABpPawn::OnboardAskWaiting(FString& OutName) const
{
	if (GAdd.State != TEXT("waiting")) return false;
	OutName = GAdd.PickName;
	return true;
}

void ABpPawn::RefreshConsole()
{
	ABpTable* Table = WristTable.Get();
	if (!ConsolePanel || !Table) return;
	// Wave EV: what came of yesterday, read once in a while for the bar and the tile (throttled inside; nothing per frame).
	if (Table->HasPlan()) StandupPeekYesterday();
	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Product = Link.GetProductName().IsEmpty() ? Link.NameOf(Link.GetProductSlug()) : Link.GetProductName();
	const bool bCanBack = Table->HasPlan() && (!Table->GetRoomModeId().IsEmpty() || Table->GetBpLevel() != EBpLevel::L0);
	// SHOW ON PC (night two W2a): the table's place to the web, on the bar while a PC is linked; its answer stands a while.
	// Handed over (night two W2b): while a grant from the table is live the bar says until when, with TAKE BACK in SHOW ON PC's place.
	const FString Handed = StandupBarStatus();
	// Wave T1: while a tour runs, STOP TOUR takes SHOW ON PC's place on the bar (B or STOP TOUR ends it, dismissed).
	const bool bTourRun = Table->HasPlan() && Table->IsTourRunning();
	// Wave C1: a scan's result not yet seen waits as a chip on the bar ("SCAN DONE · 6 NEW"); a tap opens it.
	const FString ResultChip = Table->ScanResultChip();
	const bool bShowPc = Table->HasPlan() && Link.HasPcLink() && Handed.IsEmpty() && !bTourRun && ResultChip.IsEmpty();
	const FString Status = !ConsoleBarWords.IsEmpty() && FPlatformTime::Seconds() < ConsoleBarWordsUntil ? ConsoleBarWords : !Handed.IsEmpty() ? Handed : ConsoleStatus();

	// What it shows, as words: the redraw key.
	const FBpConsolePage* Page = bConsoleOpen && ConsolePageKey != TEXT("home") ? FBpConsolePages::Find(ConsolePageKey) : nullptr;
	TArray<FBpConsoleRow> Rows;
	FString Sub;
	TArray<FString> Summaries;
	if (bConsoleOpen && Page) Page->Rows(*this, Rows, Sub);
	if (bConsoleOpen && !Page) for (const FBpConsolePage& Each : FBpConsolePages::Registry()) Summaries.Add(Each.Summary(*this));
	const int32 Pages = FMath::Max(1, FMath::DivideAndRoundUp(Rows.Num(), ConsoleRowsPerPage));
	ConsolePageAt = FMath::Clamp(ConsolePageAt, 0, Pages - 1);
	const bool bRoom = CvarInt(TEXT("bp.Room")) != 0;
	FString Key = FString::Printf(TEXT("%d|%s|%d|%s|%s|%d|%s|%s|%s|%d|%d|%d"), bConsoleOpen, *ConsolePageKey, ConsolePageAt, *Product, *Status, bCanBack, *ConsoleHover, *ConsoleSel, *Sub, bConsolePadSel, bShowPc, bRoom);
	// Wave N3-W2: and whether the sheet is far now (a page opened by a scan's end was drawn before PlaceConsole threw it, and
	// the same key kept the desk's drawing on the wall).
	Key += FString::Printf(TEXT("|down%d%d|mark%s|tour%d|res%s|far%d%d"), bConsoleHoverDown, bPadADown && bConsolePadSel, *ConsoleMark, bTourRun, *ResultChip, BpProjector::Mode(), bConsoleFar);
	for (const FBpConsoleRow& Row : Rows)
	{
		Key += FString::Printf(TEXT("|%s/%s/%s/%s/%d"), *Row.Act, *Row.Label, *Row.Detail, *Row.Tag, Row.Tone);
		for (const FBpConsoleRow::FButton& B : Row.Buttons) Key += TEXT("/") + B.Word + (B.bPrimary ? TEXT("*") : TEXT(""));
	}
	for (const FString& Each : Summaries) Key += TEXT("|") + Each;
	if (bConsoleOpen && !Page) Key += FBpConsolePages::LinkLine();
	const bool bStandupPage = bConsoleOpen && Page && ConsolePageKey == TEXT("standup");
	if (bStandupPage) Key += StandupKey();
	// Wave N3-W2: the scan's result the wall lays out (the page's rows, in the key, are the desk's words of the same result).
	ABpTable::FScanResult WallResult;
	// The conversation with the lamp (night two V2): while a talk's words are on show the panel is the conversation.
	ABpTable::FTalkView Talk;
	const bool bTalk = ConsoleShowsTalk() && Table->TalkView(Talk);
	if (bTalk) Key += FString::Printf(TEXT("|talk|%s|%s|%s|%s|%d|%d"), *Talk.Word, *Talk.Heard, *Talk.Reply, *Talk.Line, FMath::RoundToInt(Talk.Level * 8.f), Talk.bSample);
	if (bTalk != bConsoleTalk)
	{
		bConsoleTalk = bTalk;
		PlaceConsole();
	}
	if (Key == ConsoleKey) return;
	ConsoleKey = Key;
	ConsoleBoxes.Reset();
	LoupeAimLayout = FVector2f(-1.f, -1.f);
	TitleAimLayout = FVector2f(-1.f, -1.f);

	TSharedRef<SCanvas> Canvas = SNew(SCanvas);
	// Wave PJ2: what Put and Button draw into (the panel's canvas and boxes; the near bar's while the sheet is far).
	SCanvas* Into = &Canvas.Get();
	TArray<FConsoleBox>* Boxes = &ConsoleBoxes;
	const auto Put = [&Into](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Into->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const FSlateFontInfo LabelFont = Font(TEXT("Bold"), CapLabel), SmallFont = Font(TEXT("Regular"), CapSmall), SmallBold = Font(TEXT("Bold"), CapSmall);
	enum class EBtn : uint8 { Fill, Edge, Amber };
	// One control family (BpSheet's, night two V2): a quiet control is a step lighter than the sheet; the one a hand's ray or
	// the pad is on is brighter still, and gets the amber edge drawn over everything at the end.
	const FString PadLit = bConsolePadSel ? ConsoleSel : FString();
	const auto IsLit = [&](const FString& Id) { return !Id.IsEmpty() && (Id == ConsoleHover || Id == PadLit); };
	// Night two V6: held (a pinch closed on it, or A on the pad's selection) it sinks, as BpSheet::Control's bDown does.
	const auto IsDown = [&](const FString& Id) { return !Id.IsEmpty() && ((Id == ConsoleHover && bConsoleHoverDown) || (Id == PadLit && bPadADown)); };
	const auto Button = [&](const FBox2f& Box, const FString& Word, EBtn Look, const FString& Act, const FSlateFontInfo& WordFont)
	{
		const bool bLit = IsLit(TEXT("console:") + Act);
		const bool bDown = IsDown(TEXT("console:") + Act);
		FLinearColor Fill = Look == EBtn::Fill ? BpSheet::Accent : Look == EBtn::Amber ? BpSheet::Amber : BpSheet::RowFill(bLit);
		if (bDown) Fill = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : Fill * 0.72f;
		const FLinearColor Edge = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(bLit ? 1.f : 0.7f) : FLinearColor::Transparent;
		const FLinearColor Ink = Look == EBtn::Edge ? BpSheet::InkHi : BpSheet::PaperLo;
		Put(bDown ? Box.ExpandBy(-3.f) : Box, SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(Fill).Edge(Edge).EdgePx(2.5f)]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Word, WordFont, Box.GetSize().X - 20.f))).Font(WordFont).ColorAndOpacity(FSlateColor(Ink))
			]);
		Boxes->Add({ TEXT("console:") + Act, Box });
	};

	// The bar: MENU, the product and the status, YOUR ROOM / STUDIO, BACK (on the panel's widget when nothing is open; on the
	// near bar's while a sheet is on a far surface, wave PJ2).
	const auto DrawBar = [&]()
	{
		// The bar: MENU, the product and the status, YOUR ROOM / STUDIO, BACK.
		const float Y0 = 12.f, Y1 = BarLH - 12.f;
		Button(FBox2f(FVector2f(14.f, Y0), FVector2f(214.f, Y1)), TEXT("MENU"), EBtn::Fill, TEXT("menu"), Font(TEXT("Bold"), CapBar));
		const float BackW = bCanBack ? 200.f : 0.f;
		if (bCanBack) Button(FBox2f(FVector2f(LW - 14.f - BackW, Y0), FVector2f(LW - 14.f, Y1)), TEXT("‹  BACK"), EBtn::Edge, TEXT("bar:back"), Font(TEXT("Bold"), CapBar));
		const bool bTakeBack = !Handed.IsEmpty() && !bTourRun && ResultChip.IsEmpty();
		const bool bResult = !ResultChip.IsEmpty() && !bTourRun;
		const float PcW = bTourRun ? 210.f : bResult ? FMath::Max(250.f, BpSheet::TextWidth(ResultChip, Font(TEXT("Bold"), CapBar)) + 44.f) : bShowPc || bTakeBack ? 250.f : 0.f;
		const float PcX1 = LW - 14.f - (bCanBack ? BackW + 12.f : 0.f);
		if (bShowPc) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), TEXT("SHOW ON PC"), EBtn::Edge, TEXT("bar:pc"), Font(TEXT("Bold"), CapBar));
		if (bTakeBack) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), TEXT("TAKE BACK"), EBtn::Amber, TEXT("standup:revoke"), Font(TEXT("Bold"), CapBar));
		if (bTourRun) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), TEXT("STOP TOUR"), EBtn::Edge, TEXT("tour:stop"), Font(TEXT("Bold"), CapBar));
		if (bResult) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), ResultChip, EBtn::Amber, TEXT("open:scanresult"), Font(TEXT("Bold"), CapBar));
		// Your room (BpSurround.cpp, night two W4): YOUR ROOM / STUDIO, what surrounds the table now; a tap switches it. Night two
		// V4: the status is never cut. It takes one line, else two in the 24 px face; when even two will not hold it the ROOM
		// switch leaves the bar (it stays on SETTINGS › ROOM) and the status has its width.
		const FSlateFontInfo NameFont = Font(TEXT("Bold"), CapBar), StatusFont = Font(TEXT("Regular"), CapBarStatus), Status2Font = Font(TEXT("Regular"), CapSmall);
		const float RoomW = 230.f;
		const float RoomX1 = PcX1 - (bShowPc || bTakeBack || bTourRun || bResult ? PcW + 12.f : 0.f);
		const float TextX = 242.f;
		const auto TextWFor = [&](bool bRoomBtn) { return LW - TextX - (bCanBack ? BackW + 40.f : 28.f) - (bShowPc || bTakeBack || bTourRun || bResult ? PcW + 12.f : 0.f) - (bRoomBtn ? RoomW + 12.f : 0.f); };
		const FString Name = BpSheet::Cut(Product.ToUpper(), NameFont, TextWFor(true) * 0.45f);
		const float NameW = BpSheet::TextWidth(Name, NameFont);
		const FString Short = Status.Replace(TEXT(" decisions waiting"), TEXT(" waiting")).Replace(TEXT(" decision waiting"), TEXT(" waiting"));
		const FString PlacePrefix = Table->GetBpLevel() != EBpLevel::L0 && Table->GetRoomModeId().IsEmpty() ? Table->DirectedLabel(Table->DirectedTarget()) + TEXT(" · ") : FString();
		const FString Placed = !PlacePrefix.IsEmpty() && Status.StartsWith(PlacePrefix) ? Status.RightChop(PlacePrefix.Len()) : FString();
		FString StatusFit;
		bool bTwo = false, bRoomBtn = true;
		for (const bool bWithRoom : { true, false })
		{
			const float W = TextWFor(bWithRoom) - NameW - 40.f;
			bRoomBtn = bWithRoom;
			if (BpSheet::TextWidth(Status, StatusFont) <= W) { StatusFit = Status; bTwo = false; break; }
			if (BpSheet::TextWidth(Short, StatusFont) <= W) { StatusFit = Short; bTwo = false; break; }
			// Night two V6: two lines never fit inside the bar's frame (the second was clipped at the bottom: cap\v6-walk-17-room-lifted.png).
			// A lifted wing or room names itself on its nameplate and the breadcrumb, so the bar keeps one line: what waits.
			if (!Placed.IsEmpty() && BpSheet::TextWidth(Placed, StatusFont) <= W) { StatusFit = Placed; bTwo = false; break; }
			// Else the status up to its last clause ("Sample scan: 3 of 13 rooms", the rest is on the scan's title block and wrist).
			FString Head;
			if (Short.Split(TEXT(" · "), &Head, nullptr, ESearchCase::CaseSensitive, ESearchDir::FromEnd) && BpSheet::TextWidth(Head, StatusFont) <= W) { StatusFit = Head; bTwo = false; break; }
			const FString Two = BpSheet::Wrap(Short, Status2Font, W, 0);
			if (LineCount(Two) <= 2) { StatusFit = Two; bTwo = true; break; }
			StatusFit = BpSheet::Wrap(Short, Status2Font, W, 2);
			bTwo = true;
		}
		if (bRoomBtn) Button(FBox2f(FVector2f(RoomX1 - RoomW, Y0), FVector2f(RoomX1, Y1)), bRoom ? TEXT("YOUR ROOM") : TEXT("STUDIO"), EBtn::Edge, TEXT("toggle:room"), Font(TEXT("Bold"), CapBar));
		const float TextW = TextWFor(bRoomBtn);
		Put(FBox2f(FVector2f(TextX, 0.f), FVector2f(TextX + TextW, BarLH)),
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Name)).Font(NameFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(18.f, 0.f)[SNew(SBox).WidthOverride(2.f).HeightOverride(BarLH * 0.5f)[SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f))]]
			+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(StatusFit)).Font(bTwo ? Status2Font : StatusFont).LineHeightPercentage(bTwo ? 0.86f : 1.f).ColorAndOpacity(FSlateColor(BpSheet::Ink))]);
	};

	if (bTalk)
	{
		DrawConversation(Canvas, Talk.Word, Talk.Heard, Talk.Reply, Talk.Line, Talk.Level, Talk.bSample);
	}
	else if (!bConsoleOpen)
	{
		DrawBar();
	}
	else
	{
		// The header: BACK (not on HOME), the title with its bubble, CLOSE; the sub-line under it.
		const FString Title = Page ? Page->Title : TEXT("MENU");
		float TitleX = Pad;
		if (Page)
		{
			Button(FBox2f(FVector2f(Pad, HeadY0), FVector2f(Pad + 190.f, HeadY1)), TEXT("‹  BACK"), EBtn::Edge, TEXT("home"), LabelFont);
			TitleX = Pad + 190.f + 28.f;
		}
		Button(FBox2f(FVector2f(LW - Pad - 190.f, HeadY0), FVector2f(LW - Pad, HeadY1)), TEXT("CLOSE"), EBtn::Edge, TEXT("close"), LabelFont);
		const FSlateFontInfo TitleFont = Font(TEXT("Bold"), CapTitle);
		// The title block on every sheet (night two V2), the stand-up's own aside: the sheet's number, the product, SAMPLE or the
		// date, between the title and CLOSE, so the set reads as one.
		float TitleX1 = LW - Pad - 210.f;
		if (bTourRun && !bStandupPage)
		{
			// Wave T1: while a tour runs, the panel offers STOP TOUR where the title block stands (the bar is hidden under it). The
			// stand-up keeps its own aside there (its STOP TOUR is the wrist's).
			const FBox2f Stop(FVector2f(LW - Pad - 210.f - 250.f, HeadY0), FVector2f(LW - Pad - 210.f, HeadY1));
			Button(Stop, TEXT("STOP TOUR"), EBtn::Edge, TEXT("tour:stop"), LabelFont);
			TitleX1 = Stop.Min.X - 16.f;
		}
		else if (!bStandupPage && ConsolePageKey != TEXT("talk"))
		{
			const FString No = FString::Printf(TEXT("%s-%02d"), Page ? Page->Letter : TEXT("M"), Page ? ConsolePageAt + 1 : 0);
			const FString Proj = Product.ToUpper() + TEXT(" · ") + (Link.HasPcLink() ? DayWord() : FString(TEXT("SAMPLE")));
			const FSlateFontInfo BlockBold = Font(TEXT("Bold"), CapSmall);
			const float NoW = BpSheet::TextWidth(No, BlockBold), ProjW = FMath::Min(300.f, BpSheet::TextWidth(Proj, SmallFont));
			const FBox2f Block(FVector2f(LW - Pad - 210.f - NoW - ProjW - 62.f, HeadY0 + 11.f), FVector2f(LW - Pad - 210.f, HeadY1 - 11.f));
			Put(Block, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.5f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
			Put(FBox2f(FVector2f(Block.Min.X + NoW + 28.f, Block.Min.Y + 8.f), FVector2f(Block.Min.X + NoW + 30.f, Block.Max.Y - 8.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f)));
			Put(FBox2f(Block.Min + FVector2f(14.f, 0.f), FVector2f(Block.Min.X + NoW + 20.f, Block.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(No)).Font(BlockBold).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
			Put(FBox2f(FVector2f(Block.Min.X + NoW + 44.f, Block.Min.Y), Block.Max - FVector2f(10.f, 0.f)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::CutWords(Proj, SmallFont, ProjW))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
			TitleX1 = Block.Min.X - 16.f;
		}
		Put(FBox2f(FVector2f(TitleX, HeadY0), FVector2f(TitleX1, HeadY1)),
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 16.f, 0.f)[BpSheet::Bubble(Page ? Page->Letter : TEXT("M"), Font(TEXT("Bold"), 20.f), 44.f, BpSheet::Accent)]
			+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Title)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
		const FString SubLine = Page ? Sub : FString::Printf(TEXT("%s · %s"), *Product, *Status);
		Put(FBox2f(FVector2f(Pad, SubY), FVector2f(LW - Pad, SubY + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::FitClause(SubLine, SmallFont, LW - 2.f * Pad))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
		// A fine rule under the header, as the sheet's title block.
		Put(FBox2f(FVector2f(Pad, SubY + 46.f), FVector2f(LW - Pad, SubY + 48.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
		if (!Page && bConsoleFar)
		{
			// Wave N3-W1, the MENU on the wall: three columns of tall tiles, each its title (28 px: 60 arc minutes at 2.6 m) and up
			// to two lines of what it holds (24 px: 51'); the stand-up's tile carries what waits as a large figure and yesterday's
			// outcomes. Every tile is a control at least 6 degrees tall.
			const TArray<FBpConsolePage>& Registry = FBpConsolePages::Registry();
			constexpr int32 Cols = 3;
			const int32 RowsN = FMath::Max(1, FMath::DivideAndRoundUp(Registry.Num(), Cols));
			const float Gap = 16.f, Top = 164.f;
			const float TileW = (LW - 2.f * Pad - (Cols - 1) * Gap) / Cols, TileH = (LH - 26.f - Top - (RowsN - 1) * Gap) / RowsN;
			const int32 Waiting = Table->OpenDecisionCount();
			const FString Yesterday = StandupYesterdayWords();
			const FSlateFontInfo FigFont = Font(TEXT("Bold"), 44.f);
			for (int32 Index = 0; Index < Registry.Num(); ++Index)
			{
				const FBpConsolePage& Each = Registry[Index];
				const float X0 = Pad + (Index % Cols) * (TileW + Gap), Y0 = Top + (Index / Cols) * (TileH + Gap);
				const FBox2f Box(FVector2f(X0, Y0), FVector2f(X0 + TileW, Y0 + TileH));
				const FString TileId = FString::Printf(TEXT("console:open:%s"), Each.Key);
				const bool bStandupTile = FCString::Strcmp(Each.Key, TEXT("standup")) == 0;
				Put(Box, SNew(BpSheet::SPlate).Fill(IsDown(TileId) ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : BpSheet::RowFill(IsLit(TileId))).Edge(bStandupTile && Waiting > 0 ? BpSheet::Amber.CopyWithNewOpacity(0.7f) : BpSheet::RowEdge(false)).EdgePx(2.f)
					.Bar(bStandupTile && Waiting > 0 ? BpSheet::Amber : FLinearColor::Transparent).BarPx(8.f));
				// The figure (the stand-up's tile): what waits, large, at the right of its title row.
				float TileTitleX1 = Box.Max.X - 18.f;
				const float WX0 = Box.Min.X + 24.f;
				float WX1 = Box.Max.X - 44.f;
				if (bStandupTile && Waiting > 0)
				{
					const FString Fig = FString::FromInt(Waiting);
					const float StackW = FMath::Max(BpSheet::TextWidth(Fig, FigFont), BpSheet::TextWidth(TEXT("WAITING"), SmallBold)) + 4.f;
					// Wave N3-W2 (the device, 3-dev-menu_L.png: WAITING cut by the tile's foot): the figure and its word stand as one
					// block centred in the tile's height at its right (it was hung under the title row, 56 px down, and ran out of
					// the 166 px tile); the title row stops short of it.
					const float StackH = Pitch(44.f) * 0.86f + Pitch(CapSmall);
					const float StackY0 = Box.Max.Y - 10.f - StackH;
					Put(FBox2f(FVector2f(Box.Max.X - 18.f - StackW, StackY0), FVector2f(Box.Max.X - 18.f, FMath::Min(Box.Max.Y - 6.f, StackY0 + StackH + 6.f))),
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)[SNew(STextBlock).Text(FText::FromString(Fig)).Font(FigFont).LineHeightPercentage(0.86f).ColorAndOpacity(FSlateColor(BpSheet::Amber))]
						+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)[SNew(STextBlock).Text(FText::FromString(TEXT("WAITING"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Amber))]);
					WX1 = Box.Max.X - 30.f - StackW;
				}
				Put(FBox2f(FVector2f(WX0, Box.Min.Y + 16.f), FVector2f(TileTitleX1, Box.Min.Y + 64.f)),
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 16.f, 0.f)[BpSheet::Bubble(Each.Letter, Font(TEXT("Bold"), 18.f), 40.f, BpSheet::Accent)]
					+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Each.Title, LabelFont, TileTitleX1 - WX0 - 56.f))).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
				// What it holds: its summary (the stand-up's: yesterday's outcomes when there are any), two lines at most.
				const FString Holds = bStandupTile && !Yesterday.IsEmpty() ? Yesterday.Left(1).ToUpper() + Yesterday.Mid(1) : Summaries[Index];
				const FString HoldsFit = BpSheet::Wrap(Holds, SmallFont, WX1 - WX0, 2);
				const float WordsX1 = WX1;
				Put(FBox2f(FVector2f(WX0, Box.Min.Y + 74.f), FVector2f(WordsX1, Box.Max.Y - 8.f)),
					SNew(STextBlock).Text(FText::FromString(HoldsFit)).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
				if (!(bStandupTile && Waiting > 0)) Put(FBox2f(FVector2f(Box.Max.X - 40.f, Box.Max.Y - 52.f), FVector2f(Box.Max.X - 12.f, Box.Max.Y - 6.f)),
					SNew(STextBlock).Text(FText::FromString(TEXT("›"))).Font(Font(TEXT("Bold"), 34.f)).ColorAndOpacity(FSlateColor(BpSheet::Accent)));
				ConsoleBoxes.Add({ TileId, Box });
			}
		}
		else if (!Page)
		{
			// HOME: a tile per page, two columns, in the registry's order.
			const TArray<FBpConsolePage>& Registry = FBpConsolePages::Registry();
			const int32 RowsN = FMath::DivideAndRoundUp(Registry.Num(), 2);
			const float Gap = 14.f, Top = RowsN > 0 ? 162.f : 0.f;
			const float TileW = (LW - 2.f * Pad - Gap) * 0.5f, TileH = (LH - 28.f - Top - (RowsN - 1) * Gap) / FMath::Max(1, RowsN);
			for (int32 Index = 0; Index < Registry.Num(); ++Index)
			{
				const FBpConsolePage& Each = Registry[Index];
				const float X0 = Pad + (Index % 2) * (TileW + Gap), Y0 = Top + (Index / 2) * (TileH + Gap);
				const FBox2f Box(FVector2f(X0, Y0), FVector2f(X0 + TileW, Y0 + TileH));
				const FString TileId = FString::Printf(TEXT("console:open:%s"), Each.Key);
				Put(Box, SNew(BpSheet::SPlate).Fill(IsDown(TileId) ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : BpSheet::RowFill(IsLit(TileId))).Edge(BpSheet::RowEdge(false)).EdgePx(2.f));
				Put(FBox2f(Box.Min + FVector2f(22.f, 0.f), Box.Max - FVector2f(18.f, 0.f)),
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 18.f, 0.f)[BpSheet::Bubble(Each.Letter, Font(TEXT("Bold"), 18.f), 40.f, BpSheet::Accent)]
					+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Each.Title)).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::CutWords(Summaries[Index], SmallFont, TileW - 140.f))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(TEXT("›"))).Font(Font(TEXT("Bold"), 34.f)).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
				ConsoleBoxes.Add({ FString::Printf(TEXT("console:open:%s"), Each.Key), Box });
			}
			// The grid's free cell: the PC link, read only (no plate, no press).
			if (Registry.Num() % 2 == 1)
			{
				const int32 Index = Registry.Num();
				const float X0 = Pad + (Index % 2) * (TileW + Gap), Y0 = Top + (Index / 2) * (TileH + Gap);
				Put(FBox2f(FVector2f(X0, Y0 + 14.f), FVector2f(X0 + 4.f, Y0 + TileH - 14.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
				Put(FBox2f(FVector2f(X0 + 24.f, Y0), FVector2f(X0 + TileW, Y0 + TileH)), SNew(SBox).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(FBpConsolePages::LinkLine(), SmallFont, TileW - 30.f, 2))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.75f)))
					]);
			}
		}
		else if (Page && ConsolePageKey == TEXT("talk") && Rows.Num() >= 4)
		{
			// The consent sheet, designed (night two V2): the one sentence about the cloud service is the thing to read; ALLOW
			// and NOT NOW are the largest controls on it.
			const FBpConsoleRow& Choice = Rows[3];
			Put(FBox2f(FVector2f(Pad + 20.f, 160.f), FVector2f(LW - Pad, 196.f)), SNew(STextBlock).Text(FText::FromString(TEXT("BEFORE YOU TALK TO GLIM"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Amber)));
			const FSlateFontInfo ReadFont = Font(TEXT("Bold"), 32.f);
			const FString Cloud = BpSheet::Wrap(Rows[1].Label, ReadFont, LW - 2.f * Pad - 40.f, 3);
			const float CloudH = LineCount(Cloud) * Pitch(32.f);
			Put(FBox2f(FVector2f(Pad + 20.f, 198.f), FVector2f(LW - Pad, 202.f + CloudH)), SNew(STextBlock).Text(FText::FromString(Cloud)).Font(ReadFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
			float Y = 216.f + CloudH;
			for (const int32 At : { 0, 2 })
			{
				const FString Fit = BpSheet::Wrap(Rows[At].Label, SmallFont, LW - 2.f * Pad - 80.f, 2);
				const float H = LineCount(Fit) * Pitch(CapSmall);
				Put(FBox2f(FVector2f(Pad + 22.f, Y + Pitch(CapSmall) * 0.5f - 6.f), FVector2f(Pad + 34.f, Y + Pitch(CapSmall) * 0.5f + 6.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
				Put(FBox2f(FVector2f(Pad + 52.f, Y), FVector2f(LW - Pad, Y + H + 4.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
				Y += H + 8.f;
			}
			Put(FBox2f(FVector2f(Pad, 588.f), FVector2f(LW - Pad, 590.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.35f)));
			Put(FBox2f(FVector2f(Pad + 20.f, 604.f), FVector2f(660.f, 642.f)), SNew(STextBlock).Text(FText::FromString(Choice.Label)).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
			Put(FBox2f(FVector2f(Pad + 20.f, 648.f), FVector2f(660.f, 690.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::CutWords(Choice.Detail, SmallFont, 600.f))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.75f))));
			float Right = LW - Pad;
			for (int32 B = Choice.Buttons.Num() - 1; B >= 0; --B)
			{
				const FBpConsoleRow::FButton& Each = Choice.Buttons[B];
				const float W = Each.bPrimary ? 300.f : 250.f;
				Button(FBox2f(FVector2f(Right - W, 602.f), FVector2f(Right, 692.f)), Each.Word, Each.bPrimary ? EBtn::Amber : EBtn::Edge, Each.Act, Font(TEXT("Bold"), 34.f));
				Right -= W + 20.f;
			}
		}
		else if (Page && ConsolePageKey == TEXT("scanresult") && bConsoleFar && Table->GetScanResult(WallResult))
		{
			// Wave N3-W2, a scan's result on the wall: what it read and found as a strip of large figures (the severities are the
			// controls that raise the first of their kind), the findings as rows with their rooms (a row raises its room), then
			// DECIDE THEM and CLOSE as the sheet's largest controls. The same acts as the desk's rows (ResultTap).
			const ABpTable::FScanResult& R = WallResult;
			const FBpScanState& State = FBpLinkModule::Get().GetScanState();
			struct FFig { FString Value; FString Label; FLinearColor Ink; FString Act; };
			TArray<FFig> Figs;
			const bool bStopped = R.bFailed || R.bCancelled;
			Figs.Add({ bStopped ? FString::Printf(TEXT("%d/%d"), R.RoomsRead, R.RoomsTotal) : FString::FromInt(R.RoomsRead), R.RoomsRead == 1 && !bStopped ? TEXT("ROOM\nREAD") : TEXT("ROOMS\nREAD"), bStopped ? BpSheet::Red : BpSheet::Accent, FString() });
			Figs.Add({ FString::FromInt(R.New), R.New == 1 ? TEXT("NEW\nFINDING") : TEXT("NEW\nFINDINGS"), R.New ? BpSheet::InkHi : BpSheet::Ink.CopyWithNewOpacity(0.5f), FString() });
			static const TCHAR* const SevWords[3] = { TEXT("STOP-\nSHIP"), TEXT("BEFORE\nRELEASE"), TEXT("LATER\n") };
			for (int32 S = 0; S < 3; ++S)
			{
				const FLinearColor SevInk = S == 0 ? BpSheet::Red : S == 1 ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.8f);
				Figs.Add({ FString::FromInt(R.Severity[S]), FString(SevWords[S]).TrimEnd(), R.Severity[S] ? SevInk : BpSheet::Ink.CopyWithNewOpacity(0.4f), R.Severity[S] ? FString::Printf(TEXT("result:sev:%d"), S) : FString() });
			}
			const float FigY0 = 164.f, FigH = 104.f, FigGap = 12.f;
			const float FigW = (LW - 2.f * Pad - (Figs.Num() - 1) * FigGap) / Figs.Num();
			const FSlateFontInfo FigFont = Font(TEXT("Bold"), 48.f);
			for (int32 Index = 0; Index < Figs.Num(); ++Index)
			{
				const FFig& F = Figs[Index];
				const FBox2f Cell(FVector2f(Pad + Index * (FigW + FigGap), FigY0), FVector2f(Pad + Index * (FigW + FigGap) + FigW, FigY0 + FigH));
				const FString CellId = F.Act.IsEmpty() ? FString() : TEXT("console:") + F.Act;
				Put(Cell, SNew(BpSheet::SPlate).Fill(IsDown(CellId) ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : F.Act.IsEmpty() ? BpSheet::PaperLo.CopyWithNewOpacity(0.45f) : BpSheet::RowFill(IsLit(CellId)))
					.Edge(F.Ink.CopyWithNewOpacity(0.55f)).EdgePx(2.f).Bar(F.Ink).BarPx(6.f));
				const float NumW = BpSheet::TextWidth(F.Value, FigFont);
				Put(FBox2f(Cell.Min + FVector2f(22.f, 0.f), FVector2f(Cell.Min.X + 26.f + NumW, Cell.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(F.Value)).Font(FigFont).ColorAndOpacity(FSlateColor(F.Ink))]);
				Put(FBox2f(FVector2f(Cell.Min.X + 38.f + NumW, Cell.Min.Y), FVector2f(Cell.Max.X - 6.f, Cell.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(F.Label)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
				if (!F.Act.IsEmpty()) ConsoleBoxes.Add({ CellId, Cell });
			}
			// The findings, most severe first: a bar in the severity's colour, the title, its room and lens in a column, the
			// severity chip at the right. As many as fit above the foot; "and N more" says the rest (DECIDE THEM walks them all).
			const float RowsTop = FigY0 + FigH + 18.f, RowsFoot = 594.f, FRowH = 70.f, FRowGap = 8.f;
			const float RoomX0 = LW - Pad - 230.f - 420.f, ChipX1 = LW - Pad - 14.f;
			const FString FoundHead = FString::Printf(TEXT("WHAT IT FOUND · %d %s MEASURED"), R.Features, R.Features == 1 ? TEXT("FEATURE") : TEXT("FEATURES"));
			Put(FBox2f(FVector2f(Pad + 24.f, RowsTop - 2.f), FVector2f(RoomX0 - 20.f, RowsTop + 30.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(FoundHead, SmallBold, RoomX0 - 44.f - Pad))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Accent)));
			Put(FBox2f(FVector2f(RoomX0, RowsTop - 2.f), FVector2f(ChipX1, RowsTop + 30.f)), SNew(STextBlock).Text(FText::FromString(TEXT("ROOM · LENS"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Accent)));
			float RY = RowsTop + 36.f;
			int32 Shown = 0;
			for (const FString& Id : R.Found)
			{
				if (RY + FRowH > RowsFoot - (Shown < R.Found.Num() - 1 ? 34.f : 0.f)) break;
				const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Id](const FBpProposal& Each) { return Each.id == Id; });
				if (!P) continue;
				const int32 Sev = ABpTable::ScanSeverity(*P, State.Tiers.Find(Id));
				const FLinearColor SevInk = Sev == 0 ? BpSheet::Red : Sev == 1 ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.8f);
				const FBox2f RowBox(FVector2f(Pad, RY), FVector2f(LW - Pad, RY + FRowH));
				const FString RowId = TEXT("console:result:raise:") + Id;
				Put(RowBox, SNew(BpSheet::SPlate).Fill(IsDown(RowId) ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : BpSheet::RowFill(IsLit(RowId))).Edge(SevInk.CopyWithNewOpacity(0.5f)).EdgePx(2.f).Bar(SevInk).BarPx(8.f));
				const FString Chip = Sev == 0 ? TEXT("STOP-SHIP") : Sev == 1 ? TEXT("BEFORE RELEASE") : TEXT("LATER");
				const float ChipW = BpSheet::ChipWidth(Chip, SmallBold);
				Put(FBox2f(FVector2f(ChipX1 - ChipW, RY + 14.f), FVector2f(ChipX1, RY + FRowH - 14.f)), BpSheet::Chip(Chip, SmallBold, 42.f, SevInk, Sev == 0));
				const FString RowTitle = P->title.IsEmpty() ? P->id : P->title;
				const float TitleW = RoomX0 - 24.f - (Pad + 32.f);
				const bool bTitleFits = BpSheet::TextWidth(RowTitle, LabelFont) <= TitleW;
				Put(FBox2f(FVector2f(Pad + 32.f, RY), FVector2f(RoomX0 - 24.f, RY + FRowH)), SNew(SBox).VAlign(VAlign_Center)
					[SNew(STextBlock).Text(FText::FromString(bTitleFits ? RowTitle : BpSheet::Wrap(RowTitle, SmallBold, TitleW, 2))).Font(bTitleFits ? LabelFont : SmallBold).LineHeightPercentage(bTitleFits ? 1.f : 0.86f).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
				const FString Room = Table->StandupRoomOf(P->feature);
				const FString Where = FString::Printf(TEXT("%s · %s"), Room.IsEmpty() ? *P->feature : *Table->StandupPlaceName(Room), *BpWords::Lens(P->lens));
				Put(FBox2f(FVector2f(RoomX0, RY), FVector2f(ChipX1 - ChipW - 16.f, RY + FRowH)), SNew(SBox).VAlign(VAlign_Center)
					[SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(Where, SmallFont, ChipX1 - ChipW - 16.f - RoomX0, 2))).Font(SmallFont).LineHeightPercentage(0.86f).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.9f)))]);
				ConsoleBoxes.Add({ RowId, RowBox });
				RY += FRowH + FRowGap;
				++Shown;
			}
			if (Shown < R.Found.Num()) Put(FBox2f(FVector2f(Pad + 32.f, RY - 4.f), FVector2f(RoomX0, RY + 30.f)), SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("and %d more · DECIDE THEM walks them all"), R.Found.Num() - Shown))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.65f))));
			if (R.Found.Num() == 0)
			{
				Put(FBox2f(FVector2f(Pad + 32.f, RY), FVector2f(LW - Pad, RY + 120.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(bStopped ? TEXT("It found nothing before it stopped: the rooms keep what they had.") : TEXT("Nothing new: the rooms keep what they had."), Font(TEXT("Bold"), 32.f), LW - 2.f * Pad - 64.f, 2)))
					.Font(Font(TEXT("Bold"), 32.f)).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
			}
			// The foot: what DECIDE THEM does, then the two answers, 90 px tall (3.2 degrees on the wall).
			const float FootY0 = 606.f, FootY1 = 700.f;
			Put(FBox2f(FVector2f(Pad + 24.f, FootY0), FVector2f(LW - Pad - 600.f, FootY1)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock)
				.Text(FText::FromString(BpSheet::Wrap(R.New > 0 ? TEXT("The stand-up, one decision at a time, starting with the most severe.") : TEXT("CLOSE puts the menu back to its bar."), SmallFont, LW - 2.f * Pad - 624.f, 2)))
				.Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
			float Right = LW - Pad;
			Button(FBox2f(FVector2f(Right - 220.f, FootY0), FVector2f(Right, FootY1)), TEXT("CLOSE"), EBtn::Edge, TEXT("result:close"), Font(TEXT("Bold"), 34.f));
			Right -= 240.f;
			if (R.New > 0) Button(FBox2f(FVector2f(Right - 330.f, FootY0), FVector2f(Right, FootY1)), TEXT("DECIDE THEM"), EBtn::Amber, TEXT("result:decide"), Font(TEXT("Bold"), 34.f));
			UE_LOG(LogBpTable, Log, TEXT("BpConsole: the scan's result on the wall: %d figures, %d of %d findings as rows"), Figs.Num(), Shown, R.Found.Num());
		}
		else if (bStandupPage)
		{
			// The stand-up's sheet (BpStandup.cpp), under the same header.
			DrawStandup(Canvas);
		}
		else
		{
			// A list: a page of rows, then the pager. The rows' boxes go before their buttons' (a hit reads the last first).
			const int32 RowsAt = ConsoleBoxes.Num();
			int32 RowsAdded = 0;
			for (int32 Index = 0; Index < ConsoleRowsPerPage; ++Index)
			{
				const int32 At = ConsolePageAt * ConsoleRowsPerPage + Index;
				if (!Rows.IsValidIndex(At)) break;
				const FBpConsoleRow& Row = Rows[At];
				const float Y0 = RowsY0 + Index * (RowH + RowGap);
				const FBox2f Box(FVector2f(Pad, Y0), FVector2f(LW - Pad, Y0 + RowH));
				if (Row.Tone == 6)
				{
					// An empty page, composed (night two V2): a headline, one line of why, the one action that fixes it, and a
					// quiet drawing in the sheet's own lines filling the space. It takes the rest of the page.
					const float AreaY1 = Pages > 1 ? PagerY0 - 12.f : LH - 26.f;
					const FBox2f Area(FVector2f(Pad, Y0), FVector2f(LW - Pad, AreaY1));
					const float Tall = Area.GetSize().Y, MotifS = FMath::Min(Tall - 16.f, 420.f);
					Put(FBox2f(FVector2f(Area.Max.X - MotifS - 30.f, Area.Min.Y + (Tall - MotifS) * 0.5f), FVector2f(Area.Max.X - 30.f, Area.Min.Y + (Tall + MotifS) * 0.5f)), SNew(BpSheet::SMotif).Kind(FCString::Atoi(*Row.Tag)));
					const float TX0 = Area.Min.X + 24.f, TX1 = Area.Max.X - MotifS - 70.f;
					const float HeadCap = Tall > 300.f ? CapTitle : CapLabel;
					const FSlateFontInfo HeadF = Font(TEXT("Bold"), HeadCap), WhyF = Font(TEXT("Regular"), CapLabel);
					const FString HeadFit = BpSheet::Wrap(Row.Label, HeadF, TX1 - TX0, 2), WhyFit = BpSheet::Wrap(Row.Detail, WhyF, TX1 - TX0, 3);
					const float HeadH = LineCount(HeadFit) * Pitch(HeadCap), WhyH = LineCount(WhyFit) * Pitch(CapLabel);
					const float BtnH = Row.Buttons.Num() > 0 ? 84.f : 0.f;
					const float BlockH = HeadH + 14.f + WhyH + (BtnH > 0.f ? 30.f + BtnH : 0.f);
					float TY = Area.Min.Y + FMath::Max(10.f, (Tall - BlockH) * 0.5f);
					Put(FBox2f(FVector2f(TX0 - 24.f, TY), FVector2f(TX0 - 18.f, TY + HeadH + 14.f + WhyH)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent.CopyWithNewOpacity(0.8f)));
					Put(FBox2f(FVector2f(TX0, TY), FVector2f(TX1, TY + HeadH + 4.f)), SNew(STextBlock).Text(FText::FromString(HeadFit)).Font(HeadF).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
					TY += HeadH + 14.f;
					Put(FBox2f(FVector2f(TX0, TY), FVector2f(TX1, TY + WhyH + 4.f)), SNew(STextBlock).Text(FText::FromString(WhyFit)).Font(WhyF).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
					TY += WhyH + 30.f;
					if (Row.Buttons.Num() > 0)
					{
						const FBpConsoleRow::FButton& Fix = Row.Buttons[0];
						const FSlateFontInfo FixFont = Font(TEXT("Bold"), 32.f);
						const float W = BpSheet::TextWidth(Fix.Word, FixFont) + 72.f;
						Button(FBox2f(FVector2f(TX0, TY), FVector2f(TX0 + W, TY + BtnH)), Fix.Word, EBtn::Amber, Fix.Act, FixFont);
					}
					break;
				}
				if (Row.Tone == 5)
				{
					// The pairing code (PC LINK): six characters, large and spaced, on an amber plate the owner reads from across
					// the desk; its tag (the time left) at the right.
					const FSlateFontInfo CodeFont = Font(TEXT("Bold"), CapCode);
					FString Spaced;
					for (const TCHAR C : Row.Label) { if (!Spaced.IsEmpty()) Spaced += TEXT("  "); Spaced += C; }
					Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.6f)).Edge(BpSheet::Amber).EdgePx(3.f).Bar(BpSheet::Amber).BarPx(8.f));
					Put(FBox2f(Box.Min + FVector2f(32.f, 0.f), Box.Max - FVector2f(24.f, 0.f)),
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Spaced)).Font(CodeFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Row.Tag)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Amber))]);
					continue;
				}
				if (Row.Tone == 6)
				{
					// Wave C1, the room a scan reads now: its name large, the n of m and the clock small under it, the lens a chip in
					// its own colour; the row's bar in that colour too.
					const FSlateFontInfo RoomFont = Font(TEXT("Bold"), CapTitle);
					const float ChipW = BpSheet::ChipWidth(Row.Tag, SmallBold);
					Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::RowFill(false)).Edge(Row.Ink.CopyWithNewOpacity(0.6f)).EdgePx(2.f).Bar(Row.Ink).BarPx(8.f));
					Put(FBox2f(FVector2f(Box.Max.X - ChipW - 18.f, Box.Min.Y + 25.f), FVector2f(Box.Max.X - 18.f, Box.Max.Y - 25.f)), BpSheet::Chip(Row.Tag, SmallBold, 42.f, Row.Ink, true));
					const float TX0 = Box.Min.X + 32.f, TW = Box.Max.X - ChipW - 40.f - TX0;
					Put(FBox2f(FVector2f(TX0, Box.Min.Y + 4.f), FVector2f(TX0 + TW, Box.Min.Y + 52.f)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Row.Label, RoomFont, TW))).Font(RoomFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
					Put(FBox2f(FVector2f(TX0, Box.Min.Y + 52.f), FVector2f(TX0 + TW, Box.Max.Y - 4.f)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Row.Detail, SmallBold, TW))).Font(SmallBold).ColorAndOpacity(FSlateColor(Row.Ink))]);
					continue;
				}
				if (Row.Tone == 4 || (Row.Act.IsEmpty() && Row.Buttons.Num() == 0 && Row.Tone == 2 && Row.Detail.IsEmpty()))
				{
					// A note: words across the row, two lines at most, on a quiet rule.
					const FLinearColor Ink = Row.Tone == 2 ? BpSheet::Amber : BpSheet::Ink;
					Put(FBox2f(Box.Min, FVector2f(Box.Min.X + 4.f, Box.Max.Y)), SNew(BpSheet::SPlate).Fill(Ink.CopyWithNewOpacity(0.6f)));
					Put(FBox2f(Box.Min + FVector2f(24.f, 0.f), Box.Max), SNew(SBox).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(Row.Label, SmallFont, Box.GetSize().X - 30.f, 2))).Font(SmallFont).ColorAndOpacity(FSlateColor(Ink))
						]);
					continue;
				}
				const FLinearColor ToneInk = Row.Tone == 1 ? BpSheet::Accent : Row.Tone == 2 ? BpSheet::Amber : Row.Tone == 3 ? BpSheet::Red : BpSheet::Ink.CopyWithNewOpacity(0.85f);
				// The row: a step lighter than the sheet, brighter under the focus; its tone a bar down its left edge.
				const bool bRowLit = !Row.Act.IsEmpty() && IsLit(TEXT("console:") + Row.Act);
				const bool bRowDown = !Row.Act.IsEmpty() && IsDown(TEXT("console:") + Row.Act);
				Put(Box, SNew(BpSheet::SPlate).Fill(bRowDown ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : BpSheet::RowFill(bRowLit)).Edge(Row.Tone == 0 ? BpSheet::RowEdge(false) : ToneInk.CopyWithNewOpacity(0.55f)).EdgePx(2.f)
					.Bar(Row.Tone == 0 ? FLinearColor::Transparent : ToneInk).BarPx(8.f));
				// The buttons at the right, then the tag left of them; the words take the rest.
				float Right = Box.Max.X - 12.f;
				for (int32 B = Row.Buttons.Num() - 1; B >= 0; --B)
				{
					const FBpConsoleRow::FButton& Each = Row.Buttons[B];
					const bool bSign = Each.Word.Len() == 1;
					const float W = bSign ? 96.f : FMath::Max(150.f, BpSheet::TextWidth(Each.Word, LabelFont) + 44.f);
					Button(FBox2f(FVector2f(Right - W, Box.Min.Y + 10.f), FVector2f(Right, Box.Max.Y - 10.f)), Each.Word, Each.bPrimary ? EBtn::Amber : EBtn::Edge, Each.Act, bSign ? Font(TEXT("Bold"), 34.f) : LabelFont);
					Right -= W + 12.f;
				}
				if (!Row.Tag.IsEmpty())
				{
					// The value or state: one chip design at the right (OPEN counts, FOCUS, OFFLINE, 100 %).
					const FString Tag = BpSheet::CutWords(Row.Tag, SmallBold, 360.f);
					const float TagW = BpSheet::ChipWidth(Tag, SmallBold);
					Put(FBox2f(FVector2f(Right - TagW - 6.f, Box.Min.Y + 25.f), FVector2f(Right - 6.f, Box.Max.Y - 25.f)), BpSheet::Chip(Tag, SmallBold, 42.f, Row.Tone == 0 ? BpSheet::Accent : ToneInk));
					Right -= TagW + 24.f;
				}
				const float TextX = Box.Min.X + (Row.Tone == 0 ? 24.f : 32.f), TextW = Right - TextX;
				// V7: a row's title is never cut. Too long for its face, it sets a step smaller; still too long, it wraps to two
				// lines in that face and gives the row's second line to them.
				const bool bFits = BpSheet::TextWidth(Row.Label, LabelFont) <= TextW;
				const bool bSmallFits = bFits || BpSheet::TextWidth(Row.Label, SmallBold) <= TextW;
				const FString RowTitle = bFits || bSmallFits ? Row.Label : BpSheet::Wrap(Row.Label, SmallBold, TextW, 2);
				TSharedRef<SVerticalBox> Words = SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(RowTitle)).Font(bFits ? LabelFont : SmallBold).ColorAndOpacity(FSlateColor(BpSheet::InkHi))];
				if (!Row.Detail.IsEmpty() && bSmallFits)
				{
					Words->AddSlot().AutoHeight().Padding(0.f, 4.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::CutWords(Row.Detail, SmallFont, TextW))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.8f)))];
				}
				Put(FBox2f(FVector2f(TextX, Box.Min.Y), FVector2f(Right, Box.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[Words]);
				if (!Row.Act.IsEmpty()) ConsoleBoxes.Insert({ TEXT("console:") + Row.Act, Box }, RowsAt + RowsAdded++);
			}
			if (Pages > 1)
			{
				Button(FBox2f(FVector2f(Pad, PagerY0), FVector2f(Pad + 210.f, PagerY1)), TEXT("‹  PREV"), EBtn::Edge, TEXT("page:prev"), LabelFont);
				Button(FBox2f(FVector2f(LW - Pad - 210.f, PagerY0), FVector2f(LW - Pad, PagerY1)), TEXT("NEXT  ›"), EBtn::Edge, TEXT("page:next"), LabelFont);
				Put(FBox2f(FVector2f(Pad + 210.f, PagerY0), FVector2f(LW - Pad - 210.f, PagerY1)), SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("PAGE %d OF %d"), ConsolePageAt + 1, Pages))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink))
					]);
			}
		}
	}
	// A row's own box sits under its buttons: the hit test reads the buttons first (the last added wins below).
	// The control a hand's ray is on, and the pad's selection: an amber edge.
	for (const FString& Lit : { ConsoleHover, bConsolePadSel ? ConsoleSel : FString(), ConsoleMark })
	{
		if (Lit.IsEmpty()) continue;
		if (const FConsoleBox* Box = ConsoleBoxes.FindByPredicate([&Lit](const FConsoleBox& Each) { return Each.Id == Lit; }))
		{
			Put(Box->Box.ExpandBy(4.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(5.f));
		}
	}
	const float Scale = ConsoleDrawPerLayout;
	TSharedRef<SOverlay> Sheet = SNew(SOverlay)
		+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(PX).RulePx(bConsoleOpen || bTalk ? 5.f : 4.f)]
		+ SOverlay::Slot()[Canvas];
	if (bConsoleFar && !bConsoleStage)
	{
		// Wave PJ1: thrown light has a soft edge. The quad stays opaque (no overdraw, nothing of the scene through it in your
		// room); its outer 36 layout px (about 7 cm on the wall) fall off to the studio's dark in six steps, drawn once.
		for (int32 Ring = 0; Ring < 6; ++Ring)
		{
			Sheet->AddSlot().Padding(Ring * 6.f)[SNew(BpSheet::SPlate).Edge(FLinearColor(0.012f, 0.016f, 0.026f, 0.9f - Ring * 0.15f)).EdgePx(6.f)];
		}
	}
	if (bConsoleFar && bConsoleStage)
	{
		// Wave PJ2, THE LIGHT STAGE: one render target over the whole arc. The ground is a sheet of blue light, brighter toward
		// its foot (the rim it rises from); the active sheet sits in the centre zone at the shared layout's own size; the flanks
		// carry what waits (left, Glim's side) and the active sheet's context (right), and stay dark when there is nothing.
		const FVector2f SL = ConsoleStageLayout;
		const FBox2D SheetUv = BpProjector::StageSheetUv();
		const FVector2f SheetAt(static_cast<float>(SheetUv.Min.X) * SL.X, static_cast<float>(SheetUv.Min.Y) * SL.Y);
		TSharedRef<SCanvas> Stage = SNew(SCanvas);
		const auto StagePut = [&Stage](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
		{
			Stage->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
		};
		constexpr int32 Bands = 8;
		for (int32 Band = 0; Band < Bands; ++Band)
		{
			// Top to bottom: the low paper's blue to the mid paper's, in eight steps (drawn once, in the target).
			const float T = static_cast<float>(Band) / (Bands - 1);
			StagePut(FBox2f(FVector2f(0.f, SL.Y * Band / Bands), FVector2f(SL.X, SL.Y * (Band + 1) / Bands + 1.f)),
				SNew(BpSheet::SPlate).Fill(FMath::Lerp(BpSheet::PaperLo * 1.3f, BpSheet::PaperMid * 0.95f, T * T).CopyWithNewOpacity(1.f)));
		}
		// The flanks: between the centre zone and the faded ends (the outer 15 degrees each side are atmosphere only).
		const float Gap = 56.f;
		const float FadeX = SL.X * 15.f / static_cast<float>(BpProjector::StageShape().ArcDeg);
		const float LeftX0 = FadeX + 24.f, LeftX1 = SheetAt.X - Gap;
		const float RightX0 = SheetAt.X + LW + Gap, RightX1 = SL.X - FadeX - 24.f;
		for (const bool bLeft : { true, false })
		{
			FString FlankTitle;
			TArray<FString> FlankLines;
			StageFlank(bLeft, FlankTitle, FlankLines);
			const float X0 = bLeft ? LeftX0 : RightX0, X1 = bLeft ? LeftX1 : RightX1;
			if ((FlankTitle.IsEmpty() && FlankLines.Num() == 0) || X1 - X0 < 160.f) continue;
			const FSlateFontInfo FlankTitleFont = Font(TEXT("Bold"), CapLabel), FlankFont = Font(TEXT("Regular"), CapSmall), FlankBold = Font(TEXT("Bold"), CapSmall);
			float Y = SheetAt.Y + 8.f;
			StagePut(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(FlankTitle, FlankTitleFont, X1 - X0))).Font(FlankTitleFont).ColorAndOpacity(FSlateColor(BpSheet::Accent)));
			Y += 52.f;
			StagePut(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
			Y += 16.f;
			const float Bottom = SheetAt.Y + LH;
			for (const FString& Line : FlankLines)
			{
				// "!" leads a line in amber (the one in hand), "*" a bold one; the rest regular. Each wraps to at most three lines.
				const bool bHot = Line.StartsWith(TEXT("!")), bBold = Line.StartsWith(TEXT("*"));
				const FString Words = bHot || bBold ? Line.Mid(1) : Line;
				const FSlateFontInfo& F = bHot || bBold ? FlankBold : FlankFont;
				const FString Wrapped = BpSheet::Wrap(Words, F, X1 - X0 - 28.f, 3);
				const float H = LineCount(Wrapped) * Pitch(CapSmall) + 14.f;
				if (Y + H > Bottom) break;
				if (bHot) StagePut(FBox2f(FVector2f(X0, Y + 4.f), FVector2f(X0 + 6.f, Y + H - 14.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Amber));
				StagePut(FBox2f(FVector2f(X0 + 20.f, Y), FVector2f(X1, Y + H)), SNew(STextBlock).Text(FText::FromString(Wrapped)).Font(F)
					.ColorAndOpacity(FSlateColor(bHot ? BpSheet::Amber : bBold ? BpSheet::InkHi : BpSheet::Ink.CopyWithNewOpacity(0.85f))));
				Y += H;
			}
		}
		StagePut(FBox2f(SheetAt, SheetAt + FVector2f(LW, LH)), Sheet);
		ConsolePanel->SetSlateWidget(
			SNew(SDPIScaler).DPIScale(Scale)
			[
				SNew(SBox).WidthOverride(SL.X).HeightOverride(SL.Y)
				[
					Stage
				]
			]);
	}
	else
	{
		ConsolePanel->SetSlateWidget(
			SNew(SDPIScaler).DPIScale(Scale)
			[
				SNew(SBox).WidthOverride(LW).HeightOverride(bConsoleOpen || bTalk ? LH : BarLH)
				[
					Sheet
				]
			]);
	}
	ConsolePanel->RequestRenderUpdate();
	++ConsoleDraws;
	if (bConsoleFar && ConsoleNearBar)
	{
		// Wave PJ2: the slim bar stays at the desk while the sheet is far (MENU, BACK, the place, the room switch).
		NearBarBoxes.Reset();
		TSharedRef<SCanvas> BarCanvas = SNew(SCanvas);
		Into = &BarCanvas.Get();
		Boxes = &NearBarBoxes;
		DrawBar();
		for (const FString& Lit : { ConsoleHover, bConsolePadSel ? ConsoleSel : FString() })
		{
			if (Lit.IsEmpty()) continue;
			if (const FConsoleBox* Box = NearBarBoxes.FindByPredicate([&Lit](const FConsoleBox& Each) { return Each.Id == Lit; }))
			{
				Put(Box->Box.ExpandBy(4.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(5.f));
			}
		}
		Into = &Canvas.Get();
		Boxes = &ConsoleBoxes;
		ConsoleNearBar->SetSlateWidget(
			SNew(SDPIScaler).DPIScale(ConsolePxPerCm / ConsoleLayoutPxPerCm)
			[
				SNew(SBox).WidthOverride(LW).HeightOverride(BarLH)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(PX).RulePx(4.f)]
					+ SOverlay::Slot()[BarCanvas]
				]
			]);
		ConsoleNearBar->RequestRenderUpdate();
	}
	if (bConsoleFar)
	{
		// Wave PJ1: what Glim turns to on the far sheet: the loupe's region on its screen, else the answer he waits for
		// (APPROVE), else the sheet's centre (table space, BpProjector::FarAimLocal).
		// Wave N3-W2: on a decision he presents (the loupe, else the title) and then asks (APPROVE), BpProjector::SetFarAims.
		const FConsoleBox* Primary = ConsoleBoxes.FindByPredicate([](const FConsoleBox& Each) { return Each.Id == TEXT("console:standup:approve"); });
		const bool bPoint = Primary && (LoupeAimLayout.X >= 0.f || TitleAimLayout.X >= 0.f);
		const FVector2f AimPx = LoupeAimLayout.X >= 0.f ? LoupeAimLayout : TitleAimLayout.X >= 0.f ? TitleAimLayout : Primary ? Primary->Box.GetCenter() : ConsoleLayout * 0.5f;
		const FVector2f AskPx = Primary ? Primary->Box.GetCenter() : AimPx;
		FTransform Pose = ConsolePanel->GetComponentTransform();
		Pose.SetScale3D(FVector::OneVector);
		const auto ToLocal = [&](const FVector2f& Px) { return Table->GetActorTransform().InverseTransformPosition(BpProjector::Surface().UvToWorld(Pose, ConsoleFarSizeCm, FVector2D(Px.X / ConsoleLayout.X, Px.Y / ConsoleLayout.Y))); };
		BpProjector::SetFarAims(ToLocal(AimPx), ToLocal(AskPx), bPoint);
		UE_LOG(LogBpTable, Log, TEXT("BpProjector: Glim's aim on the sheet: %s at layout (%.0f, %.0f)%s"), LoupeAimLayout.X >= 0.f ? TEXT("the loupe's region") : TitleAimLayout.X >= 0.f ? TEXT("the decision's title") : Primary ? TEXT("APPROVE") : TEXT("its centre"), AimPx.X, AimPx.Y,
			bPoint ? *FString::Printf(TEXT("; he points, then asks at APPROVE (%.0f, %.0f)"), AskPx.X, AskPx.Y) : TEXT(""));
	}
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: drawn #%d %s%s \"%s\" (%d controls)"), ConsoleDraws, bTalk ? TEXT("conversation ") : bConsoleOpen ? TEXT("panel ") : TEXT("bar"), bConsoleOpen ? *GetConsoleLine() : TEXT(""), *Status, ConsoleBoxes.Num());
}

// ---- The hands and the console's acts ----------------------------------------------------------------------------------

bool ABpPawn::ConsoleHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (!ConsolePanel || !ConsolePanel->IsVisible() || ConsoleBoxes.Num() == 0) return false;
	const FTransform& T = ConsolePanel->GetComponentTransform();
	// Wave PJ2: the near bar at the desk is in front of any far surface.
	if (bConsoleFar && NearBarHit(WorldOrigin, WorldDir, OutId)) return true;
	if (bConsoleFar)
	{
		// Wave PJ1: the far surface answers the ray (IBpFarSurface: the throw's plane now, the stage's curve next).
		FVector2D Uv;
		FTransform Pose = T;
		Pose.SetScale3D(FVector::OneVector);
		if (!BpProjector::Surface().RayToUv(Pose, ConsoleFarSizeCm, WorldOrigin, WorldDir, Uv)) return false;
		const FVector2f FarPx(static_cast<float>(Uv.X) * ConsoleLayout.X, static_cast<float>(Uv.Y) * ConsoleLayout.Y);
		for (int32 Index = ConsoleBoxes.Num() - 1; Index >= 0; --Index)
		{
			if (ConsoleBoxes[Index].Box.IsInside(FarPx)) { OutId = ConsoleBoxes[Index].Id; return true; }
		}
		OutId = TEXT("console:panel");
		return true;
	}
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (Denom >= -KINDA_SMALL_NUMBER) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	// UWidgetComponent's mapping: widget x = -local Y, y = -local Z from its pivot, in draw px; then the layout's px.
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const FVector2D Draw = ConsolePanel->GetDrawSize();
	const float ToLayout = 1.f / ConsoleDrawPerLayout;
	const FVector2f Px(static_cast<float>((-Local.Y + Draw.X * 0.5) * ToLayout), static_cast<float>((-Local.Z + Draw.Y * 0.5) * ToLayout));
	if (Px.X < 0.f || Px.Y < 0.f || Px.X > ConsoleLayout.X || Px.Y > ConsoleLayout.Y) return false;
	// The last box laid out over a point wins (a row's buttons over the row).
	for (int32 Index = ConsoleBoxes.Num() - 1; Index >= 0; --Index)
	{
		if (ConsoleBoxes[Index].Box.IsInside(Px))
		{
			OutId = ConsoleBoxes[Index].Id;
			return true;
		}
	}
	// On the panel but on no control: the panel still takes the ray (it is in front of the table).
	OutId = TEXT("console:panel");
	return true;
}

bool ABpPawn::PanelHitPoint(const FString& Kind, const FVector& WorldOrigin, const FVector& WorldDir, FVector& OutWorld) const
{
	// A flat panel facing +X (a world widget): where the ray crosses its plane, from the front only.
	const auto Plane = [&](const UWidgetComponent* Panel) -> bool
	{
		if (!Panel || !Panel->IsVisible()) return false;
		const FTransform& T = Panel->GetComponentTransform();
		const FVector Normal = T.GetUnitAxis(EAxis::X);
		const double Denom = FVector::DotProduct(WorldDir, Normal);
		if (Denom >= -KINDA_SMALL_NUMBER) return false;
		const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
		if (Along < 0.0) return false;
		OutWorld = WorldOrigin + WorldDir * Along;
		return true;
	};
	if (Kind == TEXT("wrist")) return Plane(WristPanel);
	if (Kind != TEXT("console")) return false;
	if (!bConsoleFar) return Plane(ConsolePanel);
	// The near bar at the desk is in front of the far sheet (ConsoleHit's order).
	FString NearId;
	if (NearBarHit(WorldOrigin, WorldDir, NearId)) return Plane(ConsoleNearBar);
	if (!ConsolePanel) return false;
	FTransform Pose = ConsolePanel->GetComponentTransform();
	Pose.SetScale3D(FVector::OneVector);
	FVector2D Uv;
	if (!BpProjector::Surface().RayToUv(Pose, ConsoleFarSizeCm, WorldOrigin, WorldDir, Uv)) return false;
	OutWorld = BpProjector::Surface().UvToWorld(Pose, ConsoleFarSizeCm, Uv);
	return true;
}

bool ABpPawn::ConsoleAim(const FString& Id, FVector& OutWorld) const
{
	const FConsoleBox* Box = ConsoleBoxes.FindByPredicate([&Id](const FConsoleBox& Each) { return Each.Id == Id; });
	if (bConsoleFar && !Box && ConsoleNearBar && ConsoleNearBar->IsVisible())
	{
		// Wave PJ2: a control of the near bar at the desk.
		if (const FConsoleBox* Near = NearBarBoxes.FindByPredicate([&Id](const FConsoleBox& Each) { return Each.Id == Id; }))
		{
			const FVector2f NC = Near->Box.GetCenter() * (ConsolePxPerCm / ConsoleLayoutPxPerCm);
			const FVector2D NDraw = ConsoleNearBar->GetDrawSize();
			OutWorld = ConsoleNearBar->GetComponentTransform().TransformPosition(FVector(0.0, -(NC.X - NDraw.X * 0.5), -(NC.Y - NDraw.Y * 0.5)));
			return true;
		}
	}
	if (!ConsolePanel || !Box) return false;
	const FVector2f C = Box->Box.GetCenter();
	if (bConsoleFar)
	{
		FTransform Pose = ConsolePanel->GetComponentTransform();
		Pose.SetScale3D(FVector::OneVector);
		OutWorld = BpProjector::Surface().UvToWorld(Pose, ConsoleFarSizeCm, FVector2D(C.X / ConsoleLayout.X, C.Y / ConsoleLayout.Y));
		return true;
	}
	const FVector2D Draw = ConsolePanel->GetDrawSize();
	const float ToDraw = ConsoleDrawPerLayout;
	OutWorld = ConsolePanel->GetComponentTransform().TransformPosition(FVector(0.0, -(C.X * ToDraw - Draw.X * 0.5), -(C.Y * ToDraw - Draw.Y * 0.5)));
	return true;
}

void ABpPawn::SetConsoleHover(const FString& Id, bool bDown)
{
	const FString Lit = Id == TEXT("console:panel") ? FString() : Id;
	const bool bHeld = bDown && !Lit.IsEmpty();
	if (Lit == ConsoleHover && bHeld == bConsoleHoverDown) return;
	const bool bSameLit = Lit == ConsoleHover;
	// Wave N3-W1: on the far sheet the ray's hit lights the control as on the desk; logged once per change (the proof).
	if (!bSameLit && bConsoleFar) UE_LOG(LogBpTable, Log, TEXT("BpConsole: the ray's focus on the far sheet: %s"), Lit.IsEmpty() ? TEXT("none") : *Lit);
	ConsoleHover = Lit;
	bConsoleHoverDown = bHeld;
	if (bSameLit) { RefreshConsole(); return; }
	// A hand is pointing: the pad's selection steps back until the pad is used again.
	if (!Lit.IsEmpty()) bConsolePadSel = false;
	RefreshConsole();
}

void ABpPawn::SetConsoleMark(const FString& Id)
{
	if (Id == ConsoleMark) return;
	ConsoleMark = Id;
	RefreshConsole();
	// Wave EV: a mark may be on the wrist (`wrist:talk`, the tour's talk step).
	DrawWrist();
}

void ABpPawn::ConsoleTap(const FString& Id)
{
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: tap %s"), *Id);
	if (!Id.StartsWith(TEXT("console:"))) return;
	const FString Act = Id.Mid(8);
	ABpTable* Table = WristTable.Get();
	if (Act == TEXT("panel")) return;
	// The tour counts a console press as the person acting (wave T1: a step that only shows waits for one, or the idle wait).
	if (Table) Table->NoteHand(TEXT("console"));
	if (Act == TEXT("tour:stop")) { if (Table) Table->StopTour(TEXT("STOP TOUR")); return; }
	if (Act == TEXT("menu")) { if (bConsoleOpen) CloseConsole(); else OpenConsole(FString()); return; }
	if (Act == TEXT("close")) { CloseConsole(); return; }
	if (Act == TEXT("home")) { OpenConsole(TEXT("home")); return; }
	if (Act == TEXT("back")) { ConsoleBack(); return; }
	if (Act.StartsWith(TEXT("open:"))) { OpenConsole(Act.Mid(5)); return; }
	if (Act == TEXT("page:next") || Act == TEXT("page:prev"))
	{
		ConsolePageAt = FMath::Max(0, ConsolePageAt + (Act.EndsWith(TEXT("next")) ? 1 : -1));
		ConsoleSel.Reset();
		RefreshConsole();
		return;
	}
	if (Act == TEXT("bar:back"))
	{
		// BACK on the bar: one level up; from room mode, back to the site plan (Back() leaves room mode).
		if (Table) Table->Back();
		return;
	}
	if (Act == TEXT("bar:pc"))
	{
		ShowOnPc();
		return;
	}
	// The conversation's own controls (night two V2): STOP cancels the talk in flight, CLOSE clears the words at once.
	if (Act == TEXT("talk:stop")) { if (Table) Table->TalkCancel(TEXT("the console")); return; }
	if (Act == TEXT("talk:close")) { if (Table) Table->TalkDismiss(); return; }
	const FBpConsolePage* Page = FBpConsolePages::Find(ConsolePageKey);
	if (Page && Page->Tap && Page->Tap(*this, Act)) { RefreshConsole(); return; }
	PanelAct(Act);
	RefreshConsole();
}

void ABpPawn::ShowOnPc()
{
	ABpTable* Table = WristTable.Get();
	if (!Table) return;
	FString Where;
	FBpFollowPlace Place = Table->RestingPlace(Where);
	if (Place.Say.IsEmpty()) Place.Say = Where;
	ConsoleBarWords = TEXT("Sending the place to your PC");
	ConsoleBarWordsUntil = FPlatformTime::Seconds() + 6.0;
	RefreshConsole();
	TWeakObjectPtr<ABpPawn> Self(this);
	FBpLinkModule::Get().ShowOnPc(Place, [Self](bool bOk, const FString& Words)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn) return;
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: show on PC: %s"), *Words);
		Pawn->ConsoleBarWords = Words;
		Pawn->ConsoleBarWordsUntil = FPlatformTime::Seconds() + 6.0;
		Pawn->RefreshConsole();
		// The words go back to the status when their time is up: one redraw, by timer.
		if (UWorld* World = Pawn->GetWorld())
		{
			FTimerHandle Once;
			World->GetTimerManager().SetTimer(Once, FTimerDelegate::CreateWeakLambda(Pawn, [Pawn]() { Pawn->ConsoleBarWords.Reset(); Pawn->RefreshConsole(); }), 6.1f, false);
		}
	});
}

void ABpPawn::TickConsoleClock()
{
	// The SCAN page's clocks, once a second while it is open; the redraw happens only when a word changed (RefreshConsole's key).
	if (!bConsoleOpen || ConsolePageKey != TEXT("scan"))
	{
		GetWorldTimerManager().ClearTimer(ConsoleClockTimer);
		return;
	}
	RefreshConsole();
}

void ABpPawn::ConsoleMove(int32 DX, int32 DY)
{
	if (!bConsoleOpen || ConsoleBoxes.Num() == 0) return;
	bConsolePadSel = true;
	const FConsoleBox* From = ConsoleBoxes.FindByPredicate([this](const FConsoleBox& Each) { return Each.Id == ConsoleSel; });
	if (!From)
	{
		// The first press lands on the first row (or HOME's first tile), not on BACK or CLOSE.
		const FConsoleBox* First = nullptr;
		for (const FConsoleBox& Each : ConsoleBoxes)
		{
			if (Each.Box.Min.Y < RowsY0 - 20.f) continue;
			if (!First || Each.Box.Min.Y < First->Box.Min.Y - 1.f || (FMath::Abs(Each.Box.Min.Y - First->Box.Min.Y) <= 1.f && Each.Box.Min.X < First->Box.Min.X)) First = &Each;
		}
		ConsoleSel = (First ? First : &ConsoleBoxes[0])->Id;
		RefreshConsole();
		return;
	}
	// The nearest control whose centre lies that way, a sideways offset counting twice its distance.
	const FVector2f At = From->Box.GetCenter(), Dir(static_cast<float>(DX), static_cast<float>(DY));
	const FConsoleBox* Best = nullptr;
	float BestScore = TNumericLimits<float>::Max();
	for (const FConsoleBox& Each : ConsoleBoxes)
	{
		if (&Each == From || Each.Id == From->Id) continue;
		const FVector2f D = Each.Box.GetCenter() - At;
		const float Along = D.X * Dir.X + D.Y * Dir.Y;
		if (Along <= 4.f) continue;
		const float Side = FMath::Abs(D.X * Dir.Y - D.Y * Dir.X);
		const float Score = Along + 2.f * Side;
		if (Score < BestScore) { BestScore = Score; Best = &Each; }
	}
	if (Best) ConsoleSel = Best->Id;
	else if (DX != 0 && ConsoleBoxes.ContainsByPredicate([DX](const FConsoleBox& Each) { return Each.Id == (DX > 0 ? TEXT("console:page:next") : TEXT("console:page:prev")); }))
	{
		// Off the edge sideways: the next or previous page.
		ConsoleTap(DX > 0 ? TEXT("console:page:next") : TEXT("console:page:prev"));
		return;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: select %s"), *ConsoleSel);
	RefreshConsole();
}

void ABpPawn::ConsoleTextClasses(TArray<BpType::FClassSample>& Out) const
{
	if (!ConsolePanel) return;
	const FTransform& T = ConsolePanel->GetComponentTransform();
	// The world scale is cm a draw pixel; a layout pixel is ConsoleDrawPerLayout of those (the desk's and the far sheet's alike).
	const double CmPerLayoutPx = T.GetScale3D().X * ConsoleDrawPerLayout;
	const auto Add = [&](const TCHAR* Name, double CapPx) { Out.Add({ Name, CapPx * CmPerLayoutPx, T.GetLocation(), T.GetUnitAxis(EAxis::Z) }); };
	Add(TEXT("console title"), CapTitle);
	Add(TEXT("console label"), CapLabel);
	Add(TEXT("console detail"), CapSmall);
	Add(TEXT("console bar status"), CapBarStatus);
}

// ---- The conversation with the lamp (night two V2) -----------------------------------------------------------------------
// The owner's device test, 2026-11-10: the lamp's caption was a small tilted box far left, on a pin tag, cut after two lines
// while the voice went on for 23 s. Here the exchange fills the console's panel, readable from the seat: the words heard (a
// mishearing is visible), the state (LISTENING with its level, THINKING, ANSWERING), and the reply whole, wrapped at the
// console's text size. It clears itself bp.TalkLingerS after the voice ends, on CLOSE, or on B; a card the turn raised takes
// its place as a decision sheet (StandupShowCompanionCards).

void ABpPawn::DrawConversation(const TSharedRef<SCanvas>& Canvas, const FString& Word, const FString& Heard, const FString& Reply, const FString& Line, float Level, bool bSample)
{
	const auto Put = [&Canvas](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Canvas->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const FSlateFontInfo TitleFont = Font(TEXT("Bold"), CapTitle), LabelFont = Font(TEXT("Bold"), CapLabel), SmallFont = Font(TEXT("Regular"), CapSmall), SmallBold = Font(TEXT("Bold"), CapSmall);
	const bool bListening = Word == TEXT("LISTENING") || Word == TEXT("MICROPHONE");
	const bool bInFlight = !Word.IsEmpty();
	// The header: the lamp, drawn; THE LAMP; the state as a chip; STOP while it is in flight, else CLOSE.
	Put(FBox2f(FVector2f(Pad - 6.f, HeadY0 - 6.f), FVector2f(Pad + 70.f, HeadY1 + 6.f)), SNew(BpSheet::SMotif).Kind(2));
	Put(FBox2f(FVector2f(Pad + 84.f, HeadY0), FVector2f(Pad + 360.f, HeadY1)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(TEXT("GLIM"))).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
	const FString State = bInFlight ? Word : bSample ? FString(TEXT("SAMPLE")) : FString(TEXT("ANSWERED"));
	const bool bAmber = bListening || State == TEXT("SAMPLE");
	const bool bSolid = bListening || Word == TEXT("ANSWERING") || Word == TEXT("SAMPLE");
	const float ChipX = Pad + 84.f + BpSheet::TextWidth(TEXT("GLIM"), TitleFont) + 24.f;
	Put(FBox2f(FVector2f(ChipX, HeadY0 + 13.f), FVector2f(ChipX + BpSheet::ChipWidth(State, SmallBold), HeadY1 - 13.f)), BpSheet::Chip(State, SmallBold, 44.f, bAmber ? BpSheet::Amber : BpSheet::Accent, bSolid));
	{
		const FBox2f Box(FVector2f(LW - Pad - 190.f, HeadY0), FVector2f(LW - Pad, HeadY1));
		const FString Act = bInFlight ? TEXT("console:talk:stop") : TEXT("console:talk:close");
		const bool bLit = Act == ConsoleHover;
		Put(Box, SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(BpSheet::RowFill(bLit)).Edge(BpSheet::Ink.CopyWithNewOpacity(bLit ? 1.f : 0.7f)).EdgePx(2.5f)]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(bInFlight ? TEXT("STOP") : TEXT("CLOSE"))).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
		ConsoleBoxes.Add({ Act, Box });
	}
	const FString Sub = bListening ? FString(TEXT("Speak now · let go to send · up to 30 s"))
		: Word == TEXT("HEARING") ? FString(TEXT("Turning your words into text on your PC"))
		: Word == TEXT("THINKING") ? FString(TEXT("Your PC's companion is thinking · B or a pinch on Glim cancels"))
		: Word == TEXT("ANSWERING") ? FString(TEXT("Spoken aloud · B stops it · it clears after the voice"))
		: bSample ? FString(TEXT("A sample exchange: no microphone, nothing sent"))
		: FString(TEXT("This clears itself in a moment · CLOSE clears it now"));
	Put(FBox2f(FVector2f(Pad, SubY), FVector2f(LW - Pad, SubY + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::CutWords(Sub, SmallFont, LW - 2.f * Pad))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
	Put(FBox2f(FVector2f(Pad, SubY + 46.f), FVector2f(LW - Pad, SubY + 48.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
	const float X0 = Pad + 24.f, X1 = LW - Pad - 24.f;
	float Y = 172.f;
	if (bListening)
	{
		// Listening: the level as a row of cells, amber up to the voice's level (eight steps, one redraw a step).
		Put(FBox2f(FVector2f(X0, 192.f), FVector2f(X1, 262.f)), SNew(STextBlock).Text(FText::FromString(Word == TEXT("LISTENING") ? TEXT("I am listening.") : TEXT("Opening the microphone"))).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		const int32 Cells = 24, Lit = FMath::RoundToInt(FMath::Clamp(Level, 0.f, 1.f) * Cells);
		const float Gap = 8.f, CellW = (X1 - X0 - Gap * (Cells - 1)) / Cells;
		for (int32 I = 0; I < Cells; ++I)
		{
			const float CX = X0 + I * (CellW + Gap);
			const float H = 40.f + 60.f * FMath::Sin(UE_PI * (I + 0.5f) / Cells);
			Put(FBox2f(FVector2f(CX, 400.f - H), FVector2f(CX + CellW, 400.f)), SNew(BpSheet::SPlate).Fill(I < Lit ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.08f)).Edge(I < Lit ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.3f)).EdgePx(1.5f));
		}
		Put(FBox2f(FVector2f(X0, 440.f), FVector2f(X1, 490.f)), SNew(STextBlock).Text(FText::FromString(TEXT("Let go of X, the pinch or TALK to send what you said."))).Font(Font(TEXT("Regular"), CapLabel)).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
		Put(FBox2f(FVector2f(X0, 500.f), FVector2f(X1, 540.f)), SNew(STextBlock).Text(FText::FromString(TEXT("Nothing is sent before you let go; nothing you say is kept."))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.6f))));
		return;
	}
	if (!Heard.IsEmpty())
	{
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + 34.f)), SNew(STextBlock).Text(FText::FromString(TEXT("YOU SAID"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.65f))));
		Y += 38.f;
		const FString Said = BpSheet::Wrap(FString::Printf(TEXT("“%s”"), *Heard), TitleFont, X1 - X0, 2);
		const float H = LineCount(Said) * Pitch(CapTitle);
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + H + 4.f)), SNew(STextBlock).Text(FText::FromString(Said)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		Y += H + 14.f;
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.3f)));
		Y += 16.f;
	}
	if (bConsoleFar)
	{
		// Wave N3-W1, the wall: Glim's name as a chip (who speaks, read from the seat).
		const FString Name = bSample ? TEXT("GLIM · SAMPLE") : TEXT("GLIM");
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X0 + BpSheet::ChipWidth(Name, SmallBold), Y + 42.f)), BpSheet::Chip(Name, SmallBold, 42.f, bSample ? BpSheet::Amber : BpSheet::Accent, true));
		Y += 54.f;
	}
	else
	{
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + 34.f)), SNew(STextBlock).Text(FText::FromString(bSample ? TEXT("GLIM · SAMPLE") : TEXT("GLIM"))).Font(SmallBold).ColorAndOpacity(FSlateColor(bSample ? BpSheet::Amber : BpSheet::Accent)));
		Y += 40.f;
	}
	FString Body = !Reply.IsEmpty() ? Reply : Line;
	if (Word == TEXT("THINKING")) Body = TEXT("Thinking");
	// A line of the lamp's own (no PC, a refusal): its first line is the headline, the rest under it.
	if (Heard.IsEmpty() && Reply.IsEmpty())
	{
		FString First, Rest;
		if (!Body.Split(TEXT("\n"), &First, &Rest)) { First = Body; Rest.Reset(); }
		const FString HeadFit = BpSheet::Wrap(First, TitleFont, X1 - X0, 2);
		const float H = LineCount(HeadFit) * Pitch(CapTitle);
		Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + H + 4.f)), SNew(STextBlock).Text(FText::FromString(HeadFit)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		Y += H + 12.f;
		Body = Rest;
	}
	if (Body.IsEmpty()) return;
	// The reply whole, at the console's text size: 28 px while it fits, 24 px (the floor) when it is long.
	const float Avail = LH - 30.f - Y;
	const bool bQuiet = Word == TEXT("THINKING");
	FSlateFontInfo BodyFont = Font(bQuiet ? TEXT("Bold") : TEXT("Regular"), bQuiet ? CapTitle : CapLabel);
	float P = Pitch(bQuiet ? CapTitle : CapLabel);
	FString Fit = BpSheet::Wrap(Body, BodyFont, X1 - X0, 0);
	// Wave N3-W1, the wall: the reply a step larger while it fits (32 px: 69 arc minutes at 2.6 m), then the desk's steps.
	if (bConsoleFar && !bQuiet)
	{
		const FSlateFontInfo Big = Font(TEXT("Regular"), 32.f);
		const FString BigFit = BpSheet::Wrap(Body, Big, X1 - X0, 0);
		if (LineCount(BigFit) * Pitch(32.f) <= Avail) { BodyFont = Big; P = Pitch(32.f); Fit = BigFit; }
	}
	if (LineCount(Fit) * P > Avail)
	{
		BodyFont = Font(TEXT("Regular"), CapSmall);
		P = Pitch(CapSmall);
		Fit = BpSheet::Wrap(Body, BodyFont, X1 - X0, FMath::Max(1, FMath::FloorToInt(Avail / P)));
	}
	Put(FBox2f(FVector2f(X0, Y), FVector2f(X1, Y + LineCount(Fit) * P + 6.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(BodyFont).ColorAndOpacity(FSlateColor(bQuiet ? BpSheet::Ink.CopyWithNewOpacity(0.7f) : BpSheet::InkHi)));
}
