# Two materials the Quest tier swaps in (BpTier.cpp), so that big surfaces stop paying the imported lit master:
#   M_BackdropUnlit: the city backdrop as what it already is, its emissive texture at the imported strength (16), unlit.
#   M_Collapsed:     no pixels at all. The vertex shader folds the mesh onto its pivot, for a slot that must not draw but
#                    cannot be removed from the imported mesh (the frame's glass placeholder). Still masked to nothing, so
#                    a path that ignores the offset draws nothing either.
#
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/quest_cheap_materials.py
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
DIR = "/Game/Bp/Materials"


def fresh(name):
    path = DIR + "/" + name
    if eal.does_asset_exist(path):
        m = eal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, DIR, unreal.Material, unreal.MaterialFactoryNew())


# ---- the backdrop
m = fresh("M_BackdropUnlit")
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
m.set_editor_property("two_sided", True)  # as the imported instance overrides it
# The backdrop carries a built lightmap: without this usage flag the tier drew the default material in its place
# (night-two w0: the editor logged "M_BackdropUnlit missing usage flag StaticLighting" and the window went dark).
m.set_editor_property("used_with_static_lighting", True)
tex = mel.create_material_expression(m, unreal.MaterialExpressionTextureSample, -600, 0)
tex.set_editor_property("texture", eal.load_asset("/Game/Bp/Art/CityBackdrop/final/Textures/city_backdrop_basecolor"))
strength = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -600, 300)
strength.set_editor_property("r", 16.0)
mul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -250, 0)
mel.connect_material_expressions(tex, "RGB", mul, "A")
mel.connect_material_expressions(strength, "", mul, "B")
mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)

# ---- the quad that must not draw
c = fresh("M_Collapsed")
c.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
c.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
c.set_editor_property("two_sided", False)
pivot = mel.create_material_expression(c, unreal.MaterialExpressionObjectPositionWS, -700, 200)
world = mel.create_material_expression(c, unreal.MaterialExpressionWorldPosition, -700, 400)
sub = mel.create_material_expression(c, unreal.MaterialExpressionSubtract, -400, 300)
mel.connect_material_expressions(pivot, "", sub, "A")
mel.connect_material_expressions(world, "", sub, "B")
mel.connect_material_property(sub, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
zero = mel.create_material_expression(c, unreal.MaterialExpressionConstant, -400, 0)
zero.set_editor_property("r", 0.0)
mel.connect_material_property(zero, "", unreal.MaterialProperty.MP_OPACITY_MASK)
mel.recompile_material(c)

saved = [eal.save_asset(DIR + "/M_BackdropUnlit", only_if_is_dirty=False), eal.save_asset(DIR + "/M_Collapsed", only_if_is_dirty=False)]
result = str({"saved": saved, "backdrop_exprs": mel.get_num_material_expressions(m), "collapsed_exprs": mel.get_num_material_expressions(c)})
print(result)
