# Content step (spark vr-fidelity-40 FY, elements 9 and 14): the level side of FW's lamp head and FZ's night city, after
# import_studio.py re-imports both (and the look steps after it). Then fid_bake.py. Replayable: every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fy-look.jsonl
#
# - AgentGlow to FW's light point, the lens face's centre + 4.5 cm along the opening (studio_level.py LAMP_LIGHT_LOCAL),
#   and the halo behind the head (ff_agent.py, placed from the light) by the same step, so the two keep their spacing.
# - The city's texture addresses Wrap: FZ's strip runs twice across the arc (UV u 0 to 2), so a Clamp would smear its
#   last column over the second half.
# - The city stays at the origin, yaw 90 (studio_level.py); this step reads that back.
import unreal

LAMP_LIGHT_LOCAL = (0.46, 2.36, 13.96)  # studio_level.py

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eal = unreal.EditorAssetLibrary
les.load_level("/Game/Maps/LightTable")
result = {}


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


def xyz(v):
    return [round(v.x, 2), round(v.y, 2), round(v.z, 2)]


agent = by_label("LampAgent")
glow = by_label("AgentGlow")
halo = by_label("AgentHalo")
at = agent.get_actor_transform().transform_location(unreal.Vector(*LAMP_LIGHT_LOCAL))
step = at - glow.get_actor_location()
glow.set_actor_location(at, False, False)
if halo:
    halo.set_actor_location(halo.get_actor_location() + step, False, False)
result["agent_glow"] = {"at": xyz(at), "moved": xyz(step), "halo": xyz(halo.get_actor_location()) if halo else None}

city = by_label("CityBackdrop")
ci = city.static_mesh_component.get_material(0)
textures = {}
for p in ci.get_editor_property("texture_parameter_values"):
    tex = p.get_editor_property("parameter_value")
    if not tex:
        continue
    tex.set_editor_property("address_x", unreal.TextureAddress.TA_WRAP)
    tex.set_editor_property("address_y", unreal.TextureAddress.TA_WRAP)
    eal.save_loaded_asset(tex, only_if_is_dirty=False)
    textures[str(p.get_editor_property("parameter_info").get_editor_property("name"))] = tex.get_path_name()
result["city"] = {"textures_wrap": textures, "loc": xyz(city.get_actor_location()), "yaw": round(city.get_actor_rotation().yaw, 2),
                  "EmissiveStrength": unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(ci, "EmissiveStrength")}
result["saved"] = les.save_current_level()
