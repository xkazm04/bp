# Content step (spark vr-fidelity-40 FC2, elements 1, 13, 14 and 15): light, reflections, glass and post on the forward
# VR path, after studio_level.py. r4-ue-fidelity.md section 7 is the order. Replayable on the map as it stands: every
# actor this step places carries the tag BpLook and is removed first; the settings it changes are set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fid-look.jsonl
#
# - The table's key is a rect light again, under the glass and the size of the paper, lighting the hands only: with r.Translucent.UsesRectLights
#   True (DefaultEngine.ini, FC2) the forward path lights with it (Substrate forward lighting skipped every rect light
#   without it; r4 section 1.1). It replaces the spot WP2 put there. Stationary, no shadow: the paper above it is the
#   light, not an occluder.
# - Reflections: one box capture for the room and one sphere at the table (r.ReflectionCaptureResolution 256). Without
#   them every glossy surface reflected only the black sky capture (r4 section 1.3).
# - The glass: a thin slab over the paper, translucent with surface forward shading, near-zero opacity and roughness
#   0.05, so the room, the lamp and the strip reflect in it. It draws before the labels and the card (sort priority -1).
# - Post: filmic back on; bloom 1.0 from 0.7 with the wide kernels raised; grain 0.07; vignette 0.3; no depth of field.
#   The paper's blue comes back through a grading LUT fitted from a neutral capture (fid_lut.py writes it), not by
#   switching the tone curve off.
# - Fog: volumetric fog on the height fog, with the practicals scattering into it (the window, the desk lamp and the
#   agent's light), measured against Local Fog Volumes in the FC2 report.
import unreal

TAG = "BpLook"
TABLE_TOP = 95.0
PAPER = (166.0, 76.0)  # ABpTable::PaperWidthCm (along Y), PaperDepthCm (along X)
PAPER_Z = TABLE_TOP - 0.8
KEY_CD = 6.0
KEY_X = -22.0  # the near third of the paper, under the hands
KEY_SIZE = (120.0, 30.0)
KEY_REACH = 45.0
KEY_Z = PAPER_Z - 15.0  # the light box's lamps: fingertips on the paper stay under the clip
# FrameFill (level_lighttable.py) was tuned for WP2's near-black frame; FA's aluminium frame and the posed hands are
# light, and under it they clipped white, so the overhead fill drops to FILL_CD. Its blue turned the warm skin grey, so
# it is a warm white now: the concept's hands are skin-toned on top and cyan only from the table below.
FILL_CD = 22.0
FILL_COLOUR = unreal.Color(r=255, g=238, b=222, a=255)
KEY_COLOUR = unreal.Color(r=150, g=215, b=255, a=255)  # #96D7FF: the concept's cyan under the fingers
# The captures see the glowing sheet from just above it; at brightness 1 the aluminium frame, the side desks and the
# glass mirrored it white (after the light build recaptured them, Lynx 2026-10-24). A quarter keeps the frame silver.
CAPTURE_BRIGHTNESS = 0.25
GLASS_CM = 0.4
GLASS_OPACITY = 0.06
# F0 = 0.08 x specular: at 0.5 the lamp agent's orb mirrored as a white disc in mid-sheet; the concept's reflection is faint.
GLASS_SPECULAR = 0.2
GLASS_ROUGHNESS = 0.08
LUT = "/Game/Bp/Look/T_FidGradeLUT"
BLOOM = {"intensity": 1.0, "threshold": 0.7}
BLOOM_WIDE = {4: (12.0, 0.6), 5: (40.0, 0.5), 6: (80.0, 0.35)}  # kernel: (size, tint) for the halo
GRAIN = 0.07
VIGNETTE = 0.3
FOG_VOLUMETRIC = True
FOG_DENSITY = 0.04
FOG_START = 180.0
# The agent's light is 0.2 cd (it must not burn the white shell), so its scattering is raised to show a halo in the haze.
FOG_SCATTER = {"WindowSpill": 2.0, "LampPractical": 4.0, "AgentGlow": 40.0, "TableKey": 0.0}

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
les.load_level("/Game/Maps/LightTable")
result = {}

for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags] or a.get_actor_label() == "TableUnderLight":
        eas.destroy_actor(a)


def tagged(actor, label):
    actor.set_actor_label(label)
    actor.set_editor_property("tags", [unreal.Name(TAG)])
    return actor


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


# 1. The rect key under the glass, facing up (pitch 90 turns the light's +X to +Z), under the near band of the paper
# where the hands are. Its lighting-channel mask did not hold (on channel 1 alone it still lit the frame, the desks and
# the glass, Lynx 2026-10-24), so its reach is cut by size and attenuation instead, and it has no specular: its
# highlight on the glass slab was a white disc mid-sheet.
key = tagged(eas.spawn_actor_from_class(unreal.RectLight, unreal.Vector(KEY_X, 0.0, KEY_Z), unreal.Rotator(0.0, 90.0, 0.0)), "TableKey")
kc = key.get_component_by_class(unreal.RectLightComponent)
kc.set_editor_property("mobility", unreal.ComponentMobility.STATIONARY)
kc.set_editor_property("intensity", KEY_CD)
kc.set_editor_property("source_width", KEY_SIZE[0])  # the light's Y stays world Y (along the paper's width)
kc.set_editor_property("source_height", KEY_SIZE[1])  # its Z turns onto world X (the paper's depth)
kc.set_editor_property("specular_scale", 0.0)
kc.set_editor_property("barn_door_angle", 88.0)
kc.set_editor_property("attenuation_radius", KEY_REACH)
kc.set_editor_property("cast_shadows", False)
kc.set_editor_property("light_color", KEY_COLOUR)
# Channel 1 only, which only the capture hands carry (studio_level.py): on channel 0 the key lit the frame, the desks and
# the glass's underside white (a white disc mid-sheet), as a light box's lamps cannot through its own walls.
kc.set_editor_property("lighting_channels", unreal.LightingChannels(channel0=False, channel1=True, channel2=False))
result["key"] = {"cd": KEY_CD, "x": KEY_X, "z": KEY_Z, "size": [kc.source_width, kc.source_height], "reach": KEY_REACH}

fill = by_label("FrameFill").get_component_by_class(unreal.LightComponent)
fill.set_editor_property("intensity", FILL_CD)
fill.set_editor_property("light_color", FILL_COLOUR)
# Its 40 cm source mirrored in the glass as a white disc in the middle of the sheet; a weak highlight keeps the glass's
# reflections to the room, the lamp and the strip.
fill.set_editor_property("specular_scale", 0.15)
result["fill_cd"] = FILL_CD

# The sky light (level_lighttable.py, 0.15, a static capture of the scene) sees the glowing sheet from above and lit
# every movable thing from all sides with it: the posed hands' backs read bright where the concept's are dark. The baked
# room carries its own bounce now, so the sky light drops to SKY.
SKY = 0.04
by_label("StudioAmbient").get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", SKY)
result["sky"] = SKY

# 2. Reflection captures.
box = tagged(eas.spawn_actor_from_class(unreal.BoxReflectionCapture, unreal.Vector(0.0, 0.0, 150.0)), "RoomReflection")
bc = box.get_component_by_class(unreal.BoxReflectionCaptureComponent)
box.set_actor_scale3d(unreal.Vector(2.5, 3.0, 1.5))  # the 500 x 600 x 300 cm room (the box is 200 cm a side at scale 1)
bc.set_editor_property("box_transition_distance", 60.0)
bc.set_editor_property("brightness", CAPTURE_BRIGHTNESS)
sphere = tagged(eas.spawn_actor_from_class(unreal.SphereReflectionCapture, unreal.Vector(0.0, 0.0, TABLE_TOP + 40.0)), "TableReflection")
sc = sphere.get_component_by_class(unreal.SphereReflectionCaptureComponent)
sc.set_editor_property("influence_radius", 220.0)
sc.set_editor_property("brightness", CAPTURE_BRIGHTNESS)

# 3. The glass slab: an engine cube scaled to the paper, GLASS_CM thick, its underside just over the paper.
glass_path = "/Game/Bp/Materials/M_TableGlass"
if unreal.EditorAssetLibrary.does_asset_exist(glass_path):
    gm = unreal.load_asset(glass_path)
    for old in list(mel.get_material_expressions(gm)):
        mel.delete_material_expression(gm, old)
else:
    gm = tools.create_asset("M_TableGlass", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
gm.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
gm.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING)


def param(m, name, value, x, y):
    if isinstance(value, unreal.LinearColor):
        e = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, x, y)
    else:
        e = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, x, y)
    e.set_editor_property("parameter_name", name)
    e.set_editor_property("default_value", value)
    return e


mel.connect_material_property(param(gm, "BaseColor", unreal.LinearColor(0.02, 0.03, 0.05, 1.0), -400, -200), "", unreal.MaterialProperty.MP_BASE_COLOR)
mel.connect_material_property(param(gm, "Roughness", GLASS_ROUGHNESS, -400, 0), "", unreal.MaterialProperty.MP_ROUGHNESS)
mel.connect_material_property(param(gm, "Specular", GLASS_SPECULAR, -400, 100), "", unreal.MaterialProperty.MP_SPECULAR)
mel.connect_material_property(param(gm, "Opacity", GLASS_OPACITY, -400, 200), "", unreal.MaterialProperty.MP_OPACITY)
mel.recompile_material(gm)
unreal.EditorAssetLibrary.save_loaded_asset(gm, only_if_is_dirty=False)
glass = tagged(eas.spawn_actor_from_object(unreal.load_asset("/Engine/BasicShapes/Cube"),
                                           unreal.Vector(0.0, 0.0, PAPER_Z + 0.05 + GLASS_CM / 2)), "TableGlass")
glass.set_actor_scale3d(unreal.Vector(PAPER[1] / 100.0, PAPER[0] / 100.0, GLASS_CM / 100.0))
g = glass.static_mesh_component
g.set_material(0, gm)
g.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
g.set_editor_property("cast_shadow", False)
g.set_editor_property("translucency_sort_priority", -1)
g.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)

# 4. Post. The grading LUT (256 x 16) is fitted by scripts/lookdev/fit_grade_lut.py --model excess from a neutral capture
# (filmic on, no LUT) to the concept on matching regions: docs/concepts/vr-light-table/lookdev/grade/ holds the capture,
# the regions, the fit and the LUT.
REPO = __import__("os").path.abspath(__import__("os").path.join(unreal.Paths.project_dir(), "..", ".."))
LUT_SOURCE = __import__("os").path.join(REPO, "docs", "concepts", "vr-light-table", "lookdev", "grade", "fid-grade-lut.png")
task = unreal.AssetImportTask()
task.filename = LUT_SOURCE
task.destination_path = LUT.rsplit("/", 1)[0]
task.destination_name = LUT.rsplit("/", 1)[1]
task.automated = True
task.replace_existing = True
task.save = True
tools.import_asset_tasks([task])
lut_tex = unreal.load_asset(LUT)
lut_tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_COLOR_LOOKUP_TABLE)
lut_tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
lut_tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
unreal.EditorAssetLibrary.save_loaded_asset(lut_tex, only_if_is_dirty=False)

ppv = by_label("FixedExposure")
pps = ppv.get_editor_property("settings")
pps.set_editor_property("override_tone_curve_amount", True)
pps.set_editor_property("tone_curve_amount", 1.0)
pps.set_editor_property("override_bloom_intensity", True)
pps.set_editor_property("bloom_intensity", BLOOM["intensity"])
pps.set_editor_property("override_bloom_threshold", True)
pps.set_editor_property("bloom_threshold", BLOOM["threshold"])
for k, (size, tint) in BLOOM_WIDE.items():
    pps.set_editor_property("override_bloom%d_size" % k, True)
    pps.set_editor_property("bloom%d_size" % k, size)
    pps.set_editor_property("override_bloom%d_tint" % k, True)
    pps.set_editor_property("bloom%d_tint" % k, unreal.LinearColor(tint, tint, tint, 1.0))
pps.set_editor_property("override_film_grain_intensity", True)
pps.set_editor_property("film_grain_intensity", GRAIN)
pps.set_editor_property("override_vignette_intensity", True)
pps.set_editor_property("vignette_intensity", VIGNETTE)
if unreal.EditorAssetLibrary.does_asset_exist(LUT):
    pps.set_editor_property("override_color_grading_lut", True)
    pps.set_editor_property("color_grading_lut", unreal.load_asset(LUT))
    pps.set_editor_property("override_color_grading_intensity", True)
    pps.set_editor_property("color_grading_intensity", 1.0)
else:
    pps.set_editor_property("override_color_grading_lut", False)
ppv.set_editor_property("settings", pps)
result["lut"] = unreal.EditorAssetLibrary.does_asset_exist(LUT)

# 5. Fog.
fog = by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent)
# Denser and nearer than WP2's (0.02 from 250 cm), so the room behind the table hazes as the concept's does; it still
# starts past the sheet's far edge from the eye.
fog.set_editor_property("fog_density", FOG_DENSITY)
fog.set_editor_property("start_distance", FOG_START)
fog.set_editor_property("enable_volumetric_fog", FOG_VOLUMETRIC)
fog.set_editor_property("volumetric_fog_scattering_distribution", 0.4)
fog.set_editor_property("volumetric_fog_extinction_scale", 1.0)
fog.set_editor_property("volumetric_fog_distance", 900.0)
fog.set_editor_property("volumetric_fog_albedo", unreal.Color(r=200, g=210, b=230, a=255))
for label, scatter in FOG_SCATTER.items():
    a = by_label(label)
    if a:
        a.get_component_by_class(unreal.LightComponent).set_editor_property("volumetric_scattering_intensity", scatter)
result["fog"] = {"volumetric": fog.get_editor_property("enable_volumetric_fog"), "scatter": FOG_SCATTER}

result["saved"] = les.save_current_level()
result["actors"] = sorted(a.get_actor_label() for a in eas.get_all_level_actors() if TAG in [str(t) for t in a.tags])
