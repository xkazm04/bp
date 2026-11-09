// The sample scan (the standalone APK, no server): the Scan tab in a bundle lists the bundle's sample focuses (Kettle's
// sample-focuses.json, bundle-data.mjs), and a pinch walks the chosen place here, feature by feature on a timer, through the same
// marks a real scan draws (BpScanMarks.cpp): the rooms lit, the rail filling, the ticks, the title block's status. It reads
// nothing and writes nothing: no request, no store row, no finding. Its one door is StartSampleScan and that door checks the
// bundle first: a table a server answers is refused and logged, so a real product can never take this path, and this path never
// reaches FBpLinkModule::PostScan. What a real scan shares with it is only the marks at the far end.
#include "BpTable.h"

#include "BpLink.h"
#include "BpWords.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "HAL/IConsoleManager.h"
#include "TimerManager.h"

namespace
{
	TAutoConsoleVariable<float> CVarSampleStep(TEXT("bp.SampleScanStepS"), 0.6f, TEXT("The sample scan's time on one feature (seconds, 0.05 to 3)."));
	TAutoConsoleVariable<float> CVarSampleMax(TEXT("bp.SampleScanMaxS"), 40.f, TEXT("The longest a sample scan takes (seconds, 5 to 300): a site of many features walks faster so a person sees it end."));
	/** LINGER_MS done, as a real scan's marks. */
	constexpr float SampleLingerS = 3.f;

	bool ReducedMotion()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}
}

bool ABpTable::StartSampleScan(const FString& FocusId, const FString& InTarget, TFunction<void(bool bOk, const FString& Words)> OnDone)
{
	const auto Finish = [&](bool bOk, const FString& Words)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpSample: %s: %s: %s"), *FocusId, bOk ? TEXT("started") : TEXT("refused"), *Words);
		if (OnDone) OnDone(bOk, Words);
		return bOk;
	};
	const FBpLinkModule& Link = FBpLinkModule::Get();
	// The door: a sample is the bundle's answer and nobody else's.
	if (!Link.IsFromBundle()) return Finish(false, TEXT("A sample scan runs only from the bundled snapshot; this table has a server, and a real scan goes through it."));
	if (!Link.HasSampleFocuses()) return Finish(false, TEXT("This bundle lists no sample focus (yet: they are read with its first scan answers)."));
	if (!SheetPlan.IsValid()) return Finish(false, TEXT("The table has no plan yet."));
	const FBpSavedFocus* Focus = Link.GetFocusList().Focuses.FindByPredicate([&FocusId](const FBpSavedFocus& F) { return F.Id == FocusId; });
	if (!Focus) return Finish(false, TEXT("That sample focus is not in the bundle."));
	const FString Target = InTarget.IsEmpty() ? DirectedTarget() : InTarget;
	FString Kind, ScopeId, Label;
	TArray<FString> Features;
	if (Target != TEXT("site") && !BuildScanScope(Target, Kind, ScopeId, Label, Features)) return Finish(false, FString::Printf(TEXT("%s is no wing, room, bay or feature of the plan."), *Target));
	const bool bSite = Target == TEXT("site");
	const TSet<FString> Keep(Features);
	// Room by room, as a run reads them; within a room nearest row last, so the beam sweeps forward.
	TArray<int32> Walk;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
	{
		if (!TileRoom.IsValidIndex(Index) || !SheetPlan->rooms.IsValidIndex(TileRoom[Index])) continue;
		if (bSite || Keep.Contains(SheetPlan->tiles[Index].id)) Walk.Add(Index);
	}
	if (Walk.Num() == 0) return Finish(false, TEXT("That place has no features to walk."));
	Walk.Sort([this](int32 A, int32 B)
	{
		if (TileRoom[A] != TileRoom[B]) return TileRoom[A] < TileRoom[B];
		return SheetPlan->tiles[A].box.y < SheetPlan->tiles[B].box.y;
	});
	EndSampleScan();
	SampleTiles = MoveTemp(Walk);
	SampleAt = 0;
	SampleLens = Focus->Lens;
	SampleFocus = Focus->Note;
	bScanSample = true;
	bSampleDone = false;
	// The beam is the real scan's: a row at a time down the place. Reduced motion has no beam at all (StepSampleScan).
	TArray<FString> Ids;
	for (int32 Tile : SampleTiles) Ids.Add(SheetPlan->tiles[Tile].id);
	SetScanPlace(Ids, false);
	if (!ReducedMotion())
	{
		bScanLive = ScanPlanBox.bIsValid;
		SetActorTickInterval(0.f);
	}
	const float Step = FMath::Min(FMath::Clamp(CVarSampleStep.GetValueOnGameThread(), 0.05f, 3.f), FMath::Clamp(CVarSampleMax.GetValueOnGameThread(), 5.f, 300.f) / SampleTiles.Num());
	GetWorldTimerManager().SetTimer(SampleTimer, this, &ABpTable::StepSampleScan, Step, true, Step);
	UE_LOG(LogBpTable, Log, TEXT("BpSample: walking %s for %s (%d features, one per %.2f s); no request is made"), bSite ? TEXT("the site") : *Label, *SampleLens, SampleTiles.Num(), Step);
	// The lamp goes to the place being walked.
	PresentScanPlace(TEXT("sample scan"));
	// The first step's row and marks now, not one step later.
	SampleAt = -1;
	StepSampleScan();
	return Finish(true, FString::Printf(TEXT("Sample scan started: %s · %s"), bSite ? TEXT("Everything") : *Label, *BpWords::Lens(SampleLens)));
}

void ABpTable::StepSampleScan()
{
	// Belt and braces: a table that found a server mid-walk stops being a sample at once.
	if (!bScanSample || !FBpLinkModule::Get().IsFromBundle() || !SheetPlan.IsValid())
	{
		EndSampleScan();
		return;
	}
	++SampleAt;
	const bool bEnd = SampleAt >= SampleTiles.Num();
	if (bEnd)
	{
		// Every feature read: the ticks, the title block's "m rooms read" for the linger, then nothing.
		bSampleDone = true;
		bScanLive = false;
		GetWorldTimerManager().SetTimer(SampleTimer, this, &ABpTable::EndSampleScan, SampleLingerS, false);
	}
	else if (!ReducedMotion())
	{
		// The row being read, as the scan line follows a real job: the tile's far edge once it is read.
		const FBpPlanBox& Box = SheetPlan->tiles[SampleTiles[SampleAt]].box;
		ScanTargetY = Box.y + Box.h;
	}
	TMap<int32, FScanRoomMark> Marks;
	SampleMarks(Marks);
	FScanOutcome Outcome;
	Outcome.bSample = true;
	Outcome.bRunning = !bEnd;
	Outcome.Lens = SampleLens;
	Outcome.Focus = SampleFocus;
	Outcome.RoomsTotal = Marks.Num();
	for (const auto& Pair : Marks) Outcome.RoomsRead += Pair.Value.bScanned ? 1 : 0;
	SetScanOutcome(Outcome);
	const FString Lens = BpWords::Lens(SampleLens);
	SetScanStatus(FString::Printf(TEXT("Sample scan  ·  %s"), *Lens),
		bEnd ? FString::Printf(TEXT("%d %s read"), Outcome.RoomsRead, Outcome.RoomsRead == 1 ? TEXT("room") : TEXT("rooms"))
			: FString::Printf(TEXT("%d of %d %s  ·  %s"), Outcome.RoomsRead, Outcome.RoomsTotal, Outcome.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms"), *SampleFocus.Replace(TEXT("\n"), TEXT(" "))));
	RefreshScanMarks();
	if (bEnd) UE_LOG(LogBpTable, Log, TEXT("BpSample: finished: %d %s read (a sample: nothing was read or written)"), Outcome.RoomsRead, Outcome.RoomsRead == 1 ? TEXT("room") : TEXT("rooms"));
}

void ABpTable::EndSampleScan()
{
	if (GetWorld()) GetWorldTimerManager().ClearTimer(SampleTimer);
	if (!bScanSample) return;
	bScanSample = bSampleDone = false;
	bScanLive = false;
	SampleTiles.Reset();
	SetScanStatus(FString(), FString());
	RefreshScanMarks();
}

void ABpTable::SampleMarks(TMap<int32, FScanRoomMark>& OutMarks) const
{
	if (!SheetPlan.IsValid()) return;
	// Every room in scope counts from the start (the title block's "n of m rooms"); it draws only once the walk has reached it
	// (DrawScanMarks), so a room lights as the walk enters it and its rail fills as its features are read.
	for (int32 Index = 0; Index < SampleTiles.Num(); ++Index)
	{
		FScanRoomMark& Mark = OutMarks.FindOrAdd(TileRoom[SampleTiles[Index]]);
		Mark.Lens = SampleLens;
		++Mark.Total;
		Mark.Done += Index < SampleAt ? 1 : 0;
		Mark.bLit |= Index == SampleAt;
	}
	const bool bReduced = ReducedMotion();
	for (auto& Pair : OutMarks)
	{
		Pair.Value.bScanned = Pair.Value.Done >= Pair.Value.Total;
		Pair.Value.bLit |= Pair.Value.Done > 0;
		// Reduced motion: no creeping rail; a room is unread until it is read.
		if (bReduced && !Pair.Value.bScanned) Pair.Value.Done = 0;
	}
}

void ABpTable::SetScanStatus(const FString& Title, const FString& Sub)
{
	if (Title == ScanStatusTitle && Sub == ScanStatusSub) return;
	ScanStatusTitle = Title;
	ScanStatusSub = Sub;
	UE_LOG(LogBpTable, Log, TEXT("BpScan: status %s"), Title.IsEmpty() ? TEXT("none") : *FString::Printf(TEXT("%s | %s"), *Title, *Sub));
	// Discrete changes only, one room at a time: redrawn, not animated.
	if (!SheetPlan.IsValid()) return;
	RedrawSheet();
	if (RoomSheet && !ShownRoomMode.IsEmpty()) RoomSheet->UpdateResource();
}

void ABpTable::SetScanOutcome(const FScanOutcome& Outcome)
{
	const bool bSame = bHasScanOutcome && ScanOutcome.bSample == Outcome.bSample && ScanOutcome.bRunning == Outcome.bRunning && ScanOutcome.RoomsRead == Outcome.RoomsRead
		&& ScanOutcome.RoomsTotal == Outcome.RoomsTotal && ScanOutcome.Lens == Outcome.Lens && ScanOutcome.RunId == Outcome.RunId;
	ScanOutcome = Outcome;
	bHasScanOutcome = true;
	if (!bSame) ScanBandChanged.Broadcast();
}

void ABpTable::ScanBand(FString& Head, FString& Body) const
{
	Head.Reset();
	Body.Reset();
	if (!bHasScanOutcome) return;
	const FString Lens = BpWords::Lens(ScanOutcome.Lens);
	const FString RoomsRead = FString::Printf(TEXT("%d %s read"), ScanOutcome.RoomsRead, ScanOutcome.RoomsRead == 1 ? TEXT("room") : TEXT("rooms"));
	if (ScanOutcome.bSample)
	{
		Head = FString::Printf(TEXT("SAMPLE SCAN · %s"), *Lens.ToUpper());
		Body = ScanOutcome.bRunning ? FString::Printf(TEXT("%d of %d %s · nothing is read or written"), ScanOutcome.RoomsRead, ScanOutcome.RoomsTotal, ScanOutcome.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms"))
			: FString::Printf(TEXT("%s. A sample finds nothing: a room's deck holds the findings it already has."), *RoomsRead);
		return;
	}
	Head = FString::Printf(TEXT("%s · %s"), ScanOutcome.bRunning ? TEXT("SCANNING") : TEXT("SCAN"), *Lens.ToUpper());
	if (ScanOutcome.bRunning)
	{
		Body = FString::Printf(TEXT("%d of %d %s"), ScanOutcome.RoomsRead, ScanOutcome.RoomsTotal, ScanOutcome.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms"));
		return;
	}
	Body = RoomsRead;
	// What it produced, when the store has the run's rows: a real count, never invented; zero is "yet", the store may still be filling.
	if (!ScanOutcome.RunId.IsEmpty())
	{
		int32 Findings = 0;
		for (const FBpProposal& P : FBpLinkModule::Get().GetScanState().Scan.proposals) Findings += P.run_id == ScanOutcome.RunId ? 1 : 0;
		Body += Findings > 0 ? FString::Printf(TEXT(" · %d %s"), Findings, Findings == 1 ? TEXT("finding") : TEXT("findings")) : FString(TEXT(" · 0 findings yet"));
	}
}
