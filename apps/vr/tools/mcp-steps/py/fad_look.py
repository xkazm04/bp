# Content step (spark vr-fidelity-40 FAD, the judges' panel on fid-ac-hero): the lamp's glint off, the glass's sheen back
# down, the pin tags off the bloom. After fac_look.py (fid_bake.py not needed: nothing baked changes). Replayable: it
# removes and sets, never adds.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fad-look.jsonl
#
# - fac_look.py's LampGlint (a specular-only point light at the lamp's lens) mirrored in the glass mid-sheet as a violet
#   patch every judge called a smudge; the concept's streak sits on the far rail, which no place of the light reached at
#   this geometry (fac: the reflection point is mid-near paper). Removed.
# - The glass (M_TableGlass): fac_look's Specular 0.35 was set for the glint; without it, fid_look's sheen.
# - M_PinTag's TagGlow: fg_holo.py's 1.3 bloomed the tags' paper to white; the tags are warm paper (BpMarks DrawTags).
import unreal

GLASS = {"Specular": 0.2}  # fid_look.py's 0.2 (fac_look 0.35 for the glint); roughness stays fac_look's 0.25
TAG_GLOW = 0.85  # fg_holo.py 1.3: the paper read white (fid-ac-hero, three judges)

les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les.load_level("/Game/Maps/LightTable")
result = {"removed": []}
for a in eas.get_all_level_actors():
    if a.get_actor_label() == "LampGlint":
        result["removed"].append(a.get_actor_label())
        eas.destroy_actor(a)

mel = unreal.MaterialEditingLibrary
for path, values in (("/Game/Bp/Materials/M_TableGlass", GLASS), ("/Game/Bp/Materials/M_PinTag", {"TagGlow": TAG_GLOW})):
    m = unreal.load_asset(path)
    for e in mel.get_material_expressions(m):
        if isinstance(e, unreal.MaterialExpressionScalarParameter) and str(e.get_editor_property("parameter_name")) in values:
            e.set_editor_property("default_value", values[str(e.get_editor_property("parameter_name"))])
    mel.recompile_material(m)
    unreal.EditorAssetLibrary.save_loaded_asset(m, only_if_is_dirty=False)
    result[path.rsplit("/", 1)[1]] = values
result["saved"] = les.save_current_level()
