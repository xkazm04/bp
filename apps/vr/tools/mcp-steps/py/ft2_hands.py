# Content step (spark vr-fidelity-40 FT2, element 12): swap the capture hands on the map as it stands, without replaying
# the studio (studio_level.py places the same pair from its HANDS switch on a full replay). CaptureHandL/R keep their
# placement (studio_level.py's rest, fk_point.py's pointing move: both pairs share build_hands.bpy's PLACE, so the index
# tip lands on the same table point) and get the pair's meshes; the wrist point moves to the pair's watch face.
# HANDS = "hands-capture" puts FB's MakeHuman pair back (the fallback).
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/ft2-hands.jsonl
import unreal

HANDS = "metahuman"  # or "hands-capture"; keep in step with studio_level.py's HANDS
MESHES = {  # studio_level.py's HANDS_MESHES
    "metahuman": ("/Game/Bp/Art/MetaHumanHands/hands_metahuman/StaticMeshes/hand_l",
                  "/Game/Bp/Art/MetaHumanHands/hands_metahuman/StaticMeshes/hand_r"),
    "hands-capture": ("/Game/Bp/Art/HandsCapture/hands_capture/StaticMeshes/hand_l",
                      "/Game/Bp/Art/HandsCapture/hands_capture/StaticMeshes/hand_r"),
}[HANDS]
WRIST_LOCAL = {"hands-capture": (-17.4, 13.7, 11.8), "metahuman": (-12.6, 12.9, 13.6)}[HANDS]  # studio_level.py's

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level("/Game/Maps/LightTable")
actors = {a.get_actor_label(): a for a in eas.get_all_level_actors()}
result = {"hands": HANDS}
for label, mesh in zip(("CaptureHandL", "CaptureHandR"), MESHES):
    smc = actors[label].static_mesh_component
    smc.set_static_mesh(unreal.load_asset(mesh))
    result[label] = {"mesh": mesh, "loc": str(actors[label].get_actor_location())}
wrist = actors["CaptureWrist"]
at = actors["CaptureHandL"].get_actor_transform().transform_location(unreal.Vector(*WRIST_LOCAL))
wrist.set_actor_location(at, False, False)
result["CaptureWrist"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
result["saved"] = les.save_current_level()
