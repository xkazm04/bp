# L4.2 content step (spark vr-hands-zoom WP5): the studio around the table in /Game/Maps/LightTable, after
# import_studio.py (art-breakdown rows 9, 13, 14 and 15; lookdev 00-hero and 01-l0-rest). Replayable on the map as it
# stands: every actor this step places carries the tag BpStudio and is removed first, and the shell mesh is merged anew.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-studio.jsonl
#
# World axes are the table's (level_lighttable.py): the table stands at the origin, its near edge on -X (the player), its
# far edge at X = +45, its length along Y (+Y is the player's right), its top at 95 cm. Placements name their yaw from
# the imported asset's axes:
# - the studio GLBs face Blender -Y, which Interchange (glTF Y-up to UE Z-up) lands on UE -Y: yaw -90 turns a prop on the
#   back wall towards the room (-X); studio-pinned-drawings is the exception, its sheets face Blender +Y, so it takes
#   yaw 90 (seen from the room on Lynx, 2026-10-24: at -90 only the navy board showed);
# - city-backdrop's arc lies on UE -Y about its pivot, so yaw 90 puts it behind the back wall (+X), pivot at the table's;
# - lamp-agent's shade reaches along UE +Y and its clamp bar sits at Y = -5.8 cm, so yaw 90 would point the shade
#   straight at the player with the clamp on the far edge; yaw 70 turns it 20 degrees to the player's right, so the arm
#   reads in profile as the concept's does (the clamp bar lands 0.35 cm inside the edge line).
#
# It also takes out the doubled lights: level_lighttable.py ran twice in one editor session on 2026-10-24 and the map held
# two of every light, fog, sky light and exposure volume (WP3 removed only the second table). One of each stays. Two
# coincident spots or point lights add, so the kept one carries the sum (the look WP2 was tuned under); one sky light, one
# height fog and one unbound volume with the same settings render as the pair did (only one of each is used), so they keep
# their values.
import unreal

MAP = "/Game/Maps/LightTable"
TAG = "BpStudio"
TABLE_TOP = 95.0  # ABpTable::DefaultTableHeightCm
FAR_EDGE_X = 45.0  # ABpTable::TableDepthCm / 2

# The room: about 6 x 5 m and 3 m high, the table near its centre; walls are 10 cm boxes outside these planes.
ROOM_X = (-250.0, 250.0)
ROOM_Y = (-300.0, 300.0)
ROOM_H = 300.0
WALL = 10.0
# One tall window in the back wall, right of the table's centre line as in the concept, where the city shows through.
WINDOW_Y = (40.0, 190.0)
WINDOW_Z = (20.0, 280.0)
MULLION = 5.0
STUDIO = "#0A0F18"  # style block 'studio'
STUDIO_ROUGHNESS = 0.7
DESK = "#14110F"  # the side desks: a dark stained top a step above the walls
DESK_ROUGHNESS = 0.5
# Side desks behind the table's far corners (centre x, centre y, size x, size y, top height).
LEFT_DESK = (95.0, -150.0, 60.0, 110.0, 75.0)
RIGHT_DESK = (100.0, 150.0, 60.0, 110.0, 75.0)

# Lights. The doubled ones (candela), summed: 2 x 60, 2 x 70, 2 x 40.
UNDER_CD = 120.0
FILL_CD = 140.0
WARM = unreal.Color(r=255, g=181, b=71, a=255)  # amber #FFB547, the attention colour
DESK_LAMP_CD = 20.0
DESK_LAMP_RADIUS = 120.0
AGENT_GLOW_CD = 12.0
AGENT_GLOW_RADIUS = 70.0
WINDOW_CD = 40.0
WINDOW_RADIUS = 700.0
COOL_SPILL = unreal.Color(r=90, g=125, b=200, a=255)  # FrameFill's blue: city glow through the window
ROOM_FILL_CD = 40.0
ROOM_FILL_RADIUS = 600.0
ROOM_GREY = unreal.Color(r=150, g=165, b=190, a=255)  # a grey-blue night, not the table's cyan
# Lighting channels keep the room's light off the table and the table's light off the lamp agent: 0 is the table's (and
# every default), 2 the room's (RoomFill lights the walls and the props, never the frame or the hands). The lamp agent is
# on the room's channel only: on 0, TableUnderLight (the spot under the glass) lit it from below cyan-white and FrameFill
# from above, and its navy arm read silver (Lynx, 2026-10-24); its head glows by its own emission.
TABLE, ROOM = (True, False, False), (False, False, True)

# lamp-agent: clamped on the far rim (its pivot is the base disc underside, the clamp grips 5.8 cm behind it). Its static
# pose is A_LampAgent_TablePose, made here from the bones: the rotation of lower_arm, upper_arm and head about the
# armature X axis, in degrees from the rest pose, as scripts/art/lamp/poses.json writes its actions. 'working' (44, -1,
# -24) hangs the shade over the far part of the paper (head bone 28 cm in, 27 cm up); the head turned a further 51 degrees
# shows the warm interior to the person at the near edge, as the concept's head does.
LAMP_CLAMP_CM = 5.8
LAMP_Y = 5.0
LAMP_YAW = 70.0
LAMP_POSE_DEG = {"lower_arm": 44.0, "upper_arm": -1.0, "head": -75.0}
LAMP_POSE = "/Game/Bp/Art/LampAgent/A_LampAgent_TablePose"
LAMP_POSE_FROM = "/Game/Bp/Art/LampAgent/SK_LampAgentlamp-agent_rig_working"

ART = "/Game/Bp/Art/"
MESHES = {
    "shelves": ART + "StudioShelves/final/StaticMeshes/SM_StudioShelves",
    "drawings": ART + "StudioPinnedDrawings/final/StaticMeshes/SM_StudioPinnedDrawings",
    "desk_lamp": ART + "StudioDeskLamp/final/StaticMeshes/SM_StudioDeskLamp",
    "tubes": ART + "StudioDrawingTubes/final/StaticMeshes/SM_StudioDrawingTubes",
    "mug": ART + "StudioMug/final/StaticMeshes/SM_StudioMug",
    "backdrop": ART + "CityBackdrop/final/StaticMeshes/SM_CityBackdrop",
}
# label, mesh, location, yaw. The second shelf unit costs no draw: the engine instances the two identical meshes into
# the same draws (target pose, CSV profiler: 37 base-pass draws with one unit or two, Lynx 2026-10-24).
PROPS = [
    ("StudioShelves", "shelves", (ROOM_X[1] - 16.0, -140.0, 0.0), -90.0),
    ("StudioShelves2", "shelves", (ROOM_X[1] - 16.0, -235.0, 0.0), -90.0),
    ("StudioPinnedDrawings", "drawings", (ROOM_X[1] - 3.0, -40.0, 80.0), 90.0),
    ("StudioDeskLamp", "desk_lamp", (LEFT_DESK[0] + 10.0, LEFT_DESK[1] + 35.0, LEFT_DESK[4]), 150.0),
    ("StudioDrawingTubes", "tubes", (RIGHT_DESK[0] + 15.0, RIGHT_DESK[1] + 30.0, RIGHT_DESK[4]), 0.0),
    ("StudioMug", "mug", (RIGHT_DESK[0] - 15.0, RIGHT_DESK[1] - 35.0, RIGHT_DESK[4]), 200.0),
    ("CityBackdrop", "backdrop", (0.0, 0.0, 0.0), 90.0),
]

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
les.load_level(MAP)
result = {"map": MAP}


def srgb(h):
    def channel(c):
        c = int(c, 16) / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return unreal.LinearColor(channel(h[1:3]), channel(h[3:5]), channel(h[5:7]), 1.0)


# 1. One of each doubled actor; the kept spot and point lights carry the pair's sum.
by_label = {}
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        continue
    by_label.setdefault(a.get_actor_label(), []).append(a)
removed = []
for label, actors in by_label.items():
    if label == "LightTable" or len(actors) < 2:
        continue
    actors.sort(key=lambda a: a.get_name())
    for extra in actors[1:]:
        removed.append(extra.get_name())
        eas.destroy_actor(extra)
result["removed"] = removed


def light(label):
    actor = by_label[label][0]
    return actor, actor.get_component_by_class(unreal.LightComponent)


_, under = light("TableUnderLight")
under.set_editor_property("intensity", UNDER_CD)
_, fill = light("FrameFill")
fill.set_editor_property("intensity", FILL_CD)

# 2. Last run's studio out.
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)


def tagged(actor, label):
    actor.set_actor_label(label)
    actor.set_editor_property("tags", [unreal.Name(TAG)])
    return actor


def channels(*sets):
    on = [any(x[i] for x in sets) for i in range(3)]  # channels 0, 1, 2
    return unreal.LightingChannels(channel0=on[0], channel1=on[1], channel2=on[2])


# 3. M_Studio and its two instances: lit, flat colour, a little roughness.
def studio_material():
    path = "/Game/Bp/Materials/M_Studio"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        m = unreal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
    else:
        m = tools.create_asset("M_Studio", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
    colour = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -400, -100)
    colour.set_editor_property("parameter_name", "BaseColor")
    colour.set_editor_property("default_value", srgb(STUDIO))
    rough = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -400, 100)
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", STUDIO_ROUGHNESS)
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m, only_if_is_dirty=False)
    out = {}
    for name, hexcolour, roughness in (("MI_StudioShell", STUDIO, STUDIO_ROUGHNESS), ("MI_StudioDesk", DESK, DESK_ROUGHNESS)):
        p = "/Game/Bp/Materials/" + name
        mi = unreal.load_asset(p) if unreal.EditorAssetLibrary.does_asset_exist(p) else tools.create_asset(
            name, "/Game/Bp/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, m)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", srgb(hexcolour))
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", roughness)
        unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
        out[name] = mi
    return out


mats = studio_material()

# 4. The shell: engine cubes (100 cm, pivot at the centre), merged into one mesh, one draw per material.
cube = unreal.load_asset("/Engine/BasicShapes/Cube")
boxes = []


def box(x0, x1, y0, y1, z0, z1, mat):
    a = eas.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    c = a.static_mesh_component
    c.set_static_mesh(cube)
    c.set_material(0, mats[mat])
    a.set_actor_scale3d(unreal.Vector((x1 - x0) / 100.0, (y1 - y0) / 100.0, (z1 - z0) / 100.0))
    boxes.append(a)


x0, x1 = ROOM_X
y0, y1 = ROOM_Y
S = "MI_StudioShell"
box(x0 - WALL, x1 + WALL, y0 - WALL, y1 + WALL, -WALL, 0.0, S)  # floor
box(x0 - WALL, x1 + WALL, y0 - WALL, y1 + WALL, ROOM_H, ROOM_H + WALL, S)  # ceiling
box(x0 - WALL, x0, y0, y1, 0.0, ROOM_H, S)  # front wall, behind the player
box(x0 - WALL, x1 + WALL, y0 - WALL, y0, 0.0, ROOM_H, S)  # left wall
box(x0 - WALL, x1 + WALL, y1, y1 + WALL, 0.0, ROOM_H, S)  # right wall
# The back wall around the window opening.
box(x1, x1 + WALL, y0, WINDOW_Y[0], 0.0, ROOM_H, S)
box(x1, x1 + WALL, WINDOW_Y[1], y1, 0.0, ROOM_H, S)
box(x1, x1 + WALL, WINDOW_Y[0], WINDOW_Y[1], 0.0, WINDOW_Z[0], S)
box(x1, x1 + WALL, WINDOW_Y[0], WINDOW_Y[1], WINDOW_Z[1], ROOM_H, S)
# A mullion and a transom, so the opening reads as a window.
mid = (WINDOW_Y[0] + WINDOW_Y[1]) / 2
box(x1, x1 + MULLION, mid - MULLION / 2, mid + MULLION / 2, WINDOW_Z[0], WINDOW_Z[1], S)
box(x1, x1 + MULLION, WINDOW_Y[0], WINDOW_Y[1], 200.0 - MULLION / 2, 200.0 + MULLION / 2, S)
# Side desks: a top and two end panels each.
for cx, cy, sx, sy, top in (LEFT_DESK, RIGHT_DESK):
    box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, top - 4.0, top, "MI_StudioDesk")
    for end in (cy - sy / 2, cy + sy / 2 - 4.0):
        box(cx - sx / 2 + 3.0, cx + sx / 2 - 3.0, end, end + 4.0, 0.0, top - 4.0, "MI_StudioDesk")

opts = unreal.MergeStaticMeshActorsOptions()
opts.set_editor_property("base_package_name", "/Game/Bp/Studio/StudioShell")  # the merge prefixes SM_
opts.set_editor_property("destroy_source_actors", True)
opts.set_editor_property("spawn_merged_actor", True)
opts.set_editor_property("new_actor_label", "StudioShell")
settings = opts.get_editor_property("mesh_merging_settings")
settings.set_editor_property("merge_materials", False)
settings.set_editor_property("generate_light_map_uv", False)
opts.set_editor_property("mesh_merging_settings", settings)
for old in ("/Game/Bp/Studio/SM_StudioShell", "/Game/Bp/Studio/SM_SM_StudioShell"):
    if unreal.EditorAssetLibrary.does_asset_exist(old):
        unreal.EditorAssetLibrary.delete_asset(old)
shell = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem).merge_static_mesh_actors(boxes, opts)
unreal.EditorAssetLibrary.save_asset("/Game/Bp/Studio/SM_StudioShell", only_if_is_dirty=False)
shell = tagged(shell, "StudioShell")
shell.static_mesh_component.set_editor_property("cast_shadow", False)
shell.static_mesh_component.set_editor_property("lighting_channels", channels(TABLE, ROOM))
result["shell"] = {"mesh": shell.static_mesh_component.static_mesh.get_path_name(),
                   "sections": shell.static_mesh_component.static_mesh.get_num_sections(0),
                   "loc": str(shell.get_actor_location())}

# 5. The props: static, no shadows (the studio never competes with the table, and each caster would add shadow draws).
placed = {}
for label, key, loc, yaw in PROPS:
    a = eas.spawn_actor_from_object(unreal.load_asset(MESHES[key]), unreal.Vector(*loc), unreal.Rotator(0.0, 0.0, yaw))
    tagged(a, label)
    c = a.static_mesh_component
    c.set_editor_property("mobility", unreal.ComponentMobility.STATIC)
    c.set_editor_property("cast_shadow", False)
    c.set_editor_property("lighting_channels", channels(TABLE, ROOM))
    placed[label] = {"mesh": MESHES[key], "loc": list(loc), "yaw": yaw}

# 6. The lamp agent at the far edge, statically posed: no states and no animation until L5.7. The pose is a two-key
# sequence of the bone rotations above, held at its first frame and never played.
if unreal.EditorAssetLibrary.does_asset_exist(LAMP_POSE):
    pose = unreal.load_asset(LAMP_POSE)
else:
    pose = unreal.EditorAssetLibrary.duplicate_asset(LAMP_POSE_FROM, LAMP_POSE)
rest = unreal.AnimPoseExtensions.get_reference_pose(pose.get_editor_property("skeleton"))
keys = pose.get_editor_property("data_model_interface").get_number_of_keys()
for bone, deg in LAMP_POSE_DEG.items():
    t = unreal.AnimPoseExtensions.get_bone_pose(rest, bone, unreal.AnimPoseSpaces.LOCAL)
    r = t.rotation.rotator()  # every lamp bone bends about X only, so a bend adds to its roll
    q = unreal.Rotator(roll=r.roll + deg, pitch=r.pitch, yaw=r.yaw).quaternion()
    pose.get_editor_property("controller").set_bone_track_keys(bone, [t.translation] * keys, [q] * keys, [t.scale3d] * keys)
unreal.EditorAssetLibrary.save_loaded_asset(pose, only_if_is_dirty=False)

agent_loc = (FAR_EDGE_X - LAMP_CLAMP_CM, LAMP_Y, TABLE_TOP)
agent = eas.spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector(*agent_loc), unreal.Rotator(0.0, 0.0, LAMP_YAW))
tagged(agent, "LampAgent")
skc = agent.skeletal_mesh_component
skc.set_skeletal_mesh_asset(unreal.load_asset("/Game/Bp/Art/LampAgent/SK_LampAgent"))
skc.set_editor_property("animation_mode", unreal.AnimationMode.ANIMATION_SINGLE_NODE)
skc.override_animation_data(pose, False, False, 0.0, 0.0)
skc.set_editor_property("cast_shadow", False)
skc.set_editor_property("lighting_channels", channels(ROOM))
posed = unreal.AnimPoseExtensions.get_anim_pose_at_time(pose, 0.0, unreal.AnimPoseEvaluationOptions())
head = agent.get_actor_transform().transform_location(
    unreal.AnimPoseExtensions.get_bone_pose(posed, "head", unreal.AnimPoseSpaces.WORLD).translation)
placed["LampAgent"] = {"mesh": "/Game/Bp/Art/LampAgent/SK_LampAgent", "loc": list(agent_loc), "yaw": LAMP_YAW, "pose": LAMP_POSE,
                       "pose_deg": LAMP_POSE_DEG, "head_bone_world": [round(head.x, 1), round(head.y, 1), round(head.z, 1)]}
result["placed"] = placed

# 7. Lights, all without shadows (only the two table spots cast): the desk lamp owns LampPractical, the agent's head a
# small warm glow, the window a cool wash, and RoomFill makes the walls read dimly on the room's channel.
lamp_actor, lamp_light = light("LampPractical")
dl = next(loc for label, _, loc, _ in PROPS if label == "StudioDeskLamp")
lamp_actor.set_actor_location(unreal.Vector(dl[0] + 8.0, dl[1] + 5.0, dl[2] + 30.0), False, False)
lamp_light.set_editor_property("intensity", DESK_LAMP_CD)
lamp_light.set_editor_property("attenuation_radius", DESK_LAMP_RADIUS)
lamp_light.set_editor_property("cast_shadows", False)
lamp_light.set_editor_property("lighting_channels", channels(TABLE, ROOM))
_, fill = light("FrameFill")
fill.set_editor_property("lighting_channels", channels(TABLE))


def point(label, loc, cd, radius, colour, chans):
    a = tagged(eas.spawn_actor_from_class(unreal.PointLight, unreal.Vector(*loc)), label)
    pl = a.get_component_by_class(unreal.PointLightComponent)
    pl.set_editor_property("mobility", unreal.ComponentMobility.STATIONARY)
    pl.set_editor_property("intensity", cd)
    pl.set_editor_property("attenuation_radius", radius)
    pl.set_editor_property("source_radius", 3.0)
    pl.set_editor_property("cast_shadows", False)
    pl.set_editor_property("light_color", colour)
    pl.set_editor_property("lighting_channels", chans)
    return a


# In the shade's mouth: it warms the rim and the hands (channel 0), never the agent's own arm.
point("AgentGlow", (head.x - 8.0, head.y, head.z - 4.0), AGENT_GLOW_CD, AGENT_GLOW_RADIUS, WARM, channels(TABLE))
point("RoomFill", (ROOM_X[1] - 120.0, 0.0, ROOM_H - 90.0), ROOM_FILL_CD, ROOM_FILL_RADIUS, ROOM_GREY, channels(ROOM))
win = tagged(eas.spawn_actor_from_class(unreal.SpotLight, unreal.Vector(ROOM_X[1] + 60.0, mid, 260.0),
                                        unreal.Rotator(0.0, -35.0, 180.0)), "WindowSpill")
wl = win.get_component_by_class(unreal.SpotLightComponent)
wl.set_editor_property("mobility", unreal.ComponentMobility.STATIONARY)
wl.set_editor_property("intensity", WINDOW_CD)
wl.set_editor_property("attenuation_radius", WINDOW_RADIUS)
wl.set_editor_property("outer_cone_angle", 45.0)
wl.set_editor_property("inner_cone_angle", 20.0)
wl.set_editor_property("cast_shadows", False)
wl.set_editor_property("light_color", COOL_SPILL)
wl.set_editor_property("lighting_channels", channels(TABLE, ROOM))

lights = {}
for a in eas.get_all_level_actors():
    lc = a.get_component_by_class(unreal.LightComponent)
    if lc:
        ch = lc.get_editor_property("lighting_channels")
        lights[a.get_actor_label()] = {
            "cd": lc.get_editor_property("intensity"), "loc": str(a.get_actor_location()),
            "shadows": lc.get_editor_property("cast_shadows"), "mobility": str(lc.get_editor_property("mobility")),
            "channels": [i for i, on in enumerate((ch.channel0, ch.channel1, ch.channel2)) if on]}
result["lights"] = lights

saved = les.save_current_level()
result["saved"] = saved
result["actors"] = sorted(a.get_actor_label() for a in eas.get_all_level_actors())
