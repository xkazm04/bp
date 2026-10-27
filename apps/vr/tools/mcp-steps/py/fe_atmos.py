# Content step (spark vr-fidelity-40 FE, elements 14 and 15): haze in depth and a brighter city, after fid_look.py.
# Replayable: every actor this step places carries the tag BpAtmos and is removed first; M_HazeShaft is rebuilt in place;
# the settings it changes are set.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fe-look.jsonl
#
# - Light shafts where the concept's haze shows: from the window down into the room (the city's glow hanging in the
#   air) and under the desk lamp's shade (a warm cone). Each is the engine cone, apex at the light, on M_HazeShaft:
#   unlit, additive (no sort, one draw each), brightest along the axis and toward the light, fading to nothing at the
#   rim and the base:
#     emissive = Color * Glow * (1 - fresnel(2)) * t^1.5,   t = 0 at the base, 1 at the apex (local z / 100 + 0.5)
#   Local Fog Volumes were tried first and draw nothing on this path (a 20/m red test sphere in front of the eye left
#   the capture unchanged, Lynx 2026-10-25), so the haze is geometry. None reaches the table: the sheet stays clear.
# - The city's window lights: EmissiveStrength from 3 (import_studio.py) to CITY_EMISSIVE, so more of them cross the
#   bloom threshold and halate like the concept's bokeh city.
import unreal

TAG = "BpAtmos"
CITY_EMISSIVE = 6.0
SHAFT = "/Game/Bp/Materials/M_HazeShaft"
# (label, apex cm, direction, length cm, base radius cm, linear colour, glow)
SHAFTS = [
    ("HazeWindowShaft", (255.0, 115.0, 215.0), (-0.82, 0.0, -0.57), 180.0, 60.0, (0.35, 0.55, 1.0), 0.09),
    ("HazeDeskLampShaft", (110.0, -102.0, 106.0), (0.0, 0.0, -1.0), 30.0, 14.0, (1.0, 0.62, 0.30), 0.07),
]

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
les.load_level("/Game/Maps/LightTable")
result = {}
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)

# ---- M_HazeShaft ----------------------------------------------------------------------------------------------------
if unreal.EditorAssetLibrary.does_asset_exist(SHAFT):
    m = unreal.load_asset(SHAFT)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_HazeShaft", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def wire(a, b, pin, out=""):
    mel.connect_material_expressions(a, out, b, pin)


colour = add(unreal.MaterialExpressionVectorParameter, -900, -300, parameter_name="Color", default_value=unreal.LinearColor(0.4, 0.6, 1.0, 1.0))
glow = add(unreal.MaterialExpressionScalarParameter, -900, -150, parameter_name="Glow", default_value=0.05)
fresnel = add(unreal.MaterialExpressionFresnel, -900, 0, exponent=2.0, base_reflect_fraction=0.0)
soft = add(unreal.MaterialExpressionOneMinus, -700, 0)
wire(fresnel, soft, "")
pos = add(unreal.MaterialExpressionPreSkinnedPosition, -1100, 200)
# Read in the vertex shader and interpolated (PreSkinnedPosition is vertex-only, as edge_glow.py's).
pos_vi = add(unreal.MaterialExpressionVertexInterpolator, -1000, 200)
wire(pos, pos_vi, "VS")
z = add(unreal.MaterialExpressionComponentMask, -900, 200, r=False, g=False, b=True, a=False)
wire(pos_vi, z, "")
unit = add(unreal.MaterialExpressionMultiply, -750, 200, const_b=0.01)
wire(z, unit, "A")
t = add(unreal.MaterialExpressionAdd, -600, 200, const_b=0.5)
wire(unit, t, "A")
t_sat = add(unreal.MaterialExpressionSaturate, -450, 200)
wire(t, t_sat, "")
grad = add(unreal.MaterialExpressionPower, -300, 200, const_exponent=1.5)
wire(t_sat, grad, "Base")
a1 = add(unreal.MaterialExpressionMultiply, -500, -250)
wire(colour, a1, "A")
wire(glow, a1, "B")
a2 = add(unreal.MaterialExpressionMultiply, -300, -100)
wire(a1, a2, "A")
wire(soft, a2, "B")
a3 = add(unreal.MaterialExpressionMultiply, -100, 0)
wire(a2, a3, "A")
wire(grad, a3, "B")
mel.connect_material_property(a3, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
unreal.EditorAssetLibrary.save_loaded_asset(m, only_if_is_dirty=False)

# ---- The shafts -----------------------------------------------------------------------------------------------------
cone = unreal.load_asset("/Engine/BasicShapes/Cone")
placed = {}
for label, apex, direction, length, radius, rgb, strength in SHAFTS:
    d = unreal.Vector(*direction)
    d.normalize()
    centre = unreal.Vector(*apex) + d * (length * 0.5)
    # The cone's apex is its local +Z: +Z turns to -direction, so the apex sits at the light and the base away from it.
    rot = unreal.MathLibrary.make_rot_from_z(d * -1.0)
    a = eas.spawn_actor_from_object(cone, centre, rot)
    a.set_actor_label(label)
    a.set_editor_property("tags", [unreal.Name(TAG)])
    a.set_actor_scale3d(unreal.Vector(radius / 50.0, radius / 50.0, length / 100.0))
    c = a.static_mesh_component
    c.set_editor_property("cast_shadow", False)
    c.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    c.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
    # Per shaft colour and glow through custom primitive data would need the material to read it; a material instance
    # per shaft keeps the material simple.
    path = "/Game/Bp/Materials/MI_" + label
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        inst = unreal.load_asset(path)
    else:
        inst = unreal.AssetToolsHelpers.get_asset_tools().create_asset("MI_" + label, "/Game/Bp/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(inst, m)
    mel.set_material_instance_vector_parameter_value(inst, "Color", unreal.LinearColor(*rgb, 1.0))
    mel.set_material_instance_scalar_parameter_value(inst, "Glow", strength)
    unreal.EditorAssetLibrary.save_loaded_asset(inst, only_if_is_dirty=False)
    c.set_material(0, inst)
    placed[label] = {"length": length, "radius": radius, "glow": strength}
result["shafts"] = placed

city = next(a for a in eas.get_all_level_actors() if a.get_actor_label() == "CityBackdrop")
ci = city.static_mesh_component.get_material(0)
mel.set_material_instance_scalar_parameter_value(ci, "EmissiveStrength", CITY_EMISSIVE)
unreal.EditorAssetLibrary.save_loaded_asset(ci, only_if_is_dirty=False)
result["city"] = {"material": ci.get_path_name(), "EmissiveStrength": CITY_EMISSIVE}
result["saved"] = les.save_current_level()
