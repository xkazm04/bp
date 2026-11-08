// A scan on the rooms (spark directed-scans P5): the plan's L0 marks at the table (apps/web/src/engine/render/scans.ts,
// `roomScans`): a room being read shows a lit wall in the lens accent and a rail for done/total, a finished room a quiet
// wall and a tick, cleared a few seconds after the job ends. Everything is worked out from the scan side BpLink already
// polls (the jobs, and the store's measurements and activity rows, jobProgress's reading), so it is built on a discrete
// change and costs nothing while no scan runs: one instanced mesh, empty and hidden when idle, with the lens accent on its
// one material instance. M_EdgeGlow takes its colour per material instance, not per mesh instance, so the marks wear the
// newest job's accent (two lenses scanning at once share it, the newest job's rooms winning, as `roomMarks` already lets the
// newest job win a room). Only at the site level: a lift or a room's map hides them. From the bundle, never: its job list is a
// saved answer, and a saved `running` job would read as a reader at work.
#include "BpTable.h"

#include "BpLink.h"
#include "Schema/BpSchemaVocab.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TimerManager.h"

namespace
{
	/** Hides the marks without touching what they read: the gate's way to measure their draws (a run with it 0 against one with it 1). */
	TAutoConsoleVariable<int32> CVarScanMarks(TEXT("bp.ScanMarks"), 1, TEXT("A scan's lit walls, rails and ticks on the rooms: 1 shown, 0 hidden."));

	// The look, by capture from the target pose (Show is the rest walls' scale: RestRoomShow 0.8).
	constexpr float ScanWallShow = 1.5f;
	constexpr float ScanQuietShow = 0.6f;
	constexpr float ScanRailTrackShow = 0.14f;
	constexpr float ScanRailFillShow = 1.1f;
	constexpr float ScanTickShow = 1.4f;
	/** The room's own rest walls while the room is marked: down, so the accent owns the outline. */
	constexpr float ScanRestDim = 0.25f;
	constexpr float ScanEdgeIntensity = 7.f;
	constexpr float ScanFaceOpacity = 0.03f;
	constexpr float ScanTopEdge = 2.2f;
	constexpr float ScanLowEdge = 0.6f;
	/** The wall stands just outside the rest walls' own faces (additive either way; this keeps them from fighting). */
	constexpr float ScanWallGrowCm = 0.08f;
	/** The rail: on the paper, just outside the room's near wall, as long as the room. */
	constexpr float ScanRailGapCm = 1.5f;
	constexpr float ScanRailDepthCm = 0.5f;
	constexpr float ScanRailHeightCm = 0.22f;
	/** The tick, at the rail's left end. */
	constexpr float ScanTickCm = 2.0f;
	constexpr float ScanTickBarCm = 0.32f;
	/** LINGER_MS (scan-views.ts): how long a finished job's marks stay, from when this table saw it finish. */
	constexpr double ScanLingerDoneS = 3.0;
	constexpr double ScanLingerFailedS = 6.0;
	/** How long a job just seen `done` waits for the store's last rows before an unread room leaves. */
	constexpr double ScanStoreCatchUpS = 1.0;
	/** SILENT_MS (liveness.ts): a running job with no sign of life for this long is no longer drawn as a reader at work. */
	constexpr double ScanStaleMinutes = 10.0;
	/** jobProgress's NO_IMPACT: an activity note saying a feature was judged with nothing for this lens to measure. */
	const TCHAR* const NoImpactPrefix = TEXT("no impact:");
	/** isJobNote (jobs.ts): `bp-job:<id>`, or `bp-job:<id> <more>`, never a bare prefix. */
	bool IsJobNote(const FString& Note, const FString& JobId)
	{
		const FString Named = TEXT("bp-job:") + JobId;
		return Note == Named || Note.StartsWith(Named + TEXT(" "));
	}
}

void ABpTable::InitScanMarks()
{
	if (!ScanMarks || !HighlightShell) return;
	UMaterialInterface* Highlight = HighlightShell->GetMaterial(0);
	UMaterial* Base = Highlight ? Highlight->GetMaterial() : nullptr;
	if (!Base) return;
	ScanMarksMid = UMaterialInstanceDynamic::Create(Base, this);
	ScanMarksMid->SetScalarParameterValue(TEXT("FaceOpacity"), ScanFaceOpacity);
	ScanMarksMid->SetScalarParameterValue(TEXT("LidFace"), 0.f);
	ScanMarksMid->SetScalarParameterValue(TEXT("TopEdge"), ScanTopEdge);
	ScanMarksMid->SetScalarParameterValue(TEXT("LowEdge"), ScanLowEdge);
	ScanMarksMid->SetScalarParameterValue(TEXT("Intensity"), ScanEdgeIntensity);
	ScanMarks->SetMaterial(0, ScanMarksMid);
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
	if (!SheetPlan.IsValid() || Link.IsFromBundle())
	{
		const bool bHad = ScanMarkRooms.Num() > 0;
		ClearScanMarks();
		if (bHad) ReapplyRestVolumes();
		return;
	}
	const FBpScanState& State = Link.GetScanState();
	const double Now = FPlatformTime::Seconds();
	const FDateTime UtcNow = FDateTime::UtcNow();
	double Soonest = TNumericLimits<double>::Max();

	struct FMark
	{
		int32 Done = 0;
		int32 Total = 0;
		bool bScanned = false;
		FString Lens;
	};
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
	};
	TArray<FTrack> Tracks;
	for (const FBpScanJob& Job : State.Jobs)
	{
		if (Job.kind != BpVocab::ScanJob::Kind::Measure || Job.lens.IsEmpty() || Job.scope.kind.IsEmpty()) continue;
		FString RunId = Job.run_id;
		if (RunId.IsEmpty()) if (const FBpRun* Named = State.Scan.runs.FindByPredicate([&Job](const FBpRun& R) { return IsJobNote(R.note, Job.id); })) RunId = Named->id;
		Tracks.Add({ Job.id, Job.lens, Job.status, Job.scope.kind, Job.scope.features, RunId, Job.started_at.IsEmpty() ? Job.queued_at : Job.started_at, Job.ended_at });
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
		Tracks.Add({ TEXT("run:") + Run.id, Run.lenses[0], Run.status, Features.Num() > 0 ? FString(BpVocab::ScanScope::Kind::Selection) : FString(BpVocab::ScanScope::Kind::All), MoveTemp(Features), Run.id, Run.started_at, Run.ended_at });
	}
	// Oldest first, so a newer scan's lens and counts win a room (roomMarks).
	Tracks.Sort([](const FTrack& A, const FTrack& B) { return A.StartedAt < B.StartedAt; });
	TMap<int32, FMark> Marks;
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
		TMap<int32, FMark> ByRoom;
		for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
		{
			const FBpPlanTile& Tile = SheetPlan->tiles[Index];
			if ((!bAll && !Want.Contains(Tile.id)) || !TileRoom.IsValidIndex(Index) || !SheetPlan->rooms.IsValidIndex(TileRoom[Index])) continue;
			FMark& Mark = ByRoom.FindOrAdd(TileRoom[Index]);
			Mark.Lens = Track.Lens;
			++Mark.Total;
			Mark.Done += Read.Contains(Tile.id) ? 1 : 0;
		}
		for (auto& Pair : ByRoom)
		{
			Pair.Value.bScanned = Pair.Value.Done >= Pair.Value.Total;
			// A stalled, failed or short-finished scan is no longer reading: it keeps only the rooms it finished. The instant a job
			// reads `done` the store's last rows may be one answer behind (/scans and /scan answer separately): the room holds on
			// through that read rather than blinking off before its tick.
			const bool bJustEnded = bDone && ScanMarkEnded.Contains(Track.Id) && Now - ScanMarkEnded[Track.Id] < ScanStoreCatchUpS && ScanMarkRooms.Contains(Pair.Key);
			if (Pair.Value.bScanned || (bRunning && !bStale) || bJustEnded) Marks.Add(Pair.Key, Pair.Value);
		}
	}

	FString Key;
	FString NewestLens;
	TArray<int32> RoomIndices;
	Marks.GetKeys(RoomIndices);
	RoomIndices.Sort();
	for (int32 Room : RoomIndices)
	{
		const FMark& Mark = Marks[Room];
		Key += FString::Printf(TEXT("%d:%d/%d:%d:%s;"), Room, Mark.Done, Mark.Total, Mark.bScanned, *Mark.Lens);
		NewestLens = Mark.Lens;
	}
	if (Soonest < TNumericLimits<double>::Max()) GetWorldTimerManager().SetTimer(ScanMarkTimer, this, &ABpTable::RefreshScanMarks, FMath::Max(0.05f, static_cast<float>(Soonest - Now)), false);
	if (Key == ScanMarksKey) return;
	ScanMarksKey = Key;
	UE_LOG(LogBpTable, Log, TEXT("BpScan: marks %s"), Key.IsEmpty() ? TEXT("none") : *Key);

	ScanMarks->ClearInstances();
	ScanMarkRooms.Reset();
	if (Marks.Num() > 0)
	{
		TArray<FTransform> Places;
		TArray<float> Data;
		const auto AddBox = [&](const FVector2D& PaperCentre, const FVector2D& PaperSize, double Z0, double HeightCm, float Show, float Face, double YawDeg)
		{
			const FVector Size(PaperSize.Y, PaperSize.X, HeightCm);
			Places.Add(FTransform(FQuat(FVector::UpVector, FMath::DegreesToRadians(YawDeg)), PaperCmToLocal(PaperCentre, static_cast<float>(Z0 + HeightCm * 0.5)), Size / 100.0));
			Data.Append({ static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), Show, Face });
		};
		for (int32 Room : RoomIndices)
		{
			const FMark& Mark = Marks[Room];
			ScanMarkRooms.Add(Room);
			const FBpPlanBox& Box = SheetPlan->rooms[Room].box;
			const FVector2D A = PlanToPaperCm(FVector2D(Box.x, Box.y)), B = PlanToPaperCm(FVector2D(Box.x + Box.w, Box.y + Box.h));
			const FVector2D Foot = B - A;
			AddBox((A + B) * 0.5, Foot + FVector2D(ScanWallGrowCm * 2.0), 0.0, RestRoomHeightCm(Box) + 0.05f, Mark.bScanned ? ScanQuietShow : ScanWallShow, 1.f, 0.0);
			const double RailY = B.Y + ScanRailGapCm;
			if (Mark.bScanned)
			{
				// Two strokes of a tick, on the paper at the rail's left end (plan y runs toward the viewer).
				const FVector2D Corner(A.X + ScanTickCm * 0.5, RailY);
				AddBox(Corner + FVector2D(-ScanTickCm * 0.14, ScanTickCm * 0.12), FVector2D(ScanTickCm * 0.5, ScanTickBarCm), 0.0, ScanRailHeightCm, ScanTickShow, 1.f, 45.0);
				AddBox(Corner + FVector2D(ScanTickCm * 0.22, -ScanTickCm * 0.08), FVector2D(ScanTickCm * 0.95, ScanTickBarCm), 0.0, ScanRailHeightCm, ScanTickShow, 1.f, -45.0);
			}
			else
			{
				AddBox(FVector2D(A.X + Foot.X * 0.5, RailY), FVector2D(Foot.X, ScanRailDepthCm), 0.0, ScanRailHeightCm * 0.6f, ScanRailTrackShow, 1.f, 0.0);
				const double Fraction = Mark.Total > 0 ? static_cast<double>(Mark.Done) / Mark.Total : 0.0;
				if (Fraction > 0.0) AddBox(FVector2D(A.X + Foot.X * Fraction * 0.5, RailY), FVector2D(Foot.X * Fraction, ScanRailDepthCm), 0.0, ScanRailHeightCm, ScanRailFillShow, 1.f, 0.0);
			}
		}
		ScanMarks->SetNumCustomDataFloats(5);
		ScanMarks->AddInstances(Places, false, false, false);
		ScanMarks->SetCustomData(0, Places.Num() - 1, Data, true);
		if (ScanMarksMid)
		{
			const FString* Hex = FBpLinkModule::Get().FindLensAccent(NewestLens);
			if (Hex && Hex->StartsWith(TEXT("#")) && Hex->Len() >= 7) ScanMarksMid->SetVectorParameterValue(TEXT("EdgeColor"), FLinearColor::FromSRGBColor(FColor::FromHex(*Hex)));
		}
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
	const bool bShow = CVarScanMarks.GetValueOnGameThread() != 0 && ScanMarks->GetInstanceCount() > 0 && AnimWing.IsEmpty() && Site > 0.01f;
	if (ScanMarks->IsVisible() != bShow) ScanMarks->SetVisibility(bShow);
	if (!bShow) return;
	ScanMarks->SetRelativeTransform(WingGroupTransform(0.f));
	if (ScanMarksMid) ScanMarksMid->SetScalarParameterValue(TEXT("Intensity"), ScanEdgeIntensity * Site);
}
