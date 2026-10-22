// Stand-in (see ../CoreMinimal.h).
#pragma once
#include "CoreMinimal.h"
class FJsonObject;
enum class EJson { None, Null, String, Number, Boolean, Array, Object };
class FJsonValue
{
public:
	EJson Type;
	bool TryGetObject(const TSharedPtr<FJsonObject>*& Out) const;
};
class FJsonObject
{
public:
	TSharedPtr<FJsonValue> TryGetField(const FString& FieldName) const;
	bool TryGetObjectField(const FString& FieldName, const TSharedPtr<FJsonObject>*& OutObject) const;
	bool TryGetArrayField(const FString& FieldName, const TArray<TSharedPtr<FJsonValue>>*& OutArray) const;
};
