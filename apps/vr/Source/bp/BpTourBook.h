// The tour's book (wave T1, the tour's second edition): every line the lamp says on the tour and its chapters, the core
// tour's steps and the chapters, written once here. The captions are these words; the clips are these words rendered
// (apps/vr/tools/tour-voice.ts reads BpTourBook.cpp as text, so a line cannot change without its clip going stale, and
// scripts/check-vr-tour.ts pins both). Ids are minted names that survive reordering, never an index and never the words.
#pragma once

#include "CoreMinimal.h"

namespace BpTourBook
{
	/** The content version: bumped when a step changes meaning. A bump shows as NEW chips on the TOUR page, never as a replay
	 *  of a core tour already done or dismissed. */
	constexpr int32 Version = 2;
	/** No spoken line runs longer than this many words (check:vr-tour pins it). */
	constexpr int32 MaxWords = 14;

	/** One spoken and captioned line: its id (the clip's file name) and its words. */
	struct FLine
	{
		const TCHAR* Id;
		const TCHAR* Words;
	};

	/** A chapter: its id, the TOUR page's title for it, the console page it teaches (FBpConsolePages: its letter and its place
	 *  in the MENU's order come from there), one line of what it covers, about how long it runs, and its steps. */
	struct FChapter
	{
		const TCHAR* Id;
		const TCHAR* Title;
		const TCHAR* Page;
		const TCHAR* What;
		int32 Seconds;
		const TCHAR* Steps[4];
	};

	const TArray<FLine>& Lines();
	/** Wave C1, the scan theatre's spoken lines (BpScanTheatre.cpp; tour-voice.ts --scan renders them into voice/scan/): the
	 *  start per scope kind, the sample's results at the counts it lands (BpScan.TheatreLines lists them), and the generic
	 *  ones for any other count. */
	const TArray<FLine>& ScanLines();
	/** Wave N3-W3, every step narrated (BpNarrate.cpp; tour-voice.ts --narrate renders them into voice/narrate/): a line for each
	 *  wing and room of the bundled sample (their facts fixed in the bundle), each console page, each stand-up sheet kind and
	 *  answer, the deck, your room, the legend and a chapter's end. Never a count that a session can change. */
	const TArray<FLine>& NarrateLines();
	/** The words of a narration line ("" when there is none). */
	FString NarrateWords(const FString& Id);
	/** The core tour's steps in order (each id is also its line's id). */
	const TArray<const TCHAR*>& Core();
	const TArray<FChapter>& Chapters();
	const FChapter* FindChapter(const FString& Id);
	/** A chapter's steps (its non-null entries). */
	TArray<FString> StepsOf(const FChapter& Chapter);
	/** The words of a line ("" when there is none). */
	FString Words(const FString& Id);
	/** The core tour's length, said on the TOUR page. */
	constexpr int32 CoreSeconds = 90;
}
