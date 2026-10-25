# Content step (spark vr-fidelity-40 FC2): bake the studio's light after studio_level.py and fid_look.py
# (r.AllowStaticLighting=True since FC2). The room is static and baked: the shell and props carry lightmap UVs and cast
# into the bake, the room's lights (RoomFill, WindowSpill, LampPractical) are static, and the window city and the lamp
# agent's orb light the room as emissive-for-static sources; Lightmass adds the bounce and the AO that the forward path
# cannot. The table's lights stay stationary and the agent's movable: they are what the person and the agent change.
# The table's edge strip is ABpTable's runtime component, so it cannot be an emissive-for-static source (FC2 report).
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fid-look.jsonl
# Lynx (emulated x64 editor): CPU Lightmass through Swarm; GPU Lightmass needs r.RayTracing and DXR, which this editor
# does not run (FC2 report). QUALITY picks the build: the time it took is in the result.
import time

import unreal

QUALITY = unreal.LightingBuildQuality.QUALITY_MEDIUM
TAG = "BpLook"
ROOM = ((-250.0, 250.0), (-300.0, 300.0), (0.0, 300.0))

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les.load_level("/Game/Maps/LightTable")
result = {}

ws = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world().get_world_settings()
lm = ws.get_editor_property("lightmass_settings")
lm.set_editor_property("static_lighting_level_scale", 0.5)
lm.set_editor_property("indirect_lighting_quality", 2.0)
lm.set_editor_property("num_indirect_lighting_bounces", 3)
lm.set_editor_property("use_ambient_occlusion", True)
lm.set_editor_property("direct_illumination_occlusion_fraction", 0.5)
lm.set_editor_property("indirect_illumination_occlusion_fraction", 1.0)
lm.set_editor_property("max_occlusion_distance", 60.0)
lm.set_editor_property("volumetric_lightmap_detail_cell_size", 25.0)  # the hands and the agent read the bake from it
ws.set_editor_property("lightmass_settings", lm)

for a in eas.get_all_level_actors():
    if a.get_actor_label() == "LightmassVolume":
        eas.destroy_actor(a)
(x0, x1), (y0, y1), (z0, z1) = ROOM
vol = eas.spawn_actor_from_class(unreal.LightmassImportanceVolume, unreal.Vector((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
vol.set_actor_label("LightmassVolume")
vol.set_editor_property("tags", [unreal.Name(TAG)])
# The brush is a 200 cm cube at scale 1.
vol.set_actor_scale3d(unreal.Vector((x1 - x0 + 40) / 200.0, (y1 - y0 + 40) / 200.0, (z1 - z0 + 40) / 200.0))

# Lightmap density (r4: about 0.5 to 1 texel/cm on the walls and desks, more on the props by the table): the merged
# shell is about 10 m of walls and desks in one UV layout, so it takes SHELL_RES; each prop PROP_RES.
SHELL_RES = 1024
PROP_RES = 256
# FM: the lamp agent's bounce 0.4 (from 1.0): its warm wash on the back wall and the shelves outshone the table (the
# judge, element 13: "the table is the main light source").
EMISSIVE_BOOST = {"CityBackdrop": 0.08, "LampAgent": 0.4}
res = {}
for a in eas.get_all_level_actors():
    if "BpStudio" not in [str(t) for t in a.tags] or not isinstance(a, unreal.StaticMeshActor):
        continue
    c = a.static_mesh_component
    if c.get_editor_property("mobility") != unreal.ComponentMobility.STATIC:
        continue
    c.set_editor_property("override_light_map_res", True)
    c.set_editor_property("overridden_light_map_res", SHELL_RES if a.get_actor_label() == "StudioShell" else PROP_RES)
    res[a.get_actor_label()] = c.get_editor_property("overridden_light_map_res")
result["lightmap_res"] = res

for a in eas.get_all_level_actors():
    if a.get_actor_label() in ("CityBackdrop", "LampAgent"):
        c = a.static_mesh_component
        s = c.get_editor_property("lightmass_settings")
        s.set_editor_property("use_emissive_for_static_lighting", True)
        # The city is a 20 m emissive arc: at full strength its bounce washed the desks white (Lynx, 2026-10-24).
        s.set_editor_property("emissive_boost", EMISSIVE_BOOST[a.get_actor_label()])
        c.set_editor_property("lightmass_settings", s)

start = time.time()
built = les.build_light_maps(QUALITY, True)
result["build"] = {"quality": str(QUALITY), "ok": built, "seconds": round(time.time() - start, 1)}
result["saved"] = les.save_current_level()
