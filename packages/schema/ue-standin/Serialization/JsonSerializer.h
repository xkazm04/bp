// Stand-in (see ../CoreMinimal.h).
#pragma once
#include "Dom/JsonObject.h"
#include "Serialization/JsonWriter.h"
class FJsonSerializer
{
public:
	template <typename CharType, typename PrintPolicy>
	static bool Serialize(const TSharedPtr<FJsonValue>& Value, const FString& Identifier, const TSharedRef<TJsonWriter<CharType, PrintPolicy>>& Writer, bool bCloseWriter = true);
};
