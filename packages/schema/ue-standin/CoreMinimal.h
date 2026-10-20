// Stand-in for the Unreal declarations BpSchema.h and BpSchemaFixups.h use, so `clang++ -fsyntax-only` can parse
// them on a host with no Unreal Engine (see packages/schema/README.md). The signatures follow UE 5's Core, Json
// and JsonUtilities modules; nothing here is Unreal's code, and passing against it proves no UHT or UE build.
#pragma once
#include <cstdint>
#include <utility>

typedef char16_t TCHAR;
typedef int32_t int32;
typedef int64_t int64;
#define TEXT(s) u##s
#define USTRUCT(...)
#define UPROPERTY(...)
#define GENERATED_BODY() public: static class UScriptStruct* StaticStruct();
#define BPLINK_API
#define GET_MEMBER_NAME_CHECKED(Class, Member) ((void)sizeof(((Class*)0)->Member), FName(TEXT(#Member)))

class FString
{
public:
	FString() {}
	FString(const TCHAR*) {}
	void Reset() {}
};
class FName { public: explicit FName(const TCHAR*) {} };
template <typename T> class TSharedPtr { public: T* Get() const; T& operator*() const; T* operator->() const; bool IsValid() const; };
template <typename T> class TSharedRef { public: T* Get() const; T& operator*() const; T* operator->() const; };
template <typename T> class TArray { public: int32 Num() const; T& operator[](int32); const T& operator[](int32) const; };
template <typename K, typename V> struct TPair { K Key; V Value; };
template <typename K, typename V> class TMap { public: TPair<K, V>* begin(); TPair<K, V>* end(); };

class FProperty { public: template <typename T> T* ContainerPtrToValuePtr(void* Container, int32 Index = 0) const; };
class UScriptStruct { public: FProperty* FindPropertyByName(FName Name) const; };
