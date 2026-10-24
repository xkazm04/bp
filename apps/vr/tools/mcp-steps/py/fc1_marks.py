# Spark vr-fidelity-40 FC1 content step: what the table's marks need (BpMarks.cpp), through PoFScriptTools.run_python.
# Run outside PIE, after edge_glow.py (it rebuilds M_EdgeGlow, which this step then patches):
#   node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fc1-marks.jsonl
# Replayable: the pin is re-imported with replace_existing and its factors copied again, the collection and the tag
# material are rebuilt in place, and a band from an earlier run (the expressions whose desc is "fc1-scan") is taken off
# before it is patched on again (materials.toolscript.py and edge_glow.py rebuild theirs without it; run this after them).
#
# - survey-pin (ArtSource/survey-pin, its gates pass) into /Game/Bp/Art/SurveyPin, Nanite off. Its body's amber
#   (#FFB547, from its texture) is also its emissive at PIN_GLOW x, so the pins glow above the bloom threshold as the
#   concept's do; the tag keeps its paper.
# - MPC_BpScan, the scan line's parameters ABpTable writes (world space; BpTable.h, the scan line):
#     ScanCentre = the band's centre (xyz), its half width in cm (w)
#     ScanAxis   = the direction it travels (xyz, unit), its strength (w, 0 off)
#     ScanSide   = the direction along it (xyz, unit), its half length in cm (w)
#   band(P) = (core + 0.35 trail) * inside * strength, with d = (P - centre).axis, s = (P - centre).side,
#   core = saturate(1 - |d| / w)^2, trail = saturate(1 + d / 6w) for d < 0 (behind the line), inside = saturate(len - |s|).
# - M_BlueprintPaper: emissive += band * cyan * PAPER_BAND_GLOW. M_EdgeGlow: emissive += band * cyan * EDGE_BAND_GLOW and
#   opacity = max(opacity, band * EDGE_BAND_OPACITY), so the line crosses the glass volumes too.
# - M_PinTag: unlit, translucent, for instanced static meshes: the tag atlas (Texture `Atlas`, ABpTable's canvas render
#   target) at the instance's cell (custom data 0, 1 = the cell's UV offset, 2, 3 = its UV size), emissive rgb * `TagGlow`,
#   opacity a.
import json
import os
import struct

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
ART = os.path.join(REPO, "apps", "vr", "ArtSource")
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()

PIN_DEST = "/Game/Bp/Art/SurveyPin"
PIN_NAME = "SM_SurveyPin"
PIN_GLOW = 4.0
# #FFB547 (ArtSource/survey-pin manifest, pin_body) as linear.
PIN_AMBER = unreal.LinearColor(1.0, 0.4621, 0.0723, 1.0)
MPC = "/Game/Bp/Materials/MPC_BpScan"
PAPER = "/Game/Bp/Materials/M_BlueprintPaper"
EDGE = "/Game/Bp/Materials/M_EdgeGlow"
TAG = "/Game/Bp/Materials/M_PinTag"
# #BFE8FF (sRGB) as linear, the style block's cyan-white; the band is brighter than the ink so it blooms.
CYAN = unreal.LinearColor(0.5209956, 0.8069523, 1.0, 1.0)
PAPER_BAND_GLOW = 6.0
EDGE_BAND_GLOW = 5.0
EDGE_BAND_OPACITY = 0.55
TAG_GLOW = 1.1
MARK = "fc1-scan"
result = {}


def glb_materials(path):
    with open(path, "rb") as f:
        blob = f.read()
    length = struct.unpack_from("<I", blob, 12)[0]
    return json.loads(blob[20:20 + length].decode("utf-8")).get("materials", [])


# ---- 1. the pin -----------------------------------------------------------------------------------------------------
source = os.path.join(ART, "survey-pin", "final.glb")
task = unreal.AssetImportTask()
task.filename = source
task.destination_path = PIN_DEST
task.destination_name = PIN_NAME
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])
mesh = unreal.load_asset(PIN_DEST + "/final/StaticMeshes/" + PIN_NAME)
nanite = mesh.get_editor_property("nanite_settings")
nanite.set_editor_property("enabled", False)
mesh.set_editor_property("nanite_settings", nanite)
eal.save_loaded_asset(mesh, only_if_is_dirty=False)
copied = {}
for m in glb_materials(source):
    mi = unreal.load_asset(PIN_DEST + "/final/Materials/" + m["name"])
    pbr = m.get("pbrMetallicRoughness", {})
    if "baseColorFactor" in pbr:
        c = pbr["baseColorFactor"]
        mel.set_material_instance_vector_parameter_value(mi, "BaseColorFactor", unreal.LinearColor(c[0], c[1], c[2], c[3]))
    for key, gltf in (("MetallicFactor", "metallicFactor"), ("RoughnessFactor", "roughnessFactor")):
        if gltf in pbr:
            mel.set_material_instance_scalar_parameter_value(mi, key, pbr[gltf])
    if m["name"] == "pin_body":
        # The body's amber comes from its texture (no factor in the glTF): the manifest's #FFB547, linear.
        mel.set_material_instance_vector_parameter_value(mi, "EmissiveFactor", PIN_AMBER)
        # M_GLTF multiplies the factor by EmissiveTexture, which is black when the glTF has none.
        mel.set_material_instance_texture_parameter_value(mi, "EmissiveTexture", unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture"))
        mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", PIN_GLOW)
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
    copied[m["name"]] = sorted(pbr.keys())
box = mesh.get_bounding_box()
result["pin"] = {"mesh": mesh.get_path_name(), "tris": mesh.get_num_triangles(0), "sections": mesh.get_num_sections(0),
                 "bounds_cm": [round(v, 2) for v in (box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z)],
                 "materials": copied}

# ---- 2. the collection ----------------------------------------------------------------------------------------------
if eal.does_asset_exist(MPC):
    mpc = unreal.load_asset(MPC)
else:
    mpc = tools.create_asset("MPC_BpScan", "/Game/Bp/Materials", unreal.MaterialParameterCollection,
                             unreal.MaterialParameterCollectionFactoryNew())
vectors = []
for name, value in (("ScanCentre", unreal.LinearColor(0.0, 0.0, 0.0, 1.0)), ("ScanAxis", unreal.LinearColor(1.0, 0.0, 0.0, 0.0)),
                    ("ScanSide", unreal.LinearColor(0.0, 1.0, 0.0, 0.0))):
    p = unreal.CollectionVectorParameter()
    p.set_editor_property("parameter_name", name)
    p.set_editor_property("default_value", value)
    vectors.append(p)
mpc.set_editor_property("vector_parameters", vectors)
eal.save_loaded_asset(mpc, only_if_is_dirty=False)
result["mpc"] = [str(p.get_editor_property("parameter_name")) for p in mpc.get_editor_property("vector_parameters")]


# ---- 3. the band, patched onto the paper and the edge glow -----------------------------------------------------------
def band_nodes(m, x0, y0):
    """The band's expressions in material m; returns the scalar band expression. Every node is marked MARK."""
    made = []

    def add(cls, x, y, **props):
        e = mel.create_material_expression(m, cls, x0 + x, y0 + y)
        for k, v in props.items():
            e.set_editor_property(k, v)
        e.set_editor_property("desc", MARK)
        made.append(e)
        return e

    def wire(a, b, pin, out=""):
        mel.connect_material_expressions(a, out, b, pin)

    def coll(name, y):
        e = add(unreal.MaterialExpressionCollectionParameter, 0, y, collection=mpc, parameter_name=name)
        return e

    def mask(src, r, g, b, a, x, y):
        e = add(unreal.MaterialExpressionComponentMask, x, y, r=r, g=g, b=b, a=a)
        wire(src, e, "")
        return e

    world = add(unreal.MaterialExpressionWorldPosition, 0, -150)
    centre = coll("ScanCentre", 0)
    axis = coll("ScanAxis", 150)
    side = coll("ScanSide", 300)
    c_xyz = mask(centre, True, True, True, False, 200, 0)
    w = mask(centre, False, False, False, True, 200, 60)
    a_xyz = mask(axis, True, True, True, False, 200, 150)
    strength = mask(axis, False, False, False, True, 200, 210)
    s_xyz = mask(side, True, True, True, False, 200, 300)
    half = mask(side, False, False, False, True, 200, 360)
    rel = add(unreal.MaterialExpressionSubtract, 400, -100)
    wire(world, rel, "A")
    wire(c_xyz, rel, "B")
    d = add(unreal.MaterialExpressionDotProduct, 550, 0)
    wire(rel, d, "A")
    wire(a_xyz, d, "B")
    s = add(unreal.MaterialExpressionDotProduct, 550, 250)
    wire(rel, s, "A")
    wire(s_xyz, s, "B")
    # core = saturate(1 - |d| / w)^2
    ad = add(unreal.MaterialExpressionAbs, 700, 0)
    wire(d, ad, "")
    ratio = add(unreal.MaterialExpressionDivide, 850, 0)
    wire(ad, ratio, "A")
    wire(w, ratio, "B")
    inv = add(unreal.MaterialExpressionOneMinus, 1000, 0)
    wire(ratio, inv, "")
    sat = add(unreal.MaterialExpressionSaturate, 1150, 0)
    wire(inv, sat, "")
    core = add(unreal.MaterialExpressionMultiply, 1300, 0)
    wire(sat, core, "A")
    wire(sat, core, "B")
    # trail = saturate(1 + d / 6w) * saturate(-d * 100)
    w6 = add(unreal.MaterialExpressionMultiply, 700, 100, const_b=6.0)
    wire(w, w6, "A")
    dw = add(unreal.MaterialExpressionDivide, 850, 100)
    wire(d, dw, "A")
    wire(w6, dw, "B")
    one_plus = add(unreal.MaterialExpressionAdd, 1000, 100, const_b=1.0)
    wire(dw, one_plus, "A")
    fade = add(unreal.MaterialExpressionSaturate, 1150, 100)
    wire(one_plus, fade, "")
    behind_raw = add(unreal.MaterialExpressionMultiply, 850, 180, const_b=-100.0)
    wire(d, behind_raw, "A")
    behind = add(unreal.MaterialExpressionSaturate, 1000, 180)
    wire(behind_raw, behind, "")
    trail = add(unreal.MaterialExpressionMultiply, 1300, 120)
    wire(fade, trail, "A")
    wire(behind, trail, "B")
    trail_k = add(unreal.MaterialExpressionMultiply, 1450, 120, const_b=0.35)
    wire(trail, trail_k, "A")
    profile = add(unreal.MaterialExpressionAdd, 1600, 50)
    wire(core, profile, "A")
    wire(trail_k, profile, "B")
    # inside = saturate(halflength - |s|)
    abs_s = add(unreal.MaterialExpressionAbs, 700, 250)
    wire(s, abs_s, "")
    room = add(unreal.MaterialExpressionSubtract, 850, 300)
    wire(half, room, "A")
    wire(abs_s, room, "B")
    inside = add(unreal.MaterialExpressionSaturate, 1000, 300)
    wire(room, inside, "")
    gated = add(unreal.MaterialExpressionMultiply, 1750, 100)
    wire(profile, gated, "A")
    wire(inside, gated, "B")
    band = add(unreal.MaterialExpressionMultiply, 1900, 150)
    wire(gated, band, "A")
    wire(strength, band, "B")
    return band, add, wire


def unpatch(m):
    """Takes a band from an earlier run off: its last node's first input goes back to the property, its nodes go."""
    for prop in (unreal.MaterialProperty.MP_EMISSIVE_COLOR, unreal.MaterialProperty.MP_OPACITY):
        node = mel.get_material_property_input_node(m, prop)
        if node is not None and node.get_editor_property("desc") == MARK:
            mel.connect_material_property(mel.get_inputs_for_material_expression(m, node)[0], "", prop)
    gone = 0
    for e in list(mel.get_material_expressions(m)):
        if e.get_editor_property("desc") == MARK:
            mel.delete_material_expression(m, e)
            gone += 1
    return gone


def patch(path, glow, opacity_k):
    m = unreal.load_asset(path)
    removed = unpatch(m)
    emissive = mel.get_material_property_input_node(m, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    emissive_out = mel.get_material_property_input_node_output_name(m, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    band, add, wire = band_nodes(m, -2600, 1200)
    tint = add(unreal.MaterialExpressionConstant3Vector, 2000, 0, constant=CYAN)
    lit = add(unreal.MaterialExpressionMultiply, 2150, 50)
    wire(tint, lit, "A")
    wire(band, lit, "B")
    k = add(unreal.MaterialExpressionMultiply, 2300, 50, const_b=glow)
    wire(lit, k, "A")
    total = add(unreal.MaterialExpressionAdd, 2450, 0)
    mel.connect_material_expressions(emissive, emissive_out, total, "A")
    wire(k, total, "B")
    mel.connect_material_property(total, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    out = {"patched": True, "removed_first": removed, "emissive_was": emissive.get_name()}
    if opacity_k:
        opacity = mel.get_material_property_input_node(m, unreal.MaterialProperty.MP_OPACITY)
        opacity_out = mel.get_material_property_input_node_output_name(m, unreal.MaterialProperty.MP_OPACITY)
        bk = add(unreal.MaterialExpressionMultiply, 2150, 250, const_b=opacity_k)
        wire(band, bk, "A")
        mx = add(unreal.MaterialExpressionMax, 2450, 250)
        mel.connect_material_expressions(opacity, opacity_out, mx, "A")
        wire(bk, mx, "B")
        mel.connect_material_property(mx, "", unreal.MaterialProperty.MP_OPACITY)
        out["opacity_was"] = opacity.get_name()
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return out


result["paper"] = patch(PAPER, PAPER_BAND_GLOW, 0.0)
result["edge"] = patch(EDGE, EDGE_BAND_GLOW, EDGE_BAND_OPACITY)

# ---- 4. the tag material ----------------------------------------------------------------------------------------------
if eal.does_asset_exist(TAG):
    tag = unreal.load_asset(TAG)
    for old in list(mel.get_material_expressions(tag)):
        mel.delete_material_expression(tag, old)
else:
    tag = tools.create_asset("M_PinTag", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
tag.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
tag.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
tag.set_editor_property("two_sided", False)
tag.set_editor_property("used_with_instanced_static_meshes", True)


def tadd(cls, x, y, **props):
    e = mel.create_material_expression(tag, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def twire(a, b, pin, out=""):
    mel.connect_material_expressions(a, out, b, pin)


cells = []
for i in range(4):
    cells.append(tadd(unreal.MaterialExpressionPerInstanceCustomData, -1400, -200 + 120 * i, data_index=i,
                      const_default_value=(0.0 if i < 2 else 1.0)))
offset = tadd(unreal.MaterialExpressionAppendVector, -1200, -150)
twire(cells[0], offset, "A")
twire(cells[1], offset, "B")
size = tadd(unreal.MaterialExpressionAppendVector, -1200, 50)
twire(cells[2], size, "A")
twire(cells[3], size, "B")
both = tadd(unreal.MaterialExpressionAppendVector, -1050, -50)
twire(offset, both, "A")
twire(size, both, "B")
both_vi = tadd(unreal.MaterialExpressionVertexInterpolator, -900, -50)
twire(both, both_vi, "VS")
off_vi = tadd(unreal.MaterialExpressionComponentMask, -750, -150, r=True, g=True, b=False, a=False)
twire(both_vi, off_vi, "")
size_vi = tadd(unreal.MaterialExpressionComponentMask, -750, 50, r=False, g=False, b=True, a=True)
twire(both_vi, size_vi, "")
uv = tadd(unreal.MaterialExpressionTextureCoordinate, -750, -300)
scaled = tadd(unreal.MaterialExpressionMultiply, -550, -200)
twire(uv, scaled, "A")
twire(size_vi, scaled, "B")
cell_uv = tadd(unreal.MaterialExpressionAdd, -400, -150)
twire(scaled, cell_uv, "A")
twire(off_vi, cell_uv, "B")
atlas = tadd(unreal.MaterialExpressionTextureSampleParameter2D, -200, -150, parameter_name="Atlas",
             texture=unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture"))
twire(cell_uv, atlas, "UVs")
glow = tadd(unreal.MaterialExpressionScalarParameter, -200, 150, parameter_name="TagGlow", default_value=TAG_GLOW)
lit = tadd(unreal.MaterialExpressionMultiply, 100, -150)
twire(atlas, lit, "A", "RGB")
twire(glow, lit, "B")
mel.connect_material_property(lit, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.connect_material_property(atlas, "A", unreal.MaterialProperty.MP_OPACITY)
mel.recompile_material(tag)
eal.save_asset(TAG, only_if_is_dirty=False)
result["tag"] = {"material": TAG, "expressions": mel.get_num_material_expressions(tag)}

# ---- 5. the pin's own materials for instancing -------------------------------------------------------------------------
# The glTF instances' parent (/InterchangeAssets M_GLTF) is not flagged for instanced static meshes, so on the Pins batch
# they fall back to the default material (white pins, Lynx 2026-10-24). M_PinBody stands in on the body: unlit, the
# manifest's amber at PIN_GLOW x, so the pin reads as the concept's glowing amber head and stem. M_Hidden (the frame's
# glass placeholder, ABpTable puts it on the pin's own blank tag) gets the instancing flag.
BODY = "/Game/Bp/Materials/M_PinBody"
if eal.does_asset_exist(BODY):
    body = unreal.load_asset(BODY)
    for old in list(mel.get_material_expressions(body)):
        mel.delete_material_expression(body, old)
else:
    body = tools.create_asset("M_PinBody", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
body.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
body.set_editor_property("used_with_instanced_static_meshes", True)
amber = mel.create_material_expression(body, unreal.MaterialExpressionVectorParameter, -500, 0)
amber.set_editor_property("parameter_name", "PinColor")
amber.set_editor_property("default_value", PIN_AMBER)
glow = mel.create_material_expression(body, unreal.MaterialExpressionScalarParameter, -500, 200)
glow.set_editor_property("parameter_name", "PinGlow")
glow.set_editor_property("default_value", PIN_GLOW)
lit = mel.create_material_expression(body, unreal.MaterialExpressionMultiply, -250, 50)
mel.connect_material_expressions(amber, "", lit, "A")
mel.connect_material_expressions(glow, "", lit, "B")
mel.connect_material_property(lit, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(body)
eal.save_asset(BODY, only_if_is_dirty=False)
hidden = unreal.load_asset("/Game/Bp/Materials/M_Hidden")
hidden.set_editor_property("used_with_instanced_static_meshes", True)
mel.recompile_material(hidden)
eal.save_asset("/Game/Bp/Materials/M_Hidden", only_if_is_dirty=False)
result["pin_materials"] = {"body": BODY, "hidden_ism": hidden.get_editor_property("used_with_instanced_static_meshes")}
