# L3.2 content step (spark vr-table): the /Game/Maps/LightTable greybox level, through PoFScriptTools.run_python
# (Epic's SceneTools can load a level but not create one). Replayable: an existing LightTable map is deleted first.
# Run: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-look.jsonl, then
# level_gamemode.py (this step makes the map afresh, so its World Settings go with it).
#
# What it places (art-breakdown #1, lynx-plan L3.2). The table's near edge is its -X side; ABpGameMode stands the player
# there (no PlayerStart here on purpose), so the lights are laid out around that pose:
# - ABpTable at the origin (its origin is the floor under the table centre; it fetches nothing, BpLink hands it the plan)
# - a SpotLight under the glass pointing up: the table is the key light on hands, cool and from within (spark
#   vr-hands-zoom WP2; it was a warm-white RectLight, and under forward shading a RectLight lit nothing here, Lynx
#   2026-10-24, so both cool lights are spots)
# - a cool SpotLight high over the table, so the dark metal frame and legs read as near-black blue metal against the void
#   (the paper, the volumes and the labels are unlit and do not take it)
# - a small warm PointLight where the lamp agent will stand (beyond the far-left corner): a practical against the cool
#   table, its radius kept to the rim so it does not paint the legs gold (capture l33-2026-10-24-lynx.jpg)
# - a dim SkyLight so the studio is near-black, not black
# - fixed exposure, and bloom only above 1.0, so edges and the strip glow without smearing the text
# - a thin height fog that starts past the table: the void behind reads as a dark blue room, the sheet stays clear
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

# Rotator(roll, pitch, yaw): pitch 90 points the spot's +X straight up through the glass.
under = spawn(unreal.SpotLight, (0.0, 0.0, 70.0), (0.0, 90.0, 0.0), "TableUnderLight")
ul = under.get_component_by_class(unreal.SpotLightComponent)
ul.set_editor_property("intensity", 60.0)
ul.set_editor_property("outer_cone_angle", 70.0)
ul.set_editor_property("inner_cone_angle", 50.0)
ul.set_editor_property("source_radius", 40.0)
ul.set_editor_property("attenuation_radius", 200.0)
# #BFE8FF, the sheet's cyan-white
ul.set_editor_property("light_color", unreal.Color(r=191, g=232, b=255, a=255))

# Pitch -90: straight down onto the table from above the person's head.
fill = spawn(unreal.SpotLight, (-20.0, 0.0, 260.0), (0.0, -90.0, 0.0), "FrameFill")
fl = fill.get_component_by_class(unreal.SpotLightComponent)
fl.set_editor_property("intensity", 70.0)
fl.set_editor_property("outer_cone_angle", 50.0)
fl.set_editor_property("inner_cone_angle", 30.0)
fl.set_editor_property("source_radius", 40.0)
fl.set_editor_property("attenuation_radius", 400.0)
fl.set_editor_property("light_color", unreal.Color(r=90, g=125, b=200, a=255))

lamp = spawn(unreal.PointLight, (60.0, -110.0, 135.0), label="LampPractical")
pl = lamp.get_component_by_class(unreal.PointLightComponent)
pl.set_editor_property("intensity", 40.0)
pl.set_editor_property("attenuation_radius", 60.0)
pl.set_editor_property("source_radius", 4.0)
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
# No filmic tone curve: with it the paper's authored blue (#0B2A6B to #123A8C, the style block) came out as saturated
# #00056E at the corners (capture, 2026-10-24); without it an emissive colour shows as authored.
pps.set_editor_property("override_tone_curve_amount", True)
pps.set_editor_property("tone_curve_amount", 0.0)
# Bloom from 1.0 up: the paper and the text stay under it, the edges (M_EdgeGlow Intensity 1.4) and the strip go over.
pps.set_editor_property("override_bloom_threshold", True)
pps.set_editor_property("bloom_threshold", 1.0)
pps.set_editor_property("override_bloom_intensity", True)
pps.set_editor_property("bloom_intensity", 0.35)
ppv.set_editor_property("settings", pps)

fog = spawn(unreal.ExponentialHeightFog, (0.0, 0.0, 0.0), label="StudioFog")
fc = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
fc.set_editor_property("fog_density", 0.02)
fc.set_editor_property("fog_height_falloff", 0.5)
fc.set_editor_property("start_distance", 250.0)
fc.set_editor_property("fog_max_opacity", 0.6)
# style block 'studio' #0A0F18, a little lifted toward the sheet's blue
fc.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0.006, 0.010, 0.024, 1.0))

saved = les.save_current_level()
if not saved:
    # A second run in one editor session: the map deleted above is still "marked as deleted", so the new level has no
    # filename and SaveCurrentLevel refuses (Lynx, 2026-10-24); saving it under its path works.
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    saved = unreal.EditorLoadingAndSavingUtils.save_map(world, MAP)
result = {"map": MAP, "saved": saved,
          "actors": [a.get_actor_label() for a in eas.get_all_level_actors()]}
