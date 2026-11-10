# Wave PJ2, THE LIGHT STAGE's two materials (BpStageMesh.h's recipes; ABpPawn::PlaceStage loads them). Replayable: each is
# rebuilt in place.
#
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/pj2_stage.py
#
# - M_BpStage: unlit, MASKED with alpha to coverage (recipe A): no translucent full-view layer, one opaque layer that writes
#   alpha 1 (passthrough never shows through it). Emissive = Sheet.rgb * VertexColor.A * Brightness; Opacity Mask =
#   VertexColor.A (the mesh's edge and top fade), clip 0.02. "Sheet" is the console panel's render target, set at run time.
# - M_BpStageRim: unlit, additive: the far rim's thin line of light, cyan * VertexColor.A * Glow.
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
result = {}


def fresh(path, name):
    if eal.does_asset_exist(path):
        m = unreal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    return tools.create_asset(name, "/Game/Bp/Materials", unreal.Material, unreal.MaterialFactoryNew())


# ---- M_BpStage ----------------------------------------------------------------------------------------------------------
STAGE = "/Game/Bp/Materials/M_BpStage"
m = fresh(STAGE, "M_BpStage")
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
m.set_editor_property("two_sided", False)
m.set_editor_property("opacity_mask_clip_value", 0.02)
a2c = None
for prop in ("use_alpha_to_coverage", "b_use_alpha_to_coverage"):
    try:
        m.set_editor_property(prop, True)
        a2c = prop
        break
    except Exception as e:  # noqa: BLE001
        result.setdefault("a2c_errors", []).append(str(e))
result["alpha_to_coverage"] = a2c

tex = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -800, -100)
tex.set_editor_property("parameter_name", "Sheet")
black = unreal.load_asset("/Engine/EngineResources/Black")
if black:
    tex.set_editor_property("texture", black)
tex.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
vc = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -800, 200)
bright = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -800, 350)
bright.set_editor_property("parameter_name", "Brightness")
bright.set_editor_property("default_value", 0.95)
mul_a = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -500, 0)
mel.connect_material_expressions(tex, "RGB", mul_a, "A")
mel.connect_material_expressions(vc, "A", mul_a, "B")
mul_b = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -300, 100)
mel.connect_material_expressions(mul_a, "", mul_b, "A")
mel.connect_material_expressions(bright, "", mul_b, "B")
mel.connect_material_property(mul_b, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.connect_material_property(vc, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
mel.recompile_material(m)
result["stage"] = {"saved": eal.save_asset(STAGE, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(m),
                   "blend": str(m.get_editor_property("blend_mode"))}

# ---- M_BpStageRim -------------------------------------------------------------------------------------------------------
RIM = "/Game/Bp/Materials/M_BpStageRim"
r = fresh(RIM, "M_BpStageRim")
r.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
r.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
r.set_editor_property("two_sided", True)
colour = mel.create_material_expression(r, unreal.MaterialExpressionVectorParameter, -700, 0)
colour.set_editor_property("parameter_name", "RimColor")
# #7FE0FF (BpSheet::Accent) as linear.
colour.set_editor_property("default_value", unreal.LinearColor(0.212, 0.745, 1.0, 1.0))
glow = mel.create_material_expression(r, unreal.MaterialExpressionScalarParameter, -700, 200)
glow.set_editor_property("parameter_name", "Glow")
glow.set_editor_property("default_value", 1.6)
rvc = mel.create_material_expression(r, unreal.MaterialExpressionVertexColor, -700, 350)
m1 = mel.create_material_expression(r, unreal.MaterialExpressionMultiply, -450, 100)
mel.connect_material_expressions(colour, "", m1, "A")
mel.connect_material_expressions(glow, "", m1, "B")
m2 = mel.create_material_expression(r, unreal.MaterialExpressionMultiply, -250, 200)
mel.connect_material_expressions(m1, "", m2, "A")
mel.connect_material_expressions(rvc, "A", m2, "B")
mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(r)
result["rim"] = {"saved": eal.save_asset(RIM, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(r)}
print(result)
