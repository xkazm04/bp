# Wave C1 content step: the scan line takes the lens's colour (the scan theatre's sweep, BpScanTheatre.cpp). Run outside PIE:
#   node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/c1_scan_tint.py --log apps/vr/tools/mcp-steps/c1-scan-tint.jsonl
# - MPC_BpScan gains a vector `ScanTint` (default the line's own cyan, fg_holo.py's SCAN_CYAN #38C8FF linear), which
#   ABpTable::WriteScanParams writes on a change only (the lens's accent while the theatre follows a scan, else the default).
# - In M_BlueprintPaper and M_EdgeGlow, the custom node's `Scan` input (fg_holo.py wires a constant SCAN_CYAN there) is
#   rewired to a collection parameter reading ScanTint. Nothing else in either graph changes: the band's shape, width and
#   strength stay as they were, and with the default the look is unchanged.
# Replayable: a collection that already has ScanTint keeps it; an input already on ScanTint is wired again to the same.
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
MPC = "/Game/Bp/Materials/MPC_BpScan"
MATERIALS = ["/Game/Bp/Materials/M_BlueprintPaper", "/Game/Bp/Materials/M_EdgeGlow"]
SCAN_CYAN = unreal.LinearColor(0.0395462, 0.5775804, 1.0, 1.0)
result = {}

mpc = unreal.load_asset(MPC)
vectors = list(mpc.get_editor_property("vector_parameters"))
if not any(str(v.get_editor_property("parameter_name")) == "ScanTint" for v in vectors):
    p = unreal.CollectionVectorParameter()
    p.set_editor_property("parameter_name", "ScanTint")
    p.set_editor_property("default_value", SCAN_CYAN)
    vectors.append(p)
    mpc.set_editor_property("vector_parameters", vectors)
    result["mpc"] = "ScanTint added"
else:
    result["mpc"] = "ScanTint kept"
result["mpc_vectors"] = [str(v.get_editor_property("parameter_name")) for v in mpc.get_editor_property("vector_parameters")]
result["mpc_saved"] = eal.save_asset(MPC, only_if_is_dirty=False)

for path in MATERIALS:
    m = unreal.load_asset(path)
    node = mel.get_material_property_input_node(m, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    names = [str(n) for n in mel.get_material_expression_input_names(node)] if node else []
    if not node or "Scan" not in names:
        result[path] = "no custom node with a Scan input on Emissive: left alone (%s)" % names
        continue
    tint = mel.create_material_expression(m, unreal.MaterialExpressionCollectionParameter, -1200, 1600)
    tint.set_editor_property("collection", mpc)
    tint.set_editor_property("parameter_name", "ScanTint")
    mask = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -1000, 1600)
    for k, v in (("r", True), ("g", True), ("b", True), ("a", False)):
        mask.set_editor_property(k, v)
    mel.connect_material_expressions(tint, "", mask, "")
    ok = mel.connect_material_expressions(mask, "", node, "Scan")
    mel.recompile_material(m)
    result[path] = {"rewired": ok, "saved": eal.save_asset(path, only_if_is_dirty=False), "expressions": mel.get_num_material_expressions(m)}
print(result)
