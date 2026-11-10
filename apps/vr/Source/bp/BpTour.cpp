// The lamp's tour (docs/concepts/vr-light-table/standalone-plan.md S6; BpTable.h declares the API and the constants). The
// competition judges the first five minutes: a cold start must teach the table with no controller and no wall of text, and
// pay off before the headset comes off. So the lamp asks for one act at a time on its caption and waits for it.
//
// Wave T1, the second edition (the owner, 2026-11-10: "Lets run it once, but allow to trigger from the settings menu after";
// "Core + chapters"). The words, the core's steps and the chapters are BpTourBook.cpp's (one table: the captions and the
// clips cannot drift). The core tour: welcome, open-wing, open-room, step-in, decide, back, menu, standup, talk, hand-off;
// it teaches the tap, BACK and MENU (pull and push live in the HANDS AND WRIST chapter). Every step completes on the
// person's act, read from the table's state (a tap, a pull, the pad or the wrist all count); a step left alone for its idle
// wait is shown once by the lamp doing it ("Like this."), never a write, so a watcher who never moves still sees it all.
// A step whose target is missing degrades to a said line and is logged; the tour yields to the consent sheet, a talk and a
// stand-up the person opened, and goes on after. The chapters run from the console's TOUR page and put the table back.
//
// State (FBpStore [/Script/bp.BpTour], written as it happens): Version; Core done@<v> | dismissed@<v>; At <step>@<v> while the
// core tour runs (a quit resumes there); Seen <chapter ids>. The core starts by itself only at a first launch (Core never
// written) or to resume; bp.Tour 1 forces it at every cold start, 0 never.
#include "BpTable.h"

#include "BpAudio.h"
#include "BpLink.h"
#include "BpPawn.h"
#include "BpStore.h"
#include "BpTourBook.h"
#include "Components/AudioComponent.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/App.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundWaveProcedural.h"

namespace
{
	TAutoConsoleVariable<int32> CVarTour(
		TEXT("bp.Tour"),
		-1,
		TEXT("The lamp's first tour at a cold start: -1 once (a first launch, or to resume one a quit interrupted; FBpStore [/Script/bp.BpTour]), 1 at every cold start, 0 never (tests)."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTourVoice(
		TEXT("bp.TourVoice"),
		1,
		TEXT("1: the lamp's tour speaks each step's line in Glim's voice (the bundled clips); 0: captions only."),
		ECVF_Default);

	const TCHAR* const GTourSection = TEXT("/Script/bp.BpTour");
	/** A chapter's idle wait: on demand the person is attentive, and a chapter runs 20 to 30 s. */
	constexpr double ChapterIdleS = 8.0;
	/** The beat on the open MENU, and on a said-only step, before the tour moves to the next step's target. */
	constexpr double TourBeatS = 4.0;

	/** Whether the person is in the app (BpAudio::HasFocus: bp.TourFocus's rule). */
	bool TourHasFocus()
	{
		return BpAudio::HasFocus();
	}

	/** Set by BpTour.Start / BpTour.Chapter before any table has a plan (-ExecCmds at startup). */
	bool GTourAsked = false;
	FString GTourAskedFrom;
	FString GTourAskedChapter;

	void WithTable(UWorld* World, TFunctionRef<void(ABpTable&)> Fn)
	{
		if (!World) return;
		for (TActorIterator<ABpTable> It(World); It; ++It) Fn(**It);
	}

	ABpPawn* PawnOf(const UWorld* World)
	{
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	int32 CvarInt(const TCHAR* Name)
	{
		const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name);
		return Var ? Var->GetInt() : 0;
	}

	float CvarFloat(const TCHAR* Name)
	{
		const IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name);
		return Var ? Var->GetFloat() : 0.f;
	}

	void SetCvar(const TCHAR* Name, const FString& Value)
	{
		if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name)) Var->Set(*Value, ECVF_SetByConsole);
	}

	/** "<id>@<version>" for the store. */
	FString Versioned(const FString& Value) { return FString::Printf(TEXT("%s@%d"), *Value, BpTourBook::Version); }

	FAutoConsoleCommandWithWorldAndArgs CmdTourStart(
		TEXT("BpTour.Start"),
		TEXT("BpTour.Start [step]: the lamp's first tour from its first step, or from that step's id (it waits for the plan when there is none yet)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString From = Args.Num() > 0 ? Args[0] : FString();
			bool bAny = false;
			WithTable(World, [&bAny, &From](ABpTable& Table) { if (Table.HasPlan()) { bAny = true; Table.StartTour(From); } });
			if (!bAny) { GTourAsked = true; GTourAskedFrom = From; GTourAskedChapter.Reset(); UE_LOG(LogBpTable, Log, TEXT("BpTour: start deferred until the plan arrives")); }
		}));

	FAutoConsoleCommandWithWorldAndArgs CmdTourChapter(
		TEXT("BpTour.Chapter"),
		TEXT("BpTour.Chapter <id>: one chapter of the tour (hands, scan, morning, room, talk, text, pc), as its row on the TOUR page starts it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0) { UE_LOG(LogBpTable, Warning, TEXT("BpTour: usage BpTour.Chapter <id>")); return; }
			bool bAny = false;
			WithTable(World, [&bAny, &Args](ABpTable& Table) { if (Table.HasPlan()) { bAny = true; Table.StartChapter(Args[0]); } });
			if (!bAny) { GTourAsked = true; GTourAskedChapter = Args[0]; UE_LOG(LogBpTable, Log, TEXT("BpTour: chapter deferred until the plan arrives")); }
		}));

	FAutoConsoleCommandWithWorld CmdTourStop(
		TEXT("BpTour.Stop"),
		TEXT("Ends the lamp's tour or chapter, as STOP TOUR does (recorded as dismissed)."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			GTourAsked = false;
			WithTable(World, [](ABpTable& Table) { Table.StopTour(TEXT("BpTour.Stop")); });
		}));

	FAutoConsoleCommand CmdTourForget(
		TEXT("BpTour.Forget"),
		TEXT("Forgets the tour's saved state only (the store's [/Script/bp.BpTour] section: done, dismissed, the step in progress, the chapters seen): the next cold start is a first launch for the tour."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FBpStore::EmptySection(GTourSection);
			FBpStore::Flush();
			UE_LOG(LogBpTable, Log, TEXT("BpTour: forgot the tour's saved state (%s)"), GTourSection);
		}));

	FAutoConsoleCommand CmdTourStat(
		TEXT("BpTour.Stat"),
		TEXT("Logs the tour's saved state (Version, Core, At, Seen) and the content version this build carries."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FString Version, Core, At, Seen;
			FBpStore::GetString(GTourSection, TEXT("Version"), Version);
			FBpStore::GetString(GTourSection, TEXT("Core"), Core);
			FBpStore::GetString(GTourSection, TEXT("At"), At);
			FBpStore::GetString(GTourSection, TEXT("Seen"), Seen);
			UE_LOG(LogBpTable, Log, TEXT("BpTour: stat build_version=%d Version=%s Core=%s At=%s Seen=%s"), BpTourBook::Version,
				Version.IsEmpty() ? TEXT("-") : *Version, Core.IsEmpty() ? TEXT("-") : *Core, At.IsEmpty() ? TEXT("-") : *At, Seen.IsEmpty() ? TEXT("-") : *Seen);
		}));
}

FString ABpTable::TourSection()
{
	return GTourSection;
}

TSet<FString> ABpTable::TourSeen()
{
	FString Seen;
	FBpStore::GetString(GTourSection, TEXT("Seen"), Seen);
	TArray<FString> Ids;
	Seen.ParseIntoArray(Ids, TEXT(","));
	return TSet<FString>(Ids);
}

FString ABpTable::TourTitle() const
{
	if (TourStep < 0) return FString();
	const BpTourBook::FChapter* Chapter = TourChapter.IsEmpty() ? nullptr : BpTourBook::FindChapter(TourChapter);
	return Chapter ? FString(Chapter->Title) : FString(TEXT("THE FIRST TOUR"));
}

FString ABpTable::TourProgress() const
{
	return TourStep < 0 ? FString() : FString::Printf(TEXT("%d of %d"), FMath::Min(TourStep + 1, TourSteps.Num()), TourSteps.Num());
}

FString ABpTable::TourCaption(const FString& LineId) const
{
	// The book's words, a sentence a line on the caption (it wraps a long one whole).
	return BpTourBook::Words(LineId).Replace(TEXT(". "), TEXT(".\n"));
}

FString ABpTable::TourColdStart()
{
	FString Core, At;
	FBpStore::GetString(GTourSection, TEXT("Core"), Core);
	FBpStore::GetString(GTourSection, TEXT("At"), At);
	if (!Core.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTour: cold start: the first tour does not start (Core=%s; MENU › TOUR replays it)"), *Core);
		return FString();
	}
	FString Id, Version;
	if (At.Split(TEXT("@"), &Id, &Version) && FCString::Atoi(*Version) == BpTourBook::Version && BpTourBook::Core().ContainsByPredicate([&Id](const TCHAR* S) { return Id == S; }))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTour: cold start: resuming the first tour at %s (a quit interrupted it)"), *Id);
		return Id;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTour: cold start: a first launch (no Core in the store): the first tour starts"));
	return TEXT("welcome");
}

void ABpTable::StartTour()
{
	StartTour(FString());
}

void ABpTable::StartTour(const FString& FromStep)
{
	if (!SheetPlan.IsValid()) { GTourAsked = true; GTourAskedFrom = FromStep; GTourAskedChapter.Reset(); return; }
	if (TourStep >= 0) StopTour(TEXT("another tour"));
	GTourAsked = false;
	bTourPlayed = true;
	TourChapter.Reset();
	TourSteps.Reset();
	for (const TCHAR* Step : BpTourBook::Core()) TourSteps.Add(Step);
	TourProduct = FBpLinkModule::Get().GetProductSlug();
	TourHandAt = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	TourTickAt = TourHandAt;
	FBpStore::SetString(GTourSection, TEXT("Version"), FString::FromInt(BpTourBook::Version));
	const int32 From = FMath::Max(0, TourSteps.IndexOfByKey(FromStep));
	UE_LOG(LogBpTable, Log, TEXT("BpTour: start the first tour on %s at %s (level %d, room mode %s)"), *TourProduct, *TourSteps[From], static_cast<int32>(Level), RoomModeId.IsEmpty() ? TEXT("off") : *RoomModeId);
	// A resumed step finds its situation: deciding and going back happen in a room, so the lamp steps into the most urgent one.
	if ((TourSteps[From] == TEXT("decide") || TourSteps[From] == TEXT("back")) && RoomModeId.IsEmpty())
	{
		const FString Room = TourRoomIn(FString());
		UE_LOG(LogBpTable, Log, TEXT("BpTour: resume: the lamp steps into %s so %s has its situation"), *Room, *TourSteps[From]);
		if (!Room.IsEmpty()) EnterRoomMode(Room);
	}
	EnterTourStep(From);
}

void ABpTable::StartChapter(const FString& ChapterId)
{
	const BpTourBook::FChapter* Chapter = BpTourBook::FindChapter(ChapterId);
	if (!Chapter) { UE_LOG(LogBpTable, Warning, TEXT("BpTour: no chapter %s"), *ChapterId); return; }
	if (!SheetPlan.IsValid()) { GTourAsked = true; GTourAskedChapter = ChapterId; return; }
	if (TourStep >= 0) StopTour(TEXT("another tour"));
	GTourAsked = false;
	bTourPlayed = true;
	ABpPawn* Pawn = PawnOf(GetWorld());
	TourFrom = FTourPlace();
	TourFrom.Level = Level;
	TourFrom.Wing = WingId;
	TourFrom.Room = RoomId;
	TourFrom.RoomMode = RoomModeId;
	TourFrom.bConsoleOpen = Pawn && Pawn->IsConsoleOpen();
	TourFrom.Page = Pawn ? Pawn->GetConsolePage() : FString();
	TourFrom.BpRoom = CvarInt(TEXT("bp.Room"));
	TourFrom.TextSize = CvarFloat(TEXT("bp.TextSize"));
	TourChapter = Chapter->Id;
	TourSteps = BpTourBook::StepsOf(*Chapter);
	TourProduct = FBpLinkModule::Get().GetProductSlug();
	TourHandAt = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	TourTickAt = TourHandAt;
	FBpStore::SetString(GTourSection, TEXT("Version"), FString::FromInt(BpTourBook::Version));
	UE_LOG(LogBpTable, Log, TEXT("BpTour: chapter %s starts (%d steps; from level %d, room mode %s, console %s)"), *TourChapter, TourSteps.Num(), static_cast<int32>(Level),
		RoomModeId.IsEmpty() ? TEXT("off") : *RoomModeId, TourFrom.bConsoleOpen ? *TourFrom.Page : TEXT("bar"));
	EnterTourStep(0);
}

void ABpTable::StopTour(const TCHAR* Why)
{
	if (TourStep < 0) return;
	// Done is finished; a product switch or the end of play interrupts (the step in progress stays for the next cold start);
	// anything else is the person's STOP (STOP TOUR, B, the wrist, BpTour.Stop): dismissed.
	const bool bDone = FCString::Strcmp(Why, TEXT("done")) == 0;
	const bool bInterrupted = FCString::Strcmp(Why, TEXT("another product")) == 0;
	TourEnd(Why, bDone, !bDone && !bInterrupted);
}

void ABpTable::TourEnd(const TCHAR* Why, bool bFinished, bool bDismissed)
{
	const FString Step = TourStepId;
	const FString Chapter = TourChapter;
	UE_LOG(LogBpTable, Log, TEXT("BpTour: %s %s at %s (%s)%s"), Chapter.IsEmpty() ? TEXT("the first tour") : TEXT("chapter"), Chapter.IsEmpty() ? TEXT("ends") : *(Chapter + TEXT(" ends")),
		*Step, Why, bFinished ? TEXT(": finished") : bDismissed ? TEXT(": dismissed") : TEXT(": interrupted"));
	// The step's own highlight goes; one the hands set stays theirs.
	if ((HighlightKind == TEXT("wing") && HighlightId == TourWing) || (HighlightKind == TEXT("room") && (HighlightId == TourRoom || HighlightId == RoomId)))
	{
		SetHighlight(FString(), FString());
	}
	TourMark(FString());
	const int32 At = TourStep, Of = TourSteps.Num();
	TourStep = -1;
	TourStepId.Reset();
	TourLineId.Reset();
	TourYieldWhy.Reset();
	TourBeatAt = -1.0;
	if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
	TourVoiceNext.Reset();
	// The line it kept goes the way any caption goes.
	if (LampLine == TourLine) LampCaptionClock = FMath::Min(LampCaptionClock, 1.5f);
	TourLine.Reset();
	if (Chapter.IsEmpty())
	{
		// A replay stopped half way never undoes a finished tour: done stays done.
		FString Was;
		FBpStore::GetString(GTourSection, TEXT("Core"), Was);
		if (bDismissed && Was.StartsWith(TEXT("done@"))) FBpStore::RemoveKey(GTourSection, TEXT("At"));
		else if (bFinished || bDismissed)
		{
			FBpStore::SetString(GTourSection, TEXT("Core"), Versioned(bFinished ? TEXT("done") : TEXT("dismissed")));
			FBpStore::RemoveKey(GTourSection, TEXT("At"));
			UE_LOG(LogBpTable, Log, TEXT("BpTour: saved Core=%s"), *Versioned(bFinished ? TEXT("done") : TEXT("dismissed")));
		}
	}
	else
	{
		// Seen: finished, or stopped past half way. The NEW chip goes.
		if (bFinished || (bDismissed && At * 2 >= Of))
		{
			TSet<FString> Seen = TourSeen();
			Seen.Add(Chapter);
			FBpStore::SetString(GTourSection, TEXT("Seen"), FString::Join(Seen.Array(), TEXT(",")));
			UE_LOG(LogBpTable, Log, TEXT("BpTour: chapter %s seen"), *Chapter);
		}
		TourPutBack();
	}
	TourChapter.Reset();
	TourSteps.Reset();
	FBpStore::Flush();
}

void ABpTable::TourPutBack()
{
	ABpPawn* Pawn = PawnOf(GetWorld());
	TArray<FString> Did;
	// What the lamp itself changed goes back; a choice the person made stays theirs.
	if (TourFrom.bLampScan && IsScanRunning() && FBpLinkModule::Get().IsFromBundle() && Pawn) { Pawn->PanelAct(TEXT("job:cancel:sample")); Did.Add(TEXT("the sample scan cancelled")); }
	if (CvarInt(TEXT("bp.Room")) != TourFrom.BpRoom && (TourFrom.bLampRoom || TourChapter == TEXT("room"))) { SetCvar(TEXT("bp.Room"), FString::FromInt(TourFrom.BpRoom)); Did.Add(TEXT("the room switch")); }
	if (TourFrom.bLampText && !FMath::IsNearlyEqual(CvarFloat(TEXT("bp.TextSize")), TourFrom.TextSize)) { SetCvar(TEXT("bp.TextSize"), FString::SanitizeFloat(TourFrom.TextSize)); Did.Add(TEXT("the text size")); }
	if (RoomModeId != TourFrom.RoomMode || Level != TourFrom.Level || (Level != EBpLevel::L0 && WingId != TourFrom.Wing) || (Level == EBpLevel::L2 && RoomId != TourFrom.Room))
	{
		if (!TourFrom.RoomMode.IsEmpty()) EnterRoomMode(FString(TourFrom.RoomMode));
		else
		{
			Home();
			if (TourFrom.Level == EBpLevel::L1) EnterWing(TourFrom.Wing);
			else if (TourFrom.Level == EBpLevel::L2) EnterRoom(TourFrom.Room);
		}
		Did.Add(TEXT("the table's place"));
	}
	if (Pawn)
	{
		if (TourFrom.bConsoleOpen) { Pawn->OpenConsole(TourFrom.Page); Did.Add(TEXT("the console on ") + TourFrom.Page); }
		else if (Pawn->IsConsoleOpen()) { Pawn->CloseConsole(); Did.Add(TEXT("the console to its bar")); }
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTour: put back: %s"), Did.Num() ? *FString::Join(Did, TEXT(", ")) : TEXT("nothing had moved"));
}

FString ABpTable::GetTourLine() const
{
	return TourStep < 0 ? FString() : FString::Printf(TEXT("%s %s %s"), TourChapter.IsEmpty() ? TEXT("core") : *TourChapter, *TourStepId, bTourShown ? TEXT("shown") : TEXT("waiting"));
}

void ABpTable::TourMark(const FString& ConsoleId)
{
	if (ABpPawn* Pawn = PawnOf(GetWorld())) Pawn->SetConsoleMark(ConsoleId);
}

void ABpTable::TourLookAtConsole(const FString& ConsoleId)
{
	// The lamp turns to the control the step asks for (it stays home: going there would stand it over the bar).
	const ABpPawn* Pawn = PawnOf(GetWorld());
	FVector World;
	if (!Pawn || !Pawn->ConsoleAim(ConsoleId, World)) return;
	LampLookAt = GetActorTransform().InverseTransformPosition(World);
	LampLookTarget = 1.f;
	SetActorTickInterval(0.f);
}

FString ABpTable::TourYields() const
{
	// Overlay precedence: what the person opened or is doing comes first; the tour waits behind it and goes on after.
	const ABpPawn* Pawn = PawnOf(GetWorld());
	const bool bTalkStep = TourStepId == TEXT("talk") || TourStepId == TEXT("talk-hold");
	if (!bTalkStep && !TalkStateWord().IsEmpty()) return TEXT("a talk with the lamp");
	if (Pawn && Pawn->IsConsoleOpen() && Pawn->GetConsolePage() == TEXT("talk") && !bTalkStep && TourStepId != TEXT("talk-where")) return TEXT("the consent sheet");
	const bool bMorningStep = TourStepId == TEXT("standup") || TourChapter == TEXT("morning");
	if (Pawn && Pawn->IsConsoleOpen() && Pawn->GetConsolePage() == TEXT("standup") && !bMorningStep) return TEXT("the stand-up the person opened");
	return FString();
}

void ABpTable::NoteHand(const TCHAR* Kind)
{
	if (const UWorld* World = GetWorld()) TourHandAt = World->GetTimeSeconds();
	if (TourStep < 0) return;
	if (FCString::Strcmp(Kind, TEXT("tap")) == 0) ++TourTaps;
	UE_LOG(LogBpTable, Verbose, TEXT("BpTour: hand %s at %s"), Kind, *TourStepId);
}

FString ABpTable::TourRoomIn(const FString& InWingId) const
{
	for (const FRoomRank& Rank : RoomsByUrgency())
	{
		const FBpPlanRoom* Room = FindRoom(Rank.Id);
		if (Room && (InWingId.IsEmpty() || Room->parentId == InWingId)) return Rank.Id;
	}
	return FString();
}

FString ABpTable::TourFeatureIn(const FString& InRoomId) const
{
	if (!SheetPlan.IsValid()) return FString();
	const FBpPlan& Plan = *SheetPlan;
	const int32 RoomIndex = Plan.rooms.IndexOfByPredicate([&InRoomId](const FBpPlanRoom& R) { return R.id == InRoomId; });
	if (RoomIndex == INDEX_NONE) return FString();
	TMap<FString, int32> Open;
	for (const FBpProposal& Proposal : FBpLinkModule::Get().GetScanState().Scan.proposals)
	{
		if (Proposal.status == TEXT("proposed")) ++Open.FindOrAdd(Proposal.feature);
	}
	FString Best;
	int32 BestOpen = -1;
	for (int32 Tile = 0; Tile < Plan.tiles.Num(); ++Tile)
	{
		if (!TileRoom.IsValidIndex(Tile) || TileRoom[Tile] != RoomIndex) continue;
		const int32 N = Open.FindRef(Plan.tiles[Tile].id);
		if (N > BestOpen) { BestOpen = N; Best = Plan.tiles[Tile].id; }
	}
	return Best;
}

void ABpTable::SayTour(const FString& Line)
{
	TourLine = Line;
	SayLamp(Line, true);
}

void ABpTable::SpeakTour(const TCHAR* Clip)
{
	if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
	TourVoiceClip = Clip;
	TourVoiceNext.Reset();
	if (CVarTourVoice.GetValueOnGameThread() == 0) return;
	TArray<uint8>* File = TourClips.Find(Clip);
	if (!File)
	{
		File = &TourClips.Add(Clip);
		const FString Path = FPaths::ProjectContentDir() / TEXT("BpData/voice/tour") / (FString(Clip) + TEXT(".wav"));
		if (!FFileHelper::LoadFileToArray(*File, *Path, FILEREAD_Silent)) UE_LOG(LogBpTable, Log, TEXT("BpTour: no voice clip %s (captions only)"), *Path);
	}
	PlayVoiceWav(*File, Clip);
}

bool ABpTable::PlayVoiceWav(const TArray<uint8>& WavFile, const TCHAR* Clip)
{
	const TArray<uint8>* File = &WavFile;
	int32 Rate = 0, Channels = 0, Offset = 0, Bytes = 0;
	if (File->Num() == 0 || !BpAudio::ReadWav(*File, Rate, Channels, Offset, Bytes) || Channels < 1) return false;
	if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
	TourVoiceClip = Clip;
	// A procedural wave drains as it plays, so each line gets a new one, fed the clip's samples.
	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
	Wave->SetSampleRate(Rate);
	Wave->NumChannels = Channels;
	Wave->Duration = static_cast<float>(Bytes) / (2.f * Channels * Rate);
	Wave->SoundGroup = SOUNDGROUP_Voice;
	Wave->bLooping = false;
	// The clip at the level (bp.VoiceLevel: twice the level as gain), limited sample by sample: a gain over 1 must not clip.
	TourVoiceGain = BpAudio::VoiceGain();
	TArray<uint8> Scaled;
	Scaled.SetNumUninitialized(Bytes);
	for (int32 At = 0; At + 1 < Bytes; At += 2)
	{
		const int16 In = static_cast<int16>(File->GetData()[Offset + At] | (File->GetData()[Offset + At + 1] << 8));
		const float Out = BpAudio::LimitSample(static_cast<float>(In) / 32768.f * TourVoiceGain);
		const int16 Sample = static_cast<int16>(FMath::Clamp(FMath::RoundToInt(Out * 32767.f), -32768, 32767));
		Scaled[At] = static_cast<uint8>(Sample & 0xFF);
		Scaled[At + 1] = static_cast<uint8>((Sample >> 8) & 0xFF);
	}
	Wave->QueueAudio(Scaled.GetData(), Bytes);
	if (!TourVoiceFalloff)
	{
		// Heard from the lamp: spatialized, full within three metres, so a seated person never loses it to distance.
		TourVoiceFalloff = NewObject<USoundAttenuation>(this);
		TourVoiceFalloff->Attenuation.bAttenuate = true;
		TourVoiceFalloff->Attenuation.bSpatialize = true;
		TourVoiceFalloff->Attenuation.AttenuationShape = EAttenuationShape::Sphere;
		TourVoiceFalloff->Attenuation.AttenuationShapeExtents = FVector(300.f, 0.f, 0.f);
		TourVoiceFalloff->Attenuation.FalloffDistance = 400.f;
	}
	FVector Head;
	if (!LampHead(Head)) Head = GetActorTransform().TransformPosition(FVector(CaptionXCm, CaptionYCm, PlacedHeightCm + CaptionAboveTopCm));
	TourVoiceEndsAt = (GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0) + Wave->Duration + 0.15;
	TourVoice = UGameplayStatics::SpawnSoundAtLocation(this, Wave, Head, FRotator::ZeroRotator, 1.f, 1.f, 0.f, TourVoiceFalloff);
	// How the line reaches the ear, measured here: the listener (the seat's eye), the sphere's attenuation at that distance,
	// and the platform's headroom (Config/Android/AndroidEngine.ini holds the Quest's at 0).
	float SeatDistCm = -1.f, Attenuation = -1.f;
	const FVector Ear = GetWorld() && GetWorld()->GetFirstPlayerController() && GetWorld()->GetFirstPlayerController()->GetPawn() ? GetWorld()->GetFirstPlayerController()->GetPawn()->GetPawnViewLocation() : FVector::ZeroVector;
	if (!Ear.IsZero())
	{
		SeatDistCm = FVector::Dist(Ear, Head);
		Attenuation = TourVoiceFalloff->Attenuation.AttenuationEval(FMath::Max(0.f, SeatDistCm - static_cast<float>(TourVoiceFalloff->Attenuation.AttenuationShapeExtents.X)), TourVoiceFalloff->Attenuation.FalloffDistance, 1.f);
	}
	float HeadroomDb = 0.f;
	if (GConfig) GConfig->GetFloat(TEXT("Audio"), TEXT("PlatformHeadroomDB"), HeadroomDb, GEngineIni);
	UE_LOG(LogBpTable, Log, TEXT("BpTour: says %s (%.1f s) level=%.2f dist_cm=%.0f attenuation=%.2f headroom_db=%.0f%s"), Clip, Wave->Duration, TourVoiceGain, SeatDistCm, Attenuation, HeadroomDb, TourVoice.IsValid() ? TEXT("") : TEXT(", no audio device: silent"));
	return true;
}

void ABpTable::StopVoice()
{
	if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
	TourVoiceEndsAt = 0.0;
	TourVoiceNext.Reset();
}

bool ABpTable::IsVoicePlaying() const
{
	const UAudioComponent* Voice = TourVoice.Get();
	return Voice && Voice->IsPlaying() && GetWorld() && GetWorld()->GetTimeSeconds() < TourVoiceEndsAt;
}

void ABpTable::PreviewVoice()
{
	// The line that is playing, from the start at the new level; else the lamp's "Like this."
	if (IsVoicePlaying() && !TourVoiceClip.IsEmpty())
	{
		const FString Clip = TourVoiceClip;
		SpeakTour(*Clip);
		return;
	}
	SpeakTour(TEXT("shown"));
}

void ABpTable::EnterTourStep(int32 Step)
{
	const double Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	TourStep = Step;
	TourStepAt = Now;
	bTourShown = false;
	TourAsks = 0;
	TourTaps = 0;
	TourBeatAt = -1.0;
	if (Step >= TourSteps.Num()) { StopTour(TEXT("done")); return; }
	TourStepId = TourSteps[Step];
	// The core tour writes where it is as each step begins: a quit resumes here at the next cold start.
	if (TourChapter.IsEmpty())
	{
		FBpStore::SetString(GTourSection, TEXT("At"), Versioned(TourStepId));
		FBpStore::Flush();
	}
	EnterTourId(TourStepId);
}

void ABpTable::TourNext(const TCHAR* How)
{
	UE_LOG(LogBpTable, Log, TEXT("BpTour: %s completed by %s (%.1f s)"), *TourStepId, How, GetWorld() ? GetWorld()->GetTimeSeconds() - TourStepAt : 0.0);
	EnterTourStep(TourStep + 1);
}

void ABpTable::EnterTourId(const FString& Id)
{
	const FBpPlan& Plan = *SheetPlan;
	ABpPawn* Pawn = PawnOf(GetWorld());
	const bool bBundle = FBpLinkModule::Get().IsFromBundle();
	FString LineId = Id;
	TourMark(FString());
	// The situation each step teaches in: the target lit, the page open, the lamp beside it or turned to it.
	if (Id == TEXT("open-wing") || Id == TEXT("hands-pull"))
	{
		if (Id == TEXT("hands-pull"))
		{
			if (Pawn) Pawn->CloseConsole();
			if (Level != EBpLevel::L0 || !RoomModeId.IsEmpty()) Home();
		}
		TourRoom = TourRoomIn(FString());
		const FBpPlanRoom* Room = FindRoom(TourRoom);
		TourWing = Room ? Room->parentId : (Plan.wings.Num() > 0 ? Plan.wings[0].id : FString());
		SetHighlight(TEXT("wing"), TourWing);
		if (const FBpPlanWing* Wing = FindWing(TourWing)) PresentLamp(WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(PlanToPaperCm(FVector2D(Wing->box.x + Wing->box.w * 0.5, Wing->box.y + Wing->box.h * 0.5)), 0.f)), TEXT("tour"));
	}
	else if (Id == TEXT("open-room"))
	{
		TourWing = WingId.IsEmpty() ? TourWing : WingId;
		TourRoom = TourRoomIn(TourWing);
		SetHighlight(TEXT("room"), TourRoom);
		PresentLamp(LampTargetForRoom(TourRoom), TEXT("tour"));
	}
	else if (Id == TEXT("step-in"))
	{
		SetHighlight(TEXT("room"), RoomId);
		PresentLamp(LampTargetForRoom(!RoomId.IsEmpty() ? RoomId : TourRoom), TEXT("tour"));
	}
	else if (Id == TEXT("decide"))
	{
		SetHighlight(FString(), FString());
		LampLookAt = DeckPose(0.f, 0.f).GetLocation();
		LampLookTarget = 1.f;
		SetActorTickInterval(0.f);
	}
	else if (Id == TEXT("back"))
	{
		bTourBackFromRoom = !RoomModeId.IsEmpty();
		TourBackFromLevel = Level;
		LampGoHome(TEXT("tour"));
		TourMark(TEXT("console:bar:back"));
		TourLookAtConsole(TEXT("console:bar:back"));
	}
	else if (Id == TEXT("menu"))
	{
		TourMark(TEXT("console:menu"));
		TourLookAtConsole(TEXT("console:menu"));
	}
	else if (Id == TEXT("standup") || Id == TEXT("morning-decide"))
	{
		// The morning's first decision on the console, its room raised on the plan: the person answers it (APPROVE or LATER, a
		// pinch or A twice); nothing is answered for them. No stand-up to open: said, and skipped after a beat (logged).
		TourStandupFrom = FPlatformTime::Seconds();
		const bool bOpen = Pawn && Pawn->OpenStandupForTour();
		UE_LOG(LogBpTable, Log, TEXT("BpTour: the stand-up %s on its first decision"), bOpen ? TEXT("opens") : TEXT("could not open"));
		if (!bOpen)
		{
			LineId = TEXT("standup-none");
			TourBeatAt = TourStepAt;
			UE_LOG(LogBpTable, Log, TEXT("BpTour: skip %s: no stand-up here (said instead)"), *Id);
		}
	}
	else if (Id == TEXT("talk") || Id == TEXT("talk-hold"))
	{
		// The conversation takes the console's panel: the stand-up the tour opened gives it back first.
		if (Pawn && Pawn->IsConsoleOpen()) Pawn->CloseConsole();
		TourHoldsAt = TalkHoldsCounted;
		LampGoHome(TEXT("tour"));
	}
	else if (Id == TEXT("hand-off"))
	{
		if (Pawn && Pawn->IsConsoleOpen() && Pawn->GetConsolePage() == TEXT("standup")) Pawn->CloseConsole();
		LampGoHome(TEXT("tour"));
	}
	else if (Id == TEXT("hands-push"))
	{
		LampGoHome(TEXT("tour"));
	}
	else if (Id == TEXT("scan-arm"))
	{
		if (Pawn) Pawn->OpenConsole(TEXT("scan"));
		TourMark(TEXT("console:scan:this"));
	}
	else if (Id == TEXT("room-switch") || Id == TEXT("room-back"))
	{
		if (Pawn && Pawn->IsConsoleOpen()) Pawn->CloseConsole();
		TourMark(TEXT("console:toggle:room"));
		TourLookAtConsole(TEXT("console:toggle:room"));
	}
	else if (Id == TEXT("talk-where"))
	{
		if (Pawn) Pawn->OpenConsole(TEXT("talk"));
	}
	else if (Id == TEXT("talk-choice"))
	{
		if (Pawn) Pawn->OpenConsole(TEXT("settings"));
		TourMark(TalkConsent() == 1 ? TEXT("console:talk:off") : TEXT("console:open:talk"));
	}
	else if (Id == TEXT("text-size"))
	{
		if (Pawn) Pawn->OpenConsole(TEXT("access"));
		TourMark(TEXT("console:set:text:1.3"));
	}
	else if (Id == TEXT("pc-what"))
	{
		if (Pawn) Pawn->OpenConsole(TEXT("link"));
		// Missing target: no PC here, so the lamp says what the sample stands in for.
		if (bBundle) LineId = TEXT("pc-sample");
	}
	else if (Id == TEXT("pc-pair"))
	{
		TourMark(TEXT("console:link:pair"));
	}
	TourLineId = LineId;
	UE_LOG(LogBpTable, Log, TEXT("BpTour: step %s (%s, %s)%s"), *Id, TourChapter.IsEmpty() ? TEXT("the first tour") : *TourChapter, *TourProgress(), LineId != Id ? *(TEXT(" says ") + LineId) : TEXT(""));
	SayTour(TourCaption(LineId));
	// The lamp's "Like this." finishes before the next line; any other line is cut by the next.
	const UAudioComponent* Voice = TourVoice.Get();
	if (Voice && TourStepAt < TourVoiceEndsAt && TourVoiceClip == TEXT("shown")) TourVoiceNext = LineId;
	else SpeakTour(*LineId);
}

void ABpTable::TickTour()
{
	const UWorld* World = GetWorld();
	if (!World || !SheetPlan.IsValid()) return;
	const double Now = World->GetTimeSeconds();
	FBpLinkModule& Link = FBpLinkModule::Get();
	// A line's samples are done: its component stops (a procedural wave would play silence on), tour or not (a preview of
	// the level plays outside the tour); a level changed mid-line (the wrist, adb) restarts that line at it.
	if (UAudioComponent* Voice = TourVoice.Get(); Voice && Voice->IsPlaying())
	{
		if (Now >= TourVoiceEndsAt) Voice->Stop();
		else if (TourVoiceGain >= 0.f && !FMath::IsNearlyEqual(TourVoiceGain, BpAudio::VoiceGain(), 0.01f)) PreviewVoice();
	}
	// Away (no focus): nothing advances. A cold start counts its delay from the focus; a running step holds.
	if (!TourHasFocus())
	{
		TourPlanAt = Now;
		if (TourStep >= 0 && !bTourAway)
		{
			bTourAway = true;
			TourAwayAt = Now;
			if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
			TourVoiceNext.Reset();
			UE_LOG(LogBpTable, Log, TEXT("BpTour: paused at %s (the app lost its focus)"), *TourStepId);
		}
		return;
	}
	if (bTourAway)
	{
		bTourAway = false;
		const double Away = Now - TourAwayAt;
		TourStepAt += Away;
		TourHandAt += Away;
		if (TourBeatAt >= 0.0) TourBeatAt += Away;
		UE_LOG(LogBpTable, Log, TEXT("BpTour: resumed at %s after %.1f s away"), *TourStepId, Away);
		if (TourStep >= 0)
		{
			SayTour(TourLine);
			SpeakTour(*TourLineId);
		}
	}
	// Not running: the cold start's tour, once the plan has stood TourStartDelayS (the build-up and the seat go first). It is
	// decided once a launch: a first launch or a resume (FBpStore), bp.Tour 1 always, 0 never.
	if (TourStep < 0)
	{
		if (TourPlanAt < 0.0) TourPlanAt = Now;
		if (Now - TourPlanAt < TourStartDelayS) return;
		if (GTourAsked)
		{
			if (!GTourAskedChapter.IsEmpty()) StartChapter(FString(GTourAskedChapter));
			else StartTour(FString(GTourAskedFrom));
			return;
		}
		if (bTourPlayed) return;
		bTourPlayed = true;
		const int32 Mode = CVarTour.GetValueOnGameThread();
		if (Mode == 0) { UE_LOG(LogBpTable, Log, TEXT("BpTour: cold start: bp.Tour 0, the first tour never starts by itself")); return; }
		if (Mode > 0) { UE_LOG(LogBpTable, Log, TEXT("BpTour: cold start: bp.Tour 1 forces the first tour")); StartTour(FString()); return; }
		const FString From = TourColdStart();
		if (!From.IsEmpty()) StartTour(From);
		return;
	}
	if (Link.GetProductSlug() != TourProduct) { StopTour(TEXT("another product")); return; }
	const double Dt = FMath::Max(0.0, Now - TourTickAt);
	TourTickAt = Now;
	// Overlay precedence: something more urgent is up; the step's clocks hold until it is done, then it goes on.
	const FString Yield = TourYields();
	if (Yield != TourYieldWhy)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTour: %s %s at %s"), Yield.IsEmpty() ? TEXT("goes on after") : TEXT("yields to"), Yield.IsEmpty() ? *TourYieldWhy : *Yield, *TourStepId);
		TourYieldWhy = Yield;
	}
	if (!Yield.IsEmpty())
	{
		TourStepAt += Dt;
		TourHandAt += Dt;
		if (TourBeatAt >= 0.0) TourBeatAt += Dt;
		return;
	}
	// A line's samples are done (the top of this tick stopped it): a waiting line speaks.
	if (Now >= TourVoiceEndsAt && !TourVoiceNext.IsEmpty()) SpeakTour(*FString(TourVoiceNext));

	ABpPawn* Pawn = PawnOf(World);
	const double InStep = Now - TourStepAt;
	const bool bChapter = !TourChapter.IsEmpty();
	const double IdleS = bChapter ? ChapterIdleS : static_cast<double>(TourIdleS);
	const bool bIdle = Now - FMath::Max(TourHandAt, TourStepAt) >= IdleS;
	const bool bActed = TourHandAt > TourStepAt + 0.5;
	const bool bInRoom = !RoomModeId.IsEmpty();
	const FString& Id = TourStepId;
	const auto Show = [this](const TCHAR* What)
	{
		bTourShown = true;
		UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: %s"), What);
		SpeakTour(TEXT("shown"));
	};
	const auto Jump = [this](const TCHAR* ToId, const TCHAR* How)
	{
		const int32 To = TourSteps.IndexOfByKey(FString(ToId));
		if (To == INDEX_NONE || To == TourStep) return;
		UE_LOG(LogBpTable, Log, TEXT("BpTour: %s %s; on to %s"), *TourStepId, How, ToId);
		EnterTourStep(To);
	};
	// The steps that open the table: the one that fits where the table is now, whatever the hands did.
	const TCHAR* Fit = bInRoom ? TEXT("decide") : Level == EBpLevel::L2 ? TEXT("step-in") : Level == EBpLevel::L1 ? TEXT("open-room") : TEXT("open-wing");

	if (Id == TEXT("welcome"))
	{
		if (InStep >= TourWelcomeS || Level != EBpLevel::L0 || bInRoom) { TourNext(Level != EBpLevel::L0 || bInRoom ? TEXT("the person moving on") : TEXT("its welcome beat")); return; }
	}
	else if (Id == TEXT("open-wing") || Id == TEXT("open-room") || Id == TEXT("step-in"))
	{
		const int32 Want = TourSteps.IndexOfByKey(FString(Fit));
		if (Want > TourStep) { UE_LOG(LogBpTable, Log, TEXT("BpTour: %s completed by %s (%.1f s)"), *Id, bTourShown ? TEXT("the lamp (shown)") : TEXT("the person"), InStep); EnterTourStep(Want); return; }
		if (Want < TourStep) { Jump(Fit, TEXT("went back a level")); return; }
		if (Id == TEXT("open-room") && WingId != TourWing) { EnterTourStep(TourStep); return; }
		if (bIdle && !bTourShown)
		{
			if (Id == TEXT("open-wing")) { Show(TEXT("open the wing")); EnterWing(TourWing); }
			else if (Id == TEXT("open-room") && !TourRoom.IsEmpty()) { Show(TEXT("open the room")); EnterRoom(TourRoom); }
			else if (Id == TEXT("step-in")) { Show(TEXT("step inside")); EnterRoomMode(FString(RoomId)); }
		}
	}
	else if (Id == TEXT("decide"))
	{
		// Left the room: going back is learned already.
		if (!bInRoom) { Jump(TEXT("menu"), TEXT("left the room (BACK done)")); return; }
		// A decision is never taken for the person: a tap moves on, and so does a long wait. Offline the tap writes nothing
		// (BpLink refuses every write on the bundle), so the lamp says so rather than leave the deck's move unexplained.
		if (TourTaps > 0 && TourBeatAt < 0.0)
		{
			TourBeatAt = Now;
			if (Link.IsFromBundle()) { TourLineId = TEXT("decide-noted"); SayTour(TourCaption(TourLineId)); SpeakTour(*TourLineId); }
			return;
		}
		if (TourBeatAt >= 0.0 && Now - TourBeatAt >= (Link.IsFromBundle() ? 3.0 : 1.5)) { TourNext(TEXT("a tap on the deck")); return; }
		if (TourBeatAt < 0.0 && InStep >= TourIdleS * 2.0 && bIdle) { TourNext(TEXT("the long wait (never decided for the person)")); return; }
	}
	else if (Id == TEXT("back"))
	{
		const bool bUp = bTourBackFromRoom ? !bInRoom : static_cast<int32>(Level) < static_cast<int32>(TourBackFromLevel);
		if (!bTourBackFromRoom && TourBackFromLevel == EBpLevel::L0) { TourNext(TEXT("a skip (nothing to go back from)")); return; }
		if (bUp) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person going up a level")); return; }
		if (bIdle && !bTourShown) { Show(TEXT("press BACK")); Back(); }
	}
	else if (Id == TEXT("menu"))
	{
		const bool bOpen = Pawn && Pawn->IsConsoleOpen();
		if (bOpen && TourBeatAt < 0.0)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTour: menu completed by %s (%.1f s); a beat on the open MENU"), bTourShown ? TEXT("the lamp (shown)") : TEXT("the person"), InStep);
			TourBeatAt = Now;
			TourMark(FString());
			TourLineId = TEXT("menu-open");
			SayTour(TourCaption(TourLineId));
			if (TourVoiceClip == TEXT("shown") && Now < TourVoiceEndsAt) TourVoiceNext = TourLineId; else SpeakTour(*TourLineId);
			return;
		}
		if (TourBeatAt >= 0.0 && Now - TourBeatAt >= TourBeatS) { EnterTourStep(TourStep + 1); return; }
		if (bIdle && !bTourShown && !bOpen) { Show(TEXT("open the MENU")); Pawn->OpenConsole(FString()); }
	}
	else if (Id == TEXT("standup") || Id == TEXT("morning-decide"))
	{
		if (TourBeatAt >= 0.0) { if (Now - TourBeatAt >= TourBeatS) TourNext(TEXT("a skip (no stand-up here)")); return; }
		// The person answers the card (a pinch on APPROVE or LATER, or A twice). Never answered for them: a long wait says how
		// once, and a much longer one (or the console closed) moves on without an answer.
		if (Pawn && Pawn->StandupAnsweredSince(TourStandupFrom))
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTour: the person decided on the stand-up: %s"), *Pawn->StandupLastVerdictWords());
			TourNext(TEXT("the person's answer"));
			return;
		}
		if (!Pawn || (!Pawn->IsStandupOpen() && InStep >= 2.0)) { TourNext(TEXT("the stand-up closed")); return; }
		if (InStep >= IdleS * 3.0) { TourNext(TEXT("the long wait (never answered for the person)")); return; }
		if (bIdle && !bTourShown && InStep >= IdleS * 1.5)
		{
			bTourShown = true;
			UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: how to answer the stand-up's card"));
			TourLineId = TEXT("standup-how");
			SayTour(TourCaption(TourLineId));
			SpeakTour(*TourLineId);
		}
	}
	else if (Id == TEXT("talk") || Id == TEXT("talk-hold"))
	{
		// Done on a hold (bundle: the sample exchange; linked: the consent sheet as any first hold, or the talk itself), once
		// the talk and the sheet are over. Idle: the lamp plays the labelled sample exchange.
		const bool bHeld = TalkHoldsCounted > TourHoldsAt;
		const bool bBusy = !TalkStateWord().IsEmpty() || (Pawn && Pawn->IsConsoleOpen() && Pawn->GetConsolePage() == TEXT("talk"));
		// The exchange gets its moment on show even when its voice ends early (no audio device): 4 s from the hold or the show.
		if ((bHeld || bTourShown) && TourBeatAt < 0.0) TourBeatAt = Now;
		if ((bHeld || bTourShown) && !bBusy && TourBeatAt >= 0.0 && Now - TourBeatAt >= 4.0) { TourNext(bHeld ? TEXT("a hold") : TEXT("the lamp (shown: the sample exchange)")); return; }
		if (bIdle && !bTourShown && !bHeld && !bBusy)
		{
			bTourShown = true;
			UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: the sample exchange"));
			TalkShowSample();
		}
	}
	else if (Id == TEXT("hand-off"))
	{
		if (InStep >= LampCaptionS + 1.0) { StopTour(TEXT("done")); return; }
	}
	else if (Id == TEXT("hands-pull"))
	{
		if (Level != EBpLevel::L0 || bInRoom) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person opening a wing")); return; }
		if (bIdle && !bTourShown) { Show(TEXT("pull the wing")); EnterWing(TourWing); }
	}
	else if (Id == TEXT("hands-push"))
	{
		if (Level == EBpLevel::L0 && !bInRoom) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person going back out")); return; }
		if (bIdle && !bTourShown) { Show(TEXT("push away")); Back(); }
	}
	else if (Id == TEXT("scan-arm"))
	{
		if (IsScanRunning()) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person starting a scan")); return; }
		if (bIdle && !bTourShown)
		{
			if (Link.IsFromBundle() && Pawn)
			{
				// Arm now, start a second later: a second press sooner is taken for the first one bouncing (WristConfirmGuardS).
				Show(TEXT("arm and start the sample scan"));
				TourFrom.bLampScan = true;
				TourBeatAt = Now;
				Pawn->PanelAct(TEXT("scan:this"));
			}
			else { bTourShown = true; UE_LOG(LogBpTable, Log, TEXT("BpTour: scan-arm said only (a scan on your PC is the person's to start)")); TourNext(TEXT("a skip (said only)")); return; }
		}
		if (bTourShown && TourBeatAt >= 0.0 && Now - TourBeatAt >= 1.0 && Pawn) { TourBeatAt = -1.0; Pawn->PanelAct(TEXT("scan:this")); }
		if (bTourShown && InStep >= IdleS * 2.0) { TourNext(TEXT("a skip (the scan did not start)")); return; }
	}
	else if (Id == TEXT("room-switch") || Id == TEXT("room-back"))
	{
		const bool bDone = Id == TEXT("room-switch") ? CvarInt(TEXT("bp.Room")) != TourFrom.BpRoom : CvarInt(TEXT("bp.Room")) == TourFrom.BpRoom;
		if (bDone) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person's switch")); return; }
		if (bIdle && !bTourShown && Pawn) { Show(TEXT("the room switch")); TourFrom.bLampRoom = true; Pawn->PanelAct(TEXT("toggle:room")); }
	}
	else if (Id == TEXT("text-size"))
	{
		if (!FMath::IsNearlyEqual(CvarFloat(TEXT("bp.TextSize")), TourFrom.TextSize)) { TourNext(bTourShown ? TEXT("the lamp (shown)") : TEXT("the person's choice")); return; }
		if (bIdle && !bTourShown && Pawn) { Show(TEXT("130%")); TourFrom.bLampText = true; Pawn->PanelAct(TEXT("set:text:1.3")); }
	}
	else
	{
		// A step that shows a page (hands-wrist, scan-watch, morning-plan, morning-hand, talk-where, talk-choice, text-more,
		// pc-what, pc-pair): any act of the person moves on; left alone, the lamp moves on after the idle wait.
		if (bActed) { TourNext(TEXT("the person acting")); return; }
		if (bIdle) { UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: the lamp moves on from %s"), *Id); TourNext(TEXT("the lamp (shown)")); return; }
	}
	// The step's line stays up while it waits; when another line (an answer, a notice) has had its time, it comes back.
	if (LampLine == TourLine) LampCaptionClock = FMath::Max(LampCaptionClock, 2.f);
	else if (LampLine.IsEmpty() && TalkStateWord().IsEmpty()) SayTour(TourLine);
	// The hands' pointing takes the highlight while they point; the step's target gets it back after.
	if (HighlightKind.IsEmpty())
	{
		if ((Id == TEXT("open-wing") || Id == TEXT("hands-pull")) && !TourWing.IsEmpty() && Level == EBpLevel::L0) SetHighlight(TEXT("wing"), TourWing);
		else if (Id == TEXT("open-room") && !TourRoom.IsEmpty()) SetHighlight(TEXT("room"), TourRoom);
	}
}
