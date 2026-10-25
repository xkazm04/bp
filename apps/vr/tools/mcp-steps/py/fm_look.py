# Content step (spark vr-fidelity-40 FM, elements 13, 14 and 15; the judge's lever 4): a darker studio in which the
# table is the main light, more haze in depth, and a brighter city. After fk_city.py (and fk_look.py, whose veils it
# re-tunes); then fid_bake.py (RoomFill and the sky light are static). Replayable: every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fm-look.jsonl
#
# - RoomFill, the desk lamp and the sky light lower: the judge, "drop the room's ambient light so the table is the main light source".
# - Height fog denser (its volumetric fog was on since FC2): the owner now lets haze cost frame time (2026-10-25).
# - The haze veils brighter: the sheet's light in the air over the table and the haze behind the lamp agent.
# - The city a little brighter, so the night windows read beside the darker room.
import unreal

ROOM_FILL_CD = 9.0      # FK 22, studio_level.py 40
SKY = 0.02              # fid_look.py 0.04
FOG_DENSITY = 0.12      # FK 0.06
VEIL_GLOW = {"HazeTableRise": 0.13, "HazeRoomVeil": 0.05}  # FK 0.09, 0.035
CITY_EMISSIVE = 16.0    # fg_holo.py 12
DESK_LAMP_CD = 10.0     # studio_level.py 20: the warm pool on the left desk and shelves

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
les.load_level("/Game/Maps/LightTable")
result = {}


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


by_label("RoomFill").get_component_by_class(unreal.LightComponent).set_editor_property("intensity", ROOM_FILL_CD)
by_label("StudioAmbient").get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", SKY)
by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent).set_editor_property("fog_density", FOG_DENSITY)
by_label("LampPractical").get_component_by_class(unreal.LightComponent).set_editor_property("intensity", DESK_LAMP_CD)
result["room"] = {"room_fill_cd": ROOM_FILL_CD, "sky": SKY, "fog_density": FOG_DENSITY, "desk_lamp_cd": DESK_LAMP_CD}

for label, glow in VEIL_GLOW.items():
    mi = unreal.load_asset("/Game/Bp/Materials/MI_" + label)
    mel.set_material_instance_scalar_parameter_value(mi, "Glow", glow)
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
result["veils"] = VEIL_GLOW

ci = by_label("CityBackdrop").static_mesh_component.get_material(0)
mel.set_material_instance_scalar_parameter_value(ci, "EmissiveStrength", CITY_EMISSIVE)
eal.save_loaded_asset(ci, only_if_is_dirty=False)
result["city"] = CITY_EMISSIVE
result["saved"] = les.save_current_level()
