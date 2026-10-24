# Content step (spark vr-fidelity-40 FC2, element 12): import FB's posed capture hands (ArtSource/hands-capture) and give
# them their own materials. Visual only: two static meshes in the capture frame (origin on the table plane at the centre
# of the near paper edge, Blender X to the player's right, Y across the table, Z up), which Interchange lands with UE
# +X = Blender X and UE +Y = Blender -Y; studio_level.py places them. Replayable: replace_existing, and every material
# value is set here.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fid-assembly.jsonl
#
# Skin: a Substrate Slab with the 2048 albedo and a red mean free path, which the forward path renders as wrap
# subsurface (no screen-space diffusion; r4), roughness 0.5, specular 0.35 (F0 0.028). Sleeve: near-black knit,
# roughness 0.95 with a little fuzz.
import os

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
SRC = os.path.join(REPO, "apps", "vr", "ArtSource", "hands-capture")
DEST = "/Game/Bp/Art/HandsCapture"
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
V = unreal.LinearColor

SKIN_SSS_MFP = V(1.0, 0.32, 0.18, 1.0)  # mean free path per channel (cm before the scale): red travels furthest
SKIN_SSS_SCALE = 0.12
SKIN_ROUGHNESS = 0.5
SKIN_F0 = 0.028
SLEEVE_ALBEDO = V(0.013, 0.014, 0.017, 1.0)
SLEEVE_ROUGHNESS = 0.95
SLEEVE_FUZZ = 0.4
SLEEVE_FUZZ_COLOUR = V(0.023, 0.026, 0.033, 1.0)  # #2A2D33

task = unreal.AssetImportTask()
task.filename = os.path.join(SRC, "hands_capture.glb")
task.destination_path = DEST
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])

tex_task = unreal.AssetImportTask()
tex_task.filename = os.path.join(SRC, "textures", "hands_skin_albedo.png")
tex_task.destination_path = DEST + "/Textures"
tex_task.destination_name = "T_HandsSkin_Albedo"
tex_task.automated = True
tex_task.replace_existing = True
tex_task.save = True
tools.import_asset_tasks([tex_task])
albedo = unreal.load_asset(DEST + "/Textures/T_HandsSkin_Albedo")


def fresh_material(path):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        m = unreal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    folder, name = path.rsplit("/", 1)
    return tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())


def expr(m, cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def param(m, name, value, x, y):
    if isinstance(value, unreal.LinearColor):
        return expr(m, unreal.MaterialExpressionVectorParameter, x, y, parameter_name=name, default_value=value)
    return expr(m, unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


def f0(m, value, x, y):
    s = param(m, "F0", value, x, y)
    v = expr(m, unreal.MaterialExpressionAppendVector, x + 150, y)
    a = expr(m, unreal.MaterialExpressionAppendVector, x + 300, y)
    mel.connect_material_expressions(s, "", v, "A")
    mel.connect_material_expressions(s, "", v, "B")
    mel.connect_material_expressions(v, "", a, "A")
    mel.connect_material_expressions(s, "", a, "B")
    return a


skin = fresh_material("/Game/Bp/Materials/M_HandsSkin")
tex = expr(skin, unreal.MaterialExpressionTextureSampleParameter2D, -800, -200, parameter_name="Albedo", texture=albedo)
slab = expr(skin, unreal.MaterialExpressionSubstrateSlabBSDF, 0, 0)
mel.connect_material_expressions(tex, "RGB", slab, "Diffuse Albedo")
mel.connect_material_expressions(f0(skin, SKIN_F0, -800, 50), "", slab, "F0")
mel.connect_material_expressions(param(skin, "Roughness", SKIN_ROUGHNESS, -500, 150), "", slab, "Roughness")
mel.connect_material_expressions(param(skin, "SSSMFP", SKIN_SSS_MFP, -500, 250), "", slab, "SSS MFP")
mel.connect_material_expressions(param(skin, "SSSMFPScale", SKIN_SSS_SCALE, -500, 350), "", slab, "SSS MFP Scale")
mel.connect_material_property(slab, "", unreal.MaterialProperty.MP_FRONT_MATERIAL)
mel.recompile_material(skin)
unreal.EditorAssetLibrary.save_loaded_asset(skin, only_if_is_dirty=False)

sleeve = fresh_material("/Game/Bp/Materials/M_HandsSleeve")
slab = expr(sleeve, unreal.MaterialExpressionSubstrateSlabBSDF, 0, 0)
mel.connect_material_expressions(param(sleeve, "Albedo", SLEEVE_ALBEDO, -500, -200), "", slab, "Diffuse Albedo")
mel.connect_material_expressions(f0(sleeve, 0.02, -800, 50), "", slab, "F0")
mel.connect_material_expressions(param(sleeve, "Roughness", SLEEVE_ROUGHNESS, -500, 150), "", slab, "Roughness")
mel.connect_material_expressions(param(sleeve, "FuzzAmount", SLEEVE_FUZZ, -500, 250), "", slab, "Fuzz Amount")
mel.connect_material_expressions(param(sleeve, "FuzzColor", SLEEVE_FUZZ_COLOUR, -500, 350), "", slab, "Fuzz Color")
mel.connect_material_expressions(param(sleeve, "FuzzRoughness", 0.6, -500, 450), "", slab, "Fuzz Roughness")
mel.connect_material_property(slab, "", unreal.MaterialProperty.MP_FRONT_MATERIAL)
mel.recompile_material(sleeve)
unreal.EditorAssetLibrary.save_loaded_asset(sleeve, only_if_is_dirty=False)

result = {}
for side in ("hand_l", "hand_r"):
    mesh = unreal.load_asset(DEST + "/hands_capture/StaticMeshes/" + side)
    nanite = mesh.get_editor_property("nanite_settings")
    nanite.set_editor_property("enabled", False)
    mesh.set_editor_property("nanite_settings", nanite)
    slots = []
    for sm in mesh.get_editor_property("static_materials"):
        name = str(sm.get_editor_property("material_slot_name"))
        sm.set_editor_property("material_interface", skin if name.startswith("hands_skin") else sleeve)
        slots.append(sm)
    mesh.set_editor_property("static_materials", slots)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
    b = mesh.get_bounding_box()
    result[side] = {"tris": mesh.get_num_triangles(0), "sections": mesh.get_num_sections(0),
                    "slots": [(str(s.material_slot_name), s.material_interface.get_name()) for s in mesh.static_materials],
                    "bounds_cm": [round(v, 1) for v in (b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z)]}
