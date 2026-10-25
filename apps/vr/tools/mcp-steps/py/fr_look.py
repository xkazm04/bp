# Content step (spark vr-fidelity-40 FR, elements 13 and 15): the dark studio dressed. After fq_look.py; then fid_bake.py.
# Replayable: every actor this step places carries the tag FrPractical and is removed first; every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fr-look.jsonl
#
# The judges on FQ's dark studio: "almost empty: one desk lamp and a board, none of the shelves, pinned drawings or warm
# detail". The shelves, their books and the pinned drawings were in the frame all along (the target pose sees the back
# wall from about 0.3 to 1.3 m up), only unlit: FQ's dark room kept the desk lamp's pool and the table's spill. The
# concept's studio is dark AND dressed: warm practical pools on the shelves, the drawings and the right desk against
# near-black walls. So, on the room's lighting channel only (never the table, the hands or the agent):
# - a narrow warm spot from above onto each shelf unit, one onto the pinned drawings behind the agent and one onto the
#   right desk's mug and tubes; stationary, so they keep their specular highlights (a static light has none) and scatter
#   into the volumetric fog (FQ: no static-light scattering), each by SCATTER, so their cones show in the air;
# - a cone under the desk lamp's shade (DeskLampCone), the concept's lamp pool with a visible shaft;
# - two small warm bulbs on the shelves (an emissive sphere and a point light), the concept's shelf practicals.
# The back wall between them stays dark (FQ's median 26 on the wall left of the agent; by capture).
import unreal

TAG = "FrPractical"
WARM = (255, 180, 110)
# label: (from, aim, cd, outer, inner, radius, shadows, colour)
SPOTS = {
    "ShelfPool1": ((190.0, -140.0, 200.0), (234.0, -140.0, 80.0), 4.0, 26.0, 8.0, 260.0, True, WARM),
    "ShelfPool2": ((190.0, -235.0, 200.0), (234.0, -235.0, 70.0), 4.0, 26.0, 8.0, 260.0, True, WARM),
    "DrawingsPool": ((200.0, -40.0, 190.0), (247.0, -40.0, 100.0), 8.0, 20.0, 6.0, 220.0, False, (255, 200, 140)),
    "RightDeskPool": ((110.0, 140.0, 135.0), (85.0, 110.0, 75.0), 8.0, 40.0, 15.0, 160.0, False, (255, 185, 115)),
    # Under the desk lamp's shade (studio_level.py: LampPractical at the lamp's head), onto the left desk.
    "DeskLampCone": ((113.0, -100.0, 104.0), (100.0, -95.0, 75.0), 15.0, 38.0, 18.0, 150.0, True, (255, 190, 120)),
}
SCATTER = {"ShelfPool1": 3.0, "ShelfPool2": 3.0, "DrawingsPool": 2.0, "RightDeskPool": 0.0, "DeskLampCone": 6.0}
# The shelf bulbs: in front of the books, on the first unit's middle shelf and the second's lower one.
BULBS = [(212.0, -160.0, 104.0), (212.0, -215.0, 60.0)]
BULB_CM = 3.0
BULB_CD = 0.5
BULB_RADIUS = 80.0
BULB_COLOUR = (255, 170, 90)
BULB_MAT = "/Game/Bp/Art/StudioArchitecture/final/Materials/bulb_glow"  # the pendants' bulbs (import_studio.py)

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
ML = unreal.MathLibrary
les.load_level("/Game/Maps/LightTable")
ROOM_ONLY = unreal.LightingChannels(channel0=False, channel1=False, channel2=True)
result = {}

removed = 0
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)
        removed += 1
result["removed"] = removed


def place(actor, label):
    actor.set_actor_label(label)
    actor.tags = [unreal.Name(TAG)]
    return actor


def setup(c, cd, radius, colour, shadows, scatter):
    c.set_editor_property("mobility", unreal.ComponentMobility.STATIONARY)
    c.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    c.set_editor_property("intensity", cd)
    c.set_editor_property("attenuation_radius", radius)
    c.set_editor_property("light_color", unreal.Color(r=colour[0], g=colour[1], b=colour[2], a=255))
    c.set_editor_property("cast_shadows", shadows)
    c.set_editor_property("volumetric_scattering_intensity", scatter)
    c.set_editor_property("lighting_channels", ROOM_ONLY)
    c.set_editor_property("source_radius", 2.0)


spots = {}
for label, (frm, aim, cd, outer, inner, radius, shadows, colour) in SPOTS.items():
    loc = unreal.Vector(*frm)
    a = place(eas.spawn_actor_from_class(unreal.SpotLight, loc, ML.find_look_at_rotation(loc, unreal.Vector(*aim))), label)
    c = a.get_component_by_class(unreal.SpotLightComponent)
    setup(c, cd, radius, colour, shadows, SCATTER[label])
    c.set_editor_property("outer_cone_angle", outer)
    c.set_editor_property("inner_cone_angle", inner)
    spots[label] = {"cd": cd, "cone": [outer, inner], "scatter": SCATTER[label], "shadows": shadows}
result["spots"] = spots

sphere = unreal.load_asset("/Engine/BasicShapes/Sphere")
glow = unreal.load_asset(BULB_MAT)
for i, at in enumerate(BULBS):
    loc = unreal.Vector(*at)
    bulb = place(eas.spawn_actor_from_object(sphere, loc, unreal.Rotator(0.0, 0.0, 0.0)), "ShelfBulb%d" % (i + 1))
    s = BULB_CM / 100.0  # the engine sphere is 100 cm across
    bulb.set_actor_scale3d(unreal.Vector(s, s, s))
    smc = bulb.static_mesh_component
    smc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)  # no lightmap for an emissive bead
    smc.set_material(0, glow)
    smc.set_editor_property("cast_shadow", False)
    light = place(eas.spawn_actor_from_class(unreal.PointLight, loc), "ShelfBulbLight%d" % (i + 1))
    setup(light.get_component_by_class(unreal.PointLightComponent), BULB_CD, BULB_RADIUS, BULB_COLOUR, False, 0.0)
result["bulbs"] = {"at": BULBS, "cd": BULB_CD}
result["saved"] = les.save_current_level()
