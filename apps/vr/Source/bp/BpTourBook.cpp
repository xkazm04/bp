// The tour's book (BpTourBook.h). The Lines table is read as text by apps/vr/tools/tour-voice.ts and scripts/check-vr-tour.ts:
// keep each entry on one line as { TEXT("id"), TEXT("words") }.
#include "BpTourBook.h"

namespace BpTourBook
{
	const TArray<FLine>& Lines()
	{
		static const TArray<FLine> All = {
			// ---- The core tour (first launch; SETTINGS > TABLE > TOUR replays it) ----
			{ TEXT("welcome"), TEXT("Welcome. My name is Glim. Each block here is part of your product.") },
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
		{ TEXT("hands-legend"), TEXT("The legend at your right shows every control.") },
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
			// ---- TALK TO GLIM ----
			{ TEXT("talk-hold"), TEXT("Hold me, or hold TALK on your wrist, and speak. Let go to send.") },
			{ TEXT("talk-where"), TEXT("Your words go to your PC, then a speech service. Nothing is kept.") },
			{ TEXT("talk-choice"), TEXT("It stays off until you allow it. SETTINGS, under TALK, changes it.") },
			// ---- TEXT SIZE ----
			{ TEXT("text-size"), TEXT("Tap 130 percent, and every word grows: the menu, the wrist, my captions.") },
			{ TEXT("text-more"), TEXT("Reduced motion, captions and your wrist's hand are here too.") },
			// ---- YOUR PC ----
			{ TEXT("pc-what"), TEXT("Linked to your PC, the table shows your own projects and live scans.") },
			{ TEXT("pc-sample"), TEXT("This headset shows a sample. Linked to your PC, it shows your projects.") },
			{ TEXT("pc-pair"), TEXT("Type PAIR's code on your PC's Headsets page. Your answers go there.") },
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
			// Wave EV, the stand-up's opening on the sample (BpStandup.cpp): a returning morning, and the first one.
			{ TEXT("standup-welcome"), TEXT("Welcome back. Here is what your approvals became.") },
			{ TEXT("standup-yesterday"), TEXT("Here is what yesterday's approvals became.") },
		};
		return All;
	}

	const TArray<FLine>& NarrateLines()
	{
		static const TArray<FLine> All = {
			// ---- A wing entered (BpLevels.cpp): "enter-wing-" + the wing's name as a slug; the sample's five, then any other ----
			{ TEXT("enter-wing-foundations"), TEXT("Foundations. Two rooms, thirty-two features: the platform, and signing in.") },
			{ TEXT("enter-wing-studio-operations"), TEXT("Studio operations. Four rooms, thirty-eight features. Booking needs the most care.") },
			{ TEXT("enter-wing-money"), TEXT("Money. One room, seventeen features, and the most open findings.") },
			{ TEXT("enter-wing-members-reach"), TEXT("Members and reach. Three rooms, twenty-four features, all about your members.") },
			{ TEXT("enter-wing-frontier"), TEXT("Frontier. Three rooms, twenty-two features: reports, connections and the assistant.") },
			{ TEXT("enter-wing-other"), TEXT("This wing is open. Tap a room to look closer.") },
			// ---- A room lifted (BpLevels.cpp): "enter-room-" + the room's id; the sample's thirteen, then any other ----
			{ TEXT("enter-room-platform"), TEXT("Platform and operations. Twenty-two features: what everything else stands on.") },
			{ TEXT("enter-room-identity"), TEXT("Identity and access. Ten features: signing in, and who may do what.") },
			{ TEXT("enter-room-scheduling"), TEXT("Scheduling and classes. Thirteen features: the timetable, appointments and courses.") },
			{ TEXT("enter-room-booking"), TEXT("Booking and attendance. Ten features, and several findings waiting here.") },
			{ TEXT("enter-room-studio-setup"), TEXT("Studio setup. Nine features: onboarding, locations and rooms.") },
			{ TEXT("enter-room-instructor-tools"), TEXT("Instructor tools. Six features: teaching, pay and performance.") },
			{ TEXT("enter-room-payments"), TEXT("Memberships and payments. Seventeen features, and the most findings on the table.") },
			{ TEXT("enter-room-member-experience"), TEXT("Member experience. Ten features: the member app and the public booking page.") },
			{ TEXT("enter-room-communications"), TEXT("Communications. Seven features: messages and campaigns.") },
			{ TEXT("enter-room-growth"), TEXT("Growth and marketing. Seven features, and nothing open right now.") },
			{ TEXT("enter-room-analytics"), TEXT("Analytics and reporting. Eight features: dashboards and insight.") },
			{ TEXT("enter-room-integrations"), TEXT("Integrations and API. Eight features: the developer platform and connected systems.") },
			{ TEXT("enter-room-assistant"), TEXT("The assistant. Six features, for studios and for members.") },
			{ TEXT("enter-room-other"), TEXT("This room is lifted. Tap it once more to step inside.") },
			// ---- Moving on the table (BpLevels.cpp, BpRoom.cpp) ----
			{ TEXT("back-wing"), TEXT("Back to the whole wing.") },
			{ TEXT("back-plan"), TEXT("The whole plan again.") },
			{ TEXT("inside-room"), TEXT("You're inside. Each card here is one decision.") },
			{ TEXT("outside-room"), TEXT("Back on the site plan.") },
			// ---- The deck in a room (BpDeck.cpp) ----
			{ TEXT("deck-next"), TEXT("The next decision. Approve it, or decline.") },
			{ TEXT("deck-end"), TEXT("That's every decision in this room.") },
			{ TEXT("deck-answer-approved"), TEXT("Approved. I've put this one in the draft wave.") },
			{ TEXT("deck-answer-noted"), TEXT("Noted. On this sample, nothing is sent.") },
			{ TEXT("deck-answer-declined"), TEXT("Declined. It's off this room's queue for today.") },
			// ---- A console page opened (BpConsole.cpp): "page-" + its key; the stand-up and the scan result speak their own ----
			{ TEXT("page-home"), TEXT("Here's the menu. Every page is one tap away.") },
			{ TEXT("page-rooms"), TEXT("Every room, the most urgent first.") },
			{ TEXT("page-scan"), TEXT("Scan a room, a wing, or everything, and watch it work.") },
			{ TEXT("page-ask"), TEXT("Ask me what's next, or about the place you're looking at.") },
			{ TEXT("page-projects"), TEXT("Your projects. Linked to your PC, you can switch between them.") },
			{ TEXT("page-packages"), TEXT("The next wave's packages, and how far each one is built.") },
			{ TEXT("page-settings"), TEXT("Sound, the screen, your room, and how I speak.") },
			{ TEXT("page-link"), TEXT("Link this headset to your PC, to see your own projects.") },
			{ TEXT("page-tour"), TEXT("The first tour, and a short chapter for each part.") },
			{ TEXT("page-talk"), TEXT("Talking to me is your choice. Here's what happens to your words.") },
			{ TEXT("page-access"), TEXT("Motion, text size, captions, and which hand holds the wrist.") },
			{ TEXT("scan-armed"), TEXT("Tap it once more, and I'll start.") },
			// ---- The stand-up (BpStandup.cpp): each sheet kind, the sample's decisions by their place, each answer ----
			{ TEXT("su-open"), TEXT("Good morning. First what happened overnight, then your decisions.") },
			{ TEXT("su-built"), TEXT("Here's what was built overnight, and what failed.") },
			{ TEXT("su-outcome-built"), TEXT("This one was built. You'll find it on the plan.") },
			{ TEXT("su-outcome-failed"), TEXT("This one failed a check. It waits for you again.") },
			{ TEXT("su-outcome-building"), TEXT("This one is still being built.") },
			{ TEXT("su-outcome-waiting"), TEXT("Approved, and waiting for a wave.") },
			{ TEXT("su-decide-payout-reconciliation"), TEXT("First, a stop-ship: unsafe pages in payout reconciliation. Your call.") },
			{ TEXT("su-decide-magic-link-login"), TEXT("Next, a health probe for magic-link sign-in. Small, but risky to change.") },
			{ TEXT("su-decide-bank-debit-sepa"), TEXT("Last, the empty and error states of bank debit.") },
			{ TEXT("su-decide-other"), TEXT("One decision. Approve it, leave it for later, or hold it.") },
			{ TEXT("su-companion"), TEXT("I'd like to run this for you. Approve it, or decline.") },
			{ TEXT("su-close"), TEXT("That's the morning. Close it whenever you're ready.") },
			{ TEXT("su-answer-approved"), TEXT("Approved. That one goes ahead.") },
			{ TEXT("su-answer-later"), TEXT("Later. I'll bring it back tomorrow morning.") },
			{ TEXT("su-answer-held"), TEXT("Held. It stays on the deck, marked.") },
			{ TEXT("su-answer-declined"), TEXT("Declined. It won't come back.") },
			// ---- Your room, the legend, the tour's ends (BpSurround.cpp, BpLegend.cpp, BpTour.cpp) ----
			{ TEXT("your-room-on"), TEXT("Your own room, around the table. The studio comes back anytime.") },
			{ TEXT("your-room-off"), TEXT("The studio is back.") },
			{ TEXT("legend-first"), TEXT("On your right, every control in one place.") },
			{ TEXT("chapter-done"), TEXT("That's the chapter. The others wait on the TOUR page.") },
			{ TEXT("tour-stopped"), TEXT("Tour stopped. It's in the menu whenever you like.") },
		};
		return All;
	}

	const TArray<FLine>& ThinkLines()
	{
		static const TArray<FLine> All = {
			// ---- A talk turn with no reply yet (BpTalk.cpp, bp.TalkThinkS): one a turn, in this order, never twice running ----
			{ TEXT("think-look"), TEXT("Let me look.") },
			{ TEXT("think-moment"), TEXT("One moment, I'm checking.") },
			{ TEXT("think-looking"), TEXT("Looking now.") },
		};
		return All;
	}

	const TArray<FLine>& OnboardLines()
	{
		static const TArray<FLine> All = {
			// ---- The build-up (BpBuildup.cpp): its first event, and the hand-over to the live table ----
			{ TEXT("onboard-start"), TEXT("I'm reading your project now. Watch it draw itself.") },
			{ TEXT("onboard-done"), TEXT("There it is: your building, drawn.") },
		};
		return All;
	}

	bool HasLine(const TArray<FLine>& Lines, const FString& Id)
	{
		return Lines.ContainsByPredicate([&Id](const FLine& L) { return Id == L.Id; });
	}

	FString NarrateWords(const FString& Id)
	{
		for (const TArray<FLine>* Lines : { &NarrateLines(), &ThinkLines(), &OnboardLines() })
		{
			if (const FLine* Line = Lines->FindByPredicate([&Id](const FLine& L) { return Id == L.Id; })) return FString(Line->Words);
		}
		return FString();
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
			{ TEXT("hands"), TEXT("HANDS AND WRIST"), TEXT("rooms"), TEXT("Pull and push · the wrist · the pad · the legend"), 30, { TEXT("hands-pull"), TEXT("hands-push"), TEXT("hands-wrist"), TEXT("hands-legend") } },
			{ TEXT("scan"), TEXT("SCAN A ROOM"), TEXT("scan"), TEXT("Arm, start, watch the findings land"), 20, { TEXT("scan-arm"), TEXT("scan-watch"), nullptr, nullptr } },
			{ TEXT("morning"), TEXT("YOUR MORNING"), TEXT("standup"), TEXT("Decisions · PLAN MY DAY · HAND OVER"), 30, { TEXT("morning-decide"), TEXT("morning-plan"), TEXT("morning-hand"), nullptr } },
			{ TEXT("room"), TEXT("YOUR ROOM"), TEXT("settings"), TEXT("Your own room around the table, and back"), 20, { TEXT("room-switch"), TEXT("room-back"), nullptr, nullptr } },
			{ TEXT("talk"), TEXT("TALK TO GLIM"), TEXT("talk"), TEXT("Hold to talk · where it goes · your choice"), 30, { TEXT("talk-hold"), TEXT("talk-where"), TEXT("talk-choice"), nullptr } },
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
