# FM one-off (coordinator's step 1): reset the fixture glyphs' LOD0 reduction to 100% after ff_reduce.py's old glyph loop.
import unreal
sme = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
out = {}
for path in unreal.EditorAssetLibrary.list_assets("/Game/Bp/Art/FixtureKit/final/StaticMeshes", recursive=False):
    mesh = unreal.load_asset(path)
    if not isinstance(mesh, unreal.StaticMesh): continue
    o = unreal.EditorScriptingMeshReductionOptions()
    o.set_editor_property("reduction_settings", [unreal.EditorScriptingMeshReductionSettings(percent_triangles=1.0, screen_size=1.0)])
    sme.set_lods(mesh, o)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
    out[mesh.get_name()] = mesh.get_num_triangles(0)
result = out
