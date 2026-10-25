# Content step (spark vr-fidelity-40 FAC, elements 1, 2, 13 and 15; r9-paper-light-metal.md): the light round the paper.
# After fab_look.py; then fid_bake.py. Replayable: every actor this step places carries the tag FacLook and is removed
# first; the values it changes are set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fac-look.jsonl
#
# - The air under the table (fab_look.py's TableAir) stood under the paper's centre, aiming up: its scattering fogged a
#   teal veil over the whole sheet (Lynx 2026-10-25, fac/g1-g3: with the paper's emissive at 0 the sheet still read luma
#   40, 14 with that light off) and lifted the back wall. Under the paper's far edge it lights the air behind the table,
#   where the concept's haze is, and leaves the sheet its own navy.
# - The strip lights the frame (r9 rank 3): an unshadowed movable rect light along each strip, facing out of the opening
#   and up, so the rails' brushed tops take the strip's light and its reflection, brightest next to it and falling off
#   across the face (the concept's 137 -> 90). Their reach is cut by attenuation; no specular on the glass from below
#   (they sit under its top face, facing away from it).
import unreal

TAG = "FacLook"
TABLE_TOP = 95.0
PAPER = (166.0, 76.0)  # ABpTable::PaperWidthCm (along Y), PaperDepthCm (along X)
AIR_AT = (70.0, 0.0, 60.0)  # fab_look.py (0, 0, 60): under the far edge now
# label: (centre, yaw (the face's outward direction), length along the strip, candelas). r9's 30 cd burned every rail
# white (fac/u2: the near face 254); by capture the near face reads 118 -> 90 across its top at 0.6 (the concept's
# 137 -> 90, fac/w1), and the side rails, which face the eye more, take a third of that (at 0.6 they read 232).
STRIP_Z = TABLE_TOP + 0.3
STRIPS = {
    "StripNear": ((-PAPER[1] / 2 - 0.8, 0.0, STRIP_Z), 180.0, PAPER[0], 0.45),
    "StripFar": ((PAPER[1] / 2 + 0.8, 0.0, STRIP_Z), 0.0, PAPER[0], 0.3),
    "StripLeft": ((0.0, -PAPER[0] / 2 - 0.8, STRIP_Z), -90.0, PAPER[1], 0.2),
    "StripRight": ((0.0, PAPER[0] / 2 + 0.8, STRIP_Z), 90.0, PAPER[1], 0.2),
}
STRIP_PITCH = 30.0  # up from the table plane
STRIP_HEIGHT_CM = 2.5
STRIP_REACH_CM = 30.0
STRIP_COLOUR = unreal.Color(r=0xDD, g=0xEB, b=0xFF, a=255)
GLINT_CD = 1.5  # r9's 2; at 4 a round sun on mid-sheet (fac/z1); at 1.5 on glass roughness 0.25 a soft warm lobe
GLINT_RADIUS_CM = 4.0
GLINT_REACH_CM = 400.0
GLINT_COLOUR = unreal.Color(r=0xFF, g=0xC5, b=0x8A, a=255)
GLASS = {"Specular": 0.35, "Roughness": 0.25}  # fid_look.py 0.2, 0.08; r9 0.15 drew the glint as a disc

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les.load_level("/Game/Maps/LightTable")
result = {}
for a in eas.get_all_level_actors():
    if TAG in [str(t) for t in a.tags]:
        eas.destroy_actor(a)
actors = {a.get_actor_label(): a for a in eas.get_all_level_actors()}

air = actors["TableAir"]
air.set_actor_location(unreal.Vector(*AIR_AT), False, False)
result["air"] = list(AIR_AT)

strips = {}
for label, (at, yaw, length, cd) in STRIPS.items():
    # Rotator(roll, pitch, yaw): the light faces its +X, turned outward and tipped up.
    a = eas.spawn_actor_from_class(unreal.RectLight, unreal.Vector(*at), unreal.Rotator(0.0, STRIP_PITCH, yaw))
    a.set_actor_label(label)
    a.tags = [unreal.Name(TAG)]
    c = a.get_component_by_class(unreal.RectLightComponent)
    c.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    c.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    c.set_editor_property("intensity", cd)
    c.set_editor_property("source_width", length)
    c.set_editor_property("source_height", STRIP_HEIGHT_CM)
    c.set_editor_property("attenuation_radius", STRIP_REACH_CM)
    c.set_editor_property("cast_shadows", False)
    c.set_editor_property("light_color", STRIP_COLOUR)
    c.set_editor_property("volumetric_scattering_intensity", 0.0)
    strips[label] = {"cd": cd, "at": list(at), "yaw": yaw}
result["strips"] = strips

# The lamp's glint (r9 rank 5): a specular-only light at the lamp agent's lens (AgentGlow's place, fy_look.py), so the
# glass and the far rail mirror the warm lamp as the concept's streak without the lamp lighting anything more.
glow = actors["AgentGlow"]
g = eas.spawn_actor_from_class(unreal.PointLight, glow.get_actor_location())
g.set_actor_label("LampGlint")
g.tags = [unreal.Name(TAG)]
gc = g.get_component_by_class(unreal.PointLightComponent)
gc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
gc.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
gc.set_editor_property("intensity", GLINT_CD)
gc.set_editor_property("diffuse_scale", 0.0)
gc.set_editor_property("specular_scale", 1.0)
gc.set_editor_property("source_radius", GLINT_RADIUS_CM)
gc.set_editor_property("attenuation_radius", GLINT_REACH_CM)
gc.set_editor_property("cast_shadows", False)
gc.set_editor_property("volumetric_scattering_intensity", 0.0)
gc.set_editor_property("light_color", GLINT_COLOUR)
result["glint"] = {"cd": GLINT_CD, "at": str(g.get_actor_location())}

# The glass (fid_look.py's M_TableGlass): a stronger, rougher sheen so the glint stretches into a streak at the grazing view.
mel = unreal.MaterialEditingLibrary
gm = unreal.load_asset("/Game/Bp/Materials/M_TableGlass")
for e in mel.get_material_expressions(gm):
    if isinstance(e, unreal.MaterialExpressionScalarParameter) and str(e.get_editor_property("parameter_name")) in GLASS:
        e.set_editor_property("default_value", GLASS[str(e.get_editor_property("parameter_name"))])
mel.recompile_material(gm)
unreal.EditorAssetLibrary.save_loaded_asset(gm, only_if_is_dirty=False)
result["glass"] = GLASS
result["saved"] = les.save_current_level()
