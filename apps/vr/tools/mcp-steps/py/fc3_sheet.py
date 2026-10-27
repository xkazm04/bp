# Spark vr-fidelity-40 FC3 content step: what the sheet's typography and floor plan need (BpTable.cpp, BpType.h), through
# PoFScriptTools.run_python. Run outside PIE, then fc1_marks.py (its band profile is FC3's too):
#   node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fc3-sheet.jsonl
# Replayable: the faces and the kit are re-imported with replace_existing, M_Glyph is rebuilt in place.
#
# - The type faces (apps/vr/Fonts/BarlowSemiCondensed, SIL OFL 1.1, OFL.txt beside them) as UFontFace assets in
#   /Game/Bp/Fonts, loaded inline (so a cooked build carries them in the asset). ABpTable builds its runtime font of them.
# - The fixture kit (ArtSource/fixture-kit, its gates pass) into /Game/Bp/Art/FixtureKit, Nanite off: one static mesh
#   per kind, its two slots (fixture_body, mark) both given M_Glyph by ABpTable.
# - M_Glyph: unlit, additive, used with instanced static meshes. Additive (standalone-headset-frame-budgets: no ordering,
#   one draw per section, nothing read back) because the glyphs stand inside the translucent rest extrusions, where a
#   blended material would sort per batch, not per glyph. Its colour is the style block's cyan-white, brighter at grazing
#   angles so a glyph reads by its silhouette (fixture-kit's hand-over: "render as cyan-white linework glass"):
#     emissive = #BFE8FF * GlyphGlow * (GlyphBase + fresnel^2) * Show,  Show = per-instance custom data 0 (ABpTable's
#     levels: 0 gone, LevelDim dimmed, 1 lit)
import os

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
FONTS = os.path.join(REPO, "apps", "vr", "Fonts", "BarlowSemiCondensed")
KIT = os.path.join(REPO, "apps", "vr", "ArtSource", "fixture-kit", "final.glb")
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()

FONT_DEST = "/Game/Bp/Fonts"
KIT_DEST = "/Game/Bp/Art/FixtureKit"
GLYPH = "/Game/Bp/Materials/M_Glyph"
# #BFE8FF (sRGB) as linear.
CYAN = unreal.LinearColor(0.5209956, 0.8069523, 1.0, 1.0)
GLYPH_GLOW = 0.45
GLYPH_BASE = 0.1
result = {}

# ---- 1. the type faces ----------------------------------------------------------------------------------------------
faces = {}
for name in ("BarlowSemiCondensed-Medium", "BarlowSemiCondensed-SemiBold"):
    task = unreal.AssetImportTask()
    task.filename = os.path.join(FONTS, name + ".ttf")
    task.destination_path = FONT_DEST
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    face = unreal.load_asset(FONT_DEST + "/" + name)
    if face is None:
        raise RuntimeError("import made no asset for " + name + ": " + str(list(task.get_editor_property("imported_object_paths"))))
    face.set_editor_property("loading_policy", unreal.FontLoadingPolicy.INLINE)
    eal.save_loaded_asset(face, only_if_is_dirty=False)
    faces[name] = {"class": face.get_class().get_name(), "imported": [str(p) for p in task.get_editor_property("imported_object_paths")],
                   "policy": str(face.get_editor_property("loading_policy"))}
result["faces"] = faces

# ---- 2. the fixture kit ---------------------------------------------------------------------------------------------
task = unreal.AssetImportTask()
task.filename = KIT
task.destination_path = KIT_DEST
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])
meshes = {}
for path in task.get_editor_property("imported_object_paths"):
    asset = unreal.load_asset(str(path))
    if not isinstance(asset, unreal.StaticMesh):
        continue
    nanite = asset.get_editor_property("nanite_settings")
    nanite.set_editor_property("enabled", False)
    asset.set_editor_property("nanite_settings", nanite)
    eal.save_loaded_asset(asset, only_if_is_dirty=False)
    box = asset.get_bounding_box()
    meshes[asset.get_path_name()] = {"tris": asset.get_num_triangles(0), "sections": asset.get_num_sections(0),
                                     "bounds_cm": [round(v, 2) for v in (box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)],
                                     "slots": [str(m.get_editor_property("material_slot_name")) for m in asset.get_editor_property("static_materials")]}
result["kit"] = meshes

# ---- 3. M_Glyph -------------------------------------------------------------------------------------------------------
if eal.does_asset_exist(GLYPH):
    m = unreal.load_asset(GLYPH)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = tools.create_asset("M_Glyph", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)
m.set_editor_property("used_with_instanced_static_meshes", True)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def wire(a, b, pin, out=""):
    mel.connect_material_expressions(a, out, b, pin)


colour = add(unreal.MaterialExpressionVectorParameter, -900, -200, parameter_name="GlyphColor", default_value=CYAN)
glow = add(unreal.MaterialExpressionScalarParameter, -900, 0, parameter_name="GlyphGlow", default_value=GLYPH_GLOW)
base = add(unreal.MaterialExpressionScalarParameter, -900, 150, parameter_name="GlyphBase", default_value=GLYPH_BASE)
fresnel = add(unreal.MaterialExpressionFresnel, -900, 300, exponent=2.0, base_reflect_fraction=0.0)
show = add(unreal.MaterialExpressionPerInstanceCustomData, -900, 450, data_index=0, const_default_value=1.0)
rim = add(unreal.MaterialExpressionAdd, -650, 200)
wire(base, rim, "A")
wire(fresnel, rim, "B")
tint = add(unreal.MaterialExpressionMultiply, -450, -100)
wire(colour, tint, "A")
wire(glow, tint, "B")
lit = add(unreal.MaterialExpressionMultiply, -300, 50)
wire(tint, lit, "A")
wire(rim, lit, "B")
shown = add(unreal.MaterialExpressionMultiply, -150, 150)
wire(lit, shown, "A")
wire(show, shown, "B")
mel.connect_material_property(shown, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
eal.save_asset(GLYPH, only_if_is_dirty=False)
result["glyph"] = {"material": GLYPH, "expressions": mel.get_num_material_expressions(m), "blend": str(m.get_editor_property("blend_mode"))}
