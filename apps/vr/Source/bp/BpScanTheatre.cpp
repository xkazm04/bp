// The scan theatre (wave C1, the owner's pick of 2026-11-10: "watch a scan work on the table as it happens"), presentation over
// what the table already reads: the poll's jobs and activity rows (BpLink, 0.5 s while a job runs) for a real scan, the local
// timer walk for the bundle's sample (BpSampleScan.cpp). No transport, no stream, no request of its own beyond the PC's `say`
// for the two spoken lines of a linked scan.
//   - The lamp follows: while a scan runs it leaves home for the room being read (one flight per room change, through the
//     lamp's own stations: never behind the console's slot, never over a tag), turns its light down into the room and takes
//     the lens's accent as its light's colour (BpLampLook.cpp's "scanning" state). The scan line (the lens's colour, through
//     MPC_BpScan's ScanTint) is the light's sweep. When the person has the lamp (a talk, an ask, the stand-up) the person wins:
//     the lamp stays and catches up after. When the scan ends it goes home.
//   - It narrates: a caption "Reading <room>, n of m" on each room change, quiet in between; a voice at two moments only, the
//     start and the result. On the bundle these are rendered clips (Content/BpData/voice/scan/, apps/vr/tools/tour-voice.ts
//     --scan, the lines in BpTourBook.cpp's ScanLines); linked, the PC's `say` speaks them (within its budget; the caption
//     alone carries a line it refuses). A line waits for the lamp's voice to be free and is dropped more than 10 s stale.
//   - Findings land: a finding the pins did not show before arrives with a drop onto its tile (BuildPins/PlacePins animate
//     the pins that exist; no component per landing), staggered so six read as six. The sample holds back up to six of the
//     bundle's open findings in its scope at its start and lands each room's as the walk leaves that room; nothing is written.
//   - A result: the SCAN RESULT sheet on the console (BpConsole.cpp), the bar's chip when another sheet is open, the wrist's band.
// Nothing here ticks at rest: a 0.5 s timer runs only while a scan runs or a line waits, and the landing ticks only while a pin
// is in the air.
#include "BpTable.h"

#include "BpAudio.h"
#include "BpLink.h"
#include "BpPawn.h"
#include "BpWords.h"
#include "Schema/BpSchemaVocab.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "RenderTimer.h"
#include "TimerManager.h"

namespace
{
	TAutoConsoleVariable<int32> CVarTheatre(TEXT("bp.ScanTheatre"), 1,
		TEXT("The scan theatre (wave C1): 1 (default) the lamp follows a scan room to room with captions, says its start and result, findings land and a result sheet opens; 0 the scan draws only its marks, as before."));
	TAutoConsoleVariable<int32> CVarDecisionLands(TEXT("bp.Wow.DecisionLands"), 1,
		TEXT("Wave U1: a stand-up decision answered drops its feature's pin onto the plan again (a fall and a settle, the scan theatre's landing), so the answer lands on the table. 1 on (default), 0 off. bp.ReducedMotion stills it."));
	TAutoConsoleVariable<float> CVarLandSlow(TEXT("bp.Wow.LandSlow"), 1.f,
		TEXT("Wave U1, for captures: a pin's landing (a finding's or a decision's) runs this many times slower (1 to 40; default 1)."));
	TAutoConsoleVariable<int32> CVarScanVoice(TEXT("bp.ScanVoice"), 1, TEXT("The scan's two spoken lines (its start and its result): 1 (default) spoken, 0 captions only."));

	/** A landing: the pin drops from PinDropCm over its tile and settles in PinLandS, the next one PinStaggerS later. */
	constexpr float PinDropCm = 12.f;
	constexpr float PinLandS = 0.38f;
	constexpr float PinStaggerS = 0.15f;
	/** A line older than this when the voice frees up is dropped. */
	constexpr double VoiceStaleS = 10.0;
	/** New findings land while a scan runs and this long after it ends (a directed run writes its findings near its end). */
	constexpr double LandAfterEndS = 30.0;
	/** A real scan's result is read this long after its job leaves running: /scan answers apart from /scans. */
	constexpr float LiveResultDelayS = 2.f;
	/** The sample's scripted findings: at most this many, and at most this many in one room. */
	constexpr int32 SampleHeldMax = 6;
	constexpr int32 SampleHeldPerRoom = 2;
	/** The voice clips of the scan's lines (the bundle). */
	const TCHAR* const ScanClipDir = TEXT("BpData/voice/scan");

	bool TheatreReduced()
	{
		const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
		return Reduced && Reduced->GetInt() != 0;
	}

	ABpPawn* TheatrePawn(const UWorld* World)
	{
		const APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	/** A count as a spoken word (the clips' ids and words): none, one ... twenty, then digits. */
	FString CountWord(int32 N)
	{
		static const TCHAR* const Words[] = { TEXT("none"), TEXT("one"), TEXT("two"), TEXT("three"), TEXT("four"), TEXT("five"), TEXT("six"), TEXT("seven"), TEXT("eight"),
			TEXT("nine"), TEXT("ten"), TEXT("eleven"), TEXT("twelve"), TEXT("thirteen"), TEXT("fourteen"), TEXT("fifteen"), TEXT("sixteen"), TEXT("seventeen"), TEXT("eighteen"),
			TEXT("nineteen"), TEXT("twenty") };
		return N >= 0 && N < static_cast<int32>(UE_ARRAY_COUNT(Words)) ? FString(Words[N]) : FString::FromInt(N);
	}

	/** The start clip for a scope's words (DirectedScope: everything, this wing, this room, this place). */
	FString StartClip(const FString& ScopeWords)
	{
		if (ScopeWords == TEXT("everything")) return TEXT("scan-start-everything");
		if (ScopeWords == TEXT("this wing")) return TEXT("scan-start-wing");
		if (ScopeWords == TEXT("this room")) return TEXT("scan-start-room");
		return TEXT("scan-start-place");
	}

	FLinearColor AccentOf(const FString& Lens)
	{
		const FString* Hex = FBpLinkModule::Get().FindLensAccent(Lens);
		FLinearColor Ink = Hex && Hex->StartsWith(TEXT("#")) && Hex->Len() >= 7 ? FLinearColor::FromSRGBColor(FColor::FromHex(*Hex)) : FLinearColor(0.04f, 0.58f, 1.f);
		// As bright as the scan line's own cyan (its strongest channel 1), so a dark accent still reads as light.
		const float Max = FMath::Max3(Ink.R, Ink.G, Ink.B);
		if (Max > 0.01f) Ink /= Max;
		Ink.A = 1.f;
		return Ink;
	}

	FAutoConsoleCommandWithWorld CmdTheatreLines(TEXT("BpScan.TheatreLines"),
		TEXT("BpScan.TheatreLines: logs, for the sample on this plan, every scope (the site, each wing, each room) with its rooms and the findings it would land: the result lines tour-voice.ts --scan renders."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (!World) return;
			for (TActorIterator<ABpTable> It(World); It; ++It) It->LogTheatreLines();
		}));
	FAutoConsoleCommandWithWorld CmdMissedTest(TEXT("BpScan.MissedTest"),
		TEXT("BpScan.MissedTest: wave U2, for captures: a scan of everything that ended a moment ago before any read saw it running (a stand-in job, the store's findings as they are): its result sheet, as a fast server's scan gets it."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (!World) return;
			FBpScanJob Job;
			Job.id = TEXT("job-missed-test");
			Job.kind = BpVocab::ScanJob::Kind::Measure;
			Job.scope.kind = BpVocab::ScanScope::Kind::All;
			Job.scope.label = TEXT("Everything");
			Job.status = BpVocab::ScanJob::Status::Done;
			const FDateTime Now = FDateTime::UtcNow();
			Job.queued_at = Job.started_at = (Now - FTimespan::FromSeconds(9.0)).ToIso8601();
			Job.ended_at = Now.ToIso8601();
			for (TActorIterator<ABpTable> It(World); It; ++It) It->TheatreMissed(Job, FBpLinkModule::Get().GetScanState());
		}));
}

int32 ABpTable::ScanSeverity(const FBpProposal& Proposal, const int32* Tier)
{
	// The ledger's tiers when triaged (T0 stop-ship, T1 before release, later); an untriaged one by its risk, as the pins' rule
	// reads urgency (risk 9 or more stop-ship, PinTagRiskMin or more before release).
	if (Tier) return *Tier <= 0 ? 0 : *Tier == 1 ? 1 : 2;
	return Proposal.risk >= 9.f ? 0 : Proposal.risk >= PinTagRiskMin ? 1 : 2;
}

bool ABpTable::TheatrePersonHasLamp() const
{
	// The person wins: a talk in flight, an answer the lamp is giving, or the stand-up open.
	if (TalkLampState() != 0) return true;
	if (LampOffer != ELampOffer::None && LampCaptionClock > 0.f) return true;
	const ABpPawn* Pawn = TheatrePawn(GetWorld());
	return Pawn && Pawn->IsStandupOpen();
}

void ABpTable::TheatreBegin(bool bSample, const FString& Key, const FString& Lens, const FString& PlaceWords, const FString& ScopeWords, int32 RoomsOf, bool bSpeak)
{
	if (CVarTheatre.GetValueOnGameThread() == 0 || !GetWorld()) return;
	bTheatre = true;
	bTheatreSample = bSample;
	bTheatreMissed = false;
	TheatreKey = Key;
	TheatreLens = Lens;
	TheatrePlace = PlaceWords;
	TheatreStartedAt = GetWorld()->GetTimeSeconds();
	TheatreRoom = INDEX_NONE;
	TheatreRoomAt = 0;
	TheatreRoomsOf = RoomsOf;
	TheatreLampOwed = INDEX_NONE;
	TheatreLanded.Reset();
	TheatreEndedAt = -1.0;
	bTheatreLamp = true;
	TheatreTint = AccentOf(Lens);
	// A new scan's result replaces the last one's.
	const bool bHadResult = bTheatreResult;
	bTheatreResult = false;
	bTheatreResultSeen = true;
	if (bHadResult) ScanBandChanged.Broadcast();
	// The last result's sheet gives way to the SCAN page (the new scan's running state).
	if (ABpPawn* Pawn = TheatrePawn(GetWorld()); Pawn && Pawn->IsConsoleOpen() && Pawn->GetConsolePage() == TEXT("scanresult")) Pawn->OpenConsole(TEXT("scan"));
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: begin %s (%s) lens=%s over %s, %d rooms; the lamp follows, its light %s"), *Key, bSample ? TEXT("the sample") : TEXT("a real scan"), *Lens, *PlaceWords, RoomsOf,
		*TheatreTint.ToFColor(true).ToHex());
	if (bSpeak)
	{
		const FString Line = FString::Printf(TEXT("Scanning %s."), *ScopeWords);
		TheatreVoice(bSample ? StartClip(ScopeWords) : FString(), bSample ? FString() : Line);
	}
	GetWorldTimerManager().SetTimer(TheatreTimer, this, &ABpTable::TheatrePump, 0.5f, true);
	SetActorTickInterval(0.f);
}

void ABpTable::TheatreReading(int32 Room, int32 At, int32 Of)
{
	if (!bTheatre || !SheetPlan.IsValid() || !SheetPlan->rooms.IsValidIndex(Room) || Room == TheatreRoom) return;
	TheatreRoom = Room;
	TheatreRoomAt = At;
	TheatreRoomsOf = FMath::Max(Of, At);
	const FString& Name = SheetPlan->rooms[Room].name;
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: reading %s, %d of %d"), *Name, At, TheatreRoomsOf);
	ScanBandChanged.Broadcast();
	if (TheatrePersonHasLamp())
	{
		// The person has the lamp: no caption over theirs, and the flight waits (TheatrePump catches up).
		TheatreLampOwed = Room;
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: the person has the lamp; it follows %s after"), *Name);
		return;
	}
	TheatreFly(Room);
}

void ABpTable::TheatreFly(int32 Room)
{
	if (!SheetPlan.IsValid() || !SheetPlan->rooms.IsValidIndex(Room)) return;
	TheatreLampOwed = INDEX_NONE;
	const FString& Name = SheetPlan->rooms[Room].name;
	// The caption, a notice on the site plan. The stand-up's quiet rule: the console's SCAN page already says the room large,
	// so while it shows the lamp's box stays quiet (its words are the same).
	SayLamp(FString::Printf(TEXT("Reading %s, %d of %d"), *Name, TheatreRoomAt, TheatreRoomsOf), true);
	const ABpPawn* Pawn = TheatrePawn(GetWorld());
	// Any open sheet: the SCAN page says the room large, and over another sheet the box would stand behind its edge.
	if (Pawn && Pawn->IsConsoleOpen())
	{
		bSheetCaption = true;
		ApplyLampWidgets();
	}
	// One flight per room change (a cut under bp.ReducedMotion, StartLampRide); already at the station it only turns.
	PresentLamp(LampTargetForRoom(SheetPlan->rooms[Room].id), TEXT("scan"));
}

void ABpTable::TheatreVoice(const FString& Clip, const FString& Say)
{
	if (CVarScanVoice.GetValueOnGameThread() == 0 || (Clip.IsEmpty() && Say.IsEmpty())) return;
	// Wave N3-W3: SETTINGS > NARRATION below ALL: the scan's and the stand-up's opening lines are captions only.
	if (BpAudio::Narration() < BpAudio::NarrationAll) { UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: line %s%s not said: bp.Narration %d"), *Clip, *Say, BpAudio::Narration()); return; }
	TheatreVoiceClip = Clip;
	TheatreVoiceSay = Say;
	TheatreVoiceAt = FPlatformTime::Seconds();
	TheatrePump();
	if (!TheatreVoiceClip.IsEmpty() || !TheatreVoiceSay.IsEmpty()) GetWorldTimerManager().SetTimer(TheatreTimer, this, &ABpTable::TheatrePump, 0.5f, true);
}

void ABpTable::TheatrePump()
{
	// The lamp catches up with the reading once the person lets it go.
	if (bTheatre && TheatreLampOwed != INDEX_NONE && !TheatrePersonHasLamp()) TheatreFly(TheatreLampOwed);
	// A line waits for the voice to be free (the tour's, a talk's), and goes stale.
	if (!TheatreVoiceClip.IsEmpty() || !TheatreVoiceSay.IsEmpty())
	{
		const double Age = FPlatformTime::Seconds() - TheatreVoiceAt;
		if (Age > VoiceStaleS)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: line dropped, %.0f s stale: %s%s"), Age, *TheatreVoiceClip, *TheatreVoiceSay);
			TheatreVoiceClip.Reset();
			TheatreVoiceSay.Reset();
		}
		else if (!IsVoicePlaying() && TalkLampState() == 0)
		{
			const FString Clip = MoveTemp(TheatreVoiceClip), Say = MoveTemp(TheatreVoiceSay);
			TheatreVoiceClip.Reset();
			TheatreVoiceSay.Reset();
			if (!Clip.IsEmpty())
			{
				TArray<uint8>* File = ScanClips.Find(Clip);
				if (!File)
				{
					File = &ScanClips.Add(Clip);
					FFileHelper::LoadFileToArray(*File, *(FPaths::ProjectContentDir() / ScanClipDir / (Clip + TEXT(".wav"))), FILEREAD_Silent);
				}
				const bool bPlayed = PlayVoiceWav(*File, *Clip);
				UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: voice clip %s %s"), *Clip, bPlayed ? *FString::Printf(TEXT("(%d bytes) spoken"), File->Num()) : TEXT("missing: the caption carries it"));
			}
			else if (FBpLinkModule::Get().HasPcLink())
			{
				// Linked: one line through the PC's say, within its budget; a refusal leaves the caption to carry it.
				const FString Line = Say.Left(160);
				UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: say \"%s\" (%d characters)"), *Line, Line.Len());
				TWeakObjectPtr<ABpTable> Self(this);
				FBpLinkModule::Get().PostSay(Line, [Self](int32 Status, const TArray<uint8>& Wav, const FString& Body)
				{
					ABpTable* T = Self.Get();
					if (!T) return;
					if (Status != 200 || Wav.Num() == 0)
					{
						UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: say answered %d: the caption carries the line"), Status);
						return;
					}
					if (T->IsVoicePlaying() || T->TalkLampState() != 0)
					{
						UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: say's voice dropped: the lamp's voice is busy"));
						return;
					}
					const bool bPlayed = T->PlayVoiceWav(Wav, TEXT("scan"));
					UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: say answered 200 (%d bytes) %s"), Wav.Num(), bPlayed ? TEXT("spoken") : TEXT("unreadable"));
				});
			}
		}
	}
	if (!bTheatre && TheatreVoiceClip.IsEmpty() && TheatreVoiceSay.IsEmpty()) GetWorldTimerManager().ClearTimer(TheatreTimer);
}

void ABpTable::HoldSampleFindings()
{
	ScanHeld.Reset();
	TheatreLanded.Reset();
	if (CVarTheatre.GetValueOnGameThread() == 0 || !SheetPlan.IsValid()) return;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	if (!State.bHasScan) return;
	TMap<FString, int32> TileOf;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index) TileOf.Add(SheetPlan->tiles[Index].id, Index);
	TSet<int32> InScope;
	for (int32 Tile : SampleTiles) InScope.Add(TileRoom[Tile]);
	struct FCandidate { FString Id; int32 Room; int32 Severity; double Risk; };
	TArray<FCandidate> Candidates;
	for (const FBpProposal& P : State.Scan.proposals)
	{
		if (P.status != BpVocab::Proposal::Status::Proposed) continue;
		const int32* Tile = TileOf.Find(P.feature);
		if (!Tile || !TileRoom.IsValidIndex(*Tile) || !InScope.Contains(TileRoom[*Tile])) continue;
		Candidates.Add({ P.id, TileRoom[*Tile], ScanSeverity(P, State.Tiers.Find(P.id)), P.risk });
	}
	// Taken a severity at a time (stop-ship, before release, later, then round again; within one the highest risk), so the
	// result shows each kind it has, at most two in a room so the landings spread.
	Candidates.StableSort([](const FCandidate& A, const FCandidate& B) { return A.Severity != B.Severity ? A.Severity < B.Severity : A.Risk > B.Risk; });
	{
		TArray<FCandidate> Bins[3];
		for (const FCandidate& C : Candidates) Bins[FMath::Clamp(C.Severity, 0, 2)].Add(C);
		TArray<FCandidate> Turns;
		for (int32 Round = 0; Turns.Num() < Candidates.Num(); ++Round) for (int32 S = 0; S < 3; ++S) if (Bins[S].IsValidIndex(Round)) Turns.Add(Bins[S][Round]);
		Candidates = MoveTemp(Turns);
	}
	TMap<int32, int32> PerRoom;
	for (const FCandidate& C : Candidates)
	{
		if (ScanHeld.Num() >= SampleHeldMax) break;
		int32& N = PerRoom.FindOrAdd(C.Room);
		if (N >= SampleHeldPerRoom) continue;
		++N;
		ScanHeld.Add(C.Id, C.Room);
	}
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: the sample holds %d of the bundle's open findings in scope back from the pins (%d candidates); they land as the walk leaves their rooms"), ScanHeld.Num(), Candidates.Num());
	if (ScanHeld.Num() == 0) return;
	bPinsNoLand = true;
	BuildPins(State);
	bPinsNoLand = false;
}

void ABpTable::LandHeld(int32 Room)
{
	if (ScanHeld.Num() == 0) return;
	TArray<FString> Ids;
	for (const TPair<FString, int32>& Pair : ScanHeld) if (Room == INDEX_NONE || Pair.Value == Room) Ids.Add(Pair.Key);
	if (Ids.Num() == 0) return;
	for (const FString& Id : Ids)
	{
		ScanHeld.Remove(Id);
		TheatreLanded.Add(Id);
	}
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %s's findings land: %s"), SheetPlan.IsValid() && SheetPlan->rooms.IsValidIndex(Room) ? *SheetPlan->rooms[Room].name : TEXT("every room"), *FString::Join(Ids, TEXT(", ")));
	BuildPins(FBpLinkModule::Get().GetScanState());
}

void ABpTable::FinishTheatreResult(bool bCancelled, bool bFailed)
{
	FScanResult R;
	R.bSample = bTheatreSample;
	R.bCancelled = bCancelled;
	R.bFailed = bFailed;
	R.bMissed = bTheatreMissed;
	R.Lens = TheatreLens;
	R.Place = TheatrePlace;
	R.RoomsRead = bHasScanOutcome ? ScanOutcome.RoomsRead : 0;
	R.RoomsTotal = bHasScanOutcome ? FMath::Max(ScanOutcome.RoomsTotal, TheatreRoomsOf) : TheatreRoomsOf;
	R.Seconds = GetWorld() ? (TheatreEndedAt > 0.0 ? TheatreEndedAt : GetWorld()->GetTimeSeconds()) - TheatreStartedAt : 0.0;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	if (bTheatreSample)
	{
		R.Features = bCancelled ? FMath::Clamp(SampleAt, 0, SampleTiles.Num()) : SampleTiles.Num();
	}
	else
	{
		TSet<FString> Read;
		for (const FBpActivity& A : State.Scan.activity) if (A.run_id == ScanRun && A.kind == BpVocab::Activity::Kind::Measured && !A.feature.IsEmpty()) Read.Add(A.feature);
		R.Features = Read.Num();
		// No feature measured is no room read, whatever the marks counted as entered (the first real scan said "1 room read"
		// over 0 features).
		if (R.Features == 0) R.RoomsRead = 0;
	}
	// What it found: the sample's landed findings; a real run's proposals by its run id, else the ones that landed while it ran.
	TArray<const FBpProposal*> Found;
	for (const FBpProposal& P : State.Scan.proposals)
	{
		const bool bOurs = bTheatreSample ? TheatreLanded.Contains(P.id) : (!ScanRun.IsEmpty() && P.run_id == ScanRun) || TheatreLanded.Contains(P.id);
		if (bOurs) Found.Add(&P);
	}
	Found.Sort([&State](const FBpProposal& A, const FBpProposal& B)
	{
		const int32 SA = ScanSeverity(A, State.Tiers.Find(A.id)), SB = ScanSeverity(B, State.Tiers.Find(B.id));
		return SA != SB ? SA < SB : A.risk > B.risk;
	});
	for (const FBpProposal* P : Found)
	{
		++R.Severity[ScanSeverity(*P, State.Tiers.Find(P->id))];
		if (R.Top.Num() < 3) R.Top.Add(P->id);
		R.Found.Add(P->id);
	}
	R.New = Found.Num();
	TheatreResult = R;
}

void ABpTable::TheatreMissed(const FBpScanJob& Job, const FBpScanState& State)
{
	if (CVarTheatre.GetValueOnGameThread() == 0 || !SheetPlan.IsValid()) return;
	// Its run: the job's own, else the run its note names (as a running job's is found).
	FString Run = Job.run_id;
	if (Run.IsEmpty())
	{
		const FString Named = TEXT("bp-job:") + Job.id;
		if (const FBpRun* R = State.Scan.runs.FindByPredicate([&Named](const FBpRun& Each) { return Each.note == Named || Each.note.StartsWith(Named + TEXT(" ")); })) Run = R->id;
	}
	int32 RoomsOf = 0;
	{
		TSet<int32> ScopeRooms;
		const TSet<FString> Want(Job.scope.features);
		const bool bAll = Job.scope.kind == BpVocab::ScanScope::Kind::All;
		for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index)
		{
			if ((bAll || Want.Contains(SheetPlan->tiles[Index].id)) && TileRoom.IsValidIndex(Index) && SheetPlan->rooms.IsValidIndex(TileRoom[Index])) ScopeRooms.Add(TileRoom[Index]);
		}
		RoomsOf = ScopeRooms.Num();
	}
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %s ended (%s) before a read saw it running (run %s): its result anyway"), *Job.id, *Job.status, Run.IsEmpty() ? TEXT("unknown") : *Run);
	// Nothing is followed or said at its start; the result comes from the finished job and its findings, a moment later as a
	// watched scan's does (the store's last rows).
	TheatreBegin(false, Job.id, Job.lens, Job.scope.label.IsEmpty() ? FString(TEXT("Everything")) : Job.scope.label, FString(), RoomsOf, false);
	if (!bTheatre) return;
	bTheatreMissed = true;
	ScanRun = Run;
	bTheatreLamp = false;
	const bool bFailed = Job.status == BpVocab::ScanJob::Status::Failed;
	// The result's time is the job's own (started to ended), not the moment the table learned of it.
	FDateTime Started, Ended;
	const double JobS = FDateTime::ParseIso8601(*(Job.started_at.IsEmpty() ? Job.queued_at : Job.started_at), Started) && FDateTime::ParseIso8601(*Job.ended_at, Ended)
		? FMath::Max(0.0, (Ended - Started).GetTotalSeconds()) : -1.0;
	GetWorldTimerManager().SetTimer(TheatreEndTimer, FTimerDelegate::CreateWeakLambda(this, [this, bFailed, Run, JobS]()
	{
		if (JobS >= 0.0 && GetWorld()) TheatreStartedAt = GetWorld()->GetTimeSeconds() - JobS;
		bool bRunFailed = bFailed;
		const FBpRun* R = Run.IsEmpty() ? nullptr : FBpLinkModule::Get().GetScanState().Scan.runs.FindByPredicate([&Run](const FBpRun& Each) { return Each.id == Run; });
		if (!bFailed && R && (R->status == BpVocab::Run::Status::Failed || R->status == BpVocab::Run::Status::Aborted)) bRunFailed = true;
		if (!Run.IsEmpty()) ScanRun = Run;
		TheatreEnd(false, bRunFailed, false);
	}), 2.f, false);
}

void ABpTable::TheatreEnd(bool bCancelled, bool bFailed, bool bQuiet)
{
	if (!bTheatre) return;
	bTheatre = false;
	bTheatreLamp = false;
	TheatreLampOwed = INDEX_NONE;
	TheatreEndedAt = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	TheatreTint = FLinearColor::White;
	if (bQuiet)
	{
		// The tour's chapter put the table back (its own scan, cancelled): no result to read, nothing said.
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %s ended quietly (the tour put the table back)"), *TheatreKey);
		TheatreVoiceClip.Reset();
		TheatreVoiceSay.Reset();
		LampGoHome(TEXT("scan ended"));
		return;
	}
	FinishTheatreResult(bCancelled, bFailed);
	const FScanResult& R = TheatreResult;
	const TCHAR* RoomWord = R.RoomsRead == 1 ? TEXT("room") : TEXT("rooms");
	FString Line, Clip;
	if (bCancelled || bFailed)
	{
		Line = FString::Printf(TEXT("%s %d of %d %s read."), bFailed ? TEXT("The scan failed.") : TEXT("Stopped."), R.RoomsRead, R.RoomsTotal, R.RoomsTotal == 1 ? TEXT("room") : TEXT("rooms"));
		Clip = TEXT("scan-stopped");
	}
	else
	{
		Line = R.New > 0 ? FString::Printf(TEXT("Done. %d %s read, %d new %s."), R.RoomsRead, RoomWord, R.New, R.New == 1 ? TEXT("finding") : TEXT("findings"))
			: FString::Printf(TEXT("Done. %d %s read, nothing new."), R.RoomsRead, RoomWord);
		Clip = FString::Printf(TEXT("scan-done-%s-%s"), *CountWord(R.RoomsRead), *CountWord(R.New));
		// A count no clip was rendered for: the generic line (its words are the caption's).
		if (bTheatreSample && !FPaths::FileExists(FPaths::ProjectContentDir() / ScanClipDir / (Clip + TEXT(".wav")))) Clip = TEXT("scan-done");
	}
	// Wave U2: a scan that ended before the table saw it run says so first (TheatreMissed).
	if (bTheatreMissed)
	{
		Line = (bFailed ? FString(TEXT("It ended before I could watch: ")) : FString(TEXT("Done before I could watch: here's what it found. "))) + (Line.StartsWith(TEXT("Done. ")) ? Line.Mid(6) : Line);
	}
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: result %s: %s (%d features, %.1f s; stop-ship %d, before release %d, later %d)"), *TheatreKey, *Line, R.Features, R.Seconds, R.Severity[0], R.Severity[1], R.Severity[2]);
	if (!TheatrePersonHasLamp()) SayLamp(Line, true);
	TheatreVoice(bTheatreSample ? Clip : FString(), bTheatreSample ? FString() : Line);
	LampGoHome(TEXT("scan done"));
	OfferScanResult();
}

void ABpTable::OfferScanResult()
{
	bTheatreResult = true;
	bTheatreResultSeen = false;
	ScanBandChanged.Broadcast();
	ABpPawn* Pawn = TheatrePawn(GetWorld());
	if (!Pawn) return;
	// The console opens the sheet unless another sheet holds it (a decision in progress, a talk, settings): then it waits as
	// the bar's chip and on the wrist.
	const FString Page = Pawn->IsConsoleOpen() ? Pawn->GetConsolePage() : FString();
	if (!Pawn->IsConsoleOpen() || Page == TEXT("scan") || Page == TEXT("home") || Page == TEXT("scanresult"))
	{
		Pawn->OpenConsole(TEXT("scanresult"));
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: the result sheet opens"));
	}
	else UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: the result waits on the bar (%s is open): %s"), *Page, *ScanResultChip());
}

void ABpTable::ScanResultSeen()
{
	if (!bTheatreResult || bTheatreResultSeen) return;
	bTheatreResultSeen = true;
	ScanBandChanged.Broadcast();
}

FString ABpTable::ScanResultChip() const
{
	if (!IsScanResultWaiting()) return FString();
	if (TheatreResult.bCancelled || TheatreResult.bFailed) return TheatreResult.bFailed ? TEXT("SCAN FAILED") : TEXT("SCAN STOPPED");
	return TheatreResult.New > 0 ? FString::Printf(TEXT("SCAN DONE · %d NEW"), TheatreResult.New) : FString(TEXT("SCAN DONE · NOTHING NEW"));
}

void ABpTable::ScanResultRaise(const FString& ProposalId)
{
	const FBpProposal* P = FBpLinkModule::Get().GetScanState().Scan.proposals.FindByPredicate([&ProposalId](const FBpProposal& Each) { return Each.id == ProposalId; });
	if (!P) return;
	const FString Room = StandupShow(TEXT("feature"), P->feature, FString());
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: result row %s raises %s"), *ProposalId, Room.IsEmpty() ? TEXT("nothing") : *Room);
}

void ABpTable::OpenFindingInRoom(const FString& ProposalId, const FString& Line)
{
	const FBpProposal* P = FBpLinkModule::Get().GetScanState().Scan.proposals.FindByPredicate([&ProposalId](const FBpProposal& Each) { return Each.id == ProposalId; });
	const FString Room = P ? StandupRoomOf(P->feature) : FString();
	if (!P || Room.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %s has no room on this plan; nothing opens"), *ProposalId);
		if (!Line.IsEmpty()) SayLamp(Line, true);
		return;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %s opens in %s's deck"), *ProposalId, *Room);
	// The lamp's way into a room at a finding (LampAct): already there, the deck turns to it; else the room opens with it in front.
	if (RoomModeId == Room) DeckFocusProposal(P->id, P->feature);
	else
	{
		PendingDeckProposal = P->id;
		PendingDeckFeature = P->feature;
		SwitchRoom(Room, TEXT("result"));
	}
	if (!Line.IsEmpty()) SayLamp(Line, true);
}

bool ABpTable::GetScanReading(FScanReading& Out) const
{
	if (!bTheatre || !SheetPlan.IsValid()) return false;
	Out.Room = SheetPlan->rooms.IsValidIndex(TheatreRoom) ? SheetPlan->rooms[TheatreRoom].name : FString();
	Out.At = TheatreRoomAt;
	Out.Of = TheatreRoomsOf;
	Out.Lens = TheatreLens;
	Out.StartedAt = TheatreStartedAt;
	Out.bSample = bTheatreSample;
	return true;
}

int32 ABpTable::ShownFindings(const FPin& Pin) const
{
	if (PinLandClock < 0.f) return Pin.Findings;
	int32 N = Pin.Findings;
	for (const int32 Tile : Pin.CountTiles)
	{
		// A pin counts once it touches down (the fall's end, before its settle).
		const FPin* Of = PinList.FindByPredicate([Tile](const FPin& P) { return P.Tile == Tile; });
		if (Of && Of->LandDelay >= 0.f && PinLandClock < Of->LandDelay + PinLandS * 0.8f) N -= Of->NewHere;
	}
	return FMath::Max(N, 0);
}

void ABpTable::TickPinCounts()
{
	// The tags' counts as they stand now: a change redraws the tag atlas once (only while pins are in the air).
	FString Key;
	TArray<FString> Ticks;
	for (const FPin& Pin : PinList)
	{
		if (!Pin.bTagged || Pin.Cell == INDEX_NONE) continue;
		const int32 Shown = ShownFindings(Pin);
		Key += FString::Printf(TEXT("%d:%d,"), Pin.Cell, Shown);
		if (Shown != Pin.Findings || PinLandClock < 0.f) Ticks.Add(FString::Printf(TEXT("%s %d/%d"), *Pin.Line1, Shown, Pin.Findings));
	}
	if (Key == PinCountsKey) return;
	const bool bFirst = PinCountsKey.IsEmpty();
	PinCountsKey = Key;
	if (TagAtlas) TagAtlas->UpdateResource();
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: tag counts %s at %.2f s: [%s]"), bFirst ? TEXT("start") : TEXT("tick"), PinLandClock, *FString::Join(Ticks, TEXT(", ")));
}

bool ABpTable::TickScanTheatre(float DeltaSeconds)
{
	// Wave U1, "decisions land": the decided room's highlight flashes up and back over DecisionFlashS (LandDecision).
	bool bFlashing = false;
	if (DecisionFlashAt >= 0.0)
	{
		constexpr double DecisionFlashS = 1.0;
		const double T = (FPlatformTime::Seconds() - DecisionFlashAt) / (DecisionFlashS * FMath::Clamp(CVarLandSlow.GetValueOnGameThread(), 1.f, 40.f));
		DecisionFlash = T >= 1.0 ? 0.f : 2.2f * static_cast<float>(FMath::Sin(UE_PI * FMath::Sqrt(FMath::Clamp(T, 0.0, 1.0))));
		// Wave U2: the game thread's frames over the landing (the frame meter's game_ms is the last frame's GGameThreadTime).
		const float GameMs = static_cast<float>(FPlatformTime::ToMilliseconds(GGameThreadTime));
		DecisionGameMs.Add(GameMs);
		if (T >= 1.0)
		{
			const float First = DecisionGameMs.Num() ? DecisionGameMs[0] : 0.f;
			DecisionGameMs.Sort();
			UE_LOG(LogBpTable, Log, TEXT("BpWow: the landing's frames: game_ms of the answer's frame %.2f, max %.2f, p50 %.2f over %d frames"), First, DecisionGameMs.Num() ? DecisionGameMs.Last() : 0.f,
				DecisionGameMs.Num() ? DecisionGameMs[DecisionGameMs.Num() / 2] : 0.f, DecisionGameMs.Num());
			DecisionGameMs.Reset();
			DecisionFlashAt = -1.0;
			// The room it raised settles back, unless something else is pointed now.
			if (!DecisionFlashRoom.IsEmpty() && HighlightKind == TEXT("room") && HighlightId == DecisionFlashRoom)
			{
				bLandingRaise = true;
				const FString Took = SetHighlightTimed(FString(), FString());
				bLandingRaise = false;
				UE_LOG(LogBpTable, Log, TEXT("BpWow: the decided room settles: %s"), *Took);
			}
			DecisionFlashRoom.Reset();
		}
		AppliedColumnLook = -1.f;
		ApplyColumnLook();
		bFlashing = DecisionFlashAt >= 0.0;
	}
	if (PinLandClock < 0.f) return bFlashing;
	PinLandClock += DeltaSeconds / FMath::Clamp(CVarLandSlow.GetValueOnGameThread(), 1.f, 40.f);
	float Last = 0.f;
	for (const FPin& Pin : PinList) Last = FMath::Max(Last, Pin.LandDelay);
	if (PinLandClock >= Last + PinLandS)
	{
		for (FPin& Pin : PinList) Pin.LandDelay = -1.f;
		PinLandClock = -1.f;
		PlacePins();
		// Every count whole again (and a tag that was waiting drawn at its full count).
		TickPinCounts();
		PinCountsKey.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: landed (the pins rest)"));
		return false;
	}
	PlacePins();
	TickPinCounts();
	return true;
}

float ABpTable::PinLandOffset(const FPin& Pin, float& OutShow) const
{
	OutShow = 1.f;
	if (Pin.LandDelay < 0.f || PinLandClock < 0.f) return 0.f;
	const float T = (PinLandClock - Pin.LandDelay) / PinLandS;
	if (T <= 0.f) { OutShow = 0.f; return PinDropCm; }
	if (T >= 1.f) return 0.f;
	// Ease out with a small settle: it falls, touches, lifts a hair and rests.
	const float Fall = 1.f - FMath::Pow(1.f - FMath::Min(T / 0.8f, 1.f), 3.f);
	const float Settle = T > 0.8f ? FMath::Sin((T - 0.8f) / 0.2f * UE_PI) * 0.06f : 0.f;
	return PinDropCm * (1.f - Fall + Settle);
}

void ABpTable::NoteArrivals(const TArray<int32>& ArrivedTiles)
{
	if (ArrivedTiles.Num() == 0) return;
	int32 Order = 0;
	TArray<FString> Words;
	for (const int32 Tile : ArrivedTiles)
	{
		FPin* Pin = PinList.FindByPredicate([Tile](const FPin& P) { return P.Tile == Tile; });
		if (!Pin || Pin->LandDelay >= 0.f) continue;
		Pin->LandDelay = Order * PinStaggerS;
		Words.Add(FString::Printf(TEXT("%s@%.2fs"), SheetPlan.IsValid() && SheetPlan->tiles.IsValidIndex(Tile) ? *SheetPlan->tiles[Tile].id : TEXT("?"), Pin->LandDelay));
		++Order;
	}
	if (Order == 0) return;
	PinLandClock = 0.f;
	SetActorTickInterval(0.f);
	PlacePins();
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: %d %s landing: %s"), Order, Order == 1 ? TEXT("pin") : TEXT("pins"), *FString::Join(Words, TEXT(", ")));
}

bool ABpTable::LandDecision(const FString& FeatureId, const FString& Verdict)
{
	if (CVarDecisionLands.GetValueOnGameThread() == 0 || TheatreReduced() || !SheetPlan.IsValid() || FeatureId.IsEmpty()) return false;
	// The decided room rises (the pointed room's raised copy, as a hand's point does) when nothing else is pointed, and its
	// edges and glass flash once (TickScanTheatre), pin or not; it settles back as the flash ends.
	const uint32 Cycles0 = FPlatformTime::Cycles();
	const FString Room = StandupRoomOf(FeatureId);
	if (HighlightId.IsEmpty() && !Room.IsEmpty())
	{
		DecisionFlashRoom = Room;
		bLandingRaise = true;
		const FString Took = SetHighlightTimed(TEXT("room"), Room);
		bLandingRaise = false;
		UE_LOG(LogBpTable, Log, TEXT("BpWow: the decided room %s rises: %s"), *Room, *Took);
	}
	DecisionFlashAt = FPlatformTime::Seconds();
	SetActorTickInterval(0.f);
	if (PinLandClock >= 0.f) return false;
	const int32 Tile = SheetPlan->tiles.IndexOfByPredicate([&FeatureId](const auto& Each) { return Each.id == FeatureId; });
	if (Tile == INDEX_NONE) return false;
	// The feature's own pin, else the tagged pin its findings were merged into.
	const FPin* Pin = PinList.FindByPredicate([Tile](const FPin& P) { return P.Tile == Tile; });
	if (!Pin) Pin = PinList.FindByPredicate([Tile](const FPin& P) { return P.CountTiles.Contains(Tile); });
	if (!Pin)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpWow: a decision on %s (%s): no pin stands there; nothing lands"), *FeatureId, *Verdict);
		return false;
	}
	NoteArrivals({ Pin->Tile });
	UE_LOG(LogBpTable, Log, TEXT("BpWow: the decision lands: %s on %s, its pin (%s) drops onto its tile in %.2f s (started in %.3f ms)"), *Verdict, *FeatureId,
		Pin->Line1.IsEmpty() ? TEXT("untagged") : *Pin->Line1, PinLandS, FPlatformTime::ToMilliseconds(FPlatformTime::Cycles() - Cycles0));
	return true;
}

bool ABpTable::LandingsWanted() const
{
	if (bPinsNoLand || !bPinsPrimed || CVarTheatre.GetValueOnGameThread() == 0 || TheatreReduced()) return false;
	if (bTheatre) return true;
	return TheatreEndedAt > 0.0 && GetWorld() && GetWorld()->GetTimeSeconds() - TheatreEndedAt < LandAfterEndS;
}

void ABpTable::LogTheatreLines() const
{
	if (!SheetPlan.IsValid()) return;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	TMap<FString, int32> TileOf;
	for (int32 Index = 0; Index < SheetPlan->tiles.Num(); ++Index) TileOf.Add(SheetPlan->tiles[Index].id, Index);
	// The same pick HoldSampleFindings makes, for a set of rooms.
	const auto Held = [&](const TSet<int32>& Scope)
	{
		TMap<int32, int32> PerRoom;
		TArray<TPair<int32, double>> Sev;
		TArray<int32> RoomOf;
		for (const FBpProposal& P : State.Scan.proposals)
		{
			if (P.status != BpVocab::Proposal::Status::Proposed) continue;
			const int32* Tile = TileOf.Find(P.feature);
			if (!Tile || !TileRoom.IsValidIndex(*Tile) || !Scope.Contains(TileRoom[*Tile])) continue;
			Sev.Add({ ScanSeverity(P, State.Tiers.Find(P.id)), P.risk });
			RoomOf.Add(TileRoom[*Tile]);
		}
		TArray<int32> Order;
		for (int32 I = 0; I < Sev.Num(); ++I) Order.Add(I);
		Order.StableSort([&Sev](int32 A, int32 B) { return Sev[A].Key != Sev[B].Key ? Sev[A].Key < Sev[B].Key : Sev[A].Value > Sev[B].Value; });
		int32 N = 0;
		for (const int32 I : Order)
		{
			if (N >= SampleHeldMax) break;
			int32& In = PerRoom.FindOrAdd(RoomOf[I]);
			if (In >= SampleHeldPerRoom) continue;
			++In;
			++N;
		}
		return N;
	};
	const auto RoomsWhere = [&](TFunctionRef<bool(int32 Room)> Keep)
	{
		TSet<int32> Out;
		for (int32 Tile = 0; Tile < SheetPlan->tiles.Num(); ++Tile) if (TileRoom.IsValidIndex(Tile) && SheetPlan->rooms.IsValidIndex(TileRoom[Tile]) && Keep(TileRoom[Tile])) Out.Add(TileRoom[Tile]);
		return Out;
	};
	TSet<FString> Lines;
	const auto Log = [&](const FString& Scope, const TSet<int32>& In)
	{
		const int32 N = Held(In);
		const FString Id = FString::Printf(TEXT("scan-done-%s-%s"), *CountWord(In.Num()), *CountWord(N));
		Lines.Add(Id);
		UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: lines %s: %d rooms, %d land -> %s"), *Scope, In.Num(), N, *Id);
	};
	Log(TEXT("site"), RoomsWhere([](int32) { return true; }));
	for (const FBpPlanWing& Wing : SheetPlan->wings) Log(Wing.id, RoomsWhere([this, &Wing](int32 Room) { return RoomWing.IsValidIndex(Room) && RoomWing[Room] == Wing.id; }));
	for (int32 Room = 0; Room < SheetPlan->rooms.Num(); ++Room) Log(SheetPlan->rooms[Room].id, RoomsWhere([Room](int32 R) { return R == Room; }));
	UE_LOG(LogBpTable, Log, TEXT("BpScanTheatre: lines needed: %s"), *FString::Join(Lines.Array(), TEXT(" ")));
}
