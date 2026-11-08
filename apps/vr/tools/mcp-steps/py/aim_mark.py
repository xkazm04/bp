# The aim cursor's material (BpHands UpdateAim, bp.Aim): unlit and opaque, its emissive the instance's colour (custom data
# 0..2, read in the vertex shader and interpolated, as M_EdgeGlow's are for the mobile forward path). One cheap draw for the
# ray and the reticles of both hands, no overdraw.
#
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/aim_mark.py
import unreal

PATH = "/Game/Bp/Materials/M_AimMark"
mel = unreal.MaterialEditingLibrary

if unreal.EditorAssetLibrary.does_asset_exist(PATH):
    m = unreal.EditorAssetLibrary.load_asset(PATH)
    for old in list(mel.get_material_expressions(m)):
        mel.delete_material_expression(m, old)
else:
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "M_AimMark", "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
m.set_editor_property("two_sided", False)
m.set_editor_property("used_with_instanced_static_meshes", True)

color = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData3Vector, -500, 0)
color.set_editor_property("data_index", 0)
vi = mel.create_material_expression(m, unreal.MaterialExpressionVertexInterpolator, -250, 0)
mel.connect_material_expressions(color, "", vi, "")
mel.connect_material_property(vi, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
saved = unreal.EditorAssetLibrary.save_asset(PATH, only_if_is_dirty=False)
print({"material": PATH, "saved": saved, "expressions": mel.get_num_material_expressions(m), "blend": str(m.get_editor_property("blend_mode"))})
