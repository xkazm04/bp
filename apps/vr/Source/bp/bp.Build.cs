// Copyright Epic Games, Inc. All Rights Reserved.
// The template's game module, plus the table (lynx-plan L3.2): ABpTable reads the plan BpLink already fetched (BpLink),
// draws the sheet into a canvas render target (Engine, RenderCore for GWhiteTexture) and puts its text in world-space
// widgets built in C++ (UMG's UWidgetComponent, Slate's STextBlock). The hands (L3.4): ABpPawn carries the Interaction
// SDK's hand and controller rigs (OculusInteractionPrebuilts) under motion controllers (HeadMountedDisplay), and UBpHands
// reads their data sources and runs the SDK's finger pinch recognizer (OculusInteraction). The headset session's frame
// meter reads the GPU's frame time (RHI). The stand-up decodes a finding's PNG screen at runtime (ImageWrapper). Talking to
// the lamp records the microphone (AudioCapture, AudioCaptureCore; AndroidPermission on the Quest). Your room shows the
// headset's passthrough under the table (OculusXRHMD, OculusXRPassthrough: Meta XR's persistent passthrough layer).

using System.IO;
using UnrealBuildTool;

public class bp : ModuleRules
{
	public bp(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput" });

		PrivateDependencyModuleNames.AddRange(new string[] { "BpLink", "Json", "RenderCore", "RHI", "UMG", "Slate", "SlateCore", "HeadMountedDisplay", "OculusInteraction", "OculusInteractionPrebuilts", "ImageWrapper", "AudioCaptureCore", "AudioCapture", "OculusXRHMD", "OculusXRPassthrough", "ProceduralMeshComponent" });

		// Talk to the lamp (BpTalk.cpp, night two W3): the microphone through UE's audio capture; on Android the runtime
		// RECORD_AUDIO request (the permission itself is in DefaultEngine.ini's ExtraPermissions).
		if (Target.Platform == UnrealTargetPlatform.Android)
		{
			PrivateDependencyModuleNames.Add("AndroidPermission");
			// Your room (BpSurround.cpp, night two W4): the Meta XR plugin writes com.oculus.feature.PASSTHROUGH as required;
			// bp_APL.xml makes it optional, so the APK installs and runs on a headset without passthrough (the studio stays).
			AdditionalPropertiesForReceipt.Add("AndroidPlugin", Path.Combine(ModuleDirectory, "bp_APL.xml"));
		}
	}
}
