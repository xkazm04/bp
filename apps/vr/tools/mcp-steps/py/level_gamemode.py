# L3.2 content step (spark vr-table): /Game/Maps/LightTable runs ABpGameMode (World Settings), so PIE and the game stand
# the player at the table's near edge whatever the project default is. Run through PoFScriptTools.run_python.
import unreal

MAP = "/Game/Maps/LightTable"
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level(MAP)
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
ws = world.get_world_settings()
ws.set_editor_property("default_game_mode", unreal.load_class(None, "/Script/bp.BpGameMode"))
result = {"map": MAP, "game_mode": str(ws.get_editor_property("default_game_mode")), "saved": les.save_current_level()}
