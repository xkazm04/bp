// Stand-in (see ../CoreMinimal.h).
#pragma once
#include "CoreMinimal.h"
template <typename CharType, typename PrintPolicy> class TJsonWriter { public: virtual bool Close(); };
template <typename CharType, typename PrintPolicy> class TJsonWriterFactory
{
public:
	static TSharedRef<TJsonWriter<CharType, PrintPolicy>> Create(FString* const Stream, int32 InitialIndentLevel = 0);
};
