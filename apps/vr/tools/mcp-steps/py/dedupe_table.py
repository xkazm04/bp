# Spark vr-hands-zoom WP3 content step: /Game/Maps/LightTable held every actor twice (two LightTable tables at the origin,
# and each light, fog and exposure volume twice; level_lighttable.py ran twice in a row on 2026-10-24 and the second run
# spawned into the first's level). Two tables drew every label and volume twice, and two labels at 40 % opacity read as
# 64 %, so the levels' dimming did not show. This keeps the first table and removes any other; the doubled lights are left
# as they are, because WP2's look was tuned under them (a finding for the Director, not fixed here).
# It also saves the table's volume batches visible: a batch saved hidden registers without render state, and UE 5.8 then
# never uploads its per-instance custom data, so M_EdgeGlow reads zeros and draws nothing (Lynx, 2026-10-24).
# Run outside PIE: node apps/vr/tools/mcp-call.mjs python <this file> --log apps/vr/tools/mcp-steps/l34-levels.jsonl
import unreal

MAP = "/Game/Maps/LightTable"
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les.load_level(MAP)
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
tables = sorted(unreal.GameplayStatics.get_all_actors_of_class(world, unreal.load_class(None, "/Script/bp.BpTable")),
                key=lambda a: a.get_name())
removed = [t.get_name() for t in tables[1:]]
for extra in tables[1:]:
    eas.destroy_actor(extra)
for batch in tables[0].get_components_by_class(unreal.InstancedStaticMeshComponent):
    batch.set_visibility(True)
result = {"map": MAP, "kept": tables[0].get_name() if tables else None, "removed": removed, "saved": les.save_current_level()}
