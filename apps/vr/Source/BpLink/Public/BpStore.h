// The app's own saved state (the pairing token, the Wi-Fi door, the volumes and settings, the talk consent, the stand-up's
// day): one small file, Saved/BpTable.json, independent of GConfig. On the Quest the engine deletes a saved
// GameUserSettings.ini at the next launch (an empty save of that branch at startup), so nothing kept there survived.
// Game thread only. A flat JSON object: section -> { key -> string }.
#pragma once

#include "CoreMinimal.h"

struct BPLINK_API FBpStore
{
	static bool GetString(const TCHAR* Section, const TCHAR* Key, FString& Out);
	static bool GetFloat(const TCHAR* Section, const TCHAR* Key, float& Out);
	static bool GetBool(const TCHAR* Section, const TCHAR* Key, bool& Out);
	static void SetString(const TCHAR* Section, const TCHAR* Key, const FString& Value);
	static void SetFloat(const TCHAR* Section, const TCHAR* Key, float Value);
	static void SetBool(const TCHAR* Section, const TCHAR* Key, bool Value);
	static void RemoveKey(const TCHAR* Section, const TCHAR* Key);
	static void EmptySection(const TCHAR* Section);
	/** Writes the file when something changed since the last write (a temp file, then a move over the old one). */
	static void Flush();
	/** Saved/BpTable.json. */
	static FString Path();
};
