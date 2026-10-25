# Spark vr-fidelity-40 FG content step: the hologram materials rebuilt with analytic linework (r6 section 2), through
# PoFScriptTools.run_python. Run outside PIE, after materials.toolscript.py, edge_glow.py and fc1_marks.py: it rebuilds
# M_BlueprintPaper and M_EdgeGlow in place (the scan band included, so fc1_marks.py's band patch is not run on top of
# it again), makes M_PinHalo, and sets the tags' glow and the frame's strip and finish.
#   node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fg-holo.jsonl
# Replayable: each material is emptied of its expressions and rebuilt (deleting one fails while the editor holds it).
#
# Lines drawn inside a surface are a screen-space quantity: MSAA smooths geometric edges only, and a line under a pixel
# wide shimmers. So every line here is analytic, antialiased with its own screen-space derivative (fw = |ddx| + |ddy|,
# UE has no fwidth node), drawn at least one pixel wide and dimmed by desired / drawn width instead of breaking up
# (Golus's "phone-wire" rule), and a grid fades out where its cells fall under a few pixels instead of aliasing.
#
# - M_BlueprintPaper (wire contract with ABpTable unchanged: `Sheet`, `SheetStrength`, `PaperGlow`, `InkGlow`): the light
#   box as an emissive blue, brightest at the centre (`PaperCentre` to `PaperEdge` toward the corners, times PaperGlow);
#   the grid computed here (a fine line every GridFineCm, a major one every GRID_MAJOR_EVERY, ABpTable's grid constants),
#   so the sheet render target carries only the drawing's ink; a crisp white line just inside the paper's edge with a
#   short glow inward (the concept's light strip); the sheet's ink over all that at InkGlow, under the bloom threshold.
# - M_EdgeGlow (wire contract unchanged: custom data 0 to 2 size in cm, 3 Show, 4 face factor; `EdgeWidthCm`,
#   `FaceOpacity`, `Intensity`): additive and unlit, so overlapping glass needs no sort and never fights the additive
#   glyphs or the tags (order-independent). An edge is a line EdgeWidthCm in from it, at least EDGE_MIN_PX wide, with a
#   halo HaloPx pixels wide built into the shader; a face adds only FaceOpacity x fresnel^3 (nearly clear face-on,
#   tinted at grazing angles, as glass). Show dims below 1 and brightens above 1 (the lifted room).
# - M_PinHalo: additive, unlit, on a sphere around each bead (ABpTable's PinHalos): amber x (N.V)^HaloPow, a soft round
#   glow that is brightest over the bead and gone at its rim, faded where it meets the paper (DepthFade).
# - The scan band (fc1_marks.py's profile: core + 0.35 trail + 0.35 glow, inside its length, times its strength) is
#   computed by one shared function in both hologram materials.
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()

PAPER = "/Game/Bp/Materials/M_BlueprintPaper"
EDGE = "/Game/Bp/Materials/M_EdgeGlow"
HALO = "/Game/Bp/Materials/M_PinHalo"
TAG = "/Game/Bp/Materials/M_PinTag"
MPC = "/Game/Bp/Materials/MPC_BpScan"
FRAME_GLOW = "/Game/Bp/Art/LightTableFrame/final/Materials/frame_edge_glow"
FRAME_ATLAS = "/Game/Bp/Art/LightTableFrame/final/Materials/frame_atlas"


def lin(hex_rgb):
    """An sRGB hex colour as linear."""
    v = [int(hex_rgb[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return unreal.LinearColor(*[c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v], 1.0)


# ABpTable's paper and grid (BpTable.h: PaperWidthCm, PaperDepthCm, GridFineCm = PaperTileCm / 32, GridMajorEvery).
PAPER_CM = (166.0, 76.0)
GRID_FINE_CM = 50.0 / 32.0
GRID_MAJOR_EVERY = 4.0
# The concept's paper: #1E5BD8 glowing at the centre, #123A8C toward the rim (the brief's reading of the target). Those
# hexes as emissive went cyan and pale through the filmic curve and the grade (capture median (45, 118, 168) against the
# target's (13, 44, 82)), so the emissive is set lower and bluer, by capture: centre median (24, 66, 140), PaperGlow 1.6.
PAPER_CENTRE = unreal.LinearColor(0.010, 0.055, 0.40, 1.0)
PAPER_EDGE = unreal.LinearColor(0.004, 0.022, 0.17, 1.0)
CYAN_WHITE = lin("BFE8FF")
SCAN_CYAN = lin("38C8FF")
PIN_AMBER = lin("FFB547")
# The halo's own amber, greener than the pin's: added over the blue paper, the pin's amber read pink (capture t10).
HALO_AMBER = unreal.LinearColor(1.0, 0.55, 0.08, 1.0)
# The grid: line widths (cm on the paper) and their ink (fraction of cyan-white over the paper).
GRID_FINE_W = 0.05
GRID_MAJOR_W = 0.09
GRID_FINE_INK = 0.10
GRID_MAJOR_INK = 0.22
# The edge line: this far in from the paper's edge, this wide, at this glow (white, above the bloom threshold), and a glow
# EDGE_SPREAD_CM deep inward at EDGE_HALO.
EDGE_INSET_CM = 0.35
EDGE_W = 0.12
EDGE_GLOW = 2.5
EDGE_SPREAD_CM = 1.2
EDGE_HALO = 0.25
PAPER_BAND_GLOW = 12.0
# M_EdgeGlow's defaults (ABpTable sets FaceOpacity and Intensity per batch, not the rest).
EDGE_WIDTH_CM = 0.06
EDGE_MIN_PX = 1.0
HALO_PX = 3.0
HALO_K = 0.25
FACE_BASE = 0.1
FACE_FRES = 2.0
EDGE_BAND_GLOW = 3.5
# The pins' halo.
HALO_GLOW = 0.9
HALO_POW = 3.5
HALO_FADE_CM = 0.6
TAG_GLOW = 1.3
# The frame: its strip a glowing line, not a lit white bar (its white base colour took the fill light and the
# reflections: with its emissive at 0 it still read as a thick white bar, Lynx 2026-10-25), and its finish darker,
# silver-grey, as the concept's frame around the strip.
# FK, for FJ's frame (c86a0c4: a thin line in a slim silver rim whose atlas carries its own grey): the strip's base
# #0A0F18 and emissive #F4FAFF (linear), its strength and the atlas tint by capture.
FRAME_STRIP_BASE = (0.003, 0.0048, 0.0091)
FRAME_STRIP_EMISSIVE = (0.9047, 0.956, 1.0)
FRAME_STRIP_STRENGTH = 4.0
# 1.0 (untinted) lit the slim rim a flat light grey under FrameFill, a wide pale band round the line (fk/hero1); the
# concept's frame is dark round its glowing strip.
FRAME_TINT = 0.35
# The city through the window (element 14): fe_atmos.py's 6 doubled, so more of its lights cross the bloom threshold
# and halate like the concept's bokeh city. Replay fe_atmos.py before this step.
CITY_EMISSIVE = 12.0

BAND_HLSL = """
float d = dot(Rel, Axis.xyz);
float s = dot(Rel, Side.xyz);
float w = max(Centre.w, 0.001);
float core = saturate(1 - abs(d) / w); core *= core;
float trail = saturate(1 + d / (6 * w)) * saturate(-d * 100);
float glow = saturate(1 - abs(d) / (14 * w)); glow *= glow;
return (core + 0.35 * trail + 0.35 * glow) * saturate(Side.w - abs(s)) * Axis.w;
"""

PAPER_HLSL = """
float2 size = float2(%(W)f, %(D)f);
float2 cm = UV * size;
float2 fw = max(abs(ddx(cm)) + abs(ddy(cm)), 1e-4);
float fine = %(FINE)f, major = %(FINE)f * %(EVERY)f;
float2 df = abs(frac(cm / fine + 0.5) - 0.5) * fine;
float2 dm = abs(frac(cm / major + 0.5) - 0.5) * major;
float2 wf = max(%(FW)f, fw), wm = max(%(MW)f, fw);
float2 lf = (1 - smoothstep(wf * 0.5 - fw * 0.5, wf * 0.5 + fw * 0.5, df)) * (%(FW)f / wf) * saturate(fine / fw / 4 - 1);
float2 lm = (1 - smoothstep(wm * 0.5 - fw * 0.5, wm * 0.5 + fw * 0.5, dm)) * (%(MW)f / wm) * saturate(major / fw / 4 - 1);
float grid = max(max(lf.x, lf.y) * %(FI)f, max(lm.x, lm.y) * %(MI)f);
float2 q = (cm - size * 0.5) / (size * 0.5);
float t = saturate(dot(q * float2(0.9, 1.0), q * float2(0.9, 1.0)) * 0.5);
float3 col = lerp(Centre, Edge, t) * PaperGlow;
col += Ink * grid;
col = lerp(col, Sheet.rgb * InkGlow, saturate(Sheet.a * SheetStrength));
float de = min(min(cm.x, size.x - cm.x), min(cm.y, size.y - cm.y));
float fe = max(0.5 * (fw.x + fw.y), 1e-4);
float we = max(%(EW)f, fe);
float el = (1 - smoothstep(we * 0.5 - fe * 0.5, we * 0.5 + fe * 0.5, abs(de - %(EI)f))) * (%(EW)f / we);
float eh = exp(-max(de - %(EI)f, 0) / %(ES)f) * %(EH)f;
col += float3(1, 1, 1) * el * %(EG)f + Ink * eh;
col += Band * Scan * %(BG)f;
return col;
""" % {"W": PAPER_CM[0], "D": PAPER_CM[1], "FINE": GRID_FINE_CM, "EVERY": GRID_MAJOR_EVERY, "FW": GRID_FINE_W,
       "MW": GRID_MAJOR_W, "FI": GRID_FINE_INK, "MI": GRID_MAJOR_INK, "EW": EDGE_W, "EI": EDGE_INSET_CM,
       "ES": EDGE_SPREAD_CM, "EH": EDGE_HALO, "EG": EDGE_GLOW, "BG": PAPER_BAND_GLOW}

EDGE_HLSL = """
float3 d3 = min(P, 1 - P) * Size;
float mn = min(d3.x, min(d3.y, d3.z));
float mx = max(d3.x, max(d3.y, d3.z));
float mid = d3.x + d3.y + d3.z - mn - mx;
float aa = max(abs(ddx(mid)) + abs(ddy(mid)), 1e-4);
float w = max(EdgeWidthCm, aa * %(MINPX)f);
float core = (1 - smoothstep(w - aa * 0.5, w + aa * 0.5, mid)) * saturate(EdgeWidthCm / w);
float halo = exp(-mid / (aa * HaloPx)) * HaloK;
float nv = abs(dot(normalize(N), V));
float fres = pow(1 - nv, 3);
float face = FaceOpacity * (%(FB)f + %(FF)f * fres) * FaceFactor;
float lit = saturate(Show) * max(Show, 1);
float3 col = Cyan * (Intensity * (core + halo) + face) * lit;
col += Scan * Band * %(BG)f * (0.4 + core) * saturate(Show);
return col;
""" % {"MINPX": EDGE_MIN_PX, "FB": FACE_BASE, "FF": FACE_FRES, "BG": EDGE_BAND_GLOW}

HALO_HLSL = """
float nv = saturate(dot(normalize(N), V));
return Amber * HaloGlow * pow(nv, HaloPow) * Fade;
"""

result = {}


def fresh(path):
    if eal.does_asset_exist(path):
        m = unreal.load_asset(path)
        for old in list(mel.get_material_expressions(m)):
            mel.delete_material_expression(m, old)
        return m
    folder, name = path.rsplit("/", 1)
    return tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())


class Graph:
    def __init__(self, m):
        self.m = m

    def add(self, cls, x, y, **props):
        e = mel.create_material_expression(self.m, cls, x, y)
        for k, v in props.items():
            e.set_editor_property(k, v)
        return e

    def wire(self, a, b, pin, out=""):
        if not mel.connect_material_expressions(a, out, b, pin):
            raise RuntimeError("could not wire %s.%s -> %s.%s" % (a.get_name(), out, b.get_name(), pin))

    def scalar(self, name, value, x, y):
        return self.add(unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)

    def vector(self, name, value, x, y):
        return self.add(unreal.MaterialExpressionVectorParameter, x, y, parameter_name=name, default_value=value)

    def const3(self, value, x, y):
        return self.add(unreal.MaterialExpressionConstant3Vector, x, y, constant=value)

    def custom(self, desc, code, out_type, names, x, y):
        inputs = []
        for n in names:
            ci = unreal.CustomInput()
            ci.set_editor_property("input_name", n)
            inputs.append(ci)
        return self.add(unreal.MaterialExpressionCustom, x, y, code=code, description=desc, output_type=out_type,
                        inputs=inputs)

    def band(self, x, y):
        """The scan band (a scalar) from MPC_BpScan at this pixel's world position."""
        mpc = unreal.load_asset(MPC)
        world = self.add(unreal.MaterialExpressionWorldPosition, x, y)
        centre = self.add(unreal.MaterialExpressionCollectionParameter, x, y + 150, collection=mpc, parameter_name="ScanCentre")
        axis = self.add(unreal.MaterialExpressionCollectionParameter, x, y + 300, collection=mpc, parameter_name="ScanAxis")
        side = self.add(unreal.MaterialExpressionCollectionParameter, x, y + 450, collection=mpc, parameter_name="ScanSide")
        c_xyz = self.add(unreal.MaterialExpressionComponentMask, x + 200, y + 150, r=True, g=True, b=True, a=False)
        self.wire(centre, c_xyz, "")
        rel = self.add(unreal.MaterialExpressionSubtract, x + 350, y)
        self.wire(world, rel, "A")
        self.wire(c_xyz, rel, "B")
        band = self.custom("scan band", BAND_HLSL, unreal.CustomMaterialOutputType.CMOT_FLOAT1,
                           ["Rel", "Centre", "Axis", "Side"], x + 550, y + 200)
        self.wire(rel, band, "Rel")
        self.wire(centre, band, "Centre")
        self.wire(axis, band, "Axis")
        self.wire(side, band, "Side")
        return band


# ---- 1. M_BlueprintPaper -------------------------------------------------------------------------------------------
m = fresh(PAPER)
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
g = Graph(m)
uv = g.add(unreal.MaterialExpressionTextureCoordinate, -1400, -400)
sheet = g.add(unreal.MaterialExpressionTextureSampleParameter2D, -1400, -250, parameter_name="Sheet",
              texture=unreal.load_asset("/Engine/EngineResources/Black"))
sheet.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
paper = g.custom("holo paper", PAPER_HLSL, unreal.CustomMaterialOutputType.CMOT_FLOAT3,
                 ["UV", "Sheet", "SheetStrength", "PaperGlow", "InkGlow", "Centre", "Edge", "Ink", "Scan", "Band"], -400, 0)
g.wire(uv, paper, "UV")
g.wire(sheet, paper, "Sheet", "RGBA")
g.wire(g.scalar("SheetStrength", 0.0, -1000, 0), paper, "SheetStrength")
g.wire(g.scalar("PaperGlow", 1.0, -1000, 100), paper, "PaperGlow")
g.wire(g.scalar("InkGlow", 1.0, -1000, 200), paper, "InkGlow")
g.wire(g.vector("PaperCentre", PAPER_CENTRE, -1000, 300), paper, "Centre")
g.wire(g.vector("PaperEdge", PAPER_EDGE, -1000, 450), paper, "Edge")
g.wire(g.const3(CYAN_WHITE, -1000, 600), paper, "Ink")
g.wire(g.const3(SCAN_CYAN, -1000, 700), paper, "Scan")
g.wire(g.band(-1600, 800), paper, "Band")
mel.connect_material_property(paper, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
# ABpTable's other paper scalars (TilesU, TilesV, VignetteEdge) are set on a material without them: a no-op.
mel.recompile_material(m)
result["paper"] = {"saved": eal.save_asset(PAPER, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(m)}

# ---- 2. M_EdgeGlow -------------------------------------------------------------------------------------------------
m = fresh(EDGE)
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)
m.set_editor_property("used_with_instanced_static_meshes", True)
g = Graph(m)
pos = g.add(unreal.MaterialExpressionPreSkinnedPosition, -2000, -200)
pos_vi = g.add(unreal.MaterialExpressionVertexInterpolator, -1800, -200)
g.wire(pos, pos_vi, "VS")
unit = g.add(unreal.MaterialExpressionMultiply, -1600, -200, const_b=0.01)
g.wire(pos_vi, unit, "A")
p = g.add(unreal.MaterialExpressionAdd, -1450, -200, const_b=0.5)
g.wire(unit, p, "A")
size = g.add(unreal.MaterialExpressionPerInstanceCustomData3Vector, -2200, 100, data_index=0,
             const_default_value=unreal.LinearColor(100.0, 100.0, 100.0, 0.0))
show = g.add(unreal.MaterialExpressionPerInstanceCustomData, -2200, 300, data_index=3, const_default_value=1.0)
size_show = g.add(unreal.MaterialExpressionAppendVector, -2000, 200)
g.wire(size, size_show, "A")
g.wire(show, size_show, "B")
size_show_vi = g.add(unreal.MaterialExpressionVertexInterpolator, -1850, 200)
g.wire(size_show, size_show_vi, "VS")
size_vi = g.add(unreal.MaterialExpressionComponentMask, -1700, 100, r=True, g=True, b=True, a=False)
g.wire(size_show_vi, size_vi, "")
show_vi = g.add(unreal.MaterialExpressionComponentMask, -1700, 400, r=False, g=False, b=False, a=True)
g.wire(size_show_vi, show_vi, "")
face_factor = g.add(unreal.MaterialExpressionPerInstanceCustomData, -2200, 500, data_index=4, const_default_value=1.0)
face_factor_vi = g.add(unreal.MaterialExpressionVertexInterpolator, -1850, 500)
g.wire(face_factor, face_factor_vi, "VS")
edge = g.custom("holo edges", EDGE_HLSL, unreal.CustomMaterialOutputType.CMOT_FLOAT3,
                ["P", "Size", "Show", "FaceFactor", "N", "V", "EdgeWidthCm", "FaceOpacity", "Intensity", "HaloPx", "HaloK",
                 "Cyan", "Scan", "Band"], -400, 0)
g.wire(p, edge, "P")
g.wire(size_vi, edge, "Size")
g.wire(show_vi, edge, "Show")
g.wire(face_factor_vi, edge, "FaceFactor")
g.wire(g.add(unreal.MaterialExpressionPixelNormalWS, -1000, 600), edge, "N")
g.wire(g.add(unreal.MaterialExpressionCameraVectorWS, -1000, 700), edge, "V")
g.wire(g.scalar("EdgeWidthCm", EDGE_WIDTH_CM, -1000, 800), edge, "EdgeWidthCm")
g.wire(g.scalar("FaceOpacity", 0.06, -1000, 900), edge, "FaceOpacity")
g.wire(g.scalar("Intensity", 1.4, -1000, 1000), edge, "Intensity")
g.wire(g.scalar("HaloPx", HALO_PX, -1000, 1100), edge, "HaloPx")
g.wire(g.scalar("HaloK", HALO_K, -1000, 1200), edge, "HaloK")
g.wire(g.const3(CYAN_WHITE, -1000, 1300), edge, "Cyan")
g.wire(g.const3(SCAN_CYAN, -1000, 1400), edge, "Scan")
g.wire(g.band(-1600, 1500), edge, "Band")
mel.connect_material_property(edge, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
# Show 0 hides an instance without hiding its batch (edge_glow.py): the vertex shader folds it onto its own pivot.
fold = g.add(unreal.MaterialExpressionMultiply, -1600, 2000, const_b=-1.0)
g.wire(pos, fold, "A")
fold_ws = g.add(unreal.MaterialExpressionTransform, -1400, 2000,
                transform_source_type=unreal.MaterialVectorCoordTransformSource.TRANSFORMSOURCE_LOCAL,
                transform_type=unreal.MaterialVectorCoordTransform.TRANSFORM_WORLD)
g.wire(fold, fold_ws, "")
shown_any = g.add(unreal.MaterialExpressionMultiply, -1600, 2200, const_b=10000.0)
g.wire(show, shown_any, "A")
shown_sat = g.add(unreal.MaterialExpressionSaturate, -1450, 2200)
g.wire(shown_any, shown_sat, "")
hidden = g.add(unreal.MaterialExpressionOneMinus, -1300, 2200)
g.wire(shown_sat, hidden, "")
folded = g.add(unreal.MaterialExpressionMultiply, -1150, 2050)
g.wire(fold_ws, folded, "A")
g.wire(hidden, folded, "B")
mel.connect_material_property(folded, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
mel.recompile_material(m)
result["edge"] = {"saved": eal.save_asset(EDGE, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(m),
                  "blend": str(m.get_editor_property("blend_mode"))}

# ---- 3. M_PinHalo ---------------------------------------------------------------------------------------------------
m = fresh(HALO)
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("used_with_instanced_static_meshes", True)
g = Graph(m)
halo = g.custom("pin halo", HALO_HLSL, unreal.CustomMaterialOutputType.CMOT_FLOAT3,
                ["N", "V", "Amber", "HaloGlow", "HaloPow", "Fade"], -400, 0)
g.wire(g.add(unreal.MaterialExpressionPixelNormalWS, -1000, 0), halo, "N")
g.wire(g.add(unreal.MaterialExpressionCameraVectorWS, -1000, 100), halo, "V")
g.wire(g.vector("PinColor", HALO_AMBER, -1000, 200), halo, "Amber")
g.wire(g.scalar("HaloGlow", HALO_GLOW, -1000, 350), halo, "HaloGlow")
g.wire(g.scalar("HaloPow", HALO_POW, -1000, 450), halo, "HaloPow")
fade = g.add(unreal.MaterialExpressionDepthFade, -1000, 550)
g.wire(g.scalar("HaloFadeCm", HALO_FADE_CM, -1200, 650), fade, "FadeDistance")
g.wire(fade, halo, "Fade")
mel.connect_material_property(halo, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
result["halo"] = {"saved": eal.save_asset(HALO, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(m)}

# ---- 4. the tags' glow, the frame's strip and finish ---------------------------------------------------------------
tag = unreal.load_asset(TAG)
for e in mel.get_material_expressions(tag):
    if isinstance(e, unreal.MaterialExpressionScalarParameter) and str(e.get_editor_property("parameter_name")) == "TagGlow":
        e.set_editor_property("default_value", TAG_GLOW)
mel.recompile_material(tag)
eal.save_asset(TAG, only_if_is_dirty=False)
strip = unreal.load_asset(FRAME_GLOW)
mel.set_material_instance_scalar_parameter_value(strip, "EmissiveStrength", FRAME_STRIP_STRENGTH)
mel.set_material_instance_vector_parameter_value(strip, "BaseColorFactor", unreal.LinearColor(*FRAME_STRIP_BASE, 1.0))
mel.set_material_instance_vector_parameter_value(strip, "EmissiveFactor", unreal.LinearColor(*FRAME_STRIP_EMISSIVE, 1.0))
eal.save_loaded_asset(strip, only_if_is_dirty=False)
atlas = unreal.load_asset(FRAME_ATLAS)
mel.set_material_instance_vector_parameter_value(atlas, "BaseColorFactor", unreal.LinearColor(FRAME_TINT, FRAME_TINT, FRAME_TINT, 1.0))
eal.save_loaded_asset(atlas, only_if_is_dirty=False)
result["tag_glow"] = TAG_GLOW
result["frame"] = {"strip": mel.get_material_instance_scalar_parameter_value(strip, "EmissiveStrength"),
                   "tint": str(mel.get_material_instance_vector_parameter_value(atlas, "BaseColorFactor"))}
city = next(a for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
            if a.get_actor_label() == "CityBackdrop")
ci = city.static_mesh_component.get_material(0)
mel.set_material_instance_scalar_parameter_value(ci, "EmissiveStrength", CITY_EMISSIVE)
eal.save_loaded_asset(ci, only_if_is_dirty=False)
result["city"] = {"material": ci.get_path_name(), "EmissiveStrength": CITY_EMISSIVE}
