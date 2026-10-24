# L4.2 content step (spark vr-hands-zoom WP5): import the studio kit, the city backdrop and the lamp agent from ArtSource
# through Interchange, as import_frame.py does the frame. The owner lifted the L4.2 deferral for these seven; each one's
# gates pass in its manifest.json (fixture-kit and survey-pin stay out). Replayable: replace_existing, and every material
# value is set again from the source after the import.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-studio.jsonl
#
# - The six GLBs (glTF Y-up; Interchange turns them Z-up, so a prop stands on its pivot with UE +Z up) land in
#   /Game/Bp/Art/<Folder>/final/ with M_GLTF material instances. A re-import keeps the instances it made the first time
#   (Lynx, 2026-10-24, the frame's EmissiveStrength), so each glTF material's factors are copied onto its instance here.
# - lamp-agent's final.fbx (Blender Z-up, shade towards Blender -Y, which lands on UE +Y) comes in as SK_LampAgent with
#   its skeleton (base, lower_arm, upper_arm, head) and its five pose actions. Interchange gives it FBX legacy Phong
#   instances; they are replaced by M_LampAgent instances that carry the flat PBR values of scripts/art/lamp/materials.json
#   (the same values the FBX's slots and PNGs hold). The shade interior's emission is `GlowStrength` on
#   MI_LampAgent_shade_glow, the one parameter UE drives per state from L5.7 on: the source's x6 is the bright end, the
#   resting glow is set below. The interior is brightest at the bulb under the cap and fades to the lip, so the head reads
#   as a lit bulb in a shade, not a flat disc (target capture, Lynx 2026-10-24).
# - Nanite off on every static mesh: under forward shading the frame's Nanite render was unlit black (WP2).
import json
import os
import struct

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
ART = os.path.join(REPO, "apps", "vr", "ArtSource")
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()

GLBS = [  # ArtSource id, /Game/Bp/Art folder, mesh name
    ("studio-desk-lamp", "StudioDeskLamp", "SM_StudioDeskLamp"),
    ("studio-drawing-tubes", "StudioDrawingTubes", "SM_StudioDrawingTubes"),
    ("studio-mug", "StudioMug", "SM_StudioMug"),
    ("studio-pinned-drawings", "StudioPinnedDrawings", "SM_StudioPinnedDrawings"),
    ("studio-shelves", "StudioShelves", "SM_StudioShelves"),
    ("city-backdrop", "CityBackdrop", "SM_CityBackdrop"),
]
LAMP = "/Game/Bp/Art/LampAgent"
LAMP_MATERIAL = "/Game/Bp/Materials/M_LampAgent"
# The resting state's glow (x of the emission colour #FF9E2E, linear); the source's 6.0 is the bright end.
LAMP_RESTING_GLOW = 1.0
# At the bulb the interior glows HOTSPOT x, at the shade's lip EDGE x (the falloff's exponent is FALLOFF).
LAMP_GLOW_HOTSPOT = 5.0
LAMP_GLOW_EDGE = 0.4
LAMP_GLOW_FALLOFF = 2.0
# The bulb: the head bone's rest position in the mesh (UE axes, cm); the glow fades out over the shade's depth.
LAMP_BULB_REST_CM = (0.0, 6.2, 41.2)
LAMP_SHADE_DEPTH_CM = 24.0


def import_one(source, dest, name):
    task = unreal.AssetImportTask()
    task.filename = source
    task.destination_path = dest
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    return list(task.imported_object_paths or [])


def glb_materials(path):
    with open(path, "rb") as f:
        blob = f.read()
    length = struct.unpack_from("<I", blob, 12)[0]
    return json.loads(blob[20:20 + length].decode("utf-8")).get("materials", [])


def linear(rgb, a=1.0):
    return unreal.LinearColor(rgb[0], rgb[1], rgb[2], a)


def srgb_hex(h):
    def channel(c):
        c = int(c, 16) / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return [channel(h[1:3]), channel(h[3:5]), channel(h[5:7])]


result = {"glb": {}}

for art_id, folder, name in GLBS:
    source = os.path.join(ART, art_id, "final.glb")
    dest = "/Game/Bp/Art/" + folder
    imported = import_one(source, dest, name)
    mesh = unreal.load_asset(dest + "/final/StaticMeshes/" + name)
    nanite = mesh.get_editor_property("nanite_settings")
    nanite.set_editor_property("enabled", False)
    mesh.set_editor_property("nanite_settings", nanite)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
    copied = {}
    for m in glb_materials(source):
        mi = unreal.load_asset(dest + "/final/Materials/" + m["name"])
        pbr = m.get("pbrMetallicRoughness", {})
        values = {}
        if "baseColorFactor" in pbr:
            values["BaseColorFactor"] = linear(pbr["baseColorFactor"][:3], pbr["baseColorFactor"][3])
        if "emissiveFactor" in m:
            values["EmissiveFactor"] = linear(m["emissiveFactor"])
        for key, value in values.items():
            mel.set_material_instance_vector_parameter_value(mi, key, value)
        scalars = {}
        if "metallicFactor" in pbr:
            scalars["MetallicFactor"] = pbr["metallicFactor"]
        if "roughnessFactor" in pbr:
            scalars["RoughnessFactor"] = pbr["roughnessFactor"]
        if "emissiveFactor" in m:
            scalars["EmissiveStrength"] = m.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1.0)
        for key, value in scalars.items():
            mel.set_material_instance_scalar_parameter_value(mi, key, value)
        unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
        copied[m["name"]] = sorted(list(values) + list(scalars))
    box = mesh.get_bounding_box()
    result["glb"][folder] = {
        "mesh": mesh.get_path_name(), "imported": len(imported), "nanite": nanite.get_editor_property("enabled"),
        "tris": mesh.get_num_triangles(0), "sections": mesh.get_num_sections(0),
        "bounds_cm": [round(v, 2) for v in (box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)],
        "copied": copied,
    }

# M_LampAgent: lit, flat PBR per slot, plus the shade interior's emission (GlowColor x GlowStrength, 0 on other slots).
if unreal.EditorAssetLibrary.does_asset_exist(LAMP_MATERIAL):
    lm = unreal.load_asset(LAMP_MATERIAL)
    for old in list(mel.get_material_expressions(lm)):
        mel.delete_material_expression(lm, old)
else:
    lm = tools.create_asset("M_LampAgent", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
lm.set_editor_property("used_with_skeletal_mesh", True)


def expr(cls, x, y, **props):
    e = mel.create_material_expression(lm, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


base = expr(unreal.MaterialExpressionVectorParameter, -600, -200, parameter_name="BaseColor",
            default_value=unreal.LinearColor(0.5, 0.5, 0.5, 1.0))
rough = expr(unreal.MaterialExpressionScalarParameter, -600, 0, parameter_name="Roughness", default_value=0.5)
metal = expr(unreal.MaterialExpressionScalarParameter, -600, 100, parameter_name="Metallic", default_value=0.0)
glow_colour = expr(unreal.MaterialExpressionVectorParameter, -600, 250, parameter_name="GlowColor",
                   default_value=unreal.LinearColor(0.0, 0.0, 0.0, 1.0))
glow = expr(unreal.MaterialExpressionScalarParameter, -600, 450, parameter_name="GlowStrength", default_value=0.0)
# facing = (1 - |rest-pose position - bulb| / SHADE_DEPTH)^FALLOFF: 1 at the bulb under the cap, 0 at the shade's lip
# (the TRELLIS shade is one shell whose normals point outwards on the inside too, so a view-angle hotspot lit the lip);
# shape = lerp(EDGE, HOTSPOT, facing). The pre-skinned position is the rest pose, where the bulb sits at the head bone.
rest = expr(unreal.MaterialExpressionPreSkinnedPosition, -1400, 600)
local = expr(unreal.MaterialExpressionVertexInterpolator, -1250, 600)  # read in the vertex shader, as M_EdgeGlow does
mel.connect_material_expressions(rest, "", local, "VS")
bulb = expr(unreal.MaterialExpressionConstant3Vector, -1200, 700, constant=unreal.LinearColor(*LAMP_BULB_REST_CM, 1.0))
dist = expr(unreal.MaterialExpressionDistance, -1050, 650)
mel.connect_material_expressions(local, "", dist, "A")
mel.connect_material_expressions(bulb, "", dist, "B")
depth = expr(unreal.MaterialExpressionDivide, -900, 650, const_b=LAMP_SHADE_DEPTH_CM)
mel.connect_material_expressions(dist, "", depth, "A")
near = expr(unreal.MaterialExpressionOneMinus, -800, 650)
mel.connect_material_expressions(depth, "", near, "")
facing = expr(unreal.MaterialExpressionSaturate, -700, 650)
mel.connect_material_expressions(near, "", facing, "")
power = expr(unreal.MaterialExpressionPower, -600, 650, const_exponent=LAMP_GLOW_FALLOFF)
mel.connect_material_expressions(facing, "", power, "Base")
shape = expr(unreal.MaterialExpressionLinearInterpolate, -450, 650, const_a=LAMP_GLOW_EDGE, const_b=LAMP_GLOW_HOTSPOT)
mel.connect_material_expressions(power, "", shape, "Alpha")
strength = expr(unreal.MaterialExpressionMultiply, -300, 500)
mel.connect_material_expressions(glow, "", strength, "A")
mel.connect_material_expressions(shape, "", strength, "B")
emissive = expr(unreal.MaterialExpressionMultiply, -150, 300)
mel.connect_material_expressions(glow_colour, "", emissive, "A")
mel.connect_material_expressions(strength, "", emissive, "B")
mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
mel.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
mel.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(lm)
unreal.EditorAssetLibrary.save_loaded_asset(lm, only_if_is_dirty=False)

imported = import_one(os.path.join(ART, "lamp-agent", "final.fbx"), LAMP, "SK_LampAgent")
with open(os.path.join(REPO, "scripts", "art", "lamp", "materials.json"), encoding="utf-8") as f:
    regions = json.load(f)["regions"]
by_slot = {}
for region, spec in regions.items():
    mi_path = LAMP + "/Materials/MI_LampAgent_" + spec["slot"].replace("lamp_", "")
    if unreal.EditorAssetLibrary.does_asset_exist(mi_path):
        mi = unreal.load_asset(mi_path)
    else:
        mi = tools.create_asset(mi_path.rsplit("/", 1)[1], LAMP + "/Materials", unreal.MaterialInstanceConstant,
                                unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, lm)
    mel.set_material_instance_vector_parameter_value(mi, "BaseColor", linear(srgb_hex(spec["color"])))
    mel.set_material_instance_scalar_parameter_value(mi, "Roughness", spec["roughness"])
    mel.set_material_instance_scalar_parameter_value(mi, "Metallic", spec["metal"])
    if "emission" in spec:
        mel.set_material_instance_vector_parameter_value(mi, "GlowColor", linear(srgb_hex(spec["emission"])))
        mel.set_material_instance_scalar_parameter_value(mi, "GlowStrength", LAMP_RESTING_GLOW)
    unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
    by_slot[spec["slot"]] = mi

sk = unreal.load_asset(LAMP + "/SK_LampAgent")
slots = []
for sm in sk.get_editor_property("materials"):
    # Interchange may suffix a slot name (lamp_shade_glow_001 on Lynx, 2026-10-24); match on the source's name.
    name = str(sm.get_editor_property("material_slot_name"))
    key = next((s for s in sorted(by_slot, key=len, reverse=True) if name == s or name.startswith(s + "_")), None)
    if key:
        sm.set_editor_property("material_interface", by_slot[key])
    slots.append(sm)
    result.setdefault("lamp_slots", {})[name] = by_slot[key].get_name() if key else None
sk.set_editor_property("materials", slots)
unreal.EditorAssetLibrary.save_loaded_asset(sk, only_if_is_dirty=False)

b = sk.get_bounds()
result["lamp"] = {
    "mesh": sk.get_path_name(), "imported": len(imported),
    "bounds_origin_cm": [round(b.origin.x, 2), round(b.origin.y, 2), round(b.origin.z, 2)],
    "bounds_extent_cm": [round(b.box_extent.x, 2), round(b.box_extent.y, 2), round(b.box_extent.z, 2)],
    "glow": mel.get_material_instance_scalar_parameter_value(by_slot["lamp_shade_glow"], "GlowStrength"),
    "folder": [str(p) for p in unreal.EditorAssetLibrary.list_assets(LAMP, recursive=True)],
}
