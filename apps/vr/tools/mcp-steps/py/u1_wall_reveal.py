# Wave U1, "the wall arrives": M_BpWallReveal, the far sheet's material while it is projected in (ABpPawn::TickWallReveal sets
# it on the console's widget for about 0.4 s, then puts the widget's own opaque material back). Replayable: rebuilt in place.
#
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/u1_wall_reveal.py
#
# Unlit, MASKED (clip 0.5), one-sided, as the widget's own one-sided material: "SlateUI" is the widget's render target and
# "TintColorAndOpacity" its tint (UWidgetComponent sets both on any material it is given).
#   u' = lerp(u, 1 - u, Side)                        the wipe runs from Glim's side (Side 0: from the sheet's left)
#   Opacity Mask = Reveal - u' + 0.501               the sheet is drawn up to the wipe's edge, nothing beyond it
#   Active = 1 - floor(Reveal)                       1 while it wipes, 0 once whole (no edge at rest)
#   Edge = saturate(1 - |u' - Reveal| * 60)          a thin bright edge at the wipe (about 1/60 of the width)
#   Trail = saturate(1 - (Reveal - u') * 5)          the last fifth behind the edge glows a little, on alternate scanlines
#   Emissive = SlateUI.rgb * Tint.rgb * Bright + EdgeColor * Active * (Edge * 2.2 + Trail * Lines * 0.18)
# One texture sample and a few ALU ops; it is only on the sheet while it wipes.
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
result = {}
PATH = "/Game/Bp/Materials/M_BpWallReveal"

if eal.does_asset_exist(PATH):
    m = unreal.load_asset(PATH)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = tools.create_asset("M_BpWallReveal", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())

m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
m.set_editor_property("two_sided", False)
m.set_editor_property("opacity_mask_clip_value", 0.5)


def expr(cls, x, y):
    return mel.create_material_expression(m, cls, x, y)


def scalar(name, value, x, y):
    e = expr(unreal.MaterialExpressionScalarParameter, x, y)
    e.set_editor_property("parameter_name", name)
    e.set_editor_property("default_value", value)
    return e


def op(cls, a, b, x, y, a_out="", b_out=""):
    e = expr(cls, x, y)
    mel.connect_material_expressions(a, a_out, e, "A")
    if b is not None:
        mel.connect_material_expressions(b, b_out, e, "B")
    return e


def const(v, x, y):
    e = expr(unreal.MaterialExpressionConstant, x, y)
    e.set_editor_property("r", v)
    return e


tex = expr(unreal.MaterialExpressionTextureSampleParameter2D, -1400, -200)
tex.set_editor_property("parameter_name", "SlateUI")
black = unreal.load_asset("/Engine/EngineResources/Black")
if black:
    tex.set_editor_property("texture", black)
tex.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
tint = expr(unreal.MaterialExpressionVectorParameter, -1400, 50)
tint.set_editor_property("parameter_name", "TintColorAndOpacity")
tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
reveal = scalar("Reveal", 1.0, -1400, 250)
side = scalar("Side", 0.0, -1400, 350)
bright = scalar("Bright", 1.0, -1400, 450)
edge_col = expr(unreal.MaterialExpressionVectorParameter, -1400, 550)
edge_col.set_editor_property("parameter_name", "EdgeColor")
# Glim's lens, warm (BpLampLook.cpp's beam: 1, 0.62, 0.3).
edge_col.set_editor_property("default_value", unreal.LinearColor(1.0, 0.62, 0.3, 1.0))

uv = expr(unreal.MaterialExpressionTextureCoordinate, -1400, 700)
u = expr(unreal.MaterialExpressionComponentMask, -1200, 700)
u.set_editor_property("r", True)
u.set_editor_property("g", False)
mel.connect_material_expressions(uv, "", u, "")
v = expr(unreal.MaterialExpressionComponentMask, -1200, 800)
v.set_editor_property("r", False)
v.set_editor_property("g", True)
mel.connect_material_expressions(uv, "", v, "")
one_minus_u = expr(unreal.MaterialExpressionOneMinus, -1050, 650)
mel.connect_material_expressions(u, "", one_minus_u, "")
up = expr(unreal.MaterialExpressionLinearInterpolate, -900, 700)
mel.connect_material_expressions(u, "", up, "A")
mel.connect_material_expressions(one_minus_u, "", up, "B")
mel.connect_material_expressions(side, "", up, "Alpha")

# Opacity mask: Reveal - u' + 0.501
diff = op(unreal.MaterialExpressionSubtract, reveal, up, -700, 400)
mask = op(unreal.MaterialExpressionAdd, diff, const(0.501, -700, 500), -500, 400)
mel.connect_material_property(mask, "", unreal.MaterialProperty.MP_OPACITY_MASK)

# Active = 1 - floor(Reveal)
fl = expr(unreal.MaterialExpressionFloor, -900, 250)
mel.connect_material_expressions(reveal, "", fl, "")
active = expr(unreal.MaterialExpressionOneMinus, -750, 250)
mel.connect_material_expressions(fl, "", active, "")

# Edge = saturate(1 - |u' - Reveal| * 60)
d2 = op(unreal.MaterialExpressionSubtract, up, reveal, -700, 800)
ad = expr(unreal.MaterialExpressionAbs, -550, 800)
mel.connect_material_expressions(d2, "", ad, "")
ad60 = op(unreal.MaterialExpressionMultiply, ad, const(60.0, -550, 900), -400, 800)
e1 = expr(unreal.MaterialExpressionOneMinus, -250, 800)
mel.connect_material_expressions(ad60, "", e1, "")
edge = expr(unreal.MaterialExpressionSaturate, -100, 800)
mel.connect_material_expressions(e1, "", edge, "")

# Trail = saturate(1 - (Reveal - u') * 5), Lines = floor(frac(v * 120) * 2) (alternate scanlines)
t5 = op(unreal.MaterialExpressionMultiply, diff, const(5.0, -550, 1000), -400, 1000)
t1 = expr(unreal.MaterialExpressionOneMinus, -250, 1000)
mel.connect_material_expressions(t5, "", t1, "")
trail = expr(unreal.MaterialExpressionSaturate, -100, 1000)
mel.connect_material_expressions(t1, "", trail, "")
v120 = op(unreal.MaterialExpressionMultiply, v, const(120.0, -1050, 900), -900, 1100)
fr = expr(unreal.MaterialExpressionFrac, -750, 1100)
mel.connect_material_expressions(v120, "", fr, "")
fr2 = op(unreal.MaterialExpressionMultiply, fr, const(2.0, -750, 1200), -600, 1150)
lines = expr(unreal.MaterialExpressionFloor, -450, 1150)
mel.connect_material_expressions(fr2, "", lines, "")
trail_l = op(unreal.MaterialExpressionMultiply, trail, lines, 50, 1050)
trail_k = op(unreal.MaterialExpressionMultiply, trail_l, const(0.18, 50, 1150), 200, 1050)
edge_k = op(unreal.MaterialExpressionMultiply, edge, const(2.2, 50, 900), 200, 850)
glow = op(unreal.MaterialExpressionAdd, edge_k, trail_k, 350, 950)
glow_a = op(unreal.MaterialExpressionMultiply, glow, active, 500, 900)
glow_c = op(unreal.MaterialExpressionMultiply, edge_col, glow_a, 650, 700, "RGB", "")

# The sheet: SlateUI.rgb * Tint.rgb * Bright
sheet = op(unreal.MaterialExpressionMultiply, tex, tint, -1100, -100, "RGB", "RGB")
sheet_b = op(unreal.MaterialExpressionMultiply, sheet, bright, -900, -50)
emissive = op(unreal.MaterialExpressionAdd, sheet_b, glow_c, 850, 200)
mel.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

mel.recompile_material(m)
result["saved"] = eal.save_asset(PATH, only_if_is_dirty=False)
result["expressions"] = mel.get_num_material_expressions(m)
result["blend"] = str(m.get_editor_property("blend_mode"))
print(result)
