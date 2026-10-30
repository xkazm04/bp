// The screen deck (spark vr-room-layers WP2; BpTable.h declares the API and the constants). In room mode a queue of
// readable screens stands in front of the seated person, one in focus and the next two peeking behind it as a deck: the
// room's open findings as decision screens (glass: dark, edge-lit, light type), most urgent first, then a feature sheet per
// feature in plan order (paper: warm off-white, dark ink, as the card's), then the room's summary. Next and previous tabs,
// a tap on a feature's glyph on the map, and resolving a decision swap them with a short slide; the view never moves.
// Approve puts the finding into the product's draft wave through BpLink (compose or PATCH, never dispatch); Decline drops
// it from this session's queue. A decision screen carries the finding's decision brief (ROADMAP F1: BpLink FetchBrief, the
// lines the web's card shows, the quoted decline in amber); on a repeat of a declined idea (advice withdraw) DECLINE · REPEAT
// is the first, filled control, and it declines the finding in the store (BpLink DeclineRepeat, F8), as the table's card does. What a screen says is the plan's and the store's, read the way the web's Review item and
// feature page read them (blueprint-ui.md, "Chrome and the feature page"); a field the data lacks is left out.
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpType.h"
#include "BpWords.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Crc.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SDPIScaler.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SCanvas.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	// ---- The screen's layout grid: a screen is laid out on LW x LH px and drawn at ABpTable::DeckPxPerCm ---------------
	// (FAI: FAH's grid, 40 px a cm on a 32 x 18 cm screen, kept whole on the 1.25 times larger screen, so every text grows
	// with it: 32 px a cm.)
	constexpr float LW = 1280.f;
	constexpr float LH = 720.f;
	constexpr float DeckLayoutPxPerCm = LW / ABpTable::DeckWidthCm;
	constexpr float PadX = 40.f, PadTop = 30.f, PadBottom = 26.f;
	/** The controls' bar along the lower edge, and the content above it. */
	constexpr float BarH = 96.f, BarGap = 14.f;
	constexpr float BarY = LH - PadBottom - BarH;
	constexpr float ContentW = LW - 2.f * PadX;
	constexpr float ContentH = BarY - BarGap - PadTop;
	/** The controls (layout px): Approve and Decline at the left (decisions only), the tabs and the counter at the right. */
	const FBox2f ApproveBox(FVector2f(PadX, BarY), FVector2f(PadX + 280.f, BarY + BarH));
	const FBox2f DeclineBox(FVector2f(PadX + 300.f, BarY), FVector2f(PadX + 580.f, BarY + BarH));
	const FBox2f PrevBox(FVector2f(LW - PadX - 500.f, BarY), FVector2f(LW - PadX - 345.f, BarY + BarH));
	const FBox2f CountBox(FVector2f(LW - PadX - 345.f, BarY), FVector2f(LW - PadX - 155.f, BarY + BarH));
	const FBox2f NextBox(FVector2f(LW - PadX - 155.f, BarY), FVector2f(LW - PadX, BarY + BarH));
	/** A repeat (F1, F8): DECLINE · REPEAT first and wider, APPROVE after it, before the tabs. */
	const FBox2f RepeatDeclineBox(FVector2f(PadX, BarY), FVector2f(PadX + 400.f, BarY + BarH));
	const FBox2f RepeatApproveBox(FVector2f(PadX + 420.f, BarY), FVector2f(PadX + 680.f, BarY + BarH));
	/** The summary's NEXT ROOM button at the queue's end (WP3), where a decision's Approve and Decline stand. */
	const FBox2f NextRoomBox(FVector2f(PadX, BarY), FVector2f(PadX + 680.f, BarY + BarH));
	/** A spine (FAI): the next screens' edges right of the front, laid out on SW x SH px at the same density. */
	constexpr float SW = ABpTable::DeckSpineWidthCm * DeckLayoutPxPerCm;
	constexpr float SH = ABpTable::DeckHeightCm * 0.92f * DeckLayoutPxPerCm;

	enum EDeckKind : uint8 { KDecision = 0, KSheet = 1, KSummary = 2 };
	enum ERowKind : uint8 { RText = 0, RChips = 1, RMove = 2, RHealth = 3, RFigures = 4, RGap = 5 };
	/** The type scale on a screen (caps in layout px; 32 px = 1 cm since FAI): the smallest, 24 px, is 0.75 cm, about 7.7 px
	 *  in the 1600 x 900 target capture at the front screen's farthest corner, 78 cm out (BpType's floor is 6). */
	enum EStyle : uint8 { SKicker = 0, STitle, SLede, SHead, SBody, SMeta, SBig, SControl, SBullet };
	struct FDeckRecipe { const TCHAR* Face; float CapPx; float TrackEm; };
	const FDeckRecipe Recipes[] = {
		{ TEXT("Bold"), 24.f, 0.08f },     // SKicker: the chips
		{ TEXT("Bold"), 40.f, 0.01f },     // STitle
		{ TEXT("Regular"), 28.f, 0.f },    // SLede: where it sits, a feature's one line
		{ TEXT("Bold"), 24.f, 0.12f },     // SHead: a section's heading, in capitals
		{ TEXT("Regular"), 28.f, 0.f },    // SBody
		{ TEXT("Regular"), 24.f, 0.02f },  // SMeta
		{ TEXT("Bold"), 46.f, 0.f },       // SBig: the metric's figures
		{ TEXT("Bold"), 28.f, 0.06f },     // SControl
		{ TEXT("Regular"), 28.f, 0.f },    // SBullet: a body line under a bullet
	};
	constexpr float BulletIndentPx = 30.f;

	float Pitch(uint8 Style)
	{
		return Recipes[Style].CapPx / static_cast<float>(BpType::CapPerEm) * 1.22f;
	}

	FSlateFontInfo DeckFont(uint8 Style)
	{
		const FDeckRecipe& R = Recipes[Style];
		FSlateFontInfo Font(ABpTable::TextFontObject(), R.CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(R.Face));
		Font.LetterSpacing = FMath::RoundToInt(R.TrackEm * 1000.f);
		return Font;
	}

	float TextWidth(const FString& Text, uint8 Style)
	{
		const FSlateFontInfo Font = DeckFont(Style);
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return static_cast<float>(Renderer->GetFontMeasureService()->Measure(Text, Font).X);
		}
		return Text.Len() * 0.55f * Recipes[Style].CapPx / static_cast<float>(BpType::CapPerEm);
	}

	FString CutToWidth(const FString& Text, uint8 Style, float MaxW)
	{
		if (TextWidth(Text, Style) <= MaxW) return Text;
		for (int32 Keep = Text.Len() - 1; Keep > 0; --Keep)
		{
			const FString Cut = Text.Left(Keep).TrimEnd() + BpType::Ellipsis();
			if (TextWidth(Cut, Style) <= MaxW) return Cut;
		}
		return FString();
	}

	/** Words into lines of MaxW at a style; past MaxLines the last line kept takes the rest, cut (BpType's rule: never
	 *  smaller, cut or paginate). MaxLines 0: no limit. */
	TArray<FString> Wrap(const FString& Text, uint8 Style, float MaxW, int32 MaxLines = 0)
	{
		TArray<FString> Words, Lines;
		Text.ParseIntoArrayWS(Words);
		FString Line;
		for (const FString& Word : Words)
		{
			const FString Try = Line.IsEmpty() ? Word : Line + TEXT(" ") + Word;
			if (TextWidth(Try, Style) <= MaxW) { Line = Try; continue; }
			if (!Line.IsEmpty()) Lines.Add(Line);
			Line = TextWidth(Word, Style) <= MaxW ? Word : CutToWidth(Word, Style, MaxW);
		}
		if (!Line.IsEmpty()) Lines.Add(Line);
		if (MaxLines > 0 && Lines.Num() > MaxLines)
		{
			FString Rest = Lines[MaxLines - 1];
			for (int32 Index = MaxLines; Index < Lines.Num(); ++Index) Rest += TEXT(" ") + Lines[Index];
			Lines.SetNum(MaxLines);
			Lines.Last() = CutToWidth(Rest, Style, MaxW);
		}
		return Lines;
	}

	/** Markdown's emphasis and code ticks off a line of the body. */
	FString Plain(const FString& Line)
	{
		return Line.Replace(TEXT("**"), TEXT("")).Replace(TEXT("`"), TEXT("")).TrimStartAndEnd();
	}

	/** A lens as a chip's word, a tier as the queue's (BpWords.h: the manifest's name, core's TIER_SAYS). */
	FString LensWord(const FString& Lens)
	{
		return BpWords::Lens(Lens).ToUpper();
	}

	FString TierWord(int32 Tier)
	{
		return BpWords::TierSays(Tier).ToUpper();
	}

	FString Number(double Value)
	{
		const double Rounded = FMath::RoundToDouble(Value * 10.0) / 10.0;
		return FMath::IsNearlyEqual(Rounded, FMath::RoundToDouble(Rounded)) ? FString::Printf(TEXT("%d"), static_cast<int32>(FMath::RoundToDouble(Rounded))) : FString::Printf(TEXT("%.1f"), Rounded);
	}

	float DeckEase(float Alpha)
	{
		Alpha = FMath::Clamp(Alpha, 0.f, 1.f);
		return Alpha * Alpha * (3.f - 2.f * Alpha);
	}

	// ---- The two surfaces ---------------------------------------------------------------------------------------------
	const FLinearColor Cyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor CyanEdge(FColor(0xD8, 0xF4, 0xFF));
	const FLinearColor CyanText(FColor(0xEC, 0xF9, 0xFF));
	const FLinearColor Amber(FColor(0xFF, 0xB5, 0x47));
	/** The glass: a dark blue, nearly opaque so the deck behind and the city through the window do not read through. */
	const FLinearColor GlassDark(FColor(0x08, 0x16, 0x2E));
	/** The paper and its ink (the card's, BpMarks.cpp). */
	const FLinearColor PaperTone(FColor(0xF3, 0xE9, 0xD2));
	const FLinearColor PaperEdge(FColor(0xFF, 0xE2, 0xB0));
	const FLinearColor PaperGlow(FColor(0xFF, 0xB8, 0x60));
	const FLinearColor Ink(FColor(0x14, 0x22, 0x3C));
	/** The readings (the ledger's health colours, darkened on paper so they keep their contrast). */
	const FLinearColor GoodInk(FColor(0x2E, 0x7D, 0x4F));
	const FLinearColor WatchInk(FColor(0xA8, 0x62, 0x00));
	const FLinearColor BadInk(FColor(0xB3, 0x26, 0x1E));

	FLinearColor TextColor(uint8 Style, bool bPaper)
	{
		if (bPaper)
		{
			switch (Style)
			{
			case SKicker: case SHead: case SMeta: return Ink.CopyWithNewOpacity(0.72f);
			default: return Ink;
			}
		}
		switch (Style)
		{
		case SKicker: case SHead: return Cyan;
		case SMeta: case SLede: return CyanText.CopyWithNewOpacity(0.86f);
		default: return FLinearColor::White;
		}
	}

	/** The chips' looks: an outline, the urgent amber, the draft's cyan, and the three readings. */
	enum EChip : uint8 { COutline = 0, CAmber, CCyan, CGood, CWatch, CBad, CRight = 255 };

	const FSlateBrush* ChipBrush(uint8 Chip, bool bPaper)
	{
		static const FSlateRoundedBoxBrush OutlineGlass(FLinearColor::Transparent, 10.f, Cyan.CopyWithNewOpacity(0.75f), 2.f);
		static const FSlateRoundedBoxBrush OutlinePaper(FLinearColor::Transparent, 10.f, Ink.CopyWithNewOpacity(0.6f), 2.f);
		static const FSlateRoundedBoxBrush AmberFill(Amber, 10.f);
		static const FSlateRoundedBoxBrush CyanFill(Cyan.CopyWithNewOpacity(0.9f), 10.f);
		static const FSlateRoundedBoxBrush CyanFillPaper(FLinearColor(FColor(0x0B, 0x2A, 0x6B)), 10.f);
		static const FSlateRoundedBoxBrush GoodFill(GoodInk, 10.f);
		static const FSlateRoundedBoxBrush WatchFill(FLinearColor(FColor(0xE0, 0x9A, 0x2A)), 10.f);
		static const FSlateRoundedBoxBrush BadFill(BadInk, 10.f);
		switch (Chip)
		{
		case CAmber: return &AmberFill;
		case CCyan: return bPaper ? &CyanFillPaper : &CyanFill;
		case CGood: return &GoodFill;
		case CWatch: return &WatchFill;
		case CBad: return &BadFill;
		default: return bPaper ? &OutlinePaper : &OutlineGlass;
		}
	}

	FLinearColor ChipText(uint8 Chip, bool bPaper)
	{
		switch (Chip)
		{
		case CAmber: case CWatch: return Ink;
		case CCyan: return bPaper ? FLinearColor::White : Ink;
		case CGood: case CBad: return FLinearColor::White;
		default: return bPaper ? Ink.CopyWithNewOpacity(0.85f) : CyanText;
		}
	}

	/** A reading's ink: the health colours, the unread ones in the surface's quiet ink. */
	FLinearColor ReadingInk(const FString& Reading, bool bPaper)
	{
		if (Reading == TEXT("good")) return bPaper ? GoodInk : FLinearColor(FColor(0x6F, 0xE0, 0x9F));
		if (Reading == TEXT("watch")) return bPaper ? WatchInk : Amber;
		if (Reading == TEXT("bad")) return bPaper ? BadInk : FLinearColor(FColor(0xFF, 0x7A, 0x6E));
		return TextColor(SMeta, bPaper);
	}

	FString ReadingWord(const FString& Reading)
	{
		if (Reading == TEXT("unmeasured")) return TEXT("NOT MEASURED");
		if (Reading == TEXT("na")) return TEXT("N/A");
		return Reading.ToUpper();
	}

	/** bp.Deck 0 hides the deck in room mode (the budget's baseline: room mode with and without it, one session). */
	TAutoConsoleVariable<int32> CVarDeck(TEXT("bp.Deck"), 1, TEXT("The screen deck in room mode: 1 shown (default), 0 hidden (a profiling baseline)."), ECVF_Default);

	/** Runs Fn on every table with a plan; before any has one the command waits for the plan, as BpRoom.* does. */
	void WithDeckTables(UWorld* World, const FString& Command, TFunctionRef<void(ABpTable&)> Fn)
	{
		bool bAny = false;
		if (World)
		{
			for (TActorIterator<ABpTable> It(World); It; ++It)
			{
				if (!It->HasPlan()) continue;
				bAny = true;
				Fn(**It);
			}
		}
		if (!bAny)
		{
			ABpTable::PendingLevelCommands().Add(Command);
			UE_LOG(LogBpTable, Log, TEXT("BpDeck: deferred \"%s\" until the plan arrives"), *Command);
		}
	}

	FAutoConsoleCommandWithWorldAndArgs CmdDeckNext(TEXT("BpDeck.Next"), TEXT("BpDeck.Next: the screen deck's next page or screen (room mode)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithDeckTables(World, TEXT("BpDeck.Next"), [](ABpTable& T) { T.DeckNext(); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdDeckPrev(TEXT("BpDeck.Prev"), TEXT("BpDeck.Prev: the screen deck's previous page or screen (room mode)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithDeckTables(World, TEXT("BpDeck.Prev"), [](ABpTable& T) { T.DeckPrev(); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdDeckShow(TEXT("BpDeck.Show"), TEXT("BpDeck.Show <n>: the deck's n-th screen (1-based, as its counter) to the front."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			const int32 Place = Args.Num() > 0 ? FCString::Atoi(*Args[0]) : 1;
			WithDeckTables(World, FString::Printf(TEXT("BpDeck.Show %d"), Place), [Place](ABpTable& T) { T.DeckShow(Place); });
		}));
	FAutoConsoleCommandWithWorldAndArgs CmdDeckApprove(TEXT("BpDeck.Approve"), TEXT("BpDeck.Approve: the front decision into the product's draft wave (never dispatched), then the next screen."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithDeckTables(World, TEXT("BpDeck.Approve"), [](ABpTable& T) { T.DeckApprove(); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdDeckDecline(TEXT("BpDeck.Decline"), TEXT("BpDeck.Decline: the front decision off this session's queue."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithDeckTables(World, TEXT("BpDeck.Decline"), [](ABpTable& T) { T.DeckDecline(); }); }));
	FAutoConsoleCommandWithWorldAndArgs CmdDeckFocus(TEXT("BpDeck.Focus"), TEXT("BpDeck.Focus <feature id>: that feature's first screen (its decision, else its sheet) to the front."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Num() == 0) return;
			const FString Id = Args[0];
			WithDeckTables(World, TEXT("BpDeck.Focus ") + Id, [&Id](ABpTable& T) { T.DeckFocus(Id); });
		}));
}

// ---- Setup --------------------------------------------------------------------------------------------------------------

void ABpTable::InitDeck()
{
	for (int32 Index = 0; Index < 4; ++Index)
	{
		UWidgetComponent* Screen = NewObject<UWidgetComponent>(this, *FString::Printf(TEXT("DeckScreen%d"), Index));
		Screen->SetupAttachment(Root);
		Screen->SetWidgetSpace(EWidgetSpace::World);
		Screen->SetDrawSize(FVector2D(DeckWidthCm * DeckPxPerCm, DeckHeightCm * DeckPxPerCm));
		Screen->SetDrawAtDesiredSize(false);
		Screen->SetPivot(FVector2D(0.5, 0.5));
		Screen->SetBlendMode(EWidgetBlendMode::Transparent);
		Screen->SetTwoSided(false);
		Screen->SetBackgroundColor(FLinearColor::Transparent);
		Screen->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Screen->SetCastShadow(false);
		Screen->SetWindowFocusable(false);
		Screen->SetManuallyRedraw(true);
		Screen->RegisterComponent();
		Screen->SetRelativeTransform(DeckPose(Index < 3 ? static_cast<float>(Index) : 0.f, 0.f));
		Screen->SetVisibility(false);
		DeckCards.Add(Screen);
	}
	// The spines (FAI): the next two screens' edges, right of the front.
	for (int32 Index = 0; Index < 2; ++Index)
	{
		UWidgetComponent* Spine = NewObject<UWidgetComponent>(this, *FString::Printf(TEXT("DeckSpine%d"), Index));
		Spine->SetupAttachment(Root);
		Spine->SetWidgetSpace(EWidgetSpace::World);
		Spine->SetDrawSize(FVector2D(SW * DeckPxPerCm / DeckLayoutPxPerCm, SH * DeckPxPerCm / DeckLayoutPxPerCm));
		Spine->SetDrawAtDesiredSize(false);
		Spine->SetPivot(FVector2D(0.5, 0.5));
		Spine->SetBlendMode(EWidgetBlendMode::Transparent);
		Spine->SetTwoSided(false);
		Spine->SetBackgroundColor(FLinearColor::Transparent);
		Spine->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Spine->SetCastShadow(false);
		Spine->SetWindowFocusable(false);
		Spine->SetManuallyRedraw(true);
		Spine->RegisterComponent();
		Spine->SetRelativeTransform(SpinePose(Index + 1));
		Spine->SetVisibility(false);
		DeckSpines.Add(Spine);
	}
	// The lit cell under the current screen's feature: one edge-glow box in the map walls' glass (BpRoom.cpp).
	DeckLight = NewObject<UInstancedStaticMeshComponent>(this, TEXT("DeckLight"));
	DeckLight->SetupAttachment(Root);
	DeckLight->SetMobility(EComponentMobility::Movable);
	DeckLight->SetStaticMesh(EngineCube);
	DeckLight->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	DeckLight->SetCastShadow(false);
	DeckLight->NumCustomDataFloats = 5;
	if (MapWalls && MapWalls->GetMaterial(0)) DeckLight->SetMaterial(0, MapWalls->GetMaterial(0));
	DeckLight->RegisterComponent();
	RoomModeChanged.AddUObject(this, &ABpTable::OnDeckRoomChanged);
}

FTransform ABpTable::DeckPose(float Slot, float Side) const
{
	// From the target eye (ABpGameMode's target pose, the one the captures are judged from): DeckDistanceCm along the
	// direction DeckYawDeg right of straight ahead and DeckDropDeg below the horizon; the screen's +X faces the eye. A
	// screen leaving the front (Slot toward 1) slides to the first spine's place and fades there (FAI: the screens behind
	// show as spines, never whole); beyond 1 it stays there.
	const FVector Eye = EyeLocal();
	const double Yaw = FMath::DegreesToRadians(DeckYawDeg), Drop = FMath::DegreesToRadians(DeckDropDeg);
	const FVector Dir(FMath::Cos(Drop) * FMath::Cos(Yaw), FMath::Cos(Drop) * FMath::Sin(Yaw), -FMath::Sin(Drop));
	const FVector Front = Eye + Dir * DeckDistanceCm;
	const FRotator Facing = (Eye - Front).Rotation();
	// The viewer's right is the widget's +x, the component's -Y.
	const FVector Right = -Facing.RotateVector(FVector::RightVector);
	const FVector At = FMath::Lerp(Front, SpinePose(1).GetLocation(), static_cast<double>(FMath::Clamp(Slot, 0.f, 1.f))) + Right * (Side * DeckWidthCm * 0.55);
	return FTransform(Facing, At, FVector(1.0 / DeckPxPerCm));
}

FTransform ABpTable::SpinePose(int32 Place) const
{
	// Right of the front screen, DeckSpineGapCm apart and DeckStepBackCm further back per place, each turned to the eye.
	const FVector Eye = EyeLocal();
	const double Yaw = FMath::DegreesToRadians(DeckYawDeg), Drop = FMath::DegreesToRadians(DeckDropDeg);
	const FVector Dir(FMath::Cos(Drop) * FMath::Cos(Yaw), FMath::Cos(Drop) * FMath::Sin(Yaw), -FMath::Sin(Drop));
	const FVector Front = Eye + Dir * DeckDistanceCm;
	const FVector Right = -(Eye - Front).Rotation().RotateVector(FVector::RightVector);
	const FVector At = Front + Right * (DeckWidthCm * 0.5 + Place * DeckSpineGapCm + (Place - 0.5) * DeckSpineWidthCm) - Dir * (DeckStepBackCm * Place);
	return FTransform((Eye - At).Rotation(), At, FVector(1.0 / DeckPxPerCm));
}

void ABpTable::DeckTextClasses(TArray<BpType::FClassSample>& Out) const
{
	// Each class's cap at its screen's centre (a sheet's ink is the decision's type scale on paper), rising along the
	// screen's up; the spines' at the first spine.
	const FTransform& T = GetActorTransform();
	const auto Add = [&](const TCHAR* Name, uint8 Style, const FTransform& Pose)
	{
		const FTransform World = Pose * T;
		Out.Add({ Name, Recipes[Style].CapPx / DeckLayoutPxPerCm, World.GetLocation(), World.GetRotation().GetUpVector() });
	};
	const FTransform Front = DeckPose(0.f, 0.f), Spine = SpinePose(1);
	Add(TEXT("deck title"), STitle, Front);
	Add(TEXT("deck body"), SBody, Front);
	Add(TEXT("deck chips"), SKicker, Front);
	Add(TEXT("deck meta"), SMeta, Front);
	Add(TEXT("sheet figures"), SBig, Front);
	Add(TEXT("spine kind"), SKicker, Spine);
	Add(TEXT("spine title"), SLede, Spine);
}

// ---- The queue ----------------------------------------------------------------------------------------------------------

void ABpTable::OnDeckRoomChanged(const FString& InRoomId)
{
	DeckRoom = InRoomId;
	DeckScreens.Reset();
	DeckAt = DeckPage = 0;
	bDeckTouched = false;
	DeckLitTile.Reset();
	for (FDeckCard& Each : DeckCardState) Each = FDeckCard();
	DeckSwapT = 1.f;
	if (DeckRoom.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: cleared (site plan)"));
		DeckAimedTile.Reset();
		ApplyDeckPoses();
		ApplyDeckLight();
		return;
	}
	BuildDeckQueue();
	ShowDeckAt(0, 0, 0);
	// The type against the floor, at the front screen's farthest corner from the target eye (BpType: 6 px in the capture).
	const FTransform Pose = DeckPose(0.f, 0.f);
	const FVector Eye = EyeLocal();
	double Far = 0.0;
	for (int32 Corner = 0; Corner < 4; ++Corner)
	{
		const FVector Local(0.0, (Corner & 1 ? 0.5 : -0.5) * DeckWidthCm, (Corner & 2 ? 0.5 : -0.5) * DeckHeightCm);
		Far = FMath::Max(Far, FVector::Dist(Eye, Pose.GetLocation() + Pose.GetRotation().RotateVector(Local)));
	}
	const double PxPerCm = 800.0 / Far;
	UE_LOG(LogBpTable, Log, TEXT("BpType: deck caps_cm title=%.2f body=%.2f smallest=%.2f; at its farthest corner (%.1f cm from the target eye) %.1f / %.1f / %.1f px (floor %.0f)"),
		Recipes[STitle].CapPx / DeckLayoutPxPerCm, Recipes[SBody].CapPx / DeckLayoutPxPerCm, Recipes[SMeta].CapPx / DeckLayoutPxPerCm, Far,
		Recipes[STitle].CapPx / DeckLayoutPxPerCm * PxPerCm, Recipes[SBody].CapPx / DeckLayoutPxPerCm * PxPerCm, Recipes[SMeta].CapPx / DeckLayoutPxPerCm * PxPerCm, BpType::FloorPx);
	// The spines' type (their kind and title) at the second spine's farthest corner.
	const FTransform Back = SpinePose(2);
	double SpineFar = 0.0;
	for (int32 Corner = 0; Corner < 4; ++Corner)
	{
		const FVector Local(0.0, (Corner & 1 ? 0.5 : -0.5) * DeckSpineWidthCm, (Corner & 2 ? 0.5 : -0.5) * DeckHeightCm * 0.92);
		SpineFar = FMath::Max(SpineFar, FVector::Dist(Eye, Back.GetLocation() + Back.GetRotation().RotateVector(Local)));
	}
	UE_LOG(LogBpTable, Log, TEXT("BpType: deck spines kind=%.2f title=%.2f cm; at the back one's farthest corner (%.1f cm) %.1f / %.1f px"),
		Recipes[SKicker].CapPx / DeckLayoutPxPerCm, Recipes[SLede].CapPx / DeckLayoutPxPerCm, SpineFar,
		Recipes[SKicker].CapPx / DeckLayoutPxPerCm * 800.0 / SpineFar, Recipes[SLede].CapPx / DeckLayoutPxPerCm * 800.0 / SpineFar);
}

void ABpTable::BuildDeckQueue()
{
	const FString Keep = DeckScreens.IsValidIndex(DeckAt) ? DeckScreens[DeckAt].Key : FString();
	const int32 WasAt = DeckAt;
	DeckScreens.Reset();
	const FBpPlanRoom* Room = FindRoom(DeckRoom);
	if (!SheetPlan.IsValid() || !Room) return;
	const FBpPlan& Plan = *SheetPlan;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();

	// The room's features in plan order (its bays by order, each bay's tiles by order), as the map lays them out.
	TArray<int32> RoomBays;
	for (int32 Index = 0; Index < Plan.bays.Num(); ++Index)
	{
		if (Plan.bays[Index].parentId == Room->id) RoomBays.Add(Index);
	}
	RoomBays.StableSort([&Plan](int32 A, int32 B) { return Plan.bays[A].order < Plan.bays[B].order; });
	TArray<int32> Features;
	for (const int32 Bay : RoomBays)
	{
		TArray<int32> BayTiles;
		for (int32 Index = 0; Index < Plan.tiles.Num(); ++Index)
		{
			if (Plan.tiles[Index].parentId == Plan.bays[Bay].id) BayTiles.Add(Index);
		}
		BayTiles.StableSort([&Plan](int32 A, int32 B) { return Plan.tiles[A].order < Plan.tiles[B].order; });
		Features.Append(BayTiles);
	}
	TSet<FString> InRoom;
	for (const int32 Tile : Features) InRoom.Add(Plan.tiles[Tile].id);

	// Decisions: the room's open findings not declined this session, most urgent first (the tier, untriaged after T3,
	// then the risk; equal ones keep the store's order).
	struct FAsk { int32 Index; int32 Rank; double Risk; };
	TArray<FAsk> Asks;
	for (int32 Index = 0; Index < State.Scan.proposals.Num(); ++Index)
	{
		const FBpProposal& Proposal = State.Scan.proposals[Index];
		if (Proposal.status != TEXT("proposed") || !InRoom.Contains(Proposal.feature) || DeckDeclined.Contains(Proposal.id)) continue;
		const int32* Tier = State.Tiers.Find(Proposal.id);
		Asks.Add({ Index, Tier ? FMath::Clamp(*Tier, 0, 3) : 4, Proposal.risk });
	}
	Asks.StableSort([](const FAsk& A, const FAsk& B) { return A.Rank != B.Rank ? A.Rank < B.Rank : A.Risk > B.Risk; });
	for (const FAsk& Ask : Asks)
	{
		FDeckScreen Screen;
		Screen.Kind = KDecision;
		Screen.Proposal = State.Scan.proposals[Ask.Index].id;
		Screen.Feature = State.Scan.proposals[Ask.Index].feature;
		Screen.Key = TEXT("d:") + Screen.Proposal;
		DeckScreens.Add(Screen);
	}
	for (const int32 Tile : Features)
	{
		FDeckScreen Screen;
		Screen.Kind = KSheet;
		Screen.Feature = Plan.tiles[Tile].id;
		Screen.Key = TEXT("f:") + Screen.Feature;
		DeckScreens.Add(Screen);
	}
	FDeckScreen Summary;
	Summary.Kind = KSummary;
	Summary.Key = TEXT("s:") + Room->id;
	DeckScreens.Add(Summary);
	for (FDeckScreen& Screen : DeckScreens) LayoutDeckScreen(Screen);
	// Each decision's brief, asked once per room visit; its answer lays the screens out again (F1).
	TWeakObjectPtr<ABpTable> Self(this);
	for (const FDeckScreen& Screen : DeckScreens)
	{
		if (Screen.Kind != KDecision || DeckBriefAsked.Contains(Screen.Proposal)) continue;
		DeckBriefAsked.Add(Screen.Proposal);
		FBpLinkModule::Get().FetchBrief(Screen.Proposal, [Self](bool bOk, const FBpDecisionBrief&)
		{
			if (bOk && Self.IsValid()) Self->RefreshDeck();
		});
	}

	// The current screen stays in front when it is still in the queue; else the one now at its place. Until a swap the
	// front is the queue's first (FAH's CSV run: the room was entered before the first /scan read, so the sheets came
	// first and the decisions that arrived after went behind them).
	const int32 Found = bDeckTouched ? DeckScreens.IndexOfByPredicate([&Keep](const FDeckScreen& S) { return S.Key == Keep; }) : 0;
	DeckAt = Found != INDEX_NONE ? Found : FMath::Clamp(WasAt, 0, DeckScreens.Num() - 1);
	DeckPage = Found != INDEX_NONE ? FMath::Clamp(DeckPage, 0, DeckScreens[DeckAt].Pages.Num() - 1) : 0;
	int32 Pages = 0;
	for (const FDeckScreen& Screen : DeckScreens) Pages += Screen.Pages.Num();
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: queue %s: %d screens (%d decisions, %d sheets, 1 summary; %d pages), declined this session %d, front %d"),
		*Room->id, DeckScreens.Num(), Asks.Num(), Features.Num(), Pages, DeckDeclined.Num(), DeckAt + 1);
}

void ABpTable::LayoutDeckScreen(FDeckScreen& Screen) const
{
	const FBpPlan& Plan = *SheetPlan;
	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FBpScanState& State = Link.GetScanState();
	const bool bPaper = Screen.Kind == KSheet;
	struct FFlow { FDeckRow Row; bool bKeep = false; };
	TArray<FFlow> Flow;
	const auto Text = [](const FString& Line, uint8 Style)
	{
		FDeckRow Row;
		Row.Kind = RText;
		Row.Style = Style;
		Row.Texts.Add(Line);
		Row.HeightPx = Pitch(Style);
		return Row;
	};
	const auto Gap = [](float Px)
	{
		FDeckRow Row;
		Row.Kind = RGap;
		Row.HeightPx = Px;
		return Row;
	};
	const auto Chips = [](TArray<TPair<FString, uint8>> Items, FString Right)
	{
		// FAI: a row wider than the screen sheds its right-hand words first, then each chip's words after its first (the
		// tier's "BEFORE PRODUCTION"), so nothing runs past the edge (Slate's measure counts the font's tracking).
		const auto Width = [&Items, &Right]()
		{
			const auto W = [](const FString& Text) { return TextWidth(Text, SKicker) * 1.02f; };
			float Sum = Right.IsEmpty() ? 0.f : W(Right) + 12.f;
			for (const TPair<FString, uint8>& Item : Items) Sum += W(Item.Key) + 28.f + 12.f;
			return Sum;
		};
		if (Width() > ContentW) Right.Reset();
		for (TPair<FString, uint8>& Item : Items)
		{
			if (Width() <= ContentW) break;
			int32 Cut = Item.Key.Find(TEXT("  "));
			if (Cut != INDEX_NONE) Item.Key = Item.Key.Left(Cut);
		}
		FDeckRow Row;
		Row.Kind = RChips;
		for (const TPair<FString, uint8>& Item : Items) { Row.Texts.Add(Item.Key); Row.Styles.Add(Item.Value); }
		Row.Texts.Add(Right);
		Row.Styles.Add(CRight);
		Row.HeightPx = 56.f;
		return Row;
	};
	const auto Add = [&Flow](const FDeckRow& Row, bool bKeep = false) { Flow.Add({ Row, bKeep }); };
	const auto AddLines = [&](const FString& Line, uint8 Style, int32 MaxLines, float Indent = 0.f)
	{
		for (const FString& Each : Wrap(Line, Style, ContentW - Indent, MaxLines))
		{
			FDeckRow Row = Text(Each, Style);
			if (Indent > 0.f) Row.Styles.Add(1);
			Add(Row);
		}
	};
	const auto TileOf = [&Plan](const FString& Id) { return Plan.tiles.FindByPredicate([&Id](const FBpPlanTile& T) { return T.id == Id; }); };
	const auto BayOf = [&Plan](const FBpPlanTile* Tile) { return Tile ? Plan.bays.FindByPredicate([Tile](const FBpPlanBay& B) { return B.id == Tile->parentId; }) : nullptr; };
	/** Whether a draft wave holds the finding (the store's waves, or an Approve whose write the waves have not shown yet). */
	const auto InDraft = [this, &State](const FString& Id)
	{
		if (DeckInDraft.Contains(Id)) return true;
		for (const FBpWave& Wave : State.Waves)
		{
			if (Wave.status != TEXT("draft")) continue;
			for (const FBpWavePackage& Package : Wave.packages) if (Package.ids.Contains(Id)) return true;
		}
		return false;
	};
	/** The newest measurement on these features (its date and lens), or none. */
	const auto LastScan = [&State](const TSet<FString>& Features, FString& OutLine)
	{
		const FBpMeasurement* Newest = nullptr;
		for (const FBpMeasurement& Row : State.Scan.measurements)
		{
			if (Features.Contains(Row.feature) && !Row.measured_at.IsEmpty() && (!Newest || Row.measured_at > Newest->measured_at)) Newest = &Row;
		}
		if (Newest) OutLine = FString::Printf(TEXT("%s  ·  %s lens"), *Newest->measured_at.Left(10), *BpWords::Lens(Newest->lens));
		return Newest != nullptr;
	};
	/** The open findings on one feature, most urgent first (the queue's order). */
	const auto OpenOn = [this, &State](const FString& Feature)
	{
		TArray<const FBpProposal*> Out;
		for (const FBpProposal& Proposal : State.Scan.proposals)
		{
			if (Proposal.status == TEXT("proposed") && Proposal.feature == Feature && !DeckDeclined.Contains(Proposal.id)) Out.Add(&Proposal);
		}
		Out.StableSort([&State](const FBpProposal& A, const FBpProposal& B)
		{
			const int32* TA = State.Tiers.Find(A.id);
			const int32* TB = State.Tiers.Find(B.id);
			const int32 RA = TA ? *TA : 4, RB = TB ? *TB : 4;
			return RA != RB ? RA < RB : A.risk > B.risk;
		});
		return Out;
	};
	TArray<FDeckRow> Continued;

	if (Screen.Kind == KDecision)
	{
		const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Screen](const FBpProposal& X) { return X.id == Screen.Proposal; });
		if (!P) return;
		const FBpPlanTile* Tile = TileOf(P->feature);
		const FBpPlanBay* Bay = BayOf(Tile);
		const int32* Tier = State.Tiers.Find(P->id);
		TArray<TPair<FString, uint8>> Items;
		Items.Emplace(LensWord(P->lens) + TEXT(" LENS"), COutline);
		if (P->risk > 0.0) Items.Emplace(FString::Printf(TEXT("RISK %s / 10"), *Number(P->risk)), P->risk >= PinTagRiskMin ? CAmber : COutline);
		if (Tier) Items.Emplace(FString::Printf(TEXT("T%d  %s"), *Tier, *TierWord(*Tier)), *Tier <= PinTagTierMax ? CAmber : COutline);
		if (!P->kind.IsEmpty() && P->kind != TEXT("fix")) Items.Emplace(P->kind.Replace(TEXT("-"), TEXT(" ")).ToUpper(), COutline);
		if (InDraft(P->id)) Items.Emplace(TEXT("IN DRAFT WAVE"), CCyan);
		const FBpDecisionBrief* Brief = DeckBrief(P->id);
		const bool bRepeat = Brief && FBpLinkModule::IsRepeat(*Brief);
		if (bRepeat) Items.Insert(TPair<FString, uint8>(TEXT("REPEATS A DECLINE  ·  DECLINE RECOMMENDED"), CAmber), 0);
		const FDeckRow Head = Chips(Items, P->id.ToUpper());
		Add(Head);
		Add(Gap(12.f));
		AddLines(P->title, STitle, 3);
		FString Where = Tile ? TEXT("On ") + Tile->name : TEXT("On ") + P->feature;
		if (Bay) Where += TEXT("  ·  ") + Bay->name;
		AddLines(Where, SLede, 2);
		// The decision brief (F1): its lines as the web's card shows them, the quoted decline in amber (row style 2).
		if (Brief && Brief->lines.Num() > 0)
		{
			int32 DeclinedLine = INDEX_NONE;
			for (int32 Index = 0; Index < Brief->facts.Num(); ++Index) if (Brief->facts[Index].key == TEXT("declined")) DeclinedLine = Index;
			Add(Gap(14.f));
			Add(Text(TEXT("THE BRIEF"), SHead), true);
			for (int32 Index = 0; Index < Brief->lines.Num() && Index < 5; ++Index)
			{
				for (const FString& Each : Wrap(Brief->lines[Index], SBody, ContentW))
				{
					FDeckRow Row = Text(Each, SBody);
					if (Index == DeclinedLine) Row.Styles.Add(2);
					Add(Row);
				}
			}
		}
		// The metric move (the web's Review figure): the latest reading of the proposal's metric on its feature and lens,
		// then that plus expected_delta. Only what the store has: no reading is "—", no delta leaves the after out.
		if (!P->metric.IsEmpty())
		{
			const FBpMeasurement* Last = nullptr;
			for (const FBpMeasurement& Row : State.Scan.measurements)
			{
				if (Row.feature == P->feature && Row.lens == P->lens && Row.metric == P->metric && (!Last || Row.measured_at >= Last->measured_at)) Last = &Row;
			}
			const double* Delta = State.Deltas.Find(P->id);
			FDeckRow Move;
			Move.Kind = RMove;
			const FString Signed = Delta ? FString::Printf(TEXT("%s%s"), *Delta > 0.0 ? TEXT("+") : *Delta < 0.0 ? TEXT("−") : TEXT("±"), *Number(FMath::Abs(*Delta))) : FString();
			Move.Texts = {
				BpWords::Metric(P->lens, P->metric),
				Last ? Number(Last->value) : FString(TEXT("—")),
				Last && Delta ? Number(Last->value + *Delta) : Signed,
				Last ? BpWords::Unit(P->lens, P->metric, Last->unit) : FString(),
				Last ? FString(TEXT("NOW")) : FString(TEXT("NOT MEASURED YET")),
				Last && Delta ? FString(TEXT("EXPECTED")) : Delta ? FString(TEXT("EXPECTED CHANGE")) : FString(),
				Last && Delta ? Signed : FString() };
			Move.HeightPx = 104.f;
			Add(Gap(8.f));
			Add(Move);
		}
		// The body's sections (## headings), each line wrapped; a bullet keeps its indent.
		TArray<FString> Lines;
		P->body.ParseIntoArrayLines(Lines, false);
		bool bAnyBody = false;
		for (const FString& Raw : Lines)
		{
			const FString Line = Raw.TrimStartAndEnd();
			if (Line.IsEmpty()) continue;
			if (Line.StartsWith(TEXT("#")))
			{
				FString HeadText = Line;
				while (HeadText.StartsWith(TEXT("#"))) HeadText.RightChopInline(1);
				Add(Gap(14.f));
				Add(Text(Plain(HeadText).ToUpper(), SHead), true);
				continue;
			}
			bAnyBody = true;
			if (Line.StartsWith(TEXT("- ")) || Line.StartsWith(TEXT("* ")))
			{
				const TArray<FString> Wrapped = Wrap(Plain(Line.Mid(2)), SBody, ContentW - BulletIndentPx);
				for (int32 Index = 0; Index < Wrapped.Num(); ++Index)
				{
					FDeckRow Row = Text(Index == 0 ? TEXT("•  ") + Wrapped[Index] : Wrapped[Index], SBody);
					if (Index > 0) Row.Styles.Add(1);
					Add(Row);
				}
				continue;
			}
			AddLines(Plain(Line), SBody, 0);
		}
		if (!bAnyBody) Add(Text(TEXT("The proposal has no body."), SMeta));
		TArray<FString> Meta;
		if (!P->standard.IsEmpty()) Meta.Add(TEXT("Standard ") + P->standard);
		if (!P->size.IsEmpty()) Meta.Add(TEXT("Size ") + P->size);
		if (!P->created_at.IsEmpty()) Meta.Add(TEXT("Proposed ") + P->created_at.Left(10));
		if (Meta.Num() > 0)
		{
			Add(Gap(12.f));
			AddLines(FString::Join(Meta, TEXT("  ·  ")), SMeta, 2);
		}
		Continued = { Head, Gap(12.f), Text(CutToWidth(P->title + TEXT("  (continued)"), SLede, ContentW), SLede), Gap(6.f) };
	}
	else if (Screen.Kind == KSheet)
	{
		const FBpPlanTile* Tile = TileOf(Screen.Feature);
		if (!Tile) return;
		const FBpPlanBay* Bay = BayOf(Tile);
		const TArray<const FBpProposal*> Open = OpenOn(Tile->id);
		TArray<TPair<FString, uint8>> Items;
		Items.Emplace(TEXT("FEATURE SHEET"), COutline);
		if (const FString* Kind = Link.FindFeatureKind(Tile->id)) Items.Emplace(BpWords::Kind(*Kind).ToUpper(), COutline);
		if (Open.Num() > 0) Items.Emplace(FString::Printf(TEXT("%d OPEN"), Open.Num()), CAmber);
		const FDeckRow Head = Chips(Items, Bay ? Bay->name.ToUpper() : FString());
		Add(Head);
		Add(Gap(12.f));
		const TArray<FString> Name = Wrap(Tile->name, STitle, ContentW, 2);
		for (const FString& Line : Name) Add(Text(Line, STitle));
		if (const FString* Summary = Link.FindFeatureSummary(Tile->id)) AddLines(Plain(*Summary), SLede, 1);
		// Health by lens: the plan's lenses in order, each the tile's reading (the lens rows the store has).
		TArray<FString> Cells;
		for (const FString& Lens : Plan.lenses)
		{
			if (const FString* Reading = Tile->health.Find(Lens)) Cells.Append({ BpWords::Lens(Lens), *Reading });
		}
		if (Cells.Num() > 0)
		{
			Add(Gap(12.f));
			Add(Text(TEXT("HEALTH BY LENS"), SHead), true);
			for (int32 At = 0; At < Cells.Num(); At += 4)
			{
				FDeckRow Row;
				Row.Kind = RHealth;
				for (int32 Each = At; Each < At + 4 && Each < Cells.Num(); ++Each) Row.Texts.Add(Cells[Each]);
				Row.HeightPx = 42.f;
				Add(Row);
			}
		}
		Add(Gap(12.f));
		Add(Text(TEXT("OPEN FINDINGS"), SHead), true);
		if (Open.Num() == 0) Add(Text(TEXT("None open"), SMeta));
		const int32 Show = Open.Num() > 2 ? 1 : Open.Num();
		for (int32 Index = 0; Index < Show; ++Index)
		{
			const FBpProposal& P = *Open[Index];
			const int32* Tier = State.Tiers.Find(P.id);
			const FString Line = FString::Printf(TEXT("%s%s  ·  %s"), Tier ? *FString::Printf(TEXT("T%d  ·  "), *Tier) : TEXT(""), *LensWord(P.lens), *P.title);
			Add(Text(CutToWidth(Line, SBody, ContentW), SBody));
		}
		if (Open.Num() > Show) Add(Text(FString::Printf(TEXT("+%d more on the decision screens"), Open.Num() - Show), SMeta));
		FString Scan;
		Add(Text(LastScan({ Tile->id }, Scan) ? TEXT("Last scan  ") + Scan : FString(TEXT("No scan has measured it yet")), SMeta));
		Continued = { Head, Gap(12.f), Text(CutToWidth(Tile->name + TEXT("  (continued)"), SLede, ContentW), SLede), Gap(6.f) };
	}
	else
	{
		const FBpPlanRoom* Room = FindRoom(DeckRoom);
		if (!Room) return;
		const FBpPlanWing* Wing = FindWing(Room->parentId);
		int32 BayCount = 0;
		TSet<FString> Features;
		for (const FBpPlanBay& Bay : Plan.bays)
		{
			if (Bay.parentId != Room->id) continue;
			++BayCount;
			for (const FBpPlanTile& Tile : Plan.tiles) if (Tile.parentId == Bay.id) Features.Add(Tile.id);
		}
		int32 Open = 0, ByTier[5] = { 0, 0, 0, 0, 0 };
		for (const FBpProposal& P : State.Scan.proposals)
		{
			if (P.status != TEXT("proposed") || !Features.Contains(P.feature)) continue;
			++Open;
			const int32* Tier = State.Tiers.Find(P.id);
			++ByTier[Tier ? FMath::Clamp(*Tier, 0, 3) : 4];
		}
		// The draft: the one the table last wrote to, else the newest.
		const FBpWave* Draft = nullptr;
		for (const FBpWave& Wave : State.Waves)
		{
			if (Wave.status != TEXT("draft")) continue;
			if (Wave.id == Link.GetFocusWaveId()) { Draft = &Wave; break; }
			if (!Draft || Wave.created_at > Draft->created_at) Draft = &Wave;
		}
		const FString Product = Link.GetProductName().IsEmpty() ? Link.GetProductSlug() : Link.GetProductName();
		TArray<TPair<FString, uint8>> Items;
		Items.Emplace(TEXT("ROOM SUMMARY"), COutline);
		if (Wing) Items.Emplace(TEXT("WING ") + Wing->letter, COutline);
		const FDeckRow Head = Chips(Items, Product.ToUpper());
		Add(Head);
		Add(Gap(12.f));
		AddLines(Room->name, STitle, 2);
		AddLines(FString::Printf(TEXT("%s%d %s"), Wing ? *(Wing->letter + TEXT("  ") + Wing->name + TEXT("  ·  ")) : TEXT(""), BayCount, BayCount == 1 ? TEXT("bay") : TEXT("bays")), SLede, 1);
		FDeckRow Figures;
		Figures.Kind = RFigures;
		int32 FromRoom = 0, Findings = 0;
		if (Draft)
		{
			for (const FBpWavePackage& Package : Draft->packages)
			{
				Findings += Package.ids.Num();
				for (const FString& Id : Package.ids)
				{
					const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Id](const FBpProposal& X) { return X.id == Id; });
					if (P && Features.Contains(P->feature)) ++FromRoom;
				}
			}
		}
		Figures.Texts = { FString::FromInt(Features.Num()), Features.Num() == 1 ? TEXT("FEATURE") : TEXT("FEATURES"),
			FString::FromInt(Open), Open == 1 ? TEXT("OPEN FINDING") : TEXT("OPEN FINDINGS"),
			Draft ? FString::FromInt(Draft->packages.Num()) : FString(TEXT("—")), Draft ? (Draft->packages.Num() == 1 ? TEXT("DRAFT PACKAGE") : TEXT("DRAFT PACKAGES")) : TEXT("NO DRAFT YET") };
		Figures.HeightPx = 120.f;
		Add(Gap(8.f));
		Add(Figures);
		if (Open > 0)
		{
			// The open findings by tier, as the ledger's chips (untriaged ones counted apart).
			TArray<TPair<FString, uint8>> Tiers;
			for (int32 Tier = 0; Tier < 4; ++Tier) if (ByTier[Tier] > 0) Tiers.Emplace(FString::Printf(TEXT("T%d  %s  ·  %d"), Tier, *TierWord(Tier), ByTier[Tier]), Tier <= PinTagTierMax ? CAmber : COutline);
			if (ByTier[4] > 0) Tiers.Emplace(FString::Printf(TEXT("UNTRIAGED  ·  %d"), ByTier[4]), COutline);
			Add(Chips(Tiers, FString()));
		}
		FString Scan;
		Add(Text(LastScan(Features, Scan) ? TEXT("Last scan  ") + Scan : FString(TEXT("No scan has measured this room yet")), SBody));
		Add(Gap(8.f));
		Add(Text(TEXT("DRAFT WAVE"), SHead), true);
		Add(Text(Draft ? CutToWidth(FString::Printf(TEXT("%s  ·  %d %s  ·  %d %s, %d from this room"), *Draft->name, Draft->packages.Num(), Draft->packages.Num() == 1 ? TEXT("package") : TEXT("packages"),
			Findings, Findings == 1 ? TEXT("finding") : TEXT("findings"), FromRoom), SBody, ContentW)
			: FString(TEXT("No draft yet  ·  approve a decision to start one")), SBody));
		// The queue's end offers the next room (WP3) on its button (DeckWidget), so the summary keeps one page.
		Continued = { Head, Gap(12.f) };
	}

	// Pages: the flow fills a page to ContentH; a heading stays with the line after it; a later page starts with the
	// screen's chips and a "continued" line. Nothing is ever drawn smaller to fit.
	Screen.Pages.Reset();
	Screen.Pages.AddDefaulted();
	float Used = 0.f;
	bool bBody = false;
	for (int32 Index = 0; Index < Flow.Num(); ++Index)
	{
		const FFlow& Each = Flow[Index];
		const float Need = Each.Row.HeightPx + (Each.bKeep && Flow.IsValidIndex(Index + 1) ? Flow[Index + 1].Row.HeightPx : 0.f);
		if (Used + Need > ContentH && bBody)
		{
			Screen.Pages.AddDefaulted();
			Used = 0.f;
			for (const FDeckRow& Row : Continued) { Screen.Pages.Last().Add(Row); Used += Row.HeightPx; }
			bBody = false;
			if (Each.Row.Kind == RGap) continue;
		}
		Screen.Pages.Last().Add(Each.Row);
		Used += Each.Row.HeightPx;
		bBody = true;
	}
	uint32 Stamp = GetTypeHash(Screen.Key);
	for (const TArray<FDeckRow>& Page : Screen.Pages)
	{
		for (const FDeckRow& Row : Page)
		{
			for (const FString& Each : Row.Texts) Stamp = HashCombine(Stamp, GetTypeHash(Each));
			for (const uint8 Each : Row.Styles) Stamp = HashCombine(Stamp, Each);
		}
		Stamp = HashCombine(Stamp, 0x5a5a);
	}
	Screen.Stamp = Stamp;
}

void ABpTable::RefreshDeck()
{
	if (DeckRoom.IsEmpty() || !SheetPlan.IsValid()) return;
	TArray<FString> Was;
	for (const FDeckScreen& Screen : DeckScreens) Was.Add(Screen.Key);
	BuildDeckQueue();
	TArray<FString> Now;
	for (const FDeckScreen& Screen : DeckScreens) Now.Add(Screen.Key);
	if (Was != Now || DeckSwapT >= 1.f)
	{
		// The cards as they stand, their content redrawn where it changed (ShowDeckAt keeps an unchanged one).
		ShowDeckAt(DeckAt, DeckPage, 0);
		return;
	}
	// Mid-swap with the same queue: only the content of a card whose screen changed.
	for (int32 Index = 0; Index < 4; ++Index)
	{
		FDeckCard& Each = DeckCardState[Index];
		const int32 Screen = DeckScreens.IndexOfByPredicate([&Each](const FDeckScreen& S) { return Each.Key.StartsWith(S.Key + TEXT("#")); });
		if (Screen == INDEX_NONE || DeckScreens[Screen].Stamp == Each.Stamp) continue;
		Each.Screen = Screen;
		Each.Stamp = DeckScreens[Screen].Stamp;
		Each.Page = FMath::Clamp(Each.Page, 0, DeckScreens[Screen].Pages.Num() - 1);
		DeckCards[Index]->SetSlateWidget(DeckWidget(Screen, Each.Page));
		DeckCards[Index]->RequestRedraw();
	}
}

// ---- Swapping -----------------------------------------------------------------------------------------------------------

void ABpTable::ShowDeckAt(int32 Screen, int32 Page, int32 Direction)
{
	if (!DeckScreens.IsValidIndex(Screen) || DeckCards.Num() < 4) return;
	const bool bPageTurn = Screen == DeckAt && Page != DeckPage;
	if (Direction != 0) bDeckTouched = true;
	FDeckCard Old[4];
	for (int32 Index = 0; Index < 4; ++Index) Old[Index] = DeckCardState[Index];
	DeckAt = Screen;
	DeckPage = FMath::Clamp(Page, 0, DeckScreens[Screen].Pages.Num() - 1);
	const auto KeyOf = [this](int32 S, int32 P) { return DeckScreens[S].Key + FString::Printf(TEXT("#%d"), P); };
	FDeckCard New[4];
	// The front and the two behind it (each at its first page); a card already showing that content moves from where it
	// stood, a new one comes from behind (forward) or slides in from the left (back).
	for (int32 K = 0; K < 3; ++K)
	{
		const int32 S = DeckAt + K;
		if (!DeckScreens.IsValidIndex(S)) continue;
		FDeckCard& Each = New[K];
		Each.Screen = S;
		Each.Page = K == 0 ? DeckPage : 0;
		Each.Key = KeyOf(S, Each.Page);
		Each.Stamp = DeckScreens[S].Stamp;
		Each.ToSlot = static_cast<float>(K);
		Each.ToSide = 0.f;
		const FDeckCard* Was = nullptr;
		for (int32 J = 0; J < 3; ++J) if (Old[J].Key == Each.Key) Was = &Old[J];
		if (Direction == 0) { Each.FromSlot = Each.ToSlot; Each.FromSide = 0.f; }
		else if (Was) { Each.FromSlot = Was->ToSlot; Each.FromSide = Was->ToSide; }
		else if (Direction > 0) { Each.FromSlot = bPageTurn && K == 0 ? 0.f : K + 1.f; Each.FromSide = bPageTurn && K == 0 ? 1.f : 0.f; }
		else { Each.FromSlot = K == 0 ? 0.f : K + 1.f; Each.FromSide = K == 0 ? -1.f : 0.f; }
	}
	// The one that leaves: the old front sliding off (left going forward, right going back), else the old last one
	// going behind.
	if (Direction != 0)
	{
		const auto Kept = [&New](const FString& Key) { for (const FDeckCard& Each : New) if (!Each.Key.IsEmpty() && Each.Key == Key) return true; return false; };
		if (!Old[0].Key.IsEmpty() && !Kept(Old[0].Key))
		{
			New[3] = Old[0];
			New[3].FromSlot = 0.f;
			New[3].FromSide = 0.f;
			New[3].ToSlot = 0.f;
			New[3].ToSide = Direction > 0 ? -1.f : 1.f;
		}
		else if (!Old[2].Key.IsEmpty() && !Kept(Old[2].Key))
		{
			New[3] = Old[2];
			New[3].FromSlot = 2.f;
			New[3].FromSide = 0.f;
			New[3].ToSlot = 3.f;
			New[3].ToSide = 0.f;
		}
	}
	for (int32 Index = 0; Index < 4; ++Index)
	{
		const FDeckCard& Each = New[Index];
		const bool bSame = Each.Key == DeckCardState[Index].Key && Each.Stamp == DeckCardState[Index].Stamp;
		DeckCardState[Index] = Each;
		if (Each.Key.IsEmpty() || bSame) continue;
		DeckCards[Index]->SetSlateWidget(DeckWidget(Each.Screen, Each.Page));
		DeckCards[Index]->RequestRedraw();
	}
	const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
	DeckSwapT = Direction == 0 || (Reduced && Reduced->GetInt() != 0) ? 1.f : 0.f;
	if (DeckSwapT < 1.f) SetActorTickInterval(0.f);
	// The spines: the next two screens' kind and title.
	for (int32 Place = 0; Place < 2 && Place < DeckSpines.Num(); ++Place)
	{
		const int32 S = DeckAt + 1 + Place;
		const FString Key = DeckScreens.IsValidIndex(S) ? DeckScreens[S].Key + FString::Printf(TEXT("#%u"), DeckScreens[S].Stamp) : FString();
		if (Key == DeckSpineKey[Place]) continue;
		DeckSpineKey[Place] = Key;
		if (Key.IsEmpty()) continue;
		DeckSpines[Place]->SetSlateWidget(SpineWidget(S));
		DeckSpines[Place]->RequestRedraw();
	}
	const FDeckScreen& Front = DeckScreens[DeckAt];
	DeckLitTile = Front.Feature;
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: front %s%s"), *GetDeckLine(), Direction > 0 ? TEXT(" (forward)") : Direction < 0 ? TEXT(" (back)") : TEXT(""));
	ApplyDeckPoses();
	ApplyDeckLight();
}

void ABpTable::ApplyDeckPoses()
{
	if (DeckCards.Num() < 4) return;
	const float Room = DeckRoom.IsEmpty() || CVarDeck.GetValueOnGameThread() == 0 ? 0.f : DeckEase(RoomFade);
	const float T = DeckEase(DeckSwapT);
	for (int32 Index = 0; Index < 4; ++Index)
	{
		UWidgetComponent* Screen = DeckCards[Index];
		const FDeckCard& Each = DeckCardState[Index];
		const bool bOut = Index == 3 && DeckSwapT >= 1.f;
		const float Slot = FMath::Lerp(Each.FromSlot, Each.ToSlot, T), Side = FMath::Lerp(Each.FromSide, Each.ToSide, T);
		// A whole screen shows only in front (FAI): one sliding to or from the spines' place fades there.
		float Alpha = 1.f - FMath::Min(Slot, 1.f);
		Alpha *= 1.f - FMath::Min(FMath::Abs(Side), 1.f);
		Alpha *= Room;
		const bool bShow = !Each.Key.IsEmpty() && !bOut && Alpha > 0.01f;
		if (Screen->IsVisible() != bShow) Screen->SetVisibility(bShow);
		// Back at its resting place once nothing shows it (level_check compares every widget's place with L0's).
		Screen->SetRelativeTransform(bShow ? DeckPose(Slot, Side) : DeckPose(Index < 3 ? static_cast<float>(Index) : 0.f, 0.f));
		if (!bShow) continue;
		// The glass under 1 (the card's FO rule: the bloom threshold); the paper as the card's.
		const bool bPaper = DeckScreens.IsValidIndex(Each.Screen) && DeckScreens[Each.Screen].Kind == KSheet;
		const float Tint = bPaper ? 0.82f : 0.9f;
		Screen->SetTintColorAndOpacity(FLinearColor(Tint, Tint, Tint, Alpha));
		// The front draws over the ones behind it.
		Screen->SetTranslucentSortPriority(12 - FMath::RoundToInt(Slot * 2.f));
	}
	ApplySpines(Room);
}

void ABpTable::ApplySpines(float Room)
{
	for (int32 Place = 0; Place < DeckSpines.Num(); ++Place)
	{
		UWidgetComponent* Spine = DeckSpines[Place];
		const int32 S = DeckAt + 1 + Place;
		const float Alpha = (Place == 0 ? DeckBackAlpha1 : DeckBackAlpha2) * Room;
		const bool bShow = !DeckRoom.IsEmpty() && DeckScreens.IsValidIndex(S) && !DeckSpineKey[Place].IsEmpty() && Alpha > 0.01f;
		if (Spine->IsVisible() != bShow) Spine->SetVisibility(bShow);
		Spine->SetRelativeTransform(SpinePose(Place + 1));
		if (!bShow) continue;
		const float Tint = DeckScreens[S].Kind == KSheet ? 0.82f : 0.9f;
		Spine->SetTintColorAndOpacity(FLinearColor(Tint, Tint, Tint, Alpha));
		Spine->SetTranslucentSortPriority(9 - Place);
	}
}

void ABpTable::DeckNext()
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused next, not in room mode"));
		return;
	}
	if (DeckPage + 1 < DeckScreens[DeckAt].Pages.Num()) ShowDeckAt(DeckAt, DeckPage + 1, 1);
	else if (DeckAt + 1 < DeckScreens.Num()) ShowDeckAt(DeckAt + 1, 0, 1);
	else UE_LOG(LogBpTable, Log, TEXT("BpDeck: next refused, the queue's end (%s)"), *GetDeckLine());
}

void ABpTable::DeckPrev()
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused prev, not in room mode"));
		return;
	}
	if (DeckPage > 0) ShowDeckAt(DeckAt, DeckPage - 1, -1);
	else if (DeckAt > 0) ShowDeckAt(DeckAt - 1, 0, -1);
	else UE_LOG(LogBpTable, Log, TEXT("BpDeck: prev refused, the queue's start (%s)"), *GetDeckLine());
}

bool ABpTable::DeckShow(int32 Place)
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(Place - 1))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused show %d (%d screens)"), Place, DeckScreens.Num());
		return false;
	}
	if (Place - 1 != DeckAt || DeckPage != 0) ShowDeckAt(Place - 1, 0, Place - 1 >= DeckAt ? 1 : -1);
	return true;
}

bool ABpTable::DeckFocus(const FString& FeatureId)
{
	// The queue's order puts a feature's most urgent decision first, then its sheet.
	const int32 Found = DeckScreens.IndexOfByPredicate([&FeatureId](const FDeckScreen& S) { return S.Feature == FeatureId; });
	if (DeckRoom.IsEmpty() || Found == INDEX_NONE)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused focus %s (not a feature of this room's queue)"), *FeatureId);
		return false;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: focus %s -> screen %d"), *FeatureId, Found + 1);
	if (Found != DeckAt || DeckPage != 0) ShowDeckAt(Found, 0, Found >= DeckAt ? 1 : -1);
	return true;
}

void ABpTable::DeckApprove()
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt) || DeckScreens[DeckAt].Kind != KDecision)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused approve, the front screen is no decision (%s)"), *GetDeckLine());
		return;
	}
	const FString Id = DeckScreens[DeckAt].Proposal;
	// The guard (as FAD's for scans): Approve only ever writes a draft; BpLink's SendWave refuses a dispatch route.
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve %s -> %s's draft wave (compose or PATCH; the table never dispatches a wave, on any product)"), *Id, *FBpLinkModule::Get().GetProductSlug());
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().AddToDraft(Id, [Self, Id](bool bOk, const FString& Wave, const FString& Note)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve %s %s"), *Id, bOk ? *FString::Printf(TEXT("in draft %s"), *Wave) : TEXT("not written"));
		if (!bOk || !Self.IsValid()) return;
		Self->DeckInDraft.Add(Id);
		Self->RefreshDeck();
	});
	// Resolving advances: the next screen.
	if (DeckAt + 1 < DeckScreens.Num()) ShowDeckAt(DeckAt + 1, 0, 1);
}

void ABpTable::DeckDecline()
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt) || DeckScreens[DeckAt].Kind != KDecision)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused decline, the front screen is no decision (%s)"), *GetDeckLine());
		return;
	}
	const FString Id = DeckScreens[DeckAt].Proposal;
	if (DeckRepeat(DeckAt))
	{
		// A repeat of a declined idea (F8): declined in the store, as the table's card does; the queue moves on when the
		// server has taken it (a refusal leaves the screen where it is).
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: decline %s as a repeat -> the store"), *Id);
		TWeakObjectPtr<ABpTable> Self(this);
		FBpLinkModule::Get().DeclineRepeat(Id, [Self, Id](int32 Status, const FString& Body)
		{
			ABpTable* T = Self.Get();
			if (!T) return;
			if (Status != 200)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpDeck: decline %s not written (HTTP %d) %.200s"), *Id, Status, *Body);
				return;
			}
			UE_LOG(LogBpTable, Log, TEXT("BpDeck: declined %s in the store as a repeat"), *Id);
			T->DeckDeclined.Add(Id);
			T->CardDeclined.Add(Id);
			T->BuildDeckQueue();
			T->ShowDeckAt(T->DeckAt, 0, 1);
		});
		return;
	}
	DeckDeclined.Add(Id);
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: decline %s: off this session's queue (memory only; the store is not written: it repeats no declined idea)"), *Id);
	// The queue without it; the screen that was next comes forward.
	BuildDeckQueue();
	ShowDeckAt(DeckAt, 0, 1);
}

const FBpDecisionBrief* ABpTable::DeckBrief(const FString& ProposalId) const
{
	return FBpLinkModule::Get().FindBrief(ProposalId);
}

bool ABpTable::DeckRepeat(int32 ScreenIndex) const
{
	if (!DeckScreens.IsValidIndex(ScreenIndex) || DeckScreens[ScreenIndex].Kind != KDecision) return false;
	const FBpDecisionBrief* Brief = DeckBrief(DeckScreens[ScreenIndex].Proposal);
	return Brief && FBpLinkModule::IsRepeat(*Brief);
}

void ABpTable::DeckTap(const FString& Id)
{
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: tap %s"), *Id);
	if (Id == TEXT("deck:next")) DeckNext();
	else if (Id == TEXT("deck:prev")) DeckPrev();
	else if (Id == TEXT("deck:approve")) DeckApprove();
	else if (Id == TEXT("deck:decline")) DeckDecline();
	else if (Id == TEXT("deck:nextroom")) DeckNextRoom();
	else if (Id.StartsWith(TEXT("feature:"))) DeckFocus(Id.Mid(8));
}

void ABpTable::DeckNextRoom()
{
	FString Why;
	const FString Next = NextRoom(Why);
	const bool bEnd = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KSummary;
	if (DeckRoom.IsEmpty() || !bEnd || Next.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused next room (%s)"), DeckRoom.IsEmpty() ? TEXT("not in room mode") : !bEnd ? TEXT("not at the queue's end") : TEXT("no other room"));
		return;
	}
	SwitchRoom(Next, TEXT("queue"));
}

FVector ABpTable::GetDeckFrontWorld() const
{
	return GetActorTransform().TransformPosition(DeckPose(0.f, 0.f).GetLocation());
}

FString ABpTable::GetDeckLine() const
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt)) return FString();
	const FDeckScreen& Screen = DeckScreens[DeckAt];
	const TCHAR* Kind = Screen.Kind == KDecision ? TEXT("decision") : Screen.Kind == KSheet ? TEXT("sheet") : TEXT("summary");
	return FString::Printf(TEXT("%d/%d %s %s p%d/%d"), DeckAt + 1, DeckScreens.Num(), Kind, Screen.Kind == KDecision ? *Screen.Proposal : Screen.Kind == KSheet ? *Screen.Feature : *DeckRoom,
		DeckPage + 1, Screen.Pages.Num());
}

// ---- The map's lit feature, and the capture hand ------------------------------------------------------------------------

void ABpTable::ApplyDeckLight()
{
	if (!DeckLight) return;
	const FRoomSlot* Slot = DeckLitTile.IsEmpty() || !SheetPlan.IsValid() ? nullptr : RoomSlots.FindByPredicate([this](const FRoomSlot& S)
	{
		return SheetPlan->tiles.IsValidIndex(S.Tile) && SheetPlan->tiles[S.Tile].id == DeckLitTile;
	});
	// The map's fade (ApplyRoomVisuals'): the glyphs keep fading with it after the deck has gone (an exit).
	const float E = DeckEase(RoomFade);
	if (DeckRoom.IsEmpty()) Slot = nullptr;
	if (!Slot || E <= 0.f)
	{
		if (DeckLight->GetInstanceCount() > 0) DeckLight->ClearInstances();
	}
	else
	{
		// The slot's cell, a little inside it, as a low lit box in the map walls' glass (paper u along +Y, v along -X).
		const FBox2D Box = Slot->Box.ExpandBy(-0.35);
		const FVector Size(Box.GetSize().Y, Box.GetSize().X, DeckLightCm);
		const FTransform Place(FQuat::Identity, PaperCmToLocal(Box.GetCenter(), DeckLightCm * 0.5f), Size / 100.0);
		if (DeckLight->GetInstanceCount() == 0) DeckLight->AddInstance(Place, false);
		else DeckLight->UpdateInstanceTransform(0, Place, false, false, true);
		const TArray<float> Data = { static_cast<float>(Size.X), static_cast<float>(Size.Y), static_cast<float>(Size.Z), DeckLightShow * E, 0.35f };
		DeckLight->SetCustomData(0, Data, true);
		DeckLight->SetRelativeTransform(WingGroupTransform(0.f));
	}
	// Every glyph at the map's fade, the lit one brighter.
	for (UInstancedStaticMeshComponent* Glyph : RoomGlyphs)
	{
		if (!Glyph) continue;
		const int32 Batch = RoomGlyphs.IndexOfByKey(Glyph);
		const FString& Kind = RoomGlyphKinds.IsValidIndex(Batch) ? RoomGlyphKinds[Batch] : FString();
		for (int32 Index = 0; Index < Glyph->GetInstanceCount(); ++Index)
		{
			const bool bLit = Slot && Slot->Kind == Kind && Slot->GlyphInstance == Index;
			Glyph->SetCustomDataValue(Index, 0, E * RoomGlyphShow * (bLit ? DeckLitGlyphShow : 1.f), false);
		}
		Glyph->MarkRenderStateDirty();
	}
	// The capture's posed right hand (FAH, WP1's review: it lay over the feature names). Aimed at the lit glyph it lay over
	// every name right of it, and at a far-left one across the whole map (captures b1, c2), so in room mode it points at
	// the key plan's current room, near-right, where nothing but the key plan's other cells lies under it.
	const FKeyCell* Key = KeyCells.FindByPredicate([this](const FKeyCell& Cell) { return Cell.Room == ShownRoomMode; });
	if (Key && !DeckRoom.IsEmpty() && DeckAimedTile != ShownRoomMode)
	{
		DeckAimedTile = ShownRoomMode;
		AimCaptureTip(WingGroupTransform(0.f).TransformPosition(PaperCmToLocal(Key->PaperCm.GetCenter(), 0.f)));
	}
}

// ---- The hands' way in --------------------------------------------------------------------------------------------------

bool ABpTable::DeckHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (DeckRoom.IsEmpty() || DeckCards.Num() < 4 || !DeckCards[0]->IsVisible()) return false;
	const UWidgetComponent* Front = DeckCards[0];
	const FTransform& T = Front->GetComponentTransform();
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (FMath::IsNearlyZero(Denom)) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	// UWidgetComponent's own mapping (GetLocalHitLocation): widget x = -local Y, y = -local Z, from its pivot, in draw px.
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const float Scale = DeckLayoutPxPerCm / DeckPxPerCm;
	const FVector2f Px(static_cast<float>(-Local.Y * Scale + LW * 0.5f), static_cast<float>(-Local.Z * Scale + LH * 0.5f));
	if (Px.X < 0.f || Px.Y < 0.f || Px.X > LW || Px.Y > LH) return false;
	const bool bDecision = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision;
	const bool bEnd = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KSummary;
	FString Why;
	if (bEnd && NextRoomBox.IsInside(Px) && !NextRoom(Why).IsEmpty()) OutId = TEXT("deck:nextroom");
	else if (bDecision && DeckRepeat(DeckAt) && RepeatDeclineBox.IsInside(Px)) OutId = TEXT("deck:decline");
	else if (bDecision && DeckRepeat(DeckAt) && RepeatApproveBox.IsInside(Px)) OutId = TEXT("deck:approve");
	else if (bDecision && !DeckRepeat(DeckAt) && ApproveBox.IsInside(Px)) OutId = TEXT("deck:approve");
	else if (bDecision && !DeckRepeat(DeckAt) && DeclineBox.IsInside(Px)) OutId = TEXT("deck:decline");
	else if (PrevBox.IsInside(Px)) OutId = TEXT("deck:prev");
	else if (NextBox.IsInside(Px)) OutId = TEXT("deck:next");
	else OutId = TEXT("deck:screen");
	return true;
}

bool ABpTable::DeckAim(const FString& Id, FVector& OutWorld) const
{
	if (DeckRoom.IsEmpty() || DeckCards.Num() < 4) return false;
	const bool bRepeat = DeckRepeat(DeckAt);
	const FBox2f* Box = Id == TEXT("deck:approve") ? (bRepeat ? &RepeatApproveBox : &ApproveBox) : Id == TEXT("deck:decline") ? (bRepeat ? &RepeatDeclineBox : &DeclineBox) : Id == TEXT("deck:prev") ? &PrevBox : Id == TEXT("deck:next") ? &NextBox
		: Id == TEXT("deck:nextroom") ? &NextRoomBox : nullptr;
	if (!Box) return false;
	const FVector2f Centre = Box->GetCenter();
	const float Scale = DeckPxPerCm / DeckLayoutPxPerCm;
	// The front's resting place (DeckPose 0), so a hand aims where the screen settles.
	const FTransform T = DeckPose(0.f, 0.f) * GetActorTransform();
	OutWorld = T.TransformPosition(FVector(0.0, -(Centre.X - LW * 0.5f) * Scale, -(Centre.Y - LH * 0.5f) * Scale));
	return true;
}

// ---- A screen's widget --------------------------------------------------------------------------------------------------

TSharedRef<SWidget> ABpTable::DeckWidget(int32 ScreenIndex, int32 PageIndex) const
{
	const FDeckScreen& Screen = DeckScreens[ScreenIndex];
	const bool bPaper = Screen.Kind == KSheet;
	const bool bDecision = Screen.Kind == KDecision;
	// Opaque at the core (FAH: at 0.93 the city's lit windows, many times brighter than the panel, and the screens behind
	// read through it); the glass is its edge, its glow and its sheen.
	static const FSlateRoundedBoxBrush GlassPanel(GlassDark, 22.f, CyanEdge.CopyWithNewOpacity(0.95f), 4.f);
	static const FSlateRoundedBoxBrush GlassGlow(Cyan.CopyWithNewOpacity(0.14f), 30.f);
	static const FSlateRoundedBoxBrush GlassSheen(FLinearColor(1.f, 1.f, 1.f, 0.045f), 12.f);
	static const FSlateRoundedBoxBrush PaperPanel(PaperTone, 18.f, PaperEdge.CopyWithNewOpacity(0.95f), 4.f);
	static const FSlateRoundedBoxBrush PaperGlowBrush(PaperGlow.CopyWithNewOpacity(0.16f), 30.f);
	static const FSlateRoundedBoxBrush ApproveBrush(Amber, 12.f);
	static const FSlateRoundedBoxBrush DeclineBrush(FLinearColor::Transparent, 12.f, CyanEdge.CopyWithNewOpacity(0.9f), 3.f);
	static const FSlateRoundedBoxBrush TabGlass(Cyan.CopyWithNewOpacity(0.10f), 12.f, Cyan.CopyWithNewOpacity(0.7f), 2.5f);
	static const FSlateRoundedBoxBrush TabPaper(Ink.CopyWithNewOpacity(0.05f), 12.f, Ink.CopyWithNewOpacity(0.55f), 2.5f);
	static const FSlateRoundedBoxBrush TabOff(FLinearColor::Transparent, 12.f, Cyan.CopyWithNewOpacity(0.18f), 2.f);
	static const FSlateRoundedBoxBrush TabOffPaper(FLinearColor::Transparent, 12.f, Ink.CopyWithNewOpacity(0.18f), 2.f);

	const auto Label = [](const FString& Text, uint8 Style, const FLinearColor& Color)
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(DeckFont(Style)).ColorAndOpacity(FSlateColor(Color));
	};
	const auto Chip = [&Label, bPaper](const FString& Text, uint8 Look)
	{
		return SNew(SBorder).BorderImage(ChipBrush(Look, bPaper)).Padding(FMargin(14.f, 7.f)).VAlign(VAlign_Center)
			[
				Label(Text, SKicker, ChipText(Look, bPaper))
			];
	};

	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	const TArray<FDeckRow>& Page = Screen.Pages.IsValidIndex(PageIndex) ? Screen.Pages[PageIndex] : TArray<FDeckRow>();
	for (const FDeckRow& Row : Page)
	{
		TSharedPtr<SWidget> Content;
		switch (Row.Kind)
		{
		case RText:
			// row style 1: a bullet's indent; 2: the brief's quoted decline, in amber
			Content = SNew(SBox).VAlign(VAlign_Center).Padding(FMargin(Row.Styles.Contains(1) ? BulletIndentPx : 0.f, 0.f, 0.f, 0.f))
				[
					Label(Row.Texts[0], Row.Style, Row.Styles.Contains(2) ? Amber : TextColor(Row.Style, bPaper))
				];
			break;
		case RChips:
		{
			TSharedRef<SHorizontalBox> Line = SNew(SHorizontalBox);
			for (int32 Index = 0; Index < Row.Texts.Num(); ++Index)
			{
				if (Row.Styles[Index] == CRight)
				{
					Line->AddSlot().FillWidth(1.f)[SNew(SBox)];
					Line->AddSlot().AutoWidth().VAlign(VAlign_Center)[Label(Row.Texts[Index], SKicker, TextColor(SKicker, bPaper))];
					continue;
				}
				Line->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 12.f, 0.f)[Chip(Row.Texts[Index], Row.Styles[Index])];
			}
			Content = Line;
			break;
		}
		case RMove:
		{
			// metric, before, after (or the change), unit, before's word, after's word, the change beside an after.
			const FLinearColor Big = bPaper ? Ink : FLinearColor::White;
			const FLinearColor Small = TextColor(SMeta, bPaper);
			const auto Figure = [&](const FString& Value, const FString& Word, const FLinearColor& Color)
			{
				return SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[Label(Value, SBig, Color)]
					+ SVerticalBox::Slot().AutoHeight()[Label(Word, SMeta, Small)];
			};
			TSharedRef<SHorizontalBox> Line = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 30.f, 0.f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[Label(TEXT("METRIC"), SHead, TextColor(SHead, bPaper))]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)[Label(Row.Texts[0], SLede, TextColor(SLede, bPaper))]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Figure(Row.Texts[1], Row.Texts[4], Big)];
			if (!Row.Texts[2].IsEmpty())
			{
				// The arrow in Slate's default face (Barlow has none).
				Line->AddSlot().AutoWidth().VAlign(VAlign_Top).Padding(26.f, 4.f)
				[
					SNew(STextBlock).Text(FText::FromString(TEXT("→"))).Font(FCoreStyle::GetDefaultFontStyle("Bold", 30)).ColorAndOpacity(FSlateColor(bPaper ? Ink.CopyWithNewOpacity(0.6f) : Cyan))
				];
				Line->AddSlot().AutoWidth().VAlign(VAlign_Center)[Figure(Row.Texts[2], Row.Texts[5], bPaper ? Ink : Amber)];
			}
			if (!Row.Texts[3].IsEmpty()) Line->AddSlot().AutoWidth().VAlign(VAlign_Top).Padding(18.f, 22.f, 0.f, 0.f)[Label(Row.Texts[3], SLede, TextColor(SLede, bPaper))];
			if (!Row.Texts[6].IsEmpty()) Line->AddSlot().AutoWidth().VAlign(VAlign_Top).Padding(22.f, 18.f, 0.f, 0.f)[Chip(Row.Texts[6], CAmber)];
			Content = Line;
			break;
		}
		case RHealth:
		{
			// Two lens cells across: the lens, then its reading's chip.
			TSharedRef<SHorizontalBox> Line = SNew(SHorizontalBox);
			for (int32 Index = 0; Index + 1 < Row.Texts.Num(); Index += 2)
			{
				Line->AddSlot().FillWidth(1.f).Padding(0.f, 0.f, 60.f, 0.f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[Label(Row.Texts[Index], SMeta, TextColor(SBody, bPaper))]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Label(ReadingWord(Row.Texts[Index + 1]), SKicker, ReadingInk(Row.Texts[Index + 1], bPaper))]
					];
			}
			for (int32 Pad = Row.Texts.Num() / 2; Pad < 2; ++Pad) Line->AddSlot().FillWidth(1.f).Padding(0.f, 0.f, 22.f, 0.f)[SNew(SBox)];
			Content = Line;
			break;
		}
		case RFigures:
		{
			TSharedRef<SHorizontalBox> Line = SNew(SHorizontalBox);
			for (int32 Index = 0; Index + 1 < Row.Texts.Num(); Index += 2)
			{
				Line->AddSlot().FillWidth(1.f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()[Label(Row.Texts[Index], SBig, Index == 2 ? Amber : (bPaper ? Ink : FLinearColor::White))]
						+ SVerticalBox::Slot().AutoHeight()[Label(Row.Texts[Index + 1], SHead, TextColor(SHead, bPaper))]
					];
			}
			Content = Line;
			break;
		}
		default:
			Content = SNew(SBox);
			break;
		}
		Column->AddSlot().AutoHeight()[SNew(SBox).HeightOverride(Row.HeightPx)[Content.ToSharedRef()]];
	}

	// The controls: Approve and Decline (decisions), the tabs and the counter, at fixed places (DeckHit's boxes).
	const FLinearColor ControlInk = bPaper ? Ink : FLinearColor::White;
	const bool bPrev = DeckAt > 0 || PageIndex > 0, bNext = DeckAt + 1 < DeckScreens.Num() || PageIndex + 1 < Screen.Pages.Num();
	const auto Button = [&Label](const FSlateBrush* Brush, const FString& Mark, const FString& Text, const FLinearColor& Color)
	{
		return SNew(SBorder).BorderImage(Brush).HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, Mark.IsEmpty() ? 0.f : 12.f, 0.f)
				[
					SNew(STextBlock).Text(FText::FromString(Mark)).Font(FCoreStyle::GetDefaultFontStyle("Bold", 22)).ColorAndOpacity(FSlateColor(Color))
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Label(Text, SControl, Color)]
			];
	};
	const FString Count = FString::Printf(TEXT("%d / %d"), DeckAt + 1, DeckScreens.Num());
	TSharedRef<SVerticalBox> Counter = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[Label(Count, SControl, ControlInk)];
	if (Screen.Pages.Num() > 1) Counter->AddSlot().AutoHeight().HAlign(HAlign_Center).Padding(0.f, 4.f, 0.f, 0.f)[Label(FString::Printf(TEXT("PAGE %d OF %d"), PageIndex + 1, Screen.Pages.Num()), SMeta, TextColor(SMeta, bPaper))];
	TSharedRef<SCanvas> Bar = SNew(SCanvas);
	const auto Place = [&Bar](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Bar->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	Place(PrevBox, Button(bPrev ? (bPaper ? &TabPaper : &TabGlass) : (bPaper ? &TabOffPaper : &TabOff), FString(), TEXT("‹  PREV"), bPrev ? ControlInk : ControlInk.CopyWithNewOpacity(0.3f)));
	Place(CountBox, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[Counter]);
	Place(NextBox, Button(bNext ? (bPaper ? &TabPaper : &TabGlass) : (bPaper ? &TabOffPaper : &TabOff), FString(), TEXT("NEXT  ›"), bNext ? ControlInk : ControlInk.CopyWithNewOpacity(0.3f)));
	if (bDecision && DeckRepeat(ScreenIndex))
	{
		Place(RepeatDeclineBox, Button(&ApproveBrush, TEXT("✕"), TEXT("DECLINE · REPEAT"), Ink));
		Place(RepeatApproveBox, Button(&DeclineBrush, TEXT("✓"), TEXT("APPROVE"), FLinearColor::White));
	}
	else if (bDecision)
	{
		Place(ApproveBox, Button(&ApproveBrush, TEXT("✓"), TEXT("APPROVE"), Ink));
		Place(DeclineBox, Button(&DeclineBrush, TEXT("✕"), TEXT("DECLINE"), FLinearColor::White));
	}
	FString Why;
	const FBpPlanRoom* Next = Screen.Kind == KSummary ? FindRoom(NextRoom(Why)) : nullptr;
	if (Next)
	{
		// The queue's end (WP3): the next room by urgency, its name and why on the button.
		Place(NextRoomBox, SNew(SBorder).BorderImage(&ApproveBrush).Padding(FMargin(22.f, 0.f)).VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()[Label(TEXT("NEXT ROOM  ›"), SControl, Ink)]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 2.f, 0.f, 0.f)[Label(CutToWidth(FString::Printf(TEXT("%s  ·  %s"), *Next->name, *Why), SMeta, NextRoomBox.GetSize().X - 44.f), SMeta, Ink)]
			]);
	}

	return SNew(SDPIScaler).DPIScale(DeckPxPerCm / DeckLayoutPxPerCm)
		[
			SNew(SBox).WidthOverride(LW).HeightOverride(LH)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(SBorder).BorderImage(bPaper ? &PaperGlowBrush : &GlassGlow)]
				+ SOverlay::Slot().Padding(8.f)[SNew(SBorder).BorderImage(bPaper ? &PaperPanel : &GlassPanel)]
				// The glass's pale sheen along its top edge (the wrist panel's).
				+ SOverlay::Slot().VAlign(VAlign_Top).Padding(FMargin(26.f, 12.f, 26.f, 0.f))[SNew(SBox).HeightOverride(bPaper ? 0.f : 18.f)[SNew(SBorder).BorderImage(&GlassSheen)]]
				+ SOverlay::Slot().Padding(FMargin(PadX, PadTop, PadX, LH - BarY + BarGap))[Column]
				+ SOverlay::Slot()[Bar]
			]
		];
}

TSharedRef<SWidget> ABpTable::SpineWidget(int32 ScreenIndex) const
{
	// A screen's edge (FAI): its surface, and along it, reading up, its kind and its title, cut to the spine's length.
	const FDeckScreen& Screen = DeckScreens[ScreenIndex];
	const bool bPaper = Screen.Kind == KSheet;
	static const FSlateRoundedBoxBrush GlassSpine(GlassDark, 14.f, CyanEdge.CopyWithNewOpacity(0.8f), 3.f);
	static const FSlateRoundedBoxBrush PaperSpine(PaperTone, 12.f, PaperEdge.CopyWithNewOpacity(0.9f), 3.f);
	const FString Kind = Screen.Kind == KDecision ? TEXT("DECISION") : bPaper ? TEXT("FEATURE SHEET") : TEXT("ROOM SUMMARY");
	FString Title;
	if (Screen.Kind == KDecision)
	{
		const FBpProposal* P = FBpLinkModule::Get().GetScanState().Scan.proposals.FindByPredicate([&Screen](const FBpProposal& X) { return X.id == Screen.Proposal; });
		Title = P ? P->title : Screen.Proposal;
	}
	else if (bPaper)
	{
		const FBpPlanTile* Tile = SheetPlan.IsValid() ? SheetPlan->tiles.FindByPredicate([&Screen](const FBpPlanTile& T) { return T.id == Screen.Feature; }) : nullptr;
		Title = Tile ? Tile->name : Screen.Feature;
	}
	else
	{
		const FBpPlanRoom* Room = FindRoom(DeckRoom);
		Title = Room ? Room->name : DeckRoom;
	}
	const float Long = SH - 60.f, Thick = SW - 24.f;
	const TSharedRef<SWidget> Along = SNew(SBox).WidthOverride(Long).HeightOverride(Thick).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Kind)).Font(DeckFont(SKicker)).ColorAndOpacity(FSlateColor(TextColor(SKicker, bPaper)))]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(CutToWidth(Title, SLede, Long))).Font(DeckFont(SLede)).ColorAndOpacity(FSlateColor(TextColor(SBody, bPaper)))]
		];
	// Turned a quarter anticlockwise, so it reads from the bottom up, as a book's spine.
	Along->SetRenderTransform(FSlateRenderTransform(FQuat2D(-UE_HALF_PI)));
	Along->SetRenderTransformPivot(FVector2D(0.5, 0.5));
	return SNew(SDPIScaler).DPIScale(DeckPxPerCm / DeckLayoutPxPerCm)
		[
			SNew(SBox).WidthOverride(SW).HeightOverride(SH)
			[
				SNew(SOverlay)
				+ SOverlay::Slot().Padding(4.f)[SNew(SBorder).BorderImage(bPaper ? &PaperSpine : &GlassSpine)]
				+ SOverlay::Slot()
				[
					SNew(SCanvas)
					+ SCanvas::Slot().Position(FVector2D(SW * 0.5f, SH * 0.5f)).Size(FVector2D(Long, Thick)).HAlign(HAlign_Center).VAlign(VAlign_Center)[Along]
				]
			]
		];
}
