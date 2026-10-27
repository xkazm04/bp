# Content step (spark vr-fidelity-40 FO, elements 4, 13 and 15): crisper glass under less bloom, a darker studio in which
# the table is the main light, and a little more haze. After fm_look.py; then fid_bake.py (RoomFill is static, and the
# lamp agent's baked bounce is fid_bake.py's EMISSIVE_BOOST). Replayable: every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fo-look.jsonl
#
# - Bloom lower, its wide kernels much fainter: the judge's rooms "wash out in their own glow" (fk_look.py's 1.5 and
#   0.8/0.75/0.55 summed every wall's halo into slabs). The threshold stays, so the sheet's text does not bloom.
# - RoomFill, the window's spill and the agent's movable glow lower: the back wall's warm mauve (the judge, element 13)
#   was the agent's light and its bounce on the wall, over the blue fill and spill (by capture: the wall kept its mauve
#   with every movable light off, so the baked fill and spill carry it).
# - Height fog denser and the table's rising haze a little brighter: "air too clean" (element 15).
import unreal

BLOOM = {"intensity": 0.8, "threshold": 0.7}
BLOOM_TINT = {4: 0.5, 5: 0.25, 6: 0.12}  # fk_look.py: 0.8, 0.75, 0.55 (sizes kept)
ROOM_FILL_CD = 3.0      # fm_look.py 9
WINDOW_SPILL_CD = 25.0  # studio_level.py 40
AGENT_GLOW_CD = 0.1     # ff_agent.py 0.2
FOG_DENSITY = 0.16      # fm_look.py 0.12
VEIL_GLOW = {"HazeTableRise": 0.16, "HazeRoomVeil": 0.035}  # fm_look.py 0.13, 0.05

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
les.load_level("/Game/Maps/LightTable")
result = {}


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


ppv = by_label("FixedExposure")
pps = ppv.settings
pps.set_editor_property("override_bloom_intensity", True)
pps.set_editor_property("bloom_intensity", BLOOM["intensity"])
pps.set_editor_property("override_bloom_threshold", True)
pps.set_editor_property("bloom_threshold", BLOOM["threshold"])
for k, tint in BLOOM_TINT.items():
    pps.set_editor_property("override_bloom%d_tint" % k, True)
    pps.set_editor_property("bloom%d_tint" % k, unreal.LinearColor(tint, tint, tint, 1.0))
ppv.set_editor_property("settings", pps)
result["bloom"] = {"bloom": BLOOM, "tints": BLOOM_TINT}

by_label("RoomFill").get_component_by_class(unreal.LightComponent).set_editor_property("intensity", ROOM_FILL_CD)
by_label("WindowSpill").get_component_by_class(unreal.LightComponent).set_editor_property("intensity", WINDOW_SPILL_CD)
by_label("AgentGlow").get_component_by_class(unreal.LightComponent).set_editor_property("intensity", AGENT_GLOW_CD)
by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent).set_editor_property("fog_density", FOG_DENSITY)
result["room"] = {"room_fill_cd": ROOM_FILL_CD, "window_spill_cd": WINDOW_SPILL_CD, "agent_glow_cd": AGENT_GLOW_CD, "fog_density": FOG_DENSITY}

for label, glow in VEIL_GLOW.items():
    mi = unreal.load_asset("/Game/Bp/Materials/MI_" + label)
    mel.set_material_instance_scalar_parameter_value(mi, "Glow", glow)
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
result["veils"] = VEIL_GLOW
result["saved"] = les.save_current_level()
