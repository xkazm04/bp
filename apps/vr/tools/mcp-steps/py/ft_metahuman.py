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
PRESET = "/MetaHumanCharacter/Optional/Presets/Victor"  # Core Data's presets (MetaHuman Creator Core Data, FT2)
SKIN_U, SKIN_V = 0.25, 0.50  # skin tone picker (T_Skin_Bar_Color_Picker); default 0.5/0.5. FT2: 0.42/0.55 read dark brown under the table light; 0.25/0.50 is the concept's light-medium tan

eal = unreal.EditorAssetLibrary
ss = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
if eal.does_asset_exist(ROOT + "/" + NAME):  # a character open for editing (an earlier run) cannot be deleted
    old = unreal.load_asset(ROOT + "/" + NAME)
    if ss.is_object_added_for_editing(old):
        ss.remove_object_to_edit(old)
for path in (ROOT + "/" + NAME, EXPORT):
    if eal.does_directory_exist(path):
        eal.delete_directory(path)
    elif eal.does_asset_exist(path):
        eal.delete_asset(path)

tools = unreal.AssetToolsHelpers.get_asset_tools()
# FT2: start from a Core Data preset (a male adult body: the concept's hands are a man's), else the plugin's default body
# (a medium female; FT's run).
if eal.does_asset_exist(PRESET):
    ch = tools.duplicate_asset(NAME, ROOT, unreal.load_asset(PRESET))
else:
    ch = tools.create_asset(NAME, ROOT, unreal.MetaHumanCharacter, unreal.MetaHumanCharacterFactoryNew())
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
# The skin material (FT2): the plugin's own body skin, MI_Skin_Body_MHC (the Creator's preview skin, which reads Core
# Data's body textures and its micro-tiling mask), as a constant instance in the project. "Export materials" refuses
# offline ("The Character is missing textures. Use Download Texture Sources", i.e. the Epic cloud), so the instance takes
# what the Creator's own preview applies: a transient preview actor's body material carries the committed skin tone (the
# rbias..bgain the texture synthesis model derives from U and V), the body textures and the palm and nail values.
SKIN_MI = ROOT + "/MI_CaptureHands_Skin"
LOOK = {"Normal Global Strength": 1.5, "Specular Global Multiply": 1.3}
COPY_SCALARS = ("rbias", "gbias", "bbias", "rgain", "ggain", "bgain", "Roughness UI Multiply", "Micro MaskB Strength",
                "Palm Lightness", "Palm Tint", "Palm Cavity Darkness", "Fingernail Tint Intensity", "Fingernail Roughness",
                "Fingernail Metallic")
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
preview = ss.spawn_meta_human_actor(ch, True)
body_mid = next(c.get_material(0) for c in preview.get_components_by_class(unreal.SkinnedMeshComponent) if c.get_name() == "Body")
mel = unreal.MaterialEditingLibrary
if eal.does_asset_exist(SKIN_MI):  # kept, not deleted: the hand meshes' slots point at it (a delete nulls them)
    mi = unreal.load_asset(SKIN_MI)
    mel.clear_all_material_instance_parameters(mi)
else:
    mi = tools.create_asset(SKIN_MI.rsplit("/", 1)[1], ROOT, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
mel.set_material_instance_parent(mi, unreal.load_asset("/MetaHumanCharacter/Materials/MI_Skin_Body_MHC"))
skin_values = {}
for n in COPY_SCALARS:
    skin_values[n] = round(body_mid.get_scalar_parameter_value(n), 4)
    mel.set_material_instance_scalar_parameter_value(mi, n, skin_values[n])
mel.set_material_instance_scalar_parameter_value(mi, "Show Top Underwear", 0.0)
# The look in the capture (FT2, judged against the concept): the body normal (pores, forearm hair, knuckle creases) at
# 1.5x and a little more sheen; on the forward path the subsurface profile shades as default lit, so these carry the skin.
for n, val in LOOK.items():
    mel.set_material_instance_scalar_parameter_value(mi, n, val)
mel.set_material_instance_vector_parameter_value(mi, "Fingernail Tint Color", body_mid.get_vector_parameter_value("Fingernail Tint Color"))
for name in ("Basecolor", "Normal", "Cavity"):
    tex = body_mid.get_texture_parameter_value(name)
    if tex:
        mel.set_material_instance_texture_parameter_value(mi, name, tex)
        skin_values[name] = tex.get_path_name()
eas.destroy_actor(preview)
eal.save_asset(SKIN_MI)

cons = {str(c.get_editor_property("name")): round(c.get_editor_property("target_measurement"), 1) for c in ss.get_body_constraints(ch)}
result = {"preset": PRESET if eal.does_asset_exist(PRESET) else None,
          "body": {k: cons.get(k) for k in ("Height", "Masculine/Feminine", "Wrist", "Hand Circumference", "Forearm")},
          "core_data": core_data, "added": added, "can_build": ss.can_build_meta_human(ch, True), "exported": exported,
          "meshes": info, "skin_mi": SKIN_MI, "skin_values": skin_values}
