// The app's two sound levels and its music bed (night two W1, the owner on the Quest 3S 2026-11-09: "Volume 200% should be new
// default 100%", "put in background", "Settings would be able to manage both volume settings").
//
// Voice: bp.VoiceLevel 0 to 1.5 (shown as 0 to 150 %), default 1.0; every clip Glim says plays at VoiceGain() =
// VoiceGainAtFull x the level. 1.0 first sounded as the old bp.VoiceVolume 2.0 did (gain 2); the owner on the Quest 3S,
// 2026-11-10: "it can be louder with 20% increase to set new default", so 100 % is now the old 120 % (gain 2.4) and a saved
// level keeps meaning its percentage (no migration). bp.VoiceVolume is gone: its one reader (the tour) and its one stepper (the
// wrist) read this. Saved to Saved/BpTable.json (FBpStore) [/Script/bp.BpAudio] VoiceLevel; a saved old [/Script/bp.BpVoice] VoiceVolume
// is migrated once (old / 2, clamped) and then removed, so nobody's saved level doubles.
// Music: bp.MusicLevel 0 to 1 (shown as %), default 0.35, saved beside it. The bed (Content/BpData/music/bed.wav, 16-bit
// stereo PCM at 32 kHz, the whole file the loop) streams from one copy of its samples through a USoundWaveProcedural, 2D,
// half-second chunks queued from the pawn's tick and wrapped at its end; level 0 stops and frees the stream. Under a tour
// line it ducks bp.MusicDuckDb (8 dB) over 0.3 s and comes back over 0.8 s; it pauses while the app has lost its XR focus
// (bp.TourFocus's rule, as the tour pauses).
#pragma once

#include "CoreMinimal.h"

namespace BpAudio
{
	/** bp.VoiceLevel, clamped to 0..1.5. */
	float VoiceLevel();
	/** The gain at 100 % (bp.VoiceLevel 1): the clips are levelled to -14 LUFS, -1 dBFS ceiling; LimitSample keeps any gain
	 *  from clipping. 2.0 until 2026-11-10, then the old 120 %. */
	constexpr float VoiceGainAtFull = 2.4f;
	/** The gain a voice clip's samples take: VoiceGainAtFull x VoiceLevel (0..3.6). */
	float VoiceGain();
	/** Steps bp.VoiceLevel by Delta, snapped to VoiceStep; saved by the cvar's change. */
	void StepVoiceLevel(float Delta);
	/** bp.MusicLevel, clamped to 0..1. */
	float MusicLevel();
	void StepMusicLevel(float Delta);
	constexpr float VoiceStep = 0.1f;
	constexpr float MusicStep = 0.05f;
	/** Reads the saved levels and toggles (once a run: the pawn at BeginPlay), migrating the old voice key, and from then on
	 *  saves each change. The toggles saved beside them: bp.WristFace, bp.WristHand, bp.ReducedMotion, bp.Room ([/Script/bp.BpSettings]). */
	void LoadSettings();
	/** A sample scaled by a gain, through a soft knee above 0.8 full scale: loud at the top of the range, never clipped. */
	float LimitSample(float X);
	/** A 16-bit PCM WAV's rate, channels and data chunk (offset and bytes). False for any other shape. */
	bool ReadWav(const TArray<uint8>& File, int32& OutRate, int32& OutChannels, int32& OutOffset, int32& OutBytes);
	/** The person is in the app: no headset, or the XR session is focused (bp.TourFocus -1); 0 acts as lost, 1 as always in. */
	bool HasFocus();
}
