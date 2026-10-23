# L3.2 content step (spark vr-table): M_BlueprintPaper and M_Hidden, built with EditorToolset's MaterialTools through
# ProgrammaticToolset.execute_tool_script (sandboxed: only execute_tool and json/math/re/copy/time/datetime).
# Run: node apps/vr/tools/mcp-call.mjs call editor_toolset.toolsets.programmatic.ProgrammaticToolset execute_tool_script
#      '{"script": <this file>}'  (apps/vr/tools/mcp-steps/l32-content.jsonl holds the logged call).
#
# M_BlueprintPaper (wire contract with ABpTable): Texture parameter `Sheet` (ABpTable's canvas render target; alpha = ink),
# Scalar `SheetStrength` (default 0, ABpTable sets 1), Scalars `PaperGlow` and `InkGlow`. Unlit (art-breakdown #1: the
# blue comes from the paper, lit from behind): emissive = lerp(paper * PaperGlow, sheet * InkGlow, sheet.a * SheetStrength).
# The paper's normal and ORM textures are imported for P6's beauty pass and unused here.
# M_Hidden: masked, opacity mask 0 (ABpTable puts it on the frame's glass placeholder slot).
import json

MT = "editor_toolset.toolsets.material.MaterialTools."
OT = "editor_toolset.toolsets.object.ObjectTools."
PAPER = "/Game/Bp/Materials/M_BlueprintPaper.M_BlueprintPaper"
HIDDEN = "/Game/Bp/Materials/M_Hidden.M_Hidden"
TEX = "/Game/Bp/Art/BlueprintPaper/T_BlueprintPaper_"


def call(name, **kw):
    return execute_tool(name, json.dumps(kw))["returnValue"]


def add(mat, cls, x, y, **props):
    e = call(MT + "add_expression", material_or_function=mat,
             expression_class="/Script/Engine.MaterialExpression" + cls, x=x, y=y)
    if props:
        call(OT + "set_properties", instance=e, values=json.dumps(props))
    return e


def wire(a, out, b, inp):
    call(MT + "connect_expressions", from_expression=a, from_output_name=out, to_expression=b, to_input_name=inp)


def out(e, pin, prop):
    call(MT + "connect_to_output", expression=e, output_name=pin, material_property=prop)


def fresh(path):
    # Replayable: a material from an earlier run (or a half-built one) is deleted, then rebuilt.
    if call("editor_toolset.toolsets.asset.AssetTools.exists", path=path):
        call("editor_toolset.toolsets.asset.AssetTools.delete", path=path)


def run():
    fresh(PAPER)
    fresh(HIDDEN)
    call(MT + "create_material", folder_path="/Game/Bp/Materials", asset_name="M_BlueprintPaper")
    m = PAPER
    # Unlit: the paper on a light table is lit from behind, so it glows rather than reflects (first capture,
    # 2026-10-23: lit, it washed out white under auto exposure and the lamp, with blue only at one edge).
    call(OT + "set_properties", instance=m, values=json.dumps({"ShadingModel": "MSM_Unlit"}))
    base = add(m, "TextureSample", -900, -200, Texture=TEX + "BaseColor.T_BlueprintPaper_BaseColor")
    sheet = add(m, "TextureSampleParameter2D", -900, -600, ParameterName="Sheet",
                Texture="/Engine/EngineResources/Black.Black")
    strength = add(m, "ScalarParameter", -900, -850, ParameterName="SheetStrength", DefaultValue=0.0)
    paper_glow = add(m, "ScalarParameter", -500, 100, ParameterName="PaperGlow", DefaultValue=1.0)
    ink_glow = add(m, "ScalarParameter", -500, -850, ParameterName="InkGlow", DefaultValue=1.5)

    alpha = add(m, "Multiply", -550, -650)          # sheet.a * SheetStrength
    wire(sheet, "A", alpha, "A")
    wire(strength, "", alpha, "B")
    paper_lit = add(m, "Multiply", -250, 0)          # paper * PaperGlow
    wire(base, "RGB", paper_lit, "A")
    wire(paper_glow, "", paper_lit, "B")
    ink_lit = add(m, "Multiply", -250, -700)         # sheet.rgb * InkGlow
    wire(sheet, "RGB", ink_lit, "A")
    wire(ink_glow, "", ink_lit, "B")
    emissive = add(m, "LinearInterpolate", 50, -400)  # lerp(paper, ink, alpha)
    wire(paper_lit, "", emissive, "A")
    wire(ink_lit, "", emissive, "B")
    wire(alpha, "", emissive, "Alpha")

    out(emissive, "", "MP_EmissiveColor")
    call(MT + "layout_expressions", material_or_function=m)
    call(MT + "recompile", material_or_function=m)

    call(MT + "create_material", folder_path="/Game/Bp/Materials", asset_name="M_Hidden")
    call(OT + "set_properties", instance=HIDDEN, values=json.dumps({"BlendMode": "BLEND_Masked"}))
    zero = add(HIDDEN, "Constant", -300, 0, R=0.0)
    out(zero, "", "MP_OpacityMask")
    call(MT + "recompile", material_or_function=HIDDEN)

    saved = call("editor_toolset.toolsets.asset.AssetTools.save_assets", asset_paths=[PAPER, HIDDEN])
    return {"paper": PAPER, "hidden": HIDDEN, "saved": saved}
