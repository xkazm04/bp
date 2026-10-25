# Content step (spark vr-fidelity-40 FP, elements 5, 13 and 15): furniture that reads by its form at any angle, a back
# wall that no longer glows mauve, and light that shows in the air. After fo_look.py; then fid_bake.py (the back wall's
# albedo changes its bounce). Replayable: M_Glyph is rebuilt in place (it supersedes fc3_sheet.py's section 3), the back
# wall's override instances are made or updated, and every setting is set, not added.
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fp-look.jsonl
#
# - M_Glyph: fc3_sheet.py's glyph lit by fresnel only went uniformly bright at the far wings' grazing angle, every face
#   at the rim, so wings A and B read as grey smears (the judge, elements 4 and 5). A top term now lights the faces that
#   look up (desk and table tops, seats, shelf tops) and the rim term is weaker, so a glyph reads by its form:
#     emissive = GlyphColor * GlyphGlow * (GlyphBase + GlyphTop * saturate(N.z) + GlyphRim * fresnel^2) * Show
# - The back wall (StudioWallKitBack, the wall kit's two slots) gets darker albedo through override instances of the
#   kit's own materials (BaseColorFactor), so the baked lamp and fill no longer paint it mauve; the kit's materials, and
#   the side wall that shares them, are untouched (an Interchange re-import keeps the overrides).
# - The room veil (HazeRoomVeil, blue over the warm wall: the mauve's other half) fades out.
# - Volumetric fog from the camera on (start 0, it began at 180 cm, past the table), and the lights that should show in
#   the air scatter into it: the agent's glow (warm around its head), the table's key and the frame fill (the sheet's
#   blue light over the table). Static lights do not scatter (they are baked); the scan's light is ABpTable's veil.
import unreal

GLYPH = "/Game/Bp/Materials/M_Glyph"
CYAN = unreal.LinearColor(0.5209956, 0.8069523, 1.0, 1.0)  # #BFE8FF, fc3_sheet.py
GLYPH_GLOW = 0.45
GLYPH_BASE = 0.06
GLYPH_TOP = 1.6
GLYPH_RIM = 0.08
BACK_WALL = 0.25          # BaseColorFactor on the back wall's override instances
ROOM_VEIL_GLOW = 0.0     # fo_look.py 0.035
FOG = {"start_distance": 0.0, "fog_density": 0.2}
SCATTER = {"AgentGlow": 300.0, "TableKey": 60.0, "FrameFill": 15.0}

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
les.load_level("/Game/Maps/LightTable")
result = {}


def by_label(label):
    return next((a for a in eas.get_all_level_actors() if a.get_actor_label() == label), None)


# ---- 1. M_Glyph -------------------------------------------------------------------------------------------------------
m = unreal.load_asset(GLYPH)
for old in list(mel.get_material_expressions(m)):
    mel.delete_material_expression(m, old)
m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
m.set_editor_property("two_sided", False)
m.set_editor_property("used_with_instanced_static_meshes", True)


def add(cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def wire(a, b, pin, out=""):
    if not mel.connect_material_expressions(a, out, b, pin):
        raise RuntimeError("could not wire %s -> %s" % (out, pin))


colour = add(unreal.MaterialExpressionVectorParameter, -1100, -200, parameter_name="GlyphColor", default_value=CYAN)
glow = add(unreal.MaterialExpressionScalarParameter, -1100, 0, parameter_name="GlyphGlow", default_value=GLYPH_GLOW)
base = add(unreal.MaterialExpressionScalarParameter, -1100, 150, parameter_name="GlyphBase", default_value=GLYPH_BASE)
top = add(unreal.MaterialExpressionScalarParameter, -1100, 250, parameter_name="GlyphTop", default_value=GLYPH_TOP)
rim_k = add(unreal.MaterialExpressionScalarParameter, -1100, 350, parameter_name="GlyphRim", default_value=GLYPH_RIM)
normal = add(unreal.MaterialExpressionVertexNormalWS, -1100, 450)
up = add(unreal.MaterialExpressionComponentMask, -950, 450, r=False, g=False, b=True, a=False)
wire(normal, up, "")
up_sat = add(unreal.MaterialExpressionSaturate, -820, 450)
wire(up, up_sat, "")
top_term = add(unreal.MaterialExpressionMultiply, -700, 300)
wire(top, top_term, "A")
wire(up_sat, top_term, "B")
fresnel = add(unreal.MaterialExpressionFresnel, -1100, 600, exponent=2.0, base_reflect_fraction=0.0)
rim_term = add(unreal.MaterialExpressionMultiply, -700, 500)
wire(rim_k, rim_term, "A")
wire(fresnel, rim_term, "B")
sum1 = add(unreal.MaterialExpressionAdd, -550, 250)
wire(base, sum1, "A")
wire(top_term, sum1, "B")
lit_k = add(unreal.MaterialExpressionAdd, -420, 350)
wire(sum1, lit_k, "A")
wire(rim_term, lit_k, "B")
tint = add(unreal.MaterialExpressionMultiply, -550, -100)
wire(colour, tint, "A")
wire(glow, tint, "B")
lit = add(unreal.MaterialExpressionMultiply, -300, 50)
wire(tint, lit, "A")
wire(lit_k, lit, "B")
show = add(unreal.MaterialExpressionPerInstanceCustomData, -300, 450, data_index=0, const_default_value=1.0)
shown = add(unreal.MaterialExpressionMultiply, -150, 150)
wire(lit, shown, "A")
wire(show, shown, "B")
mel.connect_material_property(shown, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
mel.recompile_material(m)
eal.save_asset(GLYPH, only_if_is_dirty=False)
result["glyph"] = {"expressions": mel.get_num_material_expressions(m), "top": GLYPH_TOP, "rim": GLYPH_RIM, "base": GLYPH_BASE}

# ---- 2. The back wall's override instances ------------------------------------------------------------------------------
wall = by_label("StudioWallKitBack").static_mesh_component
made = {}
for slot, name in ((0, "MI_WallKitBackDark"), (1, "MI_WallSheetsBackDark")):
    path = "/Game/Bp/Materials/" + name
    current = wall.get_material(slot)
    # The kit's own material is the parent, also on a re-run (where the slot already holds this override).
    parent = current.get_editor_property("parent") if current.get_name() == name else current
    if eal.does_asset_exist(path):
        mi = unreal.load_asset(path)
    else:
        mi = tools.create_asset(name, "/Game/Bp/Materials", unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    mel.set_material_instance_vector_parameter_value(mi, "BaseColorFactor", unreal.LinearColor(BACK_WALL, BACK_WALL, BACK_WALL, 1.0))
    eal.save_loaded_asset(mi, only_if_is_dirty=False)
    wall.set_material(slot, mi)
    made[name] = parent.get_path_name()
result["back_wall"] = {"factor": BACK_WALL, "parents": made}

# ---- 3. The room veil, the fog and the lights that scatter --------------------------------------------------------------
veil = unreal.load_asset("/Game/Bp/Materials/MI_HazeRoomVeil")
mel.set_material_instance_scalar_parameter_value(veil, "Glow", ROOM_VEIL_GLOW)
eal.save_loaded_asset(veil, only_if_is_dirty=False)
fog = by_label("StudioFog").get_component_by_class(unreal.ExponentialHeightFogComponent)
for k, v in FOG.items():
    fog.set_editor_property(k, v)
fog.set_editor_property("enable_volumetric_fog", True)
for label, v in SCATTER.items():
    by_label(label).get_component_by_class(unreal.LightComponent).set_editor_property("volumetric_scattering_intensity", v)
result["air"] = {"room_veil_glow": ROOM_VEIL_GLOW, "fog": FOG, "scatter": SCATTER}
result["saved"] = les.save_current_level()
