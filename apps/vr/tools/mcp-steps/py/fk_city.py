# Content step (spark vr-fidelity-40 FK, element 14): the back wall's window widened to the room's right corner, so the
# city's towers stand at the right edge of the target frame as in the concept (the card, beside the lamp's head, covers
# the first window from the target eye). studio_level.py builds the widened opening (WINDOW_OPEN_Y1); this step frames
# its new part. After studio_level.py; then fid_bake.py. Replayable: the frame carries the tag BpCity, removed first.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fk-look.jsonl
#
# The second window_frame (studio-architecture, pivot at its bottom centre, its width along its X, which yaw 90 turns to
# world Y) stands from the first frame's right edge to the corner post, scaled along its width to fit.
import unreal

TAG = "BpCity"
ROOM_X1 = 250.0
WALL = 10.0
ROOM_Y1 = 300.0
ROOM_H = 300.0
WINDOW_Y = (40.0, 190.0)
WINDOW_Z = (20.0, 280.0)
CORNER_POST = 6.0
FRAME = "/Game/Bp/Art/StudioArchitecture/final/StaticMeshes/window_frame"
FRAME_WIDTH = 162.0       # window_frame's bounds along its X (StudioWindowFrame, Lynx 2026-10-25)
FRAME_1_RIGHT = 196.0     # the first frame's right edge (world Y)

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level("/Game/Maps/LightTable")
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)

open_y1 = ROOM_Y1 - CORNER_POST  # studio_level.py WINDOW_OPEN_Y1
result = {}
width = open_y1 - FRAME_1_RIGHT + 4.0
frame = eas.spawn_actor_from_object(unreal.load_asset(FRAME), unreal.Vector(ROOM_X1, FRAME_1_RIGHT + width / 2 - 2.0, WINDOW_Z[0]),
                                    unreal.Rotator(0.0, 0.0, 90.0))
frame.set_actor_label("StudioWindowFrame2")
frame.set_editor_property("tags", [unreal.Name(TAG)])
frame.set_actor_scale3d(unreal.Vector(width / FRAME_WIDTH, 1.0, 1.0))
frame.static_mesh_component.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
first = next(a for a in eas.get_all_level_actors() if a.get_actor_label() == "StudioWindowFrame")
frame.static_mesh_component.set_editor_property("lighting_channels", first.static_mesh_component.get_editor_property("lighting_channels"))
result["frame2"] = {"y": frame.get_actor_location().y, "scale_x": round(width / FRAME_WIDTH, 3)}
result["saved"] = les.save_current_level()
