// BpLink runtime module (plan WP3.1). 2026-10-23, Lynx only (UE 5.8.4); R1 closed: the junction.
// BpLink reaches the generated USTRUCT headers through ONE path: the directory junction
// Source/BpLink/Public/Schema -> packages/schema/generated/ue, which apps/vr/tools/link-schema.ps1 makes (run it first,
// once per checkout; the junction is git-ignored machine state). Public/ is already on this module's include path, so
// BpLink and UHT's generated code both include "Schema/BpSchema.h" and "Schema/BpSchemaFixups.h", and this file adds no
// include path of its own: a second path to the same header (the old PublicIncludePaths entry into packages/schema) let
// MSVC's #pragma once see two files and broke the build (docs/concepts/vr-light-table/machine.md, readings 4-5).
// The headers stay in packages/schema (check:schema keeps them the single source); they are linked, never copied.
using UnrealBuildTool;

public class BpLink : ModuleRules
{
	public BpLink(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "Json", "JsonUtilities", "HTTP"
		});
	}
}
