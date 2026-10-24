# L3.3 content step (spark vr-volumes): M_EdgeGlow, the volumes' edge-glow material, through
# PoFScriptTools.run_python (MaterialEditingLibrary: PreSkinnedLocalPosition, the vertex interpolator and per-instance
# custom data are not in EditorToolset's MaterialTools vocabulary). Replayable: an existing M_EdgeGlow is emptied of its
# expressions and rebuilt in place (deleting it fails while the editor holds it loaded).
# Run outside PIE (during PIE the library hands back None for new expressions, Lynx 2026-10-24):
# node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-look.jsonl
#
# Wire contract with ABpTable: per-instance custom data 0 to 2 = the instance's size in cm along its X, Y, Z (the engine
# cube, 100 cm, scaled per instance). Scalars `EdgeWidthCm` (how far in from an edge the glow reaches, cm), `FaceOpacity`
# (the faces' opacity; ABpTable sets 0 on the bays), `Intensity` (the colour's emissive scale).
# Unlit, translucent, one-sided, used with instanced static meshes. Translucent, not additive (spark vr-hands-zoom WP2):
# additive summed the edges that overlap from the eye (room shell, bay plate, tile, front and back) into white blobs
# (capture l33-2026-10-24-lynx.jpg). Every pixel blends toward one colour with an opacity, so overlaps converge on that
# colour instead of adding up, and the result does not depend on the draw order (still one draw per ISM batch).
#
#   p    = local position / 100 + 0.5                      (0..1 across the cube, per axis; vertex shader, interpolated)
#   d    = min(p, 1 - p) * size                            (cm to the nearest face along each axis)
#   mid  = d.x + d.y + d.z - min(d) - max(d)               (on a face, the smallest is ~0; the middle one is cm to an edge)
#   edge = saturate(1 - mid / EdgeWidthCm)
#   face = FaceOpacity * lerp(1, 3, fresnel)               (faces ~6 %, a little brighter at grazing angles)
#   emissive = #BFE8FF * Intensity,  opacity = max(edge, face)
import unreal

PATH = "/Game/Bp/Materials/M_EdgeGlow"
mel = unreal.MaterialEditingLibrary
# #BFE8FF (sRGB) as linear, the cyan-white of art-breakdown's style block.
CYAN_WHITE = unreal.LinearColor(0.5209956, 0.8069523, 1.0, 1.0)

if unreal.EditorAssetLibrary.does_asset_exist(PATH):
    m = unreal.EditorAssetLibrary.load_asset(PATH)
    # One by one: delete_all_material_expressions left some behind here (Lynx, 2026-10-24).
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "M_EdgeGlow", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
m.set_editor_property("two_sided", False)
m.set_editor_property("used_with_instanced_static_meshes", True)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def wire(a, b, pin, out=""):
    mel.connect_material_expressions(a, out, b, pin)


def param(name, value, x, y):
    return add(unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


# Position and size, read in the vertex shader and interpolated (portable to the mobile forward path).
pos = add(unreal.MaterialExpressionPreSkinnedPosition, -2000, -200)
pos_vi = add(unreal.MaterialExpressionVertexInterpolator, -1800, -200)
wire(pos, pos_vi, "VS")
size = add(unreal.MaterialExpressionPerInstanceCustomData3Vector, -2000, 100, data_index=0,
           const_default_value=unreal.LinearColor(100.0, 100.0, 100.0, 0.0))
size_vi = add(unreal.MaterialExpressionVertexInterpolator, -1800, 100)
wire(size, size_vi, "VS")

unit = add(unreal.MaterialExpressionMultiply, -1600, -200, const_b=0.01)
wire(pos_vi, unit, "A")
p = add(unreal.MaterialExpressionAdd, -1450, -200, const_b=0.5)
wire(unit, p, "A")
q = add(unreal.MaterialExpressionOneMinus, -1300, -100)
wire(p, q, "")
near = add(unreal.MaterialExpressionMin, -1150, -200)
wire(p, near, "A")
wire(q, near, "B")
d = add(unreal.MaterialExpressionMultiply, -1000, -100)
wire(near, d, "A")
wire(size_vi, d, "B")

dx = add(unreal.MaterialExpressionComponentMask, -850, -300, r=True, g=False, b=False, a=False)
dy = add(unreal.MaterialExpressionComponentMask, -850, -150, r=False, g=True, b=False, a=False)
dz = add(unreal.MaterialExpressionComponentMask, -850, 0, r=False, g=False, b=True, a=False)
for c in (dx, dy, dz):
    wire(d, c, "")
mn_xy = add(unreal.MaterialExpressionMin, -700, -400)
wire(dx, mn_xy, "A")
wire(dy, mn_xy, "B")
mn = add(unreal.MaterialExpressionMin, -550, -400)
wire(mn_xy, mn, "A")
wire(dz, mn, "B")
mx_xy = add(unreal.MaterialExpressionMax, -700, -250)
wire(dx, mx_xy, "A")
wire(dy, mx_xy, "B")
mx = add(unreal.MaterialExpressionMax, -550, -250)
wire(mx_xy, mx, "A")
wire(dz, mx, "B")
sum_xy = add(unreal.MaterialExpressionAdd, -700, -100)
wire(dx, sum_xy, "A")
wire(dy, sum_xy, "B")
total = add(unreal.MaterialExpressionAdd, -550, -100)
wire(sum_xy, total, "A")
wire(dz, total, "B")
less_min = add(unreal.MaterialExpressionSubtract, -400, -200)
wire(total, less_min, "A")
wire(mn, less_min, "B")
mid = add(unreal.MaterialExpressionSubtract, -250, -200)
wire(less_min, mid, "A")
wire(mx, mid, "B")

width = param("EdgeWidthCm", 0.2, -400, 50)
ratio = add(unreal.MaterialExpressionDivide, -100, -150)
wire(mid, ratio, "A")
wire(width, ratio, "B")
inv = add(unreal.MaterialExpressionOneMinus, 50, -150)
wire(ratio, inv, "")
edge = add(unreal.MaterialExpressionSaturate, 200, -150)
wire(inv, edge, "")

fresnel = add(unreal.MaterialExpressionFresnel, -250, 250, exponent=3.0, base_reflect_fraction=0.0)
lift = add(unreal.MaterialExpressionLinearInterpolate, -50, 250, const_a=1.0, const_b=3.0)
wire(fresnel, lift, "Alpha")
face_opacity = param("FaceOpacity", 0.06, -50, 400)
face = add(unreal.MaterialExpressionMultiply, 150, 300)
wire(lift, face, "A")
wire(face_opacity, face, "B")

glow = add(unreal.MaterialExpressionMax, 400, 0)
wire(edge, glow, "A")
wire(face, glow, "B")
color = add(unreal.MaterialExpressionConstant3Vector, 400, -300, constant=CYAN_WHITE)
# Above the bloom threshold (1.0, level_lighttable.py) so an edge glows a little; additive at 1.5 outshone the wing
# labels (captures, 2026-10-24), blended it cannot exceed this.
intensity = param("Intensity", 1.4, 400, -150)
lit = add(unreal.MaterialExpressionMultiply, 600, -250)
wire(color, lit, "A")
wire(intensity, lit, "B")
mel.connect_material_property(lit, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
opacity = add(unreal.MaterialExpressionSaturate, 600, 0)
wire(glow, opacity, "")
mel.connect_material_property(opacity, "", unreal.MaterialProperty.MP_OPACITY)

mel.recompile_material(m)
saved = unreal.EditorAssetLibrary.save_asset(PATH, only_if_is_dirty=False)
result = {
    "material": PATH,
    "saved": saved,
    "expressions": mel.get_num_material_expressions(m),
    "blend": str(m.get_editor_property("blend_mode")),
    "shading": str(m.get_editor_property("shading_model")),
    "ism": m.get_editor_property("used_with_instanced_static_meshes"),
}
