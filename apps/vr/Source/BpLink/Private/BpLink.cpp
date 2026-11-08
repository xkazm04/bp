// Not compiled against Unreal, not syntax-checked (no clang on the machine it was written on): apps/vr/WP3.1.md.
// Correction 2026-10-22 (Lynx): out of date. UE 5.8.4's MSVC 14.44.35207 has compiled this file end to end and linked
// UnrealEditor-BpLink.dll (bpEditor Win64 Development, exit 0) in a probe project outside the repo; nothing has run it.
// Correction later that night: the editor has run it there (-nullrhi), and reading 14 logged the Kettle wings line.
// Readings: docs/concepts/vr-light-table/machine.md.
#include "BpLink.h"

#include "Schema/BpSchemaFixups.h"
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
			UE_LOG(LogBpLink, Error, TEXT("BpLink: GET %s/structure failed (connected=%d, status=%d). Is `npm run server` running?"),
				*Root, bConnected, Response.IsValid() ? Response->GetResponseCode() : 0);
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
		FieldLabels.Reset();
		FieldUnits.Reset();
		for (const FBpLensEntry& Lens : Snapshot.Structure.lenses)
		{
			const FString& Id = Lens.manifest.id.IsEmpty() ? Lens.id : Lens.manifest.id;
			if (!Lens.manifest.name.IsEmpty()) LensNames.Add(Id, Lens.manifest.name);
			if (!Lens.manifest.presentation.accent.dark.IsEmpty()) LensAccents.Add(Id, Lens.manifest.presentation.accent.dark);
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
		FetchProduct();
		ScanTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickScanPoll), 0.1f);
		// The shared focus: hello, follow and the poll (FollowPollS), on the same core ticker.
		FollowTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickFollow), 0.1f);
		// The products and their onboarding (WP-V1), on the same core ticker.
		OnboardingTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FBpLinkModule::TickOnboarding), 0.1f);
	}
}

void FBpLinkModule::ShutdownModule()
{
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
	const double Now = FPlatformTime::Seconds();
	if (ScanPartsOut == 0 && Now >= NextScanPollS)
	{
		const bool bBusy = ScanState.Jobs.ContainsByPredicate([](const FBpScanJob& Job) { return Job.status == TEXT("running") || Job.status == TEXT("queued"); });
		NextScanPollS = Now + (bBusy ? ScanPollBusyS : ScanPollIdleS);
		PollScan();
	}
	return true;
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
			}
		}
		AsyncTask(ENamedThreads::GameThread, [Part, Gen, Wire, bOk, Failed, Tiers = MoveTemp(Tiers), Deltas = MoveTemp(Deltas)]() mutable
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
			Module->ReceiveScanPart(Part, Wire, MoveTemp(Tiers), MoveTemp(Deltas));
		});
	});
}

void FBpLinkModule::ReceiveScanPart(int32 Part, TSharedPtr<FBpScanWire> Wire, TMap<FString, int32> Tiers, TMap<FString, double> Deltas)
{
	const bool bFirst = Part == 0 ? !ScanState.bHasJobs : Part == 1 ? !ScanState.bHasScan : !ScanState.bHasWaves;
	if (Part == 0) { ScanState.Jobs = MoveTemp(Wire->jobs); ScanState.bHasJobs = true; }
	else if (Part == 1) { ScanState.Scan = MoveTemp(Wire->snapshot); ScanState.Tiers = MoveTemp(Tiers); ScanState.Deltas = MoveTemp(Deltas); ScanState.bHasScan = true; }
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
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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
	// Kettle's scans are simulated; a live product's run a real lens scan on a real repo. The owner's ruling (FAD, relaxed
	// 2026-11-08): a plain scan still never starts on a live product from the table, a directed one (a saved focus, confirmed by
	// a second pinch) may. The bundle has no server to keep either.
	const auto Refuse = [this, &OnDone](const FString& Why)
	{
		UE_LOG(LogBpLink, Warning, TEXT("BpLink: refused POST %s/scans: %s"), *GetProductSlug(), *Why);
		if (OnDone) OnDone(0, Why);
	};
	if (GFromBundle)
	{
		Refuse(TEXT("The table reads the build's bundled snapshot, and no server keeps a scan"));
		return;
	}
	if (!IsKettle() && Focus.IsEmpty())
	{
		Refuse(FString::Printf(TEXT("%s is a live product: the table starts only a directed scan on it, never a plain one"), *GetProductSlug()));
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

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(GClient->GetBaseUrl() + TEXT("/api/products/") + GetProductSlug() + TEXT("/scans"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->SetContentAsString(Text);
	Request->OnProcessRequestComplete().BindLambda([OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
	{
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		if (FBpLinkModule* Module = FModuleManager::GetModulePtr<FBpLinkModule>(TEXT("BpLink"))) Module->NextScanPollS = 0.0;
		if (OnDone) OnDone(Status, Response.IsValid() ? Response->GetContentAsString() : FString());
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
	if (Status == 403) return Error.IsEmpty() ? FString(TEXT("This headset may not start scans. On the PC, pair it again with the scan scope: npm run server -- pair approve <code> --scope read,scan")) : Error;
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
	return !GFromBundle && ScanState.bHasJobs;
}

void FBpLinkModule::GetFocuses(TFunction<void(const FBpFocusList&)> OnDone)
{
	if (GFromBundle)
	{
		FocusList.Error = TEXT("The table reads the build's bundled snapshot, and no server keeps a focus");
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
		TSharedPtr<FJsonObject> Json;
		const TArray<TSharedPtr<FJsonValue>>* Rows = nullptr;
		if (Status == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Json) && Json.IsValid() && Json->TryGetArrayField(TEXT("focuses"), Rows))
		{
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
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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
	// The bundle has no server to keep a focus record.
	if (GFromBundle) return true;
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

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
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
	// The bundle has no server, so no other product and no onboarding.
	if (GFromBundle) return true;
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
