// The console (night two W1; BpPawn.h declares it): the app's main menu, in the deck's slot on the table, in the sheet's
// language (BpSheet.h: the drawing set's paper, ink and accents; BpType.h's family). The owner on the Quest 3S, 2026-11-09:
// "we need bindings to thumb controllers and action buttons to create main menu and operate there, going clearly back,
// operating in blueprint without dependency of the pins and drag movement"; "the wrist panel is overpopulated with
// options, we need to migrate into the main frame".
//
// At rest it is a bar: MENU, the product, one status phrase, BACK whenever the table has somewhere to go back to. Opened it
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
	 *  4 a note (words across the row, no plate). */
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
			{ TEXT("standup"), TEXT("STAND-UP"), TEXT("C"), &StandupRows, &StandupSummary, nullptr, nullptr },
			{ TEXT("ask"), TEXT("ASK"), TEXT("D"), &AskRows, &AskSummary, nullptr, nullptr },
			{ TEXT("projects"), TEXT("PROJECTS"), TEXT("E"), &ProjectsRows, &ProjectsSummary, nullptr, nullptr },
			{ TEXT("packages"), TEXT("PACKAGES"), TEXT("F"), &PackagesRows, &PackagesSummary, nullptr, nullptr },
			{ TEXT("settings"), TEXT("SETTINGS"), TEXT("G"), &SettingsRows, &SettingsSummary, nullptr, nullptr },
		};
		return Pages;
	}

	static const FBpConsolePage* Find(const FString& Key)
	{
		return Registry().FindByPredicate([&Key](const FBpConsolePage& Page) { return Key == Page.Key; });
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

	// SCAN: the saved focuses (the wrist's SCAN tab): a press arms one for the place the table shows, a second starts it.
	static bool ScanReady() { const FBpLinkModule& L = FBpLinkModule::Get(); return L.HasPcLink() || L.HasSampleFocuses(); }
	static void ScanOpen(ABpPawn&) { if (ScanReady()) FBpLinkModule::Get().GetFocuses(); }
	static void ScanRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		if (!ScanReady())
		{
			Sub = TEXT("Scans start from the PC's saved focuses");
			Out.Add(Note(TEXT("Connect to your PC to scan: a focus is saved there, and this table runs it on the place it shows.")));
			return;
		}
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const bool bSample = !Link.HasPcLink();
		ABpTable* T = Table(Pawn);
		const FString Place = T ? T->DirectedLabel(T->DirectedTarget()) : FString();
		const FBpFocusList& List = Link.GetFocusList();
		Sub = Pawn.bWristScanStarting ? FString(TEXT("Starting the scan…"))
			: bSample ? FString::Printf(TEXT("Sample scan of %s · it reads and writes nothing"), Place.IsEmpty() ? TEXT("the site") : *Place)
			: !List.bHasFocuses && List.Error.IsEmpty() ? FString(TEXT("Reading the saved focuses…"))
			: FString::Printf(TEXT("%d saved · a press arms one for %s, a second starts it"), List.Focuses.Num(), Place.IsEmpty() ? TEXT("the site") : *Place);
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
		FString Head, Body;
		if (T) T->ScanBand(Head, Body);
		if (!Head.IsEmpty()) Out.Add(Note(FString::Printf(TEXT("%s · %s"), *Head, *Body), 2));
		if (List.Focuses.Num() == 0)
		{
			Out.Add(Note(!List.Error.IsEmpty() ? List.Error : !List.bHasFocuses ? FString(TEXT("Reading…")) : FString(TEXT("Save a focus on the PC first."))));
			return;
		}
		for (const FBpSavedFocus& F : List.Focuses)
		{
			FBpConsoleRow Row;
			Row.Act = TEXT("focus:") + F.Id;
			Row.Label = F.Note.Replace(TEXT("\n"), TEXT(" "));
			const FString* Short = Link.FindLensShort(F.Lens);
			Row.Detail = FString::Printf(TEXT("%s · %s"), Short ? **Short : *BpWords::Lens(F.Lens).Left(3).ToUpper(), *BpWords::Lens(F.Lens));
			const bool bArmed = F.Id == Pawn.WristArmedFocus;
			Row.Tag = bArmed ? (bSample ? TEXT("PRESS AGAIN: SAMPLE") : TEXT("PRESS AGAIN TO START")) : FString();
			Row.Tone = bArmed ? 2 : 0;
			Out.Add(Row);
		}
	}
	static FString ScanSummary(ABpPawn&)
	{
		if (!ScanReady()) return TEXT("Needs your PC");
		const FBpFocusList& List = FBpLinkModule::Get().GetFocusList();
		return List.bHasFocuses ? FString::Printf(TEXT("%d saved focuses"), List.Focuses.Num()) : FString(TEXT("Saved focuses"));
	}

	// STAND-UP: a stub tonight (a later wave runs it here); it says what waits and what it needs.
	static void StandupRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		const int32 Waiting = Plan(Pawn) ? Table(Pawn)->OpenDecisionCount() : 0;
		Sub = TEXT("The morning's decisions, one by one");
		if (Plan(Pawn)) Out.Add(Note(Waiting > 0 ? FString::Printf(TEXT("%d %s waiting in the store."), Waiting, Waiting == 1 ? TEXT("decision is") : TEXT("decisions are")) : FString(TEXT("No decision is waiting.")), Waiting > 0 ? 2 : 4));
		if (!FBpLinkModule::Get().HasPcLink()) Out.Add(Note(TEXT("Connect to your PC to run the stand-up.")));
		else Out.Add(Note(TEXT("The stand-up runs here soon; until then the rooms' screens hold each decision.")));
	}
	static FString StandupSummary(ABpPawn& Pawn)
	{
		const int32 Waiting = Plan(Pawn) ? Table(Pawn)->OpenDecisionCount() : 0;
		if (!FBpLinkModule::Get().HasPcLink()) return Waiting > 0 ? FString::Printf(TEXT("%d waiting · needs your PC"), Waiting) : FString(TEXT("Needs your PC"));
		return FString::Printf(TEXT("%d decisions waiting"), Waiting);
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
		Sub = FString::Printf(TEXT("%d projects · %s open"), Onboarding.Products.Num(), *Link.NameOf(Open));
		if (Building > 0) Sub += FString::Printf(TEXT(" · %d onboarding"), Building);
		if (Onboarding.Products.Num() == 0)
		{
			Sub = FString::Printf(TEXT("%s open"), *Link.NameOf(Open));
			Out.Add(Note(Link.IsFromBundle() ? FString(TEXT("Offline: this build carries one sample project. Your PC lists the others.")) : FString(TEXT("Reading the projects…"))));
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
		if (Link.IsFromBundle()) return TEXT("PC link: none · this build reads its bundled sample and sends nothing");
		if (Link.HasPcLink()) return TEXT("PC link: connected · scans, the companion and approvals reach your PC");
		return TEXT("PC link: looking for your PC…");
	}
	static void SettingsRows(ABpPawn& Pawn, TArray<FBpConsoleRow>& Out, FString& Sub)
	{
		Sub = LinkLine();
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

FString ABpPawn::GetConsoleLine() const
{
	if (!bConsoleOpen) return TEXT("bar");
	return FString::Printf(TEXT("%s p%d sel=%s"), *ConsolePageKey, ConsolePageAt + 1, ConsoleSel.IsEmpty() ? TEXT("none") : *ConsoleSel);
}

FString ABpPawn::ConsoleStatus() const
{
	ABpTable* Table = WristTable.Get();
	if (!Table || !Table->HasPlan()) return TEXT("Reading the plan…");
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
	const FString Status = ConsoleStatus();

	// What it shows, as words: the redraw key.
	const FBpConsolePage* Page = bConsoleOpen && ConsolePageKey != TEXT("home") ? FBpConsolePages::Find(ConsolePageKey) : nullptr;
	TArray<FBpConsoleRow> Rows;
	FString Sub;
	TArray<FString> Summaries;
	if (bConsoleOpen && Page) Page->Rows(*this, Rows, Sub);
	if (bConsoleOpen && !Page) for (const FBpConsolePage& Each : FBpConsolePages::Registry()) Summaries.Add(Each.Summary(*this));
	const int32 Pages = FMath::Max(1, FMath::DivideAndRoundUp(Rows.Num(), ConsoleRowsPerPage));
	ConsolePageAt = FMath::Clamp(ConsolePageAt, 0, Pages - 1);
	FString Key = FString::Printf(TEXT("%d|%s|%d|%s|%s|%d|%s|%s|%s|%d"), bConsoleOpen, *ConsolePageKey, ConsolePageAt, *Product, *Status, bCanBack, *ConsoleHover, *ConsoleSel, *Sub, bConsolePadSel);
	for (const FBpConsoleRow& Row : Rows)
	{
		Key += FString::Printf(TEXT("|%s/%s/%s/%s/%d"), *Row.Act, *Row.Label, *Row.Detail, *Row.Tag, Row.Tone);
		for (const FBpConsoleRow::FButton& B : Row.Buttons) Key += TEXT("/") + B.Word + (B.bPrimary ? TEXT("*") : TEXT(""));
	}
	for (const FString& Each : Summaries) Key += TEXT("|") + Each;
	if (bConsoleOpen && !Page) Key += FBpConsolePages::LinkLine();
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
		// The bar: MENU, the product and the status, BACK.
		const float Y0 = 12.f, Y1 = BarLH - 12.f;
		Button(FBox2f(FVector2f(14.f, Y0), FVector2f(214.f, Y1)), TEXT("MENU"), EBtn::Fill, TEXT("menu"), Font(TEXT("Bold"), CapBar));
		const float BackW = bCanBack ? 200.f : 0.f;
		if (bCanBack) Button(FBox2f(FVector2f(LW - 14.f - BackW, Y0), FVector2f(LW - 14.f, Y1)), TEXT("‹  BACK"), EBtn::Edge, TEXT("bar:back"), Font(TEXT("Bold"), CapBar));
		const FSlateFontInfo NameFont = Font(TEXT("Bold"), CapBar), StatusFont = Font(TEXT("Regular"), CapBarStatus);
		const float TextX = 242.f, TextW = LW - TextX - (bCanBack ? BackW + 40.f : 28.f);
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
	const FBpConsolePage* Page = FBpConsolePages::Find(ConsolePageKey);
	if (Page && Page->Tap && Page->Tap(*this, Act)) { RefreshConsole(); return; }
	PanelAct(Act);
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
