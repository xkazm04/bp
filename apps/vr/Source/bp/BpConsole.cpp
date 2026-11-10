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
#include "BpLink.h"
#include "BpSheet.h"
#include "BpTable.h"
#include "BpType.h"
#include "BpWords.h"
#include "Components/WidgetComponent.h"
#include "HAL/IConsoleManager.h"
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

	TAutoConsoleVariable<int32> CVarConsole(TEXT("bp.Console"), 1, TEXT("The console (the main menu in the deck's slot): 1 shown (default), 0 hidden (a profiling baseline: its draw is the difference)."), ECVF_Default);

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
		TEXT("BpConsole.Open [page]: opens the console on a page (home, rooms, scan, standup, ask, projects, packages, settings); BpConsole.Open close puts it back to its bar."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = ConsolePawn(World);
			if (!Pawn) return;
			if (Args.Num() > 0 && Args[0] == TEXT("close")) Pawn->CloseConsole();
			else Pawn->OpenConsole(Args.Num() > 0 ? Args[0] : FString());
		}));
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
			{ TEXT("projects"), TEXT("PROJECTS"), TEXT("E"), &ProjectsRows, &ProjectsSummary, nullptr, nullptr },
			{ TEXT("packages"), TEXT("PACKAGES"), TEXT("F"), &PackagesRows, &PackagesSummary, nullptr, nullptr },
			{ TEXT("settings"), TEXT("SETTINGS"), TEXT("G"), &SettingsRows, &SettingsSummary, nullptr, nullptr },
			{ TEXT("link"), TEXT("PC LINK"), TEXT("H"), &LinkRows, &LinkSummary, &LinkOpen, nullptr },
		};
		return Pages;
	}

	static const FBpConsolePage* Find(const FString& Key)
	{
		// TALK is the consent sheet (BpTalk.cpp): opened by the first hold to talk and from SETTINGS, never a HOME tile.
		static const FBpConsolePage Talk = { TEXT("talk"), TEXT("TALK TO THE LAMP"), TEXT("T"), &TalkRows, &TalkSummary, nullptr, nullptr };
		if (Key == Talk.Key) return &Talk;
		return Registry().FindByPredicate([&Key](const FBpConsolePage& Page) { return Key == Page.Key; });
	}

	// TALK: the consent sheet, in plain words (voice-io on-device-vs-cloud: disclosed, chosen affirmatively, revocable in one
	// step, visibly active while in use). Nothing is recorded or sent before ALLOW.
	static void TalkRows(ABpPawn&, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		const int32 Consent = ABpTable::TalkConsent();
		Sub = Consent == 1 ? FString(TEXT("Allowed · SETTINGS › TALK turns it off")) : FString(TEXT("Your choice · you can change it in SETTINGS"));
		Out.Add(Note(TEXT("Hold X, pinch and hold the lamp, or hold TALK on your wrist, and speak. Let go to send. The lamp says LISTENING while the microphone is on.")));
		Out.Add(Note(TEXT("Your voice goes to your PC, and from your PC to a cloud speech service that turns it into words. The lamp's answer is spoken the same way."), 2));
		Out.Add(Note(TEXT("Nothing you say is kept, on this headset or on your PC. The microphone is on only while you hold.")));
		FBpConsoleRow Row;
		Row.Label = TEXT("Talk to the lamp?");
		Row.Detail = TEXT("Without it, MENU › ASK still asks the lamp");
		Row.Buttons = { { TEXT("NOT NOW"), TEXT("talk:notnow") }, { TEXT("ALLOW"), TEXT("talk:allow"), true } };
		Row.Tone = Consent == 1 ? 1 : 0;
		Out.Add(Row);
	}
	static FString TalkSummary(ABpPawn&) { return ABpTable::TalkConsent() == 1 ? TEXT("Allowed") : TEXT("Not allowed"); }

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
			Next.Detail = TEXT("The lamp picks it and says why");
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
			Out.Add(Note(TEXT("Waiting for your PC's scan list… (PC LINK says how this headset reaches it)")));
			return;
		}
		Sub = Pawn.bWristScanStarting ? FString(TEXT("Starting the scan…"))
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
			FBpConsoleRow Row;
			Row.Label = bThis ? FString::Printf(TEXT("Scan %s?"), *PlaceWords) : bEvery ? FString(TEXT("Every lens, everything?")) : FString::Printf(TEXT("Scan %s"), *PlaceWords);
			Row.Detail = bThis || bEvery ? FString(TEXT("Press again to start · anything else cancels"))
				: bSample ? FString::Printf(TEXT("%s · a sample walk"), *LensWords) : FString::Printf(TEXT("%s · or every lens at once"), *LensWords);
			Row.Tone = bThis || bEvery ? 2 : 0;
			Row.Buttons = { { bThis ? TEXT("START") : TEXT("SCAN THIS"), TEXT("scan:this"), bThis } };
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
		const FBpLinkStatus& S = FBpLinkModule::Get().GetLinkStatus();
		Sub = TEXT("How this headset reaches your PC, and what it may do there");
		{
			FBpConsoleRow Row;
			Row.Label = FBpLinkModule::RouteWords(S);
			Row.Detail = S.Route != EBpLinkRoute::None ? FString::Printf(TEXT("Your PC at %s"), *S.BaseUrl.Replace(TEXT("http://"), TEXT("")))
				: S.bBundleOnly ? FString(TEXT("This build was started to read its sample only"))
				: FString(TEXT("Looking for your PC every 5 s: the cable first, then Wi-Fi"));
			Row.Tag = FBpLinkModule::RouteWord(S);
			Row.Tone = S.Route != EBpLinkRoute::None ? 1 : 2;
			Out.Add(Row);
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
			Out.Add(Note(FString::Printf(TEXT("On the PC type:  npm run server -- pair approve %s --scope %s"), *S.Code, FBpLinkModule::PairScopes), 2));
			FBpConsoleRow Cancel;
			Cancel.Label = TEXT("Waiting for your PC to approve");
			Cancel.Detail = TEXT("The code lasts two minutes");
			Cancel.Buttons = { { TEXT("CANCEL"), TEXT("link:cancel") } };
			Out.Add(Cancel);
		}
		else if (S.Pair == EBpPairState::Asking)
		{
			Out.Add(Note(TEXT("Asking the PC for a code…"), 2));
		}
		else if (S.Pair == EBpPairState::Paired)
		{
			FBpConsoleRow Row;
			Row.Label = FString::Printf(TEXT("Paired as %s"), S.Device.IsEmpty() ? TEXT("this headset") : *S.Device);
			FDateTime Until;
			Row.Detail = FString::Printf(TEXT("Token …%s%s"), *S.TokenTail, FDateTime::ParseIso8601(*S.ExpiresAt, Until) ? *FString::Printf(TEXT(" · until %s"), *Until.ToString(TEXT("%Y-%m-%d"))) : TEXT(""));
			Row.Buttons = { { TEXT("UNPAIR"), TEXT("link:unpair") }, { TEXT("PAIR AGAIN"), TEXT("link:pair") } };
			Out.Add(Row);
			TArray<FString> Can;
			for (const FString& Scope : S.Scopes) Can.Add(FBpLinkModule::ScopeWords(Scope));
			Out.Add(Note(Can.Num() > 0 ? TEXT("It may ") + FString::Join(Can, TEXT(", ")) + TEXT(".") : FString(TEXT("The PC has not said what it may do yet."))));
		}
		else
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("Not paired");
			Row.Detail = S.Route != EBpLinkRoute::None ? FString(TEXT("PAIR shows a code; you approve it on the PC")) : FString(TEXT("Connect first: the cable, or the PC's server"));
			Row.Buttons = { { TEXT("PAIR"), TEXT("link:pair"), S.Route != EBpLinkRoute::None } };
			Out.Add(Row);
			Out.Add(Note(TEXT("Paired, it may run the stand-up, make your decisions, start and cancel scans, and reach your PC over Wi-Fi.")));
		}
		{
			FBpConsoleRow Row;
			Row.Label = S.WifiUrl.IsEmpty() ? FString(TEXT("No Wi-Fi door known")) : FString::Printf(TEXT("Wi-Fi door %s"), *S.WifiUrl.Replace(TEXT("http://"), TEXT("")));
			Row.Detail = S.WifiUrl.IsEmpty() ? FString(TEXT("Learned from the PC over the cable (its server runs with --lan)")) : FString(TEXT("Used when the cable is out, once paired"));
			if (S.Route == EBpLinkRoute::Cable) Row.Buttons = { { TEXT("ASK PC"), TEXT("link:where") } };
			Out.Add(Row);
		}
		if (!S.Message.IsEmpty() && S.Pair != EBpPairState::Waiting) Out.Add(Note(S.Message, S.bMessageBad ? 3 : 4));
	}
	static FString LinkSummary(ABpPawn&)
	{
		const FBpLinkStatus& S = FBpLinkModule::Get().GetLinkStatus();
		if (S.Pair == EBpPairState::Waiting) return FString::Printf(TEXT("Code %s · approve it on the PC"), *S.Code);
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
		if (!FBpLinkModule::Get().HasPcLink()) return TEXT("The sample morning · 3 decisions");
		return Waiting > 0 ? FString::Printf(TEXT("The morning · %d %s waiting"), Waiting, Waiting == 1 ? TEXT("decision") : TEXT("decisions")) : FString(TEXT("The morning · nothing waiting"));
	}

	// ASK: the lamp's three asks (the wrist's ASK tab), its last answer, and what that answer offers.
	static void AskRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		if (!Plan(Pawn)) { Sub = TEXT("The lamp"); Out.Add(Note(TEXT("The lamp answers once the plan has arrived."))); return; }
		ABpTable* T = Table(Pawn);
		Sub = T->IsLampAsking() ? FString(TEXT("Asking the companion…")) : FString(TEXT("Ask the lamp; it answers from the store, and the companion with your PC"));
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
	}
	static FString AskSummary(ABpPawn& Pawn)
	{
		return Plan(Pawn) && !Table(Pawn)->LampOfferLabel().IsEmpty() ? Table(Pawn)->LampOfferLabel() : FString(TEXT("Three questions for the lamp"));
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
			Out.Add(Note(Link.IsFromBundle() ? FString(TEXT("Offline: this build carries one sample project. Your PC lists your real ones once it is linked (PC LINK).")) : FString(TEXT("Reading the projects…"))));
			return;
		}
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
			else if (E.IsStopped()) Row.Detail = E.Phase.IsEmpty() ? FString(TEXT("Stopped")) : FString::Printf(TEXT("Stopped at %s"), *FBpLinkModule::PhaseLabel(E.Phase));
			else Row.Detail = E.bHasMap ? TEXT("Ready") : TEXT("No map yet");
			// The built-in sample says so (night two W2a): the PC's own products are the real ones.
			if (E.Slug == TEXT("kettle")) Row.Detail = TEXT("The sample · ") + Row.Detail;
			Row.Tag = bHere ? TEXT("HERE") : E.IsBuilding() ? TEXT("WATCH") : TEXT("OPEN");
			Row.Tone = bHere ? 1 : E.IsBuilding() || E.State == TEXT("queued") ? 2 : E.IsStopped() ? 3 : 0;
			Out.Add(Row);
		}
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
		if (Rows.Num() == 0) { Out.Add(Note(TEXT("No draft yet. Approve a decision to start one."))); return; }
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
		const auto Value = [&Out](const TCHAR* Label, const TCHAR* Detail, float Level, const TCHAR* Minus, const TCHAR* Plus)
		{
			FBpConsoleRow Row;
			Row.Label = Label;
			Row.Detail = Detail;
			Row.Tag = Percent(Level);
			Row.Tone = Level <= 0.f ? 2 : 0;
			Row.Buttons = { { TEXT("−"), Minus }, { TEXT("+"), Plus } };
			Out.Add(Row);
		};
		Value(TEXT("VOICE"), TEXT("The lamp's voice"), BpAudio::VoiceLevel(), TEXT("voice:minus"), TEXT("voice:plus"));
		Value(TEXT("MUSIC"), BpAudio::MusicLevel() > 0.f ? TEXT("The background music") : TEXT("Off: no stream"), BpAudio::MusicLevel(), TEXT("music:minus"), TEXT("music:plus"));
		const bool bTour = Plan(Pawn) && Table(Pawn)->IsTourRunning();
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("TABLE");
			Row.Detail = TEXT("To your seat · the lamp's tour");
			Row.Buttons = { { TEXT("SEAT"), TEXT("seat") }, { bTour ? TEXT("STOP TOUR") : TEXT("TOUR"), TEXT("tour"), bTour } };
			Out.Add(Row);
		}
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("WRIST");
			Row.Detail = TEXT("How it turns · which hand");
			Row.Buttons = { { CvarInt(TEXT("bp.WristFace")) != 0 ? TEXT("FACES YOU") : TEXT("FIXED"), TEXT("toggle:face") }, { CvarInt(TEXT("bp.WristHand")) != 0 ? TEXT("RIGHT") : TEXT("LEFT"), TEXT("toggle:hand") } };
			Out.Add(Row);
		}
		{
			FBpConsoleRow Row;
			Row.Label = TEXT("MOTION");
			Row.Detail = TEXT("Levels ease, or change at once");
			Row.Buttons = { { CvarInt(TEXT("bp.ReducedMotion")) != 0 ? TEXT("REDUCED") : TEXT("FULL"), TEXT("toggle:motion") } };
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
	ConsolePageKey = TEXT("home");
	PlaceConsole();
}

void ABpPawn::PlaceConsole()
{
	ABpTable* Table = WristTable.Get();
	if (!ConsolePanel || !Table) return;
	const bool bRoom = !Table->GetRoomModeId().IsEmpty();
	const FString Key = FString::Printf(TEXT("%d%d"), bConsoleOpen, bRoom);
	// The draw size follows what it shows (the bar's or the panel's), at ConsolePxPerCm.
	const float HeightCm = bConsoleOpen ? ConsoleHeightCm : ConsoleBarHeightCm;
	const FVector2D Draw(FMath::RoundToInt(ConsoleWidthCm * ConsolePxPerCm), FMath::RoundToInt(HeightCm * ConsolePxPerCm));
	if (ConsolePanel->GetDrawSize() != Draw) ConsolePanel->SetDrawSize(Draw);
	ConsoleLayout = FVector2f(LW, bConsoleOpen ? LH : BarLH);
	const FTransform Slot = Table->ConsoleSlotPose();
	const FVector Up = Slot.GetRotation().GetUpVector();
	FVector At = Slot.GetLocation();
	if (!bConsoleOpen)
	{
		// The site plan: along the slot's top edge, the plan below it clear. Room mode: under the deck, clear of its screens.
		At += bRoom ? -Up * (ABpTable::DeckHeightCm * 0.5f + ConsoleBarGapCm + ConsoleBarHeightCm * 0.5f) : Up * (ABpTable::DeckHeightCm * 0.5f - ConsoleBarHeightCm * 0.5f);
	}
	const FVector Eye = Table->ConsoleEyeLocal();
	ConsolePanel->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(1.0 / ConsolePxPerCm)));
	// The deck gives the slot to the open console in room mode, and has it back when it closes.
	Table->SetDeckHeld(bConsoleOpen && bRoom);
	if (Key != ConsolePlaceKey)
	{
		ConsolePlaceKey = Key;
		UE_LOG(LogBpTable, Log, TEXT("BpConsole: %s %s (%.0f x %.1f cm, %.0f cm from the eye)"), bConsoleOpen ? TEXT("panel") : TEXT("bar"),
			bConsoleOpen ? TEXT("in the deck's slot") : bRoom ? TEXT("under the deck") : TEXT("along the slot's top edge"), ConsoleWidthCm, HeightCm, FVector::Dist(Eye, At));
	}
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
	if (!Table || !Table->HasPlan()) return TEXT("Reading the plan…");
	// Talking to the lamp says so here as well as on the lamp and the wrist (voice-io: visibly active while in use).
	if (!Table->TalkStateWord().IsEmpty()) return FString::Printf(TEXT("%s · %s"), *Table->TalkStateWord(), *Table->TalkStateLine());
	FString Head, Body;
	Table->ScanBand(Head, Body);
	if (!WristArmedFocus.IsEmpty()) return FString::Printf(TEXT("A scan of %s is ready on your wrist"), WristArmedLabel.IsEmpty() ? TEXT("this place") : *WristArmedLabel);
	if (Table->IsScanRunning() && !Body.IsEmpty()) return FString::Printf(TEXT("%s: %s"), Head.StartsWith(TEXT("SAMPLE")) ? TEXT("Sample scan") : TEXT("Scanning"), *Body);
	if (Table->IsTourRunning()) return TEXT("The lamp's tour is running");
	if (!Table->GetRoomModeId().IsEmpty())
	{
		const int32 N = Table->DeckOpenIds().Num();
		const FString Place = Table->DirectedLabel(Table->GetRoomModeId());
		// The room's name is on its map's title block; the bar says what waits on the screens.
		return N > 0 ? FString::Printf(TEXT("%d %s on the screens"), N, N == 1 ? TEXT("decision") : TEXT("decisions")) : FString::Printf(TEXT("Nothing to decide in %s"), *Place);
	}
	const int32 Waiting = Table->OpenDecisionCount();
	const FString Words = Waiting > 0 ? FString::Printf(TEXT("%d %s waiting"), Waiting, Waiting == 1 ? TEXT("decision") : TEXT("decisions")) : FString(TEXT("Nothing waiting"));
	if (Table->GetBpLevel() != EBpLevel::L0) return FString::Printf(TEXT("%s · %s"), *Table->DirectedLabel(Table->DirectedTarget()), *Words);
	return Words;
}

void ABpPawn::RefreshConsole()
{
	ABpTable* Table = WristTable.Get();
	if (!ConsolePanel || !Table) return;
	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Product = Link.GetProductName().IsEmpty() ? Link.NameOf(Link.GetProductSlug()) : Link.GetProductName();
	const bool bCanBack = Table->HasPlan() && (!Table->GetRoomModeId().IsEmpty() || Table->GetBpLevel() != EBpLevel::L0);
	// SHOW ON PC (night two W2a): the table's place to the web, on the bar while a PC is linked; its answer stands a while.
	// Handed over (night two W2b): while a grant from the table is live the bar says until when, with TAKE BACK in SHOW ON PC's place.
	const FString Handed = StandupBarStatus();
	const bool bShowPc = Table->HasPlan() && Link.HasPcLink() && Handed.IsEmpty();
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
	for (const FBpConsoleRow& Row : Rows)
	{
		Key += FString::Printf(TEXT("|%s/%s/%s/%s/%d"), *Row.Act, *Row.Label, *Row.Detail, *Row.Tag, Row.Tone);
		for (const FBpConsoleRow::FButton& B : Row.Buttons) Key += TEXT("/") + B.Word + (B.bPrimary ? TEXT("*") : TEXT(""));
	}
	for (const FString& Each : Summaries) Key += TEXT("|") + Each;
	if (bConsoleOpen && !Page) Key += FBpConsolePages::LinkLine();
	const bool bStandupPage = bConsoleOpen && Page && ConsolePageKey == TEXT("standup");
	if (bStandupPage) Key += StandupKey();
	if (Key == ConsoleKey) return;
	ConsoleKey = Key;
	ConsoleBoxes.Reset();

	TSharedRef<SCanvas> Canvas = SNew(SCanvas);
	const auto Put = [&Canvas](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Canvas->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const FSlateFontInfo LabelFont = Font(TEXT("Bold"), CapLabel), SmallFont = Font(TEXT("Regular"), CapSmall), SmallBold = Font(TEXT("Bold"), CapSmall);
	enum class EBtn : uint8 { Fill, Edge, Amber };
	const auto Button = [&](const FBox2f& Box, const FString& Word, EBtn Look, const FString& Act, const FSlateFontInfo& WordFont)
	{
		const FLinearColor Fill = Look == EBtn::Fill ? BpSheet::Accent : Look == EBtn::Amber ? BpSheet::Amber : BpSheet::PaperLo.CopyWithNewOpacity(0.45f);
		const FLinearColor Edge = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(0.8f) : FLinearColor::Transparent;
		const FLinearColor Ink = Look == EBtn::Edge ? BpSheet::InkHi : BpSheet::PaperLo;
		Put(Box, SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(Fill).Edge(Edge).EdgePx(2.5f)]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Word, WordFont, Box.GetSize().X - 20.f))).Font(WordFont).ColorAndOpacity(FSlateColor(Ink))
			]);
		ConsoleBoxes.Add({ TEXT("console:") + Act, Box });
	};

	if (!bConsoleOpen)
	{
		// The bar: MENU, the product and the status, YOUR ROOM / STUDIO, BACK.
		const float Y0 = 12.f, Y1 = BarLH - 12.f;
		Button(FBox2f(FVector2f(14.f, Y0), FVector2f(214.f, Y1)), TEXT("MENU"), EBtn::Fill, TEXT("menu"), Font(TEXT("Bold"), CapBar));
		const float BackW = bCanBack ? 200.f : 0.f;
		if (bCanBack) Button(FBox2f(FVector2f(LW - 14.f - BackW, Y0), FVector2f(LW - 14.f, Y1)), TEXT("‹  BACK"), EBtn::Edge, TEXT("bar:back"), Font(TEXT("Bold"), CapBar));
		const bool bTakeBack = !Handed.IsEmpty();
		const float PcW = bShowPc || bTakeBack ? 250.f : 0.f;
		const float PcX1 = LW - 14.f - (bCanBack ? BackW + 12.f : 0.f);
		if (bShowPc) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), TEXT("SHOW ON PC"), EBtn::Edge, TEXT("bar:pc"), Font(TEXT("Bold"), CapBar));
		if (bTakeBack) Button(FBox2f(FVector2f(PcX1 - PcW, Y0), FVector2f(PcX1, Y1)), TEXT("TAKE BACK"), EBtn::Amber, TEXT("standup:revoke"), Font(TEXT("Bold"), CapBar));
		// Your room (BpSurround.cpp, night two W4): YOUR ROOM / STUDIO, what surrounds the table now; a tap switches it.
		const float RoomW = 230.f;
		const float RoomX1 = PcX1 - (bShowPc || bTakeBack ? PcW + 12.f : 0.f);
		Button(FBox2f(FVector2f(RoomX1 - RoomW, Y0), FVector2f(RoomX1, Y1)), bRoom ? TEXT("YOUR ROOM") : TEXT("STUDIO"), EBtn::Edge, TEXT("toggle:room"), Font(TEXT("Bold"), CapBar));
		const FSlateFontInfo NameFont = Font(TEXT("Bold"), CapBar), StatusFont = Font(TEXT("Regular"), CapBarStatus);
		const float TextX = 242.f, TextW = LW - TextX - (bCanBack ? BackW + 40.f : 28.f) - (bShowPc || bTakeBack ? PcW + 12.f : 0.f) - (RoomW + 12.f);
		const FString Name = BpSheet::Cut(Product.ToUpper(), NameFont, TextW * 0.45f);
		const float NameW = BpSheet::TextWidth(Name, NameFont);
		Put(FBox2f(FVector2f(TextX, 0.f), FVector2f(TextX + TextW, BarLH)),
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Name)).Font(NameFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(18.f, 0.f)[SNew(SBox).WidthOverride(2.f).HeightOverride(BarLH * 0.5f)[SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f))]]
			+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Status, StatusFont, TextW - NameW - 40.f))).Font(StatusFont).ColorAndOpacity(FSlateColor(BpSheet::Ink))]);
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
		Put(FBox2f(FVector2f(TitleX, HeadY0), FVector2f(LW - Pad - 210.f, HeadY1)),
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 16.f, 0.f)[BpSheet::Bubble(Page ? Page->Letter : TEXT("M"), Font(TEXT("Bold"), 20.f), 44.f, BpSheet::Accent)]
			+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Title)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
		const FString SubLine = Page ? Sub : FString::Printf(TEXT("%s · %s"), *Product, *Status);
		Put(FBox2f(FVector2f(Pad, SubY), FVector2f(LW - Pad, SubY + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(SubLine, SmallFont, LW - 2.f * Pad))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
		// A fine rule under the header, as the sheet's title block.
		Put(FBox2f(FVector2f(Pad, SubY + 46.f), FVector2f(LW - Pad, SubY + 48.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
		if (!Page)
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
				Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.35f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.45f)).EdgePx(2.f));
				Put(FBox2f(Box.Min + FVector2f(22.f, 0.f), Box.Max - FVector2f(18.f, 0.f)),
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 18.f, 0.f)[BpSheet::Bubble(Each.Letter, Font(TEXT("Bold"), 18.f), 40.f, BpSheet::Accent)]
					+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Each.Title)).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Summaries[Index], SmallFont, TileW - 110.f))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]
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
				Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(Row.Tone == 1 ? 0.6f : 0.35f)).Edge(Row.Tone == 0 ? BpSheet::Ink.CopyWithNewOpacity(0.42f) : ToneInk.CopyWithNewOpacity(0.8f)).EdgePx(2.f)
					.Bar(Row.Tone == 1 ? BpSheet::Accent : FLinearColor::Transparent).BarPx(8.f));
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
					const FString Tag = BpSheet::Cut(Row.Tag, SmallBold, 380.f);
					const float TagW = BpSheet::TextWidth(Tag, SmallBold);
					Put(FBox2f(FVector2f(Right - TagW - 14.f, Box.Min.Y), FVector2f(Right - 6.f, Box.Max.Y)), SNew(SBox).VAlign(VAlign_Center).HAlign(HAlign_Right)
						[
							SNew(STextBlock).Text(FText::FromString(Tag)).Font(SmallBold).ColorAndOpacity(FSlateColor(Row.Tone == 0 ? BpSheet::Accent : ToneInk))
						]);
					Right -= TagW + 32.f;
				}
				const float TextX = Box.Min.X + (Row.Tone == 1 ? 32.f : 24.f), TextW = Right - TextX;
				TSharedRef<SVerticalBox> Words = SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Row.Label, LabelFont, TextW))).Font(LabelFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi))];
				if (!Row.Detail.IsEmpty())
				{
					Words->AddSlot().AutoHeight().Padding(0.f, 4.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Row.Detail, SmallFont, TextW))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.8f)))];
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
	for (const FString& Lit : { ConsoleHover, bConsolePadSel ? ConsoleSel : FString() })
	{
		if (Lit.IsEmpty()) continue;
		if (const FConsoleBox* Box = ConsoleBoxes.FindByPredicate([&Lit](const FConsoleBox& Each) { return Each.Id == Lit; }))
		{
			Put(Box->Box.ExpandBy(5.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(6.f));
		}
	}
	const float Scale = ConsolePxPerCm / ConsoleLayoutPxPerCm;
	ConsolePanel->SetSlateWidget(
		SNew(SDPIScaler).DPIScale(Scale)
		[
			SNew(SBox).WidthOverride(LW).HeightOverride(bConsoleOpen ? LH : BarLH)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(PX).RulePx(bConsoleOpen ? 5.f : 4.f)]
				+ SOverlay::Slot()[Canvas]
			]
		]);
	ConsolePanel->RequestRenderUpdate();
	++ConsoleDraws;
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: drawn #%d %s%s \"%s\" (%d controls)"), ConsoleDraws, bConsoleOpen ? TEXT("panel ") : TEXT("bar"), bConsoleOpen ? *GetConsoleLine() : TEXT(""), *Status, ConsoleBoxes.Num());
}

// ---- The hands and the console's acts ----------------------------------------------------------------------------------

bool ABpPawn::ConsoleHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (!ConsolePanel || !ConsolePanel->IsVisible() || ConsoleBoxes.Num() == 0) return false;
	const FTransform& T = ConsolePanel->GetComponentTransform();
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (Denom >= -KINDA_SMALL_NUMBER) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	// UWidgetComponent's mapping: widget x = -local Y, y = -local Z from its pivot, in draw px; then the layout's px.
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const FVector2D Draw = ConsolePanel->GetDrawSize();
	const float ToLayout = ConsoleLayoutPxPerCm / ConsolePxPerCm;
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

bool ABpPawn::ConsoleAim(const FString& Id, FVector& OutWorld) const
{
	const FConsoleBox* Box = ConsoleBoxes.FindByPredicate([&Id](const FConsoleBox& Each) { return Each.Id == Id; });
	if (!ConsolePanel || !Box) return false;
	const FVector2f C = Box->Box.GetCenter();
	const FVector2D Draw = ConsolePanel->GetDrawSize();
	const float ToDraw = ConsolePxPerCm / ConsoleLayoutPxPerCm;
	OutWorld = ConsolePanel->GetComponentTransform().TransformPosition(FVector(0.0, -(C.X * ToDraw - Draw.X * 0.5), -(C.Y * ToDraw - Draw.Y * 0.5)));
	return true;
}

void ABpPawn::SetConsoleHover(const FString& Id)
{
	const FString Lit = Id == TEXT("console:panel") ? FString() : Id;
	if (Lit == ConsoleHover) return;
	ConsoleHover = Lit;
	// A hand is pointing: the pad's selection steps back until the pad is used again.
	if (!Lit.IsEmpty()) bConsolePadSel = false;
	RefreshConsole();
}

void ABpPawn::ConsoleTap(const FString& Id)
{
	UE_LOG(LogBpTable, Log, TEXT("BpConsole: tap %s"), *Id);
	if (!Id.StartsWith(TEXT("console:"))) return;
	const FString Act = Id.Mid(8);
	ABpTable* Table = WristTable.Get();
	if (Act == TEXT("panel")) return;
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
	ConsoleBarWords = TEXT("Sending the place to your PC…");
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
	const double CmPerLayoutPx = 1.0 / ConsoleLayoutPxPerCm;
	const auto Add = [&](const TCHAR* Name, double CapPx) { Out.Add({ Name, CapPx * CmPerLayoutPx, T.GetLocation(), T.GetUnitAxis(EAxis::Z) }); };
	Add(TEXT("console title"), CapTitle);
	Add(TEXT("console label"), CapLabel);
	Add(TEXT("console detail"), CapSmall);
	Add(TEXT("console bar status"), CapBarStatus);
}
