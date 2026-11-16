// Glim's board (wave W1, the owner 2026-11-11, direction C): a decision on the wall, laid out for the wall rather than the desk's
// sheet scaled up. The stand-up's decisions and a room's decisions on the wall both draw it (BpStandup.cpp, BpDeck.cpp); the
// desk, the wrist and YESTERDAY's outcome sheets keep their own layouts.
//
// On the wall's 1280 x 720 layout (the console's grid), under its header: the title row (GLIM ASKS or nothing, the decision's
// title on one line); a left column of three tiles (the hero number with its label and one muted line; Glim's line beside a lit
// lamp disc; what it touches: the feature, its room and up to four features it depends on); and the stage, which takes the
// first visual the data allows:
//   Split   a "before" and an "after" screen: one screen, split at a stop the person moves (TODAY, SPLIT, PROPOSED);
//   Shot    only a "before": the screen large, the loupe's region (BpProjector::LoupeRegion) ringed;
//   Metric  a measured value and an expected change: TODAY and AFTER APPROVE on one axis, the budget and the target the
//           finding's words name, the part over the budget hatched;
//   State   none of these: the feature's stage track (its `stage`, the next stage marked), the open findings this one closes
//           (today -> after) and the plan's latest note.
// Every figure is the bundle's (the scan's proposals, measurements and shots; the structure's features and facets); a field the
// data lacks leaves its part out.
//
// Wave W2 (the owner, 2026-11-11: "leverage the wall space ... still overcrowded with text"): the wall is larger (48.8 degrees
// wide, from 43.5), so the board takes the design's proportions (Board.dc.html, MetricBoard, StateBoard): the hero the largest thing after
// the stage (76 layout px of cap, 60 over a muted verdict); what it touches as a small node map (the feature lit at the top, its
// room in the middle, up to four neighbours around, thin lines); no ellipses anywhere on it (titles shrink 32 to 22, else two
// lines; names shorten by whole words); the stage track's words all under it; the plan's note whole (else its first sentence);
// each fact once (the budget's number on the chart only). The floor is 20 layout px of cap: 46 arc minutes at the new size.
//
// Wave W3 (the owner, 2026-11-11: "the wall growth to 53, look of 'what it touches', and UI ability to comprehend up to 60
// words"): the wall is 53 degrees wide (24.1 layout px a degree), so the board reads by three text sizes only: the title (and
// the hero's figure, the bars' figures) at CapL, Glim's line, the hero's label and the stage's labels at CapM, the muted
// headings, the notes and the map's names at CapS, the floor (47 arc minutes of cap, 34 of x-height, over W2's 46 and 32).
// Each block wraps inside its tile to the lines it was laid out for, never under the floor, never with an ellipsis; a block
// that had to lose words says so in FOut. What it touches is a node map: the feature lit at the top, its room under it on an
// amber stem, what it depends on (the structure's depends_on: the feature's, so their lines start at the feature) under the
// room, joined by a thin bracket that runs around the room and ends in an arrowhead at each dependency's edge; a layout for
// each count from 0 to 4. BpBoard.Audit lays out every sample decision on both boards headlessly and logs what each showed.
//
// Wave W3b (the Director's review of W3: "the map must read as a map"): the hero's label beside its figures when it fits there
// and Glim's tile one line tall when his line is, so the map takes about half the left column; the room is an outlined caption
// (on the heading's row, under the feature in a fan), never a node in a line's path; the feature is the largest node; its
// dependencies spread across the tile (1: down at the right on a diagonal, 2: a V under the feature, 3 and 4: a fan, the feature
// at the left and the dependencies in a column at the right), each joined by one straight line from the feature's edge to its
// own, arrowhead at the dependency; node names at CapM. The map's check refuses a node outside the tile's margin, two nodes
// that meet, a line that crosses a node, the heading, the room or another line, and a line shorter than its arrowhead.
//
// Cost: drawn into the surface's own render target, only when what it shows changes (the callers' keys); no tick, no
// material, no texture beyond the screens the callers already hold (an "after" screen is one more, released with the "before").
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SWidget.h"

struct FSlateBrush;
struct FBpShot;

namespace BpBoard
{
	/** The stage's visual, the first that applies. */
	enum class ECase : uint8 { Split, Shot, Metric, State };
	const TCHAR* CaseWord(ECase Case);

	/** The split's three stops: how much of the "after" screen shows. */
	enum EStop : int32 { StopToday = 0, StopSplit = 1, StopProposed = 2 };

	/** The board's grid on the wall's 1280 x 720 layout: the title row in the header's sub-line band, the tiles and the stage in
	 *  the frame's band (the queue's strip between them stays the caller's). */
	constexpr float X0 = 40.f, X1 = 1240.f;
	constexpr float TitleY0 = 98.f, TitleY1 = 150.f;
	constexpr float Y0 = 170.f, Y1 = 568.f;
	constexpr float ColX1 = 580.f, StageX0 = 600.f;
	/** Wave W2: the left column's tiles (the hero, Glim's line; what it touches under them to Y1). Wave W3: what it touches
	 *  takes 168 px for its three rows (the feature, the room, the dependencies) and the bracket's channel between them. Wave
	 *  W3b: the hero as tall as its figures and label (92 with the label beside the figures, 116 under them), Glim's tile as tall
	 *  as its line (60 for one, 76 for two), and what it touches the rest (190 to 230 px, 48 to 58 % of the column). */
	constexpr float GlimOneH = 60.f, GlimTwoH = 76.f;
	/** Wave W3, the board's three text sizes (layout px of cap height): the largest, the middle, the smallest (the floor). */
	constexpr float CapL = 28.f, CapM = 23.f, CapS = 19.f;

	/** A finding's screen of one phase (BpVocab::Shot::Phase), PNG only (what the headset decodes), or null. */
	const FBpShot* FindShot(const FString& Proposal, const TCHAR* Phase);
	/** The stage's case from the data alone (the screens are the scan's rows, whether or not they are read yet). */
	ECase CaseOf(const FString& Proposal);
	/** A split stop's control (layout px): the hands' and the pad's target. */
	FBox2f StopBox(int32 Stop);

	struct FIn
	{
		FString Proposal;
		/** The decision's title as the caller shows it (the card's headline, the finding's title). */
		FString Title;
		/** The chip before the title ("GLIM ASKS"), empty for none. */
		FString Chip;
		/** The screens as read; null while reading or when there is none. bReading: the caller is reading one now. */
		TSharedPtr<FSlateBrush> Before;
		TSharedPtr<FSlateBrush> After;
		bool bReading = false;
		/** Where the split stands (EStop). */
		int32 Stop = StopSplit;
		/** A line for a finding the table's scan does not hold (another product's card): the brief's own. */
		FString Fallback;
	};

	struct FOut
	{
		ECase Case = ECase::State;
		/** Where Glim points (layout px): the ringed region, the split's line, the TODAY bar's end, the lit stage. */
		FVector2f Aim = FVector2f(-1.f, -1.f);
		/** The stage's box (a stamp lands on it). */
		FBox2f Stage = FBox2f(FVector2f(StageX0, Y0), FVector2f(X1, Y1));
		/** What the board showed, for the log: the hero, Glim's line, the touches and the stage's figures. */
		FString Said;
		/** Wave W3: the lit feature's node on the map (layout px), for Glim's beam when the stage has no subject. */
		FVector2f TouchAim = FVector2f(-1.f, -1.f);
		/** Wave W3, the board's own audit: its words, the smallest cap it set (layout px), each block that did not fit its box (or
		 *  a node that met another), and each block that lost words to fit. */
		int32 Words = 0;
		float MinCap = 0.f;
		TArray<FString> Overflow;
		TArray<FString> Shortened;
	};

	using FPut = TFunctionRef<void(const FBox2f& Box, const TSharedRef<SWidget>& Widget)>;
	/** Draws one split stop as a control of the caller's family and registers it for the hands and the pad. */
	using FStopControl = TFunctionRef<void(const FBox2f& Box, const FString& Word, bool bOn, int32 Stop)>;

	void Draw(const FIn& In, FPut Put, FStopControl StopControl, FOut& Out);
}
