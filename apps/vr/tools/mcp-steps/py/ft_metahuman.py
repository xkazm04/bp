# Content step (spark vr-fidelity-40 FT, element 12): the MetaHuman smoke test for the capture hands. Creates a MetaHuman
# Character asset (MetaHuman Creator, UE 5.8 beta plugin, enabled Editor-only in bp.uproject), sets a neutral adult skin
# tone near the concept's hands, and exports its body geometry (the full body with both hands) as a skeletal mesh in
# the project. Everything here runs offline: no auto-rig, no texture download (both need the Epic cloud and sign-in).
# Replayable: the character and the export folder are deleted first. Records what the plugin reports about its optional
# "MetaHuman Creator Core Data" (texture synthesis model and body textures), which decides the skin.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/ft-metahuman.jsonl
import unreal

ROOT = "/Game/Bp/Art/MetaHuman"
NAME = "MHC_CaptureHands"
EXPORT = ROOT + "/Export"
SKIN_U, SKIN_V = 0.42, 0.55  # skin tone picker (T_Skin_Bar_Color_Picker); default 0.5/0.5; the concept's light-medium warm

eal = unreal.EditorAssetLibrary
for path in (ROOT + "/" + NAME, EXPORT):
    if eal.does_directory_exist(path):
        eal.delete_directory(path)
    elif eal.does_asset_exist(path):
        eal.delete_asset(path)

tools = unreal.AssetToolsHelpers.get_asset_tools()
ch = tools.create_asset(NAME, ROOT, unreal.MetaHumanCharacter, unreal.MetaHumanCharacterFactoryNew())
ss = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
added = ss.try_add_object_to_edit(ch)

# The skin needs the plugin's optional "MetaHuman Creator Core Data" (Content/Optional: the texture synthesis model and
# the body textures, an engine install option in the Epic Games Launcher). Without it CommitSkinSettings asserts in
# MetaHumanCharacterBodyTextureUtils.cpp:109 (check(BodyTexture)) and takes the editor down (Lynx, 2026-10-25), so the
# skin is committed only when the folder is there.
core_data = unreal.Paths.directory_exists(unreal.Paths.engine_plugins_dir() + "MetaHuman/MetaHumanCharacter/Content/Optional/BodyTextures")
if core_data:
    skin = unreal.MetaHumanCharacterSkinSettings()
    props = skin.get_editor_property("skin")
    props.set_editor_property("u", SKIN_U)
    props.set_editor_property("v", SKIN_V)
    skin.set_editor_property("skin", props)
    ss.commit_skin_settings(ch, skin)

geo = unreal.MetaHumanGeometryExportParams()
geo.set_editor_property("project_path", EXPORT)
geo.set_editor_property("body_skeletal_mesh", True)
geo.set_editor_property("head_skeletal_mesh", False)
geo.set_editor_property("full_body_skeletal_mesh", False)
geo.set_editor_property("overwrite_existing_assets", True)
unreal.MetaHumanCharacterExportBlueprintLibrary.export_geometry(ch, geo)
eal.save_asset(ch.get_path_name())

exported = eal.list_assets(EXPORT, recursive=True) if eal.does_directory_exist(EXPORT) else []
info = {}
for p in exported:
    a = unreal.load_asset(p)
    if isinstance(a, unreal.SkeletalMesh):
        mats = [str(m.get_editor_property("material_interface").get_path_name()) if m.get_editor_property("material_interface") else None
                for m in a.get_editor_property("materials")]
        info[p] = {"mats": mats, "bounds": str(a.get_bounds().box_extent)}
result = {"core_data": core_data, "added": added, "can_build": ss.can_build_meta_human(ch, True), "exported": exported,
          "meshes": info}
