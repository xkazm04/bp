// Talk to the lamp (night two W3; the owner's pick: "speak at the table; the companion answers aloud and acts on the plan,
// every write behind an approval card"). docs/concepts/vr-light-table/voice-link.md is the wire; the registry's voice-io
// subject governs consent and honesty (on-device-vs-cloud, stt-pipeline, tts-pipeline):
//
//   consent   Nothing is recorded and nothing is sent until the wearer has pressed ALLOW on the consent sheet (the console's
//             TALK page, opened the first time a hold lasts TalkMinHoldS). The choice is saved ([/Script/bp.BpTalk] Consent)
//             and changed in SETTINGS. NOT NOW leaves the ASK page as the way to ask.
//   hold      X on the left controller, a pinch held on the lamp, or TALK held on the wrist. Down opens the microphone (UE's
//             audio capture, the platform's default input), up closes it and sends. Under TalkMinHoldS it is a tap: nothing is
//             sent and the source does its old tap (X: "plan my next step here"; the lamp: its ask or its offer).
//   states    arming (asked for the device, no audio yet: never shown as listening), listening (audio flows: the lamp turns to
//             the wearer, its caption says LISTENING with the input level, its light follows the level when the light can
//             change, the music ducks), hearing (sent), thinking (the companion's turn: minutes are possible; B or a pinch on
//             the lamp cancels), speaking (the reply as caption and voice, queued behind a tour line). Each failure says so
//             in words on the caption: no PC, no `standup` scope, no microphone permission, no device, silence, no words,
//             busy (429: "one moment", never retried in a loop), the service refused.
//   barge-in  A new hold stops the lamp's voice at once.
//   pause     The app going away during a hold or a recording (background, deactivated, the headset off, the XR focus lost:
//             bp.TourFocus's rule) closes the microphone and drops what it heard: nothing recorded across a pause is sent.
//   bundle    No PC and no microphone: a hold plays the scripted sample exchange (Content/BpData/voice/talk/), picked by the
//             place in view, labelled SAMPLE, and the lamp then does what the sample says, locally.
//   idle      The capture device is open only while held; with no talk in flight TickTalk returns at its first line.
#include "BpTable.h"

#include "Async/Async.h"
#include "AudioCaptureCore.h"
#include "BpAudio.h"
#include "BpLink.h"
#include "BpPawn.h"
#include "Components/PointLightComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "TimerManager.h"
#include <atomic>
#if PLATFORM_ANDROID
#include "AndroidPermissionCallbackProxy.h"
#include "AndroidPermissionFunctionLibrary.h"
#endif

namespace
{
	const TCHAR* const TalkSection = TEXT("/Script/bp.BpTalk");
	const TCHAR* const MicPermission = TEXT("android.permission.RECORD_AUDIO");
	constexpr int32 SendRate = 16000;

	TAutoConsoleVariable<int32> CVarTalk(TEXT("bp.Talk"), 1, TEXT("Talk to the lamp (BpTalk.cpp): 1 a hold on X, the lamp or the wrist's TALK talks; 0 off (the holds act as taps)."));
	TAutoConsoleVariable<float> CVarTalkLightGain(TEXT("bp.TalkLightGain"), 1.5f, TEXT("While listening the lamp's light rises by up to this share of its own intensity with the input level (0 to 4; 0: the light stays)."));

	ABpPawn* TalkPawn(const UWorld* World)
	{
		const APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	void WithTalkTables(UWorld* World, TFunctionRef<void(ABpTable&)> Fn)
	{
		if (!World) return;
		for (TActorIterator<ABpTable> It(World); It; ++It) Fn(**It);
	}

	/** One mono 16-bit PCM WAV from float samples. */
	TArray<uint8> WavOf(const TArray<int16>& Pcm, int32 Rate)
	{
		TArray<uint8> Out;
		const int32 Data = Pcm.Num() * 2;
		Out.SetNumUninitialized(44 + Data);
		uint8* P = Out.GetData();
		const auto U32 = [&P](uint32 V) { P[0] = V & 0xFF; P[1] = (V >> 8) & 0xFF; P[2] = (V >> 16) & 0xFF; P[3] = (V >> 24) & 0xFF; P += 4; };
		const auto U16 = [&P](uint16 V) { P[0] = V & 0xFF; P[1] = (V >> 8) & 0xFF; P += 2; };
		const auto Tag = [&P](const char* T) { FMemory::Memcpy(P, T, 4); P += 4; };
		Tag("RIFF"); U32(36 + Data); Tag("WAVE");
		Tag("fmt "); U32(16); U16(1); U16(1); U32(Rate); U32(Rate * 2); U16(2); U16(16);
		Tag("data"); U32(Data);
		FMemory::Memcpy(P, Pcm.GetData(), Data);
		return Out;
	}

	/** Mono float at Rate to 16-bit at SendRate: a box average over each output step when going down (an anti-alias of the
	 *  plainest kind, enough for speech), a linear step when going up. */
	TArray<int16> Resample(const TArray<float>& In, int32 Rate)
	{
		TArray<int16> Out;
		if (In.Num() == 0 || Rate <= 0) return Out;
		const double Step = static_cast<double>(Rate) / SendRate;
		const int32 N = FMath::FloorToInt(In.Num() / Step);
		Out.SetNumUninitialized(N);
		for (int32 I = 0; I < N; ++I)
		{
			float V = 0.f;
			if (Step >= 1.0)
			{
				const int32 A = FMath::FloorToInt(I * Step), B = FMath::Max(A + 1, FMath::Min(In.Num(), FMath::FloorToInt((I + 1) * Step)));
				for (int32 K = A; K < B; ++K) V += In[K];
				V /= static_cast<float>(B - A);
			}
			else
			{
				const double At = I * Step;
				const int32 A = FMath::Min(In.Num() - 1, FMath::FloorToInt(At));
				const int32 B = FMath::Min(In.Num() - 1, A + 1);
				V = FMath::Lerp(In[A], In[B], static_cast<float>(At - A));
			}
			Out[I] = static_cast<int16>(FMath::Clamp(FMath::RoundToInt(V * 32767.f), -32768, 32767));
		}
		return Out;
	}

	FString ErrorOf(const FString& Body)
	{
		TSharedPtr<FJsonObject> Json;
		FString Error;
		if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid()) Json->TryGetStringField(TEXT("error"), Error);
		return Error;
	}

	/** The scripted sample (Content/BpData/voice/talk/sample.json): an ask, the lamp's reply, its clip. */
	struct FTalkSampleLine
	{
		FString Id, Ask, Reply;
	};
	bool ReadSample(const FString& Id, FTalkSampleLine& Out)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *(FPaths::ProjectContentDir() / TEXT("BpData/voice/talk/sample.json")))) return false;
		TSharedPtr<FJsonObject> Json;
		const TArray<TSharedPtr<FJsonValue>>* Lines = nullptr;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Json) || !Json.IsValid() || !Json->TryGetArrayField(TEXT("lines"), Lines)) return false;
		for (const TSharedPtr<FJsonValue>& Each : *Lines)
		{
			const TSharedPtr<FJsonObject>* One = nullptr;
			if (!Each.IsValid() || !Each->TryGetObject(One)) continue;
			FTalkSampleLine L;
			(*One)->TryGetStringField(TEXT("id"), L.Id);
			(*One)->TryGetStringField(TEXT("ask"), L.Ask);
			(*One)->TryGetStringField(TEXT("reply"), L.Reply);
			if (L.Id == Id) { Out = L; return true; }
		}
		return false;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdTalkSay(TEXT("BpTalk.Say"), TEXT("BpTalk.Say <text>: the talk's turn from text, skipping the microphone (the words go to the companion as if heard)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString Text = FString::Join(Args, TEXT(" "));
			WithTalkTables(World, [&Text](ABpTable& T) { T.TalkFromText(Text, TEXT("BpTalk.Say")); });
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkFile(TEXT("BpTalk.File"), TEXT("BpTalk.File <wav path>: sends a mono 16-bit WAV as if it had been recorded (consent still applies)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			TArray<uint8> Wav;
			const FString Path = FString::Join(Args, TEXT(" ")).TrimQuotes();
			if (Path.IsEmpty() || !FFileHelper::LoadFileToArray(Wav, *Path)) { UE_LOG(LogBpTable, Warning, TEXT("BpTalk: no WAV at %s"), *Path); return; }
			WithTalkTables(World, [&Wav](ABpTable& T) { T.TalkFromWav(Wav, TEXT("BpTalk.File")); });
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkHold(TEXT("BpTalk.Hold"), TEXT("BpTalk.Hold <seconds>: holds push to talk for that long through the real microphone (the PC build), then lets go."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const float S = Args.Num() > 0 ? FCString::Atof(*Args[0]) : 3.f;
			WithTalkTables(World, [S](ABpTable& T) { T.TalkHold(TEXT("console"), true); });
			if (World)
			{
				FTimerHandle Once;
				World->GetTimerManager().SetTimer(Once, FTimerDelegate::CreateLambda([WeakWorld = TWeakObjectPtr<UWorld>(World)]()
				{
					WithTalkTables(WeakWorld.Get(), [](ABpTable& T) { T.TalkHold(TEXT("console"), false); });
				}), FMath::Max(0.05f, S), false);
			}
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkConsent(TEXT("BpTalk.Consent"), TEXT("BpTalk.Consent allow|notnow|unset: sets the saved consent (as the sheet's ALLOW and NOT NOW, and a fresh install)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString V = Args.Num() > 0 ? Args[0] : FString();
			ABpTable::SetTalkConsent(V == TEXT("allow") ? 1 : V == TEXT("notnow") ? 2 : 0);
			if (ABpPawn* Pawn = TalkPawn(World)) Pawn->TalkChanged();
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkCancel(TEXT("BpTalk.Cancel"), TEXT("BpTalk.Cancel: what B or a pinch on the lamp does to a talk in flight."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithTalkTables(World, [](ABpTable& T) { T.TalkCancel(TEXT("console")); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkStat(TEXT("BpTalk.Stat"), TEXT("BpTalk.Stat: the talk's state, whether the capture device is open, and the consent."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithTalkTables(World, [](ABpTable& T) { T.LogTalk(); }); }));
}

struct FBpTalkState
{
	enum class EStep : uint8 { Idle, Arming, Listening, Hearing, Thinking, Speaking, Sample };
	EStep Step = EStep::Idle;
	FString Source;
	bool bHeld = false;
	double DownAt = 0.0;
	/** The hold reached TalkMinHoldS while consent was not given: the sheet was opened once for it. */
	bool bAskedConsent = false;
	/** The capture: open only while held. The callback runs on the audio thread and only appends under Lock. */
	TUniquePtr<Audio::FAudioCapture> Capture;
	FCriticalSection Lock;
	TArray<float> Samples;
	int32 Rate = 0;
	bool bCapped = false;
	std::atomic<float> Peak{ 0.f };
	std::atomic<bool> bFlowing{ false };
	float Meter = 0.f;
	int32 MeterShown = -1;
	/** Bumped by a cancel or a new talk: a late answer for an older one is dropped. */
	int32 Serial = 0;
	FString Heard;
	FString Reply;
	double ThinkFrom = 0.0;
	/** A reply's voice waiting for a tour line to finish. */
	TArray<uint8> Queued;
	bool bSpoke = false;
	/** The reply's voice is being rendered (POST /api/companion/say): the talk is not over before it answers. */
	bool bAwaitSay = false;
	FString SampleAct;
	/** The lamp's own point light (bp.TalkLightGain), and its intensity before the talk. */
	TWeakObjectPtr<UPointLightComponent> Light;
	float LightBase = -1.f;
	bool bPermissionAsked = false;
	/** While the microphone is open: the app going away (background, deactivated, the headset off) drops the recording. */
	FDelegateHandle BackgroundHandle, DeactivateHandle, HeadOffHandle;

	~FBpTalkState() { CloseCapture(); }
	void Unwatch()
	{
		if (BackgroundHandle.IsValid()) FCoreDelegates::ApplicationWillEnterBackgroundDelegate.Remove(BackgroundHandle);
		if (DeactivateHandle.IsValid()) FCoreDelegates::ApplicationWillDeactivateDelegate.Remove(DeactivateHandle);
		if (HeadOffHandle.IsValid()) FCoreDelegates::VRHeadsetRemovedFromHead.Remove(HeadOffHandle);
		BackgroundHandle.Reset();
		DeactivateHandle.Reset();
		HeadOffHandle.Reset();
	}
	void CloseCapture()
	{
		Unwatch();
		if (!Capture.IsValid()) return;
		Capture->StopStream();
		Capture->CloseStream();
		Capture.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: capture device closed"));
	}
};

int32 ABpTable::TalkConsent()
{
	FString V;
	if (GConfig) GConfig->GetString(TalkSection, TEXT("Consent"), V, GGameUserSettingsIni);
	return V == TEXT("allow") ? 1 : V == TEXT("notnow") ? 2 : 0;
}

void ABpTable::SetTalkConsent(int32 Value)
{
	if (!GConfig) return;
	if (Value == 0) GConfig->RemoveKey(TalkSection, TEXT("Consent"), GGameUserSettingsIni);
	else GConfig->SetString(TalkSection, TEXT("Consent"), Value == 1 ? TEXT("allow") : TEXT("notnow"), GGameUserSettingsIni);
	GConfig->Flush(false, GGameUserSettingsIni);
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: consent %s (saved)"), Value == 1 ? TEXT("ALLOW") : Value == 2 ? TEXT("NOT NOW") : TEXT("unset"));
}

int32 ABpTable::TalkLampState() const
{
	if (!Talk.IsValid()) return 0;
	switch (Talk->Step)
	{
	case FBpTalkState::EStep::Arming:
	case FBpTalkState::EStep::Listening:
	case FBpTalkState::EStep::Hearing: return 1;
	case FBpTalkState::EStep::Thinking: return 2;
	case FBpTalkState::EStep::Speaking:
	case FBpTalkState::EStep::Sample: return 3;
	default: return 0;
	}
}

bool ABpTable::IsTalkListening() const
{
	return Talk.IsValid() && (Talk->Step == FBpTalkState::EStep::Listening || Talk->Step == FBpTalkState::EStep::Arming);
}

FString ABpTable::TalkStateWord() const
{
	if (!Talk.IsValid()) return FString();
	switch (Talk->Step)
	{
	case FBpTalkState::EStep::Arming: return TEXT("MICROPHONE…");
	case FBpTalkState::EStep::Listening: return TEXT("LISTENING");
	case FBpTalkState::EStep::Hearing: return TEXT("HEARING");
	case FBpTalkState::EStep::Thinking: return TEXT("THINKING");
	case FBpTalkState::EStep::Speaking: return TEXT("ANSWERING");
	case FBpTalkState::EStep::Sample: return TEXT("SAMPLE");
	default: return FString();
	}
}

FString ABpTable::TalkStateLine() const
{
	if (!Talk.IsValid() || Talk->Step == FBpTalkState::EStep::Idle) return FString();
	switch (Talk->Step)
	{
	case FBpTalkState::EStep::Arming: return TEXT("Opening the microphone…");
	case FBpTalkState::EStep::Listening: return TEXT("Listening: let go to send");
	case FBpTalkState::EStep::Hearing: return TEXT("Turning your words into text on your PC…");
	case FBpTalkState::EStep::Thinking: return FString::Printf(TEXT("You: \"%s\" · thinking (B cancels)"), *Talk->Heard.Left(60));
	case FBpTalkState::EStep::Speaking: return Talk->Reply.Left(90);
	case FBpTalkState::EStep::Sample: return TEXT("A sample exchange: no microphone, nothing sent");
	default: return FString();
	}
}

void ABpTable::LogTalk() const
{
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: stat step=%s consent=%d capture_open=%d held=%d tick_interval=%.2f"), Talk.IsValid() ? *TalkStateWord() : TEXT("none"), TalkConsent(),
		Talk.IsValid() && Talk->Capture.IsValid() ? 1 : 0, Talk.IsValid() && Talk->bHeld ? 1 : 0, GetActorTickInterval());
}

void ABpTable::TalkSays(const FString& Line, float Seconds)
{
	SayLamp(Line, true);
	if (Seconds > 0.f) LampCaptionClock = Seconds;
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}

void ABpTable::TalkIdle()
{
	if (!Talk.IsValid()) return;
	Talk->CloseCapture();
	if (UPointLightComponent* Light = Talk->Light.Get(); Light && Talk->LightBase >= 0.f) Light->SetIntensity(Talk->LightBase);
	Talk->Step = FBpTalkState::EStep::Idle;
	Talk->bHeld = false;
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}

bool ABpTable::TalkHold(const TCHAR* Source, bool bDown)
{
	if (CVarTalk.GetValueOnGameThread() == 0) return true;
	if (!Talk.IsValid()) Talk = MakeShared<FBpTalkState>();
	FBpTalkState& S = *Talk;
	const double Now = FPlatformTime::Seconds();
	if (bDown)
	{
		if (S.bHeld) return false;
		S.bHeld = true;
		S.Source = Source;
		S.DownAt = Now;
		S.bAskedConsent = false;
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: hold by %s"), Source);
		// Barge-in: the lamp's voice stops the moment the wearer talks (a tour line too).
		if (IsVoicePlaying()) { StopVoice(); UE_LOG(LogBpTable, Log, TEXT("BpTalk: the lamp's voice stopped (barge-in)")); }
		S.Queued.Reset();
		if (S.Step == FBpTalkState::EStep::Speaking || S.Step == FBpTalkState::EStep::Sample) { ++S.Serial; S.SampleAct.Reset(); S.Step = FBpTalkState::EStep::Idle; }
		// The microphone opens at once only when the wearer already said ALLOW (so the first words are not lost); anything
		// else waits for the hold to count (TickTalk), so a tap never raises a sheet.
		const bool bBundle = FBpLinkModule::Get().IsFromBundle();
		if (!bBundle && TalkConsent() == 1 && S.Step == FBpTalkState::EStep::Idle) TalkBegin();
		SetActorTickInterval(0.f);
		return false;
	}
	if (!S.bHeld) return false;
	S.bHeld = false;
	const double Held = Now - S.DownAt;
	if (Held < TalkMinHoldS)
	{
		// A tap: nothing recorded is kept and nothing is sent.
		if (S.Step == FBpTalkState::EStep::Arming || S.Step == FBpTalkState::EStep::Listening)
		{
			FScopeLock Guard(&S.Lock);
			S.Samples.Reset();
		}
		if (S.Step == FBpTalkState::EStep::Arming || S.Step == FBpTalkState::EStep::Listening) TalkIdle();
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: released by %s after %.2f s: under %.1f s, ignored (a tap)"), Source, Held, TalkMinHoldS);
		return true;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: released by %s after %.2f s"), Source, Held);
	if (FBpLinkModule::Get().IsFromBundle()) { TalkSample(); return false; }
	if (S.Step == FBpTalkState::EStep::Arming || S.Step == FBpTalkState::EStep::Listening) TalkSend();
	return false;
}

void ABpTable::TalkBegin()
{
	FBpTalkState& S = *Talk;
	FBpLinkModule& Link = FBpLinkModule::Get();
	const FBpLinkStatus& Status = Link.GetLinkStatus();
	if (S.Step == FBpTalkState::EStep::Thinking)
	{
		TalkSays(TEXT("I am still thinking about your last question.\nB or a pinch on me cancels it."));
		return;
	}
	if (!Link.HasPcLink())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: no PC link: nothing recorded"));
		TalkSays(TEXT("Connect to your PC to talk to me.\nMENU › ASK has three questions I answer here."));
		return;
	}
	if (Status.Pair == EBpPairState::Paired && !Status.Scopes.Contains(TEXT("standup")))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the pairing lacks standup: nothing recorded"));
		TalkSays(TEXT("This headset may not talk to me yet.\nPair it again with the stand-up (MENU › PC LINK)."));
		return;
	}
	if (TalkConsent() != 1)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: no consent (%d): nothing recorded, nothing sent"), TalkConsent());
		if (TalkConsent() == 2) TalkSays(TEXT("Talking is off: SETTINGS › TALK turns it on.\nMENU › ASK has three questions."));
		else if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->OpenConsole(TEXT("talk"));
		return;
	}
#if PLATFORM_ANDROID
	if (!UAndroidPermissionFunctionLibrary::CheckPermission(MicPermission))
	{
		bool bAskedBefore = false;
		if (GConfig) GConfig->GetBool(TalkSection, TEXT("MicAsked"), bAskedBefore, GGameUserSettingsIni);
		if (bAskedBefore || S.bPermissionAsked)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: no microphone permission (asked before): nothing recorded"));
			TalkSays(TEXT("I may not use the microphone.\nAllow it in the headset's Settings › Apps › Permissions."));
			return;
		}
		S.bPermissionAsked = true;
		if (GConfig) { GConfig->SetBool(TalkSection, TEXT("MicAsked"), true, GGameUserSettingsIni); GConfig->Flush(false, GGameUserSettingsIni); }
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: asking for the microphone permission (the first hold)"));
		TalkSays(TEXT("May I use the microphone?\nAnswer the headset's question, then hold again."));
		if (UAndroidPermissionCallbackProxy* Proxy = UAndroidPermissionFunctionLibrary::AcquirePermissions({ MicPermission }))
		{
			TWeakObjectPtr<ABpTable> Self(this);
			Proxy->OnPermissionsGrantedDelegate.AddLambda([Self](const TArray<FString>&, const TArray<bool>& Granted)
			{
				AsyncTask(ENamedThreads::GameThread, [Self, bOk = Granted.Num() > 0 && Granted[0]]()
				{
					ABpTable* T = Self.Get();
					if (!T) return;
					UE_LOG(LogBpTable, Log, TEXT("BpTalk: microphone permission %s"), bOk ? TEXT("granted") : TEXT("denied"));
					T->TalkSays(bOk ? TEXT("Thank you. Hold to talk to me.") : TEXT("No microphone: MENU › ASK still works.\nSettings › Apps › Permissions allows it later."));
				});
			});
		}
		return;
	}
#endif
	S.Serial++;
	// A capture still open (a hold the link's fall to the sample ended) is stopped and closed before a new one is made.
	S.CloseCapture();
	S.Capture = MakeUnique<Audio::FAudioCapture>();
	Audio::FCaptureDeviceInfo Info;
	if (!S.Capture->GetCaptureDeviceInfo(Info))
	{
		S.Capture.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: no capture device"));
		TalkSays(TEXT("I find no microphone on this device.\nMENU › ASK still works."));
		return;
	}
	{
		FScopeLock Guard(&S.Lock);
		S.Samples.Reset();
		S.Rate = 0;
		S.bCapped = false;
	}
	S.Peak = 0.f;
	S.bFlowing = false;
	S.Meter = 0.f;
	S.MeterShown = -1;
	FBpTalkState* Raw = &S;
	Audio::FAudioCaptureDeviceParams Params;
	const bool bOpen = S.Capture->OpenAudioCaptureStream(Params, [Raw](const void* Audio, int32 Frames, int32 Channels, int32 Rate, double, bool)
	{
		// The audio thread: downmix to mono and append, up to the route's 30 s; the peak for the meter.
		const float* In = static_cast<const float*>(Audio);
		if (!In || Frames <= 0 || Channels <= 0) return;
		float Peak = 0.f;
		FScopeLock Guard(&Raw->Lock);
		Raw->Rate = Rate;
		const int32 Max = FMath::RoundToInt(Rate * FBpLinkModule::ListenMaxS) - Rate / 10;
		for (int32 F = 0; F < Frames; ++F)
		{
			float Sum = 0.f;
			for (int32 C = 0; C < Channels; ++C) Sum += In[F * Channels + C];
			const float V = Sum / Channels;
			Peak = FMath::Max(Peak, FMath::Abs(V));
			if (Raw->Samples.Num() < Max) Raw->Samples.Add(V);
			else Raw->bCapped = true;
		}
		Raw->Peak = FMath::Max(Raw->Peak.load(), Peak);
		Raw->bFlowing = true;
	}, 1024);
	if (!bOpen || !S.Capture->StartStream())
	{
		S.Capture.Reset();
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the capture device %s did not open"), *Info.DeviceName);
		TalkSays(TEXT("The microphone did not open.\nMENU › ASK still works."));
		return;
	}
	S.Step = FBpTalkState::EStep::Arming;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: capture device opened: %s (%d Hz, %d ch)"), *Info.DeviceName, Info.PreferredSampleRate, Info.InputChannels);
	// Nothing recorded across a pause is sent: the app going away while the microphone is open drops the recording.
	{
		TWeakObjectPtr<ABpTable> Self(this);
		const auto Away = [Self](const TCHAR* Why) { if (ABpTable* T = Self.Get()) T->TalkAbandon(Why); };
		S.BackgroundHandle = FCoreDelegates::ApplicationWillEnterBackgroundDelegate.AddLambda([Away]() { Away(TEXT("the app went to the background")); });
		S.DeactivateHandle = FCoreDelegates::ApplicationWillDeactivateDelegate.AddLambda([Away]() { Away(TEXT("the app was deactivated")); });
		S.HeadOffHandle = FCoreDelegates::VRHeadsetRemovedFromHead.AddLambda([Away]() { Away(TEXT("the headset was taken off")); });
	}
	// The lamp's own light, when it can change at run time (a static light cannot: the caption's meter is then the level).
	if (!S.Light.IsValid())
	{
		for (const TWeakObjectPtr<AActor>& Each : LampGroup)
		{
			UPointLightComponent* Point = Each.IsValid() ? Each->FindComponentByClass<UPointLightComponent>() : nullptr;
			if (Point && Point->Mobility != EComponentMobility::Static) { S.Light = Point; break; }
		}
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the lamp's light %s"), S.Light.IsValid() ? TEXT("follows the level") : TEXT("is static: the caption's meter shows the level"));
	}
	if (UPointLightComponent* Light = S.Light.Get()) S.LightBase = Light->Intensity;
	TalkSays(TEXT("Opening the microphone…"), 60.f);
}

bool ABpTable::TickTalk(float DeltaSeconds)
{
	if (!Talk.IsValid()) return false;
	FBpTalkState& S = *Talk;
	const double Now = FPlatformTime::Seconds();
	// The app lost its focus (the Quest menu, the headset off; bp.TourFocus's rule, as the tour and the music pause): a hold
	// or a recording is dropped, so nothing heard across it is sent.
	if ((S.bHeld || S.Capture.IsValid()) && !BpAudio::HasFocus() && TalkAbandon(TEXT("the app lost its focus"))) return false;
	// The hold counts: what was waiting for it (the consent sheet, the words for no PC or no permission).
	if (S.bHeld && (S.Step == FBpTalkState::EStep::Idle || S.Step == FBpTalkState::EStep::Thinking) && !S.bAskedConsent && Now - S.DownAt >= TalkMinHoldS)
	{
		S.bAskedConsent = true;
		if (!FBpLinkModule::Get().IsFromBundle()) TalkBegin();
		else TalkSays(TEXT("SAMPLE · Talk to me\nLet go and you hear a sample exchange."), 30.f);
	}
	if (S.Step == FBpTalkState::EStep::Arming && S.bFlowing)
	{
		// Audio flows: only now is it listening (stt-pipeline: never "listening" before the first samples).
		S.Step = FBpTalkState::EStep::Listening;
		LampLookAt = EyeLocal();
		LampLookTarget = 1.f;
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: listening (audio flows at %d Hz)"), S.Rate);
		if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
	}
	if (S.Step == FBpTalkState::EStep::Listening)
	{
		bool bCapped = false;
		{
			FScopeLock Guard(&S.Lock);
			bCapped = S.bCapped;
		}
		if (bCapped)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: 30 s reached: sent as it stands"));
			S.bHeld = false;
			TalkSend();
			return false;
		}
		// The level: fast attack, slow decay (speech reads as motion, a pause does not read as death).
		const float Peak = S.Peak.exchange(0.f);
		const float Db = 20.f * FMath::LogX(10.f, FMath::Max(Peak, 1e-5f));
		const float In = FMath::Clamp((Db + 50.f) / 44.f, 0.f, 1.f);
		S.Meter = In > S.Meter ? In : FMath::Max(In, S.Meter - DeltaSeconds * 1.5f);
		const int32 Bars = FMath::RoundToInt(S.Meter * 8.f);
		if (Bars != S.MeterShown)
		{
			S.MeterShown = Bars;
			FString Meter;
			for (int32 I = 0; I < 8; ++I) Meter += I < Bars ? TEXT("■") : TEXT("□");
			LampLine = FString::Printf(TEXT("LISTENING  %s\nLet go to send · up to 30 s"), *Meter);
			SayLamp(LampLine, true);
			LampCaptionClock = 60.f;
		}
		if (UPointLightComponent* Light = S.Light.Get(); Light && S.LightBase >= 0.f)
		{
			Light->SetIntensity(S.LightBase * (1.f + FMath::Clamp(CVarTalkLightGain.GetValueOnGameThread(), 0.f, 4.f) * S.Meter));
		}
		return true;
	}
	if (S.Step == FBpTalkState::EStep::Thinking)
	{
		// The turn may take minutes: the caption stays, and says how long.
		LampCaptionClock = FMath::Max(LampCaptionClock, 2.f);
		return false;
	}
	if (S.Step == FBpTalkState::EStep::Speaking || S.Step == FBpTalkState::EStep::Sample)
	{
		// A reply waiting behind a tour line speaks once it is done; then the talk is over when the voice is.
		if (S.Queued.Num() > 0 && !IsVoicePlaying())
		{
			const TArray<uint8> Wav = MoveTemp(S.Queued);
			S.Queued.Reset();
			S.bSpoke = PlayVoiceWav(Wav, TEXT("talk"));
		}
		else if (S.Queued.Num() == 0 && !S.bAwaitSay && !IsVoicePlaying())
		{
			const FString Act = S.SampleAct;
			S.SampleAct.Reset();
			S.Step = FBpTalkState::EStep::Idle;
			if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: the reply is done%s"), Act.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; the sample acts: %s"), *Act));
			if (Act == TEXT("next")) AskNextStep(TEXT("sample"));
			else if (Act == TEXT("scan")) AskScanThis(TEXT("sample"));
			else if (Act == TEXT("plan")) { if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->OpenConsole(TEXT("standup")); }
		}
	}
	return false;
}

void ABpTable::TalkSend()
{
	FBpTalkState& S = *Talk;
	TArray<float> Samples;
	int32 Rate = 0;
	S.CloseCapture();
	{
		FScopeLock Guard(&S.Lock);
		Samples = MoveTemp(S.Samples);
		S.Samples.Reset();
		Rate = S.Rate;
	}
	if (UPointLightComponent* Light = S.Light.Get(); Light && S.LightBase >= 0.f) Light->SetIntensity(S.LightBase);
	LampLookTarget = 0.f;
	if (Samples.Num() == 0 || Rate <= 0)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: no audio came from the microphone: nothing sent"));
		S.Step = FBpTalkState::EStep::Idle;
		TalkSays(TEXT("No sound came from the microphone.\nCheck that it is not muted, then hold again."), 8.f);
		return;
	}
	const TArray<int16> Pcm = Resample(Samples, Rate);
	const TArray<uint8> Wav = WavOf(Pcm, SendRate);
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: recorded %.1f s at %d Hz -> %d samples at %d Hz, %d bytes"), Samples.Num() / static_cast<float>(Rate), Rate, Pcm.Num(), SendRate, Wav.Num());
	TalkFromWav(Wav, TEXT("microphone"));
}

void ABpTable::TalkFromWav(const TArray<uint8>& Wav, const TCHAR* Route)
{
	if (!Talk.IsValid()) Talk = MakeShared<FBpTalkState>();
	FBpTalkState& S = *Talk;
	if (TalkConsent() != 1)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s: no consent: nothing sent"), Route);
		TalkIdle();
		return;
	}
	if (!FBpLinkModule::Get().HasPcLink())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s: no PC link: nothing sent"), Route);
		TalkIdle();
		TalkSays(TEXT("Connect to your PC to talk to me.\nMENU › ASK has three questions I answer here."), 10.f);
		return;
	}
	S.Step = FBpTalkState::EStep::Hearing;
	const int32 Serial = ++S.Serial;
	TalkSays(TEXT("…\nTurning your words into text"), 60.f);
	const double Sent = FPlatformTime::Seconds();
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().PostListen(Wav, true, [Self, Serial, Sent](int32 Status, const FString& Text, const FString& Heard, int32, const FString& Body)
	{
		ABpTable* T = Self.Get();
		if (!T || !T->Talk.IsValid() || T->Talk->Serial != Serial) return;
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: listen took %.2f s"), FPlatformTime::Seconds() - Sent);
		const FString Error = ErrorOf(Body);
		FString Words;
		if (Status == 200 && Heard == TEXT("speech") && !Text.TrimStartAndEnd().IsEmpty()) { T->TalkTurn(Text.TrimStartAndEnd()); return; }
		if (Status == 200) Words = Heard == TEXT("silence") ? TEXT("I did not hear anything.\nHold, speak, then let go.") : TEXT("I heard sound but no words.\nHold and try again, a little closer.");
		else if (Status == 429) { Words = FBpLinkModule::RefusalWords(Body); if (Words.IsEmpty()) Words = TEXT("One moment: your PC is busy.\nHold again in a moment."); }
		else if (Status == 403 && Error == TEXT("speech-off")) Words = TEXT("Your PC has speech turned off.\nMENU › ASK still works.");
		else if (Status == 403) Words = TEXT("Your PC refused to listen.\nPair again with the stand-up (MENU › PC LINK).");
		else if (Status == 503 && Error == TEXT("no-speech-key")) Words = TEXT("Your PC has no speech service set up.\nMENU › ASK still works.");
		else if (Status == 413) Words = TEXT("That was too long for me.\n30 seconds at most.");
		else if (Status == 502 || Status == 503) Words = TEXT("The speech service did not answer.\nTry again, or use MENU › ASK.");
		else if (Status == 0) Words = TEXT("Your PC did not answer.\nConnect to your PC to talk to me.");
		else Words = FString::Printf(TEXT("Your PC answered %d.\nTry again, or use MENU › ASK."), Status);
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: listen ended without words: status %d heard %s error %s"), Status, Heard.IsEmpty() ? TEXT("-") : *Heard, Error.IsEmpty() ? TEXT("-") : *Error);
		T->TalkIdle();
		T->TalkSays(Words, 10.f);
	});
}

void ABpTable::TalkFromText(const FString& Text, const TCHAR* Route)
{
	if (!Talk.IsValid()) Talk = MakeShared<FBpTalkState>();
	if (Text.TrimStartAndEnd().IsEmpty()) return;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s: the turn from text (no microphone)"), Route);
	++Talk->Serial;
	TalkTurn(Text.TrimStartAndEnd());
}

void ABpTable::TalkTurn(const FString& Heard)
{
	FBpTalkState& S = *Talk;
	FBpLinkModule& Link = FBpLinkModule::Get();
	S.Heard = Heard;
	if (!Link.HasPcLink())
	{
		TalkIdle();
		TalkSays(TEXT("Connect to your PC to talk to me.\nMENU › ASK has three questions I answer here."), 10.f);
		return;
	}
	S.Step = FBpTalkState::EStep::Thinking;
	S.ThinkFrom = FPlatformTime::Seconds();
	const int32 Serial = S.Serial;
	// The heard words first, so a mishearing is visible before anything acts on it.
	TalkSays(FString::Printf(TEXT("You: \"%s\"\nThinking… B or a pinch on me cancels"), *Heard.Left(80)), 600.f);
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: heard %d chars; the companion's turn is asked"), Heard.Len());
	// The place as context: the room in view, else the lifted one, else the site.
	const FString Target = DirectedTarget();
	const FString Place = DirectedLabel(Target);
	const FString Text = FString::Printf(TEXT("(Spoken aloud at the VR table; it shows %s%s on %s. Answer in two short spoken sentences.) %s"),
		Place.IsEmpty() ? TEXT("the site plan") : *Place, Target.IsEmpty() || Target == TEXT("site") ? TEXT("") : *FString::Printf(TEXT(" [%s]"), *Target), *Link.GetProductSlug(), *Heard);
	TWeakObjectPtr<ABpTable> Self(this);
	Link.PostCompanionTurn(Text, [Self, Serial](const FBpCompanionTurn& Turn)
	{
		ABpTable* T = Self.Get();
		if (!T || !T->Talk.IsValid()) return;
		const double Took = FPlatformTime::Seconds() - T->Talk->ThinkFrom;
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the turn ended in %.1f s: outcome %d, %d chars%s%s"), Took, static_cast<int32>(Turn.Outcome), Turn.Text.Len(),
			Turn.CardSummary.IsEmpty() ? TEXT("") : TEXT(", a pending card"), Turn.FocusKind.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", focus %s %s"), *Turn.FocusKind, *Turn.FocusId));
		if (T->Talk->Serial != Serial) { UE_LOG(LogBpTable, Log, TEXT("BpTalk: the turn's answer is dropped (cancelled)")); return; }
		const FString You = FString::Printf(TEXT("You: \"%s\""), *T->Talk->Heard.Left(60));
		switch (Turn.Outcome)
		{
		case FBpCompanionTurn::EOutcome::Busy:
			T->TalkIdle();
			T->TalkSays(You + TEXT("\nOne moment: I am answering another question."), 10.f);
			return;
		case FBpCompanionTurn::EOutcome::Failed:
			T->TalkIdle();
			// A refusal with its own sentence (the turn's 429 budget) says it; never retried.
			T->TalkSays(You + TEXT("\n") + (Turn.Words.IsEmpty() ? FString(TEXT("I could not answer that. Ask again, or look on your PC.")) : Turn.Words), 10.f);
			return;
		case FBpCompanionTurn::EOutcome::Unreached:
			T->TalkIdle();
			T->TalkSays(You + TEXT("\nYour PC did not answer."), 10.f);
			return;
		default:
			break;
		}
		FString Reply = Turn.Text.TrimStartAndEnd().Replace(TEXT("\n"), TEXT(" "));
		if (Reply.IsEmpty()) Reply = Turn.CardSummary.IsEmpty() ? FString(TEXT("Done.")) : FString::Printf(TEXT("I need your yes for this: %s"), *Turn.CardSummary);
		T->LampAnswer = You + TEXT("\n") + Reply;
		T->LampNotifyAsk();
		if (Turn.FocusKind == TEXT("room")) T->PresentLamp(T->LampTargetForRoom(Turn.FocusId), TEXT("talk focus"));
		else if (Turn.FocusKind == TEXT("feature")) T->PresentLamp(T->LampTargetForFeature(Turn.FocusId), TEXT("talk focus"));
		// A write the companion wants waits for the wearer: its card on the console, as the stand-up shows it.
		if (!Turn.CardSummary.IsEmpty())
		{
			if (ABpPawn* Pawn = TalkPawn(T->GetWorld())) Pawn->StandupShowCompanionCards();
		}
		T->TalkSpeak(Reply);
	});
}

void ABpTable::TalkSpeak(const FString& Reply)
{
	FBpTalkState& S = *Talk;
	S.Reply = Reply;
	S.Step = FBpTalkState::EStep::Speaking;
	S.bSpoke = false;
	const FString You = FString::Printf(TEXT("You: \"%s\""), *S.Heard.Left(60));
	const FString Body = Reply.Len() > 150 ? Reply.Left(149).TrimEnd() + BpType::Ellipsis() : Reply;
	TalkSays(You + TEXT("\n") + Body, 30.f);
	const int32 Serial = S.Serial;
	S.bAwaitSay = true;
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().PostSay(Reply, [Self, Serial](int32 Status, const TArray<uint8>& Wav, const FString& Body)
	{
		ABpTable* T = Self.Get();
		if (T && T->Talk.IsValid()) T->Talk->bAwaitSay = false;
		if (!T || !T->Talk.IsValid() || T->Talk->Serial != Serial || T->Talk->Step != FBpTalkState::EStep::Speaking) return;
		if (Status != 200 || Wav.Num() == 0)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: no voice for the reply (status %d %s): the caption carries it"), Status, *ErrorOf(Body));
			// A 429 with its own sentence (the voice budget): the talk ends with those words on the caption (the reply stays on
			// the wrist), and nothing is asked again.
			const FString Refusal = Status == 429 ? FBpLinkModule::RefusalWords(Body) : FString();
			if (!Refusal.IsEmpty())
			{
				T->TalkIdle();
				T->TalkSays(Refusal, 10.f);
			}
			return;
		}
		int32 Rate = 0, Channels = 0, Offset = 0, Bytes = 0;
		const float Seconds = BpAudio::ReadWav(Wav, Rate, Channels, Offset, Bytes) && Rate > 0 && Channels > 0 ? Bytes / (2.f * Channels * Rate) : 0.f;
		// Queued behind a tour line still sounding; else at once.
		if (T->IsVoicePlaying() && T->TourVoiceClip != TEXT("talk"))
		{
			T->Talk->Queued = Wav;
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: the reply's voice (%.1f s) waits for the tour's line"), Seconds);
			return;
		}
		T->Talk->bSpoke = T->PlayVoiceWav(Wav, TEXT("talk"));
		T->LampCaptionClock = FMath::Max(T->LampCaptionClock, Seconds + 4.f);
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the reply spoken: %.1f s at %d Hz"), Seconds, Rate);
	});
}

bool ABpTable::TalkCancel(const TCHAR* Why)
{
	if (!Talk.IsValid() || Talk->Step == FBpTalkState::EStep::Idle) return false;
	FBpTalkState& S = *Talk;
	const FBpTalkState::EStep Was = S.Step;
	++S.Serial;
	S.bAwaitSay = false;
	S.Queued.Reset();
	S.SampleAct.Reset();
	if (Was == FBpTalkState::EStep::Speaking || Was == FBpTalkState::EStep::Sample) StopVoice();
	// The turn being thought about is called off on the wire too, so the companion is free for the next question at once
	// (otherwise every talk, PLAN MY DAY and the lamp's ask answer "busy" until the old turn's ten minutes run out).
	if (Was == FBpTalkState::EStep::Thinking) FBpLinkModule::Get().CancelCompanionTurn(Why);
	{
		FScopeLock Guard(&S.Lock);
		S.Samples.Reset();
	}
	TalkIdle();
	LampLookTarget = 0.f;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: cancelled by %s (was %d)"), Why, static_cast<int32>(Was));
	TalkSays(Was == FBpTalkState::EStep::Thinking ? TEXT("Cancelled: I will not answer that one.") : TEXT("Stopped."), 3.f);
	return true;
}

bool ABpTable::TalkAbandon(const TCHAR* Why)
{
	if (!Talk.IsValid()) return false;
	FBpTalkState& S = *Talk;
	const bool bRecording = S.Capture.IsValid() || S.Step == FBpTalkState::EStep::Arming || S.Step == FBpTalkState::EStep::Listening;
	if (!bRecording && !S.bHeld) return false;
	// The hold is over: its release (X up, the pinch let go) finds nothing held and sends nothing.
	S.bHeld = false;
	if (!bRecording)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s during a hold: the hold dropped (nothing was recorded)"), Why);
		return true;
	}
	++S.Serial;
	{
		FScopeLock Guard(&S.Lock);
		S.Samples.Reset();
		S.bCapped = false;
	}
	TalkIdle();
	LampLookTarget = 0.f;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s while recording: the microphone closed, what it heard dropped, nothing sent"), Why);
	TalkSays(TEXT("Paused: I did not keep or send what I heard.\nHold again to talk to me."), 8.f);
	return true;
}

void ABpTable::TalkSample()
{
	FBpTalkState& S = *Talk;
	// A hold that began linked and ended on the sample (the PC went meanwhile) still has the microphone open: it is closed
	// here, and the lamp's light put back, before the sample plays. Nothing it heard is sent.
	if (S.Capture.IsValid())
	{
		{
			FScopeLock Guard(&S.Lock);
			S.Samples.Reset();
		}
		S.CloseCapture();
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the link fell to the sample during the hold: the microphone closed, nothing sent"));
	}
	if (UPointLightComponent* Light = S.Light.Get(); Light && S.LightBase >= 0.f) Light->SetIntensity(S.LightBase);
	LampLookTarget = 0.f;
	// The place in view picks the ask: inside a room, scan it; on a lifted wing or room, plan the day; the site, what next.
	const FString Id = !RoomModeId.IsEmpty() ? TEXT("scan") : GetBpLevel() != EBpLevel::L0 ? TEXT("plan") : TEXT("next");
	FTalkSampleLine Line;
	if (!ReadSample(Id, Line))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: no sample line %s in the bundle"), *Id);
		TalkSays(TEXT("SAMPLE · Talking needs your PC.\nMENU › ASK has three questions I answer here."), 10.f);
		return;
	}
	++S.Serial;
	S.Step = FBpTalkState::EStep::Sample;
	S.Heard = Line.Ask;
	S.Reply = Line.Reply;
	S.SampleAct = Id;
	TArray<uint8> Wav;
	const FString Path = FPaths::ProjectContentDir() / TEXT("BpData/voice/talk") / (Id + TEXT(".wav"));
	FFileHelper::LoadFileToArray(Wav, *Path, FILEREAD_Silent);
	TalkSays(FString::Printf(TEXT("SAMPLE · You: \"%s\"\n%s"), *Line.Ask, *Line.Reply), 20.f);
	const bool bVoice = PlayVoiceWav(Wav, TEXT("talk"));
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: sample exchange %s (no microphone opened): \"%s\" -> \"%s\"%s"), *Id, *Line.Ask, *Line.Reply, bVoice ? TEXT(", voiced") : TEXT(", captions only (no clip)"));
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}
