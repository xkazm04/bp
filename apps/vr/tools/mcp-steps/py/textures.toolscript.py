# L3.2 content step (spark vr-table): the blueprint-paper textures from ArtSource (mat-blueprint-paper, gated), through
# EditorToolset's TextureTools/ObjectTools/AssetTools in one ProgrammaticToolset.execute_tool_script batch.
# TextureTools.import_file does not save: the first run's textures were lost when the editor restarted (2026-10-23), so
# this step saves explicitly. Replayable: import_file replaces an existing texture of the same name.
import json

SRC = "C:/Users/kazda/kiro/bp/apps/vr/ArtSource/mat-blueprint-paper/textures/blueprint-paper_"
DST = "/Game/Bp/Art/BlueprintPaper"
SETTINGS = {
    "BaseColor": None,
    "Normal": {"CompressionSettings": "TC_Normalmap", "SRGB": False},
    "ORM": {"CompressionSettings": "TC_Masks", "SRGB": False},
}


def call(name, **kw):
    return execute_tool(name, json.dumps(kw))["returnValue"]


def run():
    paths = []
    for kind, props in SETTINGS.items():
        made = call("editor_toolset.toolsets.texture.TextureTools.import_file", folder_path=DST,
                    asset_name="T_BlueprintPaper_" + kind, source_file=SRC + kind.lower() + ".png")
        path = made[0]["refPath"]
        if props:
            call("editor_toolset.toolsets.object.ObjectTools.set_properties", instance=path, values=json.dumps(props))
        paths.append(path)
    saved = call("editor_toolset.toolsets.asset.AssetTools.save_assets", asset_paths=paths)
    return {"textures": paths, "saved": saved}
