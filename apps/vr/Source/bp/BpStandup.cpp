// The stand-up (night two W2b, "Morning at the desk"; BpPawn.h declares it). The owner, 2026-11-09: "wire 'standups' as in web
// to establish daily plan with AI companion and let it handle the project - if connected to PC", and the direction picked: "The
// daily ritual as the product's reason to come back: overnight findings arrive as sheets, three decisions in two minutes, a
// 'since yesterday' replay on the plan, and a first run that ends in your first real decision."
//
// The console's STAND-UP page runs the web's Morning Watch (apps/web/src/components/focus/MorningWatch.tsx; the deck is core's,
// packages/core/src/companion/morning.ts) one card at a time, each a sheet in the drawing-set language: what happened overnight,
// then each waiting decision with its brief, its evidence, its tier in words and its "before" screen, then the close (what you
// decided, what happens next, PLAN MY DAY, HAND OVER FOR TODAY). As each card shows, the plan raises its room and the lamp goes
// beside it, so a decision is made looking at the place it concerns. Every answer says what the card showed (`shown`). With no
// PC the same ritual runs on the build's sample deck (morning.json), saying so, and keeps its answers on the headset for the day.
//
// Cost: nothing ticks. The page redraws only when its words change (the console's key); the screen is one texture, decoded off
// the game thread when its card shows and released when the card leaves or the page closes; the replay and the auto-advance are
// one-shot timers. Closed, the state is dropped (BpStandup.Stat says so).
#include "BpPawn.h"

#include "Algo/AnyOf.h"
#include "Algo/Count.h"
#include "Async/Async.h"
#include "BpLink.h"
#include "BpSheet.h"
#include "BpStore.h"
#include "BpTable.h"
#include "BpType.h"
#include "BpWords.h"
#include "Components/WidgetComponent.h"
#include "Engine/Texture2D.h"
#include "HAL/IConsoleManager.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Modules/ModuleManager.h"
#include "Schema/BpSchemaVocab.h"
#include "Styling/CoreStyle.h"
#include "Styling/SlateBrush.h"
#include "TimerManager.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SCanvas.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

/** What the stand-up answered on one card. */
struct FBpStandupAnswer
{
	enum class EState : uint8 { Sending, Sent, Sample, Refused, Unsent };
	FString Verdict;
	EState State = EState::Sending;
	FString Words;
	FString Title;
	FString Product;
	FString Proposal;
	double At = 0.0;
};

/** One sheet of the ritual: a deck card, a companion card filed by the day's plan, or the replay the headset adds. */
struct FBpStandupSheet
{
	enum class EKind : uint8 { Since, Deck, Companion };
	EKind Kind = EKind::Deck;
	int32 Card = INDEX_NONE;
	FBpCompanionCard Companion;
};

struct FBpStandupState
{
	bool bLoading = true;
	bool bSample = false;
	FString Error;
	FBpMorningDeck Deck;
	TArray<FBpStandupSheet> Sheets;
	int32 At = 0;
	TMap<FString, FBpStandupAnswer> Answers;
	/** The pad's first A on a decision arms APPROVE; the second sends it. */
	FString Armed;
	/** The last stand-up before this one (ISO, saved), and the replay's marks: (room id, words). */
	FString LastStandup;
	TArray<TPair<FString, FString>> Marks;
	int32 MarkAt = -1;
	/** The screen on the card shown. */
	FString ShotFor;
	FString ShotPath;
	bool bShotLoading = false;
	bool bShotSample = false;
	bool bShotMissing = false;
	TSharedPtr<FSlateBrush> ShotBrush;
	FVector2D ShotSize = FVector2D::ZeroVector;
	uint32 ShotGen = 0;
	/** The day's plan: one companion turn. */
	enum class EPlan : uint8 { Idle, Asking, Done, Failed };
	EPlan Plan = EPlan::Idle;
	FString PlanText;
	FString PlanWords;
	double PlanSentAt = 0.0;
	/** The hand-over: the confirm sheet, a grant out, and what the server answered. */
	bool bConfirm = false;
	bool bGrantOut = false;
	FString GrantWords;
	bool bGrantBad = false;
	FString Room;
	double OpenedAt = 0.0;
	/** The close card's lines as the server said them (read again when the close card shows). */
	TArray<FBpCardLine> CloseLines;
	bool bLostSaid = false;
	/** The tour opens the stand-up on its first open decision, not on the opening card, and keeps it there once answered (the
	 *  lamp's closing line is about that card). */
	bool bJumpToDecision = false;
	/** A spoken request raised a pending card (BpTalk.cpp): once the morning is read, the pending cards are pulled in. */
	bool bPullCards = false;
	bool bTour = false;
	/** The answer's stamp (night two V2): which answer it is for, when it began to land, the redraws while it lands. */
	FString StampFor;
	FString UnstampedShown;
	double StampAt = -100.0;
	int32 StampFrame = 0;
	FTimerHandle StampTimer;
};

namespace
{
	const TCHAR* const Section = TEXT("/Script/bp.BpStandup");
	/** The hand-over's fixed terms: the four bounded tools, tier 1 and milder, for this many hours ("for today"). */
	constexpr int32 GrantHours = 8;
	constexpr int32 GrantMinTier = 1;
	/** A returning person's replay shows when the last stand-up is older than this. */
	constexpr double SinceMinGapS = 600.0;
	/** The pad's armed APPROVE lapses after this. */
	constexpr double ArmS = 6.0;

	TAutoConsoleVariable<float> CVarStandupAdvanceS(TEXT("bp.StandupAdvanceS"), 1.2f,
		TEXT("After an answer is taken, the stand-up moves to the next card after this many seconds (0.3 to 5; 0 stays)."), ECVF_Default);
	TAutoConsoleVariable<float> CVarStandupMarkS(TEXT("bp.StandupMarkS"), 0.9f,
		TEXT("The 'since your last stand-up' replay: seconds each changed room stays raised (0.4 to 3)."), ECVF_Default);

	// ---- The sheet's grid (layout px, ABpPawn::ConsoleLayoutPxPerCm a cm; the console's header stays above it) -----------
	constexpr float PX = ABpPawn::ConsoleLayoutPxPerCm;
	constexpr float LW = ABpPawn::ConsoleWidthCm * PX;
	constexpr float Pad = 40.f;
	/** The panel's double-rule wall takes its outer 14 px: the foot's buttons end clear of it. */
	constexpr float StripY0 = 154.f, StripY1 = 161.f;
	constexpr float FrameY0 = 170.f, FrameY1 = 568.f;
	constexpr float InX = Pad + 26.f;
	constexpr float StatusY0 = 572.f, StatusY1 = 612.f;
	/** The answers are the sheet's largest controls (night two V2): 78 px tall; PREV and NEXT stand quieter inside the same band. */
	constexpr float BtnY0 = 618.f, BtnY1 = 696.f;
	/** The stamp lands in this long (a cut with bp.ReducedMotion). */
	constexpr double StampS = 0.26;
	constexpr float CapHead = 36.f, CapLabel = 28.f, CapSmall = 24.f;

	FSlateFontInfo Font(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Object = ABpTable::TextFontObject()) return FSlateFontInfo(Object, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}
	/** A line's pitch for a cap height (Barlow's 1.2 em). */
	float Pitch(float CapPx) { return CapPx / static_cast<float>(BpType::CapPerEm) * 1.2f; }

	FLinearColor ToneInk(const FString& Tone)
	{
		if (Tone == BpVocab::CardLine::Tone::Good) return BpSheet::Accent;
		if (Tone == BpVocab::CardLine::Tone::Warn) return BpSheet::Amber;
		if (Tone == BpVocab::CardLine::Tone::Bad) return BpSheet::Red;
		return BpSheet::Ink.CopyWithNewOpacity(0.7f);
	}

	FString NowIso() { return FDateTime::UtcNow().ToIso8601(); }
	FString Today() { return FDateTime::Now().ToString(TEXT("%Y-%m-%d")); }

	/** A UTC ISO time as the headset's clock reads it ("18:40"), or empty. */
	FString LocalClock(const FString& Iso)
	{
		FDateTime At;
		if (!FDateTime::ParseIso8601(*Iso, At)) return FString();
		const FTimespan Offset = FDateTime::Now() - FDateTime::UtcNow();
		return (At + Offset).ToString(TEXT("%H:%M"));
	}

	/** How long ago, in words ("12 minutes ago", "yesterday at 21:04"). */
	FString AgoWords(const FString& Iso)
	{
		FDateTime At;
		if (!FDateTime::ParseIso8601(*Iso, At)) return FString();
		const double S = (FDateTime::UtcNow() - At).GetTotalSeconds();
		if (S < 3600.0) return FString::Printf(TEXT("%d minutes ago"), FMath::Max(1, FMath::RoundToInt(S / 60.0)));
		if (S < 36.0 * 3600.0) return FString::Printf(TEXT("%d h ago, at %s"), FMath::RoundToInt(S / 3600.0), *LocalClock(Iso));
		const int32 Days = FMath::Max(2, FMath::RoundToInt(S / 86400.0));
		return FString::Printf(TEXT("%d days ago"), Days);
	}

	FString ToolWords(const FString& Tool)
	{
		if (Tool == TEXT("decision.answer")) return TEXT("answer decisions for you");
		if (Tool == TEXT("finding.decline")) return TEXT("decline findings");
		if (Tool == TEXT("scan.directed")) return TEXT("run directed scans");
		if (Tool == TEXT("wave.dispatch")) return TEXT("dispatch waves to build");
		if (Tool == TEXT("release.build")) return TEXT("build a draft release");
		return Tool;
	}

	FString VerdictWord(const FString& Verdict)
	{
		if (Verdict == BpVocab::SteerPost::Verdict::Approve) return TEXT("Approved");
		if (Verdict == BpVocab::SteerPost::Verdict::Defer) return TEXT("Later");
		if (Verdict == BpVocab::SteerPost::Verdict::Hold) return TEXT("Held");
		if (Verdict == BpVocab::SteerPost::Verdict::Decline) return TEXT("Declined");
		return Verdict;
	}

	/** The companion's pending requests as last read from the PC (any read: the stand-up's, the spoken request's, HOME's), for
	 *  the MENU's STAND-UP tile and the wrist while the page is closed. -1: never read. */
	int32 GPendingRequests = -1;

	/** The pending cards into the sheets (night two V2): new ones before the close card, in the order read (newest first);
	 *  a companion sheet whose card is no longer pending and was not answered here drops out (answered elsewhere). The sheet
	 *  shown stays shown, by its identity. Returns the sheet of the newest pending card (INDEX_NONE: none). */
	int32 MergeCompanionCards(FBpStandupState& S, const TArray<FBpCompanionCard>& Cards)
	{
		const auto IdOf = [&S](const FBpStandupSheet& Sh) -> FString
		{
			if (Sh.Kind == FBpStandupSheet::EKind::Companion) return TEXT("c:") + Sh.Companion.Id;
			if (Sh.Kind == FBpStandupSheet::EKind::Since) return TEXT("since");
			return S.Deck.cards.IsValidIndex(Sh.Card) ? TEXT("d:") + S.Deck.cards[Sh.Card].id : FString();
		};
		const FString Shown = S.Sheets.IsValidIndex(S.At) ? IdOf(S.Sheets[S.At]) : FString();
		TArray<const FBpCompanionCard*> Pending;
		for (const FBpCompanionCard& Card : Cards) if (Card.State == TEXT("pending")) Pending.Add(&Card);
		GPendingRequests = Pending.Num();
		// Gone: answered elsewhere (or expired) and not here.
		S.Sheets.RemoveAll([&](const FBpStandupSheet& Sh)
		{
			return Sh.Kind == FBpStandupSheet::EKind::Companion && !S.Answers.Contains(Sh.Companion.Id)
				&& !Pending.ContainsByPredicate([&Sh](const FBpCompanionCard* C) { return C->Id == Sh.Companion.Id; });
		});
		int32 Newest = INDEX_NONE;
		for (const FBpCompanionCard* Card : Pending)
		{
			int32 At = S.Sheets.IndexOfByPredicate([Card](const FBpStandupSheet& Sh) { return Sh.Kind == FBpStandupSheet::EKind::Companion && Sh.Companion.Id == Card->Id; });
			if (At == INDEX_NONE)
			{
				FBpStandupSheet Sheet;
				Sheet.Kind = FBpStandupSheet::EKind::Companion;
				Sheet.Companion = *Card;
				// Before the close card; after the requests already placed (the list is newest first, so the newest leads).
				int32 Close = S.Sheets.IndexOfByPredicate([&S](const FBpStandupSheet& Sh) { return S.Deck.cards.IsValidIndex(Sh.Card) && S.Deck.cards[Sh.Card].kind == BpVocab::MorningCard::Kind::Close; });
				At = S.Sheets.Insert(Sheet, Close == INDEX_NONE ? S.Sheets.Num() : Close);
			}
			else S.Sheets[At].Companion = *Card;
			if (Newest == INDEX_NONE) Newest = At;
		}
		// Newest was taken before later inserts could move it: find it again by id.
		if (Pending.Num() > 0) Newest = S.Sheets.IndexOfByPredicate([&](const FBpStandupSheet& Sh) { return Sh.Kind == FBpStandupSheet::EKind::Companion && Sh.Companion.Id == Pending[0]->Id; });
		const int32 Back = Shown.IsEmpty() ? INDEX_NONE : S.Sheets.IndexOfByPredicate([&](const FBpStandupSheet& Sh) { return IdOf(Sh) == Shown; });
		S.At = FMath::Clamp(Back != INDEX_NONE ? Back : S.At, 0, FMath::Max(0, S.Sheets.Num() - 1));
		return Newest;
	}

	/** The companion's requests among the sheets. */
	int32 CompanionSheets(const FBpStandupState& S) { return Algo::CountIf(S.Sheets, [](const FBpStandupSheet& Sh) { return Sh.Kind == FBpStandupSheet::EKind::Companion; }); }

	ABpPawn* StandupPawn(UWorld* World)
	{
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdStandupAct(TEXT("BpStandup.Act"),
		TEXT("BpStandup.Act <next|prev|approve|defer|hold|decline|plan|handover|grant|cancel|revoke|skip|retry|done>: what the stand-up's control does (the console's standup:<act>)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (ABpPawn* Pawn = StandupPawn(World); Pawn && Args.Num() > 0) Pawn->StandupAct(Args[0]);
		}));
	FAutoConsoleCommandWithWorld CmdStandupLine(TEXT("BpStandup.Line"), TEXT("BpStandup.Line: logs the stand-up's card, its answer and the grant (\"closed\" when the page is not open)."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (ABpPawn* Pawn = StandupPawn(World)) UE_LOG(LogBpTable, Log, TEXT("BpStandup: line %s"), *Pawn->GetStandupLine());
		}));
	FAutoConsoleCommand CmdStandupForget(TEXT("BpStandup.Forget"), TEXT("BpStandup.Forget: forgets the last stand-up's time and the sample's answers kept for the day (a first morning again)."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FBpStore::EmptySection(Section);
			FBpStore::Flush();
			UE_LOG(LogBpTable, Log, TEXT("BpStandup: forgot the last stand-up and the sample's answers"));
		}));
	FAutoConsoleCommand CmdStandupLast(TEXT("BpStandup.Last"), TEXT("BpStandup.Last <hours>: sets the last stand-up that long ago (a returning morning: the replay shows)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() == 0) return;
			const double Hours = FCString::Atod(*Args[0]);
			FBpStore::SetString(Section, TEXT("LastStandup"), (FDateTime::UtcNow() - FTimespan::FromHours(Hours)).ToIso8601());
			FBpStore::Flush();
			UE_LOG(LogBpTable, Log, TEXT("BpStandup: the last stand-up is now %.1f h ago"), Hours);
		}));
}

// ---- The table's side: the plan follows the deck --------------------------------------------------------------------------

FString ABpTable::StandupRoomOf(const FString& Id) const
{
	if (!SheetPlan.IsValid() || Id.IsEmpty()) return FString();
	if (FindRoom(Id)) return Id;
	const FBpPlanTile* Tile = SheetPlan->tiles.FindByPredicate([&Id](const FBpPlanTile& T) { return T.id == Id; });
	const FString BayId = Tile ? Tile->parentId : Id;
	const FBpPlanBay* Bay = SheetPlan->bays.FindByPredicate([&BayId](const FBpPlanBay& B) { return B.id == BayId; });
	return Bay && FindRoom(Bay->parentId) ? Bay->parentId : FString();
}

FString ABpTable::StandupRoomByName(const FString& Name) const
{
	if (!SheetPlan.IsValid() || Name.IsEmpty()) return FString();
	const FBpPlanRoom* Room = SheetPlan->rooms.FindByPredicate([&Name](const FBpPlanRoom& R) { return R.name.Equals(Name, ESearchCase::IgnoreCase); });
	return Room ? Room->id : FString();
}

FString ABpTable::StandupPlaceName(const FString& Id) const
{
	if (const FBpPlanRoom* Room = FindRoom(Id)) return Room->name;
	if (const FBpPlanWing* Wing = FindWing(Id)) return Wing->name;
	if (SheetPlan.IsValid())
	{
		if (const FBpPlanTile* Tile = SheetPlan->tiles.FindByPredicate([&Id](const FBpPlanTile& T) { return T.id == Id; })) return Tile->name;
	}
	return FString();
}

FString ABpTable::StandupShow(const FString& Kind, const FString& Id, const FString& Line)
{
	if (!SheetPlan.IsValid()) return FString();
	if (Kind.IsEmpty() || Id.IsEmpty())
	{
		SetHighlight(FString(), FString());
		LampGoHome(TEXT("standup"));
		if (!Line.IsEmpty()) SayLamp(Line, true);
		return FString();
	}
	// The whole plan in view: out of a room's map, the levels home, then the room raised where it stands.
	if (!RoomModeId.IsEmpty()) ExitRoomMode();
	if (Level != EBpLevel::L0) Home();
	const FBpPlanWing* Wing = Kind == TEXT("wing") ? FindWing(Id) : nullptr;
	const FString Room = Wing ? FString() : StandupRoomOf(Id);
	if (Wing)
	{
		SetHighlight(TEXT("wing"), Wing->id);
		PresentLamp(WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(PlanToPaperCm(FVector2D(Wing->box.x + Wing->box.w * 0.5, Wing->box.y + Wing->box.h * 0.5)), 0.f)), TEXT("standup"));
	}
	else if (!Room.IsEmpty())
	{
		SetHighlight(TEXT("room"), Room);
		const bool bFeature = Kind == TEXT("feature") && SheetPlan->tiles.ContainsByPredicate([&Id](const FBpPlanTile& T) { return T.id == Id; });
		PresentLamp(bFeature ? LampTargetForFeature(Id) : LampTargetForRoom(Room), TEXT("standup"));
	}
	else
	{
		SetHighlight(FString(), FString());
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s:%s is on no level of this plan; the table stays"), *Kind, *Id);
	}
	if (!Line.IsEmpty()) SayLamp(Line, true);
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: the plan shows %s:%s%s"), *Kind, *Id, Room.IsEmpty() ? (Wing ? TEXT(" (its wing)") : TEXT("")) : *FString::Printf(TEXT(" (room %s raised, the lamp beside it)"), *Room));
	return Room;
}

// ---- The pawn's side ----------------------------------------------------------------------------------------------------

bool ABpPawn::IsStandupOpen() const
{
	return bConsoleOpen && ConsolePageKey == TEXT("standup") && Standup.IsValid();
}

FString ABpPawn::GetStandupRoom() const
{
	return Standup.IsValid() ? Standup->Room : FString();
}

const FBpPolicy* ABpPawn::LiveGrant() const
{
	return StandupGrant.IsValid() && StandupGrant->IsLive() ? StandupGrant.Get() : nullptr;
}

void ABpPawn::StandupOpened()
{
	if (!Standup.IsValid()) Standup = MakeShared<FBpStandupState>();
	FBpStandupState& S = *Standup;
	S.OpenedAt = FPlatformTime::Seconds();
	FBpStore::GetString(Section, TEXT("LastStandup"), S.LastStandup);
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: open (last stand-up %s)"), S.LastStandup.IsEmpty() ? TEXT("never") : *S.LastStandup);
	StandupLoad();
	StandupReadPolicies();
}

void ABpPawn::StandupClosed()
{
	GetWorldTimerManager().ClearTimer(StandupTimer);
	StandupReleaseShot();
	if (ABpTable* Table = WristTable.Get(); Table && Standup.IsValid() && !Standup->Room.IsEmpty()) Table->SetHighlight(FString(), FString());
	// Unsent answers stay (the PC was gone): the page says what was not sent when it opens again. Otherwise nothing stays.
	const bool bKeep = Standup.IsValid() && Standup->Answers.Num() > 0 && !Standup->bSample
		&& Algo::AnyOf(Standup->Answers, [](const TPair<FString, FBpStandupAnswer>& A) { return A.Value.State == FBpStandupAnswer::EState::Unsent; });
	if (!bKeep) Standup.Reset();
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: closed (%s; the screen released, nothing ticks)"), bKeep ? TEXT("unsent answers kept") : TEXT("state dropped"));
	DrawWrist();
}

void ABpPawn::StandupLoad()
{
	if (!Standup.IsValid()) return;
	FBpStandupState& S = *Standup;
	S.bLoading = true;
	S.Error.Reset();
	FDateTime Last;
	// The window: since the last stand-up (a week at most), else the server's own (the last 16 h).
	const FString Since = FDateTime::ParseIso8601(*S.LastStandup, Last) && (FDateTime::UtcNow() - Last).GetTotalDays() < 7.0 ? S.LastStandup : FString();
	TWeakObjectPtr<ABpPawn> Self(this);
	const TWeakPtr<FBpStandupState> Weak = Standup;
	FBpLinkModule::Get().GetMorning(Since, [Self, Weak](const FBpMorningRead& Read)
	{
		ABpPawn* Pawn = Self.Get();
		const TSharedPtr<FBpStandupState> Pin = Weak.Pin();
		if (!Pawn || !Pin.IsValid() || Pawn->Standup != Pin) return;
		FBpStandupState& S = *Pin;
		const FString Keep = S.Sheets.IsValidIndex(S.At) && S.Deck.cards.IsValidIndex(S.Sheets[S.At].Card) ? S.Deck.cards[S.Sheets[S.At].Card].id : FString();
		S.bLoading = false;
		S.bSample = Read.bSample;
		if (!Read.bOk)
		{
			S.Error = Read.Error;
			Pawn->RefreshConsole();
			return;
		}
		S.Deck = Read.Deck;
		// The sample's answers kept for the day (so "what you decided" stays honest after a restart).
		if (S.bSample)
		{
			FString Day, Kept;
			FBpStore::GetString(Section, TEXT("SampleDay"), Day);
			FBpStore::GetString(Section, TEXT("SampleAnswers"), Kept);
			if (Day == Today())
			{
				TArray<FString> Rows;
				Kept.ParseIntoArray(Rows, TEXT(";"));
				for (const FString& Row : Rows)
				{
					FString Id, Verdict;
					if (!Row.Split(TEXT("="), &Id, &Verdict) || S.Answers.Contains(Id)) continue;
					const FBpMorningCard* Card = S.Deck.cards.FindByPredicate([&Id](const FBpMorningCard& C) { return C.id == Id; });
					if (!Card) continue;
					FBpStandupAnswer& A = S.Answers.Add(Id);
					A.Verdict = Verdict;
					A.State = FBpStandupAnswer::EState::Sample;
					A.Title = Card->headline;
					A.Words = FString::Printf(TEXT("%s earlier today · sample: nothing was sent."), *VerdictWord(Verdict));
				}
			}
		}
		// A card steered this morning on the PC (here or on the web) reads as answered, as the web's deck does.
		for (const FBpMorningCard& Card : S.Deck.cards)
		{
			if (Card.kind != BpVocab::MorningCard::Kind::Decision || Card.decision.steered.at.IsEmpty() || Card.decision.steered.at < S.Deck.since || S.Answers.Contains(Card.id)) continue;
			FBpStandupAnswer& A = S.Answers.Add(Card.id);
			A.Verdict = Card.decision.steered.verdict;
			A.State = FBpStandupAnswer::EState::Sent;
			A.Title = Card.headline;
			A.Product = Card.product;
			A.Proposal = Card.decision.proposal;
			A.Words = FString::Printf(TEXT("%s at %s. Logged."), *VerdictWord(A.Verdict), *LocalClock(Card.decision.steered.at));
		}
		const FBpMorningCard* Close = S.Deck.cards.FindByPredicate([](const FBpMorningCard& C) { return C.kind == BpVocab::MorningCard::Kind::Close; });
		if (Close) S.CloseLines = Close->lines;
		Pawn->StandupBuildSheets();
		// A read again (the close card's) keeps the card shown by its id.
		const int32 Back = Keep.IsEmpty() ? INDEX_NONE : S.Sheets.IndexOfByPredicate([&S, &Keep](const FBpStandupSheet& Sh) { return S.Deck.cards.IsValidIndex(Sh.Card) && S.Deck.cards[Sh.Card].id == Keep; });
		if (Back != INDEX_NONE) { S.At = Back; Pawn->RefreshConsole(); Pawn->DrawWrist(); if (!S.bSample) Pawn->StandupReadCards(false); return; }
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: the morning %s: %d cards, %d sheets, %d decisions%s"), S.bSample ? TEXT("(the sample)") : TEXT("from your PC"), S.Deck.cards.Num(), S.Sheets.Num(),
			Algo::CountIf(S.Deck.cards, [](const FBpMorningCard& C) { return C.kind == BpVocab::MorningCard::Kind::Decision; }), S.Marks.Num() ? *FString::Printf(TEXT(", a replay of %d rooms"), S.Marks.Num()) : TEXT(""));
		S.At = 0;
		if (S.bJumpToDecision)
		{
			S.bJumpToDecision = false;
			const int32 First = S.Sheets.IndexOfByPredicate([&S](const FBpStandupSheet& Sh)
			{
				return S.Deck.cards.IsValidIndex(Sh.Card) && S.Deck.cards[Sh.Card].kind == BpVocab::MorningCard::Kind::Decision && !S.Answers.Contains(S.Deck.cards[Sh.Card].id);
			});
			if (First != INDEX_NONE) S.At = First;
		}
		Pawn->StandupShowSheet();
		// The companion's requests already pending on the PC are sheets too (before the close); a spoken request jumps to its own.
		if (S.bPullCards) Pawn->StandupShowCompanionCards();
		else if (!S.bSample) Pawn->StandupReadCards(false);
	});
	RefreshConsole();
}

void ABpPawn::StandupBuildSheets()
{
	FBpStandupState& S = *Standup;
	const TArray<FBpStandupSheet> Old = S.Sheets;
	S.Sheets.Reset();
	S.Marks.Reset();
	// "Since your last stand-up": what moved on the plan since then, from the deck's own cards (built, released, raised).
	FDateTime Last;
	ABpTable* Table = WristTable.Get();
	if (Table && FDateTime::ParseIso8601(*S.LastStandup, Last) && (FDateTime::UtcNow() - Last).GetTotalSeconds() >= SinceMinGapS)
	{
		// Per room: what was built there (a built card's line ends " · <room name>"), what was released there, and the decisions
		// raised in it that wait now.
		struct FCount { int32 Built = 0; int32 Released = 0; int32 Waits = 0; };
		TMap<FString, FCount> ByRoom;
		TArray<FString> Order;
		const auto Count = [&](const FString& Room) -> FCount& { if (!ByRoom.Contains(Room)) Order.Add(Room); return ByRoom.FindOrAdd(Room); };
		const auto RoomNamed = [Table](const FString& Name) { return Table->StandupRoomByName(Name); };
		for (const FBpMorningCard& Card : S.Deck.cards)
		{
			if (Card.kind == BpVocab::MorningCard::Kind::Decision)
			{
				const FString Room = Table->StandupRoomOf(Card.place.target.id);
				if (!Room.IsEmpty()) ++Count(Room).Waits;
			}
			else if (Card.kind == BpVocab::MorningCard::Kind::Built || Card.kind == BpVocab::MorningCard::Kind::Release)
			{
				int32 Placed = 0;
				for (const FBpCardLine& Line : Card.lines)
				{
					FString Name;
					if (Line.tone == BpVocab::CardLine::Tone::Bad || !Line.text.Split(TEXT(" · "), nullptr, &Name, ESearchCase::CaseSensitive, ESearchDir::FromEnd)) continue;
					Name.Split(TEXT(":"), &Name, nullptr);
					const FString Room = RoomNamed(Name.TrimStartAndEnd());
					if (Room.IsEmpty()) continue;
					++Placed;
					if (Card.kind == BpVocab::MorningCard::Kind::Built) ++Count(Room).Built; else ++Count(Room).Released;
				}
				if (Placed == 0 && !Card.place.target.id.IsEmpty())
				{
					const FString Room = Table->StandupRoomOf(Card.place.target.id);
					if (!Room.IsEmpty()) { if (Card.kind == BpVocab::MorningCard::Kind::Built) ++Count(Room).Built; else ++Count(Room).Released; }
				}
			}
		}
		for (const FString& Room : Order)
		{
			const FCount& C = ByRoom[Room];
			TArray<FString> Parts;
			if (C.Built) Parts.Add(FString::Printf(TEXT("%d built"), C.Built));
			if (C.Released) Parts.Add(FString::Printf(TEXT("%d released"), C.Released));
			if (C.Waits) Parts.Add(FString::Printf(TEXT("%d %s for you"), C.Waits, C.Waits == 1 ? TEXT("decision waits") : TEXT("decisions wait")));
			S.Marks.Emplace(Room, FString::Join(Parts, TEXT(" · ")));
		}
		if (S.Marks.Num() > 6) S.Marks.SetNum(6);
		if (S.Marks.Num() > 0) S.Sheets.Add({ FBpStandupSheet::EKind::Since });
	}
	for (int32 Index = 0; Index < S.Deck.cards.Num(); ++Index)
	{
		const FBpMorningCard& Card = S.Deck.cards[Index];
		// The day's companion cards come right before the close.
		if (Card.kind == BpVocab::MorningCard::Kind::Close)
		{
			for (const FBpStandupSheet& Each : Old) if (Each.Kind == FBpStandupSheet::EKind::Companion) S.Sheets.Add(Each);
		}
		FBpStandupSheet Sheet;
		Sheet.Card = Index;
		S.Sheets.Add(Sheet);
	}
}

void ABpPawn::StandupShowSheet()
{
	if (!Standup.IsValid()) return;
	FBpStandupState& S = *Standup;
	ABpTable* Table = WristTable.Get();
	S.At = FMath::Clamp(S.At, 0, FMath::Max(0, S.Sheets.Num() - 1));
	S.Armed.Reset();
	S.bConfirm = false;
	GetWorldTimerManager().ClearTimer(StandupTimer);
	S.MarkAt = -1;
	ConsoleSel.Reset();
	StandupLoadShot();
	if (!S.Sheets.IsValidIndex(S.At) || !Table) { RefreshConsole(); DrawWrist(); return; }
	const FBpStandupSheet& Sheet = S.Sheets[S.At];
	if (Sheet.Kind == FBpStandupSheet::EKind::Since)
	{
		// The replay: each changed room raised in turn, its words on the lamp's caption; any press skips it.
		S.MarkAt = 0;
		const FTimerDelegate Step = FTimerDelegate::CreateUObject(this, &ABpPawn::StandupTickSince);
		GetWorldTimerManager().SetTimer(StandupTimer, Step, FMath::Clamp(CVarStandupMarkS.GetValueOnGameThread(), 0.4f, 3.f), true, 0.05f);
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: sheet %d/%d since (replay of %d rooms)"), S.At + 1, S.Sheets.Num(), S.Marks.Num());
	}
	else if (Sheet.Kind == FBpStandupSheet::EKind::Companion)
	{
		S.Room = Table->StandupShow(FString(), FString(), FString());
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: sheet %d/%d companion card %s (%s)"), S.At + 1, S.Sheets.Num(), *Sheet.Companion.Id, *Sheet.Companion.Tool);
	}
	else if (S.Deck.cards.IsValidIndex(Sheet.Card))
	{
		const FBpMorningCard& Card = S.Deck.cards[Sheet.Card];
		const bool bDecision = Card.kind == BpVocab::MorningCard::Kind::Decision;
		// The plan follows the deck: the card's place raised, the lamp beside it, its short line on the caption.
		FString Line;
		if (bDecision) Line = Card.headline;
		else if (Card.kind != BpVocab::MorningCard::Kind::Close && Card.kind != BpVocab::MorningCard::Kind::Open) Line = Card.headline;
		S.Room = Table->StandupShow(Card.place.target.kind.IsEmpty() && !Card.place.target.id.IsEmpty() ? FString(TEXT("room")) : Card.place.target.kind, Card.place.target.id, Line);
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: sheet %d/%d %s %s \"%s\"%s"), S.At + 1, S.Sheets.Num(), *Card.kind, *Card.id, *Card.headline,
			S.Answers.Contains(Card.id) ? *FString::Printf(TEXT(" (answered: %s)"), *S.Answers[Card.id].Verdict) : TEXT(""));
		if (Card.kind == BpVocab::MorningCard::Kind::Close)
		{
			// The stand-up happened: its time is the next morning's "since".
			FBpStore::SetString(Section, TEXT("LastStandup"), NowIso());
			FBpStore::Flush();
			// The server's close lines count what was decided: read the deck again (the web's deck does the same).
			if (!S.bSample) StandupLoad();
		}
	}
	RefreshConsole();
	DrawWrist();
}

void ABpPawn::StandupTickSince()
{
	ABpTable* Table = WristTable.Get();
	if (!Standup.IsValid() || !Table || Standup->MarkAt < 0)
	{
		GetWorldTimerManager().ClearTimer(StandupTimer);
		return;
	}
	FBpStandupState& S = *Standup;
	if (S.MarkAt >= S.Marks.Num())
	{
		GetWorldTimerManager().ClearTimer(StandupTimer);
		S.MarkAt = -1;
		Table->StandupShow(FString(), FString(), FString());
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: the replay ended (%d rooms)"), S.Marks.Num());
		RefreshConsole();
		return;
	}
	const TPair<FString, FString>& Mark = S.Marks[S.MarkAt];
	const FString Name = Table->StandupPlaceName(Mark.Key);
	Table->SetHighlight(TEXT("room"), Mark.Key);
	Table->StandupSay(FString::Printf(TEXT("%s\n%s"), *Name, *Mark.Value));
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: replay %d/%d %s: %s"), S.MarkAt + 1, S.Marks.Num(), *Mark.Key, *Mark.Value);
	++S.MarkAt;
	RefreshConsole();
}

FString ABpPawn::StandupShown() const
{
	if (!Standup.IsValid() || !Standup->Sheets.IsValidIndex(Standup->At)) return FString();
	const FBpStandupState& S = *Standup;
	const FBpStandupSheet& Sheet = S.Sheets[S.At];
	if (Sheet.Kind == FBpStandupSheet::EKind::Companion) return Sheet.Companion.Summary;
	if (!S.Deck.cards.IsValidIndex(Sheet.Card)) return FString();
	// The title and the one-line brief the card displayed.
	const FBpMorningCard& Card = S.Deck.cards[Sheet.Card];
	const FString Short = Card.decision.brief.Short_;
	return Short.IsEmpty() ? Card.headline : Card.headline + TEXT("\n") + Short;
}

void ABpPawn::StandupSaveAnswers() const
{
	if (!Standup.IsValid() || !Standup->bSample) return;
	TArray<FString> Rows;
	for (const TPair<FString, FBpStandupAnswer>& Each : Standup->Answers) Rows.Add(Each.Key + TEXT("=") + Each.Value.Verdict);
	FBpStore::SetString(Section, TEXT("SampleDay"), Today());
	FBpStore::SetString(Section, TEXT("SampleAnswers"), FString::Join(Rows, TEXT(";")));
	FBpStore::Flush();
}

void ABpPawn::StandupVerdict(const FString& Verdict, const TCHAR* Route)
{
	if (!Standup.IsValid() || !Standup->Sheets.IsValidIndex(Standup->At)) return;
	FBpStandupState& S = *Standup;
	const FBpStandupSheet& Sheet = S.Sheets[S.At];
	FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Shown = StandupShown();
	S.Armed.Reset();
	// The sheet the answer was given on: the stand-up moves on from it only if the wearer is still on it when the PC answers
	// (an answer can take minutes; a wearer who walked on is never moved past the sheet they are reading).
	const int32 From = S.At;
	const auto Advance = [this, From]()
	{
		const float After = CVarStandupAdvanceS.GetValueOnGameThread();
		if (After <= 0.f || !Standup.IsValid() || Standup->bTour) return;
		if (Standup->At != From)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpStandup: answered on sheet %d; the wearer is on sheet %d now: no advance"), From + 1, Standup->At + 1);
			return;
		}
		GetWorldTimerManager().SetTimer(StandupTimer, FTimerDelegate::CreateWeakLambda(this, [this, From]()
		{
			if (Standup.IsValid() && Standup->At == From && IsStandupOpen()) { ++Standup->At; StandupShowSheet(); }
		}), FMath::Clamp(After, 0.3f, 5.f), false);
	};
	// A companion card (the day's plan filed it): approve or decline, through the cards route.
	if (Sheet.Kind == FBpStandupSheet::EKind::Companion)
	{
		const FString Id = Sheet.Companion.Id;
		if (S.Answers.Contains(Id) && S.Answers[Id].State != FBpStandupAnswer::EState::Refused && S.Answers[Id].State != FBpStandupAnswer::EState::Unsent) return;
		const bool bApprove = Verdict == BpVocab::SteerPost::Verdict::Approve;
		FBpStandupAnswer& A = S.Answers.Add(Id);
		A.Verdict = bApprove ? TEXT("approve") : TEXT("decline");
		A.State = FBpStandupAnswer::EState::Sending;
		A.Title = Sheet.Companion.Summary;
		A.Words = TEXT("Sending to your PC");
		A.At = FPlatformTime::Seconds();
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s companion card %s by %s"), *A.Verdict, *Id, Route);
		TWeakObjectPtr<ABpPawn> Self(this);
		Link.AnswerCompanionCard(Id, bApprove, Shown, [Self, Id, bApprove, Advance](int32 Status, const FString& Body)
		{
			ABpPawn* Pawn = Self.Get();
			if (!Pawn || !Pawn->Standup.IsValid() || !Pawn->Standup->Answers.Contains(Id)) return;
			FBpStandupAnswer& A = Pawn->Standup->Answers[Id];
			if (Status == 200)
			{
				FString State, Result;
				TSharedPtr<FJsonObject> Json;
				if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid()) { Json->TryGetStringField(TEXT("state"), State); Json->TryGetStringField(TEXT("result"), Result); }
				A.State = FBpStandupAnswer::EState::Sent;
				A.Words = bApprove ? FString::Printf(TEXT("Approved: the card is %s%s."), *State, Result.IsEmpty() ? TEXT("") : *(TEXT(" · ") + Result.Left(120)))
					: FString(TEXT("Declined: the companion will not run it."));
				Advance();
			}
			else
			{
				A.State = Status == 0 ? FBpStandupAnswer::EState::Unsent : FBpStandupAnswer::EState::Refused;
				A.Words = Status == 0 ? FString(TEXT("Not sent: your PC did not answer. Press again to send it.")) : FBpLinkModule::AnswerWords(Status, Body);
			}
			Pawn->RefreshConsole();
			Pawn->DrawWrist();
		});
		RefreshConsole();
		DrawWrist();
		return;
	}
	if (!S.Deck.cards.IsValidIndex(Sheet.Card)) return;
	const FBpMorningCard& Card = S.Deck.cards[Sheet.Card];
	if (Card.kind != BpVocab::MorningCard::Kind::Decision) return;
	if (Verdict == BpVocab::SteerPost::Verdict::Decline && Card.decision.brief.recommend != BpVocab::SteerPost::Verdict::Decline)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: decline refused here: %s repeats no declined idea (decline it on the plan, with your own note)"), *Card.decision.proposal);
		return;
	}
	if (const FBpStandupAnswer* Was = S.Answers.Find(Card.id); Was && (Was->State == FBpStandupAnswer::EState::Sent || Was->State == FBpStandupAnswer::EState::Sending || Was->State == FBpStandupAnswer::EState::Sample))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s is answered already (%s)"), *Card.id, *Was->Verdict);
		return;
	}
	if (!S.bSample && !Link.CanDecide())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s not sent: this headset may not decide (paired %d, decide scope %d)"), *Verdict, Link.GetLinkStatus().Pair == EBpPairState::Paired, Link.GetLinkStatus().Scopes.Contains(TEXT("decide")));
		return;
	}
	FBpStandupAnswer& A = S.Answers.Add(Card.id);
	A.Verdict = Verdict;
	A.Title = Card.headline;
	A.Product = Card.product;
	A.Proposal = Card.decision.proposal;
	A.At = FPlatformTime::Seconds();
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s %s (%s) by %s; shown \"%s\""), *Verdict, *Card.decision.proposal, *Card.product, Route, *Shown.Replace(TEXT("\n"), TEXT(" / ")));
	if (S.bSample)
	{
		// The sample: kept here and in the saved settings for the day, never sent.
		A.State = FBpStandupAnswer::EState::Sample;
		A.Words = Verdict == BpVocab::SteerPost::Verdict::Defer ? TEXT("Later: back tomorrow morning · sample: nothing was sent.")
			: FString::Printf(TEXT("%s · sample: nothing was sent."), *VerdictWord(Verdict));
		StandupSaveAnswers();
		Advance();
		RefreshConsole();
		DrawWrist();
		return;
	}
	A.State = FBpStandupAnswer::EState::Sending;
	A.Words = TEXT("Sending to your PC");
	const FString CardId = Card.id, ProductName = Card.productName.IsEmpty() ? Card.product : Card.productName;
	TWeakObjectPtr<ABpPawn> Self(this);
	Link.PostMorningVerdict(Card.product, Card.decision.proposal, Verdict, Shown, [Self, CardId, Verdict, ProductName, Advance](int32 Status, const FString& Body)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn || !Pawn->Standup.IsValid() || !Pawn->Standup->Answers.Contains(CardId)) return;
		FBpStandupAnswer& A = Pawn->Standup->Answers[CardId];
		if (Status == 200)
		{
			FString Until, Warning, Device;
			TSharedPtr<FJsonObject> Json;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid())
			{
				Json->TryGetStringField(TEXT("until"), Until);
				Json->TryGetStringField(TEXT("warning"), Warning);
				Json->TryGetStringField(TEXT("device"), Device);
			}
			A.State = FBpStandupAnswer::EState::Sent;
			A.Words = !Warning.IsEmpty() ? Warning
				: Verdict == BpVocab::SteerPost::Verdict::Approve ? FString::Printf(TEXT("Approved: moved to approved in %s's store. Logged."), *ProductName)
				: Verdict == BpVocab::SteerPost::Verdict::Defer ? FString::Printf(TEXT("Later: back on the deck after %s. Logged."), *LocalClock(Until))
				: Verdict == BpVocab::SteerPost::Verdict::Hold ? FString(TEXT("Held: it stays on the deck, marked. Logged."))
				: FString(TEXT("Declined as a repeat. Logged."));
			if (!Device.IsEmpty()) A.Words += TEXT(" From ") + Device + TEXT(".");
			Advance();
		}
		else if (Status == 0)
		{
			// The PC went: the answer is kept here and says it was not sent.
			A.State = FBpStandupAnswer::EState::Unsent;
			A.Words = TEXT("Not sent: your PC did not answer. Kept here; press it again to send.");
		}
		else
		{
			A.State = FBpStandupAnswer::EState::Refused;
			A.Words = FBpLinkModule::AnswerWords(Status, Body);
		}
		Pawn->RefreshConsole();
		Pawn->DrawWrist();
	});
	RefreshConsole();
	DrawWrist();
}

void ABpPawn::StandupPlanDay()
{
	if (!Standup.IsValid()) return;
	FBpStandupState& S = *Standup;
	FBpLinkModule& Link = FBpLinkModule::Get();
	if (S.bSample || !Link.HasPcLink() || S.Plan == FBpStandupState::EPlan::Asking) return;
	TArray<FString> Approved;
	for (const TPair<FString, FBpStandupAnswer>& Each : S.Answers)
	{
		if (Each.Value.Verdict == BpVocab::SteerPost::Verdict::Approve && Each.Value.State == FBpStandupAnswer::EState::Sent && !Each.Value.Proposal.IsEmpty())
		{
			Approved.Add(FString::Printf(TEXT("%s (%s, %s)"), *Each.Value.Title, *Each.Value.Proposal, *Each.Value.Product));
		}
	}
	// The fixed, written-down request (the brief: "compose today's wave from what was just approved, say what it would dispatch
	// and what it needs from the person").
	const FString Text = FString::Printf(TEXT("Plan my day. At this morning's stand-up I approved: %s. Compose today's wave from what I approved: say what you would dispatch, in what order, and what you need from me. Answer in at most five short sentences. Do not dispatch anything yourself: anything that needs my yes, file as a card."),
		Approved.Num() ? *FString::Join(Approved, TEXT("; ")) : TEXT("nothing yet"));
	S.Plan = FBpStandupState::EPlan::Asking;
	S.PlanText.Reset();
	S.PlanWords = TEXT("Asking the companion (it can take a few minutes)");
	S.PlanSentAt = FPlatformTime::Seconds();
	if (ABpTable* Table = WristTable.Get()) Table->StandupSay(TEXT("Planning your day…"));
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: plan my day: one companion turn, %d approved findings"), Approved.Num());
	TWeakObjectPtr<ABpPawn> Self(this);
	Link.PostCompanionTurn(Text, [Self](const FBpCompanionTurn& Turn)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn || !Pawn->Standup.IsValid()) return;
		FBpStandupState& S = *Pawn->Standup;
		const double Took = FPlatformTime::Seconds() - S.PlanSentAt;
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: plan my day answered in %.1f s: outcome %d, %d chars%s"), Took, static_cast<int32>(Turn.Outcome), Turn.Text.Len(), Turn.Failure.IsEmpty() ? TEXT("") : *(TEXT(", ") + Turn.Failure));
		if (Turn.Outcome == FBpCompanionTurn::EOutcome::Ok)
		{
			S.Plan = FBpStandupState::EPlan::Done;
			S.PlanText = Turn.Text.TrimStartAndEnd();
			S.PlanWords = FString::Printf(TEXT("The companion answered in %d s."), FMath::RoundToInt(Took));
			// The lamp says it (captions; the voice is a later wave).
			if (ABpTable* Table = Pawn->WristTable.Get()) Table->StandupSay(S.PlanText);
		}
		else
		{
			S.Plan = FBpStandupState::EPlan::Failed;
			S.PlanWords = Turn.Outcome == FBpCompanionTurn::EOutcome::Busy ? FString(TEXT("The companion is busy with another turn: try again in a minute."))
				: Turn.Outcome == FBpCompanionTurn::EOutcome::Unreached ? FString(TEXT("Your PC did not answer: nothing was asked."))
				: !Turn.Words.IsEmpty() ? Turn.Words
				: FString::Printf(TEXT("The companion's turn failed: %s."), *Turn.Failure);
		}
		Pawn->RefreshConsole();
		// Any pending companion card is the person's: it comes as a decision card right after the close's words.
		const TWeakObjectPtr<ABpPawn> Again(Pawn);
		FBpLinkModule::Get().GetCompanionCards([Again](bool bOk, const TArray<FBpCompanionCard>& Cards)
		{
			ABpPawn* P = Again.Get();
			if (!P || !P->Standup.IsValid() || !bOk) return;
			FBpStandupState& St = *P->Standup;
			int32 Added = 0, First = INDEX_NONE;
			const int32 Close = St.Sheets.IndexOfByPredicate([&St](const FBpStandupSheet& Sh) { return St.Deck.cards.IsValidIndex(Sh.Card) && St.Deck.cards[Sh.Card].kind == BpVocab::MorningCard::Kind::Close; });
			for (const FBpCompanionCard& Card : Cards)
			{
				if (Card.State != TEXT("pending") || St.Sheets.ContainsByPredicate([&Card](const FBpStandupSheet& Sh) { return Sh.Kind == FBpStandupSheet::EKind::Companion && Sh.Companion.Id == Card.Id; })) continue;
				FBpStandupSheet Sheet;
				Sheet.Kind = FBpStandupSheet::EKind::Companion;
				Sheet.Companion = Card;
				const int32 At = Close == INDEX_NONE ? St.Sheets.Num() : Close + 1 + Added;
				St.Sheets.Insert(Sheet, At);
				if (First == INDEX_NONE) First = At;
				++Added;
			}
			UE_LOG(LogBpTable, Log, TEXT("BpStandup: %d pending companion cards after the plan"), Added);
			if (First != INDEX_NONE)
			{
				St.At = First;
				P->StandupShowSheet();
			}
		});
	});
	RefreshConsole();
}

void ABpPawn::StandupShowCompanionCards()
{
	// The STAND-UP page first (its morning is read when it opens); the cards follow once it has been read.
	if (!IsStandupOpen()) OpenConsole(TEXT("standup"));
	if (!Standup.IsValid()) return;
	if (Standup->bLoading)
	{
		Standup->bPullCards = true;
		return;
	}
	Standup->bPullCards = false;
	StandupReadCards(true);
}

void ABpPawn::StandupReadCards(bool bJumpToNewest)
{
	if (!Standup.IsValid() || Standup->bSample || !FBpLinkModule::Get().HasPcLink()) return;
	const TWeakObjectPtr<ABpPawn> Again(this);
	const TWeakPtr<FBpStandupState> Weak = Standup;
	FBpLinkModule::Get().GetCompanionCards([Again, Weak, bJumpToNewest](bool bOk, const TArray<FBpCompanionCard>& Cards)
	{
		ABpPawn* P = Again.Get();
		const TSharedPtr<FBpStandupState> Pin = Weak.Pin();
		if (!P || !Pin.IsValid() || P->Standup != Pin || !bOk) return;
		FBpStandupState& St = *Pin;
		const int32 WasAt = St.At, WasN = St.Sheets.Num();
		// The newest pending card (the list is newest first) is the one a spoken request raised.
		const int32 Newest = MergeCompanionCards(St, Cards);
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s: %d companion cards read, %d pending as sheets%s"), bJumpToNewest ? TEXT("a spoken request") : TEXT("the morning's requests"), Cards.Num(), CompanionSheets(St),
			bJumpToNewest && Newest != INDEX_NONE ? *FString::Printf(TEXT(", showing sheet %d"), Newest + 1) : TEXT(""));
		if (bJumpToNewest && Newest != INDEX_NONE) { St.At = Newest; P->StandupShowSheet(); }
		else if (St.At != WasAt || St.Sheets.Num() != WasN) P->StandupShowSheet();
		P->RefreshConsole();
		P->DrawWrist();
	});
}

int32 ABpPawn::StandupPendingRequests() const
{
	if (Standup.IsValid() && !Standup->bLoading && !Standup->bSample)
	{
		int32 N = 0;
		for (const FBpStandupSheet& Sh : Standup->Sheets) N += Sh.Kind == FBpStandupSheet::EKind::Companion && !Standup->Answers.Contains(Sh.Companion.Id) ? 1 : 0;
		return N;
	}
	return FBpLinkModule::Get().HasPcLink() ? FMath::Max(0, GPendingRequests) : 0;
}

void ABpPawn::StandupPeekRequests()
{
	if (FBpLinkModule::Get().IsFromBundle() || !FBpLinkModule::Get().HasPcLink()) return;
	const TWeakObjectPtr<ABpPawn> Again(this);
	FBpLinkModule::Get().GetCompanionCards([Again](bool bOk, const TArray<FBpCompanionCard>& Cards)
	{
		if (!bOk) return;
		GPendingRequests = Algo::CountIf(Cards, [](const FBpCompanionCard& C) { return C.State == TEXT("pending"); });
		if (ABpPawn* P = Again.Get()) { P->RefreshConsole(); P->DrawWrist(); }
	});
}

void ABpPawn::StandupReadPolicies()
{
	if (FBpLinkModule::Get().IsFromBundle() || !FBpLinkModule::Get().HasPcLink()) return;
	TWeakObjectPtr<ABpPawn> Self(this);
	FBpLinkModule::Get().GetPolicies([Self](bool bOk, const TArray<FBpPolicy>& Policies)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn || !bOk) return;
		// The newest live grant made from a table: what "handed over" means here (a web grant is the web's to show).
		const FBpPolicy* Live = Policies.FindByPredicate([](const FBpPolicy& P) { return P.IsLive() && P.GrantedSurface == TEXT("vr"); });
		if (Live) Pawn->StandupGrant = MakeShared<FBpPolicy>(*Live);
		else Pawn->StandupGrant.Reset();
		if (Live)
		{
			FDateTime Until;
			FDateTime::ParseIso8601(*Live->ExpiresAt, Until);
			Pawn->GetWorldTimerManager().SetTimer(Pawn->StandupGrantTimer, FTimerDelegate::CreateWeakLambda(Pawn, [Pawn]() { Pawn->RefreshConsole(); Pawn->DrawWrist(); }),
				FMath::Max(1.f, static_cast<float>((Until - FDateTime::UtcNow()).GetTotalSeconds()) + 1.f), false);
		}
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: policies read: %d, live from a table: %s"), Policies.Num(), Live ? *FString::Printf(TEXT("%s until %s"), *Live->Id, *Live->ExpiresAt) : TEXT("none"));
		Pawn->RefreshConsole();
		Pawn->DrawWrist();
	});
}

namespace
{
	/** The product a grant names: the first approved decision's, else the deck's first decision's, else the table's. */
	FString GrantProduct(const FBpStandupState& S)
	{
		for (const TPair<FString, FBpStandupAnswer>& Each : S.Answers) if (Each.Value.Verdict == BpVocab::SteerPost::Verdict::Approve && !Each.Value.Product.IsEmpty()) return Each.Value.Product;
		for (const FBpMorningCard& Card : S.Deck.cards) if (Card.kind == BpVocab::MorningCard::Kind::Decision && !Card.product.IsEmpty()) return Card.product;
		return FBpLinkModule::Get().GetProductSlug();
	}
	FString GrantProductName(const FBpStandupState& S, const FString& Slug)
	{
		for (const FBpMorningCard& Card : S.Deck.cards) if (Card.product == Slug && !Card.productName.IsEmpty()) return Card.productName;
		return FBpLinkModule::Get().NameOf(Slug);
	}
	/** The confirm sheet's words, which are also what the grant says it showed. */
	FString GrantSheetText(const FBpStandupState& S)
	{
		const FString Product = GrantProduct(S);
		TArray<FString> Tools;
		for (const FString& Tool : FBpLinkModule::PolicyTools()) Tools.Add(ToolWords(Tool));
		const FString Until = (FDateTime::Now() + FTimespan::FromHours(GrantHours)).ToString(TEXT("%H:%M"));
		return FString::Printf(TEXT("Hand over %s until %s (%d hours): the companion may %s, on findings of tier %d to 3 only. Never stop-ship findings."),
			*GrantProductName(S, Product), *Until, GrantHours, *FString::Join(Tools, TEXT(", ")), GrantMinTier);
	}
}

void ABpPawn::StandupGrantNow()
{
	if (!Standup.IsValid() || Standup->bGrantOut) return;
	FBpStandupState& S = *Standup;
	S.bGrantOut = true;
	S.GrantWords = TEXT("Asking your PC to grant it");
	S.bGrantBad = false;
	const FString Product = GrantProduct(S);
	TWeakObjectPtr<ABpPawn> Self(this);
	FBpLinkModule::Get().GrantPolicy(Product, FBpLinkModule::PolicyTools(), GrantMinTier, GrantHours, GrantSheetText(S), [Self](int32 Status, const FBpPolicy& Grant, const FString& Body)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn || !Pawn->Standup.IsValid()) return;
		FBpStandupState& S = *Pawn->Standup;
		S.bGrantOut = false;
		if (Status == 201 && !Grant.Id.IsEmpty())
		{
			// The server's answer is the truth the sheet shows: its product, tools, tier and end, never what was asked.
			Pawn->StandupGrant = MakeShared<FBpPolicy>(Grant);
			S.bConfirm = false;
			TArray<FString> Tools;
			for (const FString& Tool : Grant.Tools) Tools.Add(ToolWords(Tool));
			S.GrantWords = FString::Printf(TEXT("Your PC granted %s: %s; tier %d and milder; until %s (%s)."), *Grant.Product, *FString::Join(Tools, TEXT(", ")), Grant.MinTier, *LocalClock(Grant.ExpiresAt), *Grant.Id);
			FDateTime Until;
			FDateTime::ParseIso8601(*Grant.ExpiresAt, Until);
			Pawn->GetWorldTimerManager().SetTimer(Pawn->StandupGrantTimer, FTimerDelegate::CreateWeakLambda(Pawn, [Pawn]() { Pawn->RefreshConsole(); Pawn->DrawWrist(); }),
				FMath::Max(1.f, static_cast<float>((Until - FDateTime::UtcNow()).GetTotalSeconds()) + 1.f), false);
			if (ABpTable* Table = Pawn->WristTable.Get()) Table->StandupSay(FString::Printf(TEXT("Handed over until %s.\nTake it back from the bar or your wrist."), *LocalClock(Grant.ExpiresAt)));
		}
		else
		{
			S.bGrantBad = true;
			S.GrantWords = FBpLinkModule::AnswerWords(Status, Body);
		}
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: grant %d: %s"), Status, *S.GrantWords);
		Pawn->RefreshConsole();
		Pawn->DrawWrist();
	});
	RefreshConsole();
}

void ABpPawn::StandupRevoke()
{
	if (!StandupGrant.IsValid()) return;
	const FString Id = StandupGrant->Id;
	TWeakObjectPtr<ABpPawn> Self(this);
	FBpLinkModule::Get().RevokePolicy(Id, [Self, Id](int32 Status, const FString& Body)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn) return;
		const FString Words = Status == 200 ? FString::Printf(TEXT("Taken back: %s is revoked on your PC."), *Id) : FBpLinkModule::AnswerWords(Status, Body);
		if (Status == 200 || Status == 404)
		{
			Pawn->StandupGrant.Reset();
			Pawn->GetWorldTimerManager().ClearTimer(Pawn->StandupGrantTimer);
		}
		if (Pawn->Standup.IsValid()) { Pawn->Standup->GrantWords = Words; Pawn->Standup->bGrantBad = Status != 200; }
		Pawn->ConsoleBarWords = Words;
		Pawn->ConsoleBarWordsUntil = FPlatformTime::Seconds() + 6.0;
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: take back %s: %d %s"), *Id, Status, *Words);
		if (ABpTable* Table = Pawn->WristTable.Get(); Table && Status == 200) Table->StandupSay(TEXT("Taken back. The companion asks you again."));
		Pawn->RefreshConsole();
		Pawn->DrawWrist();
	});
}

void ABpPawn::StandupAct(const FString& Act)
{
	UE_LOG(LogBpTable, Log, TEXT("BpStandup: act %s"), *Act);
	// TAKE BACK works from the bar and the wrist with the page closed.
	if (Act == TEXT("revoke")) { StandupRevoke(); return; }
	if (!IsStandupOpen())
	{
		if (Act == TEXT("open")) OpenConsole(TEXT("standup"));
		return;
	}
	FBpStandupState& S = *Standup;
	if (Act == TEXT("retry")) { StandupLoad(); return; }
	if (Act == TEXT("next") || Act == TEXT("prev"))
	{
		if (S.Sheets.Num() == 0) return;
		const int32 To = FMath::Clamp(S.At + (Act == TEXT("next") ? 1 : -1), 0, S.Sheets.Num() - 1);
		if (To == S.At) return;
		S.At = To;
		S.bTour = false;
		StandupShowSheet();
		return;
	}
	if (Act == TEXT("skip"))
	{
		GetWorldTimerManager().ClearTimer(StandupTimer);
		S.MarkAt = -1;
		if (ABpTable* Table = WristTable.Get()) Table->StandupShow(FString(), FString(), FString());
		++S.At;
		StandupShowSheet();
		return;
	}
	if (Act == TEXT("approve") || Act == TEXT("defer") || Act == TEXT("hold") || Act == TEXT("decline"))
	{
		StandupVerdict(Act, TEXT("press"));
		return;
	}
	if (Act == TEXT("plan")) { StandupPlanDay(); return; }
	if (Act == TEXT("handover"))
	{
		if (S.bSample || !FBpLinkModule::Get().CanDecide()) return;
		S.bConfirm = true;
		S.GrantWords.Reset();
		ConsoleSel.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: hand-over sheet: %s"), *GrantSheetText(S));
		RefreshConsole();
		return;
	}
	if (Act == TEXT("grant")) { if (S.bConfirm) StandupGrantNow(); return; }
	if (Act == TEXT("cancel")) { S.bConfirm = false; ConsoleSel.Reset(); RefreshConsole(); return; }
	if (Act == TEXT("done")) { CloseConsole(); return; }
}

bool ABpPawn::StandupPad(const FString& Button)
{
	if (!IsStandupOpen()) return false;
	FBpStandupState& S = *Standup;
	const FBpStandupSheet* Sheet = S.Sheets.IsValidIndex(S.At) ? &S.Sheets[S.At] : nullptr;
	const FBpMorningCard* Card = Sheet && S.Deck.cards.IsValidIndex(Sheet->Card) ? &S.Deck.cards[Sheet->Card] : nullptr;
	const bool bDecision = (Card && Card->kind == BpVocab::MorningCard::Kind::Decision) || (Sheet && Sheet->Kind == FBpStandupSheet::EKind::Companion);
	const FString AnswerKey = Sheet && Sheet->Kind == FBpStandupSheet::EKind::Companion ? Sheet->Companion.Id : Card ? Card->id : FString();
	const FBpStandupAnswer* Answer = S.Answers.Find(AnswerKey);
	const bool bOpenDecision = bDecision && (!Answer || Answer->State == FBpStandupAnswer::EState::Refused || Answer->State == FBpStandupAnswer::EState::Unsent)
		&& (S.bSample || FBpLinkModule::Get().CanDecide());
	if (Button == TEXT("Left") || Button == TEXT("Right"))
	{
		if (!S.Armed.IsEmpty()) { S.Armed.Reset(); }
		StandupAct(Button == TEXT("Right") ? TEXT("next") : TEXT("prev"));
		RefreshConsole();
		return true;
	}
	if (Button == TEXT("Up") || Button == TEXT("Down"))
	{
		// Along the controls of the card (the bottom row), as the arrows walk the console.
		S.Armed.Reset();
		ConsoleMove(Button == TEXT("Down") ? 1 : -1, 0);
		return true;
	}
	if (Button == TEXT("B"))
	{
		if (!S.Armed.IsEmpty()) { S.Armed.Reset(); RefreshConsole(); return true; }
		if (S.bConfirm) { StandupAct(TEXT("cancel")); return true; }
		ConsoleBack();
		return true;
	}
	if (Button != TEXT("A")) return false;
	// A on a selected control presses it; APPROVE (selected, or nothing selected on an open decision) takes a confirm press.
	const bool bApproveSel = ConsoleSel.IsEmpty() || ConsoleSel == TEXT("console:standup:approve");
	if (bOpenDecision && bApproveSel)
	{
		if (S.Armed == TEXT("approve"))
		{
			StandupVerdict(TEXT("approve"), TEXT("pad"));
			return true;
		}
		S.Armed = TEXT("approve");
		GetWorldTimerManager().SetTimer(StandupTimer, FTimerDelegate::CreateWeakLambda(this, [this]() { if (Standup.IsValid()) { Standup->Armed.Reset(); RefreshConsole(); } }), ArmS, false);
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: approve armed (A again to send)"));
		RefreshConsole();
		DrawWrist();
		return true;
	}
	if (!ConsoleSel.IsEmpty()) { ConsoleTap(ConsoleSel); return true; }
	if (S.bConfirm) { ConsoleSel = TEXT("console:standup:grant"); bConsolePadSel = true; RefreshConsole(); return true; }
	if (Card && Card->kind == BpVocab::MorningCard::Kind::Close)
	{
		ConsoleSel = FBpLinkModule::Get().HasPcLink() && !S.bSample ? TEXT("console:standup:plan") : TEXT("console:standup:done");
		bConsolePadSel = true;
		RefreshConsole();
		return true;
	}
	StandupAct(TEXT("next"));
	return true;
}

void ABpPawn::StandupReleaseShot()
{
	if (Standup.IsValid())
	{
		Standup->ShotBrush.Reset();
		Standup->ShotFor.Reset();
		Standup->ShotPath.Reset();
		Standup->bShotLoading = false;
		++Standup->ShotGen;
	}
	if (StandupShot)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: the screen released (%dx%d)"), StandupShot->GetSizeX(), StandupShot->GetSizeY());
		StandupShotKept = StandupShot;
		StandupShot = nullptr;
	}
}

void ABpPawn::StandupLoadShot()
{
	if (!Standup.IsValid()) return;
	FBpStandupState& S = *Standup;
	const FBpStandupSheet* Sheet = S.Sheets.IsValidIndex(S.At) ? &S.Sheets[S.At] : nullptr;
	const FBpMorningCard* Card = Sheet && S.Deck.cards.IsValidIndex(Sheet->Card) ? &S.Deck.cards[Sheet->Card] : nullptr;
	const FString Proposal = Card && Card->kind == BpVocab::MorningCard::Kind::Decision ? Card->decision.proposal : FString();
	if (Proposal == S.ShotFor && !Proposal.IsEmpty()) return;
	StandupReleaseShot();
	S.bShotMissing = false;
	if (Proposal.IsEmpty()) return;
	// The finding's "before" screen: a Shot row of the scan the table holds (the sample's, or the live product's when the card is
	// about the product on the table).
	FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Product = S.bSample ? Link.GetProductSlug() : Card->product;
	const FBpShot* Shot = Product == Link.GetProductSlug() ? FindBeforeShot(Proposal) : nullptr;
	S.ShotFor = Proposal;
	if (!Shot)
	{
		S.bShotMissing = true;
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: %s has no before screen%s"), *Proposal, Product == Link.GetProductSlug() ? TEXT("") : TEXT(" the table holds (another product)"));
		return;
	}
	S.ShotPath = Shot->path;
	S.bShotLoading = true;
	const uint32 Gen = ++S.ShotGen;
	TWeakObjectPtr<ABpPawn> Self(this);
	const double Asked = FPlatformTime::Seconds();
	FetchBeforeShot(Product, Shot->path, [Self, Gen, Asked](UTexture2D* Texture, bool bSample)
	{
		ABpPawn* Pawn = Self.Get();
		if (!Pawn || !Pawn->Standup.IsValid() || Pawn->Standup->ShotGen != Gen) return;
		FBpStandupState& S = *Pawn->Standup;
		S.bShotLoading = false;
		if (!Texture) { S.bShotMissing = true; Pawn->RefreshConsole(); return; }
		S.bShotSample = bSample;
		Pawn->StandupShot = Texture;
		S.ShotBrush = MakeShared<FSlateBrush>();
		S.ShotBrush->SetResourceObject(Texture);
		S.ShotBrush->ImageSize = FVector2D(Texture->GetSizeX(), Texture->GetSizeY());
		S.ShotBrush->DrawAs = ESlateBrushDrawType::Image;
		S.ShotSize = FVector2D(Texture->GetSizeX(), Texture->GetSizeY());
		UE_LOG(LogBpTable, Log, TEXT("BpStandup: the screen of %s drawn at %dx%d (%.0f KB in memory, %.0f ms to read and decode)%s"), *S.ShotFor, Texture->GetSizeX(), Texture->GetSizeY(),
			Texture->GetSizeX() * Texture->GetSizeY() * 4 / 1024.0, (FPlatformTime::Seconds() - Asked) * 1000.0, S.bShotSample ? TEXT(", a sample screen") : TEXT(""));
		Pawn->RefreshConsole();
	});
}

const FBpShot* ABpPawn::FindBeforeShot(const FString& Proposal)
{
	if (Proposal.IsEmpty()) return nullptr;
	return FBpLinkModule::Get().GetScanState().Scan.shots.FindByPredicate([&Proposal](const FBpShot& Each) { return Each.proposal_id == Proposal && Each.phase == BpVocab::Shot::Phase::Before && Each.path.EndsWith(TEXT(".png")); });
}

void ABpPawn::FetchBeforeShot(const FString& Product, const FString& Path, TFunction<void(UTexture2D* Texture, bool bSample)> Done)
{
	TSharedRef<TFunction<void(UTexture2D*, bool)>> Then = MakeShared<TFunction<void(UTexture2D*, bool)>>(MoveTemp(Done));
	FBpLinkModule::Get().FetchShot(Product, Path, [Then](bool bOk, const TArray<uint8>& Png, bool bSample)
	{
		if (!bOk) { (*Then)(nullptr, false); return; }
		// Decoded off the game thread, halved until it is at most 800 px wide (the sheet draws it about 340 px wide). The module
		// is loaded here, on the game thread (the module manager's rule); the worker only uses it.
		IImageWrapperModule* Wrappers = &FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
		Async(EAsyncExecution::ThreadPool, [Then, bSample, Png, Wrappers]()
		{
			TSharedPtr<IImageWrapper> Image = Wrappers->CreateImageWrapper(EImageFormat::PNG);
			TArray64<uint8> Raw;
			int32 W = 0, H = 0;
			if (Image.IsValid() && Image->SetCompressed(Png.GetData(), Png.Num()) && Image->GetRaw(ERGBFormat::BGRA, 8, Raw))
			{
				W = Image->GetWidth();
				H = Image->GetHeight();
				while (W > 800 && W % 2 == 0 && H % 2 == 0)
				{
					const int32 W2 = W / 2, H2 = H / 2;
					TArray64<uint8> Half;
					Half.SetNumUninitialized(static_cast<int64>(W2) * H2 * 4);
					for (int32 Y = 0; Y < H2; ++Y)
					{
						for (int32 X = 0; X < W2; ++X)
						{
							for (int32 C = 0; C < 4; ++C)
							{
								const int64 A = (static_cast<int64>(2 * Y) * W + 2 * X) * 4 + C, B = A + static_cast<int64>(W) * 4;
								Half[(static_cast<int64>(Y) * W2 + X) * 4 + C] = static_cast<uint8>((Raw[A] + Raw[A + 4] + Raw[B] + Raw[B + 4] + 2) / 4);
							}
						}
					}
					Raw = MoveTemp(Half);
					W = W2;
					H = H2;
				}
			}
			AsyncTask(ENamedThreads::GameThread, [Then, bSample, Raw = MoveTemp(Raw), W, H]()
			{
				if (W <= 0 || H <= 0 || Raw.Num() != static_cast<int64>(W) * H * 4) { (*Then)(nullptr, false); return; }
				UTexture2D* Texture = UTexture2D::CreateTransient(W, H, PF_B8G8R8A8);
				if (!Texture) { (*Then)(nullptr, false); return; }
				Texture->SRGB = true;
				Texture->Filter = TF_Bilinear;
				Texture->LODGroup = TEXTUREGROUP_UI;
				Texture->NeverStream = true;
				FTexture2DMipMap& Mip = Texture->GetPlatformData()->Mips[0];
				void* Data = Mip.BulkData.Lock(LOCK_READ_WRITE);
				FMemory::Memcpy(Data, Raw.GetData(), Raw.Num());
				Mip.BulkData.Unlock();
				Texture->UpdateResource();
				(*Then)(Texture, bSample);
			});
		});
	});
}

FString ABpPawn::GetStandupLine() const
{
	if (!IsStandupOpen()) return LiveGrant() ? FString::Printf(TEXT("closed; handed over until %s (%s)"), *LiveGrant()->ExpiresAt, *LiveGrant()->Id) : FString(TEXT("closed"));
	const FBpStandupState& S = *Standup;
	if (S.bLoading) return TEXT("loading");
	if (!S.Error.IsEmpty()) return TEXT("failed: ") + S.Error;
	if (!S.Sheets.IsValidIndex(S.At)) return TEXT("empty");
	const FBpStandupSheet& Sheet = S.Sheets[S.At];
	FString Kind = Sheet.Kind == FBpStandupSheet::EKind::Since ? TEXT("since") : Sheet.Kind == FBpStandupSheet::EKind::Companion ? TEXT("companion") : S.Deck.cards.IsValidIndex(Sheet.Card) ? S.Deck.cards[Sheet.Card].kind : TEXT("?");
	const FString Id = Sheet.Kind == FBpStandupSheet::EKind::Companion ? Sheet.Companion.Id : S.Deck.cards.IsValidIndex(Sheet.Card) ? S.Deck.cards[Sheet.Card].id : FString();
	FString Line = FString::Printf(TEXT("%s %d/%d %s %s"), S.bSample ? TEXT("sample") : TEXT("linked"), S.At + 1, S.Sheets.Num(), *Kind, *Id);
	if (!S.Armed.IsEmpty()) Line += TEXT(" armed=") + S.Armed;
	if (const FBpStandupAnswer* A = S.Answers.Find(Id)) Line += FString::Printf(TEXT(" answer=%s/%d \"%s\""), *A->Verdict, static_cast<int32>(A->State), *A->Words);
	if (S.bConfirm) Line += TEXT(" confirm");
	if (S.Plan != FBpStandupState::EPlan::Idle) Line += FString::Printf(TEXT(" plan=%d"), static_cast<int32>(S.Plan));
	if (LiveGrant()) Line += TEXT(" handed-over=") + LiveGrant()->Id;
	return Line;
}

bool ABpPawn::OpenStandupForTour()
{
	if (IsStandupOpen()) CloseConsole();
	OpenConsole(TEXT("standup"));
	if (!IsStandupOpen()) return false;
	// The deck answers on a later tick: the first open decision is shown when it does.
	Standup->bJumpToDecision = true;
	Standup->bTour = true;
	return true;
}

bool ABpPawn::StandupAnsweredSince(double Since) const
{
	if (!Standup.IsValid()) return false;
	for (const TPair<FString, FBpStandupAnswer>& Each : Standup->Answers)
	{
		if (Each.Value.At >= Since && Each.Value.State != FBpStandupAnswer::EState::Sending && Each.Value.State != FBpStandupAnswer::EState::Refused) return true;
	}
	return false;
}

FString ABpPawn::StandupLastVerdictWords() const
{
	if (!Standup.IsValid()) return FString();
	const FBpStandupAnswer* Last = nullptr;
	for (const TPair<FString, FBpStandupAnswer>& Each : Standup->Answers) if (!Last || Each.Value.At > Last->At) Last = &Each.Value;
	return Last ? Last->Verdict : FString();
}

FString ABpPawn::StandupBarStatus() const
{
	const FBpPolicy* Grant = LiveGrant();
	return Grant ? FString::Printf(TEXT("Handed over until %s"), *LocalClock(Grant->ExpiresAt)) : FString();
}

bool ABpPawn::StandupWristCard(FString& OutKicker, FString& OutTitle, FString& OutWords, TArray<TPair<FString, FString>>& OutButtons) const
{
	OutButtons.Reset();
	if (IsStandupOpen() && Standup->Sheets.IsValidIndex(Standup->At))
	{
		const FBpStandupState& S = *Standup;
		const FBpStandupSheet& Sheet = S.Sheets[S.At];
		const FBpMorningCard* Card = S.Deck.cards.IsValidIndex(Sheet.Card) ? &S.Deck.cards[Sheet.Card] : nullptr;
		const bool bCompanion = Sheet.Kind == FBpStandupSheet::EKind::Companion;
		if (bCompanion || (Card && Card->kind == BpVocab::MorningCard::Kind::Decision))
		{
			const FString Id = bCompanion ? Sheet.Companion.Id : Card->id;
			const FBpStandupAnswer* A = S.Answers.Find(Id);
			int32 Nth = 0, Of = 0;
			for (const FBpMorningCard& Each : S.Deck.cards) if (Each.kind == BpVocab::MorningCard::Kind::Decision) { ++Of; if (Card && Each.id == Card->id) Nth = Of; }
			OutKicker = bCompanion ? FString(TEXT("THE COMPANION ASKS")) : FString::Printf(TEXT("DECISION %d OF %d%s"), Nth, Of, S.bSample ? TEXT(" · SAMPLE") : TEXT(""));
			OutTitle = bCompanion ? Sheet.Companion.Summary : Card->headline;
			const bool bOpen = !A || A->State == FBpStandupAnswer::EState::Refused || A->State == FBpStandupAnswer::EState::Unsent;
			if (!bOpen) { OutWords = A->Words; return true; }
			if (!S.bSample && !FBpLinkModule::Get().CanDecide()) { OutWords = TEXT("Pair this headset to decide here (PC LINK)."); OutButtons.Emplace(TEXT("PC LINK"), TEXT("open:link")); return true; }
			if (A) OutWords = A->Words;
			// Its one line of consequence on the wrist too (night two V4: the sheet's lead), until an answer has words of its own.
			else if (!bCompanion && Card) OutWords = Card->decision.brief.Short_;
			if (bCompanion)
			{
				OutButtons.Emplace(TEXT("APPROVE"), TEXT("standup:approve"));
				OutButtons.Emplace(TEXT("DECLINE"), TEXT("standup:decline"));
			}
			else
			{
				OutButtons.Emplace(S.Armed == TEXT("approve") ? TEXT("CONFIRM") : TEXT("APPROVE"), TEXT("standup:approve"));
				OutButtons.Emplace(TEXT("LATER"), TEXT("standup:defer"));
				// Three fit the wrist; a repeat's DECLINE takes HOLD's place (the deck's recommendation).
				if (Card->decision.brief.recommend == BpVocab::SteerPost::Verdict::Decline) OutButtons.Emplace(TEXT("DECLINE"), TEXT("standup:decline"));
				else OutButtons.Emplace(TEXT("HOLD"), TEXT("standup:hold"));
			}
			return true;
		}
	}
	if (const int32 Requests = IsStandupOpen() ? 0 : StandupPendingRequests(); Requests > 0)
	{
		// The companion's requests waiting on the PC (night two V2): the wrist says so and opens the stand-up on them.
		OutKicker = TEXT("THE COMPANION ASKS");
		OutTitle = FString::Printf(TEXT("%d %s from the companion %s for you"), Requests, Requests == 1 ? TEXT("request") : TEXT("requests"), Requests == 1 ? TEXT("waits") : TEXT("wait"));
		OutWords = TEXT("The stand-up shows each one with APPROVE and DECLINE.");
		OutButtons.Emplace(TEXT("STAND-UP"), TEXT("open:standup"));
		return true;
	}
	if (const FBpPolicy* Grant = LiveGrant())
	{
		OutKicker = TEXT("HANDED OVER");
		OutTitle = FString::Printf(TEXT("Until %s on %s"), *LocalClock(Grant->ExpiresAt), *FBpLinkModule::Get().NameOf(Grant->Product));
		OutWords = FString::Printf(TEXT("The companion answers tier %d and milder for you; never stop-ship findings."), FMath::Max(1, Grant->MinTier));
		OutButtons.Emplace(TEXT("TAKE BACK"), TEXT("standup:revoke"));
		return true;
	}
	return false;
}

FString ABpPawn::StandupKey() const
{
	if (!Standup.IsValid()) return TEXT("|su-none");
	const FBpStandupState& S = *Standup;
	FString Key = FString::Printf(TEXT("|su%d%d|%s|%d/%d|%s|%d%d%d|%d|%s|%s|%d%d|%s|%d"), S.bLoading, S.bSample, *S.Error, S.At, S.Sheets.Num(), *S.Armed, S.bShotLoading, S.bShotMissing, S.ShotBrush.IsValid(),
		static_cast<int32>(S.Plan), *S.PlanWords, *S.PlanText.Left(64), S.bConfirm, S.bGrantOut, *S.GrantWords, S.MarkAt);
	for (const TPair<FString, FBpStandupAnswer>& Each : S.Answers) Key += FString::Printf(TEXT("|%s=%s%d%s"), *Each.Key, *Each.Value.Verdict, static_cast<int32>(Each.Value.State), *Each.Value.Words);
	for (const FBpCardLine& Line : S.CloseLines) Key += TEXT("|c") + Line.text;
	for (const FBpStandupSheet& Sh : S.Sheets) if (Sh.Kind == FBpStandupSheet::EKind::Companion) Key += TEXT("|r") + Sh.Companion.Id;
	Key += FString::Printf(TEXT("|st%d"), S.StampFrame);
	const FBpLinkModule& Link = FBpLinkModule::Get();
	Key += FString::Printf(TEXT("|l%d%d|g%s"), Link.HasPcLink(), Link.CanDecide(), LiveGrant() ? *LiveGrant()->Id : TEXT(""));
	return Key;
}

// ---- The sheet ------------------------------------------------------------------------------------------------------------

void ABpPawn::DrawStandup(const TSharedRef<SCanvas>& Canvas)
{
	const auto Put = [&Canvas](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Canvas->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const FSlateFontInfo HeadFont = Font(TEXT("Bold"), CapHead), LabelFont = Font(TEXT("Bold"), CapLabel), SmallFont = Font(TEXT("Regular"), CapSmall), SmallBold = Font(TEXT("Bold"), CapSmall), AnswerFont = Font(TEXT("Bold"), 32.f);
	const auto Text = [&](const FBox2f& Box, const FString& Words, const FSlateFontInfo& WordFont, const FLinearColor& Ink, int32 MaxLines = 1, EVerticalAlignment V = VAlign_Top)
	{
		const FString Fit = MaxLines <= 1 ? BpSheet::Cut(Words, WordFont, Box.GetSize().X) : BpSheet::Wrap(Words, WordFont, Box.GetSize().X, MaxLines);
		Put(Box, SNew(SBox).VAlign(V)[SNew(STextBlock).Text(FText::FromString(Fit)).Font(WordFont).ColorAndOpacity(FSlateColor(Ink))]);
	};
	/** One line of a list: its words and its mark's ink. */
	struct FItem { FString Words; FLinearColor Ink; };
	const auto LineCount = [](const FString& Wrapped) { int32 N = 1; for (const TCHAR C : Wrapped) N += C == TEXT('\n') ? 1 : 0; return Wrapped.IsEmpty() ? 0 : N; };
	enum class EBtn : uint8 { Fill, Edge, Amber, Off };
	const FString PadLit = bConsolePadSel ? ConsoleSel : FString();
	const auto Button = [&](const FBox2f& Box, const FString& Word, EBtn Look, const FString& Act)
	{
		// One control family (BpSheet's): the quiet button a step lighter than the sheet, brighter under a hand or the pad.
		const bool bLit = !Act.IsEmpty() && (TEXT("console:") + Act == ConsoleHover || TEXT("console:") + Act == PadLit);
		// Night two V6: held by a pinch or A, the answer sinks until the release (BpSheet::Control's pressed look).
		const bool bDown = Look != EBtn::Off && !Act.IsEmpty() && ((TEXT("console:") + Act == ConsoleHover && bConsoleHoverDown) || (TEXT("console:") + Act == PadLit && bPadADown));
		FLinearColor Fill = Look == EBtn::Fill ? BpSheet::Accent : Look == EBtn::Amber ? BpSheet::Amber : Look == EBtn::Off ? FLinearColor::Transparent : BpSheet::RowFill(bLit);
		if (bDown) Fill = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(0.32f) : Fill * 0.72f;
		const FLinearColor Edge = Look == EBtn::Edge ? BpSheet::Ink.CopyWithNewOpacity(bLit ? 1.f : 0.7f) : Look == EBtn::Off ? BpSheet::OffEdge() : FLinearColor::Transparent;
		const FLinearColor Ink = Look == EBtn::Edge ? BpSheet::InkHi : Look == EBtn::Off ? BpSheet::OffInk() : BpSheet::PaperLo;
		Put(bDown ? Box.ExpandBy(-3.f) : Box, SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(Fill).Edge(Edge).EdgePx(2.5f)]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Word, Box.GetSize().Y >= 70.f ? AnswerFont : LabelFont, Box.GetSize().X - 20.f))).Font(Box.GetSize().Y >= 70.f ? AnswerFont : LabelFont).ColorAndOpacity(FSlateColor(Ink))
			]);
		// A control that cannot act now is drawn, never pressed (no box: neither a hand nor the pad lands on it).
		if (Look != EBtn::Off && !Act.IsEmpty()) ConsoleBoxes.Add({ TEXT("console:") + Act, Box });
	};
	/** A row of buttons centred in [X0, X1]: (word, look, act, width). */
	struct FRowButton { FString Word; EBtn Look; FString Act; float W; };
	const auto Row = [&](float X0, float X1, const TArray<FRowButton>& Buttons)
	{
		float Total = 0.f;
		for (const FRowButton& B : Buttons) Total += B.W;
		Total += 16.f * FMath::Max(0, Buttons.Num() - 1);
		float X = X0 + FMath::Max(0.f, (X1 - X0 - Total) * 0.5f);
		for (const FRowButton& B : Buttons) { Button(FBox2f(FVector2f(X, BtnY0), FVector2f(X + B.W, BtnY1)), B.Word, B.Look, B.Act); X += B.W + 16.f; }
	};
	/** A small square mark in a tone, beside a line (the plan's square markers). */
	const auto Mark = [&](float X, float Y, const FLinearColor& Ink) { Put(FBox2f(FVector2f(X, Y), FVector2f(X + 12.f, Y + 12.f)), SNew(BpSheet::SPlate).Fill(Ink)); };
	/** Lines with their marks from Y, each wrapped to at most Wrap lines; returns the Y after them. Stops at YMax. */
	const auto Lines = [&](float X0, float X1, float Y, float YMax, const TArray<FItem>& Items, int32 Wrap)
	{
		const float P = Pitch(CapSmall);
		// Night two V4: an item whole (wrapped to as many lines as it needs, never an ellipsis); the first that does not fit whole
		// stops the list, and "and N more" says what was left when a line is free for it.
		(void)Wrap;
		for (int32 At = 0; At < Items.Num(); ++At)
		{
			const FItem& Item = Items[At];
			const int32 Room = FMath::FloorToInt((YMax - Y) / P);
			const FString Fit = BpSheet::Wrap(Item.Words, SmallFont, X1 - X0 - 28.f, 0);
			const int32 N = LineCount(Fit);
			if (N > Room)
			{
				if (Room >= 1 && At > 0)
				{
					Put(FBox2f(FVector2f(X0 + 28.f, Y), FVector2f(X1, Y + P + 4.f)), SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("and %d more"), Items.Num() - At))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.6f))));
					Y += P + 8.f;
				}
				break;
			}
			Mark(X0, Y + P * 0.5f - 8.f, Item.Ink);
			Put(FBox2f(FVector2f(X0 + 28.f, Y), FVector2f(X1, Y + N * P + 4.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink)));
			Y += N * P + 8.f;
		}
		return Y;
	};

	if (!Standup.IsValid()) return;
	FBpStandupState& S = *Standup;
	FBpLinkModule& Link = FBpLinkModule::Get();
	const FString ProductName = Link.GetProductName().IsEmpty() ? Link.NameOf(Link.GetProductSlug()) : Link.GetProductName();

	// The frame: the sheet's border, and its title block at the bottom right (the drawing set's: sheet number, project, date).
	const FBox2f Frame(FVector2f(Pad, FrameY0), FVector2f(LW - Pad, FrameY1));
	Put(Frame, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.32f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
	const auto TitleBlock = [&](const FString& SheetNo, const FString& Project)
	{
		const float W = 440.f, H = 46.f;
		const FBox2f Block(FVector2f(Frame.Max.X - W, Frame.Max.Y - H), Frame.Max);
		Put(Block, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.5f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
		Put(FBox2f(FVector2f(Block.Min.X + 104.f, Block.Min.Y + 8.f), FVector2f(Block.Min.X + 106.f, Block.Max.Y - 8.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f)));
		Put(FBox2f(Block.Min + FVector2f(14.f, 0.f), FVector2f(Block.Min.X + 100.f, Block.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(SheetNo)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
		Put(FBox2f(FVector2f(Block.Min.X + 120.f, Block.Min.Y), Block.Max - FVector2f(12.f, 0.f)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Project, SmallFont, W - 134.f))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
	};
	static const TCHAR* const Months[] = { TEXT("JAN"), TEXT("FEB"), TEXT("MAR"), TEXT("APR"), TEXT("MAY"), TEXT("JUN"), TEXT("JUL"), TEXT("AUG"), TEXT("SEP"), TEXT("OCT"), TEXT("NOV"), TEXT("DEC") };
	const FDateTime Now = FDateTime::Now();
	const FString DayWord = S.bSample ? FString(TEXT("SAMPLE")) : FString::Printf(TEXT("%d %s"), Now.GetDay(), Months[FMath::Clamp(Now.GetMonth(), 1, 12) - 1]);

	if (S.bLoading || !S.Error.IsEmpty() || S.Sheets.Num() == 0)
	{
		const bool bFailed = !S.Error.IsEmpty();
		Text(FBox2f(FVector2f(InX, FrameY0 + 22.f), FVector2f(Frame.Max.X - 26.f, FrameY0 + 56.f)), bFailed ? TEXT("THE MORNING DID NOT READ") : TEXT("STAND-UP"), SmallBold, bFailed ? BpSheet::Red : BpSheet::Accent);
		Text(FBox2f(FVector2f(InX, FrameY0 + 64.f), FVector2f(Frame.Max.X - 26.f, FrameY0 + 190.f)), bFailed ? S.Error : TEXT("Reading the morning"), HeadFont, BpSheet::InkHi, 2);
		TitleBlock(TEXT("M-00"), ProductName.ToUpper() + TEXT(" · ") + DayWord);
		if (bFailed) Row(Pad, LW - Pad, TArray<FRowButton>{ FRowButton{ TEXT("TRY AGAIN"), EBtn::Fill, TEXT("standup:retry"), 260.f } });
		return;
	}

	// The strip: one segment per sheet, read left to right (answered ones filled, the one shown amber).
	{
		const int32 N = S.Sheets.Num();
		const float Gap = 6.f, W = (LW - 2.f * Pad - Gap * (N - 1)) / FMath::Max(1, N);
		for (int32 Index = 0; Index < N; ++Index)
		{
			const FBpStandupSheet& Each = S.Sheets[Index];
			const FBpMorningCard* C = S.Deck.cards.IsValidIndex(Each.Card) ? &S.Deck.cards[Each.Card] : nullptr;
			const FString Id = Each.Kind == FBpStandupSheet::EKind::Companion ? Each.Companion.Id : C ? C->id : FString();
			const bool bDecision = Each.Kind == FBpStandupSheet::EKind::Companion || (C && C->kind == BpVocab::MorningCard::Kind::Decision);
			const bool bAnswered = S.Answers.Contains(Id) && S.Answers[Id].State != FBpStandupAnswer::EState::Refused;
			const FLinearColor Fill = Index == S.At ? BpSheet::Amber : bAnswered ? BpSheet::Accent : Index < S.At ? BpSheet::Ink.CopyWithNewOpacity(0.55f) : FLinearColor::Transparent;
			const float X0 = Pad + Index * (W + Gap);
			Put(FBox2f(FVector2f(X0, StripY0), FVector2f(X0 + W, StripY1)), SNew(BpSheet::SPlate).Fill(Fill).Edge(bDecision ? BpSheet::Amber.CopyWithNewOpacity(0.85f) : BpSheet::Ink.CopyWithNewOpacity(0.45f)).EdgePx(1.5f));
		}
	}

	const FBpStandupSheet& Sheet = S.Sheets[S.At];
	const FBpMorningCard* Card = S.Deck.cards.IsValidIndex(Sheet.Card) ? &S.Deck.cards[Sheet.Card] : nullptr;
	const bool bCompanion = Sheet.Kind == FBpStandupSheet::EKind::Companion;
	const bool bDecision = bCompanion || (Card && Card->kind == BpVocab::MorningCard::Kind::Decision);
	const bool bClose = Card && Card->kind == BpVocab::MorningCard::Kind::Close;
	const FString AnswerId = bCompanion ? Sheet.Companion.Id : Card ? Card->id : FString();
	const FBpStandupAnswer* Answer = S.Answers.Find(AnswerId);
	int32 Nth = 0, Of = 0;
	for (const FBpMorningCard& Each : S.Deck.cards) if (Each.kind == BpVocab::MorningCard::Kind::Decision) { ++Of; if (Card && Each.id == Card->id) Nth = Of; }
	const FString SheetNo = FString::Printf(TEXT("M-%02d"), S.At + 1);
	const FString Project = (Card && !Card->productName.IsEmpty() ? Card->productName : ProductName).ToUpper() + TEXT(" · ") + DayWord;
	const float TextX1 = Frame.Max.X - 26.f;
	FString Status;
	FLinearColor StatusInk = BpSheet::Ink.CopyWithNewOpacity(0.85f);
	TArray<FRowButton> Buttons;
	const FRowButton Prev = { TEXT("‹  PREV"), S.At > 0 ? EBtn::Edge : EBtn::Off, TEXT("standup:prev"), 150.f };
	const bool bLast = S.At >= S.Sheets.Num() - 1;
	const FRowButton Next = { TEXT("NEXT  ›"), bLast ? EBtn::Off : EBtn::Fill, TEXT("standup:next"), 150.f };
	bool bPager = true;

	if (Sheet.Kind == FBpStandupSheet::EKind::Since)
	{
		// The replay: the rooms that changed since the last stand-up, each raised in turn on the plan.
		Text(FBox2f(FVector2f(InX, FrameY0 + 20.f), FVector2f(TextX1, FrameY0 + 52.f)), FString::Printf(TEXT("SINCE YOUR LAST STAND-UP · %s"), *AgoWords(S.LastStandup).ToUpper()), SmallBold, BpSheet::Accent);
		Text(FBox2f(FVector2f(InX, FrameY0 + 60.f), FVector2f(TextX1, FrameY0 + 124.f)), TEXT("What changed on the plan"), HeadFont, BpSheet::InkHi);
		float Y = FrameY0 + 140.f;
		for (int32 Index = 0; Index < S.Marks.Num(); ++Index)
		{
			const bool bNow = S.MarkAt - 1 == Index;
			const FString Name = WristTable.IsValid() ? WristTable->StandupPlaceName(S.Marks[Index].Key) : S.Marks[Index].Key;
			Mark(InX, Y + 10.f, bNow ? BpSheet::Amber : S.MarkAt < 0 || Index < S.MarkAt ? BpSheet::Accent : BpSheet::Ink.CopyWithNewOpacity(0.35f));
			Put(FBox2f(FVector2f(InX + 28.f, Y), FVector2f(InX + 450.f, Y + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(Name, SmallBold, 420.f))).Font(SmallBold).ColorAndOpacity(FSlateColor(bNow ? BpSheet::Amber : BpSheet::InkHi)));
			Put(FBox2f(FVector2f(InX + 460.f, Y), FVector2f(TextX1, Y + 44.f)), SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(S.Marks[Index].Value, SmallFont, TextX1 - InX - 460.f))).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink)));
			Y += 50.f;
		}
		Status = S.MarkAt >= 0 ? FString::Printf(TEXT("Raising each room on the plan, %d of %d · NEXT or B skips"), FMath::Max(1, S.MarkAt), S.Marks.Num()) : FString(TEXT("Each room was raised on the plan in turn."));
		TitleBlock(SheetNo, Project);
		Buttons = { Prev, S.MarkAt >= 0 ? FRowButton{ TEXT("SKIP"), EBtn::Edge, TEXT("standup:skip"), 170.f } : Next };
		bPager = false;
	}
	else if (bDecision)
	{
		// The decision as a sheet (night two V2: the product's money shot). The title and the one line of consequence lead; the
		// finding's screen takes the sheet's right half, large enough to read as a screen; the answers are the largest controls on
		// the sheet, APPROVE the primary; the answer taken lands as a stamp. A companion's card is the same family told apart: a
		// cyan rule down its left (the system's colour), "THE COMPANION ASKS", a human sentence first and its raw ids set small.
		const bool bScreen = !bCompanion && (S.ShotBrush.IsValid() || S.bShotLoading);
		const float ColX1 = bScreen ? Pad + 556.f : bCompanion ? TextX1 - 330.f : TextX1;
		const FBpCardDecision* D = Card ? &Card->decision : nullptr;
		const bool bStop = D && Card->tone == BpVocab::MorningCard::Tone::Bad;
		// The generated tier reads an absent one as 0: the deck's own second line says "Untiered" when it has none.
		const bool bTiered = D && Card->lines.Num() > 1 && !Card->lines[1].text.StartsWith(TEXT("Untiered"));
		const FString Tier = bTiered ? BpWords::TierSays(D->tier) : FString();
		if (bCompanion)
		{
			Put(FBox2f(Frame.Min, FVector2f(Frame.Min.X + 8.f, Frame.Max.Y)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
		}
		FString Kicker = bCompanion ? FString(TEXT("THE COMPANION ASKS")) : FString::Printf(TEXT("DECISION %d OF %d"), Nth, Of);
		if (Card && Card->news) Kicker += TEXT(" · NEW");
		// Where it is, on the kicker when it fits whole (the plan raises the room as well): the deck's first line without its count.
		if (Card && Card->lines.Num() > 0)
		{
			FString Where = Card->lines[0].text;
			Where.Split(TEXT(" · "), nullptr, &Where);
			// One product on the deck: its name is the title block's, the kicker names the room only.
			if (S.Deck.products.Num() <= 1) Where.Split(TEXT(" · "), nullptr, &Where);
			const FString Longer = Kicker + TEXT(" · ") + Where.ToUpper();
			if (!Where.IsEmpty() && BpSheet::TextWidth(Longer, SmallBold) <= ColX1 - InX) Kicker = Longer;
		}
		Text(FBox2f(FVector2f(InX, FrameY0 + 16.f), FVector2f(ColX1, FrameY0 + 48.f)), Kicker, SmallBold, bCompanion ? BpSheet::Accent : bStop ? BpSheet::Red : BpSheet::Amber);
		// A companion's summary: the human sentence first, the ids after it set small ("…edit code (kettle-web): wave w-…, packages
		// [...]" reads as the sentence, then "kettle-web · wave w-…, packages [...]").
		FString Headline = bCompanion ? Sheet.Companion.Summary : Card->headline;
		FString Raw;
		if (bCompanion)
		{
			FString Left, Right;
			if (Headline.Split(TEXT(": "), &Left, &Right, ESearchCase::CaseSensitive, ESearchDir::FromEnd) && (Left.EndsWith(TEXT(")")) || Right.Contains(TEXT("[")) || Right.Contains(TEXT("\"")) || Right.Contains(TEXT("{")) || Right.Contains(TEXT("-"))))
			{
				Headline = Left;
				Raw = Right;
				FString Before, Slug;
				if (Headline.EndsWith(TEXT(")")) && Headline.Split(TEXT(" ("), &Before, &Slug, ESearchCase::CaseSensitive, ESearchDir::FromEnd)) { Headline = Before; Raw = Slug.LeftChop(1) + TEXT(" · ") + Raw; }
			}
			Raw = Sheet.Companion.Tool + (Raw.IsEmpty() ? FString() : TEXT(" · ") + Raw);
			if (!Headline.EndsWith(TEXT("."))) Headline += TEXT(".");
		}
		const FString HeadFit = BpSheet::Wrap(Headline, HeadFont, ColX1 - InX, 3);
		const int32 HeadLines = LineCount(HeadFit);
		Put(FBox2f(FVector2f(InX, FrameY0 + 52.f), FVector2f(ColX1, FrameY0 + 52.f + HeadLines * Pitch(CapHead) + 6.f)), SNew(STextBlock).Text(FText::FromString(HeadFit)).Font(HeadFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		float Y = FrameY0 + 58.f + HeadLines * Pitch(CapHead) + 6.f;
		const FSlateFontInfo LeadFont = Font(TEXT("Regular"), CapLabel);
		/** The one line of consequence: 28 px, bright, under the title. */
		const auto Lead = [&](const FString& Words, const FLinearColor& Ink, int32 MaxLines, float Cap = CapLabel)
		{
			const FSlateFontInfo WordFont = Cap == CapLabel ? LeadFont : Font(TEXT("Regular"), Cap);
			const FString Fit = BpSheet::Wrap(Words, WordFont, ColX1 - InX, MaxLines);
			const int32 N = LineCount(Fit);
			Put(FBox2f(FVector2f(InX, Y), FVector2f(ColX1, Y + N * Pitch(Cap) + 4.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(WordFont).ColorAndOpacity(FSlateColor(Ink)));
			Y += N * Pitch(Cap) + 10.f;
		};
		if (bCompanion)
		{
			const FString Wants = ToolWords(Sheet.Companion.Tool);
			Lead(FString::Printf(TEXT("It asks to %s%s."), *Wants, Sheet.Companion.Product.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" on %s"), *Link.NameOf(Sheet.Companion.Product))), BpSheet::Accent, 2);
			const FString RawFit = BpSheet::Wrap(Raw, SmallFont, ColX1 - InX, 2);
			const int32 RawN = LineCount(RawFit);
			Put(FBox2f(FVector2f(InX, Y), FVector2f(ColX1, Y + RawN * Pitch(CapSmall) + 4.f)), SNew(STextBlock).Text(FText::FromString(RawFit)).Font(SmallFont).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.5f))));
			Y += RawN * Pitch(CapSmall) + 14.f;
			TArray<FItem> Items;
			Items.Add({ FString::Printf(TEXT("Filed by the companion at %s for %s"), *LocalClock(Sheet.Companion.CreatedAt), *(Sheet.Companion.Product.IsEmpty() ? FString(TEXT("every product")) : Link.NameOf(Sheet.Companion.Product))), BpSheet::Ink.CopyWithNewOpacity(0.6f) });
			Items.Add({ TEXT("Approve runs it on your PC now; decline drops it."), BpSheet::Amber });
			Lines(InX, ColX1, Y, Frame.Max.Y - 12.f, Items, 1);
			// The lamp, drawn: who is asking.
			Put(FBox2f(FVector2f(ColX1 + 40.f, FrameY0 + 30.f), FVector2f(TextX1, FrameY0 + 280.f)), SNew(BpSheet::SMotif).Kind(2));
		}
		else
		{
			// The consequence: the brief's one line, large; then the tier chip with its class and age; then the evidence, quiet.
			const FBpCardBrief& Brief = D->brief;
			// Night two V6: a three-line title over a three-line consequence pushed the tier chip out of the frame onto the footnote
			// (cap\v6-walk-58-su-dec3.png); the consequence then takes the 24 px face, and the chip row stays inside the frame.
			const float ChipRowH = Card->lines.Num() > 1 ? 50.f : 0.f;
			if (!Brief.Short_.IsEmpty())
			{
				const int32 AtLabel = LineCount(BpSheet::Wrap(Brief.Short_, LeadFont, ColX1 - InX, 3));
				const bool bTight = Y + AtLabel * Pitch(CapLabel) + 10.f + ChipRowH > Frame.Max.Y - 6.f;
				Lead(Brief.Short_, BpSheet::InkHi, 3, bTight ? CapSmall : CapLabel);
			}
			// The PC refused an approval from here (night two V4): its reason, whole, under the consequence.
			if (Answer && Answer->State == FBpStandupAnswer::EState::Refused && !Answer->Words.IsEmpty()) Lead(Answer->Words, BpSheet::Red, 0);
			// The chip row only inside the frame: when even the smaller consequence leaves no room it goes (the tier is on the deck).
			if (Card->lines.Num() > 1 && Y + 40.f <= Frame.Max.Y - 6.f)
			{
				const FString Chip = Tier.IsEmpty() ? FString(TEXT("UNTIERED")) : Tier.ToUpper();
				const float ChipW = BpSheet::TextWidth(Chip, SmallBold) + 28.f;
				Put(FBox2f(FVector2f(InX, Y), FVector2f(InX + ChipW, Y + 40.f)), BpSheet::Pin(Chip, SmallBold, 40.f, bStop ? BpSheet::Red : BpSheet::Amber, ChipW));
				FString Rest = Card->lines[1].text;
				Rest.Split(TEXT(" · "), nullptr, &Rest);
				Text(FBox2f(FVector2f(InX + ChipW + 16.f, Y), FVector2f(ColX1, Y + 40.f)), Rest, SmallFont, BpSheet::Ink, 1, VAlign_Center);
				Y += 50.f;
			}
			TArray<FItem> Items;
			const FString Stakes = Card->lines.Num() > 2 && Card->lines[2].tone.IsEmpty() ? Card->lines[2].text : FString();
			if (!Stakes.IsEmpty()) Items.Add({ Stakes, BpSheet::Ink.CopyWithNewOpacity(0.45f) });
			for (int32 L = 3; L < Card->lines.Num(); ++L) Items.Add(FItem{ Card->lines[L].text, ToneInk(Card->lines[L].tone) });
			for (const FBpBriefFact& Fact : Brief.facts)
			{
				if (Fact.key == BpVocab::BriefFact::Key::Undo || Fact.key == BpVocab::BriefFact::Key::Cost) Items.Add({ Fact.text, BpSheet::Ink.CopyWithNewOpacity(0.45f) });
			}
			// Full width (no screen), the lines stop above the title block.
			Lines(InX, ColX1, Y + 2.f, Frame.Max.Y - (bScreen ? 12.f : 56.f), Items, 1);
		}
		// The screen: the finding's "before", unlit on the sheet in a fine frame, large, with what it is under it.
		// The screen fills the right half down to the title block; its caption is a strip across its foot.
		const float ImgX0 = ColX1 + 30.f, ImgX1 = TextX1, ImgW = ImgX1 - ImgX0, ImgH = FMath::Min(ImgW * 9.f / 16.f, Frame.Max.Y - 62.f - FrameY0 - 16.f);
		const FBox2f Img = bScreen ? FBox2f(FVector2f(ImgX0, FrameY0 + 16.f), FVector2f(ImgX1, FrameY0 + 16.f + ImgH))
			: FBox2f(FVector2f(TextX1 - 470.f, Frame.Max.Y - 200.f), FVector2f(TextX1, Frame.Max.Y - 60.f));
		if (bScreen && S.ShotBrush.IsValid())
		{
			Put(Img.ExpandBy(5.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Ink.CopyWithNewOpacity(0.8f)).EdgePx(2.f));
			Put(Img, SNew(SImage).Image(S.ShotBrush.Get()));
		}
		else if (bScreen)
		{
			Put(Img, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.4f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.35f)).EdgePx(2.f));
			Put(Img, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock)
				.Text(FText::FromString(S.bShotLoading ? TEXT("READING THE SCREEN") : TEXT("NO SCREEN FOR THIS FINDING"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.55f)))]);
		}
		if (bScreen)
		{
			const FString Feature = WristTable.IsValid() ? WristTable->StandupPlaceName(Card->place.target.id) : Card->place.target.id;
			// The screen's own "sample screen" label stays in the image; the caption says which screen, and SAMPLE when it is one.
			// Night two V4: the caption wraps (it was cut: "BEFORE · PAYOUT…"), its strip as tall as its lines.
			const bool bSampleShot = S.ShotBrush.IsValid() && S.bShotSample;
			const float TagW = bSampleShot ? BpSheet::TextWidth(TEXT("SAMPLE"), SmallBold) + 28.f : 0.f;
			const FString Caption = FString::Printf(TEXT("BEFORE · %s"), *(Feature.IsEmpty() ? Card->place.target.id : Feature)).ToUpper();
			const FString CaptionFit = BpSheet::Wrap(Caption, SmallBold, ImgX1 - TagW - 24.f - ImgX0, 0);
			const float CapH = FMath::Max(40.f, LineCount(CaptionFit) * Pitch(CapSmall) + 8.f);
			const float CapY = Img.Max.Y - CapH;
			Put(FBox2f(FVector2f(Img.Min.X, CapY), Img.Max), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.9f)));
			Put(FBox2f(FVector2f(ImgX0 + 12.f, CapY), FVector2f(ImgX1 - TagW - 12.f, Img.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(CaptionFit)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
			if (bSampleShot) Put(FBox2f(FVector2f(ImgX1 - TagW, Img.Max.Y - 40.f), FVector2f(ImgX1, Img.Max.Y)), BpSheet::Pin(TEXT("SAMPLE"), SmallBold, 40.f, BpSheet::Amber, TagW));
		}
		TitleBlock(SheetNo, Project);
		// The answers. Approve is the primary (amber); LATER is the web's Defer (back tomorrow); DECLINE only on a repeat.
		const bool bRefused = Answer && Answer->State == FBpStandupAnswer::EState::Refused;
		const bool bOpen = !Answer || bRefused || Answer->State == FBpStandupAnswer::EState::Unsent;
		const bool bMay = S.bSample || Link.CanDecide();
		const bool bArmed = S.Armed == TEXT("approve");
		// Answered: the answer taken is the one filled button, and the sheet carries its stamp (the drawing set's approval block).
		const bool bTaken = Answer && (Answer->State == FBpStandupAnswer::EState::Sent || Answer->State == FBpStandupAnswer::EState::Sample || Answer->State == FBpStandupAnswer::EState::Sending);
		// The PC refused an approval from the table (403 with its sentence): the card stays, APPROVE goes quiet, DECLINE stays.
		const bool bApproveRefused = bRefused && Answer->Verdict == BpVocab::SteerPost::Verdict::Approve;
		const auto LookOf = [&](const TCHAR* Verdict, EBtn Open)
		{
			if (bTaken) return Answer->Verdict == Verdict ? EBtn::Fill : EBtn::Off;
			if (bApproveRefused && FCString::Strcmp(Verdict, BpVocab::SteerPost::Verdict::Approve) == 0) return EBtn::Off;
			return bOpen && bMay ? Open : EBtn::Off;
		};
		if (bTaken && Answer->State != FBpStandupAnswer::EState::Sending)
		{
			// The stamp lands: scaled down onto the sheet and settled in StampS (a cut with bp.ReducedMotion), then still.
			const FLinearColor StampInk = Answer->Verdict == BpVocab::SteerPost::Verdict::Approve ? BpSheet::Accent : Answer->Verdict == BpVocab::SteerPost::Verdict::Decline ? BpSheet::Red : BpSheet::Amber;
			const FString Stamp = FString::Printf(TEXT("%s%s"), *VerdictWord(Answer->Verdict).ToUpper(), Answer->State == FBpStandupAnswer::EState::Sample ? TEXT(" · SAMPLE") : TEXT(" · SENT"));
			const FSlateFontInfo StampFont = Font(TEXT("Bold"), 40.f);
			const float StampW = BpSheet::TextWidth(Stamp, StampFont) + 56.f, StampH = 84.f;
			const FVector2f C = bScreen ? FVector2f(Img.Min.X + StampW * 0.5f + 24.f, Img.Max.Y - StampH * 0.5f - 60.f) : Img.GetCenter();
			const FBox2f StampBox(C - FVector2f(StampW, StampH) * 0.5f, C + FVector2f(StampW, StampH) * 0.5f);
			const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
			const bool bCut = Reduced && Reduced->GetInt() != 0;
			const double StampNow = FPlatformTime::Seconds();
			if (S.StampFor != AnswerId)
			{
				S.StampFor = AnswerId;
				// Only an answer taken while this sheet showed lands; a sheet revisited shows its stamp still.
				S.StampAt = S.UnstampedShown == AnswerId && !bCut ? StampNow : -100.0;
				if (S.StampAt > 0.0)
				{
					const TWeakObjectPtr<ABpPawn> Self(this);
					GetWorldTimerManager().SetTimer(S.StampTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
					{
						if (!Standup.IsValid() || FPlatformTime::Seconds() - Standup->StampAt > StampS + 0.05) { if (Standup.IsValid()) GetWorldTimerManager().ClearTimer(Standup->StampTimer); RefreshConsole(); return; }
						++Standup->StampFrame;
						RefreshConsole();
					}), 1.f / 30.f, true);
				}
			}
			const float E = FMath::Clamp(static_cast<float>((StampNow - S.StampAt) / StampS), 0.f, 1.f);
			const float Settle = 1.f - FMath::Square(1.f - E);
			const float Scale = 1.f + 0.7f * (1.f - Settle);
			const float Angle = FMath::DegreesToRadians(-7.f + 5.f * (1.f - Settle));
			Put(StampBox, SNew(SBox).RenderTransformPivot(FVector2D(0.5, 0.5)).RenderTransform(FSlateRenderTransform(Concatenate(FScale2D(Scale), FQuat2D(Angle)))).RenderOpacity(FMath::Clamp(E * 2.5f, 0.f, 1.f))
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.94f)).Edge(StampInk).EdgePx(5.f)]
					+ SOverlay::Slot().Padding(9.f)[SNew(BpSheet::SPlate).Edge(StampInk.CopyWithNewOpacity(0.6f)).EdgePx(1.5f)]
					+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Stamp)).Font(StampFont).ColorAndOpacity(FSlateColor(StampInk))]
				]);
		}
		else if (!bTaken) S.UnstampedShown = AnswerId;
		if (bCompanion)
		{
			Buttons = { Prev, { TEXT("APPROVE"), LookOf(TEXT("approve"), EBtn::Amber), TEXT("standup:approve"), 300.f }, { TEXT("DECLINE"), LookOf(TEXT("decline"), EBtn::Edge), TEXT("standup:decline"), 230.f }, Next };
		}
		else
		{
			const bool bApproved = bTaken && Answer->Verdict == BpVocab::SteerPost::Verdict::Approve, bHeld = bTaken && Answer->Verdict == BpVocab::SteerPost::Verdict::Hold;
			Buttons = { Prev, { bArmed ? TEXT("A AGAIN: APPROVE") : bApproved ? TEXT("APPROVED") : TEXT("APPROVE"), LookOf(BpVocab::SteerPost::Verdict::Approve, EBtn::Amber), TEXT("standup:approve"), bArmed ? 320.f : 280.f },
				{ TEXT("LATER"), LookOf(BpVocab::SteerPost::Verdict::Defer, EBtn::Edge), TEXT("standup:defer"), 180.f }, { bHeld ? TEXT("HELD") : TEXT("HOLD"), LookOf(BpVocab::SteerPost::Verdict::Hold, EBtn::Edge), TEXT("standup:hold"), 170.f } };
			if (Card->decision.brief.recommend == BpVocab::SteerPost::Verdict::Decline) Buttons.Add({ TEXT("DECLINE"), LookOf(BpVocab::SteerPost::Verdict::Decline, EBtn::Edge), TEXT("standup:decline"), 190.f });
			if (!S.bSample && !Link.CanDecide()) Buttons.Add({ TEXT("PC LINK"), EBtn::Fill, TEXT("open:link"), 190.f });
			Buttons.Add(Next);
		}
		if (Answer)
		{
			// A refused approval's sentence is on the sheet (above); the status says what to do (night two V4).
			Status = Answer->State == FBpStandupAnswer::EState::Refused && !bCompanion ? FString(TEXT("Answer this one at your PC.")) : Answer->Words;
			StatusInk = Answer->State == FBpStandupAnswer::EState::Unsent ? BpSheet::Red : bRefused || Answer->State == FBpStandupAnswer::EState::Sending ? BpSheet::Amber : BpSheet::Accent;
		}
		else if (!bMay) { Status = Link.HasPcLink() ? TEXT("Pair this headset to decide here: PC LINK pairs it, with decide.") : TEXT("Your PC is gone: answers cannot be sent now. Those taken are kept."); StatusInk = BpSheet::Amber; }
		else if (bArmed) { Status = TEXT("Press A again to approve · B cancels"); StatusInk = BpSheet::Amber; }
		else Status = S.bSample ? FString(TEXT("Sample: what you decide is kept on this headset for the day, nothing is sent.")) : FString(TEXT("Your answer goes to your PC with the words on this card."));
		bPager = false;
	}
	else if (bClose)
	{
		// The close: what was decided (here, then the server's words when linked), and what happens next.
		const float ColX1 = Pad + 600.f;
		Text(FBox2f(FVector2f(InX, FrameY0 + 20.f), FVector2f(ColX1, FrameY0 + 52.f)), S.bConfirm ? TEXT("HAND OVER FOR TODAY · CONFIRM") : TEXT("DONE · WHAT YOU DECIDED"), SmallBold, S.bConfirm ? BpSheet::Amber : BpSheet::Accent);
		if (S.bConfirm)
		{
			// The confirm sheet: exactly what the grant is, in the server's terms (VR_POLICY_BOUND), before anything is sent.
			const FString Product = GrantProduct(S);
			const FString Until = (FDateTime::Now() + FTimespan::FromHours(GrantHours)).ToString(TEXT("%H:%M"));
			Text(FBox2f(FVector2f(InX, FrameY0 + 58.f), FVector2f(TextX1, FrameY0 + 130.f)), FString::Printf(TEXT("Let the companion handle %s until %s?"), *GrantProductName(S, Product), *Until), HeadFont, BpSheet::InkHi);
			TArray<FItem> Items;
			for (const FString& Tool : FBpLinkModule::PolicyTools()) Items.Add({ FString::Printf(TEXT("It may %s  (%s)"), *ToolWords(Tool), *Tool), BpSheet::Accent });
			float Y = Lines(InX, TextX1, FrameY0 + 136.f, Frame.Max.Y - 50.f, Items, 1);
			Put(FBox2f(FVector2f(InX, Y + 2.f), FVector2f(Frame.Max.X - 460.f, Y + 4.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Amber.CopyWithNewOpacity(0.6f)));
			TArray<FItem> Bounds;
			Bounds.Add({ FString::Printf(TEXT("Never stop-ship findings: tier %d to 3 only, on %s alone."), GrantMinTier, *Product), BpSheet::Red });
			Lines(InX, Frame.Max.X - 460.f, Y + 14.f, Frame.Max.Y - 4.f, Bounds, 1);
			Buttons = { { S.bGrantOut ? TEXT("GRANTING") : FString::Printf(TEXT("GRANT UNTIL %s"), *Until), S.bGrantOut ? EBtn::Off : EBtn::Amber, TEXT("standup:grant"), 460.f }, { TEXT("CANCEL"), EBtn::Edge, TEXT("standup:cancel"), 200.f } };
			Status = S.GrantWords.IsEmpty() ? FString::Printf(TEXT("%d hours, until %s · TAKE BACK on the bar or the wrist ends it · nothing is granted before GRANT"), GrantHours, *Until) : S.GrantWords;
			StatusInk = S.bGrantBad ? BpSheet::Red : BpSheet::Amber;
		}
		else
		{
			Text(FBox2f(FVector2f(InX, FrameY0 + 58.f), FVector2f(ColX1, FrameY0 + 122.f)), Card->headline, HeadFont, BpSheet::InkHi);
			TArray<FItem> Items;
			int32 Approved = 0, Later = 0, Held = 0, Declined = 0;
			for (const FBpStandupSheet& Each : S.Sheets)
			{
				const FBpMorningCard* C = S.Deck.cards.IsValidIndex(Each.Card) ? &S.Deck.cards[Each.Card] : nullptr;
				const FString Id = Each.Kind == FBpStandupSheet::EKind::Companion ? Each.Companion.Id : C ? C->id : FString();
				const FBpStandupAnswer* A = S.Answers.Find(Id);
				if (!A) continue;
				Approved += A->Verdict == BpVocab::SteerPost::Verdict::Approve ? 1 : 0;
				Later += A->Verdict == BpVocab::SteerPost::Verdict::Defer ? 1 : 0;
				Held += A->Verdict == BpVocab::SteerPost::Verdict::Hold ? 1 : 0;
				Declined += A->Verdict == BpVocab::SteerPost::Verdict::Decline ? 1 : 0;
				const bool bNotSent = A->State == FBpStandupAnswer::EState::Unsent || A->State == FBpStandupAnswer::EState::Refused;
				Items.Add({ FString::Printf(TEXT("%s%s: %s"), *VerdictWord(A->Verdict), bNotSent ? TEXT(" (NOT SENT)") : TEXT(""), *A->Title), bNotSent ? BpSheet::Red : A->Verdict == BpVocab::SteerPost::Verdict::Approve ? BpSheet::Accent : BpSheet::Amber });
			}
			const FString Counts = Items.Num() == 0 ? FString(TEXT("Nothing decided yet: the decisions wait on the deck.")) : FString::Printf(TEXT("%d approved, %d later, %d held%s."), Approved, Later, Held, Declined ? *FString::Printf(TEXT(", %d declined"), Declined) : TEXT(""));
			Text(FBox2f(FVector2f(InX, FrameY0 + 128.f), FVector2f(ColX1, FrameY0 + 128.f + 2.f * Pitch(CapSmall) + 6.f)), Counts, SmallBold, BpSheet::Ink, 2);
			float Y = Lines(InX, ColX1, FrameY0 + 128.f + (BpSheet::TextWidth(Counts, SmallBold) > ColX1 - InX ? 2.f : 1.f) * Pitch(CapSmall) + 14.f, Frame.Max.Y - 16.f, Items, 1);
			// The server's own close lines (linked): what the steering log says, the log's place.
			if (!S.bSample)
			{
				TArray<FItem> Server;
				for (const FBpCardLine& Line : S.CloseLines) Server.Add({ Line.text, ToneInk(Line.tone) });
				if (Server.Num()) Lines(InX, ColX1, Y + 6.f, Frame.Max.Y - 16.f, Server, 1);
			}
			// What happens next.
			const float NX0 = ColX1 + 40.f;
			Put(FBox2f(FVector2f(NX0 - 20.f, FrameY0 + 24.f), FVector2f(NX0 - 18.f, Frame.Max.Y - 64.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.35f)));
			Text(FBox2f(FVector2f(NX0, FrameY0 + 20.f), FVector2f(TextX1, FrameY0 + 52.f)), TEXT("WHAT HAPPENS NEXT"), SmallBold, BpSheet::Accent);
			TArray<FItem> Next2;
			if (S.Plan == FBpStandupState::EPlan::Done) Next2.Add({ S.PlanText, BpSheet::Accent });
			else if (S.Plan != FBpStandupState::EPlan::Idle) Next2.Add({ S.PlanWords, S.Plan == FBpStandupState::EPlan::Failed ? BpSheet::Red : BpSheet::Amber });
			else Next2.Add({ Approved > 0 ? FString::Printf(TEXT("%d approved %s for a wave. PLAN MY DAY asks the companion to compose it and say what it needs from you."), Approved, Approved == 1 ? TEXT("finding waits") : TEXT("findings wait"))
				: FString(TEXT("PLAN MY DAY asks the companion what today's wave should hold.")), BpSheet::Ink.CopyWithNewOpacity(0.6f) });
			if (const FBpPolicy* Grant = LiveGrant()) Next2.Add({ FString::Printf(TEXT("Handed over until %s: %s"), *LocalClock(Grant->ExpiresAt), S.GrantWords.IsEmpty() ? *FString::Printf(TEXT("grant %s on %s."), *Grant->Id, *Grant->Product) : *S.GrantWords), BpSheet::Amber });
			else if (!S.GrantWords.IsEmpty()) Next2.Add({ S.GrantWords, S.bGrantBad ? BpSheet::Red : BpSheet::Ink.CopyWithNewOpacity(0.6f) });
			else Next2.Add({ TEXT("HAND OVER lets the companion handle the product for today, within bounds you confirm first."), BpSheet::Ink.CopyWithNewOpacity(0.6f) });
			Lines(NX0, TextX1, FrameY0 + 62.f, Frame.Max.Y - 56.f, Next2, S.Plan == FBpStandupState::EPlan::Done ? 6 : 4);
			const bool bLinked = !S.bSample && Link.HasPcLink();
			const bool bMay = bLinked && Link.CanDecide();
			Buttons = { Prev,
				{ S.Plan == FBpStandupState::EPlan::Asking ? TEXT("PLANNING") : TEXT("PLAN MY DAY"), bLinked && S.Plan != FBpStandupState::EPlan::Asking ? EBtn::Amber : EBtn::Off, TEXT("standup:plan"), 290.f },
				LiveGrant() ? FRowButton{ TEXT("TAKE BACK"), EBtn::Edge, TEXT("standup:revoke"), 230.f } : FRowButton{ TEXT("HAND OVER"), bMay ? EBtn::Edge : EBtn::Off, TEXT("standup:handover"), 260.f },
				{ TEXT("DONE"), EBtn::Fill, TEXT("standup:done"), 150.f } };
			Status = S.bSample ? FString(TEXT("Sample: both need your PC (PC LINK connects it). Nothing was sent."))
				: !bLinked ? FString(TEXT("Your PC is gone: PLAN MY DAY and HAND OVER need it."))
				: !bMay ? FString(TEXT("Pair this headset with decide to hand over (PC LINK).")) : FString(TEXT("Your decisions are in the steering log on your PC."));
			StatusInk = S.bSample || !bMay ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.85f);
		}
		TitleBlock(SheetNo, Project);
		bPager = false;
	}
	else if (Card)
	{
		// An overnight sheet: what happened, in the deck's own lines; the open card adds the portfolio.
		const bool bOpen = Card->kind == BpVocab::MorningCard::Kind::Open;
		const FString Kind = bOpen ? TEXT("THIS MORNING") : Card->kind == BpVocab::MorningCard::Kind::Agents ? TEXT("AGENTS OVERNIGHT") : Card->kind == BpVocab::MorningCard::Kind::Built ? TEXT("BUILT OVERNIGHT")
			: Card->kind == BpVocab::MorningCard::Kind::Release ? TEXT("RELEASE") : Card->kind == BpVocab::MorningCard::Kind::Quiet ? TEXT("QUIET NIGHT") : Card->kind.ToUpper();
		const FString Kicker = (Card->news ? TEXT("NEW · ") : TEXT("")) + Kind + (Card->productName.IsEmpty() ? FString() : TEXT(" · ") + Card->productName.ToUpper());
		Text(FBox2f(FVector2f(InX, FrameY0 + 20.f), FVector2f(TextX1, FrameY0 + 52.f)), Kicker, SmallBold, ToneInk(Card->tone == BpVocab::MorningCard::Tone::Calm ? FString(BpVocab::CardLine::Tone::Good) : Card->tone));
		const FString HeadFit = BpSheet::Wrap(bOpen && S.bSample ? Card->headline + TEXT(" This is a sample morning.") : Card->headline, HeadFont, TextX1 - InX - (bOpen ? 0.f : 0.f), 2);
		const int32 HeadLines = LineCount(HeadFit);
		Put(FBox2f(FVector2f(InX, FrameY0 + 58.f), FVector2f(TextX1, FrameY0 + 58.f + HeadLines * Pitch(CapHead) + 6.f)), SNew(STextBlock).Text(FText::FromString(HeadFit)).Font(HeadFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		float Y = FrameY0 + 64.f + HeadLines * Pitch(CapHead) + 10.f;
		TArray<FItem> Items;
		for (const FBpCardLine& Line : Card->lines) Items.Add({ Line.text, ToneInk(Line.tone) });
		// The companion's requests pending on the PC, counted with the decisions (night two V2): they come before the close.
		const int32 Requests = CompanionSheets(S);
		if (bOpen && Requests > 0)
		{
			Items.Insert(FItem{ FString::Printf(TEXT("%d %s and %d %s from the companion wait for you."), Of, Of == 1 ? TEXT("decision") : TEXT("decisions"), Requests, Requests == 1 ? TEXT("request") : TEXT("requests")), BpSheet::Amber }, 0);
		}
		const bool bTable = bOpen && S.Deck.products.Num() > 1;
		const bool bFigures = bOpen && !bTable;
		const float LinesX1 = bTable ? Pad + 600.f : bFigures ? Pad + 550.f : TextX1 - 120.f;
		// A list of what was built or released reads one line an item (cut, never smaller), so all of it fits; prose wraps.
		const bool bList = Card->kind == BpVocab::MorningCard::Kind::Built || Card->kind == BpVocab::MorningCard::Kind::Release || Card->kind == BpVocab::MorningCard::Kind::Agents;
		Y = Lines(InX, LinesX1, Y, Frame.Max.Y - 60.f, Items, bList ? 1 : 2);
		if (bOpen && Of == 0 && Requests == 0) Lines(InX, LinesX1, Y + 4.f, Frame.Max.Y - 60.f, TArray<FItem>{ FItem{ TEXT("Nothing waits for you this morning."), BpSheet::Accent } }, 1);
		if (bFigures)
		{
			// One product: the night in four figures, a schedule of large numerals (the drawing set's).
			int32 Built = 0, Failed = 0, Confirmed = 0, Short = 0, Waiting = 0;
			for (const FBpProductSummary& P : S.Deck.products) { Built += P.built; Failed += P.failed; Confirmed += P.confirmed; Short += P.Short_; Waiting += P.waiting; }
			struct FFigure { FString Value; FString Label; FLinearColor Ink; };
			const FFigure Figures[] = {
				{ FString::FromInt(Built), TEXT("BUILT\nOVERNIGHT"), Built ? BpSheet::Accent : BpSheet::Ink.CopyWithNewOpacity(0.5f) },
				{ FString::FromInt(Failed), TEXT("BUILDS\nFAILED"), Failed ? BpSheet::Red : BpSheet::Ink.CopyWithNewOpacity(0.5f) },
				{ FString::FromInt(Of), TEXT("DECISIONS\nFOR TODAY"), Of ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.5f) },
				{ FString::FromInt(Waiting), TEXT("FINDINGS\nOPEN IN ALL"), BpSheet::Ink.CopyWithNewOpacity(0.8f) },
			};
			// A cell: the numeral left, its two-line label right of it, on a plate with the figure's colour down its edge.
			const float GX0 = Pad + 580.f, GX1 = TextX1, GY0 = FrameY0 + 134.f, Gap = 12.f, CellW = (GX1 - GX0 - Gap) * 0.5f, CellH = 100.f;
			const FSlateFontInfo FigureFont = Font(TEXT("Bold"), 56.f);
			for (int32 Index = 0; Index < 4; ++Index)
			{
				const float X0 = GX0 + (Index % 2) * (CellW + Gap), Y0 = GY0 + (Index / 2) * (CellH + Gap);
				const FBox2f Cell(FVector2f(X0, Y0), FVector2f(X0 + CellW, Y0 + CellH));
				Put(Cell, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.45f)).Edge(Figures[Index].Ink.CopyWithNewOpacity(0.55f)).EdgePx(2.f).Bar(Figures[Index].Ink).BarPx(6.f));
				const float NumW = BpSheet::TextWidth(Figures[Index].Value, FigureFont);
				Put(FBox2f(Cell.Min + FVector2f(24.f, 0.f), FVector2f(Cell.Min.X + 30.f + NumW, Cell.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Figures[Index].Value)).Font(FigureFont).ColorAndOpacity(FSlateColor(Figures[Index].Ink))]);
				Put(FBox2f(FVector2f(Cell.Min.X + 44.f + NumW, Cell.Min.Y), FVector2f(Cell.Max.X - 6.f, Cell.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Figures[Index].Label)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
			}
			if (Confirmed || Short) Lines(InX, LinesX1, Y + 4.f, Frame.Max.Y - 60.f, TArray<FItem>{ FItem{ FString::Printf(TEXT("Releases: %d confirmed, %d short of what was expected."), Confirmed, Short), Short ? BpSheet::Red : BpSheet::Accent } }, 1);
		}
		if (bTable)
		{
			// The portfolio, as the web's: one row per product, what moved and what waits; the drawing set's schedule table.
			const float TX0 = Pad + 640.f, TX1 = TextX1, RowH = 44.f;
			float TY = FrameY0 + 64.f + HeadLines * Pitch(CapHead) + 10.f;
			const float Cols[] = { TX0, TX1 - 404.f, TX1 - 304.f, TX1 - 204.f, TX1 - 100.f };
			const TCHAR* Heads[] = { TEXT("PRODUCT"), TEXT("BUILT"), TEXT("FAIL"), TEXT("REL."), TEXT("WAIT") };
			for (int32 C = 0; C < 5; ++C) Text(FBox2f(FVector2f(Cols[C], TY), FVector2f(C < 4 ? Cols[C + 1] - 8.f : TX1, TY + RowH)), Heads[C], SmallBold, BpSheet::Accent, 1, VAlign_Center);
			TY += RowH;
			Put(FBox2f(FVector2f(TX0, TY - 2.f), FVector2f(TX1, TY)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.6f)));
			for (int32 Index = 0; Index < S.Deck.products.Num() && TY + RowH <= Frame.Max.Y - 56.f; ++Index)
			{
				const FBpProductSummary& P = S.Deck.products[Index];
				const FString Cells[] = { P.name, P.built ? FString::FromInt(P.built) : TEXT("·"), P.failed ? FString::FromInt(P.failed) : TEXT("·"), P.releases ? (P.Short_ ? FString::Printf(TEXT("%d short"), P.Short_) : FString::FromInt(P.confirmed)) : TEXT("·"), P.waiting ? FString::FromInt(P.waiting) : TEXT("·") };
				const FLinearColor Inks[] = { BpSheet::InkHi, P.built ? BpSheet::Accent : BpSheet::Ink, P.failed ? BpSheet::Red : BpSheet::Ink, P.Short_ ? BpSheet::Red : BpSheet::Ink, P.waiting ? BpSheet::Amber : BpSheet::Ink };
				for (int32 C = 0; C < 5; ++C) Text(FBox2f(FVector2f(Cols[C], TY), FVector2f(C < 4 ? Cols[C + 1] - 8.f : TX1, TY + RowH)), Cells[C], C == 0 ? SmallBold : SmallFont, Inks[C], 1, VAlign_Center);
				TY += RowH;
				Put(FBox2f(FVector2f(TX0, TY - 1.f), FVector2f(TX1, TY)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.25f)));
			}
		}
		if (!S.Room.IsEmpty() && WristTable.IsValid())
		{
			Mark(InX, Frame.Max.Y - 36.f, BpSheet::Accent);
			Text(FBox2f(FVector2f(InX + 28.f, Frame.Max.Y - 50.f), FVector2f(Frame.Max.X - 460.f, Frame.Max.Y - 4.f)), FString::Printf(TEXT("Raised on the plan: %s"), *WristTable->StandupPlaceName(S.Room)), SmallFont, BpSheet::Ink.CopyWithNewOpacity(0.85f));
		}
		TitleBlock(SheetNo, Project);
		Status = S.bSample && bOpen ? FString(TEXT("A synthetic night on the built-in sample · NEXT, or the right stick"))
			: Of > 0 ? FString::Printf(TEXT("%d %s after this · NEXT, or the right stick"), Of, Of == 1 ? TEXT("decision") : TEXT("decisions")) : FString(TEXT("NEXT, or the right stick"));
		Buttons = { Prev, Next };
		bPager = false;
	}
	(void)bPager;
	// The PC gone mid-ritual: what was answered stays; what was not sent is said.
	if (!S.bSample && !Link.HasPcLink())
	{
		int32 Sent = 0, NotSent = 0;
		for (const TPair<FString, FBpStandupAnswer>& Each : S.Answers) { Sent += Each.Value.State == FBpStandupAnswer::EState::Sent ? 1 : 0; NotSent += Each.Value.State == FBpStandupAnswer::EState::Unsent ? 1 : 0; }
		Status = FString::Printf(TEXT("Your PC is gone: %d sent and kept, %d not sent. They go when it is back."), Sent, NotSent);
		StatusInk = BpSheet::Red;
	}
	// The status fits by rule: a server's sentence too long for the line loses its parenthesis, then whole words go.
	FString StatusFit = Status;
	FString Plain, Aside;
	if (BpSheet::TextWidth(StatusFit, SmallFont) > LW - 2.f * Pad - 4.f && StatusFit.Split(TEXT(" ("), &Plain, &Aside)) StatusFit = Plain + TEXT(".");
	if (BpSheet::TextWidth(StatusFit, SmallFont) > LW - 2.f * Pad - 4.f && StatusFit.Split(TEXT(" · "), &Plain, &Aside)) StatusFit = Plain;
	if (BpSheet::TextWidth(StatusFit, SmallFont) > LW - 2.f * Pad - 4.f && StatusFit.Split(TEXT(". "), &Plain, &Aside)) StatusFit = Plain + TEXT(".");
	Text(FBox2f(FVector2f(Pad + 4.f, StatusY0), FVector2f(LW - Pad, StatusY1)), BpSheet::CutWords(StatusFit, SmallFont, LW - 2.f * Pad - 4.f), SmallFont, StatusInk, 1, VAlign_Center);
	// The foot: PREV at the left edge, NEXT at the right, the card's own answers centred between them.
	TArray<FRowButton> Middle;
	bool bHasPrev = false, bHasNext = false;
	for (const FRowButton& B : Buttons)
	{
		if (B.Act == TEXT("standup:prev")) bHasPrev = true;
		else if (B.Act == TEXT("standup:next") || B.Act == TEXT("standup:skip")) bHasNext = true;
		else Middle.Add(B);
	}
	// PREV and NEXT stand quieter than the answers: shorter, and on a decision NEXT is an edge, never a second primary.
	const float QuietIn = 12.f;
	if (bHasPrev) Button(FBox2f(FVector2f(Pad, BtnY0 + QuietIn), FVector2f(Pad + Prev.W, BtnY1 - QuietIn)), Prev.Word, Prev.Look, Prev.Act);
	for (const FRowButton& B : Buttons)
	{
		if (B.Act == TEXT("standup:next") || B.Act == TEXT("standup:skip")) Button(FBox2f(FVector2f(LW - Pad - B.W, BtnY0 + QuietIn), FVector2f(LW - Pad, BtnY1 - QuietIn)), B.Word, bDecision && B.Look == EBtn::Fill ? EBtn::Edge : B.Look, B.Act);
	}
	Row(Pad + (bHasPrev ? Prev.W + 16.f : 0.f), LW - Pad - (bHasNext ? Next.W + 16.f : 0.f), Middle);
	// The position on the title row (the console's header): "SHEET 3 OF 7", and whose morning it is at a glance: SAMPLE (amber,
	// solid) or FROM YOUR PC (cyan, an edge).
	const FString Pos = FString::Printf(TEXT("SHEET %d OF %d"), S.At + 1, S.Sheets.Num());
	const FString Whose = S.bSample ? FString(TEXT("SAMPLE")) : FString(TEXT("FROM YOUR PC"));
	const float WhoseW = BpSheet::ChipWidth(Whose, SmallBold), PosW = BpSheet::TextWidth(Pos, SmallBold);
	const float HeadX1 = LW - Pad - 214.f;
	Put(FBox2f(FVector2f(HeadX1 - PosW, 24.f), FVector2f(HeadX1, 94.f)), SNew(SBox).HAlign(HAlign_Right).VAlign(VAlign_Center)
		[
			SNew(STextBlock).Text(FText::FromString(Pos)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.8f)))
		]);
	Put(FBox2f(FVector2f(HeadX1 - PosW - 18.f - WhoseW, 39.f), FVector2f(HeadX1 - PosW - 18.f, 79.f)), BpSheet::Chip(Whose, SmallBold, 40.f, S.bSample ? BpSheet::Amber : BpSheet::Accent, S.bSample));
}
