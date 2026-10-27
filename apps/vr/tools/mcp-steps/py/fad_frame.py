# Content step (spark vr-fidelity-40 FAD): after import_frame.py re-imports the frame (FAE's 2a44dba, warm brushed
# aluminium), put back what the re-import resets of fg_holo.py's section 4: the strip's glow (strength, dark base, cool
# emissive) and the atlas's grey multiplier, so the bronze reads dark round the strip. The values are fg_holo.py's, read
# from it, so the two never disagree. Roughness and normal factors stay the GLB's 1.0 (FAE).
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/fad-frame.jsonl
import ast
import os

import unreal

REPO = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "..", ".."))
HOLO = os.path.join(REPO, "apps", "vr", "tools", "mcp-steps", "py", "fg_holo.py")
NAMES = ("FRAME_GLOW", "FRAME_ATLAS", "FRAME_STRIP_BASE", "FRAME_STRIP_EMISSIVE", "FRAME_STRIP_STRENGTH", "FRAME_TINT")
v = {}
for node in ast.parse(open(HOLO, encoding="utf-8").read()).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", None) in NAMES:
        v[node.targets[0].id] = ast.literal_eval(node.value)

mel = unreal.MaterialEditingLibrary
strip = unreal.load_asset(v["FRAME_GLOW"])
mel.set_material_instance_scalar_parameter_value(strip, "EmissiveStrength", v["FRAME_STRIP_STRENGTH"])
mel.set_material_instance_vector_parameter_value(strip, "BaseColorFactor", unreal.LinearColor(*v["FRAME_STRIP_BASE"], 1.0))
mel.set_material_instance_vector_parameter_value(strip, "EmissiveFactor", unreal.LinearColor(*v["FRAME_STRIP_EMISSIVE"], 1.0))
unreal.EditorAssetLibrary.save_loaded_asset(strip, only_if_is_dirty=False)
atlas = unreal.load_asset(v["FRAME_ATLAS"])
t = v["FRAME_TINT"]
mel.set_material_instance_vector_parameter_value(atlas, "BaseColorFactor", unreal.LinearColor(t, t, t, 1.0))
unreal.EditorAssetLibrary.save_loaded_asset(atlas, only_if_is_dirty=False)
result = {k: v[k] for k in NAMES[2:]}
result["atlas_roughness"] = mel.get_material_instance_scalar_parameter_value(atlas, "RoughnessFactor")
