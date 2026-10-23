# L3.2 content step (spark vr-table): import the gated light-table frame (ArtSource, 586 tris) through Interchange.
# Run through the editor MCP: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l32-content.jsonl
# EditorToolset's StaticMeshTools.import_file refuses .glb (FbxFactory: fbx/obj only), so this uses an AssetImportTask,
# which routes glTF to Interchange. The GLB's own materials and textures come along (dark metal, aluminium, edge glow,
# and the glass placeholder that ABpTable hides with M_Hidden).
import os
import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
SOURCE = os.path.join(REPO, "apps", "vr", "ArtSource", "light-table-frame", "final.glb")
DEST = "/Game/Bp/Art/LightTableFrame"

task = unreal.AssetImportTask()
task.filename = SOURCE
task.destination_path = DEST
task.destination_name = "SM_LightTableFrame"
task.automated = True
task.replace_existing = True
task.save = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

paths = list(task.imported_object_paths or [])
assets = unreal.EditorAssetLibrary.list_assets(DEST, recursive=True)
result = {"source": SOURCE, "imported": paths, "folder": list(assets)}
