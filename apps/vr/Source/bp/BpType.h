// The sheet's typography (spark vr-fidelity-40 FC3): one family, a type scale of named recipes, and the text floor.
//
// Family: Barlow Semi Condensed (Jeremy Tribby, SIL Open Font License 1.1, from github.com/google/fonts
// ofl/barlowsemicondensed; the faces and OFL.txt are in apps/vr/Fonts/BarlowSemiCondensed, imported as /Game/Bp/Fonts).
// A DIN-like technical grotesk: its capitals average 0.533 em against Roboto's 0.641, so a wing name fits a wing at a
// larger cap, and its open apertures survive the paper's foreshortening (fc3 legibility renders against Roboto, Barlow
// Condensed and IBM Plex Sans Condensed). Two faces, under the role names canvas text and Slate ask for: "Regular" is
// its Medium, "Bold" its SemiBold. Thinner weights break up when the sheet is minified toward the far edge.
//
// The floor (lynx-plan R4's text floor): a text's cap height, where it stands on the paper, subtends at least FloorPx
// in the 1600 x 900, 90-degree target capture (BpView.Pose target) and FloorArcmin from the play eye. The binding one
// is the capture almost everywhere (it resolves about 14 px a degree; a Quest 3 about 25). A far label is therefore
// taller on the paper than a near one, so both read alike. Where a class cannot meet the floor in the room it has, it
// is abbreviated (blueprint-ui's fit rule: cut at a word with an ellipsis) or dropped, never drawn smaller.
#pragma once

#include "CoreMinimal.h"

namespace BpType
{
	/** Barlow's vertical metrics per em (hhea: ascender 1000, descender 200 of 1000; OS/2 cap height 700). Slate sets a
	 *  line box's top the ascender above the baseline. */
	constexpr double CapPerEm = 0.700;
	constexpr double AscPerEm = 1.000;
	constexpr double DescPerEm = 0.200;

	/** The floor, in capture pixels at the target pose and in arcminutes at the play pose. 6 px: the smallest cap the
	 *  fc3 renders read at (5 px blurs digits into each other); 22': HFES 100's preferred 20 to 22' for display text,
	 *  at its top. */
	constexpr double FloorPx = 6.0;
	constexpr double FloorArcmin = 22.0;

	/** One text class: its face, its preferred cap height on the paper (cm; the floor may raise it), its tracking (em),
	 *  and whether it is set in capitals. */
	struct FRecipe
	{
		const TCHAR* Face;
		double CapCm;
		double TrackEm;
		bool bUpper;
	};

	/** The drawing's title ("SITE PLAN — LEVEL 0"). */
	constexpr FRecipe Title{ TEXT("Bold"), 1.6, 0.06, true };
	/** The title block's second line (product and lens) and the scale bar's figures. */
	constexpr FRecipe TitleSub{ TEXT("Regular"), 0.8, 0.10, true };
	constexpr FRecipe Figure{ TEXT("Regular"), 0.6, 0.04, true };
	/** Above each wing, lookdev 00's small "WING 03": the wing's tag, then its name. */
	constexpr FRecipe WingTag{ TEXT("Regular"), 1.0, 0.18, true };
	constexpr FRecipe WingName{ TEXT("Bold"), 1.6, 0.03, true };
	/** A room's name in its header strip (capitals: no descenders to clear the first bay). */
	constexpr FRecipe RoomName{ TEXT("Regular"), 0.9, 0.06, true };
	/** The breadcrumb (WP3's way back; the hands pinch it, so it stays large). */
	constexpr FRecipe Crumb{ TEXT("Regular"), 1.6, 0.0, false };
	/** A pin's tag: the finding's id (cap in tag-atlas pixels, the tag cell being 162 px tall). */
	constexpr FRecipe PinTag{ TEXT("Bold"), 50.0, 0.02, true };

	/** The fit rule's ellipsis (blueprint-ui.md, fitStamp: cut at a word, at least two words kept). */
	inline const TCHAR* Ellipsis() { return TEXT("…"); }
}
