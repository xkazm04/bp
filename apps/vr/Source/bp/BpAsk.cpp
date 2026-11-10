// The lamp's asks (the owner's "plan with companion next step"): no text entry in VR, voice out of scope, so a fixed set of
// asks offered where a person already acts: pinching the lamp's head, and the wrist's ASK tab. Two go to the companion's
// brain when a PC is linked, and all three answer at once, locally, from the store on the table:
//   next  "What should I do next?": the open finding the app's own worth order puts first (scan/score.ts byWorth, as the
//         ledger and the inbox sort: tier first, untriaged last, band ranked before reserve, a stored score before an estimate,
//         the value descending, oldest first); the finding, why now, and one action.
//   here  "Plan my next step here": in the room in view, the room's riskiest open finding, the deck's own order (tier, then
//         risk), so the action lands on the deck's first decision.
//   scan  "Scan this": hands to the wrist's Scan tab with the best-fit focus armed (a real scan or the bundle's sample).
// The answer's one action waits on the lamp (a pinch on it, or the wrist's row): open the finding on the deck, or arm the scan.
// Standalone it is computed locally and says nothing invented; with a server the companion's reply replaces the words as
// soon as its turn ends (POST /api/companion/turn, BpLink), and a 409 or a failed turn reads as words. Card approval stays
// web-only (contract section 4): a card in the reply says to approve it on the PC. No synthesized voice: captions only.
#include "BpTable.h"

#include "BpLink.h"
#include "BpPawn.h"
#include "BpType.h"
#include "BpWords.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Schema/BpSchemaVocab.h"

namespace
{
	TAutoConsoleVariable<float> CVarLampAnswerS(TEXT("bp.LampAnswerS"), 12.f, TEXT("How long the lamp's answer and its offer stand, in seconds (5 to 40)."));
	TAutoConsoleVariable<int32> CVarLampTurn(TEXT("bp.LampTurn"), 1, TEXT("1: with a PC link the lamp's asks also ask the companion (POST /api/companion/turn); 0: local answers only."));

	/** The ask of a finding's size, the estimate's denominator (scan/score.ts SIZE_W). */
	double SizeWeight(const FString& Size)
	{
		if (Size == TEXT("XS")) return 1.0;
		if (Size == TEXT("S")) return 2.0;
		if (Size == TEXT("L")) return 5.0;
		if (Size == TEXT("XL")) return 8.0;
		return 3.0;
	}

	/** A finding's worth as scan/score.ts reads it: tier (untriaged after T3), band ranked first, then scored, estimated,
	 *  unscored, value descending; created_at and id break ties (rank.ts). */
	struct FFindingWorth
	{
		int32 TierRank = 4;
		bool bReserve = false;
		int32 KindRank = 2;
		double Value = 0.0;
		const FBpProposal* Proposal = nullptr;
	};

	TArray<FFindingWorth> OpenFindings(const FBpScanState& State, TFunctionRef<bool(const FBpProposal&)> Keep)
	{
		// The estimate over the whole product's proposals (scan/score.ts estValue: normalised per lens and metric).
		TMap<FString, double> Top;
		for (const FBpProposal& P : State.Scan.proposals)
		{
			const double* Delta = State.Deltas.Find(P.id);
			if (P.metric.IsEmpty() || !Delta) continue;
			double& T = Top.FindOrAdd(P.lens + TEXT("|") + P.metric, 0.0);
			T = FMath::Max(T, FMath::Abs(*Delta));
		}
		TArray<FFindingWorth> Out;
		for (const FBpProposal& P : State.Scan.proposals)
		{
			if (P.status != BpVocab::Proposal::Status::Proposed || !Keep(P)) continue;
			FFindingWorth W;
			W.Proposal = &P;
			if (const int32* Tier = State.Tiers.Find(P.id)) W.TierRank = FMath::Clamp(*Tier, 0, 3);
			W.bReserve = P.band == BpVocab::Proposal::Band::Reserve;
			if (const double* Score = State.Scores.Find(P.id))
			{
				W.KindRank = 0;
				W.Value = *Score;
			}
			else if (!State.ScoredV5.Contains(P.id))
			{
				const double* Delta = State.Deltas.Find(P.id);
				const double T = !P.metric.IsEmpty() && Delta ? Top.FindRef(P.lens + TEXT("|") + P.metric) : 0.0;
				const double Gain = T > 0.0 ? 0.25 + 0.75 * FMath::Abs(*Delta) / T : 0.5;
				const double Risk = P.risk > 0.0 ? FMath::Clamp(P.risk, 1.0, 10.0) : 5.0;
				W.KindRank = 1;
				W.Value = Gain * (11.0 - Risk) / 10.0 / SizeWeight(P.size);
			}
			Out.Add(W);
		}
		Out.StableSort([](const FFindingWorth& A, const FFindingWorth& B)
		{
			if (A.TierRank != B.TierRank) return A.TierRank < B.TierRank;
			if (A.bReserve != B.bReserve) return !A.bReserve;
			if (A.KindRank != B.KindRank) return A.KindRank < B.KindRank;
			if (A.Value != B.Value) return A.Value > B.Value;
			if (A.Proposal->created_at != B.Proposal->created_at) return A.Proposal->created_at < B.Proposal->created_at;
			return A.Proposal->id < B.Proposal->id;
		});
		return Out;
	}

	FString WorthWords(const FFindingWorth& W)
	{
		if (W.KindRank == 0) return FString::Printf(TEXT("score %.1f"), W.Value);
		if (W.KindRank == 1) return FString::Printf(TEXT("worth est. %.2f"), W.Value);
		return TEXT("unscored");
	}

	FString TierWords(int32 Rank)
	{
		switch (Rank)
		{
		case 0: return TEXT("T0 stop-ship");
		case 1: return TEXT("T1 before production");
		case 2: return TEXT("T2 soon after");
		case 3: return TEXT("T3 backlog");
		default: return TEXT("");
		}
	}

	/** A failed turn's class (FailureClass, contract.ts) in words a person can act on. */
	FString TurnFailureWords(const FString& Failure)
	{
		if (Failure == TEXT("limit")) return TEXT("It hit a usage limit. Try again later.");
		if (Failure == TEXT("auth")) return TEXT("It is not signed in on the PC.");
		if (Failure == TEXT("gone")) return TEXT("Its session on the PC ended. Ask again.");
		if (Failure == TEXT("interrupted")) return TEXT("It was interrupted. Ask again.");
		if (Failure.IsEmpty()) return TEXT("Ask again, or look on the PC.");
		return TEXT("Something went wrong on the PC. Ask again.");
	}

	void WithAskTables(UWorld* World, TFunctionRef<void(ABpTable&)> Fn)
	{
		if (!World) return;
		for (TActorIterator<ABpTable> It(World); It; ++It) Fn(**It);
	}

	FAutoConsoleCommandWithWorldAndArgs CmdLampAsk(TEXT("BpLamp.Ask"),
		TEXT("BpLamp.Ask next|here|scan: the lamp's asks, as the wrist's ASK tab and a pinch on its head make them. BpLamp.Act does what its answer offers."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0) return;
			WithAskTables(World, [&Args](ABpTable& T)
			{
				if (Args[0] == TEXT("next")) T.AskNextStep(TEXT("console"));
				else if (Args[0] == TEXT("here")) T.AskPlanHere(TEXT("console"));
				else if (Args[0] == TEXT("scan")) T.AskScanThis(TEXT("console"));
				else UE_LOG(LogBpTable, Warning, TEXT("BpLamp: usage BpLamp.Ask next|here|scan"));
			});
		}));

	FAutoConsoleCommandWithWorld CmdLampAct(TEXT("BpLamp.Act"), TEXT("BpLamp.Act: does what the lamp's last answer offers (the pinch on its head, the wrist's row)."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World) { WithAskTables(World, [](ABpTable& T) { T.LampAct(TEXT("console")); }); }));
}

void ABpTable::LampNotifyAsk()
{
	LampAskChanged.Broadcast();
}

void ABpTable::LampSayAnswer(const FString& Subject, const FString& Why, const FString& Hint, const FString& ShortWhy)
{
	LampAnswer = Subject + TEXT("\n") + Why;
	LampHint = Hint;
	// The plate's parts: the title, why now, and what a pinch does. Night two V4: each whole (the plate wraps and grows with its
	// lines; it used to cut each to one line: "Apply the console errors baseline to…").
	SayLamp(Subject + TEXT("\n") + (ShortWhy.IsEmpty() ? Why : ShortWhy) + (Hint.IsEmpty() ? FString() : TEXT("\n") + Hint), true);
	LampCaptionClock = FMath::Clamp(CVarLampAnswerS.GetValueOnGameThread(), 5.f, 40.f);
	LampNotifyAsk();
}

FVector ABpTable::LampTargetForFeature(const FString& FeatureId) const
{
	if (!RoomModeId.IsEmpty())
	{
		const FRoomSlot* Slot = RoomSlots.FindByPredicate([this, &FeatureId](const FRoomSlot& S) { return SheetPlan->tiles.IsValidIndex(S.Tile) && SheetPlan->tiles[S.Tile].id == FeatureId; });
		if (Slot) return WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(Slot->GlyphBox.GetCenter(), 0.f));
	}
	if (SheetPlan.IsValid())
	{
		const int32 Tile = SheetPlan->tiles.IndexOfByPredicate([&FeatureId](const FBpPlanTile& T) { return T.id == FeatureId; });
		if (SheetPlan->tiles.IsValidIndex(Tile) && TileRoom.IsValidIndex(Tile) && SheetPlan->rooms.IsValidIndex(TileRoom[Tile]) && RoomModeId.IsEmpty())
		{
			const FBpPlanBox& Box = SheetPlan->rooms[TileRoom[Tile]].box;
			return WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(PlanToPaperCm(FVector2D(Box.x + Box.w * 0.5, Box.y + Box.h * 0.5)), 0.f));
		}
	}
	return WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(FVector2D(PaperWidthCm * 0.5, PaperDepthCm * 0.5), 0.f));
}

FVector ABpTable::LampTargetForRoom(const FString& InRoomId) const
{
	const FBpPlanRoom* Room = FindRoom(InRoomId);
	if (!Room || !RoomModeId.IsEmpty()) return WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(FVector2D(PaperWidthCm * 0.5, PaperDepthCm * 0.5), 0.f));
	const FBpPlanBox& Box = Room->box;
	return WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(PlanToPaperCm(FVector2D(Box.x + Box.w * 0.5, Box.y + Box.h * 0.5)), 0.f));
}

FString ABpTable::LampRoomOf(const FString& FeatureId) const
{
	if (!SheetPlan.IsValid()) return FString();
	const int32 Tile = SheetPlan->tiles.IndexOfByPredicate([&FeatureId](const FBpPlanTile& T) { return T.id == FeatureId; });
	return SheetPlan->tiles.IsValidIndex(Tile) && TileRoom.IsValidIndex(Tile) && SheetPlan->rooms.IsValidIndex(TileRoom[Tile]) ? SheetPlan->rooms[TileRoom[Tile]].id : FString();
}

void ABpTable::AskNextStep(const TCHAR* Route)
{
	if (!SheetPlan.IsValid()) return;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	TArray<FFindingWorth> Open = OpenFindings(State, [this](const FBpProposal& P) { return !DeckDeclined.Contains(P.id) && !CardDecided.Contains(P.id) && !LampRoomOf(P.feature).IsEmpty(); });
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: ask next by %s: %d open"), Route, Open.Num());
	FString Text = FString::Printf(TEXT("What should I do next on %s? Name the one finding and why, in two sentences."), *FBpLinkModule::Get().GetProductSlug());
	if (Open.Num() == 0)
	{
		ClearLampOffer();
		LampSayAnswer(TEXT("Nothing open here"), TEXT("Every finding has a decision."), FString());
		LampAskTurn(MoveTemp(Text));
		return;
	}
	const FFindingWorth& Top = Open[0];
	const FString TopRoom = LampRoomOf(Top.Proposal->feature);
	const FBpPlanRoom* Room = FindRoom(TopRoom);
	FString Why = FString::Printf(TEXT("Top of %d open · %s · %s"), Open.Num(), Room ? *Room->name : TEXT("?"), *WorthWords(Top));
	if (Top.TierRank < 4) Why = TierWords(Top.TierRank) + TEXT(" · ") + Why;
	PresentLamp(LampTargetForFeature(Top.Proposal->feature), TEXT("next"));
	SetLampOffer(ELampOffer::OpenFinding, TopRoom, Top.Proposal->feature, Top.Proposal->id);
	LampSayAnswer(Top.Proposal->title, Why, TEXT("Pinch me: open it on the deck"), Top.TierRank < 4 ? FString::Printf(TEXT("%s · %s"), *TierWords(Top.TierRank), Room ? *Room->name : TEXT("?")) : FString::Printf(TEXT("Top of %d · %s"), Open.Num(), Room ? *Room->name : TEXT("?")));
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: next -> %s (%s) in room %s: %s"), *Top.Proposal->id, *Top.Proposal->title, *TopRoom, *Why);
	LampAskTurn(MoveTemp(Text));
}

void ABpTable::AskPlanHere(const TCHAR* Route)
{
	if (!SheetPlan.IsValid()) return;
	// The room in view: the one shown, else the one lifted, else the most urgent room of the lifted wing or the site.
	FString HereId = !RoomModeId.IsEmpty() ? RoomModeId : RoomId;
	if (HereId.IsEmpty())
	{
		HereId = TourRoomIn(WingId);
		if (HereId.IsEmpty()) { UE_LOG(LogBpTable, Log, TEXT("BpLamp: ask here by %s: no room"), Route); return; }
	}
	const FBpPlanRoom* Room = FindRoom(HereId);
	const bool bInRoomNow = !RoomModeId.IsEmpty() && RoomModeId == HereId;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	TArray<FFindingWorth> Open = OpenFindings(State, [this, &HereId](const FBpProposal& P) { return !DeckDeclined.Contains(P.id) && !CardDecided.Contains(P.id) && LampRoomOf(P.feature) == HereId; });
	// The room's riskiest, the deck's own order (BuildDeckQueue: tier, then risk, equal ones in the store's order), so the
	// action lands on the deck's first decision.
	Open.StableSort([&State](const FFindingWorth& A, const FFindingWorth& B)
	{
		if (A.TierRank != B.TierRank) return A.TierRank < B.TierRank;
		if (A.Proposal->risk != B.Proposal->risk) return A.Proposal->risk > B.Proposal->risk;
		return A.Proposal < B.Proposal;
	});
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: ask here by %s: room %s, %d open"), Route, *HereId, Open.Num());
	PresentLamp(LampTargetForRoom(HereId), TEXT("here"));
	FString Text = FString::Printf(TEXT("Plan my next step in room \"%s\" (%s) on %s. Two sentences."), Room ? *Room->name : *HereId, *HereId, *FBpLinkModule::Get().GetProductSlug());
	if (Open.Num() == 0)
	{
		// A room with nothing open: its last scan, and the scan is the next step.
		FString Last;
		for (const FBpMeasurement& Row : State.Scan.measurements) { if (LampRoomOf(Row.feature) == HereId && Row.measured_at > Last) Last = Row.measured_at; }
		SetLampOffer(ELampOffer::ScanHere, HereId, FString(), FString());
		LampSayAnswer(FString::Printf(TEXT("%s: nothing open"), Room ? *Room->name : *HereId), Last.IsEmpty() ? FString(TEXT("Not scanned yet")) : TEXT("Last scan ") + Last.Left(10), TEXT("Pinch me: scan this room"));
		LampAskTurn(MoveTemp(Text));
		return;
	}
	const FFindingWorth& Top = Open[0];
	FString Why = FString::Printf(TEXT("Riskiest of %d open%s%s"), Open.Num(), Top.Proposal->risk > 0.0 ? *FString::Printf(TEXT(" · risk %d"), FMath::RoundToInt(Top.Proposal->risk)) : TEXT(""), bInRoomNow ? TEXT("") : *FString::Printf(TEXT(" · %s"), Room ? *Room->name : *HereId));
	if (Top.TierRank < 4) Why = TierWords(Top.TierRank) + TEXT(" · ") + Why;
	SetLampOffer(ELampOffer::OpenFinding, HereId, Top.Proposal->feature, Top.Proposal->id);
	LampSayAnswer(Top.Proposal->title, Why, TEXT("Pinch me: open it on the deck"));
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: here -> %s (%s)"), *Top.Proposal->id, *Why);
	LampAskTurn(MoveTemp(Text));
}

void ABpTable::AskScanThis(const TCHAR* Route)
{
	if (!SheetPlan.IsValid()) return;
	FBpLinkModule& Link = FBpLinkModule::Get();
	const FString Target = DirectedTarget();
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: ask scan by %s: %s"), Route, *Target);
	PresentLamp(LampTargetForRoom(FindRoom(Target) ? Target : RoomModeId), TEXT("scan"));
	TWeakObjectPtr<ABpTable> Self(this);
	Link.GetFocuses([Self, Target](const FBpFocusList& List)
	{
		ABpTable* T = Self.Get();
		if (!T) return;
		if (List.Focuses.Num() == 0)
		{
			T->ClearLampOffer();
			T->LampSayAnswer(T->DirectedLabel(Target), List.Error.IsEmpty() ? FString(TEXT("Save a focus on the PC first.")) : List.Error, FString());
			return;
		}
		// Best fit: the lens with the most open findings in the place; a tie or no finding at all keeps the list's order.
		TSet<FString> Keep;
		FString Kind, ScopeId, Label;
		TArray<FString> Features;
		const bool bSite = Target == TEXT("site") || !T->BuildScanScope(Target, Kind, ScopeId, Label, Features);
		if (!bSite) Keep.Append(Features);
		TMap<FString, int32> ByLens;
		for (const FBpProposal& P : FBpLinkModule::Get().GetScanState().Scan.proposals)
		{
			if (P.status == BpVocab::Proposal::Status::Proposed && (bSite || Keep.Contains(P.feature))) ++ByLens.FindOrAdd(P.lens);
		}
		const FBpSavedFocus* Best = &List.Focuses[0];
		int32 BestOpen = ByLens.FindRef(Best->Lens);
		for (const FBpSavedFocus& F : List.Focuses)
		{
			if (ByLens.FindRef(F.Lens) > BestOpen) { Best = &F; BestOpen = ByLens.FindRef(F.Lens); }
		}
		APlayerController* Controller = T->GetWorld() ? T->GetWorld()->GetFirstPlayerController() : nullptr;
		if (ABpPawn* Pawn = Controller ? Cast<ABpPawn>(Controller->GetPawn()) : nullptr) Pawn->WristArmFocus(Best->Id);
		T->ClearLampOffer();
		T->LampSayAnswer(FString::Printf(TEXT("Scan %s"), *T->DirectedLabel(Target)), FString::Printf(TEXT("For %s: %d open in this place"), *BpWords::Lens(Best->Lens), BestOpen), TEXT("On your wrist: pinch to start"));
		UE_LOG(LogBpTable, Log, TEXT("BpLamp: scan %s -> focus %s (%s)"), *Target, *Best->Id, *Best->Lens);
	});
}

bool ABpTable::LampAct(const TCHAR* Route)
{
	if (LampOffer == ELampOffer::None)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpLamp: act by %s: nothing offered"), Route);
		return false;
	}
	const ELampOffer Offer = LampOffer;
	const FString Room = LampOfferRoom, Feature = LampOfferFeature, Proposal = LampOfferProposal;
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: act by %s: %s"), Route, Offer == ELampOffer::OpenFinding ? *FString::Printf(TEXT("open %s in %s"), *Proposal, *Room) : TEXT("scan"));
	ClearLampOffer();
	LampCaptionClock = FMath::Min(LampCaptionClock, 1.5f);
	if (Offer == ELampOffer::ScanHere)
	{
		AskScanThis(Route);
		return true;
	}
	if (RoomModeId == Room) DeckFocusProposal(Proposal, Feature);
	else
	{
		PendingDeckProposal = Proposal;
		PendingDeckFeature = Feature;
		SwitchRoom(Room, TEXT("lamp"));
	}
	return true;
}

void ABpTable::LampPinched()
{
	UE_LOG(LogBpTable, Log, TEXT("BpLamp: pinched (offer %d)"), static_cast<int32>(LampOffer));
	// A pinch on the lamp cancels a talk in flight first (BpTalk.cpp: a turn being thought about, its spoken reply).
	if (TalkCancel(TEXT("pinch"))) return;
	if (LampOffer != ELampOffer::None) LampAct(TEXT("pinch"));
	else AskNextStep(TEXT("pinch"));
}

void ABpTable::SetLampOffer(ELampOffer Offer, const FString& Room, const FString& Feature, const FString& Proposal)
{
	LampOffer = Offer;
	LampOfferRoom = Room;
	LampOfferFeature = Feature;
	LampOfferProposal = Proposal;
}

void ABpTable::ClearLampOffer()
{
	LampOffer = ELampOffer::None;
	LampOfferRoom.Reset();
	LampOfferFeature.Reset();
	LampOfferProposal.Reset();
}

FString ABpTable::LampOfferLabel() const
{
	return LampOffer == ELampOffer::OpenFinding ? FString(TEXT("OPEN IT ON THE DECK")) : LampOffer == ELampOffer::ScanHere ? FString(TEXT("SCAN THIS ROOM")) : FString();
}

void ABpTable::LampAskTurn(FString&& Text)
{
	FBpLinkModule& Link = FBpLinkModule::Get();
	if (!Link.HasPcLink() || CVarLampTurn.GetValueOnGameThread() == 0) return;
	if (bLampTurnOut)
	{
		// BpLink's own guard would answer Busy too; here the words say so at once.
		LampSayAnswer(TEXT("I am still answering"), TEXT("Ask me again in a moment."), LampHint);
		return;
	}
	bLampTurnOut = true;
	LampAnswer = TEXT("Asking the companion…\n") + LampAnswer;
	LampNotifyAsk();
	const FString LocalAnswer = LampAnswer;
	const FString LocalHint = LampHint;
	TWeakObjectPtr<ABpTable> Self(this);
	Link.PostCompanionTurn(Text, [Self, LocalAnswer, LocalHint](const FBpCompanionTurn& Turn)
	{
		ABpTable* T = Self.Get();
		if (!T) return;
		T->bLampTurnOut = false;
		switch (Turn.Outcome)
		{
		case FBpCompanionTurn::EOutcome::Busy:
			T->LampSayAnswer(TEXT("I am still answering"), TEXT("Ask me again in a moment."), LocalHint);
			break;
		case FBpCompanionTurn::EOutcome::Failed:
			T->LampSayAnswer(TEXT("The companion could not answer"), Turn.Words.IsEmpty() ? TurnFailureWords(Turn.Failure) : Turn.Words, LocalHint);
			break;
		case FBpCompanionTurn::EOutcome::Unreached:
			T->LampSayAnswer(TEXT("The PC did not answer"), TEXT("The table's own answer stands."), LocalHint);
			break;
		case FBpCompanionTurn::EOutcome::Ok:
		{
			// The newest sentence on the caption; the whole reply on the wrist.
			FString Reply = Turn.Text.TrimStartAndEnd().Replace(TEXT("\n"), TEXT(" "));
			if (Reply.IsEmpty()) Reply = TEXT("(no words)");
			FString Newest = Reply;
			int32 At = INDEX_NONE;
			if (Reply.Left(Reply.Len() - 1).FindLastChar(TEXT('.'), At) && At > 0 && At + 2 < Reply.Len()) Newest = Reply.Mid(At + 2);
			if (!Turn.CardSummary.IsEmpty())
			{
				T->ClearLampOffer();
				T->LampSayAnswer(Turn.CardSummary, TEXT("Approve it on your PC, in bp."), FString());
			}
			else
			{
				// Two caption lines for the reply (the plate wraps it), the third for what a pinch still does.
				const FString Body = Newest.Len() > 74 ? Newest.Left(73).TrimEnd() + BpType::Ellipsis() : Newest;
				T->LampHint = LocalHint;
				T->SayLamp(Body + (LocalHint.IsEmpty() ? FString() : TEXT("\n") + LocalHint), true);
				T->LampCaptionClock = FMath::Clamp(CVarLampAnswerS.GetValueOnGameThread(), 5.f, 40.f);
			}
			T->LampAnswer = Reply + (Turn.CardSummary.IsEmpty() ? FString() : TEXT("\n\nCard: ") + Turn.CardSummary + TEXT(" Approve it on your PC."));
			T->LampNotifyAsk();
			if (Turn.FocusKind == TEXT("room")) T->PresentLamp(T->LampTargetForRoom(Turn.FocusId), TEXT("turn focus"));
			else if (Turn.FocusKind == TEXT("feature")) T->PresentLamp(T->LampTargetForFeature(Turn.FocusId), TEXT("turn focus"));
			break;
		}
		}
	});
}
