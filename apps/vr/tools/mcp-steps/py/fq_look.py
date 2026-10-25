# Content step (spark vr-fidelity-40 FQ, elements 13, 14 and 15): a truly dark studio, lit only by its practical lamps,
# the window and the table, with thin volumetric fog in the air. After fp_look.py; then fid_bake.py (the room's albedo,
# its fill and the lights' bounce all change the bake). Replayable: every value is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fq-look.jsonl
#
# The judge, three rounds running: "a warm mid-grey with a lit wall". Measured in PIE at the target pose (the median of
# the back wall left of the agent, 0-255; the concept's is 18): 111 with FP's look. Of that, the table's rising veil
# (HazeTableRise, a 3 m additive plane standing on the table) was about 35, the volumetric fog lit by the baked light
# (its static-lighting scattering, which a dark room should not have) about 16, and the movable lights' scattering about
# 30; the wall's albedo almost nothing (the lightmap there is already dim). So:
# - the veil goes (Glow 0): real fog now carries the light in the air;
# - the fog is thinner and scatters only the lights that are meant to show in it (the agent's glow, the table's key and
#   fill), not the bake;
# - the sky light, the room fill and most of the window spill go; the practicals (desk lamp, pendants) stay;
# - the room shell's walls darker still (both wall kits at WALL_FACTOR) and the table's stationary lights bounce less
#   (INDIRECT), so the bake keeps only the lamps' pools and the table's spill;
# - the agent's halo disc (ff_agent.py) tighter and fainter: lit fog now glows around the orb, and the 80 cm disc painted
#   the wall behind the agent orange once the rest went dark (by capture).
import unreal

VEIL_GLOW = {"HazeTableRise": 0.0, "HazeRoomVeil": 0.0}  # fo_look.py 0.16, fp_look.py 0.0
FOG = {"fog_density": 0.05, "start_distance": 0.0, "volumetric_fog_static_lighting_scattering_intensity": 0.0}  # fp_look.py 0.2
SCATTER = {"AgentGlow": 300.0, "TableKey": 30.0, "FrameFill": 8.0, "AgentRim": 0.0, "AgentFront": 0.0, "HandRim": 0.0}
SKY_INTENSITY = 0.0      # 0.02
LIGHT_CD = {"RoomFill": 0.0, "WindowSpill": 8.0}  # fo_look.py 3, 25
INDIRECT = {"TableKey": 0.3, "FrameFill": 0.3, "WindowSpill": 0.5}
WALL_FACTOR = 0.06       # fp_look.py's back wall 0.25; the side wall joins it
HALO = {"cm": 40.0, "glow": 0.25}  # ff_agent.py 80, 0.4

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
les.load_level("/Game/Maps/LightTable")
result = {}


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


# ---- 1. The air -------------------------------------------------------------------------------------------------------
for label, glow in VEIL_GLOW.items():
    mi = unreal.load_asset("/Game/Bp/Materials/MI_" + label)
    mel.set_material_instance_scalar_parameter_value(mi, "Glow", glow)
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
fog = by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent)
for k, v in FOG.items():
    fog.set_editor_property(k, v)
fog.set_editor_property("enable_volumetric_fog", True)
for label, v in SCATTER.items():
    by_label(label).get_component_by_class(unreal.LightComponent).set_editor_property("volumetric_scattering_intensity", v)
result["air"] = {"veil": VEIL_GLOW, "fog": FOG, "scatter": SCATTER}

# ---- 2. The lights ------------------------------------------------------------------------------------------------------
sky = by_label("StudioAmbient").get_component_by_class(unreal.SkyLightComponent)
sky.set_editor_property("intensity", SKY_INTENSITY)
sky.set_editor_property("volumetric_scattering_intensity", 0.0)
for label, cd in LIGHT_CD.items():
    by_label(label).get_component_by_class(unreal.LightComponent).set_editor_property("intensity", cd)
for label, k in INDIRECT.items():
    by_label(label).get_component_by_class(unreal.LightComponent).set_editor_property("indirect_lighting_intensity", k)
result["lights"] = {"sky": SKY_INTENSITY, "cd": LIGHT_CD, "indirect": INDIRECT}

# ---- 3. The walls: both wall kits through override instances of the kit's own materials ---------------------------------
made = {}
for label, names in (("StudioWallKitBack", ("MI_WallKitBackDark", "MI_WallSheetsBackDark")), ("StudioWallKit", ("MI_WallKitSideDark", "MI_WallSheetsSideDark"))):
    wall = by_label(label).static_mesh_component
    for slot, name in enumerate(names):
        path = "/Game/Bp/Materials/" + name
        current = wall.get_material(slot)
        # The kit's own material is the parent, also on a re-run (where the slot already holds this override).
        parent = current.get_editor_property("parent") if current.get_name() == name else current
        if eal.does_asset_exist(path):
            mi = unreal.load_asset(path)
        else:
            mi = tools.create_asset(name, "/Game/Bp/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, parent)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColorFactor", unreal.LinearColor(WALL_FACTOR, WALL_FACTOR, WALL_FACTOR, 1.0))
        eal.save_loaded_asset(mi, only_if_is_dirty=False)
        wall.set_material(slot, mi)
        made[name] = parent.get_path_name()
result["walls"] = {"factor": WALL_FACTOR, "parents": made}

# ---- 4. The agent's halo ----------------------------------------------------------------------------------------------
halo = by_label("AgentHalo")
halo.set_actor_scale3d(unreal.Vector(HALO["cm"] / 100.0, HALO["cm"] / 100.0, 1.0))
hm = unreal.load_asset("/Game/Bp/Materials/M_AgentHalo")
for e in mel.get_material_expressions(hm):
    if isinstance(e, unreal.MaterialExpressionScalarParameter) and str(e.get_editor_property("parameter_name")) == "Glow":
        e.set_editor_property("default_value", HALO["glow"])
mel.recompile_material(hm)
eal.save_asset("/Game/Bp/Materials/M_AgentHalo", only_if_is_dirty=False)
result["halo"] = {"cm": HALO["cm"], "glow": mel.get_material_default_scalar_parameter_value(hm, "Glow")}
result["saved"] = les.save_current_level()
