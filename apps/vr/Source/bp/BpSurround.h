// Your room (night two W4, "the desk on your desk"): the light table stands in the wearer's real room, seen through the
// headset's passthrough, and the studio fades out; a toggle (bp.Room, saved; YOUR ROOM / STUDIO on the console's bar and
// in SETTINGS). The table is a work surface, and seeing your own desk, keyboard and coffee while you plan is the point; the
// studio is for when you want to be elsewhere. With the studio's meshes hidden the headset also skips what they cost.
#pragma once

#include "CoreMinimal.h"

class UWorld;

namespace BpSurround
{
	/** bp.Room as asked: 0 the studio, 1 your room. */
	bool WantsRoom();

	/** Steps the studio-to-room fade toward bp.Room and keeps the passthrough layer with it. ABpTable's tick calls it;
	 *  nothing happens while the mode rests. */
	void Tick(UWorld* World, float DeltaSeconds);

	/** One line for bp.QuestTier.Report: the mode, the passthrough layer, what the room hid and switched off. */
	FString ReportLine();
}
