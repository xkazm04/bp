// The tour's book (BpTourBook.h). The Lines table is read as text by apps/vr/tools/tour-voice.ts and scripts/check-vr-tour.ts:
// keep each entry on one line as { TEXT("id"), TEXT("words") }.
#include "BpTourBook.h"

namespace BpTourBook
{
	const TArray<FLine>& Lines()
	{
		static const TArray<FLine> All = {
			// ---- The core tour (first launch; SETTINGS > TABLE > TOUR replays it) ----
			{ TEXT("welcome"), TEXT("Welcome to the light table. Each block here is a part of your product.") },
			{ TEXT("open-wing"), TEXT("Tap a wing to open it.") },
			{ TEXT("open-room"), TEXT("Now tap the glowing room.") },
			{ TEXT("step-in"), TEXT("Tap it once more, to step inside.") },
			{ TEXT("decide"), TEXT("Each card is one decision. Approve it, or decline.") },
			{ TEXT("decide-noted"), TEXT("Noted. On this sample, nothing is sent.") },
			{ TEXT("back"), TEXT("BACK takes you out, one step at a time.") },
			{ TEXT("menu"), TEXT("Everything else is in the menu. Tap MENU.") },
			{ TEXT("menu-open"), TEXT("Rooms, scans, your morning, settings, and this tour.") },
			{ TEXT("standup"), TEXT("Every morning starts here. Approve this one, or leave it for later.") },
			{ TEXT("standup-how"), TEXT("Pinch APPROVE or LATER on the card, or press A twice.") },
			{ TEXT("standup-none"), TEXT("Nothing waits this morning. The stand-up lives in the menu.") },
			{ TEXT("talk"), TEXT("And you can simply ask me. Hold me, or hold TALK on your wrist.") },
			{ TEXT("hand-off"), TEXT("That's the table. It's yours. The tour and its chapters are in the menu.") },
			{ TEXT("shown"), TEXT("Like this.") },
			// ---- HANDS AND WRIST ----
			{ TEXT("hands-pull"), TEXT("Pinch a wing and pull it toward you. It opens, like a tap.") },
			{ TEXT("hands-push"), TEXT("Push away to go back out. It works like BACK.") },
			{ TEXT("hands-wrist"), TEXT("Your wrist holds quick decisions. On a controller, A taps and B goes back.") },
			// ---- SCAN A ROOM ----
			{ TEXT("scan-arm"), TEXT("Tap SCAN once to arm it, then again to start.") },
			{ TEXT("scan-watch"), TEXT("Each room lights up as it is read. The findings land below.") },
			// ---- YOUR MORNING ----
			{ TEXT("morning-decide"), TEXT("Each card is one decision. Approve it, or leave it for later.") },
			{ TEXT("morning-plan"), TEXT("Then PLAN MY DAY asks the companion what today's work should be.") },
			{ TEXT("morning-hand"), TEXT("HAND OVER lets the companion work for today. TAKE BACK ends it.") },
			// ---- YOUR ROOM ----
			{ TEXT("room-switch"), TEXT("Tap the room switch on the bar. Your own room appears around the table.") },
			{ TEXT("room-back"), TEXT("Tap it again, and the studio comes back.") },
			// ---- TALK TO THE LAMP ----
			{ TEXT("talk-hold"), TEXT("Hold me, or hold TALK on your wrist, and speak. Let go to send.") },
			{ TEXT("talk-where"), TEXT("Your words go to your PC, then a speech service. Nothing is kept.") },
			{ TEXT("talk-choice"), TEXT("It stays off until you allow it. SETTINGS, under TALK, changes it.") },
			// ---- TEXT SIZE ----
			{ TEXT("text-size"), TEXT("Tap 130 percent, and every word grows: the menu, the wrist, my captions.") },
			{ TEXT("text-more"), TEXT("Reduced motion, captions and your wrist's hand are here too.") },
			// ---- YOUR PC ----
			{ TEXT("pc-what"), TEXT("Linked to your PC, the table shows your own projects and live scans.") },
			{ TEXT("pc-sample"), TEXT("This headset shows a sample. Linked to your PC, it shows your projects.") },
			{ TEXT("pc-pair"), TEXT("PAIR shows a code. Approve it on your PC, and your answers go there.") },
		};
		return All;
	}

	const TArray<FLine>& ScanLines()
	{
		static const TArray<FLine> All = {
			{ TEXT("scan-start-everything"), TEXT("Scanning everything.") },
			{ TEXT("scan-start-wing"), TEXT("Scanning this wing.") },
			{ TEXT("scan-start-room"), TEXT("Scanning this room.") },
			{ TEXT("scan-start-place"), TEXT("Scanning this place.") },
			{ TEXT("scan-done"), TEXT("Done. Here is what it found.") },
			{ TEXT("scan-stopped"), TEXT("Stopped. Here is what it read.") },
			// The sample's results, at the counts it lands (BpScan.TheatreLines on Kettle: the site, each wing, each room).
			{ TEXT("scan-done-thirteen-six"), TEXT("Done. Thirteen rooms read, six new findings.") },
			{ TEXT("scan-done-four-five"), TEXT("Done. Four rooms read, five new findings.") },
			{ TEXT("scan-done-three-three"), TEXT("Done. Three rooms read, three new findings.") },
			{ TEXT("scan-done-three-one"), TEXT("Done. Three rooms read, one new finding.") },
			{ TEXT("scan-done-two-three"), TEXT("Done. Two rooms read, three new findings.") },
			{ TEXT("scan-done-one-two"), TEXT("Done. One room read, two new findings.") },
			{ TEXT("scan-done-one-one"), TEXT("Done. One room read, one new finding.") },
			{ TEXT("scan-done-one-none"), TEXT("Done. One room read, nothing new.") },
		};
		return All;
	}

	const TArray<const TCHAR*>& Core()
	{
		static const TArray<const TCHAR*> Steps = { TEXT("welcome"), TEXT("open-wing"), TEXT("open-room"), TEXT("step-in"), TEXT("decide"),
			TEXT("back"), TEXT("menu"), TEXT("standup"), TEXT("talk"), TEXT("hand-off") };
		return Steps;
	}

	const TArray<FChapter>& Chapters()
	{
		// In any order here: the TOUR page lists them in the MENU's order, read from the console's page registry.
		static const TArray<FChapter> All = {
			{ TEXT("hands"), TEXT("HANDS AND WRIST"), TEXT("rooms"), TEXT("Pull and push · the wrist · the pad"), 25, { TEXT("hands-pull"), TEXT("hands-push"), TEXT("hands-wrist"), nullptr } },
			{ TEXT("scan"), TEXT("SCAN A ROOM"), TEXT("scan"), TEXT("Arm, start, watch the findings land"), 20, { TEXT("scan-arm"), TEXT("scan-watch"), nullptr, nullptr } },
			{ TEXT("morning"), TEXT("YOUR MORNING"), TEXT("standup"), TEXT("Decisions · PLAN MY DAY · HAND OVER"), 30, { TEXT("morning-decide"), TEXT("morning-plan"), TEXT("morning-hand"), nullptr } },
			{ TEXT("room"), TEXT("YOUR ROOM"), TEXT("settings"), TEXT("Your own room around the table, and back"), 20, { TEXT("room-switch"), TEXT("room-back"), nullptr, nullptr } },
			{ TEXT("talk"), TEXT("TALK TO THE LAMP"), TEXT("talk"), TEXT("Hold to talk · where it goes · your choice"), 30, { TEXT("talk-hold"), TEXT("talk-where"), TEXT("talk-choice"), nullptr } },
			{ TEXT("text"), TEXT("TEXT SIZE"), TEXT("access"), TEXT("Larger words · motion · captions · hand"), 20, { TEXT("text-size"), TEXT("text-more"), nullptr, nullptr } },
			{ TEXT("pc"), TEXT("YOUR PC"), TEXT("link"), TEXT("What linking adds · pairing"), 20, { TEXT("pc-what"), TEXT("pc-pair"), nullptr, nullptr } },
		};
		return All;
	}

	const FChapter* FindChapter(const FString& Id)
	{
		return Chapters().FindByPredicate([&Id](const FChapter& C) { return Id == C.Id; });
	}

	TArray<FString> StepsOf(const FChapter& Chapter)
	{
		TArray<FString> Out;
		for (const TCHAR* Step : Chapter.Steps) if (Step) Out.Add(Step);
		return Out;
	}

	FString Words(const FString& Id)
	{
		const FLine* Line = Lines().FindByPredicate([&Id](const FLine& L) { return Id == L.Id; });
		return Line ? FString(Line->Words) : FString();
	}
}
