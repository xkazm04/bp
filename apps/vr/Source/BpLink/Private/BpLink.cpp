// Not compiled against Unreal, not syntax-checked (no clang on the machine it was written on): apps/vr/WP3.1.md.
// Correction 2026-10-22 (Lynx): out of date. UE 5.8.4's MSVC 14.44.35207 has compiled this file end to end and linked
// UnrealEditor-BpLink.dll (bpEditor Win64 Development, exit 0) in a probe project outside the repo; nothing has run it.
// Correction later that night: the editor has run it there (-nullrhi), and reading 14 logged the Kettle wings line.
// Readings: docs/concepts/vr-light-table/machine.md.
#include "BpLink.h"

#include "Schema/BpSchemaFixups.h"
#include "Schema/BpSchemaVocab.h"
#include "HAL/IConsoleManager.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/PlatformMisc.h"
#include "Containers/Ticker.h"
#include "Async/Async.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Engine/Engine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/DateTime.h"
#include "Misc/Guid.h"
#if PLATFORM_ANDROID
#include <fcntl.h>
#include <unistd.h>
#endif

DEFINE_LOG_CATEGORY(LogBpLink);

IMPLEMENT_MODULE(FBpLinkModule, BpLink)

namespace
{
	/**
	 * The device token (table link v2, night two W2a): once this headset is paired it goes out as `Authorization: Bearer`
	 * on EVERY request, cable and Wi-Fi alike (table-link-v2.md section 8). It is never logged; the console shows its last
	 * four characters. A request that carried it and answered 401 (the tether's "pair again") raises GUnauthorized on the
	 * game thread, and the link's tick forgets the token.
	 */
	FString GToken;
	bool GUnauthorized = false;
	/** A route is up (cable or Wi-Fi): the pollers run only then, or from the bundle. */
	bool GRouteLive = false;
	/** A read found no PC (a connection that did not connect): the link's tick asks /api/health at once. */
	bool GProbeNow = false;
	/** -BpLinkUrl= (or BP_LINK_URL) when it names a server: the chooser asks only it. */
	FString GExplicitUrl;

	/** Every BpLink request starts here: the verb, the URL, and the token when there is one. */
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> NewRequest()
	{
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		if (!GToken.IsEmpty())
		{
			Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + GToken);
			const uint32 Sent = GetTypeHash(GToken);
			// A request that rebinds this (the /stream read) gives it up; the next request with the token still reports.
			Request->OnStatusCodeReceived().BindLambda([Sent](FHttpRequestPtr, int32 Code)
			{
				if (Code != 401) return;
				FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Sent](float)
				{
					if (!GToken.IsEmpty() && GetTypeHash(GToken) == Sent) GUnauthorized = true;
					return false;
				}));
			});
		}
		return Request;
	}

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> MakeGet(const FString& Url, const TCHAR* Accept)
	{
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
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

	/**
	 * The bundled snapshot (docs/concepts/vr-light-table/standalone-plan.md): the server's own answers for one product,
	 * saved by apps/vr/tools/bundle-data.mjs under Content/BpData/<slug>/ and staged into the build as UFS files, so a
	 * headset with no PC still has a plan to draw. BpLink reads it when -BpLinkUrl=bundle says so, or when the server does
	 * not answer the structure read. Once read, the session stays on it: the scan side reads its saved answers once instead
	 * of polling, and every write (a scan, a draft wave) is refused, because there is no server to keep it.
	 */
	bool GFromBundle = false;
	const TCHAR* const BundleUrl = TEXT("bundle");
	FString BundlePath(const FString& Slug, const TCHAR* File) { return FPaths::ProjectContentDir() / TEXT("BpData") / Slug / File; }
	bool ReadBundleFile(const FString& Slug, const TCHAR* File, FString& Out) { return FFileHelper::LoadFileToString(Out, *BundlePath(Slug, File)); }

	/**
	 * The product generation (spark onboarding-vr WP-V1): bumped by every SetProduct. A request made for one product
	 * captures it, and its answer is dropped when the table has moved on, so an old product's plan or scan side never
	 * lands on the new one. Each such request is also kept here (weakly), so SetProduct can cancel what is still out.
	 */
	uint32 GProductGen = 0;
	TArray<TWeakPtr<IHttpRequest, ESPMode::ThreadSafe>> GProductRequests;
	void TrackProductRequest(const TSharedRef<IHttpRequest, ESPMode::ThreadSafe>& Request)
	{
		GProductRequests.RemoveAll([](const TWeakPtr<IHttpRequest, ESPMode::ThreadSafe>& Each) { return !Each.IsValid(); });
		GProductRequests.Add(Request);
	}
	/** Cancels every product request still out; how many were. Their answers see a stale generation and are dropped. */
	int32 CancelProductRequests()
	{
		int32 Cancelled = 0;
		TArray<TWeakPtr<IHttpRequest, ESPMode::ThreadSafe>> Out = MoveTemp(GProductRequests);
		GProductRequests.Reset();
		for (const TWeakPtr<IHttpRequest, ESPMode::ThreadSafe>& Each : Out)
		{
			if (TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Request = Each.Pin())
			{
				if (!EHttpRequestStatus::IsFinished(Request->GetStatus()))
				{
					Request->CancelRequest();
					++Cancelled;
				}
			}
		}
		return Cancelled;
	}

	/** The /structure answer { structure, events, rev } into Snapshot. False with the refusing step in Refused. */
	bool ParseStructurePayload(const FString& Body, FBpLinkSnapshot& Snapshot, FString& Refused)
	{
		TSharedPtr<FJsonObject> Payload;
		const TSharedPtr<FJsonObject>* StructureJson = nullptr;
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
		if (!Refused.IsEmpty()) return false;
		FString EventsJsonl;
		Payload->TryGetStringField(TEXT("events"), EventsJsonl);
		ReadEvents(EventsJsonl, Snapshot.Events);
		Payload->TryGetStringField(TEXT("rev"), Snapshot.Rev);
		return true;
	}

	/** The /plan answer into Snapshot.Plan. False (the plan reset) with the refusing step in Refused. */
	bool ParsePlanBody(const FString& Body, FBpLinkSnapshot& Snapshot, FString& Refused)
	{
		TSharedPtr<FJsonObject> PlanJson;
		const bool bPlanJson = FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), PlanJson) && PlanJson.IsValid();
		if (bPlanJson && BpSchema::FromJson(PlanJson.ToSharedRef(), Snapshot.Plan)) return true;
		Snapshot.Plan = FBpPlan();
		const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
		Refused = bPlanJson ? FString::Printf(TEXT("BpSchema::FromJson failed in %s at plan.%s"), *Failure.Call, *Failure.Path)
			: FString(TEXT("FJsonSerializer::Deserialize found no JSON object in it"));
		return false;
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

bool FBpLinkClient::ReadBundle(const FString& Slug, FBpLinkSnapshot& Snapshot)
{
	FString Structure, Plan, Manifest;
	if (!ReadBundleFile(Slug, TEXT("structure.json"), Structure))
	{
		UE_LOG(LogBpLink, Error, TEXT("BpLink: no bundled snapshot of %s in this build (%s); run apps/vr/tools/bundle-data.mjs --product %s and rebuild"),
			*Slug, *BundlePath(Slug, TEXT("structure.json")), *Slug);
		return false;
	}
	Snapshot = FBpLinkSnapshot();
	FString Refused;
	if (!ParseStructurePayload(Structure, Snapshot, Refused))
	{
		UE_LOG(LogBpLink, Error, TEXT("BpLink: the bundled %s/structure.json did not parse into FBpAppStructure: %s"), *Slug, *Refused);
		return false;
	}
	if (ReadBundleFile(Slug, TEXT("plan.json"), Plan))
	{
		Snapshot.bHasPlan = ParsePlanBody(Plan, Snapshot, Refused);
		if (!Snapshot.bHasPlan) UE_LOG(LogBpLink, Error, TEXT("BpLink: the bundled %s/plan.json did not parse into FBpPlan: %s"), *Slug, *Refused);
	}
	TSharedPtr<FJsonObject> Saved;
	if (ReadBundleFile(Slug, TEXT("bundle.json"), Manifest) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Manifest), Saved) && Saved.IsValid())
	{
		Saved->TryGetStringField(TEXT("savedAt"), Snapshot.BundleSavedAt);
	}
	Snapshot.bFromBundle = true;
	GFromBundle = true;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: reading %s from the build's bundled snapshot (saved %s, rev %s); the table is read-only until a server answers"),
		*Slug, Snapshot.BundleSavedAt.IsEmpty() ? TEXT("at an unknown time") : *Snapshot.BundleSavedAt, *Snapshot.Rev);
	return true;
}

void FBpLinkClient::FetchProduct(const FString& Slug, TFunction<void(bool, const FBpLinkSnapshot&)> OnDone)
{
	if (BaseUrl == BundleUrl)
	{
		// Asked for the bundle by name: no request at all. OnDone still runs on a later tick, as it does for a request.
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Slug, OnDone](float)
		{
			FBpLinkSnapshot Snapshot;
			const bool bBundled = ReadBundle(Slug, Snapshot);
			OnDone(bBundled, Snapshot);
			return false;
		}));
		return;
	}
	const FString Root = BaseUrl + TEXT("/api/products/") + Slug;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Structure = MakeGet(Root + TEXT("/structure"), TEXT("application/json"));
	// The product this read is for (WP-V1): an answer that comes after the table moved to another product is dropped
	// before anything reads it (a cancelled read must not fall back to the bundle either).
	const uint32 Gen = GProductGen;
	TrackProductRequest(Structure);

	Structure->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Gen](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		if (Gen != GProductGen)
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: dropped the %s/structure answer: the table moved to another product"), *Root);
			return;
		}
		FBpLinkSnapshot Snapshot;
		if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
		{
			const int32 Code = Response.IsValid() ? Response->GetResponseCode() : 0;
			UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/structure failed (connected=%d, status=%d). Is `npm run server` running?"),
				*Root, bConnected, Code);
			// The PC answered and refused this product (404, 403): a product problem, not a lost link. The table keeps the link.
			// The PC did not answer while a route was up: the link's tick asks /api/health now, and two misses go to the bundle.
			if (Code > 0 || GRouteLive)
			{
				if (Code == 0) GProbeNow = true;
				OnDone(false, Snapshot);
				return;
			}
			// No server (a headset with no PC): the build's bundled snapshot, when it has one for this product.
			const bool bBundled = FBpLinkClient::ReadBundle(Slug, Snapshot);
			OnDone(bBundled, Snapshot);
			return;
		}

		// { structure, events, rev }: structure goes through the generated structs, events is JSONL, rev is a string.
		// Each of the three steps that can refuse the answer says which one it was, and the answer's size and head follow,
		// so one run tells them apart (docs/concepts/vr-light-table/machine.md, reading 12).
		const FString Body = Response->GetContentAsString();
		FString Refused;
		if (!ParseStructurePayload(Body, Snapshot, Refused))
		{
			UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/structure answer did not parse into FBpAppStructure: %s"), *Root, *Refused);
			UE_LOG(LogBpLink, Error, TEXT("BpLink: that answer is %d bytes, %d characters, and begins: %s"),
				Response->GetContent().Num(), Body.Len(), *Body.Left(200));
			OnDone(false, Snapshot);
			return;
		}
		UE_LOG(LogBpLink, Log, TEXT("BpLink: the %s/structure answer parsed: domains=%d lenses=%d events=%d rev=%s; asking /plan"),
			*Root, Snapshot.Structure.domains.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);

		// /plan is the product at the web's levels (wing, room, bay, tile), parsed into FBpPlan the way /structure is parsed
		// into FBpAppStructure. A failed or unparseable answer logs its own Error and the fetch goes on: structure, events
		// and rev still stand, and bHasPlan stays false. Snapshot is MOVED into this continuation as into the /stream one.
		// The islands view: the server spaces wings and rooms apart for the table (VR computes no layout of its own).
		// The LAN door takes exactly this query on /plan (lan-door.ts VERBS, night two W2b), so Wi-Fi draws the same islands.
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Plan = MakeGet(Root + TEXT("/plan?layout=islands"), TEXT("application/json"));
		TrackProductRequest(Plan);
		Plan->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Gen, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr PlanResponse, bool bPlanConnected) mutable
		{
			if (Gen != GProductGen)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: dropped the %s/plan answer: the table moved to another product"), *Root);
				return;
			}
			const int32 PlanCode = (bPlanConnected && PlanResponse.IsValid()) ? PlanResponse->GetResponseCode() : 0;
			if (PlanCode != 200)
			{
				UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/plan failed (connected=%d, status=%d); structure, events and rev still stand"),
					*Root, bPlanConnected, PlanCode);
			}
			else
			{
				FString Refused;
				Snapshot.bHasPlan = ParsePlanBody(PlanResponse->GetContentAsString(), Snapshot, Refused);
				if (!Snapshot.bHasPlan)
				{
					UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/plan answer did not parse into FBpPlan: %s; structure, events and rev still stand"), *Root, *Refused);
				}
				else
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink: the %s/plan answer parsed into FBpPlan; asking /stream"), *Root);
				}
			}

			// /stream has two answers BpLink lives with: 200 text/event-stream, which Kettle gives since wolf-plan L5.2
			// (apps/server hosts its scan sim), and 405 for a product with no live stream. WP3.1 consumes neither: the rev
			// read above is the one read BpLink keeps either way. Both are pinned by scripts/check-bplink.mjs.
			// A live SSE body never ends, so a 200 never completes by itself (machine.md, reading 13): the status is kept
			// when it arrives, a 200 is cancelled on the next tick, and the completion below reads the kept status.
			// Snapshot holds the whole parsed events array, so it is MOVED into the continuation (nothing below reads it here).
			TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Stream = MakeGet(Root + TEXT("/stream"), TEXT("text/event-stream"));
			TSharedRef<int32, ESPMode::ThreadSafe> StreamCode = MakeShared<int32, ESPMode::ThreadSafe>(0);
			Stream->OnStatusCodeReceived().BindLambda([Root, StreamCode](FHttpRequestPtr Request, int32 Code)
			{
				*StreamCode = Code;
				UE_LOG(LogBpLink, Log, TEXT("BpLink: GET %s/stream sent status %d"), *Root, Code);
				if (Code == 200 && Request.IsValid())
				{
					FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Request](float) { Request->CancelRequest(); return false; }));
				}
			});
			TrackProductRequest(Stream);
			Stream->OnProcessRequestComplete().BindLambda([Root, Slug, OnDone, Gen, StreamCode, Snapshot = MoveTemp(Snapshot)](FHttpRequestPtr, FHttpResponsePtr StreamResponse, bool bStreamConnected) mutable
			{
				if (Gen != GProductGen)
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink: dropped the %s read: the table moved to another product"), *Root);
					return;
				}
				Snapshot.StreamStatus = *StreamCode > 0 ? *StreamCode : (bStreamConnected && StreamResponse.IsValid()) ? StreamResponse->GetResponseCode() : 0;
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
	 * The line leads with the product's slug, capitalised, so Kettle's line reads as it always has ("BpLink: Kettle wings=").
	 */
	void LogProduct(const FString& Slug, const FBpLinkSnapshot& Snapshot)
	{
		const FString Label = Slug.Left(1).ToUpper() + Slug.Mid(1);
		if (!Snapshot.bHasPlan)
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: %s domains=%d lenses=%d events=%d rev=%s (no plan read, so no wings)"),
				*Label, Snapshot.Structure.domains.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
			return;
		}
		TArray<FString> Names;
		for (const FBpPlanWing& Wing : Snapshot.Plan.wings) Names.Add(Wing.name);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: %s wings=%d [%s] rooms=%d bays=%d tiles=%d lenses=%d events=%d rev=%s"),
			*Label, Snapshot.Plan.wings.Num(), *FString::Join(Names, TEXT(", ")), Snapshot.Plan.rooms.Num(), Snapshot.Plan.bays.Num(),
			Snapshot.Plan.tiles.Num(), Snapshot.Structure.lenses.Num(), Snapshot.Events.Num(), *Snapshot.Rev);
	}

	/** The product WP3.1 and L3.2 read when nothing names another. */
	const TCHAR* const KettleSlug = TEXT("kettle");

	/**
	 * The product the table reads. At launch: -BpLinkProduct=<slug> on the command line, else the environment variable
	 * BP_LINK_PRODUCT, else Kettle (the same precedence as -BpLinkUrl / BP_LINK_URL). SetProduct changes it at runtime
	 * (spark onboarding-vr WP-V1). A slug other than kettle exists only on a server started where bp.products.local.json
	 * lists it (products.server.ts reads it from the server's cwd); otherwise /structure answers 404 and the existing
	 * "GET ... failed" Error says so.
	 */
	FString& ProductSlugRef()
	{
		static FString Slug = []
		{
			FString Value;
			if (!FParse::Value(FCommandLine::Get(), TEXT("BpLinkProduct="), Value) || Value.IsEmpty())
			{
				Value = FPlatformMisc::GetEnvironmentVariable(TEXT("BP_LINK_PRODUCT"));
			}
			Value.TrimStartAndEndInline();
			return Value.IsEmpty() ? FString(KettleSlug) : Value.ToLower();
		}();
		return Slug;
	}
	const FString& ProductSlug() { return ProductSlugRef(); }

	void FetchProduct()
	{
		if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
		const FString Slug = ProductSlug();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: reading %s from %s"), *Slug, *GClient->GetBaseUrl());
		GClient->FetchProduct(Slug, [Slug](bool bOk, const FBpLinkSnapshot& Snapshot)
		{
			if (bOk) LogProduct(Slug, Snapshot);
			// The module keeps what was read, so the table (ABpTable) never asks a second time.
			if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->ReceiveSnapshot(bOk, Snapshot);
		});
	}

	FAutoConsoleCommand GFetchCommand(TEXT("BpLink.Fetch"), TEXT("Read the product (-BpLinkProduct=, BP_LINK_PRODUCT, else Kettle; BpLink.Product changes it) from apps/server and log its wings."),
		FConsoleCommandDelegate::CreateStatic(&FetchProduct));

	/** BpLink.After <seconds> <command ...>: runs the command that many seconds later in the playing world (game or PIE), for
	 *  headless runs whose -ExecCmds all start at once (WP-V1's switch kettle -> pof -> kettle and the deck after it). */
	FAutoConsoleCommand GAfterCommand(TEXT("BpLink.After"),
		TEXT("BpLink.After <seconds> <command ...>: run the command that many seconds later in the playing world (-ExecCmds timing for headless checks)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 2)
			{
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: usage BpLink.After <seconds> <command ...>"));
				return;
			}
			const float Delay = FMath::Max(0.f, FCString::Atof(*Args[0]));
			const FString Command = FString::Join(TArrayView<const FString>(Args).RightChop(1), TEXT(" "));
			UE_LOG(LogBpLink, Log, TEXT("BpLink: in %.1f s: %s"), Delay, *Command);
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Command](float)
			{
				UWorld* World = nullptr;
				if (GEngine)
				{
					for (const FWorldContext& Context : GEngine->GetWorldContexts())
					{
						if ((Context.WorldType == EWorldType::Game || Context.WorldType == EWorldType::PIE) && Context.World()) { World = Context.World(); break; }
					}
				}
				UE_LOG(LogBpLink, Log, TEXT("BpLink: after: %s%s"), *Command, World ? TEXT("") : TEXT(" (no playing world)"));
				if (GEngine) GEngine->Exec(World, *Command);
				return false;
			}), Delay);
		}));

	FAutoConsoleCommand GProductCommand(TEXT("BpLink.Product"),
		TEXT("BpLink.Product <slug>: switch the table to that product at runtime (the same slug reads it again); with no slug, log the products and their onboarding."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: product is %s; %d products known"), *Module->GetProductSlug(), Module->GetOnboarding().Products.Num());
				for (const FBpProductEntry& Entry : Module->GetOnboarding().Products)
				{
					UE_LOG(LogBpLink, Log, TEXT("BpLink:   %s \"%s\" map=%d onboarding=%s %s %d/%d"), *Entry.Slug, *Entry.Name, Entry.bHasMap, *Entry.State, *Entry.Phase, Entry.N, Entry.Of);
				}
				return;
			}
			Module->SetProduct(Args[0]);
		}));
}

FBpLinkModule& FBpLinkModule::Get()
{
	return FModuleManager::LoadModuleChecked<FBpLinkModule>(TEXT("BpLink"));
}

bool FBpLinkModule::IsFromBundle() const
{
	return GFromBundle;
}

FString FBpLinkModule::GetProductSlug() const
{
	return ProductSlug();
}

void FBpLinkModule::ReceiveSnapshot(bool bOk, const FBpLinkSnapshot& Snapshot)
{
	if (bOk && !Snapshot.Structure.project.name.IsEmpty()) ProductName = Snapshot.Structure.project.name;
	if (bOk)
	{
		// Kept before the plan is announced, so a listener drawing the plan finds each tile's kind.
		FeatureKinds.Reset();
		FeatureSummaries.Reset();
		for (const FBpFeature& Feature : Snapshot.Structure.features)
		{
			if (!Feature.slug.IsEmpty() && !Feature.kind.IsEmpty()) FeatureKinds.Add(Feature.slug, Feature.kind);
			if (!Feature.slug.IsEmpty() && !Feature.summary.IsEmpty()) FeatureSummaries.Add(Feature.slug, Feature.summary);
		}
		// The lenses' words as their manifests say them (the web reads the same manifests from the same answer).
		LensNames.Reset();
		LensAccents.Reset();
		LensShorts.Reset();
		FieldLabels.Reset();
		FieldUnits.Reset();
		for (const FBpLensEntry& Lens : Snapshot.Structure.lenses)
		{
			const FString& Id = Lens.manifest.id.IsEmpty() ? Lens.id : Lens.manifest.id;
			if (!Lens.manifest.name.IsEmpty()) LensNames.Add(Id, Lens.manifest.name);
			if (!Lens.manifest.presentation.accent.dark.IsEmpty()) LensAccents.Add(Id, Lens.manifest.presentation.accent.dark);
			if (!Lens.manifest.Short_.IsEmpty()) LensShorts.Add(Id, Lens.manifest.Short_);
			for (const FBpField& Field : Lens.manifest.fields)
			{
				if (!Field.label.IsEmpty()) FieldLabels.Add(Id + TEXT("/") + Field.key, Field.label);
				if (!Field.unit.IsEmpty()) FieldUnits.Add(Id + TEXT("/") + Field.key, Field.unit);
			}
		}
	}
	if (bOk && Snapshot.bHasPlan)
	{
		Plan = Snapshot.Plan;
		bHasPlan = true;
		PlanState = EBpPlanState::Ready;
		PlanDelegate.Broadcast(Plan);
	}
	else
	{
		// No plan from this read: the structure or the /plan request failed, and its Error is already logged above.
		PlanState = EBpPlanState::Failed;
		PlanFailedDelegate.Broadcast();
	}
}

void FBpLinkModule::SetProduct(const FString& InSlug)
{
	FString Slug = InSlug.TrimStartAndEnd().ToLower();
	if (Slug.IsEmpty())
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: SetProduct needs a slug (the products: BpLink.Product with no argument)"));
		return;
	}
	const FString Was = ProductSlug();
	// Whatever is still out for the old product is cancelled, and every answer of the old generation is dropped.
	++GProductGen;
	const int32 Cancelled = CancelProductRequests();
	ProductSlugRef() = Slug;

	// The old product's state: its plan and structure words, its scan side, waves, briefs and the draft the table wrote.
	Plan = FBpPlan();
	bHasPlan = false;
	PlanState = EBpPlanState::Pending;
	const FBpProductEntry* Entry = FindProduct(Slug);
	ProductName = Entry && !Entry->Name.IsEmpty() ? Entry->Name : FString();
	FeatureKinds.Reset();
	FeatureSummaries.Reset();
	LensNames.Reset();
	LensAccents.Reset();
	FieldLabels.Reset();
	FieldUnits.Reset();
	// Another product's focuses are not this one's; the tab reads them again when it opens.
	const int32 FocusSerial = FocusList.Serial;
	FocusList = FBpFocusList();
	FocusList.Serial = FocusSerial + 1;
	Briefs.Reset();
	bBriefsBundled = false;
	FocusWaveId.Reset();
	DecisionsOut.Reset();
	bWaveWriteOut = false;
	const int32 Serial = ScanState.Serial;
	ScanState = FBpScanState();
	ScanState.Serial = Serial + 1;
	ScanPartsOut = 0;
	for (uint32& Hash : ScanBodyHash) Hash = 0;
	bScanBundled = false;
	NextScanPollS = 0.0;
	// The old product's build-up feed stops; the new one's starts from its begin if its job runs (WP-V2).
	ResetBuildup();

	UE_LOG(LogBpLink, Log, TEXT("BpLink: product %s -> %s (%d requests cancelled; the plan, structure, scans, waves, briefs and draft of %s cleared)%s"),
		*Was, *Slug, Cancelled, *Was, Entry ? *FString::Printf(TEXT("; onboarding %s%s"), *Entry->State, Entry->bHasMap ? TEXT(", has a map") : TEXT(", no map yet")) : TEXT(""));
	// The table drops what it drew of the old product first; then the scan side reads empty until the new one answers.
	ProductDelegate.Broadcast(Slug);
	ScanStateDelegate.Broadcast(ScanState);
	FetchProduct();
}

FString FBpLinkModule::NameOf(const FString& Slug) const
{
	if (Slug == ProductSlug() && !ProductName.IsEmpty()) return ProductName;
	if (const FBpProductEntry* Entry = FindProduct(Slug))
	{
		if (!Entry->Name.IsEmpty()) return Entry->Name;
	}
	return Slug == KettleSlug ? FString(TEXT("Kettle")) : Slug;
}

FString FBpLinkModule::PhaseLabel(const FString& Phase)
{
	// apps/web/src/buildup/contract.ts PHASE_LABEL.
	static const TMap<FString, FString> Labels = {
		{ TEXT("check"), TEXT("Check") }, { TEXT("context-map"), TEXT("Context map") }, { TEXT("seed"), TEXT("Seed") },
		{ TEXT("product-tree"), TEXT("Product tree") }, { TEXT("events"), TEXT("History") }, { TEXT("measure"), TEXT("Measure") },
		{ TEXT("judge"), TEXT("Judge") }, { TEXT("register"), TEXT("Register") },
	};
	const FString* Label = Labels.Find(Phase);
	return Label ? *Label : Phase;
}

void FBpLinkModule::StartupModule()
{
	// A commandlet (the cook in BuildCookRun) has no use for Kettle and no server to ask (machine.md, reading 19's side
	// finding: libcurl error 7 in the cook log). BpLink.Fetch still asks on demand.
	if (!IsRunningCommandlet())
	{
		// The link (night two W2a): the saved pairing and doors, then the route. -BpLinkUrl=bundle reads the bundle at once;
		// otherwise nothing is read until /api/health answered on a route (or none did, and the bundle stands in).
		LoadLink();
		if (LinkStatus.bBundleOnly)
		{
			LinkStatus.bDecided = true;
			FetchProduct();
		}
		LinkTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickLink), 0.25f);
		ScanTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickScanPoll), 0.1f);
		// The shared focus: hello, follow and the poll (FollowPollS), on the same core ticker.
		FollowTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickFollow), 0.1f);
		// The products and their onboarding (WP-V1), on the same core ticker.
		OnboardingTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickOnboarding), 0.1f);
	}
}

void FBpLinkModule::ShutdownModule()
{
	FTSTicker::GetCoreTicker().RemoveTicker(LinkTicker);
	LinkStatusDelegate.Clear();
	FTSTicker::GetCoreTicker().RemoveTicker(ScanTicker);
	FTSTicker::GetCoreTicker().RemoveTicker(FollowTicker);
	FTSTicker::GetCoreTicker().RemoveTicker(OnboardingTicker);
	GClient.Reset();
	PlanDelegate.Clear();
	PlanFailedDelegate.Clear();
	ScanStateDelegate.Clear();
	FollowDelegate.Clear();
	ProductDelegate.Clear();
	OnboardingDelegate.Clear();
	MilestoneDelegate.Clear();
	BuildupDelegate.Clear();
	FocusesDelegate.Clear();
}

// ---- The scan side (spark vr-fidelity-40 FC1): the jobs, the store's tables and the waves, polled ----------------------
// What the table's pins, scan line, decision card and the wrist panel show. Read the way the web's Kettle reads it (the
// same routes); SSE is not consumed (machine.md, reading 13: a live body never completes in UE's HTTP), so the job list
// is polled fast while a job runs and slowly otherwise. An answer whose body did not change is not parsed again, and the
// parse runs off the game thread (the /scan body is about 80 KB).

namespace
{
	/** The three parts of a poll, in the order they are asked. */
	const TCHAR* const ScanParts[3] = { TEXT("/scans"), TEXT("/scan"), TEXT("/waves") };
}

bool FBpLinkModule::TickScanPoll(float)
{
	// No route yet (the first /api/health is out) and not the bundle: nothing to ask.
	if (!GFromBundle && !GRouteLive) return true;
	const double Now = FPlatformTime::Seconds();
	if (ScanPartsOut == 0 && Now >= NextScanPollS)
	{
		const bool bBusy = ScanState.Jobs.ContainsByPredicate([](const FBpScanJob& Job) { return Job.status == TEXT("running") || Job.status == TEXT("queued"); });
		NextScanPollS = Now + (bBusy ? ScanPollBusyS : ScanPollIdleS);
		PollScan();
	}
	return true;
}

namespace
{
	/** One GET .../focuses answer's rows into List (the route's and the bundle's sample-focuses.json, the same shape). */
	bool ReadFocusRows(const FString& Body, FBpFocusList& List)
	{
		TSharedPtr<FJsonObject> Json;
		const TArray<TSharedPtr<FJsonValue>>* Rows = nullptr;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) || !Json.IsValid() || !Json->TryGetArrayField(TEXT("focuses"), Rows)) return false;
		List.bHasFocuses = true;
		List.Focuses.Reset();
		for (const TSharedPtr<FJsonValue>& Value : *Rows)
		{
			const TSharedPtr<FJsonObject>* Row = nullptr;
			FBpSavedFocus Focus;
			if (!Value.IsValid() || !Value->TryGetObject(Row) || !(*Row)->TryGetStringField(TEXT("id"), Focus.Id)) continue;
			(*Row)->TryGetStringField(TEXT("lens"), Focus.Lens);
			(*Row)->TryGetStringField(TEXT("note"), Focus.Note);
			(*Row)->TryGetStringField(TEXT("created_at"), Focus.CreatedAt);
			List.Focuses.Add(MoveTemp(Focus));
		}
		return true;
	}
}

void FBpLinkModule::PollScan()
{
	if (GFromBundle)
	{
		// The saved answers, once: nothing on the headset changes them.
		if (bScanBundled) return;
		bScanBundled = true;
		const TCHAR* const Files[3] = { TEXT("scans.json"), TEXT("scan.json"), TEXT("waves.json") };
		for (int32 Part = 0; Part < 3; ++Part)
		{
			FString Body;
			if (!ReadBundleFile(GetProductSlug(), Files[Part], Body)) continue;
			++ScanPartsOut;
			TakeScanBody(Part, MoveTemp(Body));
		}
		// The bundle's sample focuses, when it has them (Kettle's): the Scan tab stands on these, and only a sample can follow.
		FString Samples;
		if (ReadBundleFile(GetProductSlug(), TEXT("sample-focuses.json"), Samples))
		{
			++FocusList.Serial;
			if (ReadFocusRows(Samples, FocusList))
			{
				FocusList.bSample = true;
				FocusList.Error.Reset();
				UE_LOG(LogBpLink, Log, TEXT("BpLink: %s's bundle lists %d sample focuses (a scan of one is the table's local sample; nothing is sent)"), *GetProductSlug(), FocusList.Focuses.Num());
				FocusesDelegate.Broadcast(FocusList);
			}
			else UE_LOG(LogBpLink, Error, TEXT("BpLink: the bundled %s/sample-focuses.json did not parse"), *GetProductSlug());
		}
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Root = GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug();
	const uint32 Gen = GProductGen;
	for (int32 Part = 0; Part < 3; ++Part)
	{
		++ScanPartsOut;
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Root + ScanParts[Part], TEXT("application/json"));
		TrackProductRequest(Request);
		Request->OnProcessRequestComplete().BindLambda([Part, Gen](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			// Another product's poll (SetProduct reset the count it was part of): dropped.
			if (!Module || Gen != GProductGen) return;
			if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
			{
				--Module->ScanPartsOut;
				return;
			}
			Module->TakeScanBody(Part, Response->GetContentAsString());
		});
		Request->ProcessRequest();
	}
}

/** One part's answer body (from the server, or from the bundle): an unchanged body is dropped, a changed one is parsed off
 *  the game thread and handed to ReceiveScanPart. The caller counted it in ScanPartsOut; every path here takes it out. */
void FBpLinkModule::TakeScanBody(int32 Part, FString Body)
{
	const uint32 Hash = GetTypeHash(Body);
	if (Hash == ScanBodyHash[Part])
	{
		--ScanPartsOut;
		return;
	}
	ScanBodyHash[Part] = Hash;
	// /scans is a bare array and /scan a bare snapshot: both are wrapped as FBpScanWire's own keys (jobs,
	// snapshot) so one generated reader takes all three; /waves already answers { waves }.
	if (Part == 0) Body = TEXT("{\"jobs\":") + Body + TEXT("}");
	else if (Part == 1) Body = TEXT("{\"snapshot\":") + Body + TEXT("}");
	const uint32 Gen = GProductGen;
	Async(EAsyncExecution::ThreadPool, [Part, Gen, Body = MoveTemp(Body)]()
	{
		TSharedPtr<FBpScanWire> Wire = MakeShared<FBpScanWire>();
		TSharedPtr<FJsonObject> Json;
		const bool bOk = FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid() && BpSchema::FromJson(Json.ToSharedRef(), *Wire);
		FString Failed;
		if (!bOk)
		{
			const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
			Failed = FString::Printf(TEXT("%s at %s"), *Failure.Call, *Failure.Path);
		}
		// The proposals that carry a tier: an absent key is untriaged, which the generated int32 cannot tell from 0.
		TMap<FString, int32> Tiers;
		TMap<FString, double> Deltas;
		TMap<FString, double> Scores;
		TSet<FString> ScoredV5;
		const TSharedPtr<FJsonObject>* Snapshot = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* Proposals = nullptr;
		if (bOk && Part == 1 && Json->TryGetObjectField(TEXT("snapshot"), Snapshot) && (*Snapshot)->TryGetArrayField(TEXT("proposals"), Proposals))
		{
			for (const TSharedPtr<FJsonValue>& Value : *Proposals)
			{
				const TSharedPtr<FJsonObject>* Row = nullptr;
				FString Id;
				int32 Tier = 0;
				if (!Value.IsValid() || !Value->TryGetObject(Row) || !(*Row)->TryGetStringField(TEXT("id"), Id)) continue;
				if ((*Row)->TryGetNumberField(TEXT("tier"), Tier)) Tiers.Add(Id, Tier);
				double Delta = 0.0;
				if ((*Row)->TryGetNumberField(TEXT("expected_delta"), Delta)) Deltas.Add(Id, Delta);
				double Score = 0.0;
				if ((*Row)->TryGetNumberField(TEXT("score"), Score)) Scores.Add(Id, Score);
				// scan/score.ts isV5: any scan-finding/1 judgement key present on the row.
				for (const TCHAR* Key : { TEXT("score"), TEXT("impact"), TEXT("effort"), TEXT("confidence"), TEXT("category"), TEXT("predicted_verdict"), TEXT("band"), TEXT("mvp") })
				{
					if ((*Row)->HasField(Key)) { ScoredV5.Add(Id); break; }
				}
			}
		}
		AsyncTask(ENamedThreads::GameThread, [Part, Gen, Wire, bOk, Failed, Tiers = MoveTemp(Tiers), Deltas = MoveTemp(Deltas), Scores = MoveTemp(Scores), ScoredV5 = MoveTemp(ScoredV5)]() mutable
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module || Gen != GProductGen) return;
			--Module->ScanPartsOut;
			if (!bOk)
			{
				UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s did not parse into FBpScanWire (%s)"), ScanParts[Part], *Failed);
				Module->ScanBodyHash[Part] = 0;
				return;
			}
			Module->ReceiveScanPart(Part, Wire, MoveTemp(Tiers), MoveTemp(Deltas), MoveTemp(Scores), MoveTemp(ScoredV5));
		});
	});
}

void FBpLinkModule::ReceiveScanPart(int32 Part, TSharedPtr<FBpScanWire> Wire, TMap<FString, int32> Tiers, TMap<FString, double> Deltas, TMap<FString, double> Scores, TSet<FString> ScoredV5)
{
	const bool bFirst = Part == 0 ? !ScanState.bHasJobs : Part == 1 ? !ScanState.bHasScan : !ScanState.bHasWaves;
	if (Part == 0) { ScanState.Jobs = MoveTemp(Wire->jobs); ScanState.bHasJobs = true; }
	else if (Part == 1) { ScanState.Scan = MoveTemp(Wire->snapshot); ScanState.Tiers = MoveTemp(Tiers); ScanState.Deltas = MoveTemp(Deltas); ScanState.Scores = MoveTemp(Scores); ScanState.ScoredV5 = MoveTemp(ScoredV5); ScanState.bHasScan = true; }
	else { ScanState.Waves = MoveTemp(Wire->waves); ScanState.bHasWaves = true; }
	++ScanState.Serial;
	if (bFirst)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: %s %s read: jobs=%d proposals=%d tiered=%d activity=%d waves=%d"), *GetProductSlug(), ScanParts[Part],
			ScanState.Jobs.Num(), ScanState.Scan.proposals.Num(), ScanState.Tiers.Num(), ScanState.Scan.activity.Num(), ScanState.Waves.Num());
	}
	ScanStateDelegate.Broadcast(ScanState);
}

const TCHAR* const FBpLinkModule::DeviceId = TEXT("vr-table");

void FBpLinkModule::FetchBrief(const FString& ProposalId, TFunction<void(bool, const FBpDecisionBrief&)> OnDone)
{
	if (ProposalId.IsEmpty())
	{
		if (OnDone) OnDone(false, FBpDecisionBrief());
		return;
	}
	// Offline: the bundle's briefs.json (apps/vr/tools/bundle-data.mjs, F2), read once into the cache, the same lines.
	if (GFromBundle && !bBriefsBundled)
	{
		bBriefsBundled = true;
		FString Text;
		TSharedPtr<FJsonObject> Json;
		if (ReadBundleFile(GetProductSlug(), TEXT("briefs.json"), Text) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Json) && Json.IsValid())
		{
			int32 Read = 0, Bad = 0;
			for (const auto& Pair : Json->Values)
			{
				const TSharedPtr<FJsonObject>* One = nullptr;
				FBpDecisionBrief Brief;
				if (Pair.Value.IsValid() && Pair.Value->TryGetObject(One) && BpSchema::FromJson(One->ToSharedRef(), Brief)) { Briefs.Add(FString(*Pair.Key), MoveTemp(Brief)); ++Read; }
				else ++Bad;
			}
			UE_LOG(LogBpLink, Log, TEXT("BpLink: %d briefs from the bundle's briefs.json%s"), Read, Bad ? *FString::Printf(TEXT(" (%d did not parse)"), Bad) : TEXT(""));
		}
		else
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: the bundle has no briefs.json for %s: the cards are drawn without a brief"), *GetProductSlug());
		}
	}
	// Offline, the bundle's brief, answered on a later tick as a request is. Online every fetch asks again (a decision taken
	// elsewhere changes a brief); the answer refreshes the cache FindBrief reads.
	if (const FBpDecisionBrief* Known = GFromBundle ? Briefs.Find(ProposalId) : nullptr)
	{
		const FBpDecisionBrief Copy = *Known;
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([OnDone, Copy](float)
		{
			if (OnDone) OnDone(true, Copy);
			return false;
		}));
		return;
	}
	if (GFromBundle)
	{
		if (OnDone) OnDone(false, FBpDecisionBrief());
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("GET"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + TEXT("/proposals/") + FGenericPlatformHttp::UrlEncode(ProposalId) + TEXT("/brief"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	const FString Slug = GetProductSlug();
	const uint32 Gen = GProductGen;
	TrackProductRequest(Request);
	Request->OnProcessRequestComplete().BindLambda([OnDone, ProposalId, Slug, Gen](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpDecisionBrief Brief;
		if (Gen != GProductGen)
		{
			// Another product's brief: never cached under the new one.
			if (OnDone) OnDone(false, Brief);
			return;
		}
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		TSharedPtr<FJsonObject> Json;
		const bool bOk = Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid()
			&& BpSchema::FromJson(Json.ToSharedRef(), Brief);
		if (bOk)
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: brief %s/%s: %d lines, advice %s"), *Slug, *ProposalId, Brief.lines.Num(), *Brief.advice.say);
			if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->Briefs.Add(ProposalId, Brief);
		}
		else { UE_LOG(LogBpLink, Warning, TEXT("BpLink: brief %s/%s unread (HTTP %d)"), *Slug, *ProposalId, Status); }
		if (OnDone) OnDone(bOk, Brief);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::SendDecision(const TCHAR* Verb, const FString& ProposalId, TFunction<void(int32, const FString&)> OnDone)
{
	// The table's decision writes: the decline of a repeat (F8) and the approve of the card's decision (D12), each a device
	// route the server judges (a decline that is no repeat is 409 there). Nothing else is sent through here.
	const FString What = Verb;
	if (What != TEXT("decline") && What != TEXT("approve"))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused decision %s on %s: the table only declines a repeat or approves"), *What, *ProposalId);
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (GFromBundle)
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused %s %s/%s: the table reads the build's bundled snapshot, and no server keeps a decision"), *What, *GetProductSlug(), *ProposalId);
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (ProposalId.IsEmpty() || DecisionsOut.Contains(ProposalId))
	{
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	DecisionsOut.Add(ProposalId);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + TEXT("/proposals/") + FGenericPlatformHttp::UrlEncode(ProposalId) + TEXT("/") + What);
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetHeader(TEXT("x-bp-device"), DeviceId);
	Request->SetContentAsString(TEXT("{}"));
	const FString Slug = GetProductSlug();
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST %s/proposals/%s/%s (%s)"), *Slug, *ProposalId, *What,
		What == TEXT("decline") ? TEXT("a repeat; the server writes it only if the brief says so") : TEXT("the Morning Watch's Approve; no build is queued"));
	Request->OnProcessRequestComplete().BindLambda([OnDone, ProposalId, Slug, What](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: %s %s/%s answered %d %.300s"), *What, *Slug, *ProposalId, Status, *Body);
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink")))
		{
			Module->DecisionsOut.Remove(ProposalId);
			// the store moved: its brief and the scan side are read again
			if (Status == 200) { Module->Briefs.Remove(ProposalId); Module->NextScanPollS = 0.0; }
		}
		if (OnDone) OnDone(Status, Body);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ApproveDecisions(const TArray<FString>& ProposalIds, TFunction<void(int32, const TArray<FString>&, const TArray<TPair<FString, FString>>&)> OnDone)
{
	// The set of D15: one pinch, several findings. The server judges each id (the one-finding approve per id) and answers which
	// it approved and which it skipped; nothing else is sent through here.
	const auto Refuse = [&OnDone](const TCHAR* Why)
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused approve of a set: %s"), Why);
		if (OnDone) OnDone(0, TArray<FString>(), TArray<TPair<FString, FString>>());
	};
	TArray<FString> Ids;
	for (const FString& Id : ProposalIds) if (!Id.IsEmpty()) Ids.AddUnique(Id);
	if (Ids.Num() < 1 || Ids.Num() > 50) { Refuse(*FString::Printf(TEXT("%d ids, the server takes 1 to 50"), Ids.Num())); return; }
	if (GFromBundle) { Refuse(TEXT("the table reads the build's bundled snapshot, and no server keeps a decision")); return; }
	for (const FString& Id : Ids) if (DecisionsOut.Contains(Id)) { Refuse(*FString::Printf(TEXT("%s has a write out"), *Id)); return; }
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	for (const FString& Id : Ids) DecisionsOut.Add(Id);
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> IdValues;
	for (const FString& Id : Ids) IdValues.Add(MakeShared<FJsonValueString>(Id));
	Body->SetArrayField(TEXT("ids"), IdValues);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	const FString Slug = GetProductSlug();
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + Slug + TEXT("/proposals/approve"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetHeader(TEXT("x-bp-device"), DeviceId);
	Request->SetContentAsString(Text);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST %s/proposals/approve (%d findings; the Morning Watch's Approve each, no build is queued)"), *Slug, Ids.Num());
	Request->OnProcessRequestComplete().BindLambda([OnDone, Ids, Slug](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Answer = Response.IsValid() ? Response->GetContentAsString() : FString();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: approve set %s (%d) answered %d %.300s"), *Slug, Ids.Num(), Status, *Answer);
		TArray<FString> Approved;
		TArray<TPair<FString, FString>> Skipped;
		if (Status == 200)
		{
			TSharedPtr<FJsonObject> Json;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Answer), Json) && Json.IsValid())
			{
				const TArray<TSharedPtr<FJsonValue>>* ApprovedValues = nullptr;
				if (Json->TryGetArrayField(TEXT("approved"), ApprovedValues)) for (const TSharedPtr<FJsonValue>& V : *ApprovedValues) Approved.Add(V->AsString());
				const TArray<TSharedPtr<FJsonValue>>* SkippedValues = nullptr;
				if (Json->TryGetArrayField(TEXT("skipped"), SkippedValues))
				{
					for (const TSharedPtr<FJsonValue>& V : *SkippedValues)
					{
						const TSharedPtr<FJsonObject>* Row = nullptr;
						if (V->TryGetObject(Row) && Row) Skipped.Add(TPair<FString, FString>((*Row)->GetStringField(TEXT("id")), (*Row)->GetStringField(TEXT("status"))));
					}
				}
			}
		}
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink")))
		{
			for (const FString& Id : Ids) Module->DecisionsOut.Remove(Id);
			// the store moved: the approved ones' briefs and the scan side are read again
			if (Status == 200) { for (const FString& Id : Approved) Module->Briefs.Remove(Id); Module->NextScanPollS = 0.0; }
		}
		if (OnDone) OnDone(Status, Approved, Skipped);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::PostScan(const FString& Lens, const FString& Kind, const FString& Id, const FString& Label, const TArray<FString>& Features,
	TFunction<void(int32, const FString&)> OnDone, const FString& InFocus)
{
	const FString Focus = InFocus.TrimStartAndEnd();
	// Kettle's scans are simulated; a live product's run a real lens scan on a real repo. The owner's ruling (2026-11-09, table
	// link v2 section 0): a plain, a directed and an every-lens scan may start on a live product from the table, each behind the
	// table's second press (the console's armed row, the wrist's START). The bundle has no server to keep any.
	const auto Refuse = [this, &OnDone](const FString& Why)
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused POST %s/scans: %s"), *GetProductSlug(), *Why);
		if (OnDone) OnDone(0, Why);
	};
	if (GFromBundle || !GRouteLive)
	{
		Refuse(TEXT("The table reads the build's bundled snapshot, and no server keeps a scan"));
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	TSharedRef<FJsonObject> Scope = MakeShared<FJsonObject>();
	Scope->SetStringField(TEXT("kind"), Kind);
	if (!Id.IsEmpty()) Scope->SetStringField(TEXT("id"), Id);
	Scope->SetStringField(TEXT("label"), Label);
	TArray<TSharedPtr<FJsonValue>> List;
	for (const FString& Feature : Features) List.Add(MakeShared<FJsonValueString>(Feature));
	Scope->SetArrayField(TEXT("features"), List);
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("lens"), Lens);
	Body->SetObjectField(TEXT("scope"), Scope);
	// Absent on a plain scan, never empty (the route reads a `focus` key as a directed scan).
	if (!Focus.IsEmpty()) Body->SetStringField(TEXT("focus"), Focus);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<>::Create(&Text));

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + TEXT("/scans"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST %s/scans %s"), *GetProductSlug(), *Text);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		if (OnDone) OnDone(Status, Response.IsValid() ? Response->GetContentAsString() : FString());
	});
	Request->ProcessRequest();
}

void FBpLinkModule::CancelScan(const FString& JobId, TFunction<void(int32, const FString&)> OnDone)
{
	if (GFromBundle || !GRouteLive || JobId.IsEmpty())
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused DELETE %s/scans/%s: no PC keeps a job here"), *GetProductSlug(), *JobId);
		if (OnDone) OnDone(0, TEXT("No PC is linked, so there is no job to cancel."));
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Slug = GetProductSlug();
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("DELETE"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + Slug + TEXT("/scans/") + FGenericPlatformHttp::UrlEncode(JobId));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	UE_LOG(LogBpLink, Log, TEXT("BpLink: DELETE %s/scans/%s (cancel)"), *Slug, *JobId);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Slug, JobId](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		FString JobStatus;
		TSharedPtr<FJsonObject> Json;
		if (Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid()) Json->TryGetStringField(TEXT("status"), JobStatus);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: DELETE %s/scans/%s answered %d%s"), *Slug, *JobId, Status, JobStatus.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (the job is %s)"), *JobStatus));
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		const FString Words = Status == 200 ? FString(TEXT("Cancelled on your PC."))
			: Status == 404 ? FString(TEXT("That job is gone from the PC already."))
			: Status == 403 ? FString(TEXT("This headset may not cancel scans: pair it again with the scan scope."))
			: ScanAnswerWords(Status, Body);
		if (OnDone) OnDone(Status, Words);
	});
	Request->ProcessRequest();
}

FString FBpLinkModule::ScanAnswerWords(int32 Status, const FString& Body)
{
	if (Status == 0) return Body.IsEmpty() ? FString(TEXT("The PC did not answer. Is `npm run server` running?")) : Body;
	FString Error;
	TSharedPtr<FJsonObject> Json;
	if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid()) Json->TryGetStringField(TEXT("error"), Error);
	// The LAN door refuses with a bare 403 whatever the cause (lan-door.ts), so this device cannot tell a missing `scan` scope
	// from a revoked pairing; a standing order's 403 carries its own words.
	if (Status == 403) return Error.IsEmpty() ? FString(TEXT("This headset may not start scans. PAIR it again (console, PC LINK) and approve it with the scan scope: npm run server -- pair approve <code> --scope standup,place,focus,decide,scan")) : Error;
	if (Status == 429) return TEXT("The scan queue is full. Try again when one has finished.");
	if (Error == TEXT("unknown-lens")) return TEXT("This product has no such lens enabled.");
	if (Error == TEXT("no-scan-method")) return TEXT("That lens has no way to scan yet: set it up on the PC first.");
	if (Error == TEXT("bad-focus")) return TEXT("The saved note is not one a scan can take: edit it on the PC.");
	if (Error == TEXT("bad-scope")) return TEXT("The server did not accept that place as a scope.");
	if (!Error.IsEmpty()) return Error;
	return FString::Printf(TEXT("The server answered %d."), Status);
}

bool FBpLinkModule::HasPcLink() const
{
	return !GFromBundle && GRouteLive && ScanState.bHasJobs;
}

bool FBpLinkModule::HasSampleFocuses() const
{
	return GFromBundle && FocusList.bSample;
}

void FBpLinkModule::GetFocuses(TFunction<void(const FBpFocusList&)> OnDone)
{
	if (GFromBundle)
	{
		if (!FocusList.bSample) FocusList.Error = TEXT("The table reads the build's bundled snapshot, and no server keeps a focus");
		if (OnDone) OnDone(FocusList);
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Slug = GetProductSlug();
	const uint32 Gen = GProductGen;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/products/") + Slug + TEXT("/focuses"), TEXT("application/json"));
	TrackProductRequest(Request);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Slug, Gen](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module || Gen != GProductGen) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FBpFocusList& List = Module->FocusList;
		++List.Serial;
		List.Error.Reset();
		if (Status == 200 && ReadFocusRows(Response->GetContentAsString(), List))
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: %s has %d saved focuses"), *Slug, List.Focuses.Num());
		}
		else
		{
			List.Error = Status == 0 ? FString(TEXT("The PC did not answer")) : Status == 403 ? FString(TEXT("This headset may not read the saved focuses")) : FString::Printf(TEXT("The server answered %d"), Status);
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s/focuses failed (status %d)"), *Slug, Status);
		}
		Module->FocusesDelegate.Broadcast(List);
		if (OnDone) OnDone(List);
	});
	Request->ProcessRequest();
}

// ---- The draft wave (spark vr-room-layers WP2): the screen deck's Approve -----------------------------------------------
// The table's one wave write (its decisions are SendDecision's). A draft queues nothing (blueprint-ui.md, Ledger waves: "prepared as a draft and
// dispatched as a whole later"), so it is allowed on a live product too; a dispatch never leaves VR (the owner's ruling,
// 2026-10-25: "No dispatch from VR on any product"). SendWave is the door that holds that rule.

void FBpLinkModule::SendWave(const FString& Verb, const FString& Path, const FString& Body, TFunction<void(int32, const FString&)> OnDone)
{
	const bool bCompose = Verb == TEXT("POST") && Path == TEXT("/waves");
	const bool bPatch = Verb == TEXT("PATCH") && Path.StartsWith(TEXT("/waves/")) && !Path.Mid(7).Contains(TEXT("/"));
	if ((!bCompose && !bPatch) || Path.Contains(TEXT("dispatch")))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused %s %s/%s: the table only composes draft waves and never dispatches one, on any product"), *Verb, *GetProductSlug(), *Path);
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (GFromBundle)
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused %s %s%s: the table reads the build's bundled snapshot, and no server keeps a wave"), *Verb, *GetProductSlug(), *Path);
		if (OnDone) OnDone(0, FString());
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(Verb);
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + Path);
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: %s %s%s (a draft, never dispatched) %.300s"), *Verb, *GetProductSlug(), *Path, *Body);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		// The waves are read again at the next tick, so the wrist shows what was written.
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		if (OnDone) OnDone(Status, Response.IsValid() ? Response->GetContentAsString() : FString());
	});
	Request->ProcessRequest();
}

void FBpLinkModule::AddToDraft(const TArray<FString>& ProposalIds, TFunction<void(bool, const FString&, const FString&)> OnDone)
{
	const auto Done = [OnDone](bool bOk, const FString& WaveId, const FString& Note)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: draft %s: %s"), bOk ? *WaveId : TEXT("not written"), *Note);
		if (OnDone) OnDone(bOk, WaveId, Note);
	};
	if (bWaveWriteOut)
	{
		Done(false, FString(), TEXT("another draft write is still out"));
		return;
	}
	if (ProposalIds.Num() == 0)
	{
		Done(false, FString(), TEXT("no finding to add"));
		return;
	}
	// The draft to add to: the one this process last wrote to while it is still a draft, else the newest draft. A finding
	// a draft already holds is not sent again.
	const FBpWave* Draft = nullptr;
	const FBpWave* Holder = nullptr;
	TArray<FString> Fresh;
	for (const FString& Id : ProposalIds) Fresh.AddUnique(Id);
	for (const FBpWave& Wave : ScanState.Waves)
	{
		if (Wave.status != TEXT("draft")) continue;
		for (const FBpWavePackage& Package : Wave.packages)
		{
			for (const FString& Id : Package.ids)
			{
				if (Fresh.Remove(Id) > 0) Holder = &Wave;
			}
		}
		if (Wave.id == FocusWaveId) { Draft = &Wave; continue; }
		if (!Draft || (Draft->id != FocusWaveId && Wave.created_at > Draft->created_at)) Draft = &Wave;
	}
	const FString Joined = FString::Join(ProposalIds, TEXT(", "));
	if (Fresh.Num() == 0)
	{
		Done(true, Holder ? Holder->id : FString(), FString::Printf(TEXT("%s already in draft %s (\"%s\"), nothing sent"), *Joined, Holder ? *Holder->id : TEXT("?"), Holder ? *Holder->name : TEXT("?")));
		return;
	}
	const FString Adding = FString::Join(Fresh, TEXT(", "));
	const auto Package = [](const FString& Name, const FString& Model, const FString& Effort, const TArray<FString>& Ids)
	{
		TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
		Out->SetStringField(TEXT("name"), Name);
		Out->SetStringField(TEXT("model"), Model);
		Out->SetStringField(TEXT("effort"), Effort);
		TArray<TSharedPtr<FJsonValue>> List;
		for (const FString& Id : Ids) List.Add(MakeShared<FJsonValueString>(Id));
		Out->SetArrayField(TEXT("ids"), List);
		return MakeShared<FJsonValueObject>(Out);
	};
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> Packages;
	FString Verb, Path, Note;
	if (!Draft)
	{
		// WaveComposer's new wave: "Wave <n>", one package (Opus, high) holding the findings.
		Body->SetStringField(TEXT("name"), FString::Printf(TEXT("Wave %d"), ScanState.Waves.Num() + 1));
		Packages.Add(Package(TEXT("Package 1"), TEXT("opus"), TEXT("high"), Fresh));
		Verb = TEXT("POST");
		Path = TEXT("/waves");
		Note = FString::Printf(TEXT("%s compose%s a new draft"), *Adding, Fresh.Num() == 1 ? TEXT("s") : TEXT(""));
	}
	else
	{
		// WaveComposer's "Add selected": into the first package; the packages are sent whole (PATCH replaces them).
		for (int32 Index = 0; Index < Draft->packages.Num(); ++Index)
		{
			const FBpWavePackage& Each = Draft->packages[Index];
			TArray<FString> Ids = Each.ids;
			if (Index == 0) Ids.Append(Fresh);
			Packages.Add(Package(Each.name, Each.model, Each.effort, Ids));
		}
		// A draft with no packages: the loop added nothing, and the PATCH would replace the packages with [] and drop the
		// findings behind a 200. They go into a first package instead, as a new wave's do.
		if (Packages.Num() == 0) Packages.Add(Package(TEXT("Package 1"), TEXT("opus"), TEXT("high"), Fresh));
		Verb = TEXT("PATCH");
		Path = TEXT("/waves/") + Draft->id;
		Note = FString::Printf(TEXT("%s added to draft %s (\"%s\") package %s"), *Adding, *Draft->id, *Draft->name, Draft->packages.Num() > 0 ? *Draft->packages[0].name : TEXT("Package 1"));
	}
	Body->SetArrayField(TEXT("packages"), Packages);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	bWaveWriteOut = true;
	const uint32 Gen = GProductGen;
	SendWave(Verb, Path, Text, [Done, Note, Gen](int32 Status, const FString& Answer)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (Module) Module->bWaveWriteOut = false;
		// Written to the product the table has left: it stands there, but it is no longer the draft the table shows.
		if (Gen != GProductGen) Module = nullptr;
		// 201 { wave } for a new one, 200 { wave } for a patch.
		TSharedPtr<FJsonObject> Json;
		const TSharedPtr<FJsonObject>* Wave = nullptr;
		FString WaveId;
		if ((Status == 200 || Status == 201) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Answer), Json) && Json.IsValid()
			&& Json->TryGetObjectField(TEXT("wave"), Wave) && (*Wave)->TryGetStringField(TEXT("id"), WaveId))
		{
			if (Module) Module->FocusWaveId = WaveId;
			Done(true, WaveId, FString::Printf(TEXT("%s (%d)"), *Note, Status));
			return;
		}
		Done(false, FString(), FString::Printf(TEXT("%s refused %d %.200s"), *Note, Status, *Answer));
	});
}

// ---- The shared focus, followed (the "one place" morning: packages/core/src/session/focus.ts) ---------------------------
// Another surface (the web's Morning Watch, a phone, the companion) publishes where the owner is looking; the table follows.
// BpLink is one reader of the server's focus record: it says `follow *` (whoever moved last) once, `hello` every
// FollowHelloS so the others see it live, and polls the record every FollowPollS (UE's HTTP cannot hold the SSE stream:
// machine.md, reading 13). A rev it has not seen, whose place another reader published, fires OnFollow.
// It publishes too (PublishPlace): the place the owner moved the table to by hand, once the table settled there (the table
// times that and never asks while it applies a followed place). The echo rules: a rev it wrote is never followed back; a
// place that is already the shared focus is not sent at all (the server would make no rev for it either). The place baton
// (vr:<device> through /api/session/place) is another route and is not used here.

const TCHAR* const FBpLinkModule::FollowReader = TEXT("vr:table");

namespace
{
	const TCHAR* const FocusRoute = TEXT("/api/session/focus");
	const TCHAR* const FollowSurface = TEXT("vr");
	const TCHAR* const FollowLabel = TEXT("VR table");

	FAutoConsoleCommand GFollowCommand(TEXT("BpLink.Follow"), TEXT("BpLink.Follow on|off: follow the shared focus (the place another surface published), or stop."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: follow is %s"), Module->IsFollowing() ? TEXT("on") : TEXT("off"));
				return;
			}
			Module->SetFollowing(Args[0] != TEXT("off") && Args[0] != TEXT("0"));
		}));

	FAutoConsoleCommand GPublishCommand(TEXT("BpLink.Publish"), TEXT("BpLink.Publish on|off: whether the table's own moves (hands, wrist, lamp, console) become the shared focus."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			if (Args.Num() == 0)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: publish is %s"), Module->IsPublishing() ? TEXT("on") : TEXT("off"));
				return;
			}
			Module->SetPublishing(Args[0] != TEXT("off") && Args[0] != TEXT("0"));
		}));

	/** The site is the product with no target, however a caller spelt it. */
	bool IsSiteKind(const FString& Kind, const FString& Id) { return Kind.IsEmpty() || Kind == TEXT("site") || Id.IsEmpty(); }

	/** focus.ts sameSpot: one product and one target (the level and the words do not make it another place). */
	bool SameSpot(const FBpFollowPlace& A, const FBpFollowPlace& B)
	{
		if (A.Product != B.Product) return false;
		const bool bSiteA = IsSiteKind(A.Kind, A.Id), bSiteB = IsSiteKind(B.Kind, B.Id);
		return bSiteA || bSiteB ? bSiteA == bSiteB : A.Kind == B.Kind && A.Id == B.Id;
	}

	FString SpotWords(const FBpFollowPlace& P)
	{
		return P.Product + TEXT(" ") + (IsSiteKind(P.Kind, P.Id) ? FString(TEXT("site")) : P.Kind + TEXT(":") + P.Id);
	}

	// The wire is shared-focus-1 (packages/schema; focus.ts is the source): read and written through the generated
	// FBpSharedView, FBpSharedPlace, FBpFocusPlace and FBpFocusPost (ROADMAP F3). FBpFollowPlace stays BpLink's in-engine
	// type, filled from the generated one.

	/** BpLink's place from the view's shared place (a sharedPlace) and the record's rev. */
	FBpFollowPlace FollowPlaceOf(const FBpSharedPlace& Shared, int32 Rev)
	{
		FBpFollowPlace Place;
		Place.Rev = Rev;
		Place.Reader = Shared.reader;
		Place.Surface = Shared.surface;
		Place.Label = Shared.label;
		Place.Product = Shared.place.product;
		Place.Kind = Shared.place.target.kind;
		Place.Id = Shared.place.target.id;
		Place.Level = Shared.place.level;
		Place.Say = Shared.place.say;
		return Place;
	}

	/** The generated place a publish carries, from BpLink's own (the site: no target). */
	FBpFocusPlace FocusPlaceOf(const FBpFollowPlace& Place)
	{
		FBpFocusPlace Out;
		Out.product = Place.Product;
		if (!IsSiteKind(Place.Kind, Place.Id))
		{
			Out.target.kind = Place.Kind;
			Out.target.id = Place.Id;
		}
		Out.level = Place.Level;
		Out.say = Place.Say.Left(280);
		return Out;
	}

	/** Drops what a struct left empty (an empty string; an object that is empty once its own are dropped), so the
	 *  converter's output carries only what was set: the schema's optionals are absent on the wire, never '' (place.hash
	 *  says so outright, and the server refuses an empty one). */
	void DropEmpty(FJsonObject& Json)
	{
		TArray<FString> Gone;
		for (const auto& Pair : Json.Values)
		{
			const TSharedPtr<FJsonValue>& Value = Pair.Value;
			if (!Value.IsValid() || Value->IsNull() || (Value->Type == EJson::String && Value->AsString().IsEmpty()))
			{
				Gone.Add(FString(*Pair.Key));
			}
			else if (Value->Type == EJson::Object)
			{
				const TSharedPtr<FJsonObject> Inner = Value->AsObject();
				if (Inner.IsValid()) DropEmpty(*Inner);
				if (!Inner.IsValid() || Inner->Values.Num() == 0) Gone.Add(FString(*Pair.Key));
			}
		}
		for (const FString& Key : Gone) Json.RemoveField(Key);
	}

	/** A focus POST body as the condensed JSON it sends: FJsonObjectConverter over the generated FBpFocusPost (its
	 *  UPROPERTYs are named as the schema's keys), then DropEmpty. */
	bool FocusWireText(const FBpFocusPost& Post, FString& Out)
	{
		const TSharedPtr<FJsonObject> Json = FJsonObjectConverter::UStructToJsonObject(Post);
		if (!Json.IsValid()) return false;
		DropEmpty(*Json);
		Out.Reset();
		return FJsonSerializer::Serialize(Json.ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out));
	}
}

void FBpLinkModule::SetPublishing(bool bOn)
{
	bPublishing = bOn;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: publish %s"), bOn ? TEXT("on") : TEXT("off"));
}

bool FBpLinkModule::PublishPlace(const FBpFollowPlace& In)
{
	FBpFollowPlace Place = In;
	if (Place.Product.IsEmpty()) Place.Product = GetProductSlug();
	if (IsSiteKind(Place.Kind, Place.Id))
	{
		Place.Kind.Reset();
		Place.Id.Reset();
	}
	if (!bPublishing || GFromBundle)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: not publishing %s (%s)"), *SpotWords(Place), GFromBundle ? TEXT("the bundle has no server") : TEXT("publish is off"));
		return false;
	}
	// The echo rule: the place that is already the shared focus (as read, or our own publish on its way) is not news.
	const bool bHasLast = bHasNextPublish || bHasSharedSpot;
	if (bHasLast && SameSpot(bHasNextPublish ? NextPublish : SharedSpot, Place))
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: publish skipped: %s is the shared focus already"), *SpotWords(Place));
		return false;
	}
	if (bPublishOut)
	{
		// One publish at a time, so the server sees them in order; the newest waiting one wins.
		NextPublish = Place;
		bHasNextPublish = true;
		return true;
	}
	SendPublish(Place);
	return true;
}

void FBpLinkModule::SendPublish(const FBpFollowPlace& Place)
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	// The body is the generated FBpFocusPost: op publish, the table's reader record, the place.
	FBpFocusPost Post;
	Post.op = TEXT("publish");
	Post.reader = FollowReader;
	Post.surface = FollowSurface;
	Post.label = FollowLabel;
	Post.place = FocusPlaceOf(Place);
	FString Text;
	if (!FocusWireText(Post, Text))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: publish %s not sent: the post did not write"), *SpotWords(Place));
		return;
	}

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + FocusRoute);
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	bPublishOut = true;
	// Optimistic: the place is the shared focus from now (a second move to it is not sent); a refusal forgets it.
	SharedSpot = Place;
	bHasSharedSpot = true;
	// Any op says we are here.
	NextFollowHelloS = FPlatformTime::Seconds() + FollowHelloS;
	const FString Words = SpotWords(Place);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: publish %s \"%s\" (%s) as %s"), *Words, *Place.Say, *Place.Level, FollowReader);
	Request->OnProcessRequestComplete().BindLambda([Words](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module) return;
		Module->bPublishOut = false;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status == 201)
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: published %s: the shared focus moved (201)"), *Words);
		}
		else if (Status == 200)
		{
			UE_LOG(LogBpLink, Log, TEXT("BpLink: published %s: it was the shared focus already (200, no new rev)"), *Words);
		}
		else
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: POST %s publish %s answered %d: %.160s"), FocusRoute, *Words, Status,
				Response.IsValid() ? *Response->GetContentAsString() : TEXT(""));
			Module->bHasSharedSpot = false;
		}
		if (Module->bHasNextPublish)
		{
			const FBpFollowPlace Next = Module->NextPublish;
			Module->bHasNextPublish = false;
			if (!Module->bHasSharedSpot || !SameSpot(Module->SharedSpot, Next)) Module->SendPublish(Next);
		}
	});
	Request->ProcessRequest();
}

void FBpLinkModule::SetFollowing(bool bOn)
{
	if (bOn == bFollowing) return;
	bFollowing = bOn;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: follow %s"), bOn ? TEXT("on") : TEXT("off"));
	if (bOn)
	{
		// The shared place as it stands is taken at the next read, as at start.
		bFollowSaid = false;
		FollowRev = -1;
		NextFollowPollS = 0.0;
	}
	else
	{
		SendFollowOp(TEXT("unfollow"));
	}
}

bool FBpLinkModule::TickFollow(float)
{
	// The bundle has no server to keep a focus record; with no route there is no one to ask.
	if (GFromBundle || !GRouteLive) return true;
	const double Now = FPlatformTime::Seconds();
	if (!bFollowOpOut)
	{
		if (bFollowing && !bFollowSaid) SendFollowOp(TEXT("follow"));
		else if (Now >= NextFollowHelloS) SendFollowOp(TEXT("hello"));
	}
	if (!bFollowPollOut && Now >= NextFollowPollS)
	{
		NextFollowPollS = Now + FollowPollS;
		if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
		bFollowPollOut = true;
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + FocusRoute, TEXT("application/json"));
		Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			Module->bFollowPollOut = false;
			const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
			if (Status != 200)
			{
				if (!Module->bFollowUnreachableLogged)
				{
					UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s answered %d; the table keeps its place until the shared focus reads again"), FocusRoute, Status);
					Module->bFollowUnreachableLogged = true;
				}
				return;
			}
			Module->bFollowUnreachableLogged = false;
			Module->ReceiveFollowView(Response->GetContentAsString());
		});
		Request->ProcessRequest();
	}
	return true;
}

void FBpLinkModule::SendFollowOp(const TCHAR* Op)
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	FBpFocusPost Post;
	Post.op = Op;
	Post.reader = FollowReader;
	Post.surface = FollowSurface;
	Post.label = FollowLabel;
	const bool bFollow = FCString::Strcmp(Op, TEXT("follow")) == 0;
	if (bFollow) Post.of = TEXT("*");
	FString Text;
	if (!FocusWireText(Post, Text))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: %s not sent: the post did not write"), Op);
		return;
	}

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + FocusRoute);
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	bFollowOpOut = true;
	// Any op says we are here, so the next hello is due FollowHelloS from now; a failed one is tried again sooner.
	NextFollowHelloS = FPlatformTime::Seconds() + FollowHelloS;
	const FString Said = Op;
	Request->OnProcessRequestComplete().BindLambda([Said, bFollow](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module) return;
		Module->bFollowOpOut = false;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status != 200)
		{
			Module->NextFollowHelloS = FPlatformTime::Seconds() + 2.0 * FollowPollS;
			if (bFollow) UE_LOG(LogBpLink, Warning, TEXT("BpLink: POST %s %s answered %d; asked again in %.0f s"), FocusRoute, *Said, Status, 2.0 * FollowPollS);
			return;
		}
		if (bFollow)
		{
			Module->bFollowSaid = true;
			UE_LOG(LogBpLink, Log, TEXT("BpLink: following the shared focus as %s (whoever moves last)"), FollowReader);
		}
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ReceiveFollowView(const FString& Body)
{
	// The view is the generated FBpSharedView, read with BpSchema::FromJson; its `shared` (a sharedPlace, or null before
	// anyone published: the converter leaves the wrapper empty) is read the same way into FBpSharedPlace. A view that does
	// not read is logged and skipped: the table keeps its place until the next poll.
	TSharedPtr<FJsonObject> Json;
	FBpSharedView View;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) || !Json.IsValid() || !BpSchema::FromJson(Json.ToSharedRef(), View))
	{
		const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET %s did not read as a shared view (%s %s): %.120s"), FocusRoute, *Failure.Call, *Failure.Path, *Body);
		return;
	}
	// The record no longer shows us following (a fresh record, or one that forgot us): say it again.
	bool bListed = false;
	for (const FBpViewReader& Reader : View.readers)
	{
		if (Reader.id == FollowReader) bListed = Reader.follows == TEXT("*");
	}
	if (bFollowing && bFollowSaid && !bListed && !bFollowOpOut) bFollowSaid = false;

	const int32 Rev = View.rev;
	if (Rev == FollowRev) return;
	const bool bFirst = FollowRev < 0;
	FollowRev = Rev;
	FBpSharedPlace Shared;
	const TSharedPtr<FJsonObject>& SharedJson = View.shared.JsonObject;
	const bool bHasShared = SharedJson.IsValid() && SharedJson->Values.Num() > 0;
	if (!bHasShared || !BpSchema::FromJson(SharedJson.ToSharedRef(), Shared) || Shared.place.product.IsEmpty())
	{
		// No shared place (a fresh record), or one that does not read: nothing to go to, and the last one is no longer
		// the owner's.
		if (bHasShared)
		{
			const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure();
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: shared focus rev %d: the shared place did not read (%s %s)"), Rev, *Failure.Call, *Failure.Path);
		}
		bHasFollowPlace = false;
		bHasSharedSpot = false;
		return;
	}
	const FBpFollowPlace Place = FollowPlaceOf(Shared, Rev);
	// The shared focus as it stands now, whoever put it there: the echo rule's reference (PublishPlace).
	SharedSpot = Place;
	bHasSharedSpot = true;
	// Our own publish is never news; and the place last followed is no longer the owner's, so a table that begins play
	// later stays where it is.
	if (Place.Reader == FollowReader)
	{
		bHasFollowPlace = false;
		UE_LOG(LogBpLink, Log, TEXT("BpLink: shared focus rev %d: %s is ours (not followed back)"), Rev, *SpotWords(Place));
		return;
	}
	UE_LOG(LogBpLink, Log, TEXT("BpLink: shared focus rev %d%s: %s %s:%s by %s (%s)%s"), Rev, bFirst ? TEXT(" (as it stood)") : TEXT(""), *Place.Product,
		Place.Kind.IsEmpty() ? TEXT("site") : *Place.Kind, *Place.Id, *Place.Label, *Place.Surface, bFollowing ? TEXT("") : TEXT("; not following, so not applied"));
	if (!bFollowing) return;
	// The table goes where it is told: a move of its own still waiting to be sent is no longer where it rests.
	bHasNextPublish = false;
	FollowPlace = Place;
	bHasFollowPlace = true;
	FollowDelegate.Broadcast(FollowPlace);
}

// ---- Products and their onboarding (spark onboarding-vr WP-V1) -----------------------------------------------------------
// An onboarding is started on the web (/projects -> the server's adopt job); the table only watches. It polls, as it polls
// the scan side (UE's HTTP cannot read SSE, machine.md reading 13): GET /api/products for the list (Kettle is built in and
// not listed), GET /api/onboarding for each product's latest adopt job, and, for a running job only, its
// .../onboarding/feed from the last event read, for the progress count (`progress` n of N) the job record does not carry.
// The build-up drawn from the feed is WP-V2's; nothing here draws.

namespace
{
	/** contract.ts PHASES, in order: a job's phase index, -1 for none or an unknown one. */
	int32 PhaseIndex(const FString& Phase)
	{
		static const TCHAR* const Phases[] = { TEXT("check"), TEXT("context-map"), TEXT("seed"), TEXT("product-tree"), TEXT("events"), TEXT("measure"), TEXT("judge"), TEXT("register") };
		for (int32 Index = 0; Index < UE_ARRAY_COUNT(Phases); ++Index)
		{
			if (Phase == Phases[Index]) return Index;
		}
		return -1;
	}
	const int32 ProductTreeIndex = 3;

	FString SayPhase(const FString& Phase) { return FBpLinkModule::PhaseLabel(Phase).ToLower(); }

	FAutoConsoleCommand GOnboardingCommand(TEXT("BpLink.Onboarding"), TEXT("Log the products and their onboarding as last polled (GET /api/products, /api/onboarding, a running job's feed)."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
			if (!Module) return;
			const FBpOnboardingState& State = Module->GetOnboarding();
			UE_LOG(LogBpLink, Log, TEXT("BpLink: onboarding products=%d (list read %d, onboarding read %d), open %s"), State.Products.Num(), State.bHasProducts, State.bHasOnboarding, *Module->GetProductSlug());
			for (const FBpProductEntry& Entry : State.Products)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink:   %s \"%s\" map=%d %s phase=%s %d/%d (%s) job=%s%s"), *Entry.Slug, *Entry.Name, Entry.bHasMap, *Entry.State, *Entry.Phase,
					Entry.N, Entry.Of, *Entry.ProgressPhase, *Entry.JobId, Entry.Error.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" error \"%s\""), *Entry.Error.Left(120)));
			}
		}));
}

bool FBpLinkModule::TickOnboarding(float)
{
	// The bundle has no server, so no other product and no onboarding; nor does a table with no route.
	if (GFromBundle || !GRouteLive) return true;
	const double Now = FPlatformTime::Seconds();
	if (!bProductsOut && Now >= NextProductsPollS)
	{
		NextProductsPollS = Now + ProductsPollS;
		PollProducts();
	}
	if (!bOnboardingOut && Now >= NextOnboardingPollS)
	{
		const bool bBusy = Onboarding.Products.ContainsByPredicate([](const FBpProductEntry& E) { return E.IsBuilding(); });
		NextOnboardingPollS = Now + (bBusy ? OnboardingBusyS : OnboardingPollS);
		PollOnboarding();
	}
	// The open product's build-up (WP-V2): its feed, while its job runs.
	TickBuildup(Now);
	return true;
}

void FBpLinkModule::PollProducts()
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	bProductsOut = true;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/products"), TEXT("application/json"));
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module) return;
		Module->bProductsOut = false;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status != 200)
		{
			if (!Module->bProductsMissLogged) UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET /api/products answered %d; the wrist lists what it knows"), Status);
			Module->bProductsMissLogged = true;
			return;
		}
		Module->bProductsMissLogged = false;
		Module->ReceiveProducts(Response->GetContentAsString());
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ReceiveProducts(const FString& Body)
{
	// ProductInfo[]: { slug, name, root, live, readiness: { map, ... } }; Kettle (built in) is not listed and leads.
	TArray<TSharedPtr<FJsonValue>> Rows;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Rows))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET /api/products did not read as a list: %.120s"), *Body);
		return;
	}
	TArray<FBpProductEntry> Next;
	const auto Keep = [this, &Next](const FString& Slug, const FString& Name, bool bMap)
	{
		FBpProductEntry Entry;
		if (const FBpProductEntry* Known = FindProduct(Slug)) Entry = *Known;
		Entry.Slug = Slug;
		if (!Name.IsEmpty()) Entry.Name = Name;
		Entry.bHasMap = bMap;
		Next.Add(MoveTemp(Entry));
	};
	Keep(KettleSlug, TEXT("Kettle"), true);
	for (const TSharedPtr<FJsonValue>& Value : Rows)
	{
		const TSharedPtr<FJsonObject>* Row = nullptr;
		FString Slug, Name;
		if (!Value.IsValid() || !Value->TryGetObject(Row) || !(*Row)->TryGetStringField(TEXT("slug"), Slug) || Slug == KettleSlug) continue;
		(*Row)->TryGetStringField(TEXT("name"), Name);
		bool bMap = false;
		const TSharedPtr<FJsonObject>* Readiness = nullptr;
		if ((*Row)->TryGetObjectField(TEXT("readiness"), Readiness)) (*Readiness)->TryGetBoolField(TEXT("map"), bMap);
		Keep(Slug, Name, bMap);
	}
	// A product the onboarding list knows while it builds and this list does not (yet) stays.
	for (const FBpProductEntry& Old : Onboarding.Products)
	{
		if (Old.IsBuilding() && !Next.ContainsByPredicate([&Old](const FBpProductEntry& E) { return E.Slug == Old.Slug; })) Next.Add(Old);
	}
	FString Was, Now;
	for (const FBpProductEntry& E : Onboarding.Products) Was += FString::Printf(TEXT("%s:%s:%d;"), *E.Slug, *E.Name, E.bHasMap);
	for (const FBpProductEntry& E : Next) Now += FString::Printf(TEXT("%s:%s:%d;"), *E.Slug, *E.Name, E.bHasMap);
	const bool bFirst = !Onboarding.bHasProducts;
	Onboarding.bHasProducts = true;
	if (Was == Now && !bFirst) return;
	Onboarding.Products = MoveTemp(Next);
	++Onboarding.Serial;
	TArray<FString> Names;
	for (const FBpProductEntry& E : Onboarding.Products) Names.Add(E.Slug + (E.bHasMap ? TEXT("") : TEXT(" (no map)")));
	UE_LOG(LogBpLink, Log, TEXT("BpLink: products %d [%s]"), Onboarding.Products.Num(), *FString::Join(Names, TEXT(", ")));
	OnboardingDelegate.Broadcast(Onboarding);
}

void FBpLinkModule::PollOnboarding()
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	bOnboardingOut = true;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/onboarding"), TEXT("application/json"));
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module) return;
		Module->bOnboardingOut = false;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status != 200)
		{
			if (!Module->bOnboardingMissLogged) UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET /api/onboarding answered %d; no onboarding is shown until it reads"), Status);
			Module->bOnboardingMissLogged = true;
			return;
		}
		Module->bOnboardingMissLogged = false;
		Module->ReceiveOnboarding(Response->GetContentAsString());
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ReceiveOnboarding(const FString& Body)
{
	// { items: [{ slug, name, job: ScanJob | null }] } (the shared contract; WP-S's route).
	TSharedPtr<FJsonObject> Json;
	const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) || !Json.IsValid() || !Json->TryGetArrayField(TEXT("items"), Items))
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: GET /api/onboarding did not read as { items }: %.120s"), *Body);
		return;
	}
	bool bChanged = !Onboarding.bHasOnboarding;
	Onboarding.bHasOnboarding = true;
	// The running jobs' feeds are asked after the walk: a milestone may read the open product again, and the list must not
	// move under the loop.
	TArray<FBpProductEntry> Running;
	for (const TSharedPtr<FJsonValue>& Value : *Items)
	{
		const TSharedPtr<FJsonObject>* Item = nullptr;
		FString Slug;
		if (!Value.IsValid() || !Value->TryGetObject(Item) || !(*Item)->TryGetStringField(TEXT("slug"), Slug) || Slug.IsEmpty()) continue;
		int32 At = Onboarding.Products.IndexOfByPredicate([&Slug](const FBpProductEntry& E) { return E.Slug == Slug; });
		if (At == INDEX_NONE)
		{
			// Not in the products list yet (it is read every ProductsPollS): known from here until then.
			FBpProductEntry Fresh;
			Fresh.Slug = Slug;
			At = Onboarding.Products.Add(MoveTemp(Fresh));
			bChanged = true;
		}
		FBpProductEntry& Entry = Onboarding.Products[At];
		FString Name;
		if ((*Item)->TryGetStringField(TEXT("name"), Name) && !Name.IsEmpty() && Name != Entry.Name) { Entry.Name = Name; bChanged = true; }
		const FBpProductEntry Was = Entry;
		const TSharedPtr<FJsonObject>* Job = nullptr;
		if (!(*Item)->TryGetObjectField(TEXT("job"), Job))
		{
			Entry.State = TEXT("none");
			Entry.JobId.Reset();
			Entry.Phase.Reset();
			Entry.Error.Reset();
			Entry.N = Entry.Of = 0;
			Entry.ProgressPhase.Reset();
		}
		else
		{
			FString Id, Status, Phase, Error;
			(*Job)->TryGetStringField(TEXT("id"), Id);
			(*Job)->TryGetStringField(TEXT("status"), Status);
			(*Job)->TryGetStringField(TEXT("adopt_phase"), Phase);
			(*Job)->TryGetStringField(TEXT("error"), Error);
			if (Id != Entry.JobId)
			{
				// Another job: its count is its own.
				Entry.N = Entry.Of = 0;
				Entry.ProgressPhase.Reset();
			}
			Entry.JobId = Id;
			Entry.State = Status.IsEmpty() ? FString(TEXT("none")) : Status;
			// The feed may know a later phase than the record (a `phase` start): the later one stands while it builds.
			if (Id != Was.JobId || PhaseIndex(Phase) >= PhaseIndex(Entry.Phase) || !Entry.IsBuilding()) Entry.Phase = Phase;
			Entry.Error = Error;
		}
		if (Was.State != Entry.State || Was.JobId != Entry.JobId || Was.Phase != Entry.Phase || Was.Error != Entry.Error)
		{
			bChanged = true;
			LogOnboardingEntry(Entry);
		}
		const FBpProductEntry Now = Entry;
		if (!Now.JobId.IsEmpty())
		{
			const bool bFirstSight = !JobsSeen.Contains(Now.JobId);
			const bool bSameJob = Was.JobId == Now.JobId;
			JudgeMilestones(Now, bSameJob ? Was.State : FString(), bSameJob ? Was.Phase : FString(), bFirstSight);
		}
		// A running job's count, from its journal (only the running ones: an ended job's count no longer moves).
		if (Now.State == TEXT("running")) Running.Add(Now);
	}
	for (const FBpProductEntry& Each : Running) PollFeed(Each);
	if (!bChanged) return;
	++Onboarding.Serial;
	OnboardingDelegate.Broadcast(Onboarding);
}

void FBpLinkModule::LogOnboardingEntry(const FBpProductEntry& Entry) const
{
	UE_LOG(LogBpLink, Log, TEXT("BpLink: onboarding %s %s%s%s%s"), *Entry.Slug, *Entry.State,
		Entry.Phase.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" %s"), *Entry.Phase),
		Entry.Of > 0 ? *FString::Printf(TEXT(" %d/%d (%s)"), Entry.N, Entry.Of, *Entry.ProgressPhase) : TEXT(""),
		Entry.JobId.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" job %s"), *Entry.JobId));
}

void FBpLinkModule::JudgeMilestones(const FBpProductEntry& Entry, const FString& WasState, const FString& WasPhase, bool bFirstSight)
{
	FJobSeen& Seen = JobsSeen.FindOrAdd(Entry.JobId);
	const bool bEnded = !Entry.IsBuilding();
	const bool bPastTree = Entry.State == TEXT("done") || PhaseIndex(Entry.Phase) > ProductTreeIndex;
	if (bFirstSight)
	{
		// The baseline: what stood when the table first saw the job is not news. A job already ended has nothing left to
		// say; a running one past product-tree has drawn its plan already.
		Seen.bEndSaid = bEnded;
		Seen.bPlanSaid = bEnded || bPastTree;
		UE_LOG(LogBpLink, Log, TEXT("BpLink: onboarding %s job %s first seen %s %s (milestones from here)"), *Entry.Slug, *Entry.JobId, *Entry.State, *Entry.Phase);
		return;
	}
	const FString Name = Entry.Name.IsEmpty() ? Entry.Slug : Entry.Name;
	const auto Say = [this, &Entry](EBpOnboardingMilestone Kind, const FString& Line)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: onboarding milestone %s: \"%s\""), *Entry.Slug, *Line);
		MilestoneDelegate.Broadcast(Entry, Kind, Line);
	};
	if (bEnded && !Seen.bEndSaid)
	{
		Seen.bEndSaid = true;
		// The end says it all: a plan drawn on the way is not said after it.
		Seen.bPlanSaid = true;
		if (Entry.State == TEXT("done"))
		{
			Say(EBpOnboardingMilestone::Done, FString::Printf(TEXT("%s is in bp"), *Name));
			// The open product's own job is done: its map is there now, and the table becomes the live table.
			if (Entry.Slug == GetProductSlug())
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: %s finished onboarding while open: reading it again"), *Entry.Slug);
				FetchProduct();
				NextScanPollS = 0.0;
			}
		}
		else if (Entry.IsStopped())
		{
			const FString Phase = Entry.Phase.IsEmpty() ? WasPhase : Entry.Phase;
			Say(EBpOnboardingMilestone::Stopped, Phase.IsEmpty() ? FString::Printf(TEXT("%s stopped"), *Name) : FString::Printf(TEXT("%s stopped at %s"), *Name, *SayPhase(Phase)));
		}
		return;
	}
	if (!bEnded && bPastTree && !Seen.bPlanSaid)
	{
		Seen.bPlanSaid = true;
		Say(EBpOnboardingMilestone::PlanDrawn, FString::Printf(TEXT("%s: the plan is drawn"), *Name));
	}
}

void FBpLinkModule::PollFeed(const FBpProductEntry& Entry)
{
	if (Entry.JobId.IsEmpty() || FeedsOut.Contains(Entry.JobId)) return;
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const int32 After = FeedNext.FindRef(Entry.JobId);
	const FString Url = FString::Printf(TEXT("%s/api/products/%s/onboarding/feed?after=%d&job=%s"), *GClient->GetBaseUrl(), *Entry.Slug, After,
		*FGenericPlatformHttp::UrlEncode(Entry.JobId));
	FeedsOut.Add(Entry.JobId);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url, TEXT("application/json"));
	const FString Slug = Entry.Slug, JobId = Entry.JobId;
	Request->OnProcessRequestComplete().BindLambda([Slug, JobId, After](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status != 200)
		{
			Module->FeedsOut.Remove(JobId);
			return;
		}
		// Up to 500 events, structure chunks among them: read off the game thread, and only the count and phase come back.
		Async(EAsyncExecution::ThreadPool, [Slug, JobId, After, Body = Response->GetContentAsString()]()
		{
			int32 Next = After, N = 0, Of = 0;
			FString ProgressPhase, Phase;
			TSharedPtr<FJsonObject> Json;
			const TArray<TSharedPtr<FJsonValue>>* Events = nullptr;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid())
			{
				Json->TryGetNumberField(TEXT("next"), Next);
				if (Json->TryGetArrayField(TEXT("events"), Events))
				{
					for (const TSharedPtr<FJsonValue>& Value : *Events)
					{
						const TSharedPtr<FJsonObject>* Event = nullptr;
						FString Type;
						if (!Value.IsValid() || !Value->TryGetObject(Event) || !(*Event)->TryGetStringField(TEXT("type"), Type)) continue;
						if (Type == TEXT("progress"))
						{
							(*Event)->TryGetNumberField(TEXT("n"), N);
							(*Event)->TryGetNumberField(TEXT("of"), Of);
							(*Event)->TryGetStringField(TEXT("phase"), ProgressPhase);
						}
						else if (Type == TEXT("phase"))
						{
							FString State;
							(*Event)->TryGetStringField(TEXT("state"), State);
							if (State == TEXT("start")) (*Event)->TryGetStringField(TEXT("phase"), Phase);
						}
					}
				}
			}
			AsyncTask(ENamedThreads::GameThread, [Slug, JobId, Next, N, Of, ProgressPhase, Phase]()
			{
				if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink")))
				{
					Module->FeedsOut.Remove(JobId);
					Module->ReceiveFeed(Slug, JobId, Next, N, Of, ProgressPhase, Phase);
				}
			});
		});
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ReceiveFeed(const FString& Slug, const FString& JobId, int32 Next, int32 N, int32 Of, const FString& ProgressPhase, const FString& Phase)
{
	FeedNext.Add(JobId, Next);
	FBpProductEntry* Entry = Onboarding.Products.FindByPredicate([&Slug](const FBpProductEntry& E) { return E.Slug == Slug; });
	if (!Entry || Entry->JobId != JobId) return;
	bool bChanged = false;
	if (Of > 0 && (N != Entry->N || Of != Entry->Of || ProgressPhase != Entry->ProgressPhase))
	{
		Entry->N = N;
		Entry->Of = Of;
		Entry->ProgressPhase = ProgressPhase;
		bChanged = true;
	}
	FString WasPhase;
	bool bPhaseMoved = false;
	if (!Phase.IsEmpty() && Entry->IsBuilding() && PhaseIndex(Phase) > PhaseIndex(Entry->Phase))
	{
		WasPhase = Entry->Phase;
		Entry->Phase = Phase;
		bChanged = bPhaseMoved = true;
	}
	if (!bChanged) return;
	LogOnboardingEntry(*Entry);
	const FBpProductEntry Now = *Entry;
	// The journal saw the phase move before the job record did: the milestone is said from here.
	if (bPhaseMoved) JudgeMilestones(Now, Now.State, WasPhase, !JobsSeen.Contains(Now.JobId));
	++Onboarding.Serial;
	OnboardingDelegate.Broadcast(Onboarding);
}

// ---- The open product's build-up feed (spark onboarding-vr WP-V2) --------------------------------------------------------
// While the open product's adopt job runs, the table draws its onboarding as it happens: BpLink reads the job's journal
// through GET .../onboarding/feed?after=<n>&job=<id>&layout=islands every BuildupPollS (UE's HTTP cannot read the SSE
// route, machine.md reading 13) and hands the table each answer, parsed off the game thread into FBpBuildupEvent. The
// first answer after a (re)start carries every event so far and is marked past (the table draws it at its end state).

namespace
{
	FBpPlanBox ReadBox(const TSharedPtr<FJsonObject>& Node)
	{
		FBpPlanBox Box;
		const TSharedPtr<FJsonObject>* B = nullptr;
		if (Node.IsValid() && Node->TryGetObjectField(TEXT("box"), B))
		{
			(*B)->TryGetNumberField(TEXT("x"), Box.x);
			(*B)->TryGetNumberField(TEXT("y"), Box.y);
			(*B)->TryGetNumberField(TEXT("w"), Box.w);
			(*B)->TryGetNumberField(TEXT("h"), Box.h);
		}
		return Box;
	}

	FString Str(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		FString Value;
		if (Object.IsValid()) Object->TryGetStringField(Field, Value);
		return Value;
	}

	/** Each object of an array field. */
	TArray<TSharedPtr<FJsonObject>> Objects(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		TArray<TSharedPtr<FJsonObject>> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (!Object.IsValid() || !Object->TryGetArrayField(Field, Values)) return Out;
		for (const TSharedPtr<FJsonValue>& Value : *Values)
		{
			const TSharedPtr<FJsonObject>* Each = nullptr;
			if (Value.IsValid() && Value->TryGetObject(Each)) Out.Add(*Each);
		}
		return Out;
	}

	bool ReadBuildupEvent(const TSharedPtr<FJsonObject>& E, FBpBuildupEvent& Out)
	{
		if (!E.IsValid() || !E->TryGetStringField(TEXT("type"), Out.Type)) return false;
		E->TryGetNumberField(TEXT("at"), Out.At);
		Out.Phase = Str(E, TEXT("phase"));
		Out.State = Str(E, TEXT("state"));
		Out.Detail = Str(E, TEXT("detail"));
		Out.Next = Str(E, TEXT("next"));
		Out.Verb = Str(E, TEXT("verb"));
		Out.Path = Str(E, TEXT("path"));
		Out.Area = Str(E, TEXT("area"));
		E->TryGetNumberField(TEXT("n"), Out.N);
		E->TryGetNumberField(TEXT("of"), Out.Of);
		E->TryGetBoolField(TEXT("provisional"), Out.bProvisional);
		Out.Text = Str(E, Out.Type == TEXT("failed") ? TEXT("message") : TEXT("text"));
		if (Out.Type == TEXT("begin"))
		{
			const TSharedPtr<FJsonObject>* Project = nullptr;
			if (E->TryGetObjectField(TEXT("project"), Project)) Out.Text = Str(*Project, TEXT("name"));
		}
		const TArray<TSharedPtr<FJsonValue>>* Features = nullptr;
		if (E->TryGetArrayField(TEXT("features"), Features))
		{
			for (const TSharedPtr<FJsonValue>& Value : *Features)
			{
				FString Slug;
				if (Value.IsValid() && Value->TryGetString(Slug)) Out.Features.Add(Slug);
			}
		}
		for (const TSharedPtr<FJsonObject>& A : Objects(E, TEXT("areas")))
		{
			FBpBuildupArea Area;
			Area.Id = Str(A, TEXT("id"));
			Area.Name = Str(A, TEXT("name"));
			Area.Group = Str(A, TEXT("group"));
			A->TryGetNumberField(TEXT("files"), Area.Files);
			double Lines = -1.0;
			if (A->TryGetNumberField(TEXT("lines"), Lines)) Area.Lines = static_cast<int32>(Lines);
			if (!Area.Id.IsEmpty()) Out.Areas.Add(MoveTemp(Area));
		}
		for (const TSharedPtr<FJsonObject>& D : Objects(E, TEXT("domains")))
		{
			FBpBuildupDomain Domain;
			Domain.Id = Str(D, TEXT("id"));
			Domain.Name = Str(D, TEXT("name"));
			D->TryGetNumberField(TEXT("order"), Domain.Order);
			for (const TSharedPtr<FJsonObject>& C : Objects(D, TEXT("capabilities")))
			{
				Domain.CapIds.Add(Str(C, TEXT("id")));
				Domain.CapNames.Add(Str(C, TEXT("name")));
			}
			if (!Domain.Id.IsEmpty()) Out.Domains.Add(MoveTemp(Domain));
		}
		if (Out.Type == TEXT("structure"))
		{
			for (const TSharedPtr<FJsonObject>& W : Objects(E, TEXT("wings")))
			{
				FBpPlanWing Wing;
				Wing.id = Str(W, TEXT("id"));
				Wing.name = Str(W, TEXT("name"));
				Wing.letter = Str(W, TEXT("letter"));
				W->TryGetNumberField(TEXT("order"), Wing.order);
				Wing.box = ReadBox(W);
				Out.Structure.wings.Add(MoveTemp(Wing));
			}
			for (const TSharedPtr<FJsonObject>& R : Objects(E, TEXT("rooms")))
			{
				FBpPlanRoom Room;
				Room.id = Str(R, TEXT("id"));
				Room.parentId = Str(R, TEXT("parentId"));
				Room.name = Str(R, TEXT("name"));
				R->TryGetNumberField(TEXT("order"), Room.order);
				Room.box = ReadBox(R);
				Out.Structure.rooms.Add(MoveTemp(Room));
			}
			for (const TSharedPtr<FJsonObject>& B : Objects(E, TEXT("bays")))
			{
				FBpPlanBay Bay;
				Bay.id = Str(B, TEXT("id"));
				Bay.parentId = Str(B, TEXT("parentId"));
				Bay.name = Str(B, TEXT("name"));
				B->TryGetNumberField(TEXT("order"), Bay.order);
				Bay.box = ReadBox(B);
				Out.Structure.bays.Add(MoveTemp(Bay));
			}
			for (const TSharedPtr<FJsonObject>& T : Objects(E, TEXT("tiles")))
			{
				FBpPlanTile Tile;
				Tile.id = Str(T, TEXT("id"));
				Tile.parentId = Str(T, TEXT("parentId"));
				Tile.name = Str(T, TEXT("name"));
				T->TryGetNumberField(TEXT("order"), Tile.order);
				Tile.box = ReadBox(T);
				Tile.general = TEXT("unmeasured");
				Out.Tiles.Emplace(Tile.id, Str(T, TEXT("kind")));
				Out.Structure.tiles.Add(MoveTemp(Tile));
			}
		}
		else if (Out.Type == TEXT("history") || Out.Type == TEXT("health"))
		{
			const TCHAR* Field = Out.Type == TEXT("history") ? TEXT("created") : TEXT("general");
			for (const TSharedPtr<FJsonObject>& T : Objects(E, TEXT("tiles"))) Out.Tiles.Emplace(Str(T, TEXT("id")), Str(T, Field));
		}
		return true;
	}
}

void FBpLinkModule::ResetBuildup()
{
	BuildupJob.Reset();
	BuildupNext = 0;
	bBuildupOut = false;
	bBuildupDone = false;
	bBuildupPast = true;
	NextBuildupPollS = 0.0;
}

void FBpLinkModule::TickBuildup(double Now)
{
	const FBpProductEntry* Entry = FindProduct(ProductSlug());
	if (!Entry || Entry->JobId.IsEmpty()) return;
	if (Entry->JobId != BuildupJob)
	{
		// Another job of the open product (or the first one seen): read it from its begin. A job that ended done before the
		// table opened the product is not drawn again: the live plan is the table. One that stopped with no map is (what
		// was drawn stays drawn).
		const bool bWatch = Entry->IsBuilding() || (Entry->IsStopped() && !Entry->bHasMap);
		if (!bWatch) return;
		ResetBuildup();
		BuildupJob = Entry->JobId;
		UE_LOG(LogBpLink, Log, TEXT("BpLink: build-up of %s: reading job %s's feed from its begin (%s %s)"), *Entry->Slug, *BuildupJob, *Entry->State, *Entry->Phase);
	}
	if (bBuildupDone || bBuildupOut || Now < NextBuildupPollS) return;
	NextBuildupPollS = Now + BuildupPollS;
	PollBuildup(*Entry);
}

void FBpLinkModule::PollBuildup(const FBpProductEntry& Entry)
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Url = FString::Printf(TEXT("%s/api/products/%s/onboarding/feed?after=%d&job=%s&layout=islands"), *GClient->GetBaseUrl(), *Entry.Slug, BuildupNext,
		*FGenericPlatformHttp::UrlEncode(Entry.JobId));
	bBuildupOut = true;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url, TEXT("application/json"));
	TrackProductRequest(Request);
	const uint32 Gen = GProductGen;
	const FString Slug = Entry.Slug, JobId = Entry.JobId;
	const bool bPast = bBuildupPast;
	Request->OnProcessRequestComplete().BindLambda([Gen, Slug, JobId, bPast](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (!Module || Gen != GProductGen || Module->BuildupJob != JobId) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status != 200)
		{
			Module->bBuildupOut = false;
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: build-up feed of %s answered %d"), *Slug, Status);
			return;
		}
		// Up to 500 events with the whole product tree among them: parsed off the game thread (prepare), handed over whole
		// on it (commit).
		Async(EAsyncExecution::ThreadPool, [Gen, Slug, JobId, bPast, Body = Response->GetContentAsString()]()
		{
			TSharedPtr<FBpBuildupBatch> Batch = MakeShared<FBpBuildupBatch>();
			Batch->Slug = Slug;
			Batch->JobId = JobId;
			Batch->bPast = bPast;
			int32 Next = -1;
			TSharedPtr<FJsonObject> Json;
			const double T0 = FPlatformTime::Seconds();
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid())
			{
				Json->TryGetNumberField(TEXT("next"), Next);
				Json->TryGetBoolField(TEXT("done"), Batch->bDone);
				const TSharedPtr<FJsonObject>* Job = nullptr;
				if (Json->TryGetObjectField(TEXT("job"), Job))
				{
					Batch->JobStatus = Str(*Job, TEXT("status"));
					Batch->JobPhase = Str(*Job, TEXT("adopt_phase"));
				}
				for (const TSharedPtr<FJsonObject>& Each : Objects(Json, TEXT("events")))
				{
					FBpBuildupEvent Event;
					if (ReadBuildupEvent(Each, Event)) Batch->Events.Add(MoveTemp(Event));
				}
			}
			const double ParseMs = (FPlatformTime::Seconds() - T0) * 1000.0;
			const int32 Bytes = Body.Len();
			AsyncTask(ENamedThreads::GameThread, [Gen, Batch, Next, ParseMs, Bytes]()
			{
				FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
				if (!Module || Gen != GProductGen || Module->BuildupJob != Batch->JobId) return;
				Module->bBuildupOut = false;
				if (Next < 0)
				{
					UE_LOG(LogBpLink, Warning, TEXT("BpLink: build-up feed of %s did not read as { events, next }"), *Batch->Slug);
					return;
				}
				Module->BuildupNext = Next;
				Module->bBuildupDone = Batch->bDone;
				if (Batch->Events.Num() == 0 && !Batch->bDone && !Module->bBuildupPast) return;
				Module->bBuildupPast = false;
				UE_LOG(LogBpLink, Log, TEXT("BpLink: build-up %s: %d events%s, next %d%s (%d chars parsed off the game thread in %.1f ms)"), *Batch->Slug, Batch->Events.Num(),
					Batch->bPast ? TEXT(" (past: drawn at their end state)") : TEXT(""), Next, Batch->bDone ? TEXT(", done") : TEXT(""), Bytes, ParseMs);
				Module->BuildupDelegate.Broadcast(*Batch);
			});
		});
	});
	Request->ProcessRequest();
}

void FBpLinkModule::FetchIslandsPlan(TFunction<void(bool, const FBpPlan&)> OnDone)
{
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	const FString Url = FString::Printf(TEXT("%s/api/products/%s/plan?layout=islands"), *GClient->GetBaseUrl(), *ProductSlug());
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url, TEXT("application/json"));
	TrackProductRequest(Request);
	const uint32 Gen = GProductGen;
	Request->OnProcessRequestComplete().BindLambda([Gen, OnDone, Url](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		if (Gen != GProductGen) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FBpLinkSnapshot Snapshot;
		FString Refused;
		const bool bOk = Status == 200 && ParsePlanBody(Response->GetContentAsString(), Snapshot, Refused);
		if (!bOk) UE_LOG(LogBpLink, Log, TEXT("BpLink: GET %s answered %d%s"), *Url, Status, Refused.IsEmpty() ? TEXT("") : *(TEXT(": ") + Refused));
		OnDone(bOk, Snapshot.Plan);
	});
	Request->ProcessRequest();
}

// ---- The companion's turn (companion-link.md section 2) ---------------------------------------------------------------------

namespace
{
	/** One SSE body's `data:` lines as JSON objects, in order (`event:` lines are not needed: every event carries `type`). */
	void ReadTurnEvents(const FString& Body, FBpCompanionTurn& Out, FString& OutConversation)
	{
		TArray<FString> Lines;
		Body.ParseIntoArrayLines(Lines, false);
		Out.Outcome = FBpCompanionTurn::EOutcome::Failed;
		bool bEnded = false;
		for (const FString& Line : Lines)
		{
			if (!Line.StartsWith(TEXT("data:"))) continue;
			TSharedPtr<FJsonObject> Event;
			if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line.Mid(5).TrimStart()), Event) || !Event.IsValid()) continue;
			FString Type;
			Event->TryGetStringField(TEXT("type"), Type);
			if (Type == TEXT("start")) Event->TryGetStringField(TEXT("conversationId"), OutConversation);
			else if (Type == TEXT("text"))
			{
				FString Delta;
				if (Event->TryGetStringField(TEXT("delta"), Delta)) Out.Text += Delta;
			}
			else if (Type == TEXT("card"))
			{
				const TSharedPtr<FJsonObject>* Card = nullptr;
				if (Event->TryGetObjectField(TEXT("card"), Card))
				{
					FString State;
					(*Card)->TryGetStringField(TEXT("state"), State);
					// A pending card is the person's (contract section 4); a policy's result is not asked of anyone.
					if (State == TEXT("pending")) (*Card)->TryGetStringField(TEXT("summary"), Out.CardSummary);
				}
			}
			else if (Type == TEXT("focus"))
			{
				const TSharedPtr<FJsonObject>* Focus = nullptr;
				const TSharedPtr<FJsonObject>* Target = nullptr;
				if (Event->TryGetObjectField(TEXT("focus"), Focus) && (*Focus)->TryGetObjectField(TEXT("target"), Target))
				{
					(*Target)->TryGetStringField(TEXT("kind"), Out.FocusKind);
					(*Target)->TryGetStringField(TEXT("id"), Out.FocusId);
				}
			}
			else if (Type == TEXT("end"))
			{
				bEnded = true;
				FString Outcome;
				Event->TryGetStringField(TEXT("outcome"), Outcome);
				Out.Outcome = Outcome == TEXT("done") ? FBpCompanionTurn::EOutcome::Ok : FBpCompanionTurn::EOutcome::Failed;
				if (Outcome != TEXT("done")) Event->TryGetStringField(TEXT("failure"), Out.Failure);
				if (Outcome == TEXT("interrupted")) Out.Failure = Outcome;
			}
		}
		if (!bEnded && Out.Failure.IsEmpty()) Out.Failure = TEXT("the turn stopped without an end event");
	}
}

void FBpLinkModule::PostCompanionTurn(const FString& Text, TFunction<void(const FBpCompanionTurn&)> OnDone)
{
	if (!HasPcLink() || GFromBundle)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: companion turn not sent: no PC link"));
		if (OnDone) OnDone(FBpCompanionTurn());
		return;
	}
	if (bCompanionTurnOut)
	{
		FBpCompanionTurn Busy;
		Busy.Outcome = FBpCompanionTurn::EOutcome::Busy;
		Busy.Failure = TEXT("thread_busy");
		if (OnDone) OnDone(Busy);
		return;
	}
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	if (!CompanionConversation.IsEmpty()) Json->SetStringField(TEXT("conversationId"), CompanionConversation);
	Json->SetStringField(TEXT("product"), GetProductSlug());
	Json->SetStringField(TEXT("text"), Text);
	FString Wire;
	FJsonSerializer::Serialize(Json, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Wire));
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/companion/turn"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("text/event-stream"));
	Request->SetContentAsString(Wire);
	// A model turn with its tools can run minutes; the answer is read whole when it ends. The stream can stay silent longer
	// than the engine's 30 s activity timeout (HttpActivityTimeout) while the model thinks: night two W2b found every turn cut
	// at 30 s with no answer (status 0), so the request's own activity limit is the turn's.
	// A plan-my-day turn on Opus measured over 240 s on Lynx (night two W2b): ten minutes, then it is given up.
	Request->SetTimeout(600.f);
	Request->SetActivityTimeout(600.f);
	bCompanionTurnOut = true;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: companion turn posted (conversation %s): %s"), CompanionConversation.IsEmpty() ? TEXT("new") : *CompanionConversation, *Text);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"));
		if (Module) Module->bCompanionTurnOut = false;
		FBpCompanionTurn Turn;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (Status == 409)
		{
			Turn.Outcome = FBpCompanionTurn::EOutcome::Busy;
			Turn.Failure = TEXT("thread_busy");
		}
		else if (Status == 200)
		{
			FString Conversation;
			ReadTurnEvents(Response->GetContentAsString(), Turn, Conversation);
			if (Module && !Conversation.IsEmpty()) Module->CompanionConversation = Conversation;
		}
		else if (Status != 0)
		{
			Turn.Outcome = FBpCompanionTurn::EOutcome::Failed;
			Turn.Failure = FString::Printf(TEXT("the server answered %d"), Status);
		}
		UE_LOG(LogBpLink, Log, TEXT("BpLink: companion turn ended %d (status %d): %d chars%s"), static_cast<int32>(Turn.Outcome), Status, Turn.Text.Len(), Turn.CardSummary.IsEmpty() ? TEXT("") : TEXT(", a card"));
		if (OnDone) OnDone(Turn);
	});
	Request->ProcessRequest();
}

// ---- The PC link (table link v2, night two W2a: docs/concepts/vr-light-table/table-link-v2.md) -----------------------------
// The owner, 2026-11-09: "the Quest pairs with the PC over Wi-Fi by a code, so scans, stand-ups and your real projects work
// untethered." The route, in order: an explicit -BpLinkUrl (or BP_LINK_URL); the cable (loopback :3100, adb reverse) if
// GET /api/health answers; the saved Wi-Fi door (learned from GET /lan/where) if it answers; else the build's bundled sample.
// The probe is a timer (LinkProbeAwayS on the bundle, LinkProbeLinkedS linked), never a per-frame cost, every request is
// asynchronous with a LinkProbeTimeoutS limit, and a dead Wi-Fi door backs off (5 s doubling to 60 s). When the PC appears the
// table moves from the bundle to the live link with no restart; when it goes (two misses) the table falls back and says so
// once; a new `boot` is a restarted PC, and everything is read again. The pairing is section 4's ceremony; the token is sent as
// Authorization: Bearer on every request (NewRequest), saved in GameUserSettings beside the audio levels, never logged.

namespace
{
	const TCHAR* const LinkSection = TEXT("/Script/BpLink.BpLinkSettings");
	const TCHAR* const DefaultCableUrl = TEXT("http://127.0.0.1:3100");

	FString Trimmed(FString Url)
	{
		Url.TrimStartAndEndInline();
		while (Url.EndsWith(TEXT("/"))) Url.LeftChopInline(1);
		return Url;
	}

	/** The host of an http URL ("http://10.0.0.143:3101" -> "10.0.0.143:3101"). */
	FString HostOf(const FString& Url)
	{
		FString Host = Url;
		Host.RemoveFromStart(TEXT("http://"));
		Host.RemoveFromStart(TEXT("https://"));
		int32 Slash = INDEX_NONE;
		if (Host.FindChar(TEXT('/'), Slash)) Host.LeftInline(Slash);
		return Host;
	}

	bool IsLoopback(const FString& Url)
	{
		const FString Host = HostOf(Url).ToLower();
		return Host.StartsWith(TEXT("127.")) || Host.StartsWith(TEXT("localhost")) || Host.StartsWith(TEXT("[::1]"));
	}

	/** 24 bytes from the platform's RNG as 48 hex characters (section 4: 22..128 of [A-Za-z0-9_-], 128 bits or more). Android
	 *  reads /dev/urandom; elsewhere two GUIDs (CoCreateGuid on Windows: random version-4 GUIDs from the system RNG). */
	FString MakeNonce()
	{
		uint8 Bytes[24] = {};
		bool bOk = false;
#if PLATFORM_ANDROID
		const int Fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
		if (Fd >= 0)
		{
			bOk = read(Fd, Bytes, sizeof(Bytes)) == static_cast<ssize_t>(sizeof(Bytes));
			close(Fd);
		}
#endif
		if (!bOk)
		{
			for (int32 Part = 0; Part < 2; ++Part)
			{
				const FGuid Guid = FGuid::NewGuid();
				FMemory::Memcpy(Bytes + Part * 12, &Guid, 12);
			}
		}
		return BytesToHex(Bytes, UE_ARRAY_COUNT(Bytes)).ToLower();
	}

	/** The name this headset asks to be paired as (section 4: 1..40 of [A-Za-z0-9_.-]): the device's make and model on a headset
	 *  ("Oculus|Quest 3S" -> "oculus-quest-3s"), "pc-table" on the PC. */
	FString PairDeviceName()
	{
#if PLATFORM_ANDROID
		const FString Raw = FPlatformMisc::GetDeviceMakeAndModel();
#else
		const FString Raw = TEXT("pc-table");
#endif
		FString Out;
		for (const TCHAR C : Raw.ToLower())
		{
			const bool bKeep = FChar::IsAlnum(C) || C == TEXT('_') || C == TEXT('.') || C == TEXT('-');
			if (bKeep) Out += C;
			else if (!Out.EndsWith(TEXT("-"))) Out += TEXT('-');
		}
		Out = Out.Left(40);
		while (Out.EndsWith(TEXT("-"))) Out.LeftChopInline(1);
		return Out.IsEmpty() ? FString(TEXT("quest")) : Out;
	}

	/** The pairing id in `<device>:<pairing id>` (what `pair revoke` takes). */
	FString PairingIdOf(const FString& Device)
	{
		FString Id;
		return Device.Split(TEXT(":"), nullptr, &Id, ESearchCase::CaseSensitive, ESearchDir::FromEnd) ? Id : Device;
	}

	FString ErrorOf(const FString& Body)
	{
		FString Error;
		TSharedPtr<FJsonObject> Json;
		if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid()) Json->TryGetStringField(TEXT("error"), Error);
		return Error;
	}

	/** A pairing refusal (section 4's causes) in words for the console. */
	FString PairRefusalWords(int32 Status, const FString& Body)
	{
		const FString Error = ErrorOf(Body);
		if (Status == 0) return TEXT("The PC did not answer. Is `npm run server` running?");
		if (Status == 404) return TEXT("The PC's server runs without pairing. On the PC: npm run server -- --lan (or --pair), then PAIR again.");
		if (Error.Contains(TEXT("no-window"))) return TEXT("The PC has no pairing window open. On the PC: npm run server -- pair open, then PAIR again.");
		if (Error.Contains(TEXT("pending-cap"))) return TEXT("Too many codes are waiting on the PC. Wait two minutes, then PAIR again.");
		if (Error.Contains(TEXT("paired-cap"))) return TEXT("The PC holds 8 pairings already. On the PC: npm run server -- pair list, revoke one, then PAIR again.");
		if (Error.Contains(TEXT("claim-denied"))) return TEXT("The PC refused this code (pair deny).");
		if (Error.Contains(TEXT("claim-unknown"))) return TEXT("The PC no longer knows this code: it lapsed. PAIR again.");
		if (Status == 403) return Error.IsEmpty() ? FString(TEXT("The PC refused the pairing.")) : Error;
		return Error.IsEmpty() ? FString::Printf(TEXT("The PC answered %d."), Status) : Error;
	}

	FBpLinkModule* LinkModule() { return FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink")); }

	FAutoConsoleCommand GPairCommand(TEXT("BpLink.Pair"),
		TEXT("BpLink.Pair: ask the PC for a 6-character code (GET /lan/where, POST /pair), show it, and claim the token once the owner approves it: npm run server -- pair approve <code> --scope standup,place,focus,decide,scan. BpLink.Pair cancel stops waiting."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			FBpLinkModule* Module = LinkModule();
			if (!Module) return;
			if (Args.Num() > 0 && Args[0] == TEXT("cancel")) Module->CancelPair();
			else Module->Pair();
		}));
	FAutoConsoleCommand GUnpairCommand(TEXT("BpLink.Unpair"), TEXT("BpLink.Unpair: forget this headset's token (the PC keeps the pairing until `npm run server -- pair revoke <id>`)."),
		FConsoleCommandDelegate::CreateLambda([]() { if (FBpLinkModule* Module = LinkModule()) Module->Unpair(); }));
	FAutoConsoleCommand GWhereCommand(TEXT("BpLink.Where"), TEXT("BpLink.Where: GET /lan/where over the cable and log the PC's Wi-Fi door; then the link as it stands."),
		FConsoleCommandDelegate::CreateLambda([]() { if (FBpLinkModule* Module = LinkModule()) Module->Where(); }));
	FAutoConsoleCommand GLinkCommand(TEXT("BpLink.Link"), TEXT("BpLink.Link: log the route, the doors and the pairing (never the token: its last 4 characters)."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FBpLinkModule* Module = LinkModule();
			if (!Module) return;
			const FBpLinkStatus& S = Module->GetLinkStatus();
			UE_LOG(LogBpLink, Log, TEXT("BpLink: link %s (%s) base=%s cable=%s wifi=%s boot=%s pair=%d device=%s token=%s scopes=[%s] until %s; %s"),
				*FBpLinkModule::RouteWord(S), *FBpLinkModule::RouteWords(S), S.BaseUrl.IsEmpty() ? TEXT("-") : *S.BaseUrl, *S.CableUrl, S.WifiUrl.IsEmpty() ? TEXT("-") : *S.WifiUrl,
				S.Boot.IsEmpty() ? TEXT("-") : *S.Boot, static_cast<int32>(S.Pair), S.Device.IsEmpty() ? TEXT("-") : *S.Device, S.TokenTail.IsEmpty() ? TEXT("none") : *(TEXT("...") + S.TokenTail),
				*FString::Join(S.Scopes, TEXT(",")), S.ExpiresAt.IsEmpty() ? TEXT("-") : *S.ExpiresAt, *S.Message);
		}));
}

const TCHAR* const FBpLinkModule::PairScopes = TEXT("standup,place,focus,decide,scan");

FString FBpLinkModule::RouteWord(const FBpLinkStatus& S)
{
	if (S.Pair == EBpPairState::Waiting || S.Pair == EBpPairState::Asking) return TEXT("PAIRING");
	return S.Route == EBpLinkRoute::Cable ? TEXT("CABLE") : S.Route == EBpLinkRoute::Wifi ? TEXT("WI-FI") : TEXT("OFFLINE");
}

FString FBpLinkModule::RouteWords(const FBpLinkStatus& S)
{
	if (S.Route == EBpLinkRoute::Cable) return TEXT("On the cable");
	if (S.Route == EBpLinkRoute::Wifi) return TEXT("On Wi-Fi");
	if (!S.bDecided) return TEXT("Looking for your PC…");
	return S.bBundleOnly ? TEXT("Not connected: this build reads its sample") : TEXT("Not connected: showing the sample");
}

FString FBpLinkModule::ScopeWords(const FString& Scope)
{
	if (Scope == TEXT("read")) return TEXT("read your projects and their scans");
	if (Scope == TEXT("standup")) return TEXT("run the stand-up with the companion");
	if (Scope == TEXT("place")) return TEXT("hand places to the PC");
	if (Scope == TEXT("focus")) return TEXT("follow and share the place");
	if (Scope == TEXT("decide")) return TEXT("make your decisions");
	if (Scope == TEXT("scan")) return TEXT("start and cancel scans");
	return Scope;
}

void FBpLinkModule::LoadLink()
{
	FString Url;
	if (!FParse::Value(FCommandLine::Get(), TEXT("BpLinkUrl="), Url) || Url.IsEmpty()) Url = FPlatformMisc::GetEnvironmentVariable(TEXT("BP_LINK_URL"));
	Url = Trimmed(Url);
	LinkStatus.bBundleOnly = Url == BundleUrl;
	LinkStatus.bExplicit = !Url.IsEmpty();
	GExplicitUrl = LinkStatus.bBundleOnly ? FString() : Url;
	FString Token, Scopes;
	if (GConfig)
	{
		GConfig->GetString(LinkSection, TEXT("Token"), Token, GGameUserSettingsIni);
		GConfig->GetString(LinkSection, TEXT("Device"), LinkStatus.Device, GGameUserSettingsIni);
		GConfig->GetString(LinkSection, TEXT("Scopes"), Scopes, GGameUserSettingsIni);
		GConfig->GetString(LinkSection, TEXT("ExpiresAt"), LinkStatus.ExpiresAt, GGameUserSettingsIni);
		GConfig->GetString(LinkSection, TEXT("CableUrl"), LinkStatus.CableUrl, GGameUserSettingsIni);
		GConfig->GetString(LinkSection, TEXT("WifiUrl"), LinkStatus.WifiUrl, GGameUserSettingsIni);
	}
	// -BpLinkCable= moves the cable for a PC check (a server on a free port), and is not saved.
	FString Cable;
	if (FParse::Value(FCommandLine::Get(), TEXT("BpLinkCable="), Cable) && !Cable.IsEmpty()) LinkStatus.CableUrl = Cable;
	LinkStatus.CableUrl = Trimmed(LinkStatus.CableUrl.IsEmpty() ? FString(DefaultCableUrl) : LinkStatus.CableUrl);
	LinkStatus.WifiUrl = Trimmed(LinkStatus.WifiUrl);
	Scopes.ParseIntoArray(LinkStatus.Scopes, TEXT(","));
	// A token past its end is not kept (the PC refuses it anyway).
	FDateTime Until;
	if (!Token.IsEmpty() && !LinkStatus.ExpiresAt.IsEmpty() && FDateTime::ParseIso8601(*LinkStatus.ExpiresAt, Until) && Until < FDateTime::UtcNow()) Token.Reset();
	GToken = Token;
	LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
	LinkStatus.TokenTail = GToken.Right(4);
	if (GToken.IsEmpty()) { LinkStatus.Device.Reset(); LinkStatus.Scopes.Reset(); LinkStatus.ExpiresAt.Reset(); }
	UE_LOG(LogBpLink, Log, TEXT("BpLink: link settings: %s; cable %s; Wi-Fi door %s; %s"),
		LinkStatus.bBundleOnly ? TEXT("-BpLinkUrl=bundle (the sample only)") : LinkStatus.bExplicit ? *FString::Printf(TEXT("-BpLinkUrl=%s (only it is asked)"), *GExplicitUrl) : TEXT("the route is chosen"),
		*LinkStatus.CableUrl, LinkStatus.WifiUrl.IsEmpty() ? TEXT("none known") : *LinkStatus.WifiUrl,
		GToken.IsEmpty() ? TEXT("not paired") : *FString::Printf(TEXT("paired as %s (token ...%s)"), *LinkStatus.Device, *LinkStatus.TokenTail));
}

void FBpLinkModule::SaveLink() const
{
	if (!GConfig) return;
	GConfig->SetString(LinkSection, TEXT("Token"), *GToken, GGameUserSettingsIni);
	GConfig->SetString(LinkSection, TEXT("Device"), *LinkStatus.Device, GGameUserSettingsIni);
	GConfig->SetString(LinkSection, TEXT("Scopes"), *FString::Join(LinkStatus.Scopes, TEXT(",")), GGameUserSettingsIni);
	GConfig->SetString(LinkSection, TEXT("ExpiresAt"), *LinkStatus.ExpiresAt, GGameUserSettingsIni);
	GConfig->SetString(LinkSection, TEXT("WifiUrl"), *LinkStatus.WifiUrl, GGameUserSettingsIni);
	// The cable's URL is saved only when it is not the default (a -BpLinkCable run does not move the headset's cable).
	if (!FCString::Strifind(FCommandLine::Get(), TEXT("BpLinkCable=")))
	{
		GConfig->SetString(LinkSection, TEXT("CableUrl"), *LinkStatus.CableUrl, GGameUserSettingsIni);
	}
	GConfig->Flush(false, GGameUserSettingsIni);
}

void FBpLinkModule::ChangedLink()
{
	++LinkStatus.Serial;
	LinkStatusDelegate.Broadcast(LinkStatus);
}

TArray<TPair<FString, EBpLinkRoute>> FBpLinkModule::LinkCandidates() const
{
	TArray<TPair<FString, EBpLinkRoute>> Out;
	if (!GExplicitUrl.IsEmpty())
	{
		Out.Emplace(GExplicitUrl, IsLoopback(GExplicitUrl) ? EBpLinkRoute::Cable : EBpLinkRoute::Wifi);
		return Out;
	}
	Out.Emplace(LinkStatus.CableUrl, EBpLinkRoute::Cable);
	// The door refuses every request without a live pairing's token: without one it is not worth asking.
	if (!LinkStatus.WifiUrl.IsEmpty() && !GToken.IsEmpty()) Out.Emplace(LinkStatus.WifiUrl, EBpLinkRoute::Wifi);
	return Out;
}

bool FBpLinkModule::TickLink(float)
{
	if (GUnauthorized)
	{
		GUnauthorized = false;
		if (!GToken.IsEmpty()) ForgetToken(TEXT("The PC no longer knows this headset (it answered 401): pair again."));
	}
	if (LinkStatus.bBundleOnly) return true;
	const double Now = FPlatformTime::Seconds();
	if (GProbeNow)
	{
		GProbeNow = false;
		NextProbeS = FMath::Min(NextProbeS, Now);
	}
	if (!bProbeOut && Now >= NextProbeS) ProbeLink();
	if (LinkStatus.Pair == EBpPairState::Waiting && !bClaimOut && Now >= NextClaimS)
	{
		FDateTime Until;
		if (FDateTime::ParseIso8601(*LinkStatus.CodeExpiresAt, Until) && FDateTime::UtcNow() > Until + FTimespan::FromSeconds(5.0))
		{
			UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair: code %s lapsed at %s before the PC approved it"), *LinkStatus.Code, *LinkStatus.CodeExpiresAt);
			LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
			LinkStatus.Code.Reset();
			LinkStatus.Message = TEXT("The code lapsed before the PC approved it (2 minutes). PAIR again.");
			LinkStatus.bMessageBad = true;
			ChangedLink();
		}
		else SendClaim();
	}
	if (LinkStatus.Pair == EBpPairState::Paired && LinkStatus.Route != EBpLinkRoute::None && Now >= NextPairMeS) AskPairMe();
	return true;
}

void FBpLinkModule::ProbeLink()
{
	if (LinkStatus.Route == EBpLinkRoute::None)
	{
		ProbeCandidate(0);
		return;
	}
	bProbeOut = true;
	const FString Url = LinkStatus.BaseUrl;
	const EBpLinkRoute Route = LinkStatus.Route;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url + TEXT("/api/health"), TEXT("application/json"));
	Request->SetTimeout(LinkProbeTimeoutS);
	Request->OnProcessRequestComplete().BindLambda([Url, Route](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module) return;
		Module->bProbeOut = false;
		// The route moved meanwhile (a loss, or another link): this answer is about the old one.
		if (Module->LinkStatus.Route != Route || Module->LinkStatus.BaseUrl != Url) return;
		const double Now = FPlatformTime::Seconds();
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FString Boot;
		TSharedPtr<FJsonObject> Json;
		if (Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid()) Json->TryGetStringField(TEXT("boot"), Boot);
		if (Status == 200 || Status == 401)
		{
			Module->ProbeMisses = 0;
			Module->NextProbeS = Now + LinkProbeLinkedS;
			if (!Boot.IsEmpty() && !Module->LinkStatus.Boot.IsEmpty() && Boot != Module->LinkStatus.Boot)
			{
				UE_LOG(LogBpLink, Log, TEXT("BpLink: the PC restarted (boot %s -> %s): reading everything again"), *Module->LinkStatus.Boot, *Boot);
				Module->LinkStatus.Boot = Boot;
				Module->RefetchAll(TEXT("the PC restarted"));
				Module->ChangedLink();
			}
			else if (!Boot.IsEmpty()) Module->LinkStatus.Boot = Boot;
			return;
		}
		// Over Wi-Fi a bare 403 on /api/health (any live pairing may ask it) is a pairing the PC no longer has.
		if (Route == EBpLinkRoute::Wifi && Status == 403)
		{
			Module->ForgetToken(TEXT("The PC no longer knows this headset (the Wi-Fi door refused it): pair again on the cable."));
			return;
		}
		if (++Module->ProbeMisses >= 2)
		{
			Module->LinkLost(Status == 0 ? FString(TEXT("no answer")) : FString::Printf(TEXT("/api/health answered %d"), Status));
			return;
		}
		// One miss: asked again soon, before the table is told.
		Module->NextProbeS = Now + 2.0;
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ProbeCandidate(int32 Index)
{
	const TArray<TPair<FString, EBpLinkRoute>> Candidates = LinkCandidates();
	const double Now = FPlatformTime::Seconds();
	// A Wi-Fi door that has not answered waits out its backoff.
	while (Candidates.IsValidIndex(Index) && Candidates[Index].Value == EBpLinkRoute::Wifi && GExplicitUrl.IsEmpty() && Now < WifiRetryS) ++Index;
	if (!Candidates.IsValidIndex(Index))
	{
		bProbeOut = false;
		NextProbeS = Now + LinkProbeAwayS;
		if (!LinkStatus.bDecided)
		{
			// The first decision: no PC answers, so the build's sample stands in (and the probe keeps looking).
			LinkStatus.bDecided = true;
			UE_LOG(LogBpLink, Log, TEXT("BpLink: no PC answered (%s); the table reads the build's sample and keeps looking every %.0f s"),
				*FString::JoinBy(Candidates, TEXT(", "), [](const TPair<FString, EBpLinkRoute>& C) { return C.Key; }), LinkProbeAwayS);
			LinkStatus.Message = TEXT("No PC answered. Plug in the cable (adb reverse) or start the PC's server.");
			LinkStatus.bMessageBad = false;
			ReadBundleNow();
			ChangedLink();
		}
		return;
	}
	bProbeOut = true;
	const FString Url = Candidates[Index].Key;
	const EBpLinkRoute Route = Candidates[Index].Value;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url + TEXT("/api/health"), TEXT("application/json"));
	Request->SetTimeout(LinkProbeTimeoutS);
	Request->OnProcessRequestComplete().BindLambda([Url, Route, Index](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module) return;
		// Linked by some other path meanwhile: nothing to decide.
		if (Module->LinkStatus.Route != EBpLinkRoute::None) { Module->bProbeOut = false; return; }
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FString Boot;
		TSharedPtr<FJsonObject> Json;
		bool bOk = false;
		if (Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid())
		{
			Json->TryGetBoolField(TEXT("ok"), bOk);
			Json->TryGetStringField(TEXT("boot"), Boot);
		}
		// The tether answers 401 for a dead token before any route: the PC is there (the token goes, the link stands).
		if (bOk || (Status == 401 && Route == EBpLinkRoute::Cable))
		{
			Module->bProbeOut = false;
			if (Route == EBpLinkRoute::Wifi) { Module->WifiBackoffS = 5.f; Module->WifiRetryS = 0.0; }
			Module->LinkUp(Url, Route, Boot);
			return;
		}
		if (Route == EBpLinkRoute::Wifi)
		{
			if (Status == 403)
			{
				Module->bProbeOut = false;
				Module->ForgetToken(TEXT("The PC no longer knows this headset (the Wi-Fi door refused it): pair again on the cable."));
				return;
			}
			Module->WifiRetryS = FPlatformTime::Seconds() + Module->WifiBackoffS;
			UE_LOG(LogBpLink, Verbose, TEXT("BpLink: the Wi-Fi door %s did not answer (%d); asked again in %.0f s"), *Url, Status, Module->WifiBackoffS);
			Module->WifiBackoffS = FMath::Min(Module->WifiBackoffS * 2.f, 60.f);
		}
		Module->ProbeCandidate(Index + 1);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::LinkUp(const FString& Url, EBpLinkRoute Route, const FString& Boot)
{
	const bool bWasDecided = LinkStatus.bDecided;
	LinkStatus.Route = Route;
	LinkStatus.BaseUrl = Url;
	LinkStatus.Boot = Boot;
	LinkStatus.bDecided = true;
	LinkStatus.Message = FString::Printf(TEXT("%s: %s"), *RouteWords(LinkStatus), *HostOf(Url));
	LinkStatus.bMessageBad = false;
	GRouteLive = true;
	GFromBundle = false;
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>(Url);
	GClient->SetBaseUrl(Url);
	ProbeMisses = 0;
	bLossSaid = false;
	NextProbeS = FPlatformTime::Seconds() + LinkProbeLinkedS;
	NextPairMeS = 0.0;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: linked %s at %s (boot %s)%s%s"), Route == EBpLinkRoute::Cable ? TEXT("on the cable") : TEXT("on Wi-Fi"), *Url, Boot.IsEmpty() ? TEXT("?") : *Boot,
		bWasDecided ? TEXT(": the table leaves the sample for the live link") : TEXT(""), GToken.IsEmpty() ? TEXT("; not paired") : *FString::Printf(TEXT("; paired as %s"), *LinkStatus.Device));
	RefetchAll(bWasDecided ? TEXT("linked again") : TEXT("linked"));
	ChangedLink();
}

void FBpLinkModule::LinkLost(const FString& Why)
{
	if (LinkStatus.Route == EBpLinkRoute::None) return;
	const FString Was = LinkStatus.BaseUrl;
	LinkStatus.Route = EBpLinkRoute::None;
	LinkStatus.BaseUrl.Reset();
	LinkStatus.Boot.Reset();
	GRouteLive = false;
	ProbeMisses = 0;
	NextProbeS = FPlatformTime::Seconds() + LinkProbeAwayS;
	if (LinkStatus.Pair == EBpPairState::Asking || LinkStatus.Pair == EBpPairState::Waiting)
	{
		LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
		LinkStatus.Code.Reset();
	}
	LinkStatus.Message = TEXT("The PC stopped answering: the sample stands in until it is back.");
	LinkStatus.bMessageBad = true;
	if (!bLossSaid)
	{
		bLossSaid = true;
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: the PC stopped answering at %s (%s); the table falls back to the build's sample and looks again every %.0f s"), *Was, *Why, LinkProbeAwayS);
	}
	ReadBundleNow();
	ChangedLink();
}

void FBpLinkModule::RefetchAll(const TCHAR* Why)
{
	// Whatever the old route still has out is dropped (the product generation), and every side is read from its start.
	++GProductGen;
	const int32 Cancelled = CancelProductRequests();
	const int32 Serial = ScanState.Serial;
	ScanState = FBpScanState();
	ScanState.Serial = Serial + 1;
	ScanPartsOut = 0;
	for (uint32& Hash : ScanBodyHash) Hash = 0;
	bScanBundled = false;
	NextScanPollS = 0.0;
	const int32 FocusSerial = FocusList.Serial;
	FocusList = FBpFocusList();
	FocusList.Serial = FocusSerial + 1;
	Briefs.Reset();
	bBriefsBundled = false;
	DecisionsOut.Reset();
	bWaveWriteOut = false;
	ResetBuildup();
	FeedsOut.Reset();
	NextProductsPollS = NextOnboardingPollS = 0.0;
	bProductsOut = bOnboardingOut = false;
	bFollowSaid = false;
	FollowRev = -1;
	NextFollowPollS = NextFollowHelloS = 0.0;
	bFollowPollOut = bFollowOpOut = bPublishOut = false;
	bHasNextPublish = false;
	bHasSharedSpot = false;
	bCompanionTurnOut = false;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: %s: reading %s, its scans, the products and the shared focus from %s (%d requests of the old route dropped)"),
		Why, *GetProductSlug(), *GClient->GetBaseUrl(), Cancelled);
	ScanStateDelegate.Broadcast(ScanState);
	FocusesDelegate.Broadcast(FocusList);
	FetchProduct();
}

void FBpLinkModule::ReadBundleNow()
{
	++GProductGen;
	CancelProductRequests();
	GFromBundle = true;
	const int32 Serial = ScanState.Serial;
	ScanState = FBpScanState();
	ScanState.Serial = Serial + 1;
	ScanPartsOut = 0;
	for (uint32& Hash : ScanBodyHash) Hash = 0;
	bScanBundled = false;
	NextScanPollS = 0.0;
	const int32 FocusSerial = FocusList.Serial;
	FocusList = FBpFocusList();
	FocusList.Serial = FocusSerial + 1;
	Briefs.Reset();
	bBriefsBundled = false;
	DecisionsOut.Reset();
	ResetBuildup();
	// The PC's products are not the sample's: the PROJECTS page lists what the bundle carries until the PC is back.
	const int32 OnboardingSerial = Onboarding.Serial;
	Onboarding = FBpOnboardingState();
	Onboarding.Serial = OnboardingSerial + 1;
	OnboardingDelegate.Broadcast(Onboarding);
	ScanStateDelegate.Broadcast(ScanState);
	FocusesDelegate.Broadcast(FocusList);
	const FString Slug = GetProductSlug();
	FBpLinkSnapshot Snapshot;
	if (FBpLinkClient::ReadBundle(Slug, Snapshot))
	{
		LogProduct(Slug, Snapshot);
		ReceiveSnapshot(true, Snapshot);
	}
	else if (bHasPlan)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: the build carries no sample of %s: the table keeps the plan it drew, read-only"), *Slug);
	}
	else
	{
		ReceiveSnapshot(false, Snapshot);
	}
}

void FBpLinkModule::ForgetToken(const FString& Why)
{
	const FString Was = LinkStatus.Device;
	GToken.Reset();
	LinkStatus.TokenTail.Reset();
	LinkStatus.Device.Reset();
	LinkStatus.Scopes.Reset();
	LinkStatus.ExpiresAt.Reset();
	if (LinkStatus.Pair == EBpPairState::Paired) LinkStatus.Pair = EBpPairState::Unpaired;
	LinkStatus.Message = Why;
	LinkStatus.bMessageBad = true;
	SaveLink();
	UE_LOG(LogBpLink, Warning, TEXT("BpLink: pairing %s dropped: %s"), Was.IsEmpty() ? TEXT("(unnamed)") : *Was, *Why);
	// The Wi-Fi door takes no request without a token: that route is gone with it.
	if (LinkStatus.Route == EBpLinkRoute::Wifi)
	{
		LinkLost(TEXT("no token for the Wi-Fi door"));
		// The words are the pairing's, not "the PC stopped answering".
		LinkStatus.Message = Why + TEXT(" (Wi-Fi needs a pairing.)");
		LinkStatus.bMessageBad = true;
	}
	ChangedLink();
}

void FBpLinkModule::Pair()
{
	if (LinkStatus.Pair == EBpPairState::Asking || LinkStatus.Pair == EBpPairState::Waiting)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: pair: already %s"), LinkStatus.Code.IsEmpty() ? TEXT("asking") : *FString::Printf(TEXT("waiting on code %s"), *LinkStatus.Code));
		return;
	}
	if (LinkStatus.Route == EBpLinkRoute::None)
	{
		LinkStatus.Message = TEXT("Not connected: plug in the cable (or start the PC's server), then PAIR.");
		LinkStatus.bMessageBad = true;
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair refused: no route to a PC"));
		ChangedLink();
		return;
	}
	PairNonce = MakeNonce();
	LinkStatus.Pair = EBpPairState::Asking;
	LinkStatus.Code.Reset();
	LinkStatus.Message = TEXT("Asking the PC for a code…");
	LinkStatus.bMessageBad = false;
	ChangedLink();
	// /lan/where is the tether's (loopback only): the Wi-Fi door is learned there, then the code is asked. Over Wi-Fi the code is
	// asked straight from the door (POST /pair is open on it).
	if (LinkStatus.Route == EBpLinkRoute::Cable) Where();
	else PostPair();
}

void FBpLinkModule::Where()
{
	if (LinkStatus.Route != EBpLinkRoute::Cable)
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: where: /lan/where is asked over the cable only (the route is %s); the Wi-Fi door known: %s"),
			*RouteWord(LinkStatus), LinkStatus.WifiUrl.IsEmpty() ? TEXT("none") : *LinkStatus.WifiUrl);
		return;
	}
	const bool bThenPair = LinkStatus.Pair == EBpPairState::Asking;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(LinkStatus.BaseUrl + TEXT("/lan/where"), TEXT("application/json"));
	Request->SetTimeout(5.f);
	Request->OnProcessRequestComplete().BindLambda([bThenPair](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		Module->ReceiveWhere(Status, Response.IsValid() ? Response->GetContentAsString() : FString(), bThenPair);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ReceiveWhere(int32 Status, const FString& Body, bool bThenPair)
{
	bool bPairing = Status == 404;
	if (Status == 200)
	{
		// { door: { address, port } | null, listening, window, pairing }
		TSharedPtr<FJsonObject> Json;
		if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid())
		{
			bool bListening = false;
			FString Window;
			Json->TryGetBoolField(TEXT("pairing"), bPairing);
			Json->TryGetBoolField(TEXT("listening"), bListening);
			Json->TryGetStringField(TEXT("window"), Window);
			const TSharedPtr<FJsonObject>* Door = nullptr;
			FString Address;
			int32 Port = 0;
			if (Json->TryGetObjectField(TEXT("door"), Door) && (*Door)->TryGetStringField(TEXT("address"), Address) && (*Door)->TryGetNumberField(TEXT("port"), Port) && !Address.IsEmpty() && Port > 0)
			{
				const FString Door2 = FString::Printf(TEXT("http://%s:%d"), *Address, Port);
				if (Door2 != LinkStatus.WifiUrl)
				{
					LinkStatus.WifiUrl = Door2;
					SaveLink();
				}
			}
			UE_LOG(LogBpLink, Log, TEXT("BpLink: where: Wi-Fi door %s (listening %d), pairing window %s, pairing %s"), Address.IsEmpty() ? TEXT("none (the server runs without --lan)") : *LinkStatus.WifiUrl,
				bListening, Window.IsEmpty() ? TEXT("closed") : *FString::Printf(TEXT("open until %s"), *Window), bPairing ? TEXT("served") : TEXT("off"));
			ChangedLink();
		}
	}
	else
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: where: GET /lan/where answered %d"), Status);
	}
	if (!bThenPair || LinkStatus.Pair != EBpPairState::Asking) return;
	if (Status == 0 || (Status == 200 && !bPairing))
	{
		LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
		LinkStatus.Message = Status == 0 ? PairRefusalWords(0, FString()) : FString(TEXT("The PC's server runs without pairing. On the PC: npm run server -- --lan (or --pair), then PAIR again."));
		LinkStatus.bMessageBad = true;
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair: %s"), *LinkStatus.Message);
		ChangedLink();
		return;
	}
	PostPair();
}

void FBpLinkModule::PostPair()
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("nonce"), PairNonce);
	Body->SetStringField(TEXT("device"), PairDeviceName());
	TArray<FString> Scopes;
	FString(PairScopes).ParseIntoArray(Scopes, TEXT(","));
	TArray<TSharedPtr<FJsonValue>> ScopeValues;
	for (const FString& Scope : Scopes) ScopeValues.Add(MakeShared<FJsonValueString>(Scope));
	Body->SetArrayField(TEXT("scopes"), ScopeValues);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	// No token on the ceremony's own requests: a stale one would be answered 401 before /pair runs.
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(LinkStatus.BaseUrl + TEXT("/pair"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	Request->SetTimeout(5.f);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: pair: POST %s/pair as %s for [%s]"), *LinkStatus.BaseUrl, *PairDeviceName(), PairScopes);
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module || Module->LinkStatus.Pair != EBpPairState::Asking) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Answer = Response.IsValid() ? Response->GetContentAsString() : FString();
		TSharedPtr<FJsonObject> Json;
		FString Code, ExpiresAt;
		if ((Status == 201 || Status == 200) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Answer), Json) && Json.IsValid()
			&& Json->TryGetStringField(TEXT("code"), Code) && !Code.IsEmpty())
		{
			Json->TryGetStringField(TEXT("expiresAt"), ExpiresAt);
			FBpLinkStatus& S = Module->LinkStatus;
			S.Pair = EBpPairState::Waiting;
			S.Code = Code;
			S.CodeExpiresAt = ExpiresAt;
			S.Message = FString::Printf(TEXT("On the PC: npm run server -- pair approve %s --scope %s"), *Code, PairScopes);
			S.bMessageBad = false;
			Module->NextClaimS = FPlatformTime::Seconds() + PairClaimS;
			UE_LOG(LogBpLink, Log, TEXT("BpLink: pair: code %s shown (until %s); on the PC: npm run server -- pair approve %s --scope %s"), *Code, *ExpiresAt, *Code, PairScopes);
			Module->ChangedLink();
			return;
		}
		Module->LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
		Module->LinkStatus.Message = PairRefusalWords(Status, Answer);
		Module->LinkStatus.bMessageBad = true;
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair: POST /pair answered %d %.200s"), Status, *Answer);
		Module->ChangedLink();
	});
	Request->ProcessRequest();
}

void FBpLinkModule::SendClaim()
{
	if (LinkStatus.Route == EBpLinkRoute::None) return;
	bClaimOut = true;
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("nonce"), PairNonce);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	// The claim is the one request that goes out without the old token: a re-pair must not be answered 401 for a dead one.
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(LinkStatus.BaseUrl + TEXT("/pair/claim"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	Request->SetTimeout(5.f);
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module) return;
		Module->bClaimOut = false;
		if (Module->LinkStatus.Pair != EBpPairState::Waiting) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Answer = Response.IsValid() ? Response->GetContentAsString() : FString();
		FBpLinkStatus& S = Module->LinkStatus;
		if (Status == 202 || Status == 0)
		{
			// Not yet approved (or no answer this time): asked again in PairClaimS until the code lapses.
			Module->NextClaimS = FPlatformTime::Seconds() + PairClaimS;
			return;
		}
		TSharedPtr<FJsonObject> Json;
		FString Token;
		if (Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Answer), Json) && Json.IsValid() && Json->TryGetStringField(TEXT("token"), Token) && !Token.IsEmpty())
		{
			GToken = Token;
			S.Pair = EBpPairState::Paired;
			S.TokenTail = Token.Right(4);
			S.Device.Reset();
			S.Scopes.Reset();
			S.ExpiresAt.Reset();
			Json->TryGetStringField(TEXT("device"), S.Device);
			Json->TryGetStringArrayField(TEXT("scopes"), S.Scopes);
			Json->TryGetStringField(TEXT("expiresAt"), S.ExpiresAt);
			S.Code.Reset();
			S.Message = FString::Printf(TEXT("Paired: this headset is %s on your PC."), *S.Device);
			S.bMessageBad = false;
			Module->SaveLink();
			UE_LOG(LogBpLink, Log, TEXT("BpLink: paired as %s (token ...%s), scopes [%s], until %s; every request now carries it"),
				*S.Device, *S.TokenTail, *FString::Join(S.Scopes, TEXT(",")), *S.ExpiresAt);
			Module->NextPairMeS = 0.0;
			Module->ChangedLink();
			return;
		}
		S.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
		S.Code.Reset();
		S.Message = Status == 410 ? FString(TEXT("That code was claimed already. PAIR again.")) : PairRefusalWords(Status, Answer);
		S.bMessageBad = true;
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair: POST /pair/claim answered %d %.200s"), Status, *Answer);
		Module->ChangedLink();
	});
	Request->ProcessRequest();
}

void FBpLinkModule::CancelPair()
{
	if (LinkStatus.Pair != EBpPairState::Asking && LinkStatus.Pair != EBpPairState::Waiting) return;
	UE_LOG(LogBpLink, Log, TEXT("BpLink: pair: cancelled%s (the request lapses on the PC by itself)"), LinkStatus.Code.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" code %s"), *LinkStatus.Code));
	LinkStatus.Pair = GToken.IsEmpty() ? EBpPairState::Unpaired : EBpPairState::Paired;
	LinkStatus.Code.Reset();
	LinkStatus.Message = TEXT("Pairing cancelled.");
	LinkStatus.bMessageBad = false;
	ChangedLink();
}

void FBpLinkModule::Unpair()
{
	if (GToken.IsEmpty())
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: unpair: not paired"));
		return;
	}
	const FString Id = PairingIdOf(LinkStatus.Device);
	ForgetToken(FString::Printf(TEXT("Forgotten on this headset. To remove it on the PC too: npm run server -- pair revoke %s"), *Id));
	LinkStatus.bMessageBad = false;
	ChangedLink();
}

void FBpLinkModule::AskPairMe()
{
	NextPairMeS = FPlatformTime::Seconds() + PairMeS;
	if (GToken.IsEmpty() || LinkStatus.Route == EBpLinkRoute::None) return;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(LinkStatus.BaseUrl + TEXT("/pair/me"), TEXT("application/json"));
	Request->SetTimeout(5.f);
	const EBpLinkRoute Route = LinkStatus.Route;
	Request->OnProcessRequestComplete().BindLambda([Route](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		if (!Module || GToken.IsEmpty()) return;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FBpLinkStatus& S = Module->LinkStatus;
		if (Status == 200)
		{
			TSharedPtr<FJsonObject> Json;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid())
			{
				const FString Was = FString::Printf(TEXT("%s|%s|%s"), *S.Device, *FString::Join(S.Scopes, TEXT(",")), *S.ExpiresAt);
				Json->TryGetStringField(TEXT("device"), S.Device);
				// TryGetStringArrayField appends: the scopes are read fresh, not onto the last read.
				TArray<FString> Scopes;
				if (Json->TryGetStringArrayField(TEXT("scopes"), Scopes)) S.Scopes = MoveTemp(Scopes);
				Json->TryGetStringField(TEXT("expiresAt"), S.ExpiresAt);
				const FString Now = FString::Printf(TEXT("%s|%s|%s"), *S.Device, *FString::Join(S.Scopes, TEXT(",")), *S.ExpiresAt);
				UE_LOG(LogBpLink, Log, TEXT("BpLink: pair/me: %s, scopes [%s], until %s"), *S.Device, *FString::Join(S.Scopes, TEXT(",")), *S.ExpiresAt);
				if (Was != Now)
				{
					Module->SaveLink();
					Module->ChangedLink();
				}
			}
			return;
		}
		// The tether's 401 is handled by every request's hook; the door's bare 403 on /pair/me (any live pairing) is the same news.
		if (Status == 403 && Route == EBpLinkRoute::Wifi) Module->ForgetToken(TEXT("The PC no longer knows this headset (the Wi-Fi door refused it): pair again on the cable."));
		else if (Status != 401) UE_LOG(LogBpLink, Warning, TEXT("BpLink: pair/me answered %d"), Status);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::ShowOnPc(const FBpFollowPlace& InPlace, TFunction<void(bool, const FString&)> OnDone)
{
	FBpFollowPlace Place = InPlace;
	if (Place.Product.IsEmpty()) Place.Product = GetProductSlug();
	if (GFromBundle || !GRouteLive)
	{
		if (OnDone) OnDone(false, TEXT("No PC is linked: plug in the cable or pair over Wi-Fi first."));
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	// place.ts Place: { product, hash, level, target?, from: 'vr' }; the page's own hash is the web's to write, so it is ''.
	TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("product"), Place.Product);
	Json->SetStringField(TEXT("hash"), FString());
	Json->SetStringField(TEXT("level"), Place.Level.IsEmpty() ? FString(TEXT("L0")) : Place.Level);
	if (!IsSiteKind(Place.Kind, Place.Id))
	{
		TSharedRef<FJsonObject> Target = MakeShared<FJsonObject>();
		Target->SetStringField(TEXT("kind"), Place.Kind);
		Target->SetStringField(TEXT("id"), Place.Id);
		Json->SetObjectField(TEXT("target"), Target);
	}
	Json->SetStringField(TEXT("from"), TEXT("vr"));
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetObjectField(TEXT("place"), Json);
	FString Text;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text));
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/session/place"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetHeader(TEXT("x-bp-device"), DeviceId);
	Request->SetContentAsString(Text);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: show on PC: POST /api/session/place %s"), *Text);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Place](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpLinkModule* Module = LinkModule();
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Answer = Response.IsValid() ? Response->GetContentAsString() : FString();
		const FString Where = Place.Say.IsEmpty() ? FString(TEXT("this place")) : Place.Say;
		UE_LOG(LogBpLink, Log, TEXT("BpLink: show on PC: the place baton answered %d %.200s"), Status, *Answer);
		if (Status == 200)
		{
			if (OnDone) OnDone(true, FString::Printf(TEXT("Your PC shows %s (the place baton)."), *Where));
			return;
		}
		if (Status == 0 || !Module)
		{
			if (OnDone) OnDone(false, TEXT("The PC did not answer."));
			return;
		}
		// No baton claimed from the web (409/404), or the baton route refused: the place goes out as the shared focus instead,
		// which every page following it flies to.
		if (Module->bPublishOut)
		{
			Module->NextPublish = Place;
			Module->bHasNextPublish = true;
		}
		else Module->SendPublish(Place);
		if (OnDone) OnDone(true, FString::Printf(TEXT("Sent to your PC as the shared place: the web goes to %s."), *Where));
	});
	Request->ProcessRequest();
}

// ---- The stand-up (night two W2b; table-link-v2.md section 3, the web's Morning Watch) ---------------------------------------
// The owner, 2026-11-09: "wire 'standups' as in web to establish daily plan with AI companion and let it handle the project - if
// connected to PC". The deck is the server's (GET /api/companion/morning), or the build's sample (morning.json) with no PC. A
// person's decision goes out only with a pairing that holds `decide` (the server checks it: the Bearer adds the decider seal),
// always with `shown`, the words the card displayed. A grant from here is never wider than VR_POLICY_BOUND, refused before it
// is sent. Every answer is handed back as the server gave it; the stand-up shows the server's body as the truth.

namespace
{
	FString Condensed(const TSharedRef<FJsonObject>& Json)
	{
		FString Wire;
		FJsonSerializer::Serialize(Json, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Wire));
		return Wire;
	}

	/** `shown` as the contract takes it: 1..1000 characters, no control characters but newline. */
	FString ShownText(const FString& In)
	{
		FString Out;
		for (const TCHAR C : In) Out += (C == TEXT('\n') || C >= 32) ? C : TEXT(' ');
		Out.TrimStartAndEndInline();
		return Out.Left(1000);
	}

	bool ReadPolicy(const TSharedPtr<FJsonObject>& Json, FBpPolicy& Out)
	{
		if (!Json.IsValid() || !Json->TryGetStringField(TEXT("id"), Out.Id)) return false;
		Json->TryGetStringField(TEXT("product"), Out.Product);
		Json->TryGetStringArrayField(TEXT("tools"), Out.Tools);
		int32 Tier = -1;
		if (Json->TryGetNumberField(TEXT("minTier"), Tier)) Out.MinTier = Tier;
		Json->TryGetStringField(TEXT("expiresAt"), Out.ExpiresAt);
		Json->TryGetStringField(TEXT("createdAt"), Out.CreatedAt);
		const TSharedPtr<FJsonObject>* By = nullptr;
		if (Json->TryGetObjectField(TEXT("grantedBy"), By))
		{
			(*By)->TryGetStringField(TEXT("surface"), Out.GrantedSurface);
			(*By)->TryGetStringField(TEXT("device"), Out.GrantedDevice);
		}
		return true;
	}

	/** A shot's path is the Shot row's (shots/<run>/<file>.png, or a bare file name for the sample's): letters, digits, . _ - and /,
	 *  no dot segment. */
	bool SafeShotPath(const FString& Path)
	{
		if (Path.IsEmpty() || Path.Len() > 200 || Path.StartsWith(TEXT("/")) || Path.Contains(TEXT(".."))) return false;
		for (const TCHAR C : Path) if (!(FChar::IsAlnum(C) || C == TEXT('_') || C == TEXT('.') || C == TEXT('-') || C == TEXT('/'))) return false;
		return Path.EndsWith(TEXT(".png"));
	}
}

bool FBpPolicy::IsLive() const
{
	FDateTime Until;
	return FDateTime::ParseIso8601(*ExpiresAt, Until) && Until > FDateTime::UtcNow();
}

const TArray<FString>& FBpLinkModule::PolicyTools()
{
	static const TArray<FString> Tools = { TEXT("decision.answer"), TEXT("finding.decline"), TEXT("scan.directed"), TEXT("wave.dispatch") };
	return Tools;
}

bool FBpLinkModule::CanDecide() const
{
	return !GFromBundle && GRouteLive && LinkStatus.Pair == EBpPairState::Paired && LinkStatus.Scopes.Contains(TEXT("decide"));
}

FString FBpLinkModule::AnswerWords(int32 Status, const FString& Body)
{
	const FString Error = ErrorOf(Body);
	if (Status == 0) return Body.IsEmpty() ? FString(TEXT("Your PC did not answer: nothing was sent.")) : Body;
	if (!Error.IsEmpty()) return Error.Left(1).ToUpper() + Error.Mid(1) + (Error.EndsWith(TEXT(".")) ? TEXT("") : TEXT("."));
	if (Status == 403) return TEXT("Your PC refused it: this headset's pairing may not decide (PC LINK pairs it with decide).");
	if (Status == 401) return TEXT("Your PC no longer knows this headset: pair again (PC LINK).");
	if (Status == 409) return TEXT("It was decided elsewhere first.");
	return FString::Printf(TEXT("Your PC answered %d."), Status);
}

void FBpLinkModule::GetMorning(const FString& Since, TFunction<void(const FBpMorningRead&)> OnDone)
{
	if (GFromBundle || !GRouteLive)
	{
		// The build's sample: read on a later tick, as a request would answer.
		FBpMorningRead Read;
		Read.bSample = true;
		FString Text;
		TSharedPtr<FJsonObject> Json;
		if (!ReadBundleFile(GetProductSlug(), TEXT("morning.json"), Text)) Read.Error = TEXT("This build carries no sample morning.");
		else if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Json) || !Json.IsValid() || !BpSchema::FromJson(Json.ToSharedRef(), Read.Deck))
		{
			Read.Error = TEXT("The sample morning did not read.");
		}
		else Read.bOk = true;
		UE_LOG(LogBpLink, Log, TEXT("BpLink: morning from the bundle's sample: %s (%d cards)"), Read.bOk ? TEXT("read") : *Read.Error, Read.Deck.cards.Num());
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([OnDone, Read](float) { if (OnDone) OnDone(Read); return false; }));
		return;
	}
	if (!GClient.IsValid()) GClient = MakeUnique<FBpLinkClient>();
	// The LAN door takes since=<iso> with only [0-9TZ:.-] (lan-door.ts MORNING_QUERY): UTC with Z, no escaping needed.
	FString Query;
	FDateTime At;
	if (!Since.IsEmpty() && FDateTime::ParseIso8601(*Since, At)) Query = TEXT("?since=") + At.ToIso8601();
	const FString Url = GClient->GetBaseUrl() + TEXT("/api/companion/morning") + Query;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(Url, TEXT("application/json"));
	Request->SetTimeout(30.f);
	const double Sent = FPlatformTime::Seconds();
	UE_LOG(LogBpLink, Log, TEXT("BpLink: GET /api/companion/morning%s"), *Query);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Sent](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		FBpMorningRead Read;
		Read.Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		TSharedPtr<FJsonObject> Json;
		if (Read.Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json) && Json.IsValid() && BpSchema::FromJson(Json.ToSharedRef(), Read.Deck)) Read.bOk = true;
		else Read.Error = Read.Status == 200 ? FString(TEXT("The morning did not read.")) : AnswerWords(Read.Status, Body);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: morning answered %d in %.0f ms: %d cards%s"), Read.Status, (FPlatformTime::Seconds() - Sent) * 1000.0, Read.Deck.cards.Num(), Read.bOk ? TEXT("") : *(TEXT(", ") + Read.Error));
		if (OnDone) OnDone(Read);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::PostMorningVerdict(const FString& Product, const FString& Proposal, const FString& Verdict, const FString& Shown, TFunction<void(int32, const FString&)> OnDone)
{
	const FString Said = ShownText(Shown);
	const bool bVerdict = Verdict == BpVocab::SteerPost::Verdict::Approve || Verdict == BpVocab::SteerPost::Verdict::Defer || Verdict == BpVocab::SteerPost::Verdict::Hold || Verdict == BpVocab::SteerPost::Verdict::Decline;
	FString Refused;
	if (GFromBundle || !GRouteLive) Refused = TEXT("Sample: nothing was sent.");
	else if (!bVerdict || Product.IsEmpty() || Proposal.IsEmpty()) Refused = TEXT("Not a verdict the stand-up sends.");
	else if (Said.IsEmpty()) Refused = TEXT("A decision from the table must say what it showed.");
	if (!Refused.IsEmpty())
	{
		UE_LOG(LogBpLink, Log, TEXT("BpLink: morning verdict %s %s/%s not sent: %s"), *Verdict, *Product, *Proposal, *Refused);
		if (OnDone) OnDone(0, Refused);
		return;
	}
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("product"), Product);
	Json->SetStringField(TEXT("proposal"), Proposal);
	Json->SetStringField(TEXT("verdict"), Verdict);
	Json->SetStringField(TEXT("shown"), Said);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/companion/morning"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Condensed(Json));
	Request->SetTimeout(20.f);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST /api/companion/morning %s %s/%s, shown \"%s\""), *Verdict, *Product, *Proposal, *Said.Replace(TEXT("\n"), TEXT(" / ")));
	Request->OnProcessRequestComplete().BindLambda([OnDone, Verdict, Proposal](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: morning verdict %s %s answered %d %.300s"), *Verdict, *Proposal, Status, *Body);
		if (Status == 200)
		{
			if (FBpLinkModule* Module = LinkModule()) Module->NextScanPollS = 0.0;
		}
		if (OnDone) OnDone(Status, Body);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::GetCompanionCards(TFunction<void(bool, const TArray<FBpCompanionCard>&)> OnDone)
{
	if (GFromBundle || !GRouteLive)
	{
		if (OnDone) OnDone(false, TArray<FBpCompanionCard>());
		return;
	}
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/companion/cards"), TEXT("application/json"));
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		TArray<FBpCompanionCard> Cards;
		TArray<TSharedPtr<FJsonValue>> List;
		const bool bOk = Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), List);
		for (const TSharedPtr<FJsonValue>& Each : List)
		{
			const TSharedPtr<FJsonObject>* One = nullptr;
			if (!Each.IsValid() || !Each->TryGetObject(One)) continue;
			FBpCompanionCard Card;
			(*One)->TryGetStringField(TEXT("id"), Card.Id);
			(*One)->TryGetStringField(TEXT("tool"), Card.Tool);
			(*One)->TryGetStringField(TEXT("summary"), Card.Summary);
			(*One)->TryGetStringField(TEXT("product"), Card.Product);
			(*One)->TryGetStringField(TEXT("state"), Card.State);
			(*One)->TryGetStringField(TEXT("createdAt"), Card.CreatedAt);
			if (!Card.Id.IsEmpty()) Cards.Add(MoveTemp(Card));
		}
		UE_LOG(LogBpLink, Log, TEXT("BpLink: companion cards answered %d: %d cards"), Status, Cards.Num());
		if (OnDone) OnDone(bOk, Cards);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::AnswerCompanionCard(const FString& Id, bool bApprove, const FString& Shown, TFunction<void(int32, const FString&)> OnDone)
{
	const FString Said = ShownText(Shown);
	if (GFromBundle || !GRouteLive || Id.IsEmpty() || Said.IsEmpty())
	{
		if (OnDone) OnDone(0, GFromBundle || !GRouteLive ? FString(TEXT("Sample: nothing was sent.")) : FString(TEXT("A decision from the table must say what it showed.")));
		return;
	}
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("decision"), bApprove ? TEXT("approve") : TEXT("decline"));
	Json->SetStringField(TEXT("shown"), Said);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/companion/cards/") + FGenericPlatformHttp::UrlEncode(Id));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Condensed(Json));
	// An approved card runs its tool before it answers.
	Request->SetTimeout(120.f);
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST /api/companion/cards/%s %s, shown \"%s\""), *Id, bApprove ? TEXT("approve") : TEXT("decline"), *Said.Replace(TEXT("\n"), TEXT(" / ")));
	Request->OnProcessRequestComplete().BindLambda([OnDone, Id](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: card %s answered %d %.300s"), *Id, Status, *Body);
		if (OnDone) OnDone(Status, Body);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::GetPolicies(TFunction<void(bool, const TArray<FBpPolicy>&)> OnDone)
{
	if (GFromBundle || !GRouteLive)
	{
		if (OnDone) OnDone(false, TArray<FBpPolicy>());
		return;
	}
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/companion/policies"), TEXT("application/json"));
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		TArray<FBpPolicy> Policies;
		TArray<TSharedPtr<FJsonValue>> List;
		const bool bOk = Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), List);
		for (const TSharedPtr<FJsonValue>& Each : List)
		{
			const TSharedPtr<FJsonObject>* One = nullptr;
			FBpPolicy Policy;
			if (Each.IsValid() && Each->TryGetObject(One) && ReadPolicy(*One, Policy)) Policies.Add(MoveTemp(Policy));
		}
		UE_LOG(LogBpLink, Log, TEXT("BpLink: policies answered %d: %d grants"), Status, Policies.Num());
		if (OnDone) OnDone(bOk, Policies);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::GrantPolicy(const FString& Product, const TArray<FString>& Tools, int32 MinTier, int32 Hours, const FString& Shown,
	TFunction<void(int32, const FBpPolicy&, const FString&)> OnDone)
{
	// The bound, before anything is sent: never wider than the server's VR_POLICY_BOUND (contract 3.4).
	const FString Said = ShownText(Shown);
	FString Refused;
	if (GFromBundle || !GRouteLive) Refused = TEXT("Sample: nothing was granted.");
	else if (Product.IsEmpty() || Product == TEXT("*")) Refused = TEXT("A grant from the table names one product.");
	else if (Tools.Num() == 0 || Tools.ContainsByPredicate([](const FString& T) { return !PolicyTools().Contains(T); })) Refused = TEXT("A grant from the table names only the four bounded tools.");
	else if (MinTier < 1 || MinTier > 3) Refused = TEXT("A grant from the table never covers a stop-ship finding (tier 1 to 3 only).");
	else if (Hours <= 0 || Hours > PolicyMaxHours) Refused = FString::Printf(TEXT("A grant from the table lasts at most %d hours."), PolicyMaxHours);
	else if (Said.IsEmpty()) Refused = TEXT("A grant from the table must say what it showed.");
	if (!Refused.IsEmpty())
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: grant not sent: %s"), *Refused);
		if (OnDone) OnDone(0, FBpPolicy(), Refused);
		return;
	}
	const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
	Json->SetStringField(TEXT("product"), Product);
	TArray<TSharedPtr<FJsonValue>> ToolValues;
	for (const FString& Tool : Tools) ToolValues.Add(MakeShared<FJsonValueString>(Tool));
	Json->SetArrayField(TEXT("tools"), ToolValues);
	Json->SetNumberField(TEXT("minTier"), MinTier);
	Json->SetNumberField(TEXT("hours"), Hours);
	Json->SetStringField(TEXT("shown"), Said);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/companion/policies"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Condensed(Json));
	UE_LOG(LogBpLink, Log, TEXT("BpLink: POST /api/companion/policies %s [%s] tier %d+ for %d h"), *Product, *FString::Join(Tools, TEXT(",")), MinTier, Hours);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		FBpPolicy Grant;
		TSharedPtr<FJsonObject> Json;
		if (Status == 201 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Body), Json)) ReadPolicy(Json, Grant);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: grant answered %d %.400s"), Status, *Body);
		if (OnDone) OnDone(Status, Grant, Body);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::RevokePolicy(const FString& Id, TFunction<void(int32, const FString&)> OnDone)
{
	if (GFromBundle || !GRouteLive || Id.IsEmpty())
	{
		if (OnDone) OnDone(0, TEXT("Your PC is not linked: nothing was taken back."));
		return;
	}
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest();
	Request->SetVerb(TEXT("DELETE"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/companion/policies/") + FGenericPlatformHttp::UrlEncode(Id));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	UE_LOG(LogBpLink, Log, TEXT("BpLink: DELETE /api/companion/policies/%s"), *Id);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Id](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Body = Response.IsValid() ? Response->GetContentAsString() : FString();
		UE_LOG(LogBpLink, Log, TEXT("BpLink: revoke %s answered %d %.200s"), *Id, Status, *Body);
		if (OnDone) OnDone(Status, Body);
	});
	Request->ProcessRequest();
}

void FBpLinkModule::FetchShot(const FString& Product, const FString& Path, TFunction<void(bool, const TArray<uint8>&, bool)> OnDone)
{
	const auto Later = [OnDone](bool bOk, TArray<uint8> Bytes, bool bSample)
	{
		FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([OnDone, bOk, Bytes = MoveTemp(Bytes), bSample](float) { if (OnDone) OnDone(bOk, Bytes, bSample); return false; }));
	};
	if (!SafeShotPath(Path) || Product.IsEmpty())
	{
		Later(false, TArray<uint8>(), false);
		return;
	}
	// The build's sample screens (bundle-data.mjs copies shots/finding-<id>.png beside scan.json).
	if (GFromBundle || !GRouteLive)
	{
		TArray<uint8> Bytes;
		const bool bOk = FFileHelper::LoadFileToArray(Bytes, *(FPaths::ProjectContentDir() / TEXT("BpData") / Product / TEXT("shots") / Path), FILEREAD_Silent);
		Later(bOk, MoveTemp(Bytes), true);
		return;
	}
	// The PC's, cached on disk: one read per screen, and a stand-up that reopens draws it with no request.
	const FString Cache = FPaths::ProjectSavedDir() / TEXT("BpShots") / Product / Path.Replace(TEXT("/"), TEXT("_"));
	TArray<uint8> Cached;
	if (FFileHelper::LoadFileToArray(Cached, *Cache, FILEREAD_Silent) && Cached.Num() > 8)
	{
		Later(true, MoveTemp(Cached), false);
		return;
	}
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = MakeGet(GClient->GetBaseUrl() + TEXT("/api/products/") + Product + TEXT("/shots/") + Path, TEXT("image/png"));
	Request->SetTimeout(20.f);
	Request->OnProcessRequestComplete().BindLambda([OnDone, Cache, Path](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		TArray<uint8> Bytes;
		if (Status == 200) Bytes = Response->GetContent();
		const bool bOk = Bytes.Num() > 8;
		if (bOk) FFileHelper::SaveArrayToFile(Bytes, *Cache);
		UE_LOG(LogBpLink, Log, TEXT("BpLink: shot %s answered %d (%d bytes)%s"), *Path, Status, Bytes.Num(), bOk ? TEXT(", cached") : TEXT(""));
		if (OnDone) OnDone(bOk, Bytes, false);
	});
	Request->ProcessRequest();
}
