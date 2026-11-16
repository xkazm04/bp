# Night two V1 (the scene): the lamp's self-lit Quest material and the studio floor. Idempotent: every asset is found by
# name and rebuilt in place. Run with the editor up (no PIE needed):
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/v1_scene.py
#
#   M_QuestLamp:   the lamp agent's slots on the Quest tier (BpLampLook.cpp swaps them). UNLIT and built from legacy
#                  material inputs, never a Substrate Slab: on the mobile base pass an explicit Substrate opaque material
#                  writes scene alpha 1 (MobileBasePassPixelShader.usf, "SUBSTRATE_OPAQUE_MATERIAL ... float4(Color, 1)")
#                  where every legacy-converted one writes 0, and with the passthrough underlay on (bp.Room 1) the
#                  compositor reads that alpha as "show the room here": M_LampAgentFid (a Slab with a haze lobe) vanished
#                  over passthrough while the frame (M_QuestLit) and the pins (unlit) stayed. Being unlit also makes the lamp
#                  a light source that needs no studio light: its body is shaded by a fixed key in world space
#                  (Ambient + Key x wrap(N.L)^2), its hood and lens glow GlowColor x GlowStrength x GlowScale, the lens with a
#                  hot core round LensCentre (local cm), and the glow breathes in the shader: x (1 + PulseAmp sin(2 pi
#                  PulseHz t)), so a light state is two parameters set once (no tick).
#   M_StudioFloor: unlit, opaque, one texture: T_StudioFloor x FloorTint x Gain. The texture is made here (pure Python, no
#                  asset): dark oak planks under a warm pool of light round the table, the table top's soft shadow, the four
#                  legs' contact shadows, falloff to the shell's black at its edges. Table space: FLOOR_CM square centred
#                  on the table, +X far (the texture's U), +Y right (V).
import json
import math
import os
import random
import struct
import tempfile
import zlib

import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
DIR = "/Game/Bp/Materials"
TEX_DIR = "/Game/Bp/Textures"
LAMP_TEX = "/Game/Bp/Art/LampAgentStatic/Textures"

# The floor: its size (BpLampLook.cpp's FloorCm must match), the table's legs (SM_LightTableFrame's lowest vertices,
# measured 2026-11-10: centres at x +-36.5, y +-75, 5 cm across) and its top (the frame's footprint).
FLOOR_CM = 520.0
FLOOR_PX = 1024
LEGS = [(-36.5, -75.0), (36.5, -75.0), (-36.5, 75.0), (36.5, 75.0)]
TOP_HALF = (48.0, 100.0)


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


def one_in(m, cls, a, x, y, a_out=""):
    e = mel.create_material_expression(m, cls, x, y)
    mel.connect_material_expressions(a, a_out, e, "")
    return e


# ---- M_QuestLamp ------------------------------------------------------------------------------------------------------
lm = fresh_material("M_QuestLamp")
lm.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
lm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
lm.set_editor_property("two_sided", True)
# Base: lerp(BaseColor, BaseTex x lerp(1, AO, AOMix), UseTexture), as M_LampAgentFid.
base_tex = expr(lm, unreal.MaterialExpressionTextureSampleParameter2D, -1600, -400, parameter_name="BaseTex",
                texture=eal.load_asset(LAMP_TEX + "/T_Agent_BaseColor"))
orm_tex = expr(lm, unreal.MaterialExpressionTextureSampleParameter2D, -1600, -100, parameter_name="ORMTex",
               texture=eal.load_asset(LAMP_TEX + "/T_Agent_ORM"), sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
ao = expr(lm, unreal.MaterialExpressionLinearInterpolate, -1300, -50, const_a=1.0)
mel.connect_material_expressions(scalar(lm, "AOMix", 0.6, -1500, 50), "", ao, "Alpha")
mel.connect_material_expressions(orm_tex, "R", ao, "B")
textured = mul(lm, base_tex, ao, -1150, -300, "RGB")
base = expr(lm, unreal.MaterialExpressionLinearInterpolate, -1000, -400)
mel.connect_material_expressions(vector(lm, "BaseColor", (0.8, 0.79, 0.77, 1.0), -1150, -550), "", base, "A")
mel.connect_material_expressions(textured, "", base, "B")
mel.connect_material_expressions(scalar(lm, "UseTexture", 1.0, -1150, -150), "", base, "Alpha")
# Self light: Ambient + Key x (N.L x 0.5 + 0.5)^2, N the vertex normal.
normal_raw = expr(lm, unreal.MaterialExpressionVertexNormalWS, -1750, 250)
# The shell is open (two-sided): a back face seen is turned toward the eye, so its normal is flipped too.
normal = mul(lm, normal_raw, expr(lm, unreal.MaterialExpressionTwoSidedSign, -1750, 330), -1600, 250)
key_dir = vector(lm, "KeyDir", (-0.35, -0.20, 0.92, 0.0), -1600, 350)
ndl = expr(lm, unreal.MaterialExpressionDotProduct, -1400, 300)
mel.connect_material_expressions(normal, "", ndl, "A")
mel.connect_material_expressions(key_dir, "", ndl, "B")
wrap = expr(lm, unreal.MaterialExpressionMultiply, -1250, 300, const_b=0.5)
mel.connect_material_expressions(ndl, "", wrap, "A")
wrap2 = expr(lm, unreal.MaterialExpressionAdd, -1150, 300, const_b=0.5)
mel.connect_material_expressions(wrap, "", wrap2, "A")
wrap3 = mul(lm, wrap2, wrap2, -1050, 300)
keyed = mul(lm, wrap3, scalar(lm, "Key", 1.2, -1050, 420), -900, 330)
shade = add(lm, keyed, scalar(lm, "Ambient", 0.75, -900, 450), -780, 360)
tint_shade = mul(lm, shade, vector(lm, "BodyTint", (1.0, 0.94, 0.86, 1.0), -780, 500), -650, 400)
body = mul(lm, base, tint_shade, -500, -100)
body_gain = mul(lm, body, scalar(lm, "SelfLight", 1.0, -500, 50), -380, -50)
# Glow: GlowColor x GlowStrength x GlowScale x (1 + HotCore x core^2 x HotGain) x pulse; the core whitens toward Hot.
local = expr(lm, unreal.MaterialExpressionLocalPosition, -1600, 700) if hasattr(unreal, "MaterialExpressionLocalPosition") else None
if local is None:
    wp = expr(lm, unreal.MaterialExpressionWorldPosition, -1750, 700)
    local = expr(lm, unreal.MaterialExpressionTransformPosition, -1600, 700,
                 transform_source_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_WORLD,
                 transform_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_LOCAL)
    mel.connect_material_expressions(wp, "", local, "")
dist = op(lm, unreal.MaterialExpressionDistance, local, vector(lm, "LensCentre", (0.5, -0.6, 16.5, 0.0), -1600, 800), -1400, 750)
rel = op(lm, unreal.MaterialExpressionDivide, dist, scalar(lm, "LensRadius", 6.5, -1400, 880), -1250, 780)
core = one_in(lm, unreal.MaterialExpressionSaturate, one_in(lm, unreal.MaterialExpressionOneMinus, rel, -1150, 780), -1050, 780)
core2 = mul(lm, core, core, -950, 780)
core_k = mul(lm, core2, scalar(lm, "HotCore", 0.0, -950, 900), -830, 800)
glow_c = vector(lm, "GlowColor", (1.0, 0.43, 0.13, 1.0), -950, 600)
hot = expr(lm, unreal.MaterialExpressionLinearInterpolate, -700, 650)
mel.connect_material_expressions(glow_c, "", hot, "A")
mel.connect_material_expressions(vector(lm, "HotColor", (1.0, 0.92, 0.75, 1.0), -950, 700), "", hot, "B")
mel.connect_material_expressions(core_k, "", hot, "Alpha")
boost = expr(lm, unreal.MaterialExpressionAdd, -700, 820, const_a=1.0)
mel.connect_material_expressions(mul(lm, core_k, scalar(lm, "HotGain", 2.0, -830, 950), -760, 900), "", boost, "B")
strength = mul(lm, scalar(lm, "GlowStrength", 0.0, -700, 980), scalar(lm, "GlowScale", 1.0, -700, 1080), -560, 1000)
time = expr(lm, unreal.MaterialExpressionTime, -1100, 1150)
phase = mul(lm, time, scalar(lm, "PulseHz", 0.2, -1100, 1250), -950, 1180)
phase2 = expr(lm, unreal.MaterialExpressionMultiply, -850, 1180, const_b=6.2831853)
mel.connect_material_expressions(phase, "", phase2, "A")
sine = one_in(lm, unreal.MaterialExpressionSine, phase2, -750, 1180)
sine.set_editor_property("period", 6.2831853)
pulse = expr(lm, unreal.MaterialExpressionAdd, -520, 1200, const_a=1.0)
mel.connect_material_expressions(mul(lm, sine, scalar(lm, "PulseAmp", 0.12, -750, 1300), -620, 1220), "", pulse, "B")
g1 = mul(lm, hot, boost, -520, 700)
g2 = mul(lm, g1, strength, -400, 800)
g3 = mul(lm, g2, pulse, -300, 900)
glow = mul(lm, g3, scalar(lm, "GlowGain", 1.0, -400, 1000), -200, 900)
mel.connect_material_property(add(lm, body_gain, glow, -150, 200), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(lm)
eal.save_asset(DIR + "/M_QuestLamp", only_if_is_dirty=False)


# ---- T_StudioFloor ----------------------------------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


rng = random.Random(1109)
PLANK_CM = 19.0
planks = [(0.82 + 0.3 * rng.random(), rng.random() * 400.0, rng.random() * 6.28, 0.9 + 0.2 * rng.random()) for _ in range(64)]
WOOD = (0.21, 0.155, 0.11)    # dark oak, linear-ish albedo
WARM = (1.00, 0.86, 0.70)     # the pool's light
COOL = (0.62, 0.72, 0.95)     # the far reach: the window's night
half = FLOOR_CM / 2.0
rows = []
lin_max = 0.0
for j in range(FLOOR_PX):
    # Row j: the table's +Y (right) runs down the texture's V.
    y = (j + 0.5) / FLOOR_PX * FLOOR_CM - half
    plank_i = int(math.floor((y + half) / PLANK_CM))
    shade_p, end_off, ph, grain_k = planks[plank_i % len(planks)]
    in_plank = ((y + half) / PLANK_CM) % 1.0
    seam_y = min(in_plank, 1.0 - in_plank) * PLANK_CM
    row = bytearray()
    for i in range(FLOOR_PX):
        x = (i + 0.5) / FLOOR_PX * FLOOR_CM - half
        # Wood: per-plank tone, end joints every 140 cm staggered, a slow grain along X and a fine one.
        joint = ((x + end_off) % 140.0)
        seam = min(1.0, seam_y / 0.25) * min(1.0, min(joint, 140.0 - joint) / 0.3)
        g = 0.5 + 0.5 * math.sin(x * 0.11 * grain_k + ph + 1.7 * math.sin(x * 0.013 + ph))
        fine = 0.5 + 0.5 * math.sin(x * 0.9 + y * 3.1 + ph * 3.0)
        tone = shade_p * (0.86 + 0.10 * g + 0.04 * fine) * (0.55 + 0.45 * seam)
        # Light: a warm pool round the table, a cool far reach, the edges to black.
        pool = math.exp(-((x / 105.0) ** 2 + (y / 150.0) ** 2))
        reach = math.exp(-((x / 300.0) ** 2 + (y / 330.0) ** 2))
        # The top's soft shadow on the floor under it, and the legs' contact shadows (a tight core and a wider soft).
        dx = max(0.0, abs(x) - TOP_HALF[0] + 14.0)
        dy = max(0.0, abs(y) - TOP_HALF[1] + 14.0)
        under = math.exp(-(dx * dx + dy * dy) / (2.0 * 22.0 ** 2))
        occ = 1.0 - 0.5 * under
        for lx, ly in LEGS:
            d2 = (x - lx) ** 2 + (y - ly) ** 2
            occ *= 1.0 - 0.82 * math.exp(-d2 / (2.0 * 3.2 ** 2)) - 0.35 * math.exp(-d2 / (2.0 * 11.0 ** 2))
        edge = 1.0 - smoothstep(0.45, 1.0, math.hypot(x, y) / half)
        light = [(0.05 + 1.0 * pool) * WARM[c] + 0.12 * reach * COOL[c] for c in range(3)]
        px = []
        for c in range(3):
            v = WOOD[c] * tone * light[c] * max(0.0, occ) * edge
            lin_max = max(lin_max, v)
            # Stored at 2.5x (sRGB), the material's Gain brings it back: the dark range keeps its steps.
            s = min(1.0, v * 2.5)
            s = 12.92 * s if s <= 0.0031308 else 1.055 * s ** (1.0 / 2.4) - 0.055
            px.append(int(round(s * 255.0)))
        row.extend(px)
    rows.append(row)
out_png = os.path.join(tempfile.gettempdir(), "T_StudioFloor.png")
png(out_png, FLOOR_PX, FLOOR_PX, rows)
task = unreal.AssetImportTask()
task.filename = out_png
task.destination_path = TEX_DIR
task.destination_name = "T_StudioFloor"
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])
tex = eal.load_asset(TEX_DIR + "/T_StudioFloor")
tex.set_editor_property("srgb", True)
tex.set_editor_property("address_x", unreal.TextureAddress.TA_CLAMP)
tex.set_editor_property("address_y", unreal.TextureAddress.TA_CLAMP)
tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_WORLD)
eal.save_loaded_asset(tex, only_if_is_dirty=False)

# ---- M_StudioFloor ----------------------------------------------------------------------------------------------------
fm = fresh_material("M_StudioFloor")
fm.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
fm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
fm.set_editor_property("two_sided", False)
ft = expr(fm, unreal.MaterialExpressionTextureSampleParameter2D, -700, 0, parameter_name="FloorTex", texture=tex)
f1 = mul(fm, ft, vector(fm, "FloorTint", (1.0, 1.0, 1.0, 1.0), -700, 250), -450, 50, "RGB")
f2 = mul(fm, f1, scalar(fm, "Gain", 0.15, -450, 250), -250, 100)
mel.connect_material_property(f2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(fm)
eal.save_asset(DIR + "/M_StudioFloor", only_if_is_dirty=False)


def stats(m):
    s = mel.get_statistics(m)
    return {k: getattr(s, k) for k in ("num_pixel_shader_instructions", "num_vertex_shader_instructions", "num_pixel_texture_samples")}


print(json.dumps({"M_QuestLamp": stats(lm), "M_StudioFloor": stats(fm), "floor_lin_max": round(lin_max, 4), "png": out_png}))
