// The lamp's tour (docs/concepts/vr-light-table/standalone-plan.md S6; BpTable.h declares the API and the constants). The
// competition judges the first five minutes: a cold start must teach the gestures with no controller and no wall of text,
// and pay off before the headset comes off. So the lamp asks for one gesture at a time on its caption and waits for it.
// Every step reads the table's state, not a script position: whatever the hands did, the step that fits it is the one
// shown. A step left alone for TourIdleS is shown once by the lamp doing it (never a write), and the hands always act.
//
// Steps: 0 the site (counts), 1 lift a wing, 2 lift its most urgent room, 3 step inside, 4 ask about a feature,
// 5 take a decision, 6 step back out, 7 the hand-off.
#include "BpTable.h"

#include "BpLink.h"
#include "BpPawn.h"
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
		TEXT("The lamp's tour at a cold start: -1 when the table reads the bundled snapshot (the judged build), 1 always, 0 never."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarTourVoice(
		TEXT("bp.TourVoice"),
		1,
		TEXT("1: the lamp's tour speaks each step's line in Glim's voice (the bundled clips); 0: captions only."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarVoiceVolume(
		TEXT("bp.VoiceVolume"),
		1.5f,
		TEXT("The lamp's voice level, 0 to 3 (1 the clips as levelled, -14 LUFS; above 1 limited, never clipped); the wrist's VOICE - and + step it, and it is saved across runs."),
		ECVF_Default);
	const TCHAR* const VoiceSettingsSection = TEXT("/Script/bp.BpVoice");
	const TCHAR* const VoiceSettingsKey = TEXT("VoiceVolume");
	bool bLoadingVoice = false;

	void SaveVoiceVolume(IConsoleVariable* Var)
	{
		if (bLoadingVoice || !GConfig || !Var) return;
		GConfig->SetFloat(VoiceSettingsSection, VoiceSettingsKey, Var->GetFloat(), GGameUserSettingsIni);
		GConfig->Flush(false, GGameUserSettingsIni);
		UE_LOG(LogBpTable, Log, TEXT("BpTour: voice volume %.2f saved"), Var->GetFloat());
	}

	/** A sample scaled by the level, with a soft knee above 0.8 full scale, so a level above 1 is loud and never clips. */
	float LimitSample(float X)
	{
		const float A = FMath::Abs(X);
		if (A <= 0.8f) return X;
		const float Over = FMath::Min((A - 0.8f) / 0.2f, 4.f);
		// tanh(x), a soft approach to 1 (x <= 4 suffices: 1 - tanh(4) < 0.002).
		const float Soft = (FMath::Exp(Over) - FMath::Exp(-Over)) / (FMath::Exp(Over) + FMath::Exp(-Over));
		return FMath::Sign(X) * (0.8f + 0.2f * Soft);
	}

	TAutoConsoleVariable<int32> CVarTourFocus(
		TEXT("bp.TourFocus"),
		-1,
		TEXT("-1: the tour pauses when a headset is on and the app has lost its XR focus (the Quest menu, the headset off); 0: act as if the focus were lost (a check in the flat view); 1: never pause."),
		ECVF_Default);

	/** Whether the person is in the app: no headset (the flat view), or the OpenXR session is FOCUSED (FApp::HasVRFocus
	 *  is false while the runtime's menu shows, VISIBLE, and once the session stops with the headset off). */
	bool TourHasFocus()
	{
		const int32 Forced = CVarTourFocus.GetValueOnGameThread();
		if (Forced >= 0) return Forced != 0;
		return !ABpPawn::IsHeadsetOn() || FApp::HasVRFocus();
	}

	/** A 16-bit PCM WAV's samples: its rate, channels and the data chunk's bytes. False for any other shape. */
	bool ReadWav(const TArray<uint8>& File, int32& OutRate, int32& OutChannels, int32& OutOffset, int32& OutBytes)
	{
		const auto U32 = [&File](int32 At) { return At + 4 <= File.Num() ? static_cast<uint32>(File[At]) | (File[At + 1] << 8) | (File[At + 2] << 16) | (static_cast<uint32>(File[At + 3]) << 24) : 0u; };
		const auto U16 = [&File](int32 At) { return At + 2 <= File.Num() ? static_cast<uint32>(File[At]) | (File[At + 1] << 8) : 0u; };
		if (File.Num() < 44 || FMemory::Memcmp(File.GetData(), "RIFF", 4) != 0 || FMemory::Memcmp(File.GetData() + 8, "WAVE", 4) != 0) return false;
		bool bFormat = false;
		for (int32 At = 12; At + 8 <= File.Num();)
		{
			const uint32 Size = U32(At + 4);
			if (FMemory::Memcmp(File.GetData() + At, "fmt ", 4) == 0)
			{
				if (U16(At + 8) != 1 || U16(At + 22) != 16) return false;
				OutChannels = static_cast<int32>(U16(At + 10));
				OutRate = static_cast<int32>(U32(At + 12));
				bFormat = true;
			}
			else if (FMemory::Memcmp(File.GetData() + At, "data", 4) == 0)
			{
				OutOffset = At + 8;
				OutBytes = FMath::Min<int32>(static_cast<int32>(Size), File.Num() - OutOffset);
				return bFormat && OutBytes > 0;
			}
			At += 8 + static_cast<int32>(Size + (Size & 1));
		}
		return false;
	}

	enum ETourStep : int32
	{
		Welcome = 0,
		LiftWing,
		LiftRoom,
		StepIn,
		Ask,
		Decide,
		StepOut,
		HandOff,
		Count
	};

	const TCHAR* StepName(int32 Step)
	{
		static const TCHAR* Names[] = { TEXT("welcome"), TEXT("lift-wing"), TEXT("lift-room"), TEXT("step-in"), TEXT("ask"),
			TEXT("decide"), TEXT("step-out"), TEXT("hand-off") };
		return Step >= 0 && Step < ETourStep::Count ? Names[Step] : TEXT("none");
	}

	/** Set by BpTour.Start before any table has a plan (-ExecCmds at startup). */
	bool GTourAsked = false;

	void WithTable(UWorld* World, TFunctionRef<void(ABpTable&)> Fn)
	{
		if (!World) return;
		for (TActorIterator<ABpTable> It(World); It; ++It) Fn(**It);
	}

	FAutoConsoleCommandWithWorld CmdTourStart(
		TEXT("BpTour.Start"),
		TEXT("The lamp's tour from its first step (it waits for the plan when there is none yet)."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			bool bAny = false;
			WithTable(World, [&bAny](ABpTable& Table) { if (Table.HasPlan()) { bAny = true; Table.StartTour(); } });
			if (!bAny) { GTourAsked = true; UE_LOG(LogBpTable, Log, TEXT("BpTour: start deferred until the plan arrives")); }
		}));

	FAutoConsoleCommandWithWorld CmdTourStop(
		TEXT("BpTour.Stop"),
		TEXT("Ends the lamp's tour."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			GTourAsked = false;
			WithTable(World, [](ABpTable& Table) { Table.StopTour(TEXT("BpTour.Stop")); });
		}));

	FString Plural(int32 N, const TCHAR* One, const TCHAR* Many)
	{
		return FString::Printf(TEXT("%d %s"), N, N == 1 ? One : Many);
	}
}

void ABpTable::StartTour()
{
	if (!SheetPlan.IsValid()) { GTourAsked = true; return; }
	GTourAsked = false;
	bTourPlayed = true;
	TourProduct = FBpLinkModule::Get().GetProductSlug();
	TourHandAt = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	UE_LOG(LogBpTable, Log, TEXT("BpTour: start on %s (level %d, room mode %s)"), *TourProduct, static_cast<int32>(Level), RoomModeId.IsEmpty() ? TEXT("off") : *RoomModeId);
	EnterTourStep(ETourStep::Welcome);
}

void ABpTable::StopTour(const TCHAR* Why)
{
	if (TourStep < 0) return;
	UE_LOG(LogBpTable, Log, TEXT("BpTour: stop at %s (%s)"), StepName(TourStep), Why);
	// The step's own highlight goes; one the hands set stays theirs.
	if ((HighlightKind == TEXT("wing") && HighlightId == TourWing) || (HighlightKind == TEXT("room") && (HighlightId == TourRoom || HighlightId == RoomId)))
	{
		SetHighlight(FString(), FString());
	}
	TourStep = -1;
	if (UAudioComponent* Voice = TourVoice.Get()) Voice->Stop();
	TourVoiceNext.Reset();
	// The line it kept goes the way any caption goes.
	if (LampLine == TourLine) LampCaptionClock = FMath::Min(LampCaptionClock, 1.5f);
	TourLine.Reset();
}

FString ABpTable::GetTourLine() const
{
	return TourStep < 0 ? FString() : FString::Printf(TEXT("%s %s"), StepName(TourStep), bTourShown ? TEXT("shown") : TEXT("waiting"));
}

void ABpTable::NoteHand(const TCHAR* Kind)
{
	if (const UWorld* World = GetWorld()) TourHandAt = World->GetTimeSeconds();
	if (TourStep < 0) return;
	if (FCString::Strcmp(Kind, TEXT("tap")) == 0) ++TourTaps;
	UE_LOG(LogBpTable, Verbose, TEXT("BpTour: hand %s at %s"), Kind, StepName(TourStep));
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

void ABpTable::EnterTourStep(int32 Step)
{
	const double Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
	TourStep = Step;
	TourStepAt = Now;
	bTourShown = false;
	TourAsks = 0;
	TourTaps = 0;
	if (Step >= ETourStep::Count) { StopTour(TEXT("done")); return; }
	const FBpPlan& Plan = *SheetPlan;
	FString Line;
	switch (Step)
	{
	case ETourStep::Welcome:
	{
		const FString Name = FBpLinkModule::Get().GetProductName().IsEmpty() ? TourProduct : FBpLinkModule::Get().GetProductName();
		Line = FString::Printf(TEXT("This is %s: %s, %s.\nEvery block is a part of its code."), *Name,
			*Plural(Plan.wings.Num(), TEXT("wing"), TEXT("wings")), *Plural(Plan.rooms.Num(), TEXT("room"), TEXT("rooms")));
		break;
	}
	case ETourStep::LiftWing:
	{
		TourRoom = TourRoomIn(FString());
		const FBpPlanRoom* Room = FindRoom(TourRoom);
		TourWing = Room ? Room->parentId : (Plan.wings.Num() > 0 ? Plan.wings[0].id : FString());
		const FBpPlanWing* Wing = FindWing(TourWing);
		Line = FString::Printf(TEXT("Pinch a wing, pull it toward you.\n%s needs you most today."), Wing ? *Wing->name : TEXT("The glowing one"));
		SetHighlight(TEXT("wing"), TourWing);
		break;
	}
	case ETourStep::LiftRoom:
	{
		TourWing = WingId.IsEmpty() ? TourWing : WingId;
		TourRoom = TourRoomIn(TourWing);
		const FBpPlanRoom* Room = FindRoom(TourRoom);
		FString Why;
		for (const FRoomRank& Rank : RoomsByUrgency()) { if (Rank.Id == TourRoom) { Why = RankWhy(Rank); break; } }
		Line = Room ? FString::Printf(TEXT("Pinch %s\nand pull it up: %s."), *Room->name, *Why)
			: FString(TEXT("Pinch a room, pull it up."));
		SetHighlight(TEXT("room"), TourRoom);
		break;
	}
	case ETourStep::StepIn:
	{
		const FBpPlanRoom* Room = FindRoom(RoomId);
		Line = FString::Printf(TEXT("Pull %s once more\nto step inside."), Room ? *Room->name : TEXT("it"));
		SetHighlight(TEXT("room"), RoomId);
		break;
	}
	case ETourStep::Ask:
		TourFeature = TourFeatureIn(RoomModeId);
		Line = TEXT("Pins are what the last scan found.\nHold a feature to ask me about it.");
		SetHighlight(FString(), FString());
		break;
	case ETourStep::Decide:
		Line = TEXT("Each screen is one decision.\nTap APPROVE or DECLINE.");
		break;
	case ETourStep::StepOut:
		Line = TEXT("Push away to step back out.\nIn a room, hold me for the next one.");
		break;
	case ETourStep::HandOff:
		Line = TEXT("That is the morning round.\nThe table is yours.");
		break;
	default:
		break;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTour: step %s"), StepName(Step));
	SayTour(Line);
	// The lamp's "Like this." finishes before the next line; any other line is cut by the next.
	const UAudioComponent* Voice = TourVoice.Get();
	if (Voice && Now < TourVoiceEndsAt && TourVoiceClip == TEXT("shown")) TourVoiceNext = StepName(Step);
	else SpeakTour(StepName(Step));
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
	int32 Rate = 0, Channels = 0, Offset = 0, Bytes = 0;
	if (File->Num() == 0 || !ReadWav(*File, Rate, Channels, Offset, Bytes) || Channels < 1) return;
	// A procedural wave drains as it plays, so each line gets a new one, fed the clip's samples.
	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
	Wave->SetSampleRate(Rate);
	Wave->NumChannels = Channels;
	Wave->Duration = static_cast<float>(Bytes) / (2.f * Channels * Rate);
	Wave->SoundGroup = SOUNDGROUP_Voice;
	Wave->bLooping = false;
	// The clip at the level (bp.VoiceVolume), limited sample by sample: a level over 1 must not clip the output.
	TourVoiceGain = VoiceVolume();
	TArray<uint8> Scaled;
	Scaled.SetNumUninitialized(Bytes);
	for (int32 At = 0; At + 1 < Bytes; At += 2)
	{
		const int16 In = static_cast<int16>(File->GetData()[Offset + At] | (File->GetData()[Offset + At + 1] << 8));
		const float Out = LimitSample(static_cast<float>(In) / 32768.f * TourVoiceGain);
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
}

float ABpTable::VoiceVolume()
{
	return FMath::Clamp(CVarVoiceVolume.GetValueOnGameThread(), 0.f, 3.f);
}

void ABpTable::StepVoiceVolume(float Delta)
{
	IConsoleVariable* Var = CVarVoiceVolume.AsVariable();
	const float Stepped = FMath::Clamp(FMath::GridSnap(VoiceVolume() + Delta, 0.25f), 0.f, 3.f);
	Var->Set(Stepped, ECVF_SetByConsole);
	UE_LOG(LogBpTable, Log, TEXT("BpTour: voice volume stepped to %.2f"), Stepped);
}

void ABpTable::LoadVoiceVolume()
{
	static bool bDone = false;
	if (bDone) return;
	bDone = true;
	CVarVoiceVolume.AsVariable()->SetOnChangedCallback(FConsoleVariableDelegate::CreateStatic(&SaveVoiceVolume));
	float Saved = 0.f;
	if (GConfig && GConfig->GetFloat(VoiceSettingsSection, VoiceSettingsKey, Saved, GGameUserSettingsIni))
	{
		bLoadingVoice = true;
		CVarVoiceVolume.AsVariable()->Set(FMath::Clamp(Saved, 0.f, 3.f), ECVF_SetByConsole);
		bLoadingVoice = false;
		UE_LOG(LogBpTable, Log, TEXT("BpTour: voice volume %.2f (saved)"), VoiceVolume());
	}
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
		else if (TourVoiceGain >= 0.f && !FMath::IsNearlyEqual(TourVoiceGain, VoiceVolume(), 0.01f)) PreviewVoice();
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
			UE_LOG(LogBpTable, Log, TEXT("BpTour: paused at %s (the app lost its focus)"), StepName(TourStep));
		}
		return;
	}
	if (bTourAway)
	{
		bTourAway = false;
		const double Away = Now - TourAwayAt;
		TourStepAt += Away;
		TourHandAt += Away;
		UE_LOG(LogBpTable, Log, TEXT("BpTour: resumed at %s after %.1f s away"), StepName(TourStep), Away);
		if (TourStep >= 0)
		{
			SayTour(TourLine);
			SpeakTour(StepName(TourStep));
		}
	}
	// Not running: the cold start's tour, once the plan has stood TourStartDelayS (the build-up and the seat go first).
	if (TourStep < 0)
	{
		if (TourPlanAt < 0.0) TourPlanAt = Now;
		const int32 Mode = CVarTour.GetValueOnGameThread();
		const bool bCold = !bTourPlayed && (Mode > 0 || (Mode < 0 && Link.IsFromBundle()));
		if ((GTourAsked || bCold) && Now - TourPlanAt >= TourStartDelayS) StartTour();
		return;
	}
	if (Link.GetProductSlug() != TourProduct) { StopTour(TEXT("another product")); return; }
	// A line's samples are done (the top of this tick stopped it): a waiting line speaks.
	if (Now >= TourVoiceEndsAt && !TourVoiceNext.IsEmpty()) SpeakTour(*FString(TourVoiceNext));

	const double InStep = Now - TourStepAt;
	const bool bIdle = Now - FMath::Max(TourHandAt, TourStepAt) >= TourIdleS;
	const bool bInRoom = !RoomModeId.IsEmpty();
	// Whatever the hands did, the step that fits where the table is now.
	switch (TourStep)
	{
	case ETourStep::Welcome:
		if (InStep >= TourWelcomeS || Level != EBpLevel::L0 || bInRoom) EnterTourStep(ETourStep::LiftWing);
		return;
	case ETourStep::LiftWing:
		if (bInRoom) { EnterTourStep(ETourStep::Ask); return; }
		if (Level != EBpLevel::L0) { EnterTourStep(Level == EBpLevel::L2 ? ETourStep::StepIn : ETourStep::LiftRoom); return; }
		if (bIdle && !bTourShown) { bTourShown = true; UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: lift %s"), *TourWing); SpeakTour(TEXT("shown")); EnterWing(TourWing); }
		break;
	case ETourStep::LiftRoom:
		if (bInRoom) { EnterTourStep(ETourStep::Ask); return; }
		if (Level == EBpLevel::L2) { EnterTourStep(ETourStep::StepIn); return; }
		if (Level == EBpLevel::L0) { EnterTourStep(ETourStep::LiftWing); return; }
		if (WingId != TourWing) { EnterTourStep(ETourStep::LiftRoom); return; }
		if (bIdle && !bTourShown && !TourRoom.IsEmpty()) { bTourShown = true; UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: lift %s"), *TourRoom); SpeakTour(TEXT("shown")); EnterRoom(TourRoom); }
		break;
	case ETourStep::StepIn:
		// A copy, not RoomId itself: EnterRoomMode brings the levels home first, which clears RoomId.
		if (bInRoom) { EnterTourStep(ETourStep::Ask); return; }
		if (Level != EBpLevel::L2) { EnterTourStep(Level == EBpLevel::L1 ? ETourStep::LiftRoom : ETourStep::LiftWing); return; }
		if (bIdle && !bTourShown) { bTourShown = true; UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: step into %s"), *RoomId); SpeakTour(TEXT("shown")); EnterRoomMode(FString(RoomId)); }
		break;
	case ETourStep::Ask:
		if (!bInRoom) { EnterTourStep(ETourStep::LiftWing); return; }
		// The answer stays up its LampCaptionS, then the next step.
		if (TourAsks > 0 && LampLine != TourLine && LampCaptionClock <= 1.f) { EnterTourStep(ETourStep::Decide); return; }
		if (TourAsks > 0 && LampLine.IsEmpty()) { EnterTourStep(ETourStep::Decide); return; }
		if (bIdle && !bTourShown && TourAsks == 0)
		{
			bTourShown = true;
			if (RoomModeId != TourRoom) TourFeature = TourFeatureIn(RoomModeId);
			UE_LOG(LogBpTable, Log, TEXT("BpTour: shown: ask about %s"), *TourFeature);
			AskLamp(TourFeature);
		}
		break;
	case ETourStep::Decide:
		if (!bInRoom) { EnterTourStep(ETourStep::HandOff); return; }
		// A decision is never taken for the person: a tap moves on, and so does a long wait. Offline the tap writes nothing
		// (BpLink refuses every write on the bundle), so the lamp says so rather than leave the deck's move unexplained.
		if (TourTaps > 0 && !bTourShown)
		{
			bTourShown = true;
			TourStepAt = Now;
			if (Link.IsFromBundle()) SayTour(TEXT("Noted. This demo sends nothing;\nwith a server it joins a draft wave."));
			return;
		}
		if (bTourShown && InStep >= (Link.IsFromBundle() ? 5.0 : 1.5)) { EnterTourStep(ETourStep::StepOut); return; }
		if (InStep >= TourIdleS * 2.0 && bIdle) { EnterTourStep(ETourStep::StepOut); return; }
		break;
	case ETourStep::StepOut:
		if (!bInRoom) { EnterTourStep(ETourStep::HandOff); return; }
		if (InStep >= TourIdleS * 1.5) { EnterTourStep(ETourStep::HandOff); return; }
		break;
	case ETourStep::HandOff:
		if (InStep >= LampCaptionS) { StopTour(TEXT("done")); return; }
		break;
	default:
		break;
	}
	// The step's line stays up while it waits; when another line (an answer, a notice) has had its time, it comes back.
	if (LampLine == TourLine) LampCaptionClock = FMath::Max(LampCaptionClock, 2.f);
	else if (LampLine.IsEmpty()) SayTour(TourLine);
	// The hands' pointing takes the highlight while they point; the step's target gets it back after.
	if (HighlightKind.IsEmpty())
	{
		if (TourStep == ETourStep::LiftWing && !TourWing.IsEmpty()) SetHighlight(TEXT("wing"), TourWing);
		else if (TourStep == ETourStep::LiftRoom && !TourRoom.IsEmpty()) SetHighlight(TEXT("room"), TourRoom);
	}
}
