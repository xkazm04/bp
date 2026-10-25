# Content step (spark vr-fidelity-40 FF, element 9): the lamp agent's halo, after studio_level.py. The concept's lamp
# glows past its hood into the room's haze; the glow card in the hood opening (import_studio.py) stays inside the hood's
# silhouette, and bloom alone gives a tight ring. So a soft additive disc stands just behind the head, facing the room:
# the head covers its centre and its falloff spills round the hood's rim. Unlit, additive, no depth write, one draw.
# Replayable: the actor carries the tag BpAgentHalo and is removed first; M_AgentHalo is rebuilt in place.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/ff-assembly.jsonl
#
#   emissive = Color * Glow * saturate(1 - 2 |UV - 0.5|) ^ HALO_FALLOFF   (zero at the disc's edge, no seam)
import unreal

TAG = "BpAgentHalo"
HALO = "/Game/Bp/Materials/M_AgentHalo"
HALO_CM = 80.0  # the disc's diameter
HALO_BEHIND_CM = (14.0, 0.0, 3.0)  # from the orb's light point: behind it (+X) and up to the orb's centre
HALO_GLOW = 0.4
HALO_FALLOFF = 3.0
HALO_COLOUR = unreal.LinearColor(1.0, 0.42, 0.10, 1.0)  # the orb's amber, linear

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
les.load_level("/Game/Maps/LightTable")
result = {}
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)

if unreal.EditorAssetLibrary.does_asset_exist(HALO):
    m = unreal.load_asset(HALO)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset("M_AgentHalo", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


colour = add(unreal.MaterialExpressionVectorParameter, -700, -200, parameter_name="Color", default_value=HALO_COLOUR)
glow = add(unreal.MaterialExpressionScalarParameter, -700, -50, parameter_name="Glow", default_value=HALO_GLOW)
uv = add(unreal.MaterialExpressionTextureCoordinate, -1100, 150)
dist = add(unreal.MaterialExpressionDistance, -950, 150)
mel.connect_material_expressions(uv, "", dist, "A")
mel.connect_material_expressions(add(unreal.MaterialExpressionConstant2Vector, -1100, 300, r=0.5, g=0.5), "", dist, "B")
edge = add(unreal.MaterialExpressionMultiply, -800, 150, const_b=2.0)
mel.connect_material_expressions(dist, "", edge, "A")
inner = add(unreal.MaterialExpressionOneMinus, -680, 150)
mel.connect_material_expressions(edge, "", inner, "")
clamp = add(unreal.MaterialExpressionSaturate, -560, 150)
mel.connect_material_expressions(inner, "", clamp, "")
grad = add(unreal.MaterialExpressionPower, -440, 150)
mel.connect_material_expressions(clamp, "", grad, "Base")
mel.connect_material_expressions(add(unreal.MaterialExpressionScalarParameter, -600, 300, parameter_name="Falloff",
                                     default_value=HALO_FALLOFF), "", grad, "Exp")
a1 = add(unreal.MaterialExpressionMultiply, -400, -100)
mel.connect_material_expressions(colour, "", a1, "A")
mel.connect_material_expressions(glow, "", a1, "B")
a2 = add(unreal.MaterialExpressionMultiply, -200, 0)
mel.connect_material_expressions(a1, "", a2, "A")
mel.connect_material_expressions(grad, "", a2, "B")
mel.connect_material_property(a2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
unreal.EditorAssetLibrary.save_loaded_asset(m, only_if_is_dirty=False)

light = next(a for a in eas.get_all_level_actors() if a.get_actor_label() == "AgentGlow")
at = light.get_actor_location() + unreal.Vector(*HALO_BEHIND_CM)
# The engine plane faces +Z; its +Z turns to -X, towards the person.
halo = eas.spawn_actor_from_object(unreal.load_asset("/Engine/BasicShapes/Plane"), at,
                                   unreal.MathLibrary.make_rot_from_z(unreal.Vector(-1.0, 0.0, 0.0)))
halo.set_actor_label("AgentHalo")
halo.set_editor_property("tags", [unreal.Name(TAG)])
halo.set_actor_scale3d(unreal.Vector(HALO_CM / 100.0, HALO_CM / 100.0, 1.0))
c = halo.static_mesh_component
c.set_material(0, m)
c.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
c.set_editor_property("cast_shadow", False)
c.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
result["halo"] = {"at": [round(at.x, 1), round(at.y, 1), round(at.z, 1)], "cm": HALO_CM, "glow": HALO_GLOW}
result["saved"] = les.save_current_level()
