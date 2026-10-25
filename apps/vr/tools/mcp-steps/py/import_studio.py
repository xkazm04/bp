# L4.2 content step (spark vr-hands-zoom WP5): import the studio kit, the city backdrop and the lamp agent from ArtSource
# through Interchange, as import_frame.py does the frame. The owner lifted the L4.2 deferral for these seven; each one's
# gates pass in its manifest.json (fixture-kit and survey-pin stay out). Replayable: replace_existing, and every material
# value is set again from the source after the import.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-studio.jsonl
#
# - The six GLBs (glTF Y-up; Interchange turns them Z-up, so a prop stands on its pivot with UE +Z up) land in
#   /Game/Bp/Art/<Folder>/final/ with M_GLTF material instances. A re-import keeps the instances it made the first time
#   (Lynx, 2026-10-24, the frame's EmissiveStrength), so each glTF material's factors are copied onto its instance here.
# - lamp-agent (spark vr-fidelity-40): final_working.glb comes in as the static SM_LampAgent under
#   /Game/Bp/Art/LampAgentStatic with its baked textures and M_LampAgentFid / M_LampAgentGlowCard instances (below). The
#   old skeletal lamp (/Game/Bp/Art/LampAgent/SK_LampAgent, scripts/art/lamp/materials.json) is superseded and left
#   unreferenced; final.fbx (the new rig) waits for L5.7.
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
    # FD's three density kits (spark vr-fidelity-40 FF): one atlas each; studio-architecture holds two meshes,
    # window_frame and pendant_lamp, which Interchange names after their glTF nodes.
    ("studio-wall-kit", "StudioWallKit", "SM_StudioWallKit"),
    ("studio-desk-clutter", "StudioDeskClutter", "SM_StudioDeskClutter"),
    ("studio-architecture", "StudioArchitecture", "SM_StudioArchitecture"),
]
# GLBs whose meshes are named by their nodes, not by the import's destination name.
MULTI_MESH = {"studio-architecture": ("window_frame", "pendant_lamp")}
# GLBs whose one UV set overlaps (atlas islands shared or shrunk): Lightmass read the wall kit's at 21 % overlap and the
# pinned drawings' at 12 % (Lynx, 2026-10-25), so the build makes a lightmap UV in channel 1, as for the lamp agent.
OWN_LIGHTMAP_UV = ("studio-pinned-drawings", "studio-wall-kit", "studio-desk-clutter", "studio-architecture")
# The rebuilt city (FB) is authored at emission 1.0; under the filmic curve and a 0.7 bloom threshold its window lights
# stayed under the bloom, so its strength is raised here until they cross it (spark vr-fidelity-40 FC2).
EMISSIVE_OVERRIDE = {"city_backdrop_emissive": 3.0, "bulb_glow": 6.0}  # the pendants' bulbs cross the bloom (FF)
LAMP = "/Game/Bp/Art/LampAgentStatic"
LAMP_SOURCE = "final_working.glb"
LAMP_MATERIAL = "/Game/Bp/Materials/M_LampAgentFid"
LAMP_CARD_MATERIAL = "/Game/Bp/Materials/M_LampAgentGlowCard"
# The resting state's glow: the orb, the slit and the pin glow GlowColor x GlowStrength; the hood inside x HOOD_SCALE of it
# (FB's hand-over, spark vr-fidelity-40). L5.7 drives GlowStrength per state on the instances that carry it.
LAMP_GLOW = 5.0
LAMP_GLOW_COLOUR = "#FFA94D"
LAMP_HOOD_SCALE = 0.12  # 0.15 until FF: the bowl read flat amber; FF's 0.05 rendered it near black (FG), the concept's is a warm lit bowl
LAMP_CARD_GLOW = 1.5
# Shell: base colour texture x lerp(1, AO, AO_MIX) from the ORM's R (the forward path's SSAO is weak).
LAMP_AO_MIX = 0.6

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
    meshes = [unreal.load_asset(dest + "/final/StaticMeshes/" + n) for n in MULTI_MESH.get(art_id, (name,))]
    for mesh in meshes:
        nanite = mesh.get_editor_property("nanite_settings")
        nanite.set_editor_property("enabled", False)
        mesh.set_editor_property("nanite_settings", nanite)
        if art_id in OWN_LIGHTMAP_UV:
            sme = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
            build = sme.get_lod_build_settings(mesh, 0)
            build.set_editor_property("generate_lightmap_u_vs", True)
            build.set_editor_property("src_lightmap_index", 0)
            build.set_editor_property("dst_lightmap_index", 1)
            sme.set_lod_build_settings(mesh, 0, build)
            mesh.set_editor_property("light_map_coordinate_index", 1)
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
        if m["name"] in EMISSIVE_OVERRIDE:
            scalars["EmissiveStrength"] = EMISSIVE_OVERRIDE[m["name"]]
        for key, value in scalars.items():
            mel.set_material_instance_scalar_parameter_value(mi, key, value)
        unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
        copied[m["name"]] = sorted(list(values) + list(scalars))
    for mesh in meshes:
        box = mesh.get_bounding_box()
        result["glb"][mesh.get_name()] = {
            "mesh": mesh.get_path_name(), "imported": len(imported),
            "nanite": mesh.get_editor_property("nanite_settings").get_editor_property("enabled"),
            "tris": mesh.get_num_triangles(0), "sections": mesh.get_num_sections(0),
            "bounds_cm": [round(v, 2) for v in (box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)],
            "copied": copied,
        }

# The lamp agent (spark vr-fidelity-40): FB's rebuilt figure, final_working.glb, placed as a STATIC mesh in its working
# pose (5 sections, no skinning; final.fbx keeps the rig for L5.7). The GLB carries flat factors and no images, so its
# three textures come in from textures/ and the five slots get M_LampAgentFid instances (lit, clear coat) and one
# M_LampAgentGlowCard instance (unlit, additive, two-sided), every value set here.


def import_texture(source, dest, name, srgb):
    task = unreal.AssetImportTask()
    task.filename = source
    task.destination_path = dest
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    tex = unreal.load_asset(dest + "/" + name)
    tex.set_editor_property("srgb", srgb)
    if not srgb:
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
    unreal.EditorAssetLibrary.save_loaded_asset(tex, only_if_is_dirty=False)
    return tex


def fresh_material(path):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        m = unreal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    folder, name = path.rsplit("/", 1)
    return tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())


def instance(path, parent):
    mi = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.create_asset(
        path.rsplit("/", 1)[1], path.rsplit("/", 1)[0], unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    return mi


lamp_src = os.path.join(ART, "lamp-agent")
imported = import_one(os.path.join(lamp_src, LAMP_SOURCE), LAMP, "SM_LampAgent")
lamp_mesh = unreal.load_asset(LAMP + "/final_working/StaticMeshes/SM_LampAgent")
nanite = lamp_mesh.get_editor_property("nanite_settings")
nanite.set_editor_property("enabled", False)
lamp_mesh.set_editor_property("nanite_settings", nanite)
# The figure's one UV set overlaps (mirrored parts share the atlas): Lightmass read it as a lightmap at 33 % overlap
# (Lynx, 2026-10-24), so the build makes a lightmap UV in channel 1.
sme = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
build = sme.get_lod_build_settings(lamp_mesh, 0)
build.set_editor_property("generate_lightmap_u_vs", True)
build.set_editor_property("src_lightmap_index", 0)
build.set_editor_property("dst_lightmap_index", 1)
sme.set_lod_build_settings(lamp_mesh, 0, build)
lamp_mesh.set_editor_property("light_map_coordinate_index", 1)
tex = {
    "base": import_texture(os.path.join(lamp_src, "textures", "agent_basecolor.png"), LAMP + "/Textures", "T_Agent_BaseColor", True),
    "orm": import_texture(os.path.join(lamp_src, "textures", "agent_orm.png"), LAMP + "/Textures", "T_Agent_ORM", False),
    "card": import_texture(os.path.join(lamp_src, "textures", "agent_glow_card.png"), LAMP + "/Textures", "T_Agent_GlowCard", True),
}

# M_LampAgentFid: base = lerp(BaseColor, BaseTex x lerp(1, AO, AOMix), UseTexture); a hazy second lobe for the clear
# coat; emissive GlowColor x GlowStrength x GlowScale.
lm = fresh_material(LAMP_MATERIAL)
lm.set_editor_property("two_sided", True)


def expr(m, cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def param(m, name, value, x, y):
    if isinstance(value, unreal.LinearColor):
        return expr(m, unreal.MaterialExpressionVectorParameter, x, y, parameter_name=name, default_value=value)
    return expr(m, unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


base_tex = expr(lm, unreal.MaterialExpressionTextureSampleParameter2D, -1200, -300, parameter_name="BaseTex", texture=tex["base"])
orm_tex = expr(lm, unreal.MaterialExpressionTextureSampleParameter2D, -1200, 0, parameter_name="ORMTex", texture=tex["orm"],
               sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
ao_mix = param(lm, "AOMix", LAMP_AO_MIX, -1000, 150)
ao = expr(lm, unreal.MaterialExpressionLinearInterpolate, -850, 50, const_a=1.0)
mel.connect_material_expressions(ao_mix, "", ao, "Alpha")
mel.connect_material_expressions(orm_tex, "R", ao, "B")
textured = expr(lm, unreal.MaterialExpressionMultiply, -700, -250)
mel.connect_material_expressions(base_tex, "RGB", textured, "A")
mel.connect_material_expressions(ao, "", textured, "B")
flat = param(lm, "BaseColor", unreal.LinearColor(0.8, 0.79, 0.77, 1.0), -700, -450)
use_tex = param(lm, "UseTexture", 1.0, -700, -100)
base = expr(lm, unreal.MaterialExpressionLinearInterpolate, -500, -300)
mel.connect_material_expressions(flat, "", base, "A")
mel.connect_material_expressions(textured, "", base, "B")
mel.connect_material_expressions(use_tex, "", base, "Alpha")
glow_colour = param(lm, "GlowColor", unreal.LinearColor(0.0, 0.0, 0.0, 1.0), -700, 300)
glow = param(lm, "GlowStrength", 0.0, -700, 450)
glow_scale = param(lm, "GlowScale", 1.0, -700, 550)
g1 = expr(lm, unreal.MaterialExpressionMultiply, -500, 400)
mel.connect_material_expressions(glow, "", g1, "A")
mel.connect_material_expressions(glow_scale, "", g1, "B")
emissive = expr(lm, unreal.MaterialExpressionMultiply, -350, 350)
mel.connect_material_expressions(glow_colour, "", emissive, "A")
mel.connect_material_expressions(g1, "", emissive, "B")
# Substrate (r.Substrate=True): one Slab whose second specular lobe (Second Roughness at Haze weight) is the clear coat;
# ProjectGBufferFormat=0 allows one closure, so no vertical layering (r4).
metal = expr(lm, unreal.MaterialExpressionSubstrateMetalnessToDiffuseAlbedoF0, -200, -100)
mel.connect_material_expressions(base, "", metal, "BaseColor")
mel.connect_material_expressions(param(lm, "Metallic", 0.0, -350, 100), "", metal, "Metallic")
slab = expr(lm, unreal.MaterialExpressionSubstrateSlabBSDF, 0, 0)
mel.connect_material_expressions(metal, "DiffuseAlbedo", slab, "Diffuse Albedo")
mel.connect_material_expressions(metal, "F0", slab, "F0")
mel.connect_material_expressions(param(lm, "Roughness", 0.35, -350, 0), "", slab, "Roughness")
mel.connect_material_expressions(param(lm, "ClearCoatRoughness", 0.08, -350, 700), "", slab, "Second Roughness")
mel.connect_material_expressions(param(lm, "Haze", 0.5, -350, 600), "", slab, "Second Roughness Weight")
mel.connect_material_expressions(emissive, "", slab, "Emissive Color")
mel.connect_material_property(slab, "", unreal.MaterialProperty.MP_FRONT_MATERIAL)
mel.recompile_material(lm)
unreal.EditorAssetLibrary.save_loaded_asset(lm, only_if_is_dirty=False)

# M_LampAgentGlowCard: unlit, additive, two-sided, no depth write: card texture x GlowColor x GlowStrength.
cm = fresh_material(LAMP_CARD_MATERIAL)
cm.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
cm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
cm.set_editor_property("two_sided", True)
card_tex = expr(cm, unreal.MaterialExpressionTextureSampleParameter2D, -700, -100, parameter_name="CardTex", texture=tex["card"])
cc = param(cm, "GlowColor", unreal.LinearColor(1.0, 0.46, 0.06, 1.0), -700, 150)
cs = param(cm, "GlowStrength", 1.0, -700, 300)
c1 = expr(cm, unreal.MaterialExpressionMultiply, -450, 0)
mel.connect_material_expressions(card_tex, "RGB", c1, "A")
mel.connect_material_expressions(cc, "", c1, "B")
c2 = expr(cm, unreal.MaterialExpressionMultiply, -300, 100)
mel.connect_material_expressions(c1, "", c2, "A")
mel.connect_material_expressions(cs, "", c2, "B")
mel.connect_material_property(c2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(cm)
unreal.EditorAssetLibrary.save_loaded_asset(cm, only_if_is_dirty=False)

glow_lin = linear(srgb_hex(LAMP_GLOW_COLOUR))
V = unreal.LinearColor
SLOTS = {  # slot: (parent, vectors, scalars), from the GLB's factors and FB's hand-over
    "agent_shell": (lm, {"BaseColor": V(0.8, 0.79, 0.77, 1.0)},
                    {"UseTexture": 1.0, "AOMix": LAMP_AO_MIX, "Roughness": 0.35, "Metallic": 0.0, "Haze": 0.5,
                     "ClearCoatRoughness": 0.08, "GlowStrength": 0.0}),
    # The bowl (FD): its base texture is dark now, and at 0.12 it mirrors the orb as the concept's glossy bowl does.
    "agent_hood_inner": (lm, {"BaseColor": V(0.8, 0.79, 0.77, 1.0), "GlowColor": glow_lin},
                         {"UseTexture": 1.0, "AOMix": LAMP_AO_MIX, "Roughness": 0.12, "Metallic": 0.0, "Haze": 0.3,
                          "ClearCoatRoughness": 0.05, "GlowStrength": LAMP_GLOW, "GlowScale": LAMP_HOOD_SCALE}),
    "agent_joint": (lm, {"BaseColor": V(0.0423, 0.0467, 0.0545, 1.0)},
                    {"UseTexture": 0.0, "Roughness": 0.38, "Metallic": 1.0, "Haze": 0.0, "GlowStrength": 0.0}),
    "agent_glow": (lm, {"BaseColor": V(1.0, 0.694, 0.352, 1.0), "GlowColor": glow_lin},
                   {"UseTexture": 0.0, "Roughness": 0.5, "Metallic": 0.0, "Haze": 0.0, "GlowStrength": LAMP_GLOW,
                    "GlowScale": 1.0}),
    "agent_glow_card": (cm, {"GlowColor": glow_lin}, {"GlowStrength": LAMP_CARD_GLOW}),
}
lamp_mis = {}
for slot, (parent, vectors, scalars) in SLOTS.items():
    mi = instance(LAMP + "/final_working/Materials/MI_" + slot, parent)
    for k, v in vectors.items():
        mel.set_material_instance_vector_parameter_value(mi, k, v)
    for k, v in scalars.items():
        mel.set_material_instance_scalar_parameter_value(mi, k, v)
    unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
    lamp_mis[slot] = mi
slots = []
for sm in lamp_mesh.get_editor_property("static_materials"):
    name = str(sm.get_editor_property("material_slot_name"))
    key = next((s for s in sorted(lamp_mis, key=len, reverse=True) if name == s or name.startswith(s + "_")), None)
    if key:
        sm.set_editor_property("material_interface", lamp_mis[key])
    slots.append(sm)
    result.setdefault("lamp_slots", {})[name] = lamp_mis[key].get_name() if key else None
lamp_mesh.set_editor_property("static_materials", slots)
unreal.EditorAssetLibrary.save_loaded_asset(lamp_mesh, only_if_is_dirty=False)

box = lamp_mesh.get_bounding_box()
result["lamp"] = {
    "mesh": lamp_mesh.get_path_name(), "imported": len(imported), "tris": lamp_mesh.get_num_triangles(0),
    "sections": lamp_mesh.get_num_sections(0), "nanite": lamp_mesh.get_editor_property("nanite_settings").get_editor_property("enabled"),
    "bounds_cm": [round(v, 2) for v in (box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)],
}

# The wall drawings (spark vr-fidelity-40 FB/FC2): three of FB's four Leonardo sheets with no text go into the pinned
# drawings' draw_sheets slot, whose UV thirds are the left frame, the pinned middle sheet and the right frame (FA's
# hand-over). docs/concepts/vr-light-table/lookdev/wall-drawings/draw_sheets_atlas.jpg is made from
# wall-drawings-A (floor plan, turned upright), -B (section and elevation on cream) and -D (site plan, turned upright),
# docs/concepts/vr-light-table/lookdev/log.jsonl lines 80, 83 and 82 (openai/gpt-image-2.5-flare, MEDIUM, seed 61,
# public:false; the account holder's rights). Sheet C (log line 81) is not shipped.
DRAWINGS = os.path.join(REPO, "docs", "concepts", "vr-light-table", "lookdev", "wall-drawings", "draw_sheets_atlas.jpg")
sheets = import_texture(DRAWINGS, "/Game/Bp/Art/StudioPinnedDrawings/Textures", "T_WallDrawings_Atlas", True)
draw_mi = unreal.load_asset("/Game/Bp/Art/StudioPinnedDrawings/final/Materials/draw_sheets")
mel.set_material_instance_texture_parameter_value(draw_mi, "BaseColorTexture", sheets)
unreal.EditorAssetLibrary.save_loaded_asset(draw_mi, only_if_is_dirty=False)
result["drawings"] = mel.get_material_instance_texture_parameter_value(draw_mi, "BaseColorTexture").get_path_name()
