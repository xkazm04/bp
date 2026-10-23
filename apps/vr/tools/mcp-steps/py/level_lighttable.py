# L3.2 content step (spark vr-table): the /Game/Maps/LightTable greybox level, through PoFScriptTools.run_python
# (Epic's SceneTools can load a level but not create one). Replayable: an existing LightTable map is deleted first.
# Run: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l32-content.jsonl
#
# What it places (art-breakdown #1, lynx-plan L3.2). The table's near edge is its -X side; ABpGameMode stands the player
# there (no PlayerStart here on purpose), so the lights are laid out around that pose:
# - ABpTable at the origin (its origin is the floor under the table centre; it fetches nothing, BpLink hands it the plan)
# - a RectLight under the glass pointing up: the table is the key light on hands (warm-white, soft, low)
# - a warm PointLight where the lamp agent will stand (far-left of the table): a practical against the cool table
# - a dim SkyLight so the studio is near-black, not black
import unreal

MAP = "/Game/Maps/LightTable"

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

if unreal.EditorAssetLibrary.does_asset_exist(MAP):
    les.new_level("/Temp/Untitled_bp")  # leave the map before deleting it
    unreal.EditorAssetLibrary.delete_asset(MAP)
les.new_level(MAP)


def spawn(cls, loc, rot=(0.0, 0.0, 0.0), label=None):
    actor = eas.spawn_actor_from_class(cls, unreal.Vector(*loc), unreal.Rotator(*rot))
    if label:
        actor.set_actor_label(label)
    return actor


table_cls = unreal.load_class(None, "/Script/bp.BpTable")
table = spawn(table_cls, (0.0, 0.0, 0.0), label="LightTable")

# Rotator(roll, pitch, yaw): pitch 90 points the rect light's +X straight up through the glass.
under = spawn(unreal.RectLight, (0.0, 0.0, 70.0), (0.0, 90.0, 0.0), "TableUnderLight")
rl = under.get_component_by_class(unreal.RectLightComponent)
rl.set_editor_property("intensity", 8.0)
rl.set_editor_property("source_width", 100.0)
rl.set_editor_property("source_height", 60.0)
rl.set_editor_property("attenuation_radius", 300.0)
rl.set_editor_property("light_color", unreal.Color(r=244, g=250, b=255, a=255))

lamp = spawn(unreal.PointLight, (40.0, -75.0, 140.0), label="LampPractical")
pl = lamp.get_component_by_class(unreal.PointLightComponent)
pl.set_editor_property("intensity", 60.0)
pl.set_editor_property("attenuation_radius", 250.0)
pl.set_editor_property("light_color", unreal.Color(r=255, g=181, b=71, a=255))

sky = spawn(unreal.SkyLight, (0.0, 0.0, 300.0), label="StudioAmbient")
sl = sky.get_component_by_class(unreal.SkyLightComponent)
sl.set_editor_property("intensity", 0.15)
sl.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
# Static capture: real-time capture needs a SkyAtmosphere or cloud and printed a warning over the first capture.
sl.set_editor_property("real_time_capture", False)

# Fixed exposure: in a near-black studio, auto exposure brightened the whole frame and washed the unlit paper out (first
# capture, 2026-10-23). Manual, no physical camera exposure, bias 0: an emissive of 1.0 shows as 1.0.
ppv = spawn(unreal.PostProcessVolume, (0.0, 0.0, 0.0), label="FixedExposure")
ppv.set_editor_property("unbound", True)
pps = ppv.get_editor_property("settings")
pps.set_editor_property("override_auto_exposure_method", True)
pps.set_editor_property("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL)
pps.set_editor_property("override_auto_exposure_apply_physical_camera_exposure", True)
pps.set_editor_property("auto_exposure_apply_physical_camera_exposure", False)
pps.set_editor_property("override_auto_exposure_bias", True)
pps.set_editor_property("auto_exposure_bias", 0.0)
ppv.set_editor_property("settings", pps)

saved = les.save_current_level()
result = {"map": MAP, "saved": saved,
          "actors": [a.get_actor_label() for a in eas.get_all_level_actors()]}
