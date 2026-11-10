// Every step narrated (wave N3-W3, the owner on 2026-11-10 after wearing the Quest: "We should increase the coverage for tour
// and kettle project so each step is narrated"). One short line from Glim for each step a person takes on the table: a wing or
// a room entered, a console page opened, each stand-up sheet and answer, the deck in a room, your room on and off, the legend's
// first appearance, a chapter's end. The words are BpTourBook.cpp's NarrateLines (the captions are those words); the clips are
// those words rendered in his voice (apps/vr/tools/tour-voice.ts --narrate -> Content/BpData/voice/narrate/), so a headset with
// no PC says them, and scripts/check-vr-tour.ts pins that every line has its clip and no clip is an orphan.
//   - One voice: every line goes through PlayVoiceWav, the tour's one audio component, so two never play at once and the music
//     ducks under each as it does under the tour's.
//   - Never blocking: a line is said as the step happens; the step does not wait for it. A newer line replaces an older one
//     (the component stops first); leaving the step (the console closed, the stand-up left) cuts it.
//   - Except an acknowledgment of the person's own answer (and the stand-up's opening): the step that answer causes (the next
//     sheet, the next card) waits for it to end, then speaks.
//   - Quiet when it must be: while a tour runs (the tour narrates its own steps), while the person talks to Glim or his reply
//     plays, and under bp.Narration (SETTINGS > NARRATION: ALL, TOUR ONLY, OFF).
// Nothing here ticks: a timer runs only while a line waits for an acknowledgment to finish.
#include "BpTable.h"

#include "BpAudio.h"
#include "BpLink.h"
#include "BpTourBook.h"
#include "Components/AudioComponent.h"
#include "Engine/World.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "TimerManager.h"

namespace
{
	const TCHAR* const NarrateClipDir = TEXT("BpData/voice/narrate");

	/** A line the step it causes waits for: the person's answer acknowledged, and the stand-up's opening. */
	bool HoldsNext(const FString& Clip)
	{
		return Clip.StartsWith(TEXT("su-answer-")) || Clip.StartsWith(TEXT("deck-answer-")) || Clip == TEXT("standup-welcome") || Clip == TEXT("standup-yesterday");
	}

	/** A name as a line id's tail: lower case, any run of other characters one hyphen ("Members & reach" -> members-reach). */
	FString Slug(const FString& In)
	{
		FString Out;
		bool bGap = false;
		for (const TCHAR C : In.ToLower())
		{
			if ((C >= TEXT('a') && C <= TEXT('z')) || (C >= TEXT('0') && C <= TEXT('9')))
			{
				if (bGap && !Out.IsEmpty()) Out.AppendChar(TEXT('-'));
				Out.AppendChar(C);
				bGap = false;
			}
			else bGap = true;
		}
		return Out;
	}
}

FString ABpTable::NarrateWingId(const FString& InWingId) const
{
	const FBpPlanWing* Wing = FindWing(InWingId);
	const FString Id = Wing ? TEXT("enter-wing-") + Slug(Wing->name) : FString();
	return !Id.IsEmpty() && !BpTourBook::NarrateWords(Id).IsEmpty() ? Id : FString(TEXT("enter-wing-other"));
}

FString ABpTable::NarrateRoomId(const FString& InRoomId) const
{
	const FString Id = TEXT("enter-room-") + Slug(InRoomId);
	return !BpTourBook::NarrateWords(Id).IsEmpty() ? Id : FString(TEXT("enter-room-other"));
}

void ABpTable::Narrate(const FString& Id, const TCHAR* Why, bool bCaption)
{
	if (NarrateHush > 0) return;
	const FString Words = BpTourBook::NarrateWords(Id);
	if (Words.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: no line %s (%s)"), *Id, Why);
		return;
	}
	const int32 Mode = BpAudio::Narration();
	if (Mode < BpAudio::NarrationAll)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s not said: bp.Narration %d (%s)"), *Id, Mode, Mode == BpAudio::NarrationTourOnly ? TEXT("TOUR ONLY") : TEXT("OFF"));
		return;
	}
	if (GetWorld() && GetWorld()->GetTimeSeconds() < NarrateQuietUntil)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s not said: the tour's end just spoke (%s)"), *Id, Why);
		return;
	}
	if (IsTourRunning())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s not said: the tour narrates its own steps (%s)"), *Id, *TourStepId);
		return;
	}
	if (TalkLampState() != 0)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s not said: the person is talking to Glim"), *Id);
		return;
	}
	if (bCaption) SayLamp(Words, true);
	if (IsVoicePlaying())
	{
		if (TourVoiceClip == TEXT("talk"))
		{
			UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s not said: Glim's reply is playing"), *Id);
			return;
		}
		if (HoldsNext(TourVoiceClip) && !HoldsNext(Id))
		{
			// The person's answer is being acknowledged: the step it caused speaks after it (the newest such step wins).
			NarrateNext = Id;
			const double Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;
			const float After = FMath::Max(0.05f, static_cast<float>(TourVoiceEndsAt - Now));
			GetWorldTimerManager().SetTimer(NarrateTimer, FTimerDelegate::CreateWeakLambda(this, [this]()
			{
				if (NarrateNext.IsEmpty()) return;
				const FString Next = MoveTemp(NarrateNext);
				NarrateNext.Reset();
				Narrate(Next, TEXT("after the acknowledgment"));
			}), After, false);
			UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s waits %.1f s for %s to finish (%s)"), *Id, After, *TourVoiceClip, Why);
			return;
		}
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s replaces %s"), *Id, *TourVoiceClip);
	}
	NarratePlay(Id, Why);
}

void ABpTable::NarratePlay(const FString& Id, const TCHAR* Why)
{
	NarrateNext.Reset();
	GetWorldTimerManager().ClearTimer(NarrateTimer);
	TArray<uint8>* File = NarrateClips.Find(Id);
	if (!File)
	{
		File = &NarrateClips.Add(Id);
		FFileHelper::LoadFileToArray(*File, *(FPaths::ProjectContentDir() / NarrateClipDir / (Id + TEXT(".wav"))), FILEREAD_Silent);
	}
	const bool bPlayed = PlayVoiceWav(*File, *Id);
	UE_LOG(LogBpTable, Log, TEXT("BpNarrate: says %s for %s: \"%s\"%s"), *Id, Why, *BpTourBook::NarrateWords(Id),
		bPlayed ? *FString::Printf(TEXT(" (%d bytes, %.1f s)"), File->Num(), File->Num() > 44 ? (File->Num() - 44) / 48000.0 : 0.0) : TEXT(" (no clip: the caption carries it)"));
}

void ABpTable::NarrateCut(const TCHAR* Why)
{
	const bool bWaiting = !NarrateNext.IsEmpty();
	NarrateNext.Reset();
	GetWorldTimerManager().ClearTimer(NarrateTimer);
	if (IsVoicePlaying() && !BpTourBook::NarrateWords(TourVoiceClip).IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpNarrate: %s cut: %s"), *TourVoiceClip, Why);
		StopVoice();
	}
	else if (bWaiting) UE_LOG(LogBpTable, Log, TEXT("BpNarrate: the waiting line dropped: %s"), Why);
}
