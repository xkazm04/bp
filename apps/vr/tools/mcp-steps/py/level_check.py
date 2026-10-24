# L3.4 check (spark vr-hands-zoom WP3, "Lift"): during PIE, take the table through L0 -> L1 -> L2 and back with the
# console, re-height the tiles at L2, and compare everything with L0. The hard rule: a level change never moves anything
# in plan space, and back at L0 every room, bay and tile instance (world space) and every label (world position) is
# exactly where it was. Exact float equality, no tolerance.
#
# Run during PIE, once per step, until it prints "done" (the transitions ease over real frames, and the game does not
# tick while a script runs, so each call checks that the last step has settled, records it, and sends the next):
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/level_check.py --log apps/vr/tools/mcp-steps/l34-levels.jsonl
# State between calls: Saved/level_check.json (deleted by the first call when it holds a finished run).
import json
import os
import unreal

WING = "0:OPS"  # B, Studio operations
ROOM = "scheduling"  # its first room, three bays
STEPS = [
    "BpLevel.Enter " + WING,
    "BpLevel.Enter " + ROOM,
    "BpTable.Lens performance",
    "BpLevel.Back",
    "BpLevel.Back",
    "BpTable.Lens business",
]
STATE = os.path.join(unreal.Paths.project_saved_dir(), "level_check.json")
# Paper and plan (ABpTable's constants, and Kettle's islands extent 3810 x 1678 u at its origin).
PAPER_W, PAPER_D, UNIT = 166.0, 76.0, 0.037
MARGIN = ((PAPER_W - 3810 * UNIT) / 2, (PAPER_D - 1678 * UNIT) / 2)

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
if world is None:
    raise RuntimeError("no PIE world: StartPIE first")
tables = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.load_class(None, "/Script/bp.BpTable"))
table = tables[0]
batches = {c.get_name(): c for c in table.get_components_by_class(unreal.InstancedStaticMeshComponent)}
labels = sorted(table.get_components_by_class(unreal.WidgetComponent), key=lambda c: c.get_name())


def tf(t):
    return [t.translation.x, t.translation.y, t.translation.z, t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w,
            t.scale3d.x, t.scale3d.y, t.scale3d.z]


def snapshot():
    out = {"instances": {}, "relative": {}, "labels": {}}
    for name in ("Rooms", "Bays", "Tiles"):
        c = batches[name]
        out["instances"][name] = [tf(c.get_instance_transform(i, True)) for i in range(c.get_instance_count())]
        out["relative"][name] = [tf(c.get_instance_transform(i, False)) for i in range(c.get_instance_count())]
    for c in labels:
        p = c.get_world_location()
        out["labels"][c.get_name()] = [p.x, p.y, p.z]
    return out


def differs(a, b, footprint_only=False):
    # footprint_only: x, y and the scale across (what a lens may never touch)
    keys = (0, 1, 7, 8) if footprint_only else range(10)
    return any(a[k] != b[k] for k in keys)


def hit(plan_x, plan_y, z=250.0):
    u, v = MARGIN[0] + plan_x * UNIT, MARGIN[1] + plan_y * UNIT
    local = unreal.Vector(PAPER_D / 2 - v, u - PAPER_W / 2, z)
    origin = table.get_actor_transform().transform_location(local)
    r = table.hit_test(origin, unreal.Vector(0.0, 0.0, -1.0))
    return list(r) if isinstance(r, (tuple, list)) else [r]


def hit_paper(u, v, z=250.0):
    local = unreal.Vector(PAPER_D / 2 - v, u - PAPER_W / 2, z)
    r = table.hit_test(table.get_actor_transform().transform_location(local), unreal.Vector(0.0, 0.0, -1.0))
    return list(r) if isinstance(r, (tuple, list)) else [r]


def observe():
    return {
        "level": str(table.get_bp_level()), "wing": table.get_wing_id(), "room": table.get_room_id(),
        "crumb": table.get_breadcrumb(),
        "visible": {n: batches[n].is_visible() for n in ("Rooms", "Bays", "Tiles")},
        "labels_shown": sum(1 for c in labels if c.is_visible()),
        "rooms_batch": tf(batches["Rooms"].get_relative_transform()),
        "tiles_batch": tf(batches["Tiles"].get_relative_transform()),
        # rays straight down: the booking room's and the scheduling room's centres, and the breadcrumb's right end (FC1: it is
        # drawn in the sheet, right-aligned 30 cm in from the paper's right edge, its line box's bottom 1.4 cm above the near edge)
        "hit_booking": hit(1213, 708), "hit_scheduling": hit(1213, 245), "hit_title_end": hit_paper(PAPER_W - 31.0, PAPER_D - 3.0),
    }


state = None
if os.path.exists(STATE):
    with open(STATE) as f:
        state = json.load(f)
    if state.get("done"):
        state = None

if state is None:
    # Step 0: L0 as it stands, then the first command.
    unreal.SystemLibrary.execute_console_command(world, "bp.ReducedMotion 0")
    state = {"step": 0, "l0": snapshot(), "observed": [{"after": "start", **observe()}]}
    unreal.SystemLibrary.execute_console_command(world, STEPS[0])
    state["step"] = 1
    with open(STATE, "w") as f:
        json.dump(state, f)
    result = {"sent": STEPS[0], "next": "run again"}
elif table.is_level_moving():
    result = {"waiting": "the last step is still easing; run again", "step": state["step"]}
else:
    now = snapshot()
    o = observe()
    o["after"] = STEPS[state["step"] - 1]
    l0 = state["l0"]
    # Plan space never moves: every instance's place in its batch, x, y and the scale across, equals L0's.
    o["plan_moved"] = sum(1 for n in l0["relative"] for a, b in zip(l0["relative"][n], now["relative"][n]) if differs(a, b, True))
    o["world_differs"] = {n: sum(1 for a, b in zip(l0["instances"][n], now["instances"][n]) if differs(a, b)) for n in l0["instances"]}
    state["observed"].append(o)
    if state["step"] < len(STEPS):
        unreal.SystemLibrary.execute_console_command(world, STEPS[state["step"]])
        result = {"sent": STEPS[state["step"]], "observed": o, "next": "run again"}
        state["step"] += 1
    else:
        moved = {n: sum(1 for a, b in zip(l0["instances"][n], now["instances"][n]) if differs(a, b)) for n in l0["instances"]}
        labels_moved = sum(1 for k in l0["labels"] if l0["labels"][k] != now["labels"].get(k))
        counts = {n: len(v) for n, v in l0["instances"].items()}
        result = {
            "done": True,
            "back_at_l0_equal": all(v == 0 for v in moved.values()) and labels_moved == 0,
            "instances": counts, "labels": len(l0["labels"]),
            "instances_moved": moved, "labels_moved": labels_moved,
            "steps": [{k: s[k] for k in ("after", "level", "wing", "room", "crumb", "visible", "labels_shown", "plan_moved",
                                          "world_differs", "hit_booking", "hit_scheduling", "hit_title_end") if k in s}
                      for s in state["observed"]],
        }
        state["done"] = True
    with open(STATE, "w") as f:
        json.dump(state, f)
