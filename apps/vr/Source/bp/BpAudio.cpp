// The sound levels, their saving, and the music bed (BpAudio.h).
#include "BpAudio.h"

#include "Async/Async.h"
#include "BpPawn.h"
#include "BpStore.h"
#include "BpTable.h"
#include "Components/AudioComponent.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/App.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Sound/SoundWaveProcedural.h"

namespace
{
	TAutoConsoleVariable<float> CVarVoiceLevel(
		TEXT("bp.VoiceLevel"),
		1.f,
		TEXT("Glim's voice, 0 to 1.5 (shown as 0 to 150 %; 1 plays the clips at BpAudio::VoiceGainAtFull = 2.4 x their levelled -14 LUFS, the old 120 % (2026-11-10), soft-limited, never clipped). Settings' VOICE - and + step it; saved across runs."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarMusicLevel(
		TEXT("bp.MusicLevel"),
		0.35f,
		TEXT("The background music bed, 0 to 1 (shown as %); 0 stops the stream and frees it. Settings' MUSIC - and + step it; saved across runs."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarMusicDuckDb(
		TEXT("bp.MusicDuckDb"),
		8.f,
		TEXT("How far the music ducks under a tour line (dB, 0 to 30): down over 0.3 s, back over 0.8 s."),
		ECVF_Default);
	TAutoConsoleVariable<float> CVarMusicLoopS(
		TEXT("bp.MusicLoopS"),
		0.f,
		TEXT("A check only: above 0 the bed wraps to its first frame after this many seconds instead of at its end (135 s), so a run can see the wrap."),
		ECVF_Default);
	// SETTINGS › ACCESSIBILITY (night two V4): with bp.ReducedMotion and bp.WristHand, saved below with the rest.
	TAutoConsoleVariable<float> CVarTextSize(
		TEXT("bp.TextSize"),
		1.f,
		TEXT("Text size for the console, the wrist and the captions, 1.0 to 1.3 (SETTINGS › ACCESSIBILITY steps 1.0, 1.15, 1.3): each surface is scaled as a whole, so its type grows and its layout holds. Saved across runs."),
		ECVF_Default);
	TAutoConsoleVariable<int32> CVarCaptions(
		TEXT("bp.Captions"),
		0,
		TEXT("The lamp's captions: 1 always on (every line the lamp says gets its caption, on the site plan too), 0 with its voice (the default, as before: the lines it says in a room and its notices). Saved across runs."),
		ECVF_Default);
	TAutoConsoleVariable<int32> CVarNarration(
		TEXT("bp.Narration"),
		2,
		TEXT("Wave N3-W3, SETTINGS > NARRATION: 2 ALL (default: the tour's lines and one short line from Glim for every step on the table, from bundled clips), 1 TOUR ONLY (the tour's and its chapters' lines), 0 OFF (nothing said unasked: a talk reply still speaks; captions carry the rest). Saved across runs."),
		ECVF_Default);
	TAutoConsoleVariable<int32> CVarTourFocus(
		TEXT("bp.TourFocus"),
		-1,
		TEXT("-1: the tour and the music pause when a headset is on and the app has lost its XR focus (the Quest menu, the headset off); 0: act as if the focus were lost (a check in the flat view); 1: never pause."),
		ECVF_Default);

	const TCHAR* const AudioSection = TEXT("/Script/bp.BpAudio");
	const TCHAR* const SettingsSection = TEXT("/Script/bp.BpSettings");
	const TCHAR* const OldVoiceSection = TEXT("/Script/bp.BpVoice");
	const TCHAR* const OldVoiceKey = TEXT("VoiceVolume");

	/** The cvars saved across runs: the cvar, its section and key in the app's own file (FBpStore, Saved/BpTable.json), and its clamp. */
	struct FSaved
	{
		const TCHAR* Cvar;
		const TCHAR* Section;
		const TCHAR* Key;
		float Min;
		float Max;
	};
	const FSaved Saved[] = {
		{ TEXT("bp.VoiceLevel"), AudioSection, TEXT("VoiceLevel"), 0.f, 1.5f },
		{ TEXT("bp.MusicLevel"), AudioSection, TEXT("MusicLevel"), 0.f, 1.f },
		{ TEXT("bp.WristFace"), SettingsSection, TEXT("WristFace"), 0.f, 1.f },
		{ TEXT("bp.WristHand"), SettingsSection, TEXT("WristHand"), 0.f, 1.f },
		{ TEXT("bp.ReducedMotion"), SettingsSection, TEXT("ReducedMotion"), 0.f, 1.f },
		{ TEXT("bp.Room"), SettingsSection, TEXT("Room"), 0.f, 1.f },
		{ TEXT("bp.TextSize"), SettingsSection, TEXT("TextSize"), 1.f, 1.3f },
		{ TEXT("bp.Captions"), SettingsSection, TEXT("Captions"), 0.f, 1.f },
		{ TEXT("bp.Legend"), SettingsSection, TEXT("Legend"), 0.f, 1.f },
		{ TEXT("bp.Projector"), SettingsSection, TEXT("Projector"), 0.f, 2.f },
		{ TEXT("bp.Narration"), AudioSection, TEXT("Narration"), 0.f, 2.f },
	};
	bool bLoading = false;

	void SaveOne(const FSaved& Each, IConsoleVariable* Var)
	{
		if (bLoading || !Var) return;
		FBpStore::SetString(Each.Section, Each.Key, FString::Printf(TEXT("%.2f"), FMath::Clamp(Var->GetFloat(), Each.Min, Each.Max)));
		FBpStore::Flush();
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: %s %.2f saved ([%s] %s)"), Each.Cvar, Var->GetFloat(), Each.Section, Each.Key);
	}

	void SetCvar(const TCHAR* Name, float Value)
	{
		if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name)) Var->Set(Value, ECVF_SetByConsole);
	}

	/** Music frames a chunk (0.5 s at the bed's rate is 16000) and how much stays queued ahead of the device. */
	constexpr float ChunkS = 0.5f;
	constexpr float AheadS = 1.0f;
}

namespace BpAudio
{
	float VoiceLevel() { return FMath::Clamp(CVarVoiceLevel.GetValueOnGameThread(), 0.f, 1.5f); }
	float VoiceGain() { return VoiceGainAtFull * VoiceLevel(); }
	float MusicLevel() { return FMath::Clamp(CVarMusicLevel.GetValueOnGameThread(), 0.f, 1.f); }
	int32 Narration() { return FMath::Clamp(CVarNarration.GetValueOnGameThread(), 0, 2); }

	void StepVoiceLevel(float Delta)
	{
		const float Stepped = FMath::Clamp(FMath::GridSnap(VoiceLevel() + Delta, VoiceStep), 0.f, 1.5f);
		CVarVoiceLevel.AsVariable()->Set(Stepped, ECVF_SetByConsole);
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: voice level stepped to %.2f (%d%%)"), Stepped, FMath::RoundToInt(Stepped * 100.f));
	}

	void StepMusicLevel(float Delta)
	{
		const float Stepped = FMath::Clamp(FMath::GridSnap(MusicLevel() + Delta, MusicStep), 0.f, 1.f);
		CVarMusicLevel.AsVariable()->Set(Stepped, ECVF_SetByConsole);
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: music level stepped to %.2f (%d%%)"), Stepped, FMath::RoundToInt(Stepped * 100.f));
	}

	void LoadSettings()
	{
		static bool bDone = false;
		if (bDone) return;
		bDone = true;
		bLoading = true;
		// The old voice key, once: its level halved (the old 2.0 is the new 1.0), written under the new key, then removed, so a
		// second run reads only the new one and nothing doubles.
		float Level = 0.f, Old = 0.f;
		if (!FBpStore::GetFloat(AudioSection, TEXT("VoiceLevel"), Level) && FBpStore::GetFloat(OldVoiceSection, OldVoiceKey, Old))
		{
			const float Migrated = FMath::Clamp(Old * 0.5f, 0.f, 1.5f);
			FBpStore::SetString(AudioSection, TEXT("VoiceLevel"), FString::Printf(TEXT("%.2f"), Migrated));
			FBpStore::RemoveKey(OldVoiceSection, OldVoiceKey);
			FBpStore::Flush();
			UE_LOG(LogBpTable, Log, TEXT("BpAudio: migrated the old voice volume %.2f to voice level %.2f (the old key removed)"), Old, Migrated);
		}
		for (const FSaved& Each : Saved)
		{
			IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Each.Cvar);
			if (!Var) continue;
			float Value = 0.f;
			if (FBpStore::GetFloat(Each.Section, Each.Key, Value))
			{
				Var->Set(FMath::Clamp(Value, Each.Min, Each.Max), ECVF_SetByConsole);
				UE_LOG(LogBpTable, Log, TEXT("BpAudio: %s %.2f (saved)"), Each.Cvar, Var->GetFloat());
			}
			const FSaved* Ptr = &Each;
			Var->OnChangedDelegate().AddLambda([Ptr](IConsoleVariable* Changed) { SaveOne(*Ptr, Changed); });
		}
		bLoading = false;
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: voice level %.2f (%d%%, gain %.2f), music level %.2f (%d%%)"), VoiceLevel(), FMath::RoundToInt(VoiceLevel() * 100.f), VoiceGain(),
			MusicLevel(), FMath::RoundToInt(MusicLevel() * 100.f));
	}

	float LimitSample(float X)
	{
		const float A = FMath::Abs(X);
		if (A <= 0.8f) return X;
		const float Over = FMath::Min((A - 0.8f) / 0.2f, 4.f);
		// tanh(x), a soft approach to 1 (x <= 4 suffices: 1 - tanh(4) < 0.002).
		const float Soft = (FMath::Exp(Over) - FMath::Exp(-Over)) / (FMath::Exp(Over) + FMath::Exp(-Over));
		return FMath::Sign(X) * (0.8f + 0.2f * Soft);
	}

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

	bool HasFocus()
	{
		const int32 Forced = CVarTourFocus.GetValueOnGameThread();
		if (Forced >= 0) return Forced != 0;
		return !ABpPawn::IsHeadsetOn() || FApp::HasVRFocus();
	}
}

// ---- The music bed (the pawn's tick) ------------------------------------------------------------------------------------

void ABpPawn::TickMusic()
{
	const float Level = BpAudio::MusicLevel();
	ABpTable* Table = WristTable.Get();
	// Level 0: no stream at all (the component stopped and let go; the samples are kept for a later raise).
	if (Level <= 0.f)
	{
		if (Music)
		{
			Music->Stop();
			Music->DestroyComponent();
			Music = nullptr;
			MusicWave = nullptr;
			UE_LOG(LogBpTable, Log, TEXT("BpAudio: music stopped (level 0: no stream)"));
		}
		return;
	}
	// The samples, read once off the game thread (17 MB: one copy, never a second).
	if (!MusicData.IsValid() && !bMusicLoading && !bMusicMissing)
	{
		bMusicLoading = true;
		TWeakObjectPtr<ABpPawn> Self(this);
		const FString Path = FPaths::ProjectContentDir() / TEXT("BpData/music/bed.wav");
		Async(EAsyncExecution::ThreadPool, [Self, Path]()
		{
			TSharedPtr<TArray<uint8>, ESPMode::ThreadSafe> Data = MakeShared<TArray<uint8>, ESPMode::ThreadSafe>();
			const bool bRead = FFileHelper::LoadFileToArray(*Data, *Path, FILEREAD_Silent);
			AsyncTask(ENamedThreads::GameThread, [Self, Data, bRead, Path]()
			{
				ABpPawn* Pawn = Self.Get();
				if (!Pawn) return;
				Pawn->bMusicLoading = false;
				int32 Rate = 0, Channels = 0, Offset = 0, Bytes = 0;
				if (!bRead || !BpAudio::ReadWav(*Data, Rate, Channels, Offset, Bytes) || Channels != 2)
				{
					Pawn->bMusicMissing = true;
					UE_LOG(LogBpTable, Log, TEXT("BpAudio: no music bed at %s (a 16-bit stereo PCM WAV); silent"), *Path);
					return;
				}
				Pawn->MusicData = Data;
				Pawn->MusicRate = Rate;
				Pawn->MusicOffset = Offset;
				Pawn->MusicBytes = Bytes - Bytes % 4;
				Pawn->MusicAt = 0;
				UE_LOG(LogBpTable, Log, TEXT("BpAudio: music bed read: %.1f s, %d Hz, 2 channels, %d bytes"), static_cast<float>(Pawn->MusicBytes) / (4.f * Rate), Rate, Pawn->MusicBytes);
			});
		});
		return;
	}
	if (!MusicData.IsValid()) return;
	// From the first frame the plan is shown.
	if (!Music)
	{
		if (!Table || !Table->HasPlan()) return;
		MusicWave = NewObject<USoundWaveProcedural>(this);
		MusicWave->SetSampleRate(MusicRate);
		MusicWave->NumChannels = 2;
		MusicWave->Duration = INDEFINITELY_LOOPING_DURATION;
		MusicWave->SoundGroup = SOUNDGROUP_Music;
		MusicWave->bLooping = false;
		Music = UGameplayStatics::CreateSound2D(this, MusicWave, 1.f, 1.f, 0.f, nullptr, false, false);
		if (!Music)
		{
			MusicWave = nullptr;
			if (!bMusicMissing) UE_LOG(LogBpTable, Log, TEXT("BpAudio: no audio device: the music is silent"));
			bMusicMissing = true;
			return;
		}
		bMusicDucked = bMusicPaused = false;
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: music started at %.1f s of the bed, level %.2f (%d%%), 2D, %.1f s chunks"), static_cast<float>(MusicAt) / (4.f * MusicRate), Level, FMath::RoundToInt(Level * 100.f), ChunkS);
		FeedMusic();
		Music->SetVolumeMultiplier(Level);
		Music->Play();
		MusicLevelShown = Level;
	}
	if (Level != MusicLevelShown)
	{
		MusicLevelShown = Level;
		Music->SetVolumeMultiplier(Level);
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: music level %.2f"), Level);
	}
	// Away (the Quest menu, the headset off): paused where it is, as the tour holds.
	const bool bAway = !BpAudio::HasFocus();
	if (bAway != bMusicPaused)
	{
		bMusicPaused = bAway;
		Music->SetPaused(bAway);
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: music %s"), bAway ? TEXT("paused (the app lost its focus)") : TEXT("resumed"));
	}
	if (bMusicPaused) return;
	// Under a tour line: ducked.
	const bool bDuck = Table && Table->IsMusicDucked();
	if (bDuck != bMusicDucked)
	{
		bMusicDucked = bDuck;
		const float DuckDb = FMath::Clamp(CVarMusicDuckDb.GetValueOnGameThread(), 0.f, 30.f);
		Music->AdjustVolume(bDuck ? 0.3f : 0.8f, bDuck ? FMath::Pow(10.f, -DuckDb / 20.f) : 1.f);
		UE_LOG(LogBpTable, Log, TEXT("BpAudio: music %s"), bDuck ? *FString::Printf(TEXT("ducked %.0f dB under the voice"), DuckDb) : TEXT("back from the duck"));
	}
	FeedMusic();
}

void ABpPawn::FeedMusic()
{
	if (!MusicWave || !MusicData.IsValid() || MusicBytes <= 0) return;
	const int32 BytesPerS = 4 * MusicRate;
	const float LoopS = CVarMusicLoopS.GetValueOnGameThread();
	const int64 End = LoopS > 0.f ? FMath::Min<int64>(MusicBytes, static_cast<int64>(LoopS * MusicRate) * 4) : MusicBytes;
	const int32 Chunk = FMath::RoundToInt(ChunkS * MusicRate) * 4;
	while (MusicWave->GetAvailableAudioByteCount() < static_cast<int32>(AheadS * BytesPerS))
	{
		if (MusicAt >= End)
		{
			// The whole file is the loop: straight back to frame 0.
			MusicAt = 0;
			++MusicLoops;
			UE_LOG(LogBpTable, Log, TEXT("BpAudio: music wrapped to frame 0 (loop %d, at %.1f s)"), MusicLoops, static_cast<float>(End) / BytesPerS);
		}
		const int32 Take = static_cast<int32>(FMath::Min<int64>(Chunk, End - MusicAt));
		MusicWave->QueueAudio(MusicData->GetData() + MusicOffset + MusicAt, Take);
		MusicAt += Take;
	}
}
