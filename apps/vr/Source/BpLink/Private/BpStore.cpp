// The app's own saved state in Saved/BpTable.json (BpStore.h): why it is not GameUserSettings.ini is written there.
#include "BpStore.h"

#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY_STATIC(LogBpStore, Log, All);

// Named, not anonymous: a unity build puts this file beside BpLink.cpp, whose helpers must not meet these.
namespace BpStoreImpl
{
	TMap<FString, TMap<FString, FString>> GSections;
	bool bLoaded = false;
	bool bDirty = false;
	/** -1 never written in this run, 0 the last write failed, 1 it succeeded. */
	int32 LastWrite = -1;

	/** Every key the app kept in GameUserSettings.ini before this file, copied once so nobody loses a setting. */
	const TCHAR* const OldKeys[][2] = {
		{ TEXT("/Script/BpLink.BpLinkSettings"), TEXT("Token") }, { TEXT("/Script/BpLink.BpLinkSettings"), TEXT("Device") },
		{ TEXT("/Script/BpLink.BpLinkSettings"), TEXT("Scopes") }, { TEXT("/Script/BpLink.BpLinkSettings"), TEXT("ExpiresAt") },
		{ TEXT("/Script/BpLink.BpLinkSettings"), TEXT("CableUrl") }, { TEXT("/Script/BpLink.BpLinkSettings"), TEXT("WifiUrl") },
		{ TEXT("/Script/bp.BpAudio"), TEXT("VoiceLevel") }, { TEXT("/Script/bp.BpAudio"), TEXT("MusicLevel") },
		{ TEXT("/Script/bp.BpVoice"), TEXT("VoiceVolume") },
		{ TEXT("/Script/bp.BpSettings"), TEXT("WristFace") }, { TEXT("/Script/bp.BpSettings"), TEXT("WristHand") },
		{ TEXT("/Script/bp.BpSettings"), TEXT("ReducedMotion") }, { TEXT("/Script/bp.BpSettings"), TEXT("Room") },
		{ TEXT("/Script/bp.BpTalk"), TEXT("Consent") }, { TEXT("/Script/bp.BpTalk"), TEXT("MicAsked") },
		{ TEXT("/Script/bp.BpStandup"), TEXT("LastStandup") }, { TEXT("/Script/bp.BpStandup"), TEXT("SampleDay") },
		{ TEXT("/Script/bp.BpStandup"), TEXT("SampleAnswers") },
	};

	void Migrate()
	{
		int32 Copied = 0;
		if (GConfig)
		{
			for (const auto& Old : OldKeys)
			{
				FString Value;
				if (GConfig->GetString(Old[0], Old[1], Value, GGameUserSettingsIni)) { GSections.FindOrAdd(Old[0]).Add(Old[1], Value); ++Copied; }
			}
		}
		UE_LOG(LogBpStore, Log, TEXT("BpStore: no %s yet: %d keys copied from GameUserSettings.ini (once)"), *FBpStore::Path(), Copied);
		bDirty = true;
		FBpStore::Flush();
	}

	void Load()
	{
		if (bLoaded) return;
		bLoaded = true;
		const FString File = FBpStore::Path();
		if (!IFileManager::Get().FileExists(*File)) { Migrate(); return; }
		FString Text;
		TSharedPtr<FJsonObject> Json;
		if (!FFileHelper::LoadFileToString(Text, *File) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Json) || !Json.IsValid())
		{
			UE_LOG(LogBpStore, Warning, TEXT("BpStore: %s did not read as JSON: an empty store (the next change rewrites it)"), *File);
			return;
		}
		for (const auto& Section : Json->Values)
		{
			const TSharedPtr<FJsonObject>* Keys = nullptr;
			if (!Section.Value.IsValid() || !Section.Value->TryGetObject(Keys) || !Keys || !Keys->IsValid()) continue;
			TMap<FString, FString>& Into = GSections.FindOrAdd(FString(*Section.Key));
			for (const auto& Key : (*Keys)->Values)
			{
				FString Value;
				if (Key.Value.IsValid() && Key.Value->TryGetString(Value)) Into.Add(FString(*Key.Key), Value);
			}
		}
		UE_LOG(LogBpStore, Log, TEXT("BpStore: read %s (%d sections)"), *File, GSections.Num());
	}

	const FString* Find(const TCHAR* Section, const TCHAR* Key)
	{
		Load();
		const TMap<FString, FString>* Keys = GSections.Find(Section);
		return Keys ? Keys->Find(Key) : nullptr;
	}
}

FString FBpStore::Path() { return FPaths::ProjectSavedDir() / TEXT("BpTable.json"); }

bool FBpStore::GetString(const TCHAR* Section, const TCHAR* Key, FString& Out)
{
	const FString* Value = BpStoreImpl::Find(Section, Key);
	if (Value) Out = *Value;
	return Value != nullptr;
}

bool FBpStore::GetFloat(const TCHAR* Section, const TCHAR* Key, float& Out)
{
	const FString* Value = BpStoreImpl::Find(Section, Key);
	if (Value) Out = FCString::Atof(**Value);
	return Value != nullptr;
}

bool FBpStore::GetBool(const TCHAR* Section, const TCHAR* Key, bool& Out)
{
	const FString* Value = BpStoreImpl::Find(Section, Key);
	if (Value) Out = FCString::ToBool(**Value);
	return Value != nullptr;
}

void FBpStore::SetString(const TCHAR* Section, const TCHAR* Key, const FString& Value)
{
	const FString* Was = BpStoreImpl::Find(Section, Key);
	if (Was && *Was == Value) return;
	BpStoreImpl::GSections.FindOrAdd(Section).Add(Key, Value);
	BpStoreImpl::bDirty = true;
}

void FBpStore::SetFloat(const TCHAR* Section, const TCHAR* Key, float Value) { SetString(Section, Key, FString::SanitizeFloat(Value)); }

void FBpStore::SetBool(const TCHAR* Section, const TCHAR* Key, bool Value) { SetString(Section, Key, Value ? TEXT("True") : TEXT("False")); }

void FBpStore::RemoveKey(const TCHAR* Section, const TCHAR* Key)
{
	BpStoreImpl::Load();
	if (TMap<FString, FString>* Keys = BpStoreImpl::GSections.Find(Section); Keys && Keys->Remove(Key) > 0) BpStoreImpl::bDirty = true;
}

void FBpStore::EmptySection(const TCHAR* Section)
{
	BpStoreImpl::Load();
	if (BpStoreImpl::GSections.Remove(Section) > 0) BpStoreImpl::bDirty = true;
}

void FBpStore::Flush()
{
	BpStoreImpl::Load();
	if (!BpStoreImpl::bDirty) return;
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	for (const TPair<FString, TMap<FString, FString>>& Section : BpStoreImpl::GSections)
	{
		TSharedPtr<FJsonObject> Keys = MakeShared<FJsonObject>();
		for (const TPair<FString, FString>& Key : Section.Value) Keys->SetStringField(Key.Key, Key.Value);
		Json->SetObjectField(Section.Key, Keys);
	}
	FString Text;
	FJsonSerializer::Serialize(Json, TJsonWriterFactory<>::Create(&Text));
	const FString Dest = Path();
	const FString Tmp = Dest + TEXT(".tmp");
	const bool bOk = FFileHelper::SaveStringToFile(Text, *Tmp, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM) && IFileManager::Get().Move(*Dest, *Tmp, true);
	BpStoreImpl::LastWrite = bOk ? 1 : 0;
	if (bOk) BpStoreImpl::bDirty = false;
	else UE_LOG(LogBpStore, Warning, TEXT("BpStore: could not write %s: the change is kept in memory and retried at the next one"), *Dest);
}

#if !UE_BUILD_SHIPPING
static FAutoConsoleCommand GCmdBpStoreDump(TEXT("BpStore.Dump"),
	TEXT("BpStore.Dump: logs the app's saved file: its path, the last write, and each section's key names with their value lengths (never the values)."),
	FConsoleCommandDelegate::CreateLambda([]()
	{
		BpStoreImpl::Load();
		UE_LOG(LogBpStore, Log, TEXT("BpStore: %s (%s on disk; last write %s; %s)"), *FBpStore::Path(), IFileManager::Get().FileExists(*FBpStore::Path()) ? TEXT("present") : TEXT("absent"),
			BpStoreImpl::LastWrite < 0 ? TEXT("none this run") : BpStoreImpl::LastWrite ? TEXT("succeeded") : TEXT("FAILED"), BpStoreImpl::bDirty ? TEXT("unwritten changes") : TEXT("nothing unwritten"));
		for (const TPair<FString, TMap<FString, FString>>& Section : BpStoreImpl::GSections)
		{
			TArray<FString> Keys;
			for (const TPair<FString, FString>& Key : Section.Value) Keys.Add(FString::Printf(TEXT("%s(%d)"), *Key.Key, Key.Value.Len()));
			UE_LOG(LogBpStore, Log, TEXT("BpStore: [%s] %s"), *Section.Key, *FString::Join(Keys, TEXT(" ")));
		}
	}));
#endif
