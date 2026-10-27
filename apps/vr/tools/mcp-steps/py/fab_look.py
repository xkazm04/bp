# Content step (spark vr-fidelity-40 FAB, elements 13 and 15): the judges' "studio too warm and bright on the left" and
# "almost no haze". After fy_look.py; then fid_bake.py (LampPractical is static, so its change needs the bake).
# Replayable: every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fab-look.jsonl
#
# Measured in PIE at the target pose (fab/a*, b*: mean 0-255 of the top-left 600 x 300, the shelves and the desk lamp):
# 62 with FR's shelf wash, 51 with the shelf spots at 1.5 cd on 18-degree cones and the shelf bulbs at 0.15 cd. The desk
# lamp's cone keeps its pool on the desk but smaller and dimmer, and the baked desk-lamp point (LampPractical) drops too,
# so the table is the room's main light and the warm pools stay small.
#
# The air: FQ's lesson stands (the fog scatters no static light, so the bake never greys the walls; scattering only on
# chosen lights). The fog's density is unchanged: at 0.16 every lit light scattered and the wall behind the agent went
# from 57 to 108. The frame's fill scattered over the whole room (it alone lifted the left 19 and the walls 17, fab/d4),
# so it scatters nothing now; two air lights (AIR) carry the haze where the concept has it instead.
import unreal

# label: {property: value}; cone angles in degrees, intensities in the light's own units (candelas here).
LIGHTS = {
    "ShelfPool1": {"intensity": 1.5, "outer_cone_angle": 18.0, "inner_cone_angle": 6.0},   # fr_look.py 4 cd, 26/8
    "ShelfPool2": {"intensity": 1.5, "outer_cone_angle": 18.0, "inner_cone_angle": 6.0},
    "ShelfBulbLight1": {"intensity": 0.15},                                                 # fr_look.py 0.5
    "ShelfBulbLight2": {"intensity": 0.15},
    "DeskLampCone": {"intensity": 8.0, "outer_cone_angle": 30.0, "volumetric_scattering_intensity": 14.0},  # fr_look.py 15 cd, 38, 6
    "LampPractical": {"intensity": 7.0},                                                    # 10 (static, baked)
    "TableKey": {"volumetric_scattering_intensity": 30.0},                                  # fq_look.py 30 (a rect light: 90 showed nothing, fab/d5)
    "FrameFill": {"volumetric_scattering_intensity": 0.0},                                  # fq_look.py 8
}
# The air lights (tag FabAir, removed first): movable, all but invisible on surfaces (a tenth of a candela or less) and
# scattering thousands of times that into the fog (at 300 neither showed, fab/e), so they show as soft air where they stand and light nothing else (AgentGlow's
# way, ff_agent.py). label: (at, aim, cd, scatter, outer, inner, radius, colour)
AIR = {
    # Up from under the paper's centre: the air over the table glow (the paper is emissive, and emissive surfaces do not
    # scatter into the fog; TableKey is a rect light, whose scattering showed nothing here).
    # From 35 cm under the paper (at the paper, the air just above its source lit as a hot spot mid-table; fab/f2); 0.35
    # cd veiled the far half and tinted the back wall blue (fab/g3).
    "TableAir": ((0.0, 0.0, 60.0), (0.0, 0.0, 200.0), 0.2, 1500.0, 55.0, 25.0, 170.0, (110, 185, 255)),
    # Down the desk lamp's cone (fr_look.py DeskLampCone): its shaft in the air.
    "DeskLampAir": ((113.0, -100.0, 104.0), (100.0, -95.0, 75.0), 0.05, 3000.0, 30.0, 12.0, 60.0, (255, 190, 120)),
}
AIR_TAG = "FabAir"

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level("/Game/Maps/LightTable")
result = {}
actors = {a.get_actor_label(): a for a in eas.get_all_level_actors()}
for label, props in LIGHTS.items():
    c = actors[label].get_component_by_class(unreal.LightComponent)
    for k, v in props.items():
        c.set_editor_property(k, v)
    result[label] = {k: round(c.get_editor_property(k), 3) for k in props}
for a in eas.get_all_level_actors():
    if AIR_TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)
ML = unreal.MathLibrary
air = {}
for label, (at, aim, cd, scatter, outer, inner, radius, colour) in AIR.items():
    loc = unreal.Vector(*at)
    a = eas.spawn_actor_from_class(unreal.SpotLight, loc, ML.find_look_at_rotation(loc, unreal.Vector(*aim)))
    a.set_actor_label(label)
    a.tags = [unreal.Name(AIR_TAG)]
    c = a.get_component_by_class(unreal.SpotLightComponent)
    c.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    c.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    c.set_editor_property("intensity", cd)
    c.set_editor_property("volumetric_scattering_intensity", scatter)
    c.set_editor_property("outer_cone_angle", outer)
    c.set_editor_property("inner_cone_angle", inner)
    c.set_editor_property("attenuation_radius", radius)
    c.set_editor_property("light_color", unreal.Color(r=colour[0], g=colour[1], b=colour[2], a=255))
    c.set_editor_property("cast_shadows", False)
    c.set_editor_property("affects_world", True)
    air[label] = {"cd": cd, "scatter": scatter}
result["air"] = air
result["saved"] = les.save_current_level()
