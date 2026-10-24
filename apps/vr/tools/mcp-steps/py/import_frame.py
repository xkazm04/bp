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

# No Nanite on a 586-triangle frame: under forward shading (spark vr-hands-zoom WP2) its Nanite render was unlit black,
# rim and legs alike, whatever the lights did (captures, Lynx 2026-10-24), and the headset's path has no Nanite anyway.
mesh = unreal.load_asset(DEST + "/SM_LightTableFrame")
nanite = mesh.get_editor_property("nanite_settings")
nanite.set_editor_property("enabled", False)
mesh.set_editor_property("nanite_settings", nanite)
unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)

paths = list(task.imported_object_paths or [])
assets = unreal.EditorAssetLibrary.list_assets(DEST, recursive=True)
result = {"source": SOURCE, "imported": paths, "folder": list(assets), "nanite": mesh.get_editor_property("nanite_settings").get_editor_property("enabled")}

# A re-import keeps the material instances it made the first time (Lynx, 2026-10-24: frame_edge_glow still had
# EmissiveStrength 25 after the 3.0 frame came in), so the strip's strength is copied from the GLB's own material.
import json
import struct

with open(SOURCE, "rb") as f:
    blob = f.read()
length = struct.unpack_from("<I", blob, 12)[0]
gltf = json.loads(blob[20:20 + length].decode("utf-8"))
glow = next(m for m in gltf["materials"] if m["name"] == "frame_edge_glow")
strength = glow.get("extensions", {}).get("KHR_materials_emissive_strength", {}).get("emissiveStrength", 1.0)
mi = unreal.load_asset(DEST + "/final/Materials/frame_edge_glow")
unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", strength)
unreal.EditorAssetLibrary.save_loaded_asset(mi, only_if_is_dirty=False)
result["glow_emissive_strength"] = unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(mi, "EmissiveStrength")
