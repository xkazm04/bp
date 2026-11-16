# Night two V5 (the scene, third round): the frame's self-lit Quest material and the table's contact shadow in your room.
# Idempotent: every asset is found by name and rebuilt in place. Run with the editor up (no PIE needed):
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/v5_scene.py
#
#   M_QuestFrame:    the light table's frame and legs (SM_LightTableFrame's frame_atlas and frame_aluminium slots) on the
#                    Quest tier (BpLampLook.cpp swaps them, bp.Frame.SelfLit). UNLIT, legacy material inputs, opaque, as
#                    M_QuestLamp (v1_scene.py): on the mobile base pass a legacy-converted opaque material writes scene alpha 0,
#                    so over the passthrough underlay it stays solid. Being unlit it needs no studio light, so it looks the
#                    same in the studio and in your room (bp.Room 1 switches the studio's lights off). Its form is shaded in:
#                      base   = BaseColorTexture x BaseColorFactor x QuestBaseScale x Light (M_QuestLit's own inputs, so the
#                               slot's values copy across and bp.Frame.Tone keeps working);
#                      shade  = Ambient + Key x wrap(N.L)^2, a fixed key from above the seat (KeyDir, world);
#                      under  = a face turned down darkens toward Under (the rail's underside, the legs' feet);
#                      bevel  = a highlight along the top front edge: within BevelCm of the edge line (EdgeY, EdgeZ in the
#                               mesh's own space; the near edge is +Y there, the frame stands yaw 90 in the table), falling off
#                               as (1 - d / BevelCm)^2, x BevelGain x BevelColor, added.
#                    No light is added to the level and no texture is sampled beyond the slot's own.
#   M_ContactShadow: your room's contact shadow under the table (BpLampLook.cpp, bp.Room.Shadow). UNLIT, TRANSLUCENT, emissive
#                    black, opacity Strength x mask: the mask is 1 inside the legs' footprint less Inner, falling smoothly to
#                    0 at Feather beyond it (a rounded-box distance, no texture). Black at opacity a writes colour x (1 - a)
#                    and scene alpha x (1 - a): over passthrough the projection layer then covers the real floor by a with
#                    black, which is a darkening of the room by a (never a hole: it never raises alpha; never an opaque sheet:
#                    a stays at Strength at most). Over the dark fallback room it darkens an already dark floor by a and is
#                    barely seen.
import json

import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
DIR = "/Game/Bp/Materials"


def fresh_material(name):
    path = DIR + "/" + name
    if eal.does_asset_exist(path):
        m = eal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    return tools.create_asset(name, DIR, unreal.Material, unreal.MaterialFactoryNew())


def expr(m, cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def scalar(m, name, value, x, y):
    return expr(m, unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


def vector(m, name, rgba, x, y):
    return expr(m, unreal.MaterialExpressionVectorParameter, x, y, parameter_name=name, default_value=unreal.LinearColor(*rgba))


def op(m, cls, a, b, x, y, a_out="", b_out=""):
    e = mel.create_material_expression(m, cls, x, y)
    mel.connect_material_expressions(a, a_out, e, "A")
    mel.connect_material_expressions(b, b_out, e, "B")
    return e


def mul(m, a, b, x, y, a_out="", b_out=""):
    return op(m, unreal.MaterialExpressionMultiply, a, b, x, y, a_out, b_out)


def add(m, a, b, x, y, a_out="", b_out=""):
    return op(m, unreal.MaterialExpressionAdd, a, b, x, y, a_out, b_out)


def sub(m, a, b, x, y, a_out="", b_out=""):
    return op(m, unreal.MaterialExpressionSubtract, a, b, x, y, a_out, b_out)


def one_in(m, cls, a, x, y, a_out="", **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    mel.connect_material_expressions(a, a_out, e, "")
    return e


def mask(m, a, x, y, **channels):
    e = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, x, y)
    for k in ("r", "g", "b", "a"):
        e.set_editor_property(k, channels.get(k, False))
    mel.connect_material_expressions(a, "", e, "")
    return e


def append(m, a, b, x, y):
    e = mel.create_material_expression(m, unreal.MaterialExpressionAppendVector, x, y)
    mel.connect_material_expressions(a, "", e, "A")
    mel.connect_material_expressions(b, "", e, "B")
    return e


# ---- M_QuestFrame -----------------------------------------------------------------------------------------------------
fm = fresh_material("M_QuestFrame")
fm.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
fm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
fm.set_editor_property("two_sided", False)
tex = expr(fm, unreal.MaterialExpressionTextureSampleParameter2D, -1800, -400, parameter_name="BaseColorTexture",
           texture=unreal.load_asset("/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture"))
base = mul(fm, tex, vector(fm, "BaseColorFactor", (0.35, 0.35, 0.35, 1.0), -1800, -150), -1550, -350, "RGB")
base = mul(fm, base, scalar(fm, "QuestBaseScale", 0.4, -1550, -200), -1400, -300)
base = mul(fm, base, scalar(fm, "Light", 0.6, -1400, -180), -1250, -280)
# shade = Ambient + Key x (N.L x 0.5 + 0.5)^2
normal = expr(fm, unreal.MaterialExpressionVertexNormalWS, -1800, 150)
ndl = expr(fm, unreal.MaterialExpressionDotProduct, -1600, 200)
mel.connect_material_expressions(normal, "", ndl, "A")
mel.connect_material_expressions(vector(fm, "KeyDir", (-0.42, -0.22, 0.88, 0.0), -1800, 260), "", ndl, "B")
w1 = expr(fm, unreal.MaterialExpressionMultiply, -1450, 200, const_b=0.5)
mel.connect_material_expressions(ndl, "", w1, "A")
w2 = expr(fm, unreal.MaterialExpressionAdd, -1350, 200, const_b=0.5)
mel.connect_material_expressions(w1, "", w2, "A")
w3 = mul(fm, w2, w2, -1250, 200)
keyed = mul(fm, w3, scalar(fm, "Key", 1.3, -1250, 320), -1100, 230)
shade = add(fm, keyed, scalar(fm, "Ambient", 0.15, -1100, 350), -950, 260)
# under: lerp(1, Under, saturate(-N.z))
nz = mask(fm, normal, -1600, 450, b=True)
down = one_in(fm, unreal.MaterialExpressionSaturate, one_in(fm, unreal.MaterialExpressionOneMinus, one_in(fm, unreal.MaterialExpressionAdd, nz, -1450, 450, const_b=1.0), -1350, 450), -1250, 450)
under = expr(fm, unreal.MaterialExpressionLinearInterpolate, -1100, 450, const_a=1.0)
mel.connect_material_expressions(scalar(fm, "Under", 0.4, -1250, 540), "", under, "B")
mel.connect_material_expressions(down, "", under, "Alpha")
lit = mul(fm, mul(fm, base, shade, -800, -150), under, -650, -50)
# bevel: the distance in the mesh's YZ plane to the top front edge line (EdgeY, EdgeZ)
local = expr(fm, unreal.MaterialExpressionLocalPosition, -1800, 700)
yz = mask(fm, local, -1650, 700, g=True, b=True)
edge = append(fm, scalar(fm, "EdgeY", 45.4, -1650, 800), scalar(fm, "EdgeZ", 95.0, -1650, 880), -1500, 820)
dist = op(fm, unreal.MaterialExpressionDistance, yz, edge, -1350, 750)
rel = op(fm, unreal.MaterialExpressionDivide, dist, scalar(fm, "BevelCm", 0.9, -1350, 860), -1200, 780)
near = one_in(fm, unreal.MaterialExpressionSaturate, one_in(fm, unreal.MaterialExpressionOneMinus, rel, -1100, 780), -1000, 780)
near2 = mul(fm, near, near, -900, 780)
bevel = mul(fm, mul(fm, near2, scalar(fm, "BevelGain", 0.5, -900, 900), -780, 820), vector(fm, "BevelColor", (1.0, 0.93, 0.84, 1.0), -780, 950), -650, 860)
mel.connect_material_property(add(fm, lit, bevel, -450, 200), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(fm)
eal.save_asset(DIR + "/M_QuestFrame", only_if_is_dirty=False)

# ---- M_ContactShadow --------------------------------------------------------------------------------------------------
sm = fresh_material("M_ContactShadow")
sm.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
sm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
sm.set_editor_property("two_sided", False)
for prop, value in (("use_translucency_vertex_fog", False), ("translucency_pass", unreal.MaterialTranslucencyPass.MTP_BEFORE_DOF)):
    try:
        sm.set_editor_property(prop, value)
    except Exception:
        pass
uv = expr(sm, unreal.MaterialExpressionTextureCoordinate, -1800, 0)
centred = expr(sm, unreal.MaterialExpressionSubtract, -1650, 0, const_b=0.5)
mel.connect_material_expressions(uv, "", centred, "A")
quad = mask(sm, vector(sm, "QuadCm", (172.0, 250.0, 0.0, 0.0), -1800, 150), -1650, 150, r=True, g=True)
p = mul(sm, centred, quad, -1500, 50)
q = sub(sm, one_in(sm, unreal.MaterialExpressionAbs, p, -1350, 50), mask(sm, vector(sm, "FootHalfCm", (39.0, 77.5, 0.0, 0.0), -1500, 200), -1350, 200, r=True, g=True), -1200, 80)
# The rounded box's distance: length(max(q, 0)) + min(max(q.x, q.y), 0); negative inside the footprint.
maxq = expr(sm, unreal.MaterialExpressionMax, -1050, 40, const_b=0.0)
mel.connect_material_expressions(q, "", maxq, "A")
length = one_in(sm, unreal.MaterialExpressionLength, maxq, -900, 40)
qx = mask(sm, q, -1050, 160, r=True)
qy = mask(sm, q, -1050, 230, g=True)
inside = expr(sm, unreal.MaterialExpressionMin, -800, 180, const_b=0.0)
mel.connect_material_expressions(op(sm, unreal.MaterialExpressionMax, qx, qy, -920, 180), "", inside, "A")
d = add(sm, length, inside, -650, 100)
inner = scalar(sm, "Inner", 22.0, -650, 250)
t = op(sm, unreal.MaterialExpressionDivide, add(sm, d, inner, -500, 120), add(sm, inner, scalar(sm, "Feather", 25.0, -650, 330), -500, 260), -350, 160)
t = one_in(sm, unreal.MaterialExpressionSaturate, t, -220, 160)
# 1 - smoothstep: 1 - t^2 (3 - 2t)
two_t = expr(sm, unreal.MaterialExpressionMultiply, -220, 260, const_b=2.0)
mel.connect_material_expressions(t, "", two_t, "A")
three = expr(sm, unreal.MaterialExpressionSubtract, -100, 260, const_a=3.0)
mel.connect_material_expressions(two_t, "", three, "B")
smooth = mul(sm, mul(sm, t, t, -100, 120), three, 30, 160)
falloff = one_in(sm, unreal.MaterialExpressionOneMinus, smooth, 160, 160)
mel.connect_material_property(mul(sm, falloff, scalar(sm, "Strength", 0.3, 160, 300), 320, 200), "", unreal.MaterialProperty.MP_OPACITY)
mel.connect_material_property(vector(sm, "Colour", (0.0, 0.0, 0.0, 1.0), 160, -60), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(sm)
eal.save_asset(DIR + "/M_ContactShadow", only_if_is_dirty=False)


def stats(m):
    s = mel.get_statistics(m)
    return {k: getattr(s, k) for k in ("num_pixel_shader_instructions", "num_vertex_shader_instructions", "num_pixel_texture_samples")}


print(json.dumps({"M_QuestFrame": stats(fm), "M_ContactShadow": stats(sm)}))
