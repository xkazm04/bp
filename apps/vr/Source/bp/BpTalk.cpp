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
//   thinking  A turn with no reply words after bp.TalkThinkS (1.5 s) has Glim say one short bundled line (BpTourBook's
//             ThinkLines, in turn), once a turn, never over another line; bp.TalkStubReplyS stands a stub reply in for tests.
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
#include "BpSheet.h"
#include "BpStore.h"
#include "BpTourBook.h"
#include "Components/PointLightComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/ScopeExit.h"
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
	TAutoConsoleVariable<float> CVarTalkLingerS(TEXT("bp.TalkLingerS"), 6.f, TEXT("After the lamp's spoken reply ends, the conversation stays on the console this many seconds, then clears itself (1 to 30)."));
	TAutoConsoleVariable<int32> CVarTalkSpokenMax(TEXT("bp.TalkSpokenMax"), 280, TEXT("The lamp speaks a reply's first sentences up to this many characters, cut at a sentence end (the caption keeps it whole; 80 to 1200)."));
	TAutoConsoleVariable<float> CVarTalkRepliesLingerS(TEXT("bp.TalkRepliesLingerS"), 30.f, TEXT("G2: with quick replies under Glim's answer, the conversation stays this many seconds after his voice ends (1 to 120)."));
	TAutoConsoleVariable<float> CVarTalkLightGain(TEXT("bp.TalkLightGain"), 1.5f, TEXT("While listening the lamp's light rises by up to this share of its own intensity with the input level (0 to 4; 0: the light stays)."));
	TAutoConsoleVariable<float> CVarTalkThinkS(TEXT("bp.TalkThinkS"), 1.5f, TEXT("Wave W2 (G4): a talk turn with no reply words this many seconds after the ask has Glim say a short thinking line (BpTourBook ThinkLines, one a turn, in turn; 0.5 to 10; 0: never)."));
	TAutoConsoleVariable<float> CVarTalkStubReplyS(TEXT("bp.TalkStubReplyS"), 0.f, TEXT("For tests (PIE): above 0, a talk turn sends nothing and answers a fixed stub reply after this many seconds, with no PC and no network (0.1 to 60; 0: off, the real turn)."));

	/** Whether a clip is one of Glim's thinking lines (BpTourBook::ThinkLines). */
	bool IsThinkLine(const FString& Clip)
	{
		return BpTourBook::HasLine(BpTourBook::ThinkLines(), Clip);
	}

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

	/** A reply's first sentences, at most Max characters, cut after a sentence's end (". ", "! ", "? "); one sentence longer
	 *  than Max is cut at the last word before it. */
	FString SpokenPart(const FString& Reply, int32 Max)
	{
		if (Reply.Len() <= Max) return Reply;
		int32 Cut = INDEX_NONE;
		for (int32 I = 0; I < Reply.Len() - 1 && I < Max; ++I)
		{
			const TCHAR C = Reply[I];
			if ((C == TEXT('.') || C == TEXT('!') || C == TEXT('?')) && FChar::IsWhitespace(Reply[I + 1])) Cut = I + 1;
		}
		if (Cut == INDEX_NONE)
		{
			Cut = Reply.Left(Max).Find(TEXT(" "), ESearchCase::CaseSensitive, ESearchDir::FromEnd);
			return (Cut > 0 ? Reply.Left(Cut) : Reply.Left(Max)) + TEXT(".");
		}
		return Reply.Left(Cut);
	}

	/** Wave U5: what Glim is doing, in plain words, for one of his tools (a tool's id is never shown to the person). The table is
	 *  the conversation sheet's while he thinks: one line per step, newest last, at most TalkStepsShown. */
	constexpr int32 TalkStepsShown = 3;
	FString StepWords(const FString& Tool)
	{
		struct FStep { const TCHAR* Tool; const TCHAR* Words; };
		static const FStep Steps[] = {
			{ TEXT("morning.brief"), TEXT("Reading this morning's decisions") },
			{ TEXT("next.steps"), TEXT("Ranking what to do next") },
			{ TEXT("inbox.list"), TEXT("Looking through the open findings") },
			{ TEXT("plan.find"), TEXT("Reading the plan") },
			{ TEXT("plan.brief"), TEXT("Reading the plan") },
			{ TEXT("focus.show"), TEXT("Opening it for you") },
			{ TEXT("help.find"), TEXT("Looking that up") },
		};
		for (const FStep& S : Steps) if (Tool == S.Tool) return S.Words;
		if (Tool.StartsWith(TEXT("scan."))) return TEXT("Setting up a scan");
		if (Tool.StartsWith(TEXT("wave."))) return TEXT("Putting the day together");
		return TEXT("Working on it");
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
	FAutoConsoleCommandWithWorldAndArgs CmdTalkReply(TEXT("BpTalk.Reply"), TEXT("BpTalk.Reply <1..3>: presses quick reply n under Glim's last answer (its words go as the next turn, as the sheet's button sends them)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const int32 N = Args.Num() > 0 ? FCString::Atoi(*Args[0]) : 1;
			WithTalkTables(World, [N](ABpTable& T) { T.TalkReply(N, TEXT("BpTalk.Reply")); });
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
	FAutoConsoleCommandWithWorldAndArgs CmdTalkPreview(TEXT("BpTalk.Preview"), TEXT("BpTalk.Preview listening|thinking|answering [heard words | reply]: a still of the conversation for captures (no microphone, nothing sent or spoken); BpTalk.Cancel ends it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const FString Step = Args.Num() > 0 ? Args[0] : FString(TEXT("answering"));
			FString Heard, Reply;
			if (!FString::Join(TArray<FString>(Args.GetData() + FMath::Min(1, Args.Num()), FMath::Max(0, Args.Num() - 1)), TEXT(" ")).Split(TEXT("|"), &Heard, &Reply)) Heard = TEXT("plan my day");
			WithTalkTables(World, [&](ABpTable& T) { T.TalkPreview(Step, Heard.TrimStartAndEnd(), Reply.TrimStartAndEnd()); });
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkCancel(TEXT("BpTalk.Cancel"), TEXT("BpTalk.Cancel: what B or a pinch on the lamp does to a talk in flight."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithTalkTables(World, [](ABpTable& T) { T.TalkCancel(TEXT("console")); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdTalkFocus(TEXT("BpTalk.Focus"), TEXT("BpTalk.Focus <page|room|wing|feature|decision> <id> [<kind> <id>]...: acts on a turn's focus events, one per step (wave U2: scripted tests of a page Glim opens; U4: several, to test a queue that must not outlive its conversation)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			TArray<FBpTurnFocus> Focuses;
			for (int32 I = 0; I + 1 < Args.Num(); I += 2)
			{
				FBpTurnFocus& F = Focuses.AddDefaulted_GetRef();
				F.TargetKind = Args[I];
				F.TargetId = Args[I + 1];
			}
			if (Focuses.Num() == 0) return;
			WithTalkTables(World, [&Focuses](ABpTable& T) { T.TalkActOnFocus(Focuses, FPlatformTime::Seconds()); });
		}));
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
	/** G2: the last turn's quick replies (or the sample's: the other sample lines, Say holding the line's id), dropped when a new
	 *  turn starts or the person speaks. */
	TArray<FBpQuickReply> Replies;
	bool bSampleReplies = false;
	/** G2: when the turn now out was asked (its focus events lose to anything the person did since). */
	double AskedAt = 0.0;
	/** Wave U5, the turn as it streams: what Glim is doing (plain words, newest last, at most TalkStepsShown), his words so far
	 *  (plain), how many of its focus events the table already acted on, whether its pending card is already on the wall, and
	 *  when the first step and the first words came (seconds after the ask; 0: not yet). */
	TArray<FString> Steps;
	FString LiveText;
	int32 FocusesDone = 0;
	bool bCardShown = false;
	double FirstStepS = 0.0, FirstTextS = 0.0;
	/** Wave W2 (G4): the turns asked so far (for the log), the turn whose thinking line was said (at most one a turn), the next
	 *  of ThinkLines to say (in turn, so never the same twice running), and the timers of the line and of bp.TalkStubReplyS. */
	int32 Turns = 0;
	int32 ThoughtTurn = 0;
	int32 ThinkNext = 0;
	FTimerHandle ThinkTimer;
	FTimerHandle StubTimer;
	void ResetLive()
	{
		Steps.Reset();
		LiveText.Reset();
		FocusesDone = 0;
		bCardShown = false;
		FirstStepS = FirstTextS = 0.0;
	}
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
	FBpStore::GetString(TalkSection, TEXT("Consent"), V);
	return V == TEXT("allow") ? 1 : V == TEXT("notnow") ? 2 : 0;
}

void ABpTable::SetTalkConsent(int32 Value)
{
	if (Value == 0) FBpStore::RemoveKey(TalkSection, TEXT("Consent"));
	else FBpStore::SetString(TalkSection, TEXT("Consent"), Value == 1 ? TEXT("allow") : TEXT("notnow"));
	FBpStore::Flush();
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
	case FBpTalkState::EStep::Arming: return TEXT("MICROPHONE");
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
	case FBpTalkState::EStep::Arming: return TEXT("Opening the microphone");
	case FBpTalkState::EStep::Listening: return TEXT("Listening: let go to send");
	case FBpTalkState::EStep::Hearing: return TEXT("Turning your words into text on your PC");
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
	bTalkCaption = true;
	if (Seconds > 0.f) LampCaptionClock = Seconds;
	ApplyLampWidgets();
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}

bool ABpTable::TalkOnConsole() const
{
	const ABpPawn* Pawn = TalkPawn(GetWorld());
	return Pawn && Pawn->ConsoleShowsTalk();
}

bool ABpTable::WallSheetOpen() const
{
	const ABpPawn* Pawn = TalkPawn(GetWorld());
	// The panel is far only while a page, the stand-up or the conversation is up (closed, the bar is at the desk).
	return Pawn && Pawn->IsConsoleFar();
}

void ABpTable::TalkCaptionEnded()
{
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}

bool ABpTable::TalkView(FTalkView& Out) const
{
	if (!bTalkCaption || LampLine.IsEmpty() || LampCaptionClock <= 0.f) return false;
	Out = FTalkView();
	Out.Word = TalkStateWord();
	FString Line = LampLine;
	if (Line.StartsWith(TEXT("SAMPLE · "))) { Out.bSample = true; Line = Line.Mid(9); }
	if (Talk.IsValid() && Talk->Step == FBpTalkState::EStep::Listening) Out.Level = FMath::Clamp(Talk->MeterShown / 8.f, 0.f, 1.f);
	FString First, Rest;
	if (!Line.Split(TEXT("\n"), &First, &Rest)) { First = Line; Rest.Reset(); }
	if (First.StartsWith(TEXT("You: \"")))
	{
		// The words heard, whole (the caption carried 60 or 80 characters of them), so a mishearing is visible.
		Out.Heard = Talk.IsValid() && !Talk->Heard.IsEmpty() ? Talk->Heard : First.Mid(6).LeftChop(1);
		// The reply, whole (the caption carried 150 characters of it).
		if (Talk.IsValid() && !Talk->Reply.IsEmpty() && !Rest.IsEmpty() && Talk->Reply.StartsWith(Rest.Left(20))) Rest = Talk->Reply;
		Out.Reply = Rest;
	}
	else Out.Line = Line;
	// Wave U5: while he thinks, what he is doing and his words so far (whole), as they stream.
	if (Talk.IsValid() && Talk->Step == FBpTalkState::EStep::Thinking && !Out.Heard.IsEmpty())
	{
		Out.Steps = Talk->Steps;
		Out.Reply = Talk->LiveText;
	}
	// G2: the quick replies, once the answer is in (never while listening, hearing or thinking).
	if (Talk.IsValid() && (Talk->Step == FBpTalkState::EStep::Idle || Talk->Step == FBpTalkState::EStep::Speaking || Talk->Step == FBpTalkState::EStep::Sample) && !Out.Heard.IsEmpty())
	{
		for (const FBpQuickReply& R : Talk->Replies) Out.Replies.Add(R.Label);
	}
	return true;
}

bool ABpTable::TalkReply(int32 N, const TCHAR* Route)
{
	if (!Talk.IsValid() || !Talk->Replies.IsValidIndex(N - 1))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s: no quick reply %d (%d shown)"), Route, N, Talk.IsValid() ? Talk->Replies.Num() : 0);
		return false;
	}
	FBpTalkState& S = *Talk;
	const FBpQuickReply Pick = S.Replies[N - 1];
	const bool bSample = S.bSampleReplies;
	S.Replies.Reset();
	S.bSampleReplies = false;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: %s: quick reply %d \"%s\" pressed: \"%s\" goes as the next turn%s"), Route, N, *Pick.Label, *Pick.Say, bSample ? TEXT(" (the sample's line)") : TEXT(""));
	// The press is the person speaking: Glim's voice stops (barge-in), as a hold does.
	if (IsVoicePlaying()) StopVoice();
	S.Queued.Reset();
	S.bAwaitSay = false;
	S.SampleAct.Reset();
	if (bSample)
	{
		S.Step = FBpTalkState::EStep::Idle;
		TalkSample(Pick.Say);
		return true;
	}
	TalkFromText(Pick.Say, Route);
	return true;
}

void ABpTable::TalkPreview(const FString& Step, const FString& Heard, const FString& ReplyIn)
{
	// As a real turn's words are drawn (wave U2): plain, without markdown's marks.
	const FString Reply = BpSheet::PlainWords(ReplyIn);
	if (!Talk.IsValid()) Talk = MakeShared<FBpTalkState>();
	FBpTalkState& S = *Talk;
	++S.Serial;
	S.Heard = Heard;
	S.Reply = Reply;
	const FString You = FString::Printf(TEXT("You: \"%s\""), *Heard.Left(60));
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: preview %s (a still: no microphone, nothing sent)"), *Step);
	if (Step == TEXT("listening"))
	{
		S.Step = FBpTalkState::EStep::Listening;
		S.MeterShown = 5;
		TalkSays(TEXT("LISTENING  ■■■■■□□□\nLet go to send · up to 30 s"), 60.f);
	}
	else if (Step == TEXT("thinking"))
	{
		S.Step = FBpTalkState::EStep::Thinking;
		// Wave U5: with a reply, the still of a streaming turn: two steps done and his words so far.
		S.ResetLive();
		if (!Reply.IsEmpty())
		{
			S.Steps = { StepWords(TEXT("morning.brief")), StepWords(TEXT("next.steps")) };
			S.LiveText = Reply;
		}
		TalkSays(You + TEXT("\n") + (Reply.IsEmpty() ? FString(TEXT("Thinking… B or a pinch on me cancels")) : Reply.Left(150)), 60.f);
	}
	else
	{
		// Answering: held there (as if its voice were still being rendered) until BpTalk.Cancel.
		S.Step = FBpTalkState::EStep::Speaking;
		S.bAwaitSay = true;
		TalkSays(You + TEXT("\n") + Reply.Left(150), 60.f);
	}
}

void ABpTable::TalkDismiss()
{
	if (Talk.IsValid() && Talk->Step != FBpTalkState::EStep::Idle) TalkCancel(TEXT("the conversation's CLOSE"));
	TalkFocusClear(TEXT("the conversation's CLOSE"));
	// The words leave on the next tick (the caption's clock ends them, the lamp turns back and goes home as after any line).
	if (bTalkCaption && LampCaptionClock > 0.05f) LampCaptionClock = 0.05f;
	SetActorTickInterval(0.f);
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
		// The person speaks: the last answer's quick replies go.
		S.Replies.Reset();
		S.bSampleReplies = false;
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
	++TalkHoldsCounted;
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
		FBpStore::GetBool(TalkSection, TEXT("MicAsked"), bAskedBefore);
		if (bAskedBefore || S.bPermissionAsked)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: no microphone permission (asked before): nothing recorded"));
			TalkSays(TEXT("I may not use the microphone.\nAllow it in the headset's Settings › Apps › Permissions."));
			return;
		}
		S.bPermissionAsked = true;
		FBpStore::SetBool(TalkSection, TEXT("MicAsked"), true);
		FBpStore::Flush();
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
	TalkSays(TEXT("Opening the microphone"), 60.f);
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
			bTalkCaption = true;
			ApplyLampWidgets();
			LampCaptionClock = 60.f;
			// The console's level meter: one redraw per step of the eight (its key), only while listening.
			if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
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
			// The voice ended: the exchange stays readable a little longer (bp.TalkLingerS), then clears itself. A reply that was
			// never voiced keeps its reading time.
			// G2: quick replies keep it up longer (bp.TalkRepliesLingerS), so there is time to reach for one.
			const float Linger = FMath::Clamp(CVarTalkLingerS.GetValueOnGameThread(), 1.f, 30.f);
			const float Keep = S.Replies.Num() > 0 ? FMath::Max(Linger, FMath::Clamp(CVarTalkRepliesLingerS.GetValueOnGameThread(), 1.f, 120.f)) : Linger;
			if (S.bSpoke && bTalkCaption) LampCaptionClock = FMath::Min(LampCaptionClock, Keep);
			else if (S.Replies.Num() > 0 && bTalkCaption) LampCaptionClock = FMath::Max(LampCaptionClock, Keep);
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
	// For tests (PIE): bp.TalkStubReplyS answers a stub after its seconds, with no PC, so the thinking line can be heard.
	const float StubS = CVarTalkStubReplyS.GetValueOnGameThread();
	const bool bStub = StubS > 0.f;
	if (!bStub && !Link.HasPcLink())
	{
		TalkIdle();
		TalkSays(TEXT("Connect to your PC to talk to me.\nMENU › ASK has three questions I answer here."), 10.f);
		return;
	}
	S.Step = FBpTalkState::EStep::Thinking;
	S.ThinkFrom = FPlatformTime::Seconds();
	S.AskedAt = S.ThinkFrom;
	S.Replies.Reset();
	S.bSampleReplies = false;
	// A new turn: what Glim opened for the last one gives the sheet back to the conversation.
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkUnyield();
	const int32 Serial = S.Serial;
	// The heard words first, so a mishearing is visible before anything acts on it.
	TalkSays(FString::Printf(TEXT("You: \"%s\"\nThinking… B or a pinch on me cancels"), *Heard.Left(80)), 600.f);
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: heard %d chars; the companion's turn is asked"), Heard.Len());
	// G2: the person's words alone; where they are goes beside them as the surface (the old "(Spoken aloud at the VR table; ...)"
	// prefix is gone): the place, the target "this one" means, spoken.
	const FBpTurnSurface Surface = TurnSurface(true);
	TWeakObjectPtr<ABpTable> Self(this);
	S.ResetLive();
	// Wave W2 (G4): his voice waits for the whole reply (6 to 13 s on the PC, 2026-11-11), so a turn with no reply words after
	// bp.TalkThinkS has Glim say one short thinking line (ThinkLines, in turn) through the narration's one path. It never cuts a
	// line (a tour line, a reply, any line still sounding skips it), the tour keeps the voice while it runs, at most one a turn;
	// a reply that comes while it sounds waits for it (TalkSpeak queues behind any line that is not a reply).
	const int32 Turn = ++S.Turns;
	const float ThinkS = CVarTalkThinkS.GetValueOnGameThread();
	if (ThinkS > 0.f)
	{
		const float After = FMath::Clamp(ThinkS, 0.5f, 10.f);
		GetWorldTimerManager().SetTimer(S.ThinkTimer, FTimerDelegate::CreateWeakLambda(this, [this, Serial, Turn, After]()
		{
			if (!Talk.IsValid()) return;
			FBpTalkState& L = *Talk;
			const TArray<BpTourBook::FLine>& Lines = BpTourBook::ThinkLines();
			FString Skip;
			if (L.Serial != Serial || L.Step != FBpTalkState::EStep::Thinking) Skip = TEXT("the reply came first, or the turn ended");
			else if (!L.LiveText.IsEmpty()) Skip = TEXT("his reply's words are already showing");
			else if (L.ThoughtTurn == Turn) Skip = TEXT("this turn already had one");
			else if (IsVoicePlaying()) Skip = FString::Printf(TEXT("a line is speaking (%s)"), *TourVoiceClip);
			else if (IsTourRunning()) Skip = TEXT("the tour runs (it keeps Glim's voice)");
			else if (Lines.Num() == 0) Skip = TEXT("the book has no thinking lines");
			if (!Skip.IsEmpty())
			{
				UE_LOG(LogBpTable, Log, TEXT("BpTalk: thinking filler skipped (turn %d, %.1f s): %s"), Turn, After, *Skip);
				return;
			}
			const BpTourBook::FLine& Line = Lines[L.ThinkNext % Lines.Num()];
			L.ThinkNext = (L.ThinkNext + 1) % Lines.Num();
			L.ThoughtTurn = Turn;
			const FString Id = Line.Id;
			const FString Words = Line.Words;
			// Captioned where the turn's words are: the caption (and the wrist), and the sheet as what he is doing, until the
			// stream says more.
			// The sheet's newest step takes an ellipsis: the line's own stop goes ("Let me look…", not "Let me look.…").
			FString Step = Words;
			Step.RemoveFromEnd(TEXT("."));
			L.Steps.Add(Step);
			while (L.Steps.Num() > TalkStepsShown) L.Steps.RemoveAt(0);
			TalkSays(FString::Printf(TEXT("You: \"%s\"\n%s"), *L.Heard.Left(80), *Words), 600.f);
			NarratePlay(Id, TEXT("a talk turn with no reply yet"));
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: thinking filler %s played (turn %d, %.1f s without a reply)"), *Id, Turn, After);
		}), After, false);
	}
	if (bStub)
	{
		const float After = FMath::Clamp(StubS, 0.1f, 60.f);
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: bp.TalkStubReplyS: turn %d sends nothing; a stub reply comes in %.1f s"), Turn, After);
		GetWorldTimerManager().SetTimer(S.StubTimer, FTimerDelegate::CreateWeakLambda(this, [this, Serial, Turn, After]()
		{
			if (!Talk.IsValid() || Talk->Serial != Serial || Talk->Step != FBpTalkState::EStep::Thinking) return;
			FBpTalkState& L = *Talk;
			const FString Reply = TEXT("This is a stub reply. Nothing was sent.");
			L.Reply = Reply;
			L.Step = FBpTalkState::EStep::Speaking;
			L.bSpoke = false;
			L.bAwaitSay = false;
			L.Queued.Reset();
			TalkSays(FString::Printf(TEXT("You: \"%s\"\n%s"), *L.Heard.Left(60), *Reply), 10.f);
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: stub reply for turn %d after %.1f s (bp.TalkStubReplyS: no voice, nothing sent)"), Turn, After);
		}), After, false);
		return;
	}
	// Wave U5: focus events act as they arrive, in order; ones that come while an earlier one's step is still queued join the
	// queue (a newer turn's still replace an older one's: TalkActOnFocus).
	const auto ActOnNewFocuses = [](ABpTable* T, const TArray<FBpTurnFocus>& All)
	{
		FBpTalkState& L = *T->Talk;
		if (All.Num() <= L.FocusesDone) return;
		const TArray<FBpTurnFocus> New(All.GetData() + L.FocusesDone, All.Num() - L.FocusesDone);
		L.FocusesDone = All.Num();
		if (T->TalkFocusQueue.Num() > 0) { for (const FBpTurnFocus& F : New) T->TalkFocusQueue.Emplace(F.TargetKind, F.TargetId); }
		else T->TalkActOnFocus(New, L.AskedAt);
	};
	// Wave U5: the turn as it streams (an agent you can watch work): what he is doing, in plain words, and his words as they
	// come, on the sheet and the caption; his voice still waits for the whole reply.
	const auto OnProgress = [Self, Serial, ActOnNewFocuses](const FBpCompanionTurn& Sofar)
	{
		ABpTable* T = Self.Get();
		if (!T || !T->Talk.IsValid() || T->Talk->Serial != Serial || T->Talk->Step != FBpTalkState::EStep::Thinking) return;
		FBpTalkState& L = *T->Talk;
		const double Since = FPlatformTime::Seconds() - L.ThinkFrom;
		TArray<FString> Steps;
		for (const FString& Tool : Sofar.Tools)
		{
			const FString Words = StepWords(Tool);
			if (Steps.Num() == 0 || Steps.Last() != Words) Steps.Add(Words);
		}
		while (Steps.Num() > TalkStepsShown) Steps.RemoveAt(0);
		const FString Text = BpSheet::PlainWords(Sofar.Text);
		const bool bChanged = Steps != L.Steps || Text != L.LiveText;
		if (Sofar.Tools.Num() > 0 && L.FirstStepS <= 0.0) { L.FirstStepS = Since; UE_LOG(LogBpTable, Log, TEXT("BpTalk: first step %.2f s after the ask: \"%s\""), Since, *Steps.Last()); }
		if (!Text.IsEmpty() && L.FirstTextS <= 0.0) { L.FirstTextS = Since; UE_LOG(LogBpTable, Log, TEXT("BpTalk: first words %.2f s after the ask (%d chars)"), Since, Text.Len()); }
		if (Steps != L.Steps && Steps.Num() > 0) UE_LOG(LogBpTable, Log, TEXT("BpTalk: step at %.2f s: \"%s\" (%s)"), Since, *Steps.Last(), *Sofar.Tools.Last());
		L.Steps = MoveTemp(Steps);
		L.LiveText = Text;
		ActOnNewFocuses(T, Sofar.Focuses);
		if (!Sofar.CardSummary.IsEmpty() && !L.bCardShown)
		{
			L.bCardShown = true;
			if (ABpPawn* Pawn = TalkPawn(T->GetWorld())) Pawn->StandupShowCompanionCards();
		}
		if (!bChanged) return;
		// The caption (and the wrist) follow: his words so far, else what he is doing.
		const FString You = FString::Printf(TEXT("You: \"%s\""), *L.Heard.Left(80));
		const FString Now = !L.LiveText.IsEmpty() ? (L.LiveText.Len() > 150 ? L.LiveText.Left(149).TrimEnd() + BpType::Ellipsis() : L.LiveText)
			: L.Steps.Num() > 0 ? L.Steps.Last() + BpType::Ellipsis() : FString(TEXT("Thinking… B or a pinch on me cancels"));
		T->TalkSays(You + TEXT("\n") + Now, 600.f);
	};
	Link.PostCompanionTurn(Heard, Surface, [Self, Serial, ActOnNewFocuses](const FBpCompanionTurn& Turn)
	{
		ABpTable* T = Self.Get();
		if (!T || !T->Talk.IsValid()) return;
		const double Took = FPlatformTime::Seconds() - T->Talk->ThinkFrom;
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: the turn ended in %.1f s (first step %.2f s, first words %.2f s): outcome %d, %d chars%s%s, %d focus events (%d acted on as they came), %d cards, %d quick replies"), Took,
			T->Talk->FirstStepS, T->Talk->FirstTextS, static_cast<int32>(Turn.Outcome), Turn.Text.Len(),
			Turn.CardSummary.IsEmpty() ? TEXT("") : TEXT(", a pending card"), Turn.FocusKind.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", focus %s %s"), *Turn.FocusKind, *Turn.FocusId),
			Turn.Focuses.Num(), T->Talk->Serial == Serial ? T->Talk->FocusesDone : 0, Turn.Cards.Num(), Turn.Replies.Num());
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
		// Wave U2: plain words (a model's *emphasis*, bullets, headings and backticks go; the words stay) for the sheet, the
		// caption and the wrist.
		FString Reply = BpSheet::PlainWords(Turn.Text);
		if (Reply.IsEmpty()) Reply = Turn.CardSummary.IsEmpty() ? FString(TEXT("Done.")) : FString::Printf(TEXT("I need your yes for this: %s"), *Turn.CardSummary);
		// G2: a card filed from a spoken request waits on the wall (the stand-up's GLIM ASKS sheet); the sheet says where. The
		// voice says Glim's own words only.
		FString Shown = Reply;
		if (!Turn.CardSummary.IsEmpty() && !Shown.Contains(TEXT("on the wall"))) Shown += TEXT(" It's on the wall for your yes.");
		T->LampAnswer = You + TEXT("\n") + Shown;
		T->LampNotifyAsk();
		T->Talk->Replies = Turn.Replies;
		T->Talk->bSampleReplies = false;
		// One action per focus event, in order (a page, a place, a decision); the person's own act since the ask wins. Those the
		// stream already acted on are not acted on again.
		ActOnNewFocuses(T, Turn.Focuses);
		// A write the companion wants waits for the wearer: its card on the wall, as the stand-up shows it (once per turn).
		if (!Turn.CardSummary.IsEmpty() && !T->Talk->bCardShown)
		{
			T->Talk->bCardShown = true;
			if (ABpPawn* Pawn = TalkPawn(T->GetWorld())) Pawn->StandupShowCompanionCards();
		}
		T->TalkSpeak(Reply, Shown);
	}, OnProgress);
}

FBpTurnSurface ABpTable::TurnSurface(bool bSpoken)
{
	FBpTurnSurface Out;
	Out.bSpoken = bSpoken;
	// "This one", in order: the stand-up's open decision sheet, the deck's front decision (or the decision card's finding), the
	// room in view (else the lifted one). The place says the room in words, and the decision's title when one is in view.
	FString Id, Title, Where;
	if (const ABpPawn* Pawn = TalkPawn(GetWorld())) Id = Pawn->StandupDecisionShown(Title);
	if (Id.IsEmpty() && !WaitingDecision(Id, Title, Where)) { Id.Reset(); Title.Reset(); }
	const FString Room = DirectedTarget();
	// The site's own label is "Everything" (the scan's word): Glim is told "the site plan".
	const FString RoomWords = Room.IsEmpty() || Room == TEXT("site") ? FString() : DirectedLabel(Room);
	if (Id.IsEmpty() && !Room.IsEmpty() && Room != TEXT("site")) Id = Room;
	Out.Target = FBpLinkModule::IsTurnTarget(Id) ? Id : FString();
	Out.Place = RoomWords.IsEmpty() ? FString(TEXT("the site plan")) : RoomWords;
	if (!Title.IsEmpty()) Out.Place += FString::Printf(TEXT("; the decision in view: %s"), *Title);
	Out.Place = Out.Place.Left(FBpLinkModule::CompanionPlaceMax);
	return Out;
}

void ABpTable::TalkActOnFocus(const TArray<FBpTurnFocus>& Focuses, double AskedAt)
{
	if (Focuses.Num() == 0) return;
	// Wave U4: the tour owns the table while it runs; Glim's focus events are dropped (his words still stand).
	if (IsTourRunning())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus: %d event(s) dropped: the tour runs (it owns the table)"), Focuses.Num());
		TalkFocusClear(TEXT("the tour"));
		return;
	}
	// A newer turn's events replace what an older one had still to do.
	TalkFocusQueue.Reset();
	for (const FBpTurnFocus& F : Focuses) TalkFocusQueue.Emplace(F.TargetKind, F.TargetId);
	TalkFocusAskedAt = AskedAt;
	if (UWorld* World = GetWorld()) World->GetTimerManager().ClearTimer(TalkFocusTimer);
	TalkFocusStep();
}

void ABpTable::TalkFocusStep()
{
	if (TalkFocusQueue.Num() == 0) return;
	if (IsTourRunning())
	{
		TalkFocusClear(TEXT("the tour (it began after the ask)"));
		return;
	}
	if (OwnActAt > TalkFocusAskedAt)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus: %d event(s) dropped: the person acted %.1f s after the ask (their act wins)"), TalkFocusQueue.Num(), OwnActAt - TalkFocusAskedAt);
		TalkFocusQueue.Reset();
		return;
	}
	const TPair<FString, FString> F = TalkFocusQueue[0];
	TalkFocusQueue.RemoveAt(0);
	const FString& Kind = F.Key;
	const FString& Id = F.Value;
	ABpPawn* Pawn = TalkPawn(GetWorld());
	// What this step moves is Glim's doing, not the person's: their last act stays what it was.
	const double OwnBefore = OwnActAt;
	ON_SCOPE_EXIT { OwnActAt = OwnBefore; };
	FBpLinkModule& Link = FBpLinkModule::Get();
	if (Kind == TEXT("page"))
	{
		// A console page by its contract id; the table's own key where it differs (MENU is HOME, PC LINK is link).
		const bool bKnown = FBpLinkModule::CompanionPageTargets().Contains(Id);
		const FString Key = Id == TEXT("menu") ? FString(TEXT("home")) : Id == TEXT("pc-link") ? FString(TEXT("link")) : Id;
		if (!bKnown || !Pawn) { UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus page %s: %s"), *Id, bKnown ? TEXT("no pawn") : TEXT("not a page this table has: skipped")); }
		else
		{
			if (!(Key == TEXT("standup") && Pawn->IsStandupOpen())) Pawn->OpenConsole(Key);
			// The page Glim opened takes the sheet; his words stay on his caption.
			Pawn->TalkYield();
			UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus page %s: the %s page is open%s"), *Id, *Key, Pawn->IsConsoleFar() ? TEXT(" on the wall") : TEXT(" at the desk"));
		}
	}
	else if (Kind == TEXT("wing") || Kind == TEXT("room") || Kind == TEXT("feature"))
	{
		// The table goes there by its own routes (the follow's: a room in room mode, a wing by its lift, a feature's room with
		// its screen at the deck's front); its caption says who sent it.
		FBpFollowPlace Place;
		Place.Product = Link.GetProductSlug();
		Place.Kind = Kind;
		Place.Id = Id;
		Place.Label = TEXT("Glim");
		Place.Surface = TEXT("vr");
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus %s %s: the table goes there"), *Kind, *Id);
		Follow(Place);
	}
	else if (Kind == TEXT("decision"))
	{
		// A finding: its decision on the stand-up's sheet when today's deck has it, else the room's deck at it (the scan result's
		// DECIDE THEM route); on the wall Glim points at it.
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus decision %s: the stand-up opens on it (else its room's deck)"), *Id);
		if (Pawn) { Pawn->OpenStandupForFindings({ Id }); Pawn->TalkYield(); }
	}
	else UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus %s %s: a kind the table does not show: skipped"), *Kind, *Id);
	if (TalkFocusQueue.Num() > 0)
	{
		if (UWorld* World = GetWorld())
		{
			TWeakObjectPtr<ABpTable> Self(this);
			World->GetTimerManager().SetTimer(TalkFocusTimer, FTimerDelegate::CreateLambda([Self]() { if (ABpTable* T = Self.Get()) T->TalkFocusStep(); }), TalkFocusStepS, false);
		}
	}
}

void ABpTable::TalkFocusClear(const TCHAR* Why)
{
	if (UWorld* World = GetWorld()) World->GetTimerManager().ClearTimer(TalkFocusTimer);
	if (TalkFocusQueue.Num() == 0) return;
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: focus: %d step(s) still to come dropped by %s"), TalkFocusQueue.Num(), Why);
	TalkFocusQueue.Reset();
}

void ABpTable::TalkSpeak(const FString& Reply, const FString& ShownIn)
{
	FBpTalkState& S = *Talk;
	// The sheet's words (Shown: the reply and what the table adds, "It's on the wall for your yes."); the voice says Reply.
	const FString Shown = ShownIn.IsEmpty() ? Reply : ShownIn;
	S.Reply = Shown;
	S.Step = FBpTalkState::EStep::Speaking;
	S.bSpoke = false;
	const FString You = FString::Printf(TEXT("You: \"%s\""), *S.Heard.Left(60));
	const FString Body = Shown.Len() > 150 ? Shown.Left(149).TrimEnd() + BpType::Ellipsis() : Shown;
	TalkSays(You + TEXT("\n") + Body, 30.f);
	const int32 Serial = S.Serial;
	S.bAwaitSay = true;
	TWeakObjectPtr<ABpTable> Self(this);
	// Spoken: the first sentences up to bp.TalkSpokenMax characters, cut at a sentence end (a 569-character reply was 23 s of
	// voice on the device); the console's sheet keeps the reply whole.
	const FString Spoken = SpokenPart(Reply, FMath::Clamp(CVarTalkSpokenMax.GetValueOnGameThread(), 80, 1200));
	if (Spoken.Len() < Reply.Len()) UE_LOG(LogBpTable, Log, TEXT("BpTalk: speaking %d of the reply's %d characters (to a sentence end)"), Spoken.Len(), Reply.Len());
	FBpLinkModule::Get().PostSay(Spoken, [Self, Serial](int32 Status, const TArray<uint8>& Wav, const FString& Body)
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
	// Wave U4: what the conversation still had to show goes with it, whatever step it is at.
	TalkFocusClear(Why);
	if (!Talk.IsValid() || Talk->Step == FBpTalkState::EStep::Idle) return false;
	FBpTalkState& S = *Talk;
	const FBpTalkState::EStep Was = S.Step;
	++S.Serial;
	S.bAwaitSay = false;
	S.Queued.Reset();
	S.SampleAct.Reset();
	if (Was == FBpTalkState::EStep::Speaking || Was == FBpTalkState::EStep::Sample) StopVoice();
	// Wave W2: the thinking line goes with the turn it was said for, and so do its timer and a stub's.
	GetWorldTimerManager().ClearTimer(S.ThinkTimer);
	GetWorldTimerManager().ClearTimer(S.StubTimer);
	if (Was == FBpTalkState::EStep::Thinking && IsVoicePlaying() && IsThinkLine(TourVoiceClip))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpTalk: thinking filler %s cut by the cancel"), *TourVoiceClip);
		StopVoice();
	}
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

void ABpTable::TalkShowSample()
{
	if (!Talk.IsValid()) Talk = MakeShared<FBpTalkState>();
	if (Talk->bHeld || Talk->Step != FBpTalkState::EStep::Idle) return;
	TalkSample();
}

void ABpTable::TalkSample(const FString& ForceId)
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
	// A sample quick reply (G2) names its line.
	const FString Id = !ForceId.IsEmpty() ? ForceId : !RoomModeId.IsEmpty() ? TEXT("scan") : GetBpLevel() != EBpLevel::L0 ? TEXT("plan") : TEXT("next");
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
	// G2: the sample's quick replies are the other sample lines (their asks as labels); a press plays that line, nothing is sent.
	S.Replies.Reset();
	S.bSampleReplies = true;
	for (const TCHAR* Other : { TEXT("next"), TEXT("plan"), TEXT("scan") })
	{
		FTalkSampleLine O;
		if (Id == Other || !ReadSample(Other, O) || O.Ask.IsEmpty()) continue;
		FString Label = O.Ask.Replace(TEXT("?"), TEXT(""));
		if (Label.Len() > FBpLinkModule::CompanionReplyLabelMax) Label = Label.Left(FBpLinkModule::CompanionReplyLabelMax - 1).TrimEnd() + BpType::Ellipsis();
		S.Replies.Add({ Label, Other });
	}
	// While a tour runs the exchange is only shown: its follow-up (the stand-up opened, a scan armed, the lamp sent to a
	// finding) would take the table from the step and hold the tour behind a sheet nobody asked for.
	S.SampleAct = IsTourRunning() ? FString() : Id;
	if (IsTourRunning()) UE_LOG(LogBpTable, Log, TEXT("BpTalk: sample %s during the tour: no follow-up act"), *Id);
	TArray<uint8> Wav;
	const FString Path = FPaths::ProjectContentDir() / TEXT("BpData/voice/talk") / (Id + TEXT(".wav"));
	FFileHelper::LoadFileToArray(Wav, *Path, FILEREAD_Silent);
	TalkSays(FString::Printf(TEXT("SAMPLE · You: \"%s\"\n%s"), *Line.Ask, *Line.Reply), 20.f);
	const bool bVoice = PlayVoiceWav(Wav, TEXT("talk"));
	UE_LOG(LogBpTable, Log, TEXT("BpTalk: sample exchange %s (no microphone opened): \"%s\" -> \"%s\"%s"), *Id, *Line.Ask, *Line.Reply, bVoice ? TEXT(", voiced") : TEXT(", captions only (no clip)"));
	if (ABpPawn* Pawn = TalkPawn(GetWorld())) Pawn->TalkChanged();
}
