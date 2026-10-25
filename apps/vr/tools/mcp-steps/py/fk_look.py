# Content step (spark vr-fidelity-40 FK, elements 4, 13 and 15): cyan glass edges, softer post, haze veils in depth and
# a darker studio, after fg_holo.py (and fe_atmos.py, fid_bake.py). Replayable: every actor this step places carries the
# tag BpHaze and is removed first; M_HazeVeil is rebuilt in place; the settings it changes are set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fk-look.jsonl
# Re-run fid_bake.py after it (RoomFill is a static light).
#
# - M_EdgeGlow's edge colour becomes a parameter, EdgeColor, set to a saturated cyan: at Intensity 3.2 fg_holo.py's
#   #BFE8FF went white through the filmic shoulder (the judge: "white-glowing edges"; the concept's are cyan).
# - Bloom wider and stronger on the bright edges (the threshold stays, so the sheet's text, under it, does not bloom).
# - Haze veils: Local Fog Volumes draw nothing on this forward path (FE), so the air is geometry: vertical planes on
#   M_HazeVeil, unlit and additive (no sort, one draw each), brightest at their foot and fading up and to the sides,
#   softened where they meet the room (DepthFade). One rises from the table's far edge (the sheet's light in the air
#   over it), one hangs deeper in the room (the concept's atmospheric haze behind the lamp agent).
# - RoomFill lower: the concept's studio is moodier and darker than ours (the judge, element 13).
import unreal

TAG = "BpHaze"
EDGE = "/Game/Bp/Materials/M_EdgeGlow"
VEIL = "/Game/Bp/Materials/M_HazeVeil"
# The concept's room edges, #7FD8FF to #BFE8FF: the saturated end, as linear, for an emissive that stays cyan at 3.2.
EDGE_COLOR = unreal.LinearColor(0.10, 0.62, 1.0, 1.0)
BLOOM = {"intensity": 1.5, "threshold": 0.7}
BLOOM_WIDE = {4: (18.0, 0.8), 5: (60.0, 0.75), 6: (120.0, 0.55)}  # kernel: (size, tint)
FOG_DENSITY = 0.06
ROOM_FILL_CD = 22.0
# (label, centre of the foot cm, width cm, height cm, linear colour, glow, falloff power)
VEILS = [
    ("HazeTableRise", (58.0, 0.0, 95.0), 300.0, 110.0, (0.22, 0.48, 1.0), 0.09, 2.2),
    ("HazeRoomVeil", (175.0, 0.0, 30.0), 560.0, 230.0, (0.30, 0.42, 0.75), 0.035, 1.0),
]

VEIL_HLSL = """
float t = saturate(P.x * 0.01 + 0.5);
float s = saturate(abs(P.y) * 0.02);
float v = pow(1 - t, Pow) * (1 - s * s) * saturate(t * 20);
return Color * Glow * v * Fade;
"""

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
les.load_level("/Game/Maps/LightTable")
result = {}
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


# ---- 1. M_EdgeGlow: the edge colour as a parameter ------------------------------------------------------------------
m = unreal.load_asset(EDGE)
exprs = mel.get_material_expressions(m)
custom = next(e for e in exprs if isinstance(e, unreal.MaterialExpressionCustom) and "holo edges" in str(e.get_editor_property("description")))
param = next((e for e in exprs if isinstance(e, unreal.MaterialExpressionVectorParameter)
              and str(e.get_editor_property("parameter_name")) == "EdgeColor"), None)
if param is None:
    # fg_holo.py wired a Constant3Vector (#BFE8FF) at (-1000, 1300) into the custom node's Cyan input.
    old = next(e for e in exprs if isinstance(e, unreal.MaterialExpressionConstant3Vector)
               and e.get_editor_property("material_expression_editor_y") == 1300)
    param = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -1000, 1300)
    param.set_editor_property("parameter_name", "EdgeColor")
    mel.delete_material_expression(m, old)
    if not mel.connect_material_expressions(param, "", custom, "Cyan"):
        raise RuntimeError("could not wire EdgeColor")
param.set_editor_property("default_value", EDGE_COLOR)
mel.recompile_material(m)
result["edge"] = {"saved": eal.save_asset(EDGE, only_if_is_dirty=False), "EdgeColor": str(EDGE_COLOR)}

# ---- 2. M_HazeVeil --------------------------------------------------------------------------------------------------
if eal.does_asset_exist(VEIL):
    m = unreal.load_asset(VEIL)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_HazeVeil", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


inputs = []
for n in ("P", "Color", "Glow", "Pow", "Fade"):
    ci = unreal.CustomInput()
    ci.set_editor_property("input_name", n)
    inputs.append(ci)
veil = add(unreal.MaterialExpressionCustom, -300, 0, code=VEIL_HLSL, description="haze veil",
           output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, inputs=inputs)
pos = add(unreal.MaterialExpressionPreSkinnedPosition, -1000, -200)
pos_vi = add(unreal.MaterialExpressionVertexInterpolator, -850, -200)
mel.connect_material_expressions(pos, "", pos_vi, "VS")
mel.connect_material_expressions(pos_vi, "", veil, "P")
mel.connect_material_expressions(add(unreal.MaterialExpressionVectorParameter, -800, 0, parameter_name="Color",
                                     default_value=unreal.LinearColor(0.3, 0.5, 1.0, 1.0)), "", veil, "Color")
mel.connect_material_expressions(add(unreal.MaterialExpressionScalarParameter, -800, 150, parameter_name="Glow", default_value=0.05), "", veil, "Glow")
mel.connect_material_expressions(add(unreal.MaterialExpressionScalarParameter, -800, 250, parameter_name="Pow", default_value=1.5), "", veil, "Pow")
fade = add(unreal.MaterialExpressionDepthFade, -800, 350)
mel.connect_material_expressions(add(unreal.MaterialExpressionScalarParameter, -1000, 450, parameter_name="FadeCm", default_value=40.0), "", fade, "FadeDistance")
mel.connect_material_expressions(fade, "", veil, "Fade")
mel.connect_material_property(veil, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
eal.save_loaded_asset(m, only_if_is_dirty=False)

# ---- 3. The veils: the engine plane (100 cm, facing +Z) stood up by pitch 90, so its local X is world up and its face
# looks toward -X, the viewer at the table's near edge; local Y stays world Y. ----------------------------------------
plane = unreal.load_asset("/Engine/BasicShapes/Plane")
placed = {}
for label, foot, width, height, rgb, glow, power in VEILS:
    centre = unreal.Vector(foot[0], foot[1], foot[2] + height * 0.5)
    a = eas.spawn_actor_from_object(plane, centre, unreal.Rotator(pitch=90.0, yaw=0.0, roll=0.0))
    a.set_actor_label(label)
    a.set_editor_property("tags", [unreal.Name(TAG)])
    a.set_actor_scale3d(unreal.Vector(height / 100.0, width / 100.0, 1.0))
    c = a.static_mesh_component
    c.set_editor_property("cast_shadow", False)
    c.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    c.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
    path = "/Game/Bp/Materials/MI_" + label
    if eal.does_asset_exist(path):
        mi = unreal.load_asset(path)
    else:
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset("MI_" + label, "/Game/Bp/Materials", unreal.MaterialInstanceConstant,
                                                                     unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, m)
    mel.set_material_instance_vector_parameter_value(mi, "Color", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    mel.set_material_instance_scalar_parameter_value(mi, "Glow", glow)
    mel.set_material_instance_scalar_parameter_value(mi, "Pow", power)
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
    c.set_material(0, mi)
    placed[label] = {"centre": [centre.x, centre.y, centre.z], "size": [width, height], "glow": glow, "pow": power}
result["veils"] = placed

# ---- 4. Post and fog ------------------------------------------------------------------------------------------------
ppv = by_label("FixedExposure")
pps = ppv.get_editor_property("settings")
pps.set_editor_property("override_bloom_intensity", True)
pps.set_editor_property("bloom_intensity", BLOOM["intensity"])
pps.set_editor_property("override_bloom_threshold", True)
pps.set_editor_property("bloom_threshold", BLOOM["threshold"])
for k, (size, tint) in BLOOM_WIDE.items():
    pps.set_editor_property("override_bloom%d_size" % k, True)
    pps.set_editor_property("bloom%d_size" % k, size)
    pps.set_editor_property("override_bloom%d_tint" % k, True)
    pps.set_editor_property("bloom%d_tint" % k, unreal.LinearColor(tint, tint, tint, 1.0))
ppv.set_editor_property("settings", pps)
fog = by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent)
fog.set_editor_property("fog_density", FOG_DENSITY)
result["post"] = {"bloom": BLOOM, "wide": BLOOM_WIDE, "fog_density": FOG_DENSITY}

# ---- 5. The darker studio -------------------------------------------------------------------------------------------
fill = by_label("RoomFill").get_component_by_class(unreal.LightComponent)
fill.set_editor_property("intensity", ROOM_FILL_CD)
result["room_fill_cd"] = ROOM_FILL_CD

result["saved"] = les.save_current_level()
