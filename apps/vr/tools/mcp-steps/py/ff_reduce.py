# Content step (spark vr-fidelity-40 FF, the P4 budget): meshes decimated in UE where the eye cannot see the triangles.
# The CSV counter counts each triangle once per pass (depth prepass, base pass, shadow), so a prop's cost is about twice
# its triangles. FF reduced the fixture glyphs here too (to 150 triangles each); FM dropped that for FN's kit (288 to 444
# triangles a glyph, desks with monitors, tables, shelving, sofas, plants), whose shapes the reducer flattened, so a
# re-import of the kit (fc3_sheet.py) stands at its full count. What is left:
# - the studio shelves (17,144 triangles each, four units, 3 m from the eye behind the lamp agent), to SHELF_PCT: their
#   books are bevelled boxes, and the target pose drew 137k triangles for them across the two passes (Lynx 2026-10-25).
#   import_studio.py re-imports them, so this step runs after it.
# Replayable: the reduction is set, not added. Run outside PIE:
#   node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/ff-assembly.jsonl
import unreal

SHELF_PCT = 0.5
SHELVES = "/Game/Bp/Art/StudioShelves/final/StaticMeshes/SM_StudioShelves"
sme = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
result = {}


def reduce(mesh, target=None, pct=None):
    before = mesh.get_num_triangles(0)
    # The source triangle count: reset any earlier reduction first, so the percentage is of the imported mesh.
    reset = unreal.EditorScriptingMeshReductionOptions()
    reset.set_editor_property("reduction_settings", [unreal.EditorScriptingMeshReductionSettings(percent_triangles=1.0, screen_size=1.0)])
    sme.set_lods(mesh, reset)
    source = mesh.get_num_triangles(0)
    pct = pct if pct is not None else min(1.0, target / float(source))
    opts = unreal.EditorScriptingMeshReductionOptions()
    opts.set_editor_property("reduction_settings", [unreal.EditorScriptingMeshReductionSettings(percent_triangles=pct, screen_size=1.0)])
    sme.set_lods(mesh, opts)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
    result[mesh.get_name()] = {"before": before, "source": source, "pct": round(pct, 3), "after": mesh.get_num_triangles(0),
                               "lods": mesh.get_num_lods()}


reduce(unreal.load_asset(SHELVES), pct=SHELF_PCT)
