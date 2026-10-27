// The words the table shows for a lens, a metric, a tier and a feature kind (spark vr-room-layers WP3): the web's, never a
// raw key. A lens's name and a metric's label and unit are its manifest's (structure.lenses[].manifest, which BpLink keeps:
// the web's P.LENS reads the same manifests); a tier's words and a bay kind's name are core's (BpWords.generated.h, made
// by scripts/gen-vr-words.ts). A key the source has no word for is humanised (camelCase, snake_case and kebab-case split
// into words, the first capitalised: "findingsHigh" -> "Findings high"), never shown raw.
#pragma once

#include "CoreMinimal.h"
#include "BpLink.h"
#include "BpWords.generated.h"

namespace BpWords
{
	/** A key as words: its last dotted part ("com.kettle.cost" -> "cost"), split at a lower-to-upper change, an underscore
	 *  or a hyphen, lower case, the first letter capitalised. */
	inline FString Humanise(const FString& Key)
	{
		FString Last = Key;
		Key.Split(TEXT("."), nullptr, &Last, ESearchCase::CaseSensitive, ESearchDir::FromEnd);
		if (Last.IsEmpty()) Last = Key;
		FString Out;
		for (int32 Index = 0; Index < Last.Len(); ++Index)
		{
			const TCHAR C = Last[Index];
			if (C == TEXT('_') || C == TEXT('-')) { if (!Out.EndsWith(TEXT(" "))) Out += TEXT(' '); continue; }
			if (Index > 0 && FChar::IsUpper(C) && FChar::IsLower(Last[Index - 1]) && !Out.EndsWith(TEXT(" "))) Out += TEXT(' ');
			Out += FChar::ToLower(C);
		}
		Out.TrimStartAndEndInline();
		return Out.IsEmpty() ? Out : Out.Left(1).ToUpper() + Out.Mid(1);
	}

	/** A lens's name ("security" -> "Security", "com.kettle.cost" -> its manifest's name). */
	inline FString Lens(const FString& Id)
	{
		const FString* Found = FBpLinkModule::Get().FindLensName(Id);
		return Found ? *Found : Humanise(Id);
	}

	/** A metric's name under its lens ("findingsHigh" -> "High findings"): its field's label. */
	inline FString Metric(const FString& LensId, const FString& Key)
	{
		const FString* Found = FBpLinkModule::Get().FindFieldLabel(LensId, Key);
		return Found ? *Found : Humanise(Key);
	}

	/** A metric's unit: its field's, else Fallback (the measurement's own). */
	inline FString Unit(const FString& LensId, const FString& Key, const FString& Fallback = FString())
	{
		const FString* Found = FBpLinkModule::Get().FindFieldUnit(LensId, Key);
		return Found ? *Found : Fallback;
	}

	/** What a severity tier says (the queue's chip: 0 "stop-ship" .. 3 "backlog"). */
	inline FString TierSays(int32 Tier)
	{
		return BpWordsGenerated::TierSays[FMath::Clamp(Tier, 0, static_cast<int32>(UE_ARRAY_COUNT(BpWordsGenerated::TierSays)) - 1)];
	}

	/** A bay kind's name ("user_flow" -> "User flows"). */
	inline FString KindPlural(const FString& Kind)
	{
		for (const BpWordsGenerated::FKindName& Each : BpWordsGenerated::KindNames)
		{
			if (Kind == Each.Kind) return Each.Name;
		}
		return Humanise(Kind);
	}

	/** One feature's kind ("user_flow" -> "User flow"): the web shows it raw on its feature page and names only bay kinds, so
	 *  the singular is the key humanised. */
	inline FString Kind(const FString& Id)
	{
		return Humanise(Id);
	}
}
