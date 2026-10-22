// BpLink runtime module (plan WP3.1). NOT compiled against Unreal yet: see apps/vr/WP3.1.md.
// Correction 2026-10-22 (Lynx): it has, in a bpEditor build outside the repo, with WP3.1's junction Public/Schema in place
// (docs/concepts/vr-light-table/machine.md). BpLink includes the headers as "Schema/<header>", the spelling UHT's
// generated code uses; the PublicIncludePaths entry below alone does not get UHT to read BpSchema.h.
using System.IO;
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

		// The generated USTRUCT headers stay in packages/schema (check:schema keeps them the single source); they are
		// included by path, never copied. This file is apps/vr/Source/BpLink/BpLink.Build.cs, the repo root is four up.
		string SchemaUe = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "packages", "schema", "generated", "ue"));
		PublicIncludePaths.Add(SchemaUe);
	}
}
