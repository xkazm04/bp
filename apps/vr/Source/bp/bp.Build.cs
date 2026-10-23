// Copyright Epic Games, Inc. All Rights Reserved.
// The template's game module, plus the table (lynx-plan L3.2): ABpTable reads the plan BpLink already fetched (BpLink),
// draws the sheet into a canvas render target (Engine, RenderCore for GWhiteTexture) and puts its text in world-space
// widgets built in C++ (UMG's UWidgetComponent, Slate's STextBlock).

using UnrealBuildTool;

public class bp : ModuleRules
{
	public bp(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput" });

		PrivateDependencyModuleNames.AddRange(new string[] { "BpLink", "RenderCore", "UMG", "Slate", "SlateCore" });
	}
}
