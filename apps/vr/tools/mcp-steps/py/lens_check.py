# L3.3 check (spark vr-volumes): during PIE, switch the table's lens and compare every tile instance before and after.
# A lens changes a tile's height only (lynx-plan L3.3, "heights carry a reading, never position"), so x, y and the
# footprint scale must be identical. Run: node apps/vr/tools/mcp-call.mjs python <this file> --log
# apps/vr/tools/mcp-steps/l33-capture.jsonl. The lens is LENS below (edit it to try another).
import unreal

LENS = "performance"

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
if world is None:
    raise RuntimeError("no PIE world: StartPIE first")
table = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.load_class(None, "/Script/bp.BpTable"))[0]
tiles = [c for c in table.get_components_by_class(unreal.InstancedStaticMeshComponent) if c.get_name() == "Tiles"][0]


def snapshot():
    out = []
    for i in range(tiles.get_instance_count()):
        t = tiles.get_instance_transform(i, False)
        out.append((t.translation.x, t.translation.y, t.scale3d.x, t.scale3d.y, t.translation.z, t.scale3d.z))
    return out


before = snapshot()
unreal.SystemLibrary.execute_console_command(world, "BpTable.Lens " + LENS)
after = snapshot()
moved = sum(1 for a, b in zip(before, after) if a[:4] != b[:4])
reheighted = sum(1 for a, b in zip(before, after) if a[5] != b[5])
heights = {}
for b in after:
    key = round(b[5] * 100.0, 2)
    heights[key] = heights.get(key, 0) + 1
result = {"lens": LENS, "tiles": len(after), "moved": moved, "reheighted": reheighted, "heights_cm": heights}
