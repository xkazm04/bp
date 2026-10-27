# Content step (spark vr-fidelity-40 FAF, the judges on fid-ad-hero and fid-ad-pof-hero, elements 13 and 15): the studio's
# left side darker, a quiet presence on its right, and air the lamp glows through. After fad_look.py, then fid_bake.py
# (the shelf pools are stationary: their bounce is baked). Replayable: it only sets values.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/faf-look.jsonl
#
# - The left side ("lit too warm and bright for the concept's darkness"; "the bright left panel breaks the darkness"): the
#   pale panel left of the desk lamp is the desk clutter's board, 40 cm from the lamp and facing it, luma 117 at the
#   target pose (the concept's 20). Its atlas darkened and its specular off (a sheen, not the albedo, carried most of it:
#   albedo 0.3 alone read 98, both 35); the shelves' warm pools and bulbs down, so the books keep small warm pools.
# - The right side ("an empty void"): FA's mug moved from behind the card to the right desk's near corner, where the
#   target pose sees it right of the table's far corner (the concept's mug), and the right desk's pool on it. Axes: the
#   room's, X toward the back wall, Y to the right (studio_level.py).
# - Haze ("almost no atmospheric haze", "a light fog layer so the lamp, pins and table edge glow through air"): FQ's and
#   FAC's rules kept (no static light scatters, only chosen movable ones): the lamp agent's glow scatters more, and the
#   table's rising veil (FQ set it to 0) comes back faint. The edge strips' scattering was tried and showed nothing (rect
#   lights feed the volumetric fog too little at their 0.2 to 0.45 cd).
import unreal

CLUTTER = "/Game/Bp/Art/StudioDeskClutter/final/Materials/desk_clutter_atlas"
CLUTTER_BASE = 0.3      # Interchange's 1.0
CLUTTER_SPECULAR = 0.0  # Interchange's 1.0
LIGHTS = {
    "ShelfPool1": {"intensity": 0.6},          # fab_look.py 1.5
    "ShelfPool2": {"intensity": 0.6},
    "ShelfBulbLight1": {"intensity": 0.08},    # fab_look.py 0.15
    "ShelfBulbLight2": {"intensity": 0.08},
    "AgentGlow": {"volumetric_scattering_intensity": 450.0},  # fq_look.py 300: 600 put the wall by the lamp at 52, 1000 at 66
}
VEIL = ("/Game/Bp/Materials/MI_HazeTableRise", 0.035)  # fq_look.py 0 (fo_look 0.16 lifted the back wall by 35)
MUG_AT = (80.0, 135.0, 75.0)  # studio_level.py: (RIGHT_DESK x - 22, y - 48, top), behind the card from the target pose
MUG_YAW = 200.0
RIGHT_POOL_AIM = (80.0, 135.0, 80.0)  # fr_look.py aimed it at (85, 110, 75)

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les.load_level("/Game/Maps/LightTable")
mel = unreal.MaterialEditingLibrary
result = {}

m = unreal.load_asset(CLUTTER)
mel.set_material_instance_vector_parameter_value(m, "BaseColorFactor", unreal.LinearColor(CLUTTER_BASE, CLUTTER_BASE, CLUTTER_BASE, 1.0))
mel.set_material_instance_scalar_parameter_value(m, "SpecularFactor", CLUTTER_SPECULAR)
mel.update_material_instance(m)
unreal.EditorAssetLibrary.save_loaded_asset(m, only_if_is_dirty=False)
veil = unreal.load_asset(VEIL[0])
mel.set_material_instance_scalar_parameter_value(veil, "Glow", VEIL[1])
mel.update_material_instance(veil)
unreal.EditorAssetLibrary.save_loaded_asset(veil, only_if_is_dirty=False)
result["materials"] = {"clutter": [CLUTTER_BASE, CLUTTER_SPECULAR], "veil": VEIL[1]}

actors = {a.get_actor_label(): a for a in eas.get_all_level_actors()}
for label, values in LIGHTS.items():
    lc = actors[label].get_component_by_class(unreal.LightComponent)
    for k, v in values.items():
        lc.set_editor_property(k, v)
result["lights"] = LIGHTS

mug = actors["StudioMug"]
mug.set_actor_location_and_rotation(unreal.Vector(*MUG_AT), unreal.Rotator(0.0, 0.0, MUG_YAW), False, False)
pool = actors["RightDeskPool"]
pool.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(pool.get_actor_location(), unreal.Vector(*RIGHT_POOL_AIM)), False)
result["mug"] = {"at": MUG_AT, "yaw": MUG_YAW, "pool_aim": RIGHT_POOL_AIM}
result["saved"] = les.save_current_level()
