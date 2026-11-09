// A scan on the rooms (spark directed-scans P5, redrawn in wave 4's visual pass): the plan's L0 marks at the table
// (apps/web/src/engine/render/scans.ts, `roomMarks`): a room lights only once it holds the feature being read or has a reading
// (a drawn double rule on the paper around it, in the lens accent, and a meter of one cell per feature), a room not yet
// reached draws nothing, a finished room a quiet single rule and a tick, cleared a few seconds after the job ends. The rules
// are opaque unlit bars (M_AimMark) on the paper: 2026-11-09 they replaced lit translucent wall boxes (a neon wall at site
// level, and the largest additive surface a scan drew). Everything is worked out from the scan side BpLink already
// polls (the jobs, and the store's measurements and activity rows, jobProgress's reading), so it is built on a discrete
// change and costs nothing while no scan runs: one instanced mesh, empty and hidden when idle, each instance carrying its
// own accent (custom data 0..2, M_AimMark's), so two lenses scanning at once each keep their colour. Only at the site level: a lift or a room's map hides them. From the bundle, never from its job list: a
// saved `running` job would read as a reader at work. A bundle's sample scan (BpSampleScan.cpp) draws through the same marks.
// While any of this runs, the title block says so (SetScanStatus: the lens, its short focus, n of m rooms, then "m rooms read" for
// the linger, a word for read that never says clean), and the wrist's Scan tab keeps what it produced (ScanBand).
#include "BpTable.h"

#include "BpLink.h"
#include "BpWords.h"
#include "Schema/BpSchemaVocab.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "HAL/IConsoleManager.h"
#include "TimerManager.h"

namespace
{
	/** Hides the marks without touching what they read: the gate's way to measure their draws (a run with it 0 against one with it 1). */
	TAutoConsoleVariable<int32> CVarScanMarks(TEXT("bp.ScanMarks"), 1, TEXT("A scan's drawn rules, meters and ticks on the rooms: 1 shown, 0 hidden."));
	/** How strong the accent draws, for a device check (read when the marks are next drawn: the next room a scan reaches). */
	TAutoConsoleVariable<float> CVarScanMarkGlow(TEXT("bp.ScanMarkGlow"), 1.1f, TEXT("The scan rules' brightness on the lens accent, 0.4 to 2 (1.1: the capture's; read when the marks are next drawn)."));

	// The look, by capture from the target pose. A heavy outer rule and a fine inner one around the room (the web's double wall).
	constexpr float ScanRuleOuterCm = 0.26f;
	constexpr float ScanRuleInnerCm = 0.13f;
	constexpr float ScanRuleGapCm = 0.42f;
	constexpr float ScanRuleHeightCm = 0.14f;
	constexpr float ScanQuietShow = 0.6f;
	/** The room's own rest walls while the room is marked: down a little, so the accent reads as the room's outline. */
	constexpr float ScanRestDim = 0.5f;
	/** The meter: on the paper, just outside the room's near rule, a cell per feature read (the web's drawn meter). */
	constexpr float ScanRailGapCm = 1.6f;
	constexpr float ScanMeterDepthCm = 0.34f;
	constexpr float ScanMeterEmptyDepthCm = 0.09f;
	constexpr float ScanMeterCellGapCm = 0.3f;
	constexpr int32 ScanMeterMaxCells = 18;
	/** The tick, at the meter's left end. */
	constexpr float ScanTickCm = 2.0f;
	constexpr float ScanTickBarCm = 0.26f;
	/** LINGER_MS (scan-views.ts): how long a finished job's marks stay, from when this table saw it finish. */
	constexpr double ScanLingerDoneS = 3.0;
	constexpr double ScanLingerFailedS = 6.0;
	/** How long a job just seen `done` waits for the store's last rows before an unread room leaves. */
	constexpr double ScanStoreCatchUpS = 1.0;
	/** SILENT_MS (liveness.ts): a running job with no sign of life for this long is no longer drawn as a reader at work. */
	constexpr double ScanStaleMinutes = 10.0;
	/** jobProgress's NO_IMPACT: an activity note saying a feature was judged with nothing for this lens to measure. */
	const TCHAR* const NoImpactPrefix = TEXT("no impact:");
	/** focusOfRunNote (focus.ts): the text after `focus:<metric> ` in a directed run's note; empty on a plain run. */
	FString FocusOfRunNote(const FString& Note)
	{
		const int32 At = Note.Find(TEXT("focus:"));
		if (At == INDEX_NONE) return FString();
		const int32 Space = Note.Find(TEXT(" "), ESearchCase::CaseSensitive, ESearchDir::FromStart, At);
		return Space == INDEX_NONE ? FString() : Note.Mid(Space + 1).TrimStartAndEnd();
	}
	/** isJobNote (jobs.ts): `bp-job:<id>`, or `bp-job:<id> <more>`, never a bare prefix. */
	bool IsJobNote(const FString& Note, const FString& JobId)
	{
		const FString Named = TEXT("bp-job:") + JobId;
		return Note == Named || Note.StartsWith(Named + TEXT(" "));
	}
}

void ABpTable::InitScanMarks()
{
	if (!ScanMarks) return;
	// The drawn rule: opaque and unlit, the instance's colour (custom data 0..2), the aim cursor's material (Materials dir is always cooked).
	if (UMaterialInterface* Drawn = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Bp/Materials/M_AimMark.M_AimMark"))) ScanMarks->SetMaterial(0, Drawn);
	else UE_LOG(LogBpTable, Warning, TEXT("BpScan: M_AimMark is missing: the scan marks are not drawn"));
}

void ABpTable::ClearScanMarks()
{
	if (GetWorld()) GetWorldTimerManager().ClearTimer(ScanMarkTimer);
	ScanMarkRooms.Reset();
	ScanMarksKey.Reset();
	if (!ScanMarks) return;
	if (ScanMarks->GetInstanceCount() > 0) ScanMarks->ClearInstances();
	ScanMarks->SetVisibility(false);
}

void ABpTable::RefreshScanMarks()
{
	if (!ScanMarks) return;
	GetWorldTimerManager().ClearTimer(ScanMarkTimer);
	const FBpLinkModule& Link = FBpLinkModule::Get();
	if (bScanSample && SheetPlan.IsValid())
	{
		// The sample's marks stand in for a job's: it is a bundle's local walk, and no server's job ever reads as one.
		TMap<int32, FScanRoomMark> Marks;
		SampleMarks(Marks);
		DrawScanMarks(Marks);
		return;
	}
	if (!SheetPlan.IsValid() || Link.IsFromBundle())
	{
		const bool bHad = ScanMarkRooms.Num() > 0;
		ClearScanMarks();
		if (bHad) ReapplyRestVolumes();
		SetScanStatus(FString(), FString());
		// The PC went away (night two W2a: the table falls back to the bundle): its scans are no longer news on the wrist.
		if (bHasScanOutcome && !ScanOutcome.bSample)
		{
			bHasScanOutcome = false;
			ScanBandChanged.Broadcast();
		}
		return;
	}
	const FBpScanState& State = Link.GetScanState();
	const double Now = FPlatformTime::Seconds();
	const FDateTime UtcNow = FDateTime::UtcNow();
	double Soonest = TNumericLimits<double>::Max();

	// What is on the rooms: this server's jobs, then the runs in the store no job here claims. The web and this server keep
	// separate job lists, so a scan started on the other side reaches this table only as a store run (foreignRunJobs in
	// packages/core/src/scan/views.ts: a one-lens run that reads feature by feature, a measure run or a directed propose run).
	struct FTrack
	{
		FString Id;
		FString Lens;
		FString Status;
		FString Kind;
		TArray<FString> Features;
		FString RunId;
		FString StartedAt;
		FString EndedAt;
		FString Focus;
	};
	TArray<FTrack> Tracks;
	for (const FBpScanJob& Job : State.Jobs)
	{
		if (Job.kind != BpVocab::ScanJob::Kind::Measure || Job.lens.IsEmpty() || Job.scope.kind.IsEmpty()) continue;
		FString RunId = Job.run_id;
		if (RunId.IsEmpty()) if (const FBpRun* Named = State.Scan.runs.FindByPredicate([&Job](const FBpRun& R) { return IsJobNote(R.note, Job.id); })) RunId = Named->id;
		Tracks.Add({ Job.id, Job.lens, Job.status, Job.scope.kind, Job.scope.features, RunId, Job.started_at.IsEmpty() ? Job.queued_at : Job.started_at, Job.ended_at, Job.focus });
	}
	for (const FBpRun& Run : State.Scan.runs)
	{
		if (Run.lenses.Num() != 1 || Run.lenses[0] == TEXT("all")) continue;
		const bool bDirected = Run.phase == BpVocab::Run::Phase::Propose && Run.note.Contains(TEXT("focus:"));
		if (Run.phase != BpVocab::Run::Phase::Measure && !bDirected) continue;
		if (Run.status != BpVocab::Run::Status::Running && Run.status != BpVocab::Run::Status::Done && Run.status != BpVocab::Run::Status::Failed) continue;
		if (State.Jobs.ContainsByPredicate([&Run](const FBpScanJob& Job) { return Job.run_id == Run.id || IsJobNote(Run.note, Job.id); })) continue;
		TArray<FString> Features;
		if (Run.scope.JsonObject.IsValid()) Run.scope.JsonObject->TryGetStringArrayField(TEXT("features"), Features);
		// The run's own status words are the job's for these three; a store run with no feature list covers everything.
		Tracks.Add({ TEXT("run:") + Run.id, Run.lenses[0], Run.status, Features.Num() > 0 ? FString(BpVocab::ScanScope::Kind::Selection) : FString(BpVocab::ScanScope::Kind::All), MoveTemp(Features), Run.id, Run.started_at, Run.ended_at, FocusOfRunNote(Run.note) });
	}
	// Oldest first, so a newer scan's lens and counts win a room (roomMarks).
	Tracks.Sort([](const FTrack& A, const FTrack& B) { return A.StartedAt < B.StartedAt; });
	TMap<int32, FScanRoomMark> Marks;
	// What the status says: the newest track that put a mark on a room, and whether any such track is still reading.
	FScanOutcome Outcome;
	bool bAnyReading = false;
	TArray<FString> Readings;
	for (const FTrack& Track : Tracks)
	{
		const bool bRunning = Track.Status == BpVocab::ScanJob::Status::Running;
		const bool bDone = Track.Status == BpVocab::ScanJob::Status::Done, bFailed = Track.Status == BpVocab::ScanJob::Status::Failed;
		if (bRunning || Track.Status == BpVocab::ScanJob::Status::Queued)
		{
			ScanMarkLive.Add(Track.Id);
			ScanMarkEnded.Remove(Track.Id);
		}
		if (!bRunning && !bDone && !bFailed) continue;
		if (bDone || bFailed)
		{
			const double Linger = bDone ? ScanLingerDoneS : ScanLingerFailedS;
			double Until = 0.0;
			if (ScanMarkLive.Contains(Track.Id))
			{
				// Watched running here: it lingers from when this table saw it end, on this clock.
				Until = ScanMarkEnded.FindOrAdd(Track.Id, Now) + Linger;
			}
			else
			{
				// Ended between two reads, or before this table looked: only its recorded end can say it is still news.
				FDateTime EndedAt;
				if (FDateTime::ParseIso8601(*Track.EndedAt, EndedAt)) Until = Now + Linger - (UtcNow - EndedAt).GetTotalSeconds();
			}
			if (Until <= Now) continue;
			Soonest = FMath::Min(Soonest, Until);
		}
		const bool bAll = Track.Kind == BpVocab::ScanScope::Kind::All;
		const TSet<FString> Want(Track.Features);
		TSet<FString> Read;
		// The feature being read (views.ts `current`): the last reading or measured row in scope.
		FString Current;
		bool bStale = false;
		if (!Track.RunId.IsEmpty())
		{
			for (const FBpMeasurement& M : State.Scan.measurements) if (M.run_id == Track.RunId && M.lens == Track.Lens && (bAll || Want.Contains(M.feature))) Read.Add(M.feature);
			FDateTime Newest(0);
			FDateTime::ParseIso8601(*Track.StartedAt, Newest);
			for (const FBpActivity& A : State.Scan.activity)
			{
				if (A.run_id != Track.RunId) continue;
				FDateTime At;
				if (FDateTime::ParseIso8601(*A.at, At) && At > Newest) Newest = At;
				if (A.lens != Track.Lens) continue;
				// Judged with nothing to measure still counts as read (jobProgress); a steps lens names the feature only in its text.
				FString Feature = A.feature;
				const bool bNoImpact = A.kind == BpVocab::Activity::Kind::Note && A.text.StartsWith(NoImpactPrefix);
				if (bNoImpact && Feature.IsEmpty()) A.text.Mid(FCString::Strlen(NoImpactPrefix)).TrimStart().Split(TEXT(":"), &Feature, nullptr);
				if ((bNoImpact || A.kind == BpVocab::Activity::Kind::Measured) && !Feature.IsEmpty() && (bAll || Want.Contains(Feature))) Read.Add(Feature);
				if ((A.kind == BpVocab::Activity::Kind::Reading || A.kind == BpVocab::Activity::Kind::Measured) && !A.feature.IsEmpty() && (bAll || Want.Contains(A.feature))) Current = A.feature;
			}
			bStale = bRunning && Newest.GetTicks() > 0 && (UtcNow - Newest).GetTotalMinutes() >= ScanStaleMinutes;
		}
		// A tick means read: a finished scan counts what was read, not what it was pointed at. Only one the store has no rows
		// for at all (nothing to count) is taken at its word, as scanViews does.
		if (bDone && Read.Num() == 0)
		{
			if (bAll) for (const FBpPlanTile& Tile : SheetPlan->tiles) Read.Add(Tile.id);
			else Read = Want;
		}
		TMap<int32, FScanRoomMark> ByRoom;
		for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
		{
			const FBpPlanTile& Tile = SheetPlan->tiles[Index];
			if ((!bAll && !Want.Contains(Tile.id)) || !TileRoom.IsValidIndex(Index) || !SheetPlan->rooms.IsValidIndex(TileRoom[Index])) continue;
			FScanRoomMark& Mark = ByRoom.FindOrAdd(TileRoom[Index]);
			Mark.Lens = Track.Lens;
			++Mark.Total;
			Mark.Done += Read.Contains(Tile.id) ? 1 : 0;
			Mark.bLit |= Tile.id == Current;
		}
		// Several scanners at once (night two W2a): each reading one is counted on its own, so the band and the title block name
		// them all, not only the newest.
		if (bRunning && !bStale && ByRoom.Num() > 0)
		{
			int32 TrackRead = 0;
			for (const auto& Pair : ByRoom) TrackRead += Pair.Value.Done >= Pair.Value.Total ? 1 : 0;
			Readings.Add(FString::Printf(TEXT("%s %d/%d"), *BpWords::Lens(Track.Lens), TrackRead, ByRoom.Num()));
		}
		for (auto& Pair : ByRoom)
		{
			Pair.Value.bScanned = Pair.Value.Done >= Pair.Value.Total;
			Pair.Value.bLit |= Pair.Value.Done > 0;
			// A stalled, failed or short-finished scan is no longer reading: it keeps only the rooms it finished. The instant a job
			// reads `done` the store's last rows may be one answer behind (/scans and /scan answer separately): the room holds on
			// through that read rather than blinking off before its tick.
			const bool bJustEnded = bDone && ScanMarkEnded.Contains(Track.Id) && Now - ScanMarkEnded[Track.Id] < ScanStoreCatchUpS && ScanMarkRooms.Contains(Pair.Key);
			if (Pair.Value.bScanned || (bRunning && !bStale) || bJustEnded)
			{
				Marks.Add(Pair.Key, Pair.Value);
				Outcome.Lens = Track.Lens;
				Outcome.Focus = Track.Focus;
				Outcome.RunId = Track.RunId;
				bAnyReading |= bRunning && !bStale;
			}
		}
	}
	if (Soonest < TNumericLimits<double>::Max()) GetWorldTimerManager().SetTimer(ScanMarkTimer, this, &ABpTable::RefreshScanMarks, FMath::Max(0.05f, static_cast<float>(Soonest - Now)), false);

	// The status: read or reading. A room counts as read when the store says every one of its features in scope was.
	Outcome.bRunning = bAnyReading;
	Outcome.RoomsTotal = Marks.Num();
	Outcome.Readers = Readings.Num();
	Outcome.Readings = FString::Join(Readings, TEXT(" · "));
	for (const auto& Pair : Marks) Outcome.RoomsRead += Pair.Value.bScanned ? 1 : 0;
	if (Marks.Num() > 0 && (bAnyReading || Outcome.RoomsRead > 0))
	{
		const FString Lens = BpWords::Lens(Outcome.Lens);
		const FString Focus = Outcome.Focus.Replace(TEXT("\n"), TEXT(" "));
		const TCHAR* const RoomWord = Outcome.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms");
		if (Outcome.Readers > 1)
		{
			// Several at once: the count, then each one's lens and rooms read of its own rooms.
			SetScanStatus(FString::Printf(TEXT("Scanning  ·  %d scans"), Outcome.Readers), Outcome.Readings + TEXT(" rooms"));
		}
		else
		{
			SetScanStatus(FString::Printf(TEXT("%s  ·  %s"), bAnyReading ? TEXT("Scanning") : TEXT("Scan"), *Lens),
				bAnyReading ? FString::Printf(TEXT("%d of %d %s"), Outcome.RoomsRead, Outcome.RoomsTotal, RoomWord) + (Focus.IsEmpty() ? FString() : TEXT("  ·  ") + Focus)
					: FString::Printf(TEXT("%d %s read"), Outcome.RoomsRead, Outcome.RoomsRead == 1 ? TEXT("room") : TEXT("rooms")));
		}
		SetScanOutcome(Outcome);
	}
	// A room holding on through the store's last rows (bJustEnded) keeps the status it has, rather than blinking off for a beat.
	else if (Marks.Num() == 0)
	{
		SetScanStatus(FString(), FString());
		// Nothing reads any more and the reader is gone (cancelled, or a restarted PC lost its jobs): the band stops saying
		// "scanning"; what it last produced stays.
		if (bHasScanOutcome && ScanOutcome.bRunning && !ScanOutcome.bSample)
		{
			FScanOutcome Stopped = ScanOutcome;
			Stopped.bRunning = false;
			Stopped.Readers = 0;
			Stopped.Readings.Reset();
			SetScanOutcome(Stopped);
		}
	}
	DrawScanMarks(Marks);
}

void ABpTable::DrawScanMarks(const TMap<int32, FScanRoomMark>& Marks)
{
	FString Key;
	TArray<int32> RoomIndices;
	Marks.GetKeys(RoomIndices);
	RoomIndices.Sort();
	for (int32 Room : RoomIndices)
	{
		const FScanRoomMark& Mark = Marks[Room];
		// A room the reader has not reached is in the status's count but draws nothing (`roomMarks`'s lit).
		if (!Mark.bLit && !Mark.bScanned) continue;
		Key += FString::Printf(TEXT("%d:%d/%d:%d:%s;"), Room, Mark.Done, Mark.Total, Mark.bScanned, *Mark.Lens);
	}
	if (Key == ScanMarksKey) return;
	ScanMarksKey = Key;
	UE_LOG(LogBpTable, Log, TEXT("BpScan: marks %s"), Key.IsEmpty() ? TEXT("none") : *Key);

	ScanMarks->ClearInstances();
	ScanMarkRooms.Reset();
	if (!Key.IsEmpty())
	{
		TArray<FTransform> Places;
		TArray<float> Data;
		const float Glow = FMath::Clamp(CVarScanMarkGlow.GetValueOnGameThread(), 0.4f, 2.f);
		const auto AddBar = [&](const FVector2D& PaperCentre, const FVector2D& PaperSize, double HeightCm, const FLinearColor& Color, double YawDeg)
		{
			const FVector Size(PaperSize.Y, PaperSize.X, HeightCm);
			Places.Add(FTransform(FQuat(FVector::UpVector, FMath::DegreesToRadians(YawDeg)), PaperCmToLocal(PaperCentre, static_cast<float>(HeightCm * 0.5)), Size / 100.0));
			Data.Append({ Color.R, Color.G, Color.B });
		};
		// A rule around a box of the paper, its bars meeting at the corners.
		const auto AddRule = [&](const FVector2D& Min, const FVector2D& Max, double Width, const FLinearColor& Color)
		{
			const FVector2D Mid = (Min + Max) * 0.5, Size = Max - Min;
			AddBar(FVector2D(Mid.X, Min.Y), FVector2D(Size.X + Width, Width), ScanRuleHeightCm, Color, 0.0);
			AddBar(FVector2D(Mid.X, Max.Y), FVector2D(Size.X + Width, Width), ScanRuleHeightCm, Color, 0.0);
			AddBar(FVector2D(Min.X, Mid.Y), FVector2D(Width, Size.Y), ScanRuleHeightCm, Color, 0.0);
			AddBar(FVector2D(Max.X, Mid.Y), FVector2D(Width, Size.Y), ScanRuleHeightCm, Color, 0.0);
		};
		for (int32 Room : RoomIndices)
		{
			const FScanRoomMark& Mark = Marks[Room];
			if (!Mark.bLit && !Mark.bScanned) continue;
			ScanMarkRooms.Add(Room);
			const FBpPlanBox& Box = SheetPlan->rooms[Room].box;
			const FVector2D A = PlanToPaperCm(FVector2D(Box.x, Box.y)), B = PlanToPaperCm(FVector2D(Box.x + Box.w, Box.y + Box.h));
			const FVector2D Foot = B - A;
			const FString* Hex = FBpLinkModule::Get().FindLensAccent(Mark.Lens);
			FLinearColor Ink = Hex && Hex->StartsWith(TEXT("#")) && Hex->Len() >= 7 ? FLinearColor::FromSRGBColor(FColor::FromHex(*Hex)) : FLinearColor(0.75f, 0.9f, 1.f);
			Ink *= Glow * (Mark.bScanned ? ScanQuietShow : 1.f);
			Ink.A = 1.f;
			const double Inset = ScanRuleOuterCm * 0.5;
			// Being read: the double wall. Read: one quiet rule and a tick.
			AddRule(A - FVector2D(Inset), B + FVector2D(Inset), ScanRuleOuterCm, Ink);
			if (!Mark.bScanned) AddRule(A - FVector2D(Inset + ScanRuleGapCm), B + FVector2D(Inset + ScanRuleGapCm), ScanRuleInnerCm, Ink);
			const double RailY = B.Y + ScanRailGapCm;
			if (Mark.bScanned)
			{
				// Two strokes of a tick, on the paper at the rail's left end (plan y runs toward the viewer).
				const FVector2D Corner(A.X + ScanTickCm * 0.5, RailY);
				AddBar(Corner + FVector2D(-ScanTickCm * 0.14, ScanTickCm * 0.12), FVector2D(ScanTickCm * 0.5, ScanTickBarCm), ScanRuleHeightCm, Ink, 45.0);
				AddBar(Corner + FVector2D(ScanTickCm * 0.22, -ScanTickCm * 0.08), FVector2D(ScanTickCm * 0.95, ScanTickBarCm), ScanRuleHeightCm, Ink, -45.0);
			}
			else if (Mark.Total > 0)
			{
				// The drawn meter: a cell per feature (a long room's are binned), filled for each one read.
				const int32 Cells = FMath::Min(Mark.Total, ScanMeterMaxCells);
				const double CellW = (Foot.X - ScanMeterCellGapCm * (Cells - 1)) / Cells;
				const int32 Filled = FMath::RoundToInt(static_cast<double>(Mark.Done) / Mark.Total * Cells);
				for (int32 Cell = 0; Cell < Cells; ++Cell)
				{
					const bool bDone = Cell < Filled;
					const double Depth = bDone ? ScanMeterDepthCm : ScanMeterEmptyDepthCm;
					const FLinearColor CellInk = bDone ? Ink : Ink * 0.55f;
					AddBar(FVector2D(A.X + CellW * 0.5 + Cell * (CellW + ScanMeterCellGapCm), RailY), FVector2D(CellW, Depth), bDone ? ScanRuleHeightCm : ScanRuleHeightCm * 0.5, CellInk, 0.0);
				}
			}
		}
		ScanMarks->SetNumCustomDataFloats(3);
		ScanMarks->AddInstances(Places, false, false, false);
		ScanMarks->SetCustomData(0, Places.Num() - 1, Data, true);
	}
	ReapplyRestVolumes();
}

float ABpTable::ScanRestShow(int32 Room) const
{
	return ScanMarkRooms.Contains(Room) ? ScanRestDim : 1.f;
}

void ABpTable::ApplyScanMarks()
{
	if (!ScanMarks) return;
	const float Site = SiteShow();
	// Opaque rules have no alpha to fade: they stand through a level change until the site level has mostly left.
	const bool bShow = CVarScanMarks.GetValueOnGameThread() != 0 && ScanMarks->GetInstanceCount() > 0 && AnimWing.IsEmpty() && Site > 0.5f;
	if (ScanMarks->IsVisible() != bShow) ScanMarks->SetVisibility(bShow);
	if (!bShow) return;
	ScanMarks->SetRelativeTransform(WingGroupTransform(0.f));
}
