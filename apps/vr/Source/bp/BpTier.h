// The Quest fidelity tier (docs/concepts/vr-light-table/standalone-plan.md, S4): the cheaper look the headset's own GPU
// draws, decided in code only where code already places things. The config half lives in Config/Android (the renderer)
// and Config/DefaultDeviceProfiles.ini (textures capped at 1k on Android); the PC look stays the quality bar and is
// untouched: the tier is on only on a mobile feature level, or when bp.QuestTier 1 previews it on the PC.
#pragma once

#include "CoreMinimal.h"

class UWorld;

namespace BpTier
{
	/** bp.QuestTier: 1 on, 0 off, -1 (default) on where the world renders at a mobile feature level (the Quest APK). */
	bool IsOn(const UWorld* World);

	/** Brings the world's level dressing in line with the tier: the haze cards (the M_Haze* translucency stacks the
	 *  look's passes stood in the studio) hide while the tier is on and come back when it goes off. Cheap when nothing
	 *  changed; ABpTable's tick calls it. Logs `BpTier: ...` when it switches. */
	void Apply(UWorld* World);

	/** The live hand shadow's capture rate while the tier is on, 0 for none (bp.QuestTier.HandShadowHz, read live; the PC captures every frame). */
	float HandShadowHz();
}
