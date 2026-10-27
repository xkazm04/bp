# Content step (spark vr-fidelity-40 FT2, element 12): import the MetaHuman capture hands (scripts/art/hands/
# build_mh_hands.bpy, from the body ft_metahuman.py exports) and give them the MetaHuman skin. Two static meshes in the
# capture frame, as hands-capture's (origin on the table plane at the centre of the near paper edge, Blender X to the
# player's right, Y across the table, Z up; Interchange lands UE +X = Blender X, UE +Y = Blender -Y); studio_level.py
# places them when HANDS is "metahuman". The GLB lives in the git-ignored apps/vr/Saved/MetaHumanHands, and the UE assets
# this step writes are git-ignored too (bp is public; the owner's licence ruling, 2026-10-26): every machine builds them
# locally from its own Epic-licensed engine (apps/vr/README.md, "MetaHuman hands").
# Replayable: replace_existing, and every slot is set here.
# Order: ft_metahuman.py (character, skin, MI_CaptureHands_Skin, body FBX) -> build_mh_hands.bpy -> this -> studio_level.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/ft2-hands.jsonl
#
# Skin: MI_CaptureHands_Skin, a constant instance of the Creator's body skin (MI_Skin_Body_MHC: M_skin_unified_UI, a
# subsurface-profile skin with Core Data's body textures, cavity and micro-tiling detail). Sleeve and watch: hands-
# capture's (import_hands.py).
import os

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
GLB = os.path.join(REPO, "apps", "vr", "Saved", "MetaHumanHands", "hands_metahuman.glb")
DEST = "/Game/Bp/Art/MetaHumanHands"
SKIN = "/Game/Bp/Art/MetaHuman/MI_CaptureHands_Skin"
SLEEVE = "/Game/Bp/Materials/M_HandsSleeve"
WATCH = "/Game/Bp/Materials/M_HandsWatch"

tools = unreal.AssetToolsHelpers.get_asset_tools()
task = unreal.AssetImportTask()
task.filename = GLB
task.destination_path = DEST
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])

mats = {"mh_skin": unreal.load_asset(SKIN), "hands_sleeve": unreal.load_asset(SLEEVE), "hands_watch": unreal.load_asset(WATCH)}
result = {"glb": GLB}
for side in ("hand_l", "hand_r"):
    path = DEST + "/hands_metahuman/StaticMeshes/" + side
    mesh = unreal.load_asset(path)
    nanite = mesh.get_editor_property("nanite_settings")
    nanite.set_editor_property("enabled", False)  # Nanite renders black on the forward path
    mesh.set_editor_property("nanite_settings", nanite)
    slots = []
    for sm in mesh.get_editor_property("static_materials"):
        name = str(sm.get_editor_property("material_slot_name"))
        sm.set_editor_property("material_interface", next(m for k, m in mats.items() if name.startswith(k)))
        slots.append(sm)
    mesh.set_editor_property("static_materials", slots)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
    b = mesh.get_bounding_box()
    result[side] = {"path": path, "tris": mesh.get_num_triangles(0), "sections": mesh.get_num_sections(0),
                    "slots": [(str(s.material_slot_name), s.material_interface.get_name()) for s in mesh.static_materials],
                    "bounds_cm": [round(v, 1) for v in (b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z)]}
