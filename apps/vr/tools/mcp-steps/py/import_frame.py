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

# spark vr-fidelity-40: FA's frame is one atlas slot (frame_atlas) plus the glow and the glass. Re-importing onto the
# existing SM_LightTableFrame kept the old slot list and made no instance or textures for the new slot (it rendered
# WorldGridMaterial, Lynx 2026-10-24), so the atlas's three JPEGs are cut out of the GLB, imported, and given an M_GLTF
# instance here, every texture set explicitly. glTF normals are OpenGL (+Y), so the normal map's green is flipped.
TEX = DEST + "/final/Textures"
tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
bin_start = 20 + length + 8
out_dir = os.path.join(unreal.Paths.project_saved_dir(), "fid-frame")
os.makedirs(out_dir, exist_ok=True)
textures = {}
for img in gltf.get("images", []):
    view = gltf["bufferViews"][img["bufferView"]]
    data = blob[bin_start + view.get("byteOffset", 0): bin_start + view.get("byteOffset", 0) + view["byteLength"]]
    path = os.path.join(out_dir, img["name"] + ".jpg")
    with open(path, "wb") as f:
        f.write(data)
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = TEX
    task.destination_name = img["name"]
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    tex = unreal.load_asset(TEX + "/" + img["name"])
    if img["name"].endswith("_normal"):
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("flip_green_channel", True)
    elif img["name"].endswith("_orm"):
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        tex.set_editor_property("srgb", False)
    unreal.EditorAssetLibrary.save_loaded_asset(tex, only_if_is_dirty=False)
    textures[img["name"]] = tex
atlas_path = DEST + "/final/Materials/frame_atlas"
atlas = unreal.load_asset(atlas_path) if unreal.EditorAssetLibrary.does_asset_exist(atlas_path) else tools.create_asset(
    "frame_atlas", DEST + "/final/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
mel.set_material_instance_parent(atlas, unreal.load_asset("/InterchangeAssets/gltf/Substrate/M_GLTF"))
for param_name, image in (("BaseColorTexture", "frame_atlas_basecolor"), ("MetallicRoughnessTexture", "frame_atlas_orm"),
                          ("OcclusionTexture", "frame_atlas_orm"), ("NormalTexture", "frame_atlas_normal")):
    mel.set_material_instance_texture_parameter_value(atlas, param_name, textures[image])
unreal.EditorAssetLibrary.save_loaded_asset(atlas, only_if_is_dirty=False)
slots = []
for sm in mesh.get_editor_property("static_materials"):
    if str(sm.get_editor_property("material_slot_name")) == "frame_atlas":
        sm.set_editor_property("material_interface", atlas)
    slots.append(sm)
mesh.set_editor_property("static_materials", slots)
unreal.EditorAssetLibrary.save_loaded_asset(mesh, only_if_is_dirty=False)
result["atlas"] = {str(n): mel.get_material_instance_texture_parameter_value(atlas, n).get_name() for n in ("BaseColorTexture", "NormalTexture")}
result["slots"] = [(str(s.material_slot_name), s.material_interface.get_name() if s.material_interface else None) for s in mesh.static_materials]
