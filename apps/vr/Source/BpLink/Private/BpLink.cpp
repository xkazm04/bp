// Not compiled against Unreal, not syntax-checked (no clang on the machine it was written on): apps/vr/WP3.1.md.
#include "BpLink.h"

#include "BpSchemaFixups.h"
#include "HAL/IConsoleManager.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/PlatformMisc.h"

DEFINE_LOG_CATEGORY(LogBpLink);

IMPLEMENT_MODULE(FBpLinkModule, BpLink)

namespace
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> MakeGet(const FString& Url, const TCHAR* Accept)
	{
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		Request->SetVerb(TEXT("GET"));
		Request->SetURL(Url);
		Request->SetHeader(TEXT("Accept"), Accept);
		return Request;
	}

	/** The events string is JSONL: one object per line. A bad line is logged and skipped, never fatal. */
	void ReadEvents(const FString& Jsonl, TArray<FBpAppStructureEvent>& Out)
	{
		TArray<FString> Lines;
		Jsonl.ParseIntoArrayLines(Lines);
		for (const FString& Line : Lines)
		{
			if (Line.TrimStartAndEnd().IsEmpty()) continue;
			TSharedPtr<FJsonObject> Object;
			FBpAppStructureEvent Event;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line), Object) && Object.IsValid() && BpSchema::FromJson(Object.ToSharedRef(), Event))
			{
				Out.Add(MoveTemp(Event));
			}
			else
			{
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: skipped an events line that did not parse: %.80s"), *Line);
			}
		}
	}
}

FString FBpLinkClient::DefaultBaseUrl()
{
	FString Url;
	if (!FParse::Value(FCommandLine::Get(), TEXT("BpLinkUrl="), Url) || Url.IsEmpty())
	{
		Url = FPlatformMisc::GetEnvironmentVariable(TEXT("BP_LINK_URL"));
	}
	return Url.IsEmpty() ? FString(TEXT("http://127.0.0.1:3100")) : Url;
}

FBpLinkClient::FBpLinkClient(const FString& InBaseUrl)
{
	SetBaseUrl(InBaseUrl.IsEmpty() ? DefaultBaseUrl() : InBaseUrl);
}

void FBpLinkClient::SetBaseUrl(const FString& InBaseUrl)
{
	BaseUrl = InBaseUrl;
	while (BaseUrl.EndsWith(TEXT("/"))) BaseUrl.LeftChopInline(1);
}

void FBpLinkClient::FetchProduct(const FString& Slug, TFunction<void(bool, const FBpLinkSnapshot&)> OnDone)
{
	const FString Root = BaseUrl + TEXT("/api/products/") + Slug;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Structure = MakeGet(Root + TEXT("/structure"), TEXT("application/json"));

	Structure->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkSnapshot Snapshot;
		if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/structure failed (connected=%d, status=%d). Is `npm run server` running?"),
				*Root, bConnected, Response.IsValid() ? Response->GetResponseCode() : 0);
			OnDone(false, Snapshot);
			return;
		}

		// { structure, events, rev }: structure goes through the generated structs, events is JSONL, rev is a string.
		TSharedPtr<FJsonObject> Payload;
		const TSharedPtr<FJsonObject>* StructureJson = nullptr;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Payload) || !Payload.IsValid()
			|| !Payload->TryGetObjectField(TEXT("structure"), StructureJson)
			|| !BpSchema::FromJson(StructureJson->ToSharedRef(), Snapshot.Structure))
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/structure answer did not parse into FBpAppStructure"), *Root);
			OnDone(false, Snapshot);
			return;
		}
		FString EventsJsonl;
		Payload->TryGetStringField(TEXT("events"), EventsJsonl);
		ReadEvents(EventsJsonl, Snapshot.Events);
		Payload->TryGetStringField(TEXT("rev"), Snapshot.Rev);

		// /stream has two answers BpLink lives with: 200 text/event-stream, which Kettle gives since wolf-plan L5.2
		// (apps/server hosts its scan sim), and 405 for a product with no live stream. WP3.1 consumes neither: the rev
		// read above is the one read BpLink keeps either way. Both are pinned by scripts/check-bplink.mjs.
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Stream = MakeGet(Root + TEXT("/stream"), TEXT("text/event-stream"));
		Stream->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Snapshot](FHttpRequestPtr, FHttpResponsePtr StreamResponse, bool bStreamConnected) mutable
		{
			Snapshot.StreamStatus = (bStreamConnected && StreamResponse.IsValid()) ? StreamResponse->GetResponseCode() : 0;
			if (Snapshot.StreamStatus == 200)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: %s streams (200); WP3.1 does not consume SSE, so rev %s read once from structure stands"), *Slug, *Snapshot.Rev);
			}
			else if (Snapshot.StreamStatus == 405)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: %s has no live stream (405); using rev %s read once from structure"), *Slug, *Snapshot.Rev);
			}
			else
			{
				// Neither pinned answer. Logged as a warning, and the one-time rev still stands.
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s/stream answered %d, neither the pinned 200 nor 405; SSE is not read in WP3.1"), *Root, Snapshot.StreamStatus);
			}
			OnDone(true, Snapshot);
		});
		Stream->ProcessRequest();
	});
	Structure->ProcessRequest();
}

namespace
{
	TUniquePtr<FBpLinkClient> GClient;

	/** WP3.1's acceptance: one line with the wing count and the wing names. */
	void LogKettle(const FBpLinkSnapshot& Snapshot)
	{
		TArray<FString> Names;
		for (const FBpDomain& Wing : Snapshot.Structure.domains) Names.Add(Wing.name);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: Kettle wings=%d [%s] lenses=%d events=%d rev=%s"),
			Snapshot.Structure.domains.Num(), *FString::Join(Names, TEXT(", ")), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
	}

	void FetchKettle()
	{
		if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: reading Kettle from %s"), *GClient->GetBaseUrl());
		GClient->FetchProduct(TEXT("kettle"), [](bool bOk, const FBpLinkSnapshot& Snapshot) { if (bOk) LogKettle(Snapshot); });
	}

	FAutoConsoleCommand GFetchCommand(TEXT("BpLink.Fetch"), TEXT("Read Kettle from apps/server and log its wings."),
		FConsoleCommandDelegate::CreateStatic(&FetchKettle));
}

void FBpLinkModule::StartupModule()
{
	FetchKettle();
}

void FBpLinkModule::ShutdownModule()
{
	GClient.Reset();
}
