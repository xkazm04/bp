// Not compiled against Unreal, not syntax-checked (no clang on the machine it was written on): apps/vr/WP3.1.md.
// Correction 2026-10-22 (Lynx): out of date. UE 5.8.4's MSVC 14.44.35207 has compiled this file end to end and linked
// UnrealEditor-BpLink.dll (bpEditor Win64 Development, exit 0) in a probe project outside the repo; nothing has run it.
// Readings: docs/concepts/vr-light-table/machine.md.
#include "BpLink.h"

#include "Schema/BpSchemaFixups.h"
#include "HAL/IConsoleManager.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/PlatformMisc.h"

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

	/**
	 * The events string is JSONL: one object per line. A bad line is skipped, never fatal. The first MaxSampled bad lines
	 * are logged with a prefix, then ONE summary says how many of how many failed, so a wire change that breaks every
	 * line reads "566 of 566" and not 566 near-identical warnings.
	 */
	void ReadEvents(const FString& Jsonl, TArray<FBpAppStructureEvent>& Out)
	{
		constexpr int32 MaxSampled = 3;
		int32 Total = 0;
		int32 Skipped = 0;
		TArray<FString> Lines;
		Jsonl.ParseIntoArrayLines(Lines);
		for (const FString& Line : Lines)
		{
			if (Line.TrimStartAndEnd().IsEmpty()) continue;
			++Total;
			TSharedPtr<FJsonObject> Object;
			FBpAppStructureEvent Event;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line), Object) && Object.IsValid() && BpSchema::FromJson(Object.ToSharedRef(), Event))
			{
				Out.Add(MoveTemp(Event));
			}
			else if (++Skipped <= MaxSampled)
			{
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: skipped an events line that did not parse: %.80s"), *Line);
			}
		}
		if (Skipped > 0)
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: skipped %d of %d events lines that did not parse (the first %d are logged above)"), Skipped, Total, FMath::Min(Skipped, MaxSampled));
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
		// Each of the three steps that can refuse the answer says which one it was, and the answer's size and head follow,
		// so one run tells them apart (docs/concepts/vr-light-table/machine.md, reading 12).
		const FString Body = Response->GetContentAsString();
		TSharedPtr<FJsonObject> Payload;
		const TSharedPtr<FJsonObject>* StructureJson = nullptr;
		FString Refused;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Payload) || !Payload.IsValid())
		{
			Refused = TEXT("FJsonSerializer::Deserialize found no JSON object in it");
		}
		else if (!Payload->TryGetObjectField(TEXT("structure"), StructureJson))
		{
			Refused = TEXT("it has no `structure` object field");
		}
		else if (!BpSchema::FromJson(StructureJson->ToSharedRef(), Snapshot.Structure))
		{
			const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
			Refused = FString::Printf(TEXT("BpSchema::FromJson failed in %s at structure.%s (%d failed steps)"),
				*Failure.Call, Failure.Path.IsEmpty() ? TEXT("(the converter's LogJson line names the property)") : *Failure.Path, Failure.Count);
		}
		if (!Refused.IsEmpty())
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/structure answer did not parse into FBpAppStructure: %s"), *Root, *Refused);
			UE_LOG(LogBpLink, Error, TEXT("BpLink: that answer is %d bytes, %d characters, and begins: %s"),
				Response->GetContent().Num(), Body.Len(), *Body.Left(200));
			OnDone(false, Snapshot);
			return;
		}
		FString EventsJsonl;
		Payload->TryGetStringField(TEXT("events"), EventsJsonl);
		ReadEvents(EventsJsonl, Snapshot.Events);
		Payload->TryGetStringField(TEXT("rev"), Snapshot.Rev);

		// /plan is the product at the web's levels (wing, room, bay, tile), parsed into FBpPlan the way /structure is parsed
		// into FBpAppStructure. A failed or unparseable answer logs its own Error and the fetch goes on: structure, events
		// and rev still stand, and bHasPlan stays false. Snapshot is MOVED into this continuation as into the /stream one.
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Plan = MakeGet(Root + TEXT("/plan"), TEXT("application/json"));
		Plan->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr PlanResponse, bool bPlanConnected) mutable
		{
			const int32 PlanCode = (bPlanConnected && PlanResponse.IsValid()) ? PlanResponse->GetResponseCode() : 0;
			if (PlanCode != 200)
			{
				UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/plan failed (connected=%d, status=%d); structure, events and rev still stand"),
					*Root, bPlanConnected, PlanCode);
			}
			else
			{
				TSharedPtr<FJsonObject> PlanJson;
				const bool bPlanJson = FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(PlanResponse->GetContentAsString()), PlanJson) && PlanJson.IsValid();
				Snapshot.bHasPlan = bPlanJson && BpSchema::FromJson(PlanJson.ToSharedRef(), Snapshot.Plan);
				if (!Snapshot.bHasPlan)
				{
					Snapshot.Plan = FBpPlan();
					const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
					const FString Refused = bPlanJson ? FString::Printf(TEXT("BpSchema::FromJson failed in %s at plan.%s"), *Failure.Call, *Failure.Path)
						: FString(TEXT("FJsonSerializer::Deserialize found no JSON object in it"));
					UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/plan answer did not parse into FBpPlan: %s; structure, events and rev still stand"), *Root, *Refused);
				}
			}

			// /stream has two answers BpLink lives with: 200 text/event-stream, which Kettle gives since wolf-plan L5.2
			// (apps/server hosts its scan sim), and 405 for a product with no live stream. WP3.1 consumes neither: the rev
			// read above is the one read BpLink keeps either way. Both are pinned by scripts/check-bplink.mjs.
			// Snapshot holds the whole parsed events array, so it is MOVED into the continuation (nothing below reads it here).
			TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Stream = MakeGet(Root + TEXT("/stream"), TEXT("text/event-stream"));
			Stream->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr StreamResponse, bool bStreamConnected) mutable
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
				else if (Snapshot.StreamStatus == 0)
				{
					// Asked, and nothing answered (-1 would be "never asked", which cannot reach this callback).
					UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s/stream did not connect; SSE is not read in WP3.1 and the one-time rev stands"), *Root);
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
		Plan->ProcessRequest();
	});
	Structure->ProcessRequest();
}

namespace
{
	TUniquePtr<FBpLinkClient> GClient;

	/**
	 * One line, WP3.1.md's acceptance: the wing, room, bay and tile counts are the plan's own arrays (a WING is a
	 * WING_DEFS group of domains, 5 for Kettle, and exists only on GET .../plan), the names are the wing names, and
	 * lenses, events and rev come from the structure payload. With no plan read (its Error is already logged), the line
	 * says so and counts `structure.domains`, which are ROOMS (13 for Kettle), never wings.
	 * The labels and their sources are pinned against the live plan route by scripts/check-bplink.mjs.
	 */
	void LogKettle(const FBpLinkSnapshot& Snapshot)
	{
		if (!Snapshot.bHasPlan)
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: Kettle rooms=%d lenses=%d events=%d rev=%s (no plan read, so no wings)"),
				Snapshot.Structure.domains.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
			return;
		}
		TArray<FString> Names;
		for (const FBpPlanWing& Wing : Snapshot.Plan.wings) Names.Add(Wing.name);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: Kettle wings=%d [%s] rooms=%d bays=%d tiles=%d lenses=%d events=%d rev=%s"),
			Snapshot.Plan.wings.Num(), *FString::Join(Names, TEXT(", ")), Snapshot.Plan.rooms.Num(), Snapshot.Plan.bays.Num(),
			Snapshot.Plan.tiles.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
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
