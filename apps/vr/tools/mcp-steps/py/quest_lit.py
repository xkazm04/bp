# The Quest tier's cheap lit material (night-two W0; BpTier.cpp, bp.QuestTier.CheapLit). Idempotent: run it again after
# re-importing studio art, and every instance is rebuilt from the imported material it stands in for.
#
#   M_QuestLit:   lit, opaque, one-sided, fully rough, no lightmap directionality, no normal map. Base colour is
#                 BaseColorTexture x BaseColorFactor x vertex colour (glTF's COLOR_0, as M_GLTF), metallic a constant
#                 (MetallicFactor), specular SpecularFactor x 0.5,
#                 emissive EmissiveFactor x EmissiveStrength (x EmissiveTexture behind the static switch
#                 bHasEmissiveTexture, off by default, so the default permutation samples one texture). The parameter
#                 names are M_GLTF's, so code that sets BaseColorFactor or EmissiveStrength on a slot reaches either.
#   M_QuestUnlit: unlit, emissive only (EmissiveFactor x EmissiveStrength), for slots that only glow.
#   QuestLit/MI_QL_<name>: one instance per imported M_GLTF instance the studio or the frame draws, carrying that
#                 material's base colour texture and factor, emissive factor and strength, specular, and its metallic:
#                 MetallicFactor x the mean of its metallic-roughness texture's blue channel (glTF: B is metallic), read
#                 from the texture's source pixels here, once. TWO_SIDED and UNLIT below choose the parent.
#
# BpTier.cpp finds MI_QL_<name> by the slot's material name (a dynamic instance's parent), so a slot needs no table in code.
#
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/quest_lit.py
import json
import os
import struct
import tempfile

import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
DIR = "/Game/Bp/Materials"
QL = DIR + "/QuestLit"
WHITE = "/Engine/EngineResources/WhiteSquareTexture"
GLTF = "M_GLTF"

# The imported materials the tier swaps: every M_GLTF instance on the studio's meshes and the light table's frame. The
# city backdrop has its own unlit swap (bp.QuestTier.UnlitBackdrop) and the frame's glass placeholder is never drawn.
MESHES = [
    "/Game/Bp/Art/LightTableFrame/SM_LightTableFrame",
    "/Game/Bp/Art/StudioArchitecture/final/StaticMeshes/pendant_lamp",
    "/Game/Bp/Art/StudioArchitecture/final/StaticMeshes/window_frame",
    "/Game/Bp/Art/StudioDeskClutter/final/StaticMeshes/SM_StudioDeskClutter",
    "/Game/Bp/Art/StudioDeskLamp/final/StaticMeshes/SM_StudioDeskLamp",
    "/Game/Bp/Art/StudioDrawingTubes/final/StaticMeshes/SM_StudioDrawingTubes",
    "/Game/Bp/Art/StudioMug/final/StaticMeshes/SM_StudioMug",
    "/Game/Bp/Art/StudioPinnedDrawings/final/StaticMeshes/SM_StudioPinnedDrawings",
    "/Game/Bp/Art/StudioShelves/final/StaticMeshes/SM_StudioShelves",
    "/Game/Bp/Art/StudioWallKit/final/StaticMeshes/SM_StudioWallKit",
]
SKIP = {"city_backdrop_emissive", "frame_glass_placeholder_REPLACE_IN_UE"}
# Slots that only glow: their lit base colour is under the glow, so they draw unlit.
UNLIT = {"bulb_glow", "lamp_shade_glow", "frame_edge_glow"}
# Slots whose mesh shows back faces (open shells seen from both sides), found by the CheapLit 0/1 captures: the desk
# lamp's shade glows on its inside, which is the shell's back face.
TWO_SIDED = {"lamp_shade_glow"}
# Slots whose fully rough stand-in reads lighter than the original in the CheapLit 0/1 captures, and the base colour
# scale that brings their luma back (w0 captures, target pose: the frame's near face and far rim).
TONE = {"frame_atlas": 0.4, "frame_aluminium": 0.3}


def fresh_material(name):
    path = DIR + "/" + name
    if eal.does_asset_exist(path):
        m = eal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    return tools.create_asset(name, DIR, unreal.Material, unreal.MaterialFactoryNew())


def scalar(m, name, value, x, y):
    e = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, x, y)
    e.set_editor_property("parameter_name", name)
    e.set_editor_property("default_value", value)
    return e


def vector(m, name, rgba, x, y):
    e = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, x, y)
    e.set_editor_property("parameter_name", name)
    e.set_editor_property("default_value", unreal.LinearColor(*rgba))
    return e


def multiply(m, a, a_out, b, b_out, x, y):
    e = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, x, y)
    mel.connect_material_expressions(a, a_out, e, "A")
    mel.connect_material_expressions(b, b_out, e, "B")
    return e


def emissive(m, with_texture_switch):
    factor = vector(m, "EmissiveFactor", (0.0, 0.0, 0.0, 1.0), -900, 500)
    strength = scalar(m, "EmissiveStrength", 1.0, -900, 700)
    glow = multiply(m, factor, "", strength, "", -600, 550)
    if not with_texture_switch:
        return glow
    tex = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -900, 850)
    tex.set_editor_property("parameter_name", "EmissiveTexture")
    tex.set_editor_property("texture", eal.load_asset(WHITE))
    textured = multiply(m, glow, "", tex, "RGB", -400, 750)
    switch = mel.create_material_expression(m, unreal.MaterialExpressionStaticSwitchParameter, -200, 600)
    switch.set_editor_property("parameter_name", "bHasEmissiveTexture")
    switch.set_editor_property("default_value", False)
    mel.connect_material_expressions(textured, "", switch, "True")
    mel.connect_material_expressions(glow, "", switch, "False")
    return switch


# ---- the lit master
lit = fresh_material("M_QuestLit")
lit.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
lit.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
lit.set_editor_property("two_sided", False)
lit.set_editor_property("fully_rough", True)
lit.set_editor_property("use_lightmap_directionality", False)
# The studio's meshes carry built lightmaps: without this usage flag a cooked build draws the default material on them
# (the editor logged "missing usage flag StaticLighting" and drew the world grid).
lit.set_editor_property("used_with_static_lighting", True)
base_tex = mel.create_material_expression(lit, unreal.MaterialExpressionTextureSampleParameter2D, -900, 0)
base_tex.set_editor_property("parameter_name", "BaseColorTexture")
base_tex.set_editor_property("texture", eal.load_asset(WHITE))
base_factor = vector(lit, "BaseColorFactor", (1.0, 1.0, 1.0, 1.0), -900, 250)
# glTF multiplies the base colour by the mesh's COLOR_0 (M_GLTF's VertexColor): the studio's props are coloured by it.
vertex = mel.create_material_expression(lit, unreal.MaterialExpressionVertexColor, -900, -200)
tinted = multiply(lit, base_factor, "", vertex, "RGB", -700, 150)
# QuestBaseScale (instance-only, default 1): a per-slot tone where fully rough shading reads lighter than the original
# (a smooth metal that mirrored the dark room now spreads the room's light); a dynamic instance copies only the glTF
# names, so the scale stays with the slot.
tone = scalar(lit, "QuestBaseScale", 1.0, -700, 300)
toned = multiply(lit, tinted, "", tone, "", -600, 200)
base = multiply(lit, base_tex, "RGB", toned, "", -500, 100)
mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
metallic = scalar(lit, "MetallicFactor", 0.0, -500, 300)
mel.connect_material_property(metallic, "", unreal.MaterialProperty.MP_METALLIC)
spec = scalar(lit, "SpecularFactor", 1.0, -900, 380)
half = mel.create_material_expression(lit, unreal.MaterialExpressionConstant, -900, 450)
half.set_editor_property("r", 0.5)
mel.connect_material_property(multiply(lit, spec, "", half, "", -500, 400), "", unreal.MaterialProperty.MP_SPECULAR)
mel.connect_material_property(emissive(lit, True), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(lit)

# ---- the unlit master
unlit = fresh_material("M_QuestUnlit")
unlit.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
unlit.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
unlit.set_editor_property("two_sided", False)
unlit.set_editor_property("used_with_static_lighting", True)
mel.connect_material_property(emissive(unlit, False), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(unlit)


# ---- the metallic constant: the mean blue of a texture's source, exported once to an uncompressed TGA
def mean_blue(tex):
    out = os.path.join(tempfile.gettempdir(), "bp_quest_lit_" + tex.get_name() + ".tga")
    task = unreal.AssetExportTask()
    task.set_editor_property("object", tex)
    task.set_editor_property("filename", out)
    task.set_editor_property("automated", True)
    task.set_editor_property("prompt", False)
    task.set_editor_property("replace_identical", True)
    if not unreal.Exporter.run_asset_export_task(task) or not os.path.exists(out):
        return None
    data = open(out, "rb").read()
    os.remove(out)
    id_len, _, kind = data[0], data[1], data[2]
    w, h = struct.unpack_from("<HH", data, 12)
    bpp = data[16] // 8
    if kind != 2 or bpp not in (3, 4):
        return None
    px = data[18 + id_len:]
    step = max(1, (w * h) // 65536)
    total, n = 0, 0
    for i in range(0, w * h, step):
        total += px[i * bpp]  # TGA stores BGR(A): byte 0 is blue
        n += 1
    return total / (255.0 * n) if n else None


def vec(c):
    return [round(c.r, 4), round(c.g, 4), round(c.b, 4), round(c.a, 4)]


def is_default(tex):
    return tex is None or "/InterchangeAssets/" in tex.get_path_name() or tex.get_path_name().startswith("/Engine/")


made, notes = {}, []
seen = set()
for mesh_path in MESHES:
    mesh = eal.load_asset(mesh_path)
    if not mesh:
        notes.append("missing mesh " + mesh_path)
        continue
    for sm in mesh.get_editor_property("static_materials"):
        mat = sm.get_editor_property("material_interface")
        if mat:
            seen.add(mat.get_path_name())
# The level's slot overrides (the wall kit's dark instances) are in the world, not on the meshes.
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
    comp = actor.static_mesh_component
    for i in range(comp.get_num_materials()):
        mat = comp.get_material(i)
        if mat:
            seen.add(mat.get_path_name())

for path in sorted(seen):
    mat = unreal.load_asset(path)
    if not isinstance(mat, unreal.MaterialInstance):
        continue
    if mat.get_base_material().get_name() != GLTF or mat.get_name() in SKIP:
        continue
    name = mat.get_name()
    unlit_slot = name in UNLIT
    mi_name = "MI_QL_" + name
    mi_path = QL + "/" + mi_name
    mi = eal.load_asset(mi_path) if eal.does_asset_exist(mi_path) else tools.create_asset(mi_name, QL, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.clear_all_material_instance_parameters(mi)
    mel.set_material_instance_parent(mi, unlit if unlit_slot else lit)
    row = {"parent": "M_QuestUnlit" if unlit_slot else "M_QuestLit"}
    emissive_factor = mel.get_material_instance_vector_parameter_value(mat, "EmissiveFactor")
    strength = mel.get_material_instance_scalar_parameter_value(mat, "EmissiveStrength")
    mel.set_material_instance_vector_parameter_value(mi, "EmissiveFactor", emissive_factor)
    mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", strength)
    row["emissive"] = vec(emissive_factor) + [strength]
    if not is_default(mel.get_material_instance_texture_parameter_value(mat, "EmissiveTexture")):
        notes.append(name + ": has an emissive texture the instance does not carry (no lit slot needed one when written)")
    if not unlit_slot:
        # M_GLTF samples a texture only where its static switch is on (the frame's atlas has a texture set and its
        # switch off: it draws its factor alone), so the stand-in carries a texture only where the original draws it.
        has_base = mel.get_material_instance_static_switch_parameter_value(mat, "bHasBaseColorTexture")
        has_orm = mel.get_material_instance_static_switch_parameter_value(mat, "bHasMetallicRoughnessTexture")
        tex = mel.get_material_instance_texture_parameter_value(mat, "BaseColorTexture") if has_base else None
        if not is_default(tex):
            mel.set_material_instance_texture_parameter_value(mi, "BaseColorTexture", tex)
            row["base_tex"] = tex.get_name()
        factor = mel.get_material_instance_vector_parameter_value(mat, "BaseColorFactor")
        mel.set_material_instance_vector_parameter_value(mi, "BaseColorFactor", factor)
        row["base"] = vec(factor)
        mfac = mel.get_material_instance_scalar_parameter_value(mat, "MetallicFactor")
        orm = mel.get_material_instance_texture_parameter_value(mat, "MetallicRoughnessTexture") if has_orm else None
        blue = None if is_default(orm) else mean_blue(orm)
        if orm is not None and not is_default(orm) and blue is None:
            notes.append(name + ": could not read " + orm.get_name() + "; metallic from the factor alone")
        metal = mfac * (blue if blue is not None else 1.0)
        mel.set_material_instance_scalar_parameter_value(mi, "MetallicFactor", metal)
        row["metallic"] = round(metal, 3)
        if name in TONE:
            mel.set_material_instance_scalar_parameter_value(mi, "QuestBaseScale", TONE[name])
            row["tone"] = TONE[name]
        mel.set_material_instance_scalar_parameter_value(mi, "SpecularFactor", mel.get_material_instance_scalar_parameter_value(mat, "SpecularFactor"))
        uv = mel.get_material_instance_vector_parameter_value(mat, "BaseColorTexture_OffsetScale")
        if vec(uv) != [0.0, 0.0, 1.0, 1.0] or mel.get_material_instance_scalar_parameter_value(mat, "BaseColorTexture_TexCoord") != 0.0:
            notes.append(name + ": base colour UV transform " + str(vec(uv)) + " is not carried")
    two = name in TWO_SIDED
    overrides = mi.get_editor_property("base_property_overrides")
    overrides.set_editor_property("override_two_sided", two)
    overrides.set_editor_property("two_sided", two)
    mi.set_editor_property("base_property_overrides", overrides)
    row["two_sided"] = two
    mel.update_material_instance(mi)
    eal.save_asset(mi_path, only_if_is_dirty=False)
    made[name] = row


def stats(m):
    s = mel.get_statistics(m)
    return {k: getattr(s, k) for k in ("num_pixel_shader_instructions", "num_vertex_shader_instructions", "num_samplers", "num_pixel_texture_samples")}


saved = [eal.save_asset(DIR + "/M_QuestLit", only_if_is_dirty=False), eal.save_asset(DIR + "/M_QuestUnlit", only_if_is_dirty=False)]
result = json.dumps({
    "saved": saved,
    "exprs": {"M_QuestLit": mel.get_num_material_expressions(lit), "M_QuestUnlit": mel.get_num_material_expressions(unlit)},
    "stats": {"M_GLTF": stats(unreal.load_asset("/InterchangeAssets/gltf/Substrate/M_GLTF")), "M_QuestLit": stats(lit), "M_QuestUnlit": stats(unlit)},
    "instances": made,
    "notes": notes,
})
print(result)
