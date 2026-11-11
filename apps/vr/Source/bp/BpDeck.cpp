// The screen deck (spark vr-room-layers WP2; BpTable.h declares the API and the constants). In room mode a queue of
// readable screens stands in front of the seated person, one in focus and the next two peeking behind it as a deck: the
// room's open findings as decision screens (glass: dark, edge-lit, light type), most urgent first, then a feature sheet per
// feature in plan order (paper: warm off-white, dark ink, as the card's), then the room's summary. Next and previous tabs,
// a tap on a feature's glyph on the map, and resolving a decision swap them with a short slide; the view never moves.
// Approve approves the finding in the store (BpLink ApproveDecision, ROADMAP D12: the Morning Watch's Approve, no build
// queued) and puts it into the product's draft wave (compose or PATCH, never dispatch); Decline drops it from this
// session's queue. A decision screen carries the finding's decision brief (ROADMAP F1: BpLink FetchBrief, the
// lines the web's card shows, the quoted decline in amber); on a repeat of a declined idea (advice withdraw) DECLINE · REPEAT
// is the first, filled control, and it declines the finding in the store (BpLink DeclineRepeat, F8), as the table's card does. What a screen says is the plan's and the store's, read the way the web's Review item and
// feature page read them (blueprint-ui.md, "Chrome and the feature page"); a field the data lacks is left out.
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpPawn.h"
#include "BpProjector.h"
#include "BpSheet.h"
#include "BpType.h"
#include "BpWords.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture2D.h"
#include "EngineUtils.h"
#include "Widgets/Images/SImage.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Crc.h"
#include "Rendering/SlateRenderer.h"
#include "Schema/BpSchemaVocab.h"
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
	// Night two V4: APPROVE the widest (the stand-up's primary), the queue's PREV, count and NEXT quieter at the right.
	const FBox2f ApproveBox(FVector2f(PadX, BarY), FVector2f(PadX + 330.f, BarY + BarH));
	const FBox2f DeclineBox(FVector2f(PadX + 350.f, BarY), FVector2f(PadX + 600.f, BarY + BarH));
	const FBox2f PrevBox(FVector2f(LW - PadX - 480.f, BarY), FVector2f(LW - PadX - 330.f, BarY + BarH));
	const FBox2f CountBox(FVector2f(LW - PadX - 330.f, BarY), FVector2f(LW - PadX - 170.f, BarY + BarH));
	const FBox2f NextBox(FVector2f(LW - PadX - 170.f, BarY), FVector2f(LW - PadX, BarY + BarH));
	/** A repeat (F1, F8): DECLINE · REPEAT first and wider, APPROVE after it, before the tabs. */
	const FBox2f RepeatDeclineBox(FVector2f(PadX, BarY), FVector2f(PadX + 440.f, BarY + BarH));
	const FBox2f RepeatApproveBox(FVector2f(PadX + 460.f, BarY), FVector2f(PadX + 700.f, BarY + BarH));
	/** The summary's NEXT ROOM button at the queue's end (WP3), where a decision's Approve and Decline stand. */
	const FBox2f NextRoomBox(FVector2f(PadX, BarY), FVector2f(PadX + 680.f, BarY + BarH));
	/** With open decisions left in the room (D15), the summary's bar holds APPROVE ALL (n) first and NEXT ROOM narrower after it. */
	const FBox2f ApproveAllBox(FVector2f(PadX, BarY), FVector2f(PadX + 330.f, BarY + BarH));
	const FBox2f NextRoomNarrowBox(FVector2f(PadX + 350.f, BarY), FVector2f(PadX + 680.f, BarY + BarH));
	/** The route from a room to scanning it: a small pill on the top row between the chips and the id, on every screen of the room's deck (a
	 *  pinch opens the wrist's Scan tab, which the room in view scopes already). Only when a scan can be started here. */
	const FBox2f ScanBox(FVector2f(LW - PadX - 300.f, 26.f), FVector2f(LW - PadX, 80.f));
	bool DeckScanRoute() { const FBpLinkModule& L = FBpLinkModule::Get(); return L.HasPcLink() || L.HasSampleFocuses(); }

	// ---- Wave U3: a decision on the wall, on the console's own grid (BpConsole.cpp, BpStandup.cpp: 1280 x 720 layout px) --------
	// The header (HeadY), the sheet's frame (FrameY), the status line and the answers' row, as the stand-up's decision on the wall.
	constexpr float WPad = 40.f, WHeadY0 = 24.f, WHeadY1 = 94.f, WSubY = 100.f;
	constexpr float WStripY0 = 154.f, WStripY1 = 161.f, WFrameY0 = 170.f, WFrameY1 = 568.f, WInX = WPad + 26.f;
	constexpr float WStatusY0 = 572.f, WStatusY1 = 612.f, WBtnY0 = 618.f, WBtnY1 = 696.f;
	/** The answers' row: PREV and NEXT at the ends (the far sheet's 196 px pagers), APPROVE the primary and DECLINE between them
	 *  (a repeat: DECLINE · REPEAT first); SCAN THIS ROOM where the console's CLOSE stands. */
	void DeckWallBoxes(bool bRepeat, FBox2f& OutApprove, FBox2f& OutDecline, FBox2f& OutPrev, FBox2f& OutNext, FBox2f& OutScan)
	{
		OutPrev = FBox2f(FVector2f(WPad, WBtnY0 + 4.f), FVector2f(WPad + 196.f, WBtnY1 - 4.f));
		OutNext = FBox2f(FVector2f(LW - WPad - 196.f, WBtnY0 + 4.f), FVector2f(LW - WPad, WBtnY1 - 4.f));
		const float AW = bRepeat ? 240.f : 300.f, DW = bRepeat ? 340.f : 220.f, Gap = 16.f;
		const float X0 = WPad + 196.f + 16.f, X1 = LW - WPad - 196.f - 16.f;
		const float Start = X0 + FMath::Max(0.f, (X1 - X0 - AW - DW - Gap) * 0.5f);
		const FBox2f First(FVector2f(Start, WBtnY0), FVector2f(Start + (bRepeat ? DW : AW), WBtnY1));
		const FBox2f Second(FVector2f(First.Max.X + Gap, WBtnY0), FVector2f(First.Max.X + Gap + (bRepeat ? AW : DW), WBtnY1));
		OutApprove = bRepeat ? Second : First;
		OutDecline = bRepeat ? First : Second;
		OutScan = FBox2f(FVector2f(LW - WPad - 300.f, WHeadY0), FVector2f(LW - WPad, WHeadY1));
	}
	/** The answer a decision screen carries as it slides away (night two V4: the stand-up's stamp), by proposal; set only while
	 *  DeckApprove or DeckDecline draws the leaving screen. */
	TMap<FString, FString> GDeckStamp;
	/** bp.DeckSpines (night two V4): the next screens' spines, whose turned words could not be read from the seat; 0 hides them
	 *  (the default; the counter says where the queue stands), 1 brings them back. */
	TAutoConsoleVariable<int32> CVarDeckSpines(TEXT("bp.DeckSpines"), 0, TEXT("The deck's spines (the next two screens' edges beside the front): 0 hidden (night two V4 default: the counter says where the queue stands), 1 shown."), ECVF_Default);
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
	const FLinearColor GlassDark(FColor(0x12, 0x3A, 0x72));
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
		static const FSlateRoundedBoxBrush OutlineGlass(FLinearColor::Transparent, 4.f, Cyan.CopyWithNewOpacity(0.75f), 2.f);
		static const FSlateRoundedBoxBrush OutlinePaper(FLinearColor::Transparent, 4.f, Ink.CopyWithNewOpacity(0.6f), 2.f);
		static const FSlateRoundedBoxBrush AmberFill(Amber, 4.f);
		static const FSlateRoundedBoxBrush CyanFill(Cyan.CopyWithNewOpacity(0.9f), 4.f);
		static const FSlateRoundedBoxBrush CyanFillPaper(FLinearColor(FColor(0x0B, 0x2A, 0x6B)), 4.f);
		static const FSlateRoundedBoxBrush GoodFill(GoodInk, 4.f);
		static const FSlateRoundedBoxBrush WatchFill(FLinearColor(FColor(0xE0, 0x9A, 0x2A)), 4.f);
		static const FSlateRoundedBoxBrush BadFill(BadInk, 4.f);
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
	/** Wave 4: every screen on the blueprint sheet (the web's language); 1 brings back the warm paper feature sheets. */
	TAutoConsoleVariable<int32> CVarDeckPaper(TEXT("bp.DeckPaper"), 0, TEXT("Feature sheets on warm paper: 0 the blueprint sheet (wave 4, default), 1 the old paper."), ECVF_Default);
	/** The sheet's brightness on the deck (under the bloom threshold; was 0.9 on the glass). */
	TAutoConsoleVariable<float> CVarDeckTint(TEXT("bp.DeckTint"), 0.95f, TEXT("The deck screens' brightness, 0.5 to 1.2."), ECVF_Default);

	bool PaperScreen(uint8 Kind) { return Kind == KSheet && CVarDeckPaper.GetValueOnGameThread() != 0; }

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
	FAutoConsoleCommandWithWorldAndArgs CmdDeckApproveAll(TEXT("BpDeck.ApproveAll"), TEXT("BpDeck.ApproveAll: the room's open decisions (a repeat of a declined idea excepted) approved in the store with one write (D15); only at the queue's end."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World) { WithDeckTables(World, TEXT("BpDeck.ApproveAll"), [](ABpTable& T) { T.DeckApproveAll(); }); }));
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
		DeckReleaseShot();
		DeckAimedTile.Reset();
		SyncDeckDrawSize();
		ApplyDeckPoses();
		ApplyDeckLight();
		ApplyDeckWallAims();
		return;
	}
	BuildDeckQueue();
	ShowDeckAt(0, 0, 0);
	// The lamp's answer named a finding in this room: it goes to the front as the room opens.
	if (!PendingDeckProposal.IsEmpty())
	{
		const FString Proposal = PendingDeckProposal, Feature = PendingDeckFeature;
		PendingDeckProposal.Reset();
		PendingDeckFeature.Reset();
		DeckFocusProposal(Proposal, Feature);
	}
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
		if (Proposal.status != TEXT("proposed") || !InRoom.Contains(Proposal.feature) || DeckDeclined.Contains(Proposal.id) || CardDecided.Contains(Proposal.id)) continue;
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
		// The top right is SCAN THIS ROOM's when a scan can start here (night two V4): the row stops short of it.
		const float MaxW = ContentW - (DeckScanRoute() ? 330.f : 0.f);
		if (Width() > MaxW || DeckScanRoute()) Right.Reset();
		for (TPair<FString, uint8>& Item : Items)
		{
			if (Width() <= MaxW) break;
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
			if (Proposal.status == TEXT("proposed") && Proposal.feature == Feature && !DeckDeclined.Contains(Proposal.id) && !CardDecided.Contains(Proposal.id)) Out.Add(&Proposal);
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
		// The ledger's mark, number and band colour (useLedger.ts riskBand), the word beside it where the ledger has a column header.
		if (P->risk > 0.0) Items.Emplace(FString::Printf(TEXT("%s %s RISK"), BpSheet::RiskMark(P->risk), *Number(P->risk)), P->risk >= 7.0 ? CBad : P->risk >= 4.0 ? CAmber : COutline);
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
		const bool bBriefLines = Brief && Brief->lines.Num() > 0;
		FString Where = Tile ? TEXT("On ") + Tile->name : TEXT("On ") + P->feature;
		if (Bay) Where += TEXT("  ·  ") + Bay->name;
		// with a brief its first line says where the change lands ("Touches <feature> in <bay>"), as on the table's card
		if (!bBriefLines) AddLines(Where, SLede, 2);
		// The decision brief (F1): its lines as the web's card shows them, the quoted decline in amber (row style 2).
		if (bBriefLines)
		{
			int32 DeclinedLine = INDEX_NONE;
			for (int32 Index = 0; Index < Brief->facts.Num(); ++Index) if (Brief->facts[Index].key == TEXT("declined")) DeclinedLine = Index;
			// no heading, no where line: the five lines fit the first page under the title (by capture: with them, the cost line
			// went to page 2)
			Add(Gap(10.f));
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
	if (Screen.Kind == KDecision)
	{
		// The flow's words still key the redraw (a brief or a draft landing changes the sheet); the sheet itself is one page.
		for (const TArray<FDeckRow>& Page : Screen.Pages) for (const FDeckRow& Row : Page) for (const FString& Each : Row.Texts) Stamp = HashCombine(Stamp, GetTypeHash(Each));
		Screen.Pages.SetNum(1);
	}
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

// ---- The front decision's screen (night two V7) ---------------------------------------------------------------------------

void ABpTable::DeckReleaseShot()
{
	++DeckShotGen;
	DeckShotFor.Reset();
	DeckShotBrush.Reset();
	bDeckShotLoading = bDeckShotSample = false;
	if (DeckShot)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: the screen released (%dx%d)"), DeckShot->GetSizeX(), DeckShot->GetSizeY());
		// Kept while a card that drew it can still be on its way out (the leaving card and one behind), then let go.
		DeckShotKept.Insert(DeckShot, 0);
		if (DeckShotKept.Num() > 2) DeckShotKept.SetNum(2);
		DeckShot = nullptr;
	}
}

void ABpTable::DeckLoadShot()
{
	const FString Proposal = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision ? DeckScreens[DeckAt].Proposal : FString();
	if (Proposal.IsEmpty() || Proposal == DeckShotFor) return;
	const FBpShot* Shot = ABpPawn::FindBeforeShot(Proposal);
	// Without a screen the card stays as it was: the one it held goes (one texture at a time).
	if (!Shot) { if (!DeckShotFor.IsEmpty()) DeckReleaseShot(); return; }
	DeckReleaseShot();
	DeckShotFor = Proposal;
	bDeckShotLoading = true;
	const uint32 Gen = DeckShotGen;
	TWeakObjectPtr<ABpTable> Self(this);
	ABpPawn::FetchBeforeShot(FBpLinkModule::Get().GetProductSlug(), Shot->path, [Self, Gen](UTexture2D* Texture, bool bSample)
	{
		ABpTable* T = Self.Get();
		if (!T || T->DeckShotGen != Gen) return;
		T->bDeckShotLoading = false;
		if (Texture)
		{
			T->DeckShot = Texture;
			T->bDeckShotSample = bSample;
			T->DeckShotBrush = MakeShared<FSlateBrush>();
			T->DeckShotBrush->SetResourceObject(Texture);
			T->DeckShotBrush->ImageSize = FVector2D(Texture->GetSizeX(), Texture->GetSizeY());
			T->DeckShotBrush->DrawAs = ESlateBrushDrawType::Image;
		}
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: the screen of %s %s"), *T->DeckShotFor, Texture ? *FString::Printf(TEXT("drawn at %dx%d%s"), Texture->GetSizeX(), Texture->GetSizeY(), bSample ? TEXT(", a sample screen") : TEXT("")) : TEXT("could not be read"));
		// The front card, drawn again where it still shows that decision.
		for (int32 Index = 0; Index < 3 && Index < T->DeckCards.Num(); ++Index)
		{
			const FDeckCard& Each = T->DeckCardState[Index];
			if (!T->DeckScreens.IsValidIndex(Each.Screen) || T->DeckScreens[Each.Screen].Proposal != T->DeckShotFor) continue;
			T->DeckCards[Index]->SetSlateWidget(T->DeckWidget(Each.Screen, Each.Page));
			T->DeckCards[Index]->RequestRedraw();
		}
		// Wave U3: the loupe found on the screen just read is what Glim presents on the wall.
		T->ApplyDeckWallAims();
	});
}

// ---- Swapping -----------------------------------------------------------------------------------------------------------

void ABpTable::ShowDeckAt(int32 Screen, int32 Page, int32 Direction)
{
	if (!DeckScreens.IsValidIndex(Screen) || DeckCards.Num() < 4) return;
	// Wave U3: at the wall's density on the wall (a room entered with the wall on, or the main screen changed).
	SyncDeckDrawSize();
	const bool bPageTurn = Screen == DeckAt && Page != DeckPage;
	if (Direction != 0) bDeckTouched = true;
	FDeckCard Old[4];
	for (int32 Index = 0; Index < 4; ++Index) Old[Index] = DeckCardState[Index];
	// The front's own widget, kept for it as it slides away (night two V4: it may carry its answer's stamp, and after a decline
	// the queue no longer holds its screen to draw it again).
	const TSharedPtr<SWidget> Leaving = DeckCards[0]->GetSlateWidget();
	DeckAt = Screen;
	DeckPage = FMath::Clamp(Page, 0, DeckScreens[Screen].Pages.Num() - 1);
	// V7: the front decision's "before" screen, asked for before its card is drawn (it draws "READING THE SCREEN" until then).
	DeckLoadShot();
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
		if (Index == 3 && Each.Key == Old[0].Key && Leaving.IsValid()) { DeckCards[3]->SetSlateWidget(Leaving); DeckCards[3]->RequestRedraw(); continue; }
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
	ApplyDeckWallAims();
	// Wave N3-W3: a step along the deck is said (its first showing is the room's own line); a page turn is not a step.
	if (Direction != 0 && !bPageTurn)
	{
		if (Front.Kind == KDecision) Narrate(TEXT("deck-next"), TEXT("the deck moved to a decision"));
		else if (Front.Kind == KSummary) Narrate(TEXT("deck-end"), TEXT("the deck's end"));
	}
}

void ABpTable::ApplyDeckPoses()
{
	if (DeckCards.Num() < 4) return;
	// The console open over the slot (night two W1) holds the deck hidden until it closes.
	const float Room = DeckRoom.IsEmpty() || CVarDeck.GetValueOnGameThread() == 0 || bDeckHeld ? 0.f : DeckEase(RoomFade);
	const float T = DeckEase(DeckSwapT);
	// Wave N3-W4: on the wall (bp.Projector 1) the front screen stands where the console's sheet does, at the wall's size; a
	// swap slides it aside on the wall and fades it there (no spines: the queue's place is the screen's own "3 OF 19").
	FTransform Wall;
	FVector2D WallCm;
	FIntPoint WallPx;
	const bool bWall = DeckWall(Wall, WallCm, WallPx);
	// The wall's width over the desk screen's (a swap slides a screen aside by its own width on either).
	const double WallK = WallCm.X / DeckWidthCm;
	const FVector WallRight = -Wall.GetRotation().RotateVector(FVector::RightVector), WallBack = -Wall.GetRotation().GetForwardVector();
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
		if (bShow && bWall)
		{
			Screen->SetRelativeTransform(FTransform(Wall.GetRotation(), Wall.GetLocation() + WallRight * (Side * DeckWidthCm * WallK * 0.55) + WallBack * (FMath::Min(Slot, 1.f) * 10.0), Wall.GetScale3D()));
		}
		else Screen->SetRelativeTransform(bShow ? DeckPose(Slot, Side) : DeckPose(Index < 3 ? static_cast<float>(Index) : 0.f, 0.f));
		if (!bShow) continue;
		// The glass under 1 (the card's FO rule: the bloom threshold); the paper as the card's.
		const bool bPaper = DeckScreens.IsValidIndex(Each.Screen) && PaperScreen(DeckScreens[Each.Screen].Kind);
		const float Tint = bPaper ? 0.82f : FMath::Clamp(CVarDeckTint.GetValueOnGameThread(), 0.5f, 1.2f);
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
		const bool bShow = CVarDeckSpines.GetValueOnGameThread() != 0 && !DeckRoom.IsEmpty() && DeckScreens.IsValidIndex(S) && !DeckSpineKey[Place].IsEmpty() && Alpha > 0.01f && !IsDeckOnWall();
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

bool ABpTable::DeckFocusProposal(const FString& ProposalId, const FString& FeatureId)
{
	const int32 Found = DeckScreens.IndexOfByPredicate([&ProposalId](const FDeckScreen& S) { return S.Proposal == ProposalId; });
	if (Found == INDEX_NONE) return DeckFocus(FeatureId);
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: focus %s -> screen %d"), *ProposalId, Found + 1);
	if (Found != DeckAt || DeckPage != 0) ShowDeckAt(Found, 0, Found >= DeckAt ? 1 : -1);
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

/** Draws the front screen once more with its answer's stamp, so it carries it as ShowDeckAt slides it away. */
static void StampFront(UWidgetComponent* Front, const FString& Id, const TCHAR* Word, TFunctionRef<TSharedRef<SWidget>()> Draw)
{
	if (!Front) return;
	GDeckStamp.Add(Id, Word);
	Front->SetSlateWidget(Draw());
	Front->RequestRedraw();
	GDeckStamp.Remove(Id);
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: %s stamped %s"), *Id, Word);
}

void ABpTable::DeckApprove()
{
	if (DeckRoom.IsEmpty() || !DeckScreens.IsValidIndex(DeckAt) || DeckScreens[DeckAt].Kind != KDecision)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused approve, the front screen is no decision (%s)"), *GetDeckLine());
		return;
	}
	const FString Id = DeckScreens[DeckAt].Proposal;
	// The decision (D12, owner 2026-10-31: "Pinching approve in VR should approve the target decisions"): approved in the
	// store, as the table's card does. On the server's 200 the screen leaves the queue (optimistic until the store's read
	// shows it approved); a refusal (Kettle's sample keeps no decision: 404; decided elsewhere: 409) is logged and the
	// draft below still stands.
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve %s -> the store (the Morning Watch's Approve; no build is queued)"), *Id);
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().ApproveDecision(Id, [Self, Id](int32 Status, const FString& Body)
	{
		ABpTable* T = Self.Get();
		if (!T) return;
		if (Status != 200)
		{
			UE_LOG(LogBpTable, Warning, TEXT("BpDeck: approve %s not written to the store (HTTP %d) %.200s"), *Id, Status, *Body);
			return;
		}
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: approved %s in the store"), *Id);
		T->CardDecided.Add(Id);
		// The queue without it; the screen in front stays in front (BuildDeckQueue keeps it by key).
		T->RefreshDeck();
	});
	// The guard (as FAD's for scans): the deck's wave write is only ever a draft; BpLink's SendWave refuses a dispatch route.
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve %s -> %s's draft wave (compose or PATCH; the table never dispatches a wave, on any product)"), *Id, *FBpLinkModule::Get().GetProductSlug());
	FBpLinkModule::Get().AddToDraft(Id, [Self, Id](bool bOk, const FString& Wave, const FString& Note)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve %s %s"), *Id, bOk ? *FString::Printf(TEXT("in draft %s"), *Wave) : TEXT("not written"));
		if (!bOk || !Self.IsValid()) return;
		Self->DeckInDraft.Add(Id);
		Self->RefreshDeck();
	});
	// Wave N3-W3: the answer acknowledged (the sample keeps nothing); the next card's line waits for it.
	Narrate(FBpLinkModule::Get().IsFromBundle() ? TEXT("deck-answer-noted") : TEXT("deck-answer-approved"), TEXT("approved on the deck"));
	// Resolving advances: the next screen; the answered one carries its stamp as it slides away.
	if (DeckAt + 1 < DeckScreens.Num())
	{
		StampFront(DeckCards.Num() > 0 ? DeckCards[0].Get() : nullptr, Id, TEXT("APPROVED"), [this]() { return DeckWidget(DeckAt, DeckPage); });
		ShowDeckAt(DeckAt + 1, 0, 1);
	}
}

TArray<FString> ABpTable::DeckOpenIds() const
{
	// The room's decisions still in the queue (proposed, not declined or decided this session). A repeat of a declined idea is
	// left out: its primary answer is Decline, and a bulk approve must not say yes to it.
	TArray<FString> Ids;
	for (int32 Index = 0; Index < DeckScreens.Num(); ++Index)
	{
		if (DeckScreens[Index].Kind == KDecision && !DeckRepeat(Index)) Ids.AddUnique(DeckScreens[Index].Proposal);
	}
	return Ids;
}

void ABpTable::DeckApproveAll()
{
	const bool bEnd = !DeckRoom.IsEmpty() && DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KSummary;
	TArray<FString> Ids = DeckOpenIds();
	if (!bEnd || Ids.Num() == 0)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: refused approve all (%s)"), DeckRoom.IsEmpty() ? TEXT("not in room mode") : !bEnd ? TEXT("not at the queue's end") : TEXT("no open decision"));
		return;
	}
	if (Ids.Num() > 50) Ids.SetNum(50); // the server takes 50 a write; the rest stay for the next pinch
	// D15 (owner 2026-10-31): one pinch approves all the findings the control stands for, in the store, as the card's and the
	// deck's Approve do (the Morning Watch's Approve each, no build). The server names the ones it skipped; those stay in the queue.
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve all %d in %s -> the store (the Morning Watch's Approve each; no build is queued)"), Ids.Num(), *DeckRoom);
	TWeakObjectPtr<ABpTable> Self(this);
	FBpLinkModule::Get().ApproveDecisions(Ids, [Self, Ids](int32 Status, const TArray<FString>& Approved, const TArray<TPair<FString, FString>>& Skipped)
	{
		ABpTable* T = Self.Get();
		if (!T) return;
		if (Status != 200)
		{
			UE_LOG(LogBpTable, Warning, TEXT("BpDeck: approve all %d not written to the store (HTTP %d)"), Ids.Num(), Status);
			return;
		}
		for (const TPair<FString, FString>& Skip : Skipped) UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve all skipped %s (%s)"), *Skip.Key, *Skip.Value);
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: approved %d of %d in the store, %d skipped"), Approved.Num(), Ids.Num(), Skipped.Num());
		for (const FString& Id : Approved) T->CardDecided.Add(Id);
		T->RefreshDeck();
		// The approved ones into the draft wave in one write, as each deck Approve does (never dispatched).
		if (Approved.Num() == 0) return;
		FBpLinkModule::Get().AddToDraft(Approved, [Self, Approved](bool bOk, const FString& Wave, const FString&)
		{
			UE_LOG(LogBpTable, Log, TEXT("BpDeck: approve all %d %s"), Approved.Num(), bOk ? *FString::Printf(TEXT("in draft %s"), *Wave) : TEXT("not written to a draft"));
			if (!bOk || !Self.IsValid()) return;
			for (const FString& Id : Approved) Self->DeckInDraft.Add(Id);
			Self->RefreshDeck();
		});
	});
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
			T->CardDecided.Add(Id);
			T->BuildDeckQueue();
			T->ShowDeckAt(T->DeckAt, 0, 1);
		});
		return;
	}
	StampFront(DeckCards.Num() > 0 ? DeckCards[0].Get() : nullptr, Id, TEXT("DECLINED"), [this]() { return DeckWidget(DeckAt, DeckPage); });
	DeckDeclined.Add(Id);
	Narrate(TEXT("deck-answer-declined"), TEXT("declined on the deck"));
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
	else if (Id == TEXT("deck:scan"))
	{
		// The route to the wrist's Scan tab, the one place a scan starts: the panel is already scoped to this room.
		APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
		if (ABpPawn* Pawn = PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr) Pawn->WristTap(TEXT("wrist:tab:scan"));
	}
	else if (Id == TEXT("deck:approveall")) DeckApproveAll();
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

void ABpTable::SetDeckHeld(bool bHeld)
{
	// Wave N3-W4: PlaceConsole calls this on every place, the main screen's mode change included: the deck moves between the
	// desk and the wall then too.
	static bool bWallShown = false;
	FTransform Wall;
	const bool bWall = DeckOnWall(Wall);
	// Wave U3: the console's place lets go of the far aims at the desk (PlaceConsole): the deck's decision on the wall takes them back.
	if (bHeld == bDeckHeld && bWall == bWallShown) { ApplyDeckWallAims(); return; }
	if (bWall != bWallShown) UE_LOG(LogBpTable, Log, TEXT("BpDeck: the front screen %s"), bWall ? TEXT("on the wall (the main screen), the desk's place empty") : TEXT("back at the desk"));
	bWallShown = bWall;
	if (bHeld != bDeckHeld) UE_LOG(LogBpTable, Log, TEXT("BpDeck: %s"), bHeld ? TEXT("held hidden (the console is open over it)") : TEXT("given back (the console closed)"));
	bDeckHeld = bHeld;
	// Wave U3: between the desk and the wall the screens change density and the decision its layout: drawn again.
	if (SyncDeckDrawSize() && DeckScreens.IsValidIndex(DeckAt)) ShowDeckAt(DeckAt, DeckPage, 0);
	ApplyDeckPoses();
	ApplyDeckWallAims();
}

bool ABpTable::DeckOnWall(FTransform& OutFront) const
{
	FVector2D SizeCm;
	FIntPoint Draw;
	return DeckWall(OutFront, SizeCm, Draw);
}

bool ABpTable::DeckWall(FTransform& OutFront, FVector2D& OutSizeCm, FIntPoint& OutDraw) const
{
	if (DeckRoom.IsEmpty() || BpProjector::Mode() != 1) return false;
	static const IConsoleVariable* RoomVar = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.Room"));
	const bool bPassthrough = RoomVar && RoomVar->GetInt() != 0;
	// Where the console's sheet stands on the wall (BpConsole.cpp's PlaceConsole: the same eye and forward).
	const FVector Eye = EyeLocal();
	FVector Centre;
	FRotator Facing;
	FVector2D SizeCm;
	BpProjector::Surface().Place(Eye, DeckPose(0.f, 0.f).GetLocation() - Eye, bPassthrough, Centre, Facing, SizeCm);
	// Wave U3: drawn at the wall's density (the console's sheet there: about 1570 px wide), not the desk's 840 px stretched 5 times.
	OutDraw = BpProjector::DrawSizeFor(SizeCm, FVector::Dist(Eye, Centre));
	OutSizeCm = SizeCm;
	OutFront = FTransform(Facing, Centre, FVector(SizeCm.X / FMath::Max(1, OutDraw.X)));
	return true;
}

bool ABpTable::SyncDeckDrawSize()
{
	if (DeckCards.Num() < 4) return false;
	FTransform Wall;
	FVector2D SizeCm;
	FIntPoint Px;
	const FVector2D Want = DeckWall(Wall, SizeCm, Px) ? FVector2D(Px.X, Px.Y) : FVector2D(DeckWidthCm * DeckPxPerCm, DeckHeightCm * DeckPxPerCm);
	// The component keeps whole pixels (the desk's 472.5 is 472): compared as it keeps them, or every call would redraw.
	const FVector2D Have = DeckCards[0]->GetDrawSize();
	if (FMath::Abs(Have.X - FMath::TruncToDouble(Want.X)) < 0.5 && FMath::Abs(Have.Y - FMath::TruncToDouble(Want.Y)) < 0.5) return false;
	for (UWidgetComponent* Each : DeckCards) Each->SetDrawSize(Want);
	// Every card is drawn again at the new density (ShowDeckAt keeps none of them).
	for (FDeckCard& Each : DeckCardState) Each.Stamp = 0xffffffffu;
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: the screens drawn at %.0fx%.0f (%s)"), Want.X, Want.Y, Want.X > DeckWidthCm * DeckPxPerCm + 1.0 ? TEXT("the wall's density") : TEXT("the desk's"));
	return true;
}

void ABpTable::ApplyDeckWallAims()
{
	// Wave U3: as the stand-up's decision on the wall (BpConsole.cpp's RefreshConsole), Glim presents the front decision (its
	// loupe's region, else its title) and then asks at APPROVE. Only while the deck itself is on the wall: the open console
	// holds it and owns the aims then.
	FTransform Wall;
	FVector2D SizeCm;
	FIntPoint Px;
	const bool bWant = !bDeckHeld && CVarDeck.GetValueOnGameThread() != 0 && DeckWall(Wall, SizeCm, Px) && DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision
		&& DeckCards.Num() > 0 && DeckCardState[0].Screen == DeckAt;
	if (!bWant)
	{
		if (!bDeckWallPoint) return;
		bDeckWallPoint = false;
		DeckWallAimKey.Reset();
		// Held: the console has just set its own sheet's aims; otherwise nothing is far now.
		if (!bDeckHeld) BpProjector::SetFar(false, FVector::ZeroVector);
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: Glim lets the wall's decision go (%s)"), bDeckHeld ? TEXT("the console took the wall") : TEXT("no decision on the wall"));
		return;
	}
	const FTransform Pose(Wall.GetRotation(), Wall.GetLocation());
	const auto ToLocal = [&](const FVector2f& LayoutPx) { return BpProjector::Surface().UvToWorld(Pose, SizeCm, FVector2D(LayoutPx.X / LW, LayoutPx.Y / LH)); };
	const FVector2f PresentPx = DeckWallLoupeAim.X >= 0.f ? DeckWallLoupeAim : DeckWallTitleAim.X >= 0.f ? DeckWallTitleAim : FVector2f(LW * 0.5f, LH * 0.5f);
	FBox2f Approve, Decline, Prev, Next, Scan;
	DeckWallBoxes(DeckRepeat(DeckAt), Approve, Decline, Prev, Next, Scan);
	const FVector2f AskPx = Approve.GetCenter();
	BpProjector::SetFar(true, ToLocal(PresentPx));
	BpProjector::SetFarCentre(Wall.GetLocation());
	BpProjector::SetFarSheet(Pose, SizeCm);
	BpProjector::SetFarAims(ToLocal(PresentPx), ToLocal(AskPx), true);
	// His turn eases at the frame rate (TickSwitch keeps it there while he moves).
	if (!bDeckWallPoint) SetActorTickInterval(0.f);
	bDeckWallPoint = true;
	const FString Key = FString::Printf(TEXT("%s %.0f %.0f"), *DeckScreens[DeckAt].Proposal, PresentPx.X, PresentPx.Y);
	if (Key != DeckWallAimKey)
	{
		DeckWallAimKey = Key;
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: Glim presents the wall's decision %s: %s at layout (%.0f, %.0f), then asks at APPROVE (%.0f, %.0f)"), *DeckScreens[DeckAt].Proposal,
			DeckWallLoupeAim.X >= 0.f ? TEXT("the loupe's region") : DeckWallTitleAim.X >= 0.f ? TEXT("the decision's title") : TEXT("its centre"), PresentPx.X, PresentPx.Y, AskPx.X, AskPx.Y);
	}
}

bool ABpTable::WaitingDecision(FString& OutId, FString& OutTitle, FString& OutWhere) const
{
	OutId.Reset();
	OutTitle.Reset();
	OutWhere.Reset();
	// The deck's front screen when it is a decision and shows (room mode, not held under the console), else the card's.
	if (!DeckRoom.IsEmpty() && !bDeckHeld && DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision)
	{
		OutId = DeckScreens[DeckAt].Proposal;
		OutWhere = TEXT("deck");
	}
	else if (RoomModeId.IsEmpty() && bCardShown && !CardShownId.IsEmpty() && Card && Card->IsVisible())
	{
		OutId = CardShownId;
		OutWhere = TEXT("card");
	}
	if (OutId.IsEmpty()) return false;
	for (const FBpProposal& P : FBpLinkModule::Get().GetScanState().Scan.proposals)
	{
		if (P.id == OutId) { OutTitle = P.title; break; }
	}
	if (OutTitle.IsEmpty()) OutTitle = OutId;
	return true;
}

bool ABpTable::DecideWaiting(bool bApprove, const TCHAR* Route)
{
	FString Id, Title, Where;
	if (!WaitingDecision(Id, Title, Where))
	{
		UE_LOG(LogBpTable, Log, TEXT("BpDeck: %s by the %s refused: no decision waits"), bApprove ? TEXT("approve") : TEXT("decline"), Route);
		return false;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpDeck: %s %s on the %s by the %s"), bApprove ? TEXT("approve") : TEXT("decline"), *Id, *Where, Route);
	// The tour counts it as the decision it asks for, as a hand's tap on the screen or the card.
	NoteHand(TEXT("tap"));
	if (Where == TEXT("deck"))
	{
		if (bApprove) DeckApprove();
		else DeckDecline();
	}
	else CardTap(bApprove ? TEXT("card:approve") : TEXT("card:decline"));
	return true;
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
	// Layout px per draw px (the desk's 1280 over 840, or the wall's density, wave U3).
	const float Scale = LW / FMath::Max(1.f, static_cast<float>(Front->GetDrawSize().X));
	const FVector2f Px(static_cast<float>(-Local.Y * Scale + LW * 0.5f), static_cast<float>(-Local.Z * Scale + LH * 0.5f));
	if (Px.X < 0.f || Px.Y < 0.f || Px.X > LW || Px.Y > LH) return false;
	const bool bDecision = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision;
	if (bDecision && IsDeckOnWall())
	{
		// Wave U3: the wall's decision has its own row (DeckWallBoxes); the same acts.
		FBox2f Approve, Decline, Prev, Next, Scan;
		DeckWallBoxes(DeckRepeat(DeckAt), Approve, Decline, Prev, Next, Scan);
		if (DeckScanRoute() && Scan.IsInside(Px)) OutId = TEXT("deck:scan");
		else if (Approve.IsInside(Px)) OutId = TEXT("deck:approve");
		else if (Decline.IsInside(Px)) OutId = TEXT("deck:decline");
		else if (Prev.IsInside(Px)) OutId = TEXT("deck:prev");
		else if (Next.IsInside(Px)) OutId = TEXT("deck:next");
		else OutId = TEXT("deck:screen");
		return true;
	}
	const bool bEnd = DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KSummary;
	FString Why;
	const bool bAll = bEnd && DeckOpenIds().Num() > 0;
	if (DeckScanRoute() && ScanBox.IsInside(Px)) OutId = TEXT("deck:scan");
	else if (bAll && ApproveAllBox.IsInside(Px)) OutId = TEXT("deck:approveall");
	else if (bEnd && (bAll ? NextRoomNarrowBox : NextRoomBox).IsInside(Px) && !NextRoom(Why).IsEmpty()) OutId = TEXT("deck:nextroom");
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
	// Wave U3: the wall's decision row, and the wall's density.
	FTransform WallFront;
	FVector2D WallCm;
	FIntPoint WallPx;
	const bool bWall = DeckWall(WallFront, WallCm, WallPx);
	FBox2f WApprove, WDecline, WPrev, WNext, WScan;
	DeckWallBoxes(bRepeat, WApprove, WDecline, WPrev, WNext, WScan);
	if (bWall && DeckScreens.IsValidIndex(DeckAt) && DeckScreens[DeckAt].Kind == KDecision)
	{
		const FBox2f* W = Id == TEXT("deck:approve") ? &WApprove : Id == TEXT("deck:decline") ? &WDecline : Id == TEXT("deck:prev") ? &WPrev : Id == TEXT("deck:next") ? &WNext : Id == TEXT("deck:scan") ? &WScan : nullptr;
		if (!W) return false;
		const FVector2f C = W->GetCenter();
		const float K = WallPx.X / LW;
		OutWorld = (WallFront * GetActorTransform()).TransformPosition(FVector(0.0, -(C.X - LW * 0.5f) * K, -(C.Y - LH * 0.5f) * K));
		return true;
	}
	const FBox2f* Box = Id == TEXT("deck:approve") ? (bRepeat ? &RepeatApproveBox : &ApproveBox) : Id == TEXT("deck:decline") ? (bRepeat ? &RepeatDeclineBox : &DeclineBox) : Id == TEXT("deck:prev") ? &PrevBox : Id == TEXT("deck:next") ? &NextBox
		: Id == TEXT("deck:nextroom") ? (DeckOpenIds().Num() > 0 ? &NextRoomNarrowBox : &NextRoomBox) : Id == TEXT("deck:approveall") ? &ApproveAllBox : Id == TEXT("deck:scan") ? &ScanBox : nullptr;
	if (!Box) return false;
	const FVector2f Centre = Box->GetCenter();
	const float Scale = bWall ? WallPx.X / LW : DeckPxPerCm / DeckLayoutPxPerCm;
	// The front's resting place (DeckPose 0, or the wall's, wave N3-W4), so a hand aims where the screen settles.
	FTransform Front = WallFront;
	if (!bWall) Front = DeckPose(0.f, 0.f);
	const FTransform T = Front * GetActorTransform();
	OutWorld = T.TransformPosition(FVector(0.0, -(Centre.X - LW * 0.5f) * Scale, -(Centre.Y - LH * 0.5f) * Scale));
	return true;
}

// ---- A screen's widget --------------------------------------------------------------------------------------------------

TSharedRef<SWidget> ABpTable::DeckWidget(int32 ScreenIndex, int32 PageIndex) const
{
	const FDeckScreen& Screen = DeckScreens[ScreenIndex];
	const bool bPaper = PaperScreen(Screen.Kind);
	const bool bDecision = Screen.Kind == KDecision;
	// Wave U3: on the wall a decision takes the wall's family (the stand-up's decision on the wall), not this card scaled up.
	if (bDecision && IsDeckOnWall()) return DeckWallDecision(ScreenIndex);
	if (bDecision)
	{
		// ---- A decision in a room, as the stand-up's decision sheet (night two V4)----------------------------------------------
		// The owner's device capture (2026-11-09, w2b-dev-handed-bar): five small lines of equal weight, a counter that said three
		// things, tilted neighbours. Now the family's sheet: the lens and the risk as chips, SCAN THIS ROOM a quiet control at the
		// top right; the title and its one line of consequence lead, the evidence quiet under them; APPROVE the primary, DECLINE
		// beside it; the room's queue a calm "3 OF 16" between PREV and NEXT. The actions and the words sent do not change.
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FBpScanState& State = Link.GetScanState();
		const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Screen](const FBpProposal& X) { return X.id == Screen.Proposal; });
		const FBpPlanTile* Tile = P && SheetPlan.IsValid() ? SheetPlan->tiles.FindByPredicate([P](const FBpPlanTile& T) { return T.id == P->feature; }) : nullptr;
		const FBpPlanBay* Bay = Tile ? SheetPlan->bays.FindByPredicate([Tile](const FBpPlanBay& B) { return B.id == Tile->parentId; }) : nullptr;
		const int32* Tier = P ? State.Tiers.Find(P->id) : nullptr;
		const FBpDecisionBrief* Brief = P ? DeckBrief(P->id) : nullptr;
		const bool bRepeat = Brief && FBpLinkModule::IsRepeat(*Brief);
		bool bInDraft = P && DeckInDraft.Contains(P->id);
		for (const FBpWave& Wave : State.Waves)
		{
			if (bInDraft || Wave.status != BpVocab::Wave::Status::Draft || !P) continue;
			for (const FBpWavePackage& Package : Wave.packages) if (Package.ids.Contains(P->id)) bInDraft = true;
		}
		const auto SFont = [](const TCHAR* Style, float CapPx) { return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style)); };
		const auto SPitch = [](float CapPx) { return BpSheet::LinePitch(CapPx, static_cast<float>(BpType::CapPerEm)); };
		const FSlateFontInfo SmallBold = SFont(TEXT("Bold"), 24.f), Small = SFont(TEXT("Regular"), 24.f), Lead = SFont(TEXT("Regular"), 28.f), Head = SFont(TEXT("Bold"), 38.f);
		const FSlateFontInfo LabelFont = SFont(TEXT("Bold"), 28.f), AnswerFont = SFont(TEXT("Bold"), 32.f);
		TSharedRef<SCanvas> Canvas = SNew(SCanvas);
		const auto Put = [&Canvas](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
		{
			Canvas->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
		};
		const auto Words = [&Put](const FBox2f& Box, const FString& Text, const FSlateFontInfo& Font, const FLinearColor& Color)
		{
			Put(Box, SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(FSlateColor(Color)));
		};
		// The header: the chips (the lens, the risk with the ledger's mark, the tier, IN DRAFT), SCAN THIS ROOM at the right.
		{
			float X = PadX;
			const float ChipY0 = 30.f, ChipH = 44.f;
			const auto AddChip = [&](const FString& Text, const FLinearColor& Color, bool bSolid)
			{
				const float W = BpSheet::ChipWidth(Text, SmallBold);
				if (X + W > ScanBox.Min.X - 16.f) return;
				Put(FBox2f(FVector2f(X, ChipY0), FVector2f(X + W, ChipY0 + ChipH)), BpSheet::Chip(Text, SmallBold, ChipH, Color, bSolid));
				X += W + 12.f;
			};
			if (P) AddChip(LensWord(P->lens) + TEXT(" LENS"), BpSheet::Accent, false);
			if (P && P->risk > 0.0) AddChip(FString::Printf(TEXT("RISK %s"), *Number(P->risk)), BpSheet::RiskColor(P->risk), false);
			if (Tier) AddChip(FString::Printf(TEXT("T%d %s"), *Tier, *TierWord(*Tier)), *Tier <= PinTagTierMax ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.85f), false);
			if (bInDraft) AddChip(TEXT("IN DRAFT WAVE"), BpSheet::Accent, true);
			if (DeckScanRoute()) Put(ScanBox, BpSheet::Control(TEXT("SCAN THIS ROOM"), LabelFont, BpSheet::ELook::Edge));
			Put(FBox2f(FVector2f(PadX, 92.f), FVector2f(LW - PadX, 94.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
		}
		// The frame: the decision, its consequence, the evidence; the title block at its foot (the finding's id, the product).
		const FBox2f DFrame(FVector2f(PadX, 108.f), FVector2f(LW - PadX, 546.f));
		const FLinearColor Tone = bRepeat ? BpSheet::Red : BpSheet::Amber;
		Put(DFrame, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.32f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f).Bar(Tone).BarPx(8.f));
		// V7: the finding's "before" screen takes the frame's right half, as on the stand-up's decision sheet (BpStandup.cpp);
		// without one the card keeps the whole width.
		const bool bScreen = P && ABpPawn::FindBeforeShot(P->id) != nullptr;
		const float InX = DFrame.Min.X + 34.f, InX1 = bScreen ? DFrame.Min.X + 600.f : DFrame.Max.X - 26.f, InW = InX1 - InX;
		float Y = DFrame.Min.Y + 18.f;
		// The kicker names the room (V7: one count only, the room's decisions between PREV and NEXT).
		int32 Nth = 0, Of = 0;
		for (int32 Index = 0; Index < DeckScreens.Num(); ++Index) if (DeckScreens[Index].Kind == KDecision) { ++Of; if (Index == ScreenIndex) Nth = Of; }
		const FBpPlanRoom* KickerRoom = FindRoom(DeckRoom);
		FString Kicker = KickerRoom && !KickerRoom->name.IsEmpty() ? TEXT("DECISION · ") + KickerRoom->name.ToUpper() : FString(TEXT("DECISION · IN THIS ROOM"));
		if (BpSheet::TextWidth(Kicker, SmallBold) > InW) Kicker = TEXT("DECISION · IN THIS ROOM");
		if (bRepeat) Kicker += TEXT(" · REPEATS A DECLINE");
		const FString KickerFit = BpSheet::Wrap(Kicker, SmallBold, InW, 0);
		Words(FBox2f(FVector2f(InX, Y), FVector2f(InX1, Y + BpSheet::Lines(KickerFit) * SPitch(24.f) + 4.f)), KickerFit, SmallBold, Tone);
		Y += BpSheet::Lines(KickerFit) * SPitch(24.f) + 6.f;
		const FString TitleFit = BpSheet::Wrap(P ? P->title : Screen.Proposal, Head, InW, 0);
		Words(FBox2f(FVector2f(InX, Y), FVector2f(InX1, Y + BpSheet::Lines(TitleFit) * SPitch(38.f) + 6.f)), TitleFit, Head, BpSheet::InkHi);
		Y += BpSheet::Lines(TitleFit) * SPitch(38.f) + 10.f;
		// The one line of consequence: the brief's first line (where the change lands, what depends on it); without a brief, where.
		TArray<FString> Evidence = Brief ? Brief->lines : TArray<FString>();
		FString First = Evidence.Num() > 0 ? Evidence[0] : P ? (Tile ? TEXT("On ") + Tile->name + (Bay ? TEXT(" in ") + Bay->name : FString()) : TEXT("On ") + P->feature) : FString();
		if (Evidence.Num() > 0) Evidence.RemoveAt(0);
		const FString LeadFit = BpSheet::Wrap(First, Lead, InW, 0);
		Words(FBox2f(FVector2f(InX, Y), FVector2f(InX1, Y + BpSheet::Lines(LeadFit) * SPitch(28.f) + 4.f)), LeadFit, Lead, BpSheet::InkHi);
		Y += BpSheet::Lines(LeadFit) * SPitch(28.f) + 14.f;
		// The evidence, quiet: each line whole beside its square mark (the precedent, undo, cost; a quoted decline in amber); a
		// line that would not fit whole above the title block is left for the next look, never cut.
		int32 DeclinedLine = INDEX_NONE;
		if (Brief) for (int32 Index = 0; Index < Brief->facts.Num(); ++Index) if (Brief->facts[Index].key == BpVocab::BriefFact::Key::Declined) DeclinedLine = Index - 1;
		const float YMax = DFrame.Max.Y - 56.f;
		// No brief (the sample's, or before it arrives): the finding's own words, quiet, as its evidence.
		if (Evidence.Num() == 0 && P)
		{
			TArray<FString> Body;
			P->body.ParseIntoArrayLines(Body, true);
			for (const FString& Raw : Body)
			{
				FString Line = Plain(Raw);
				if (Line.StartsWith(TEXT("#")) || Line.IsEmpty()) continue;
				if (Line.StartsWith(TEXT("- ")) || Line.StartsWith(TEXT("* "))) Line = Line.Mid(2);
				Evidence.Add(Line);
				if (Evidence.Num() >= 3) break;
			}
			TArray<FString> Meta;
			if (!P->size.IsEmpty()) Meta.Add(TEXT("Size ") + P->size);
			if (!P->created_at.IsEmpty()) Meta.Add(TEXT("proposed ") + P->created_at.Left(10));
			if (Meta.Num() > 0) Evidence.Add(FString::Join(Meta, TEXT(" · ")));
		}
		for (int32 Index = 0; Index < Evidence.Num() && Index < 4; ++Index)
		{
			const FString Fit = BpSheet::Wrap(Evidence[Index], Small, InW - 28.f, 0);
			const float ItemH = BpSheet::Lines(Fit) * SPitch(24.f);
			if (Y + ItemH > YMax) break;
			const FLinearColor LineInk = Index == DeclinedLine ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.8f);
			Put(FBox2f(FVector2f(InX, Y + SPitch(24.f) * 0.5f - 7.f), FVector2f(InX + 12.f, Y + SPitch(24.f) * 0.5f + 5.f)), SNew(BpSheet::SPlate).Fill(Index == DeclinedLine ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.45f)));
			Words(FBox2f(FVector2f(InX + 28.f, Y), FVector2f(InX1, Y + ItemH + 4.f)), Fit, Small, LineInk);
			Y += ItemH + 8.f;
		}
		// The screen: the finding's "before", in a fine frame, its caption a strip across its foot (the stand-up's sheet's look).
		if (bScreen)
		{
			const float ImgX0 = InX1 + 30.f, ImgX1 = DFrame.Max.X - 26.f, ImgW = ImgX1 - ImgX0;
			const float ImgH = FMath::Min(ImgW * 9.f / 16.f, DFrame.Max.Y - 60.f - (DFrame.Min.Y + 18.f));
			const FBox2f Img(FVector2f(ImgX0, DFrame.Min.Y + 18.f), FVector2f(ImgX1, DFrame.Min.Y + 18.f + ImgH));
			const bool bHave = DeckShotFor == P->id && DeckShotBrush.IsValid();
			if (bHave)
			{
				Put(Img.ExpandBy(5.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Ink.CopyWithNewOpacity(0.8f)).EdgePx(2.f));
				// The widget holds its brush (a card sliding away outlives the next decision's), and DeckShotKept its texture.
				Put(Img, SNew(SImage).Image_Lambda([Brush = DeckShotBrush]() { return Brush.Get(); }));
			}
			else
			{
				Put(Img, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.4f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.35f)).EdgePx(2.f));
				const bool bReading = DeckShotFor != P->id || bDeckShotLoading;
				Put(Img, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock)
					.Text(FText::FromString(bReading ? TEXT("READING THE SCREEN") : TEXT("NO SCREEN FOR THIS FINDING"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.55f)))]);
			}
			const bool bSampleShot = bHave && bDeckShotSample;
			const float TagW = bSampleShot ? BpSheet::ChipWidth(TEXT("SAMPLE"), SmallBold) + 8.f : 0.f;
			const FString Caption = FString::Printf(TEXT("BEFORE · %s"), *(Tile ? Tile->name : P->feature)).ToUpper();
			const FString CaptionFit = BpSheet::Wrap(Caption, SmallBold, ImgW - TagW - 24.f, 0);
			const float CapH = FMath::Max(40.f, BpSheet::Lines(CaptionFit) * SPitch(24.f) + 8.f);
			const float CapY = Img.Max.Y - CapH;
			Put(FBox2f(FVector2f(Img.Min.X, CapY), Img.Max), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.9f)));
			Put(FBox2f(FVector2f(ImgX0 + 12.f, CapY), FVector2f(ImgX1 - TagW - 12.f, Img.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(CaptionFit)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
			if (bSampleShot) Put(FBox2f(FVector2f(ImgX1 - TagW, Img.Max.Y - 40.f), FVector2f(ImgX1, Img.Max.Y)), BpSheet::Chip(TEXT("SAMPLE"), SmallBold, 40.f, BpSheet::Amber, true));
		}
		// The title block: the finding's id, the product and whose morning (SAMPLE, or today's date).
		{
			const FString No = P ? P->id.ToUpper() : Screen.Proposal.ToUpper();
			const FString ProductName = Link.GetProductName().IsEmpty() ? Link.NameOf(Link.GetProductSlug()) : Link.GetProductName();
			const FString Proj = ProductName.ToUpper() + TEXT(" · ") + (Link.HasPcLink() ? FDateTime::Now().ToString(TEXT("%d.%m.")) : FString(TEXT("SAMPLE")));
			const float NoW = BpSheet::TextWidth(No, SmallBold), ProjW = BpSheet::TextWidth(Proj, Small);
			const FBox2f Block(FVector2f(DFrame.Max.X - NoW - ProjW - 74.f, DFrame.Max.Y - 46.f), DFrame.Max);
			Put(Block, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.5f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
			Put(FBox2f(FVector2f(Block.Min.X + NoW + 30.f, Block.Min.Y + 8.f), FVector2f(Block.Min.X + NoW + 32.f, Block.Max.Y - 8.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f)));
			Put(FBox2f(Block.Min + FVector2f(14.f, 0.f), FVector2f(Block.Min.X + NoW + 24.f, Block.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(No)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
			Put(FBox2f(FVector2f(Block.Min.X + NoW + 46.f, Block.Min.Y), Block.Max), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Proj)).Font(Small).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
		}
		// The status line: what an answer does, in the deck's own terms.
		const FString Status = bRepeat ? FString(TEXT("You declined this idea before: DECLINE · REPEAT declines it in the store, APPROVE overrides.")) : FString(TEXT("APPROVE puts it in the draft wave; nothing is built."));
		Put(FBox2f(FVector2f(PadX + 4.f, 552.f), FVector2f(LW - PadX, 592.f)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Wrap(Status, Small, LW - 2.f * PadX - 8.f, 0))).Font(Small).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
		// The answers (DeckHit's boxes): APPROVE the primary, DECLINE beside it; on a repeat DECLINE · REPEAT leads.
		if (bRepeat)
		{
			Put(RepeatDeclineBox, BpSheet::Control(TEXT("DECLINE · REPEAT"), AnswerFont, BpSheet::ELook::Amber));
			Put(RepeatApproveBox, BpSheet::Control(TEXT("APPROVE"), AnswerFont, BpSheet::ELook::Edge));
		}
		else
		{
			Put(ApproveBox, BpSheet::Control(TEXT("APPROVE"), AnswerFont, BpSheet::ELook::Amber));
			Put(DeclineBox, BpSheet::Control(TEXT("DECLINE"), AnswerFont, BpSheet::ELook::Edge));
		}
		// The queue, calm: PREV, "3 OF 16", NEXT, quieter than the answers (shorter, edged).
		const bool bPrevOk = DeckAt > 0, bNextOk = DeckAt + 1 < DeckScreens.Num();
		Put(FBox2f(PrevBox.Min + FVector2f(0.f, 12.f), PrevBox.Max - FVector2f(0.f, 12.f)), BpSheet::Control(TEXT("‹  PREV"), LabelFont, bPrevOk ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
		Put(FBox2f(NextBox.Min + FVector2f(0.f, 12.f), NextBox.Max - FVector2f(0.f, 12.f)), BpSheet::Control(TEXT("NEXT  ›"), LabelFont, bNextOk ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
		// V7: one count, the room's decisions ("1 OF 19"); the whole queue (its decisions, then each feature's sheet, then the
		// room's summary) is not a number a person needs here.
		Put(CountBox, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%d OF %d"), Nth, Of))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f)))]);
		// The answer taken lands as the stand-up's stamp, on the screen as it slides away (GDeckStamp, DeckApprove/DeckDecline).
		if (const FString* Stamp = P ? GDeckStamp.Find(P->id) : nullptr)
		{
			const FLinearColor StampInk = Stamp->StartsWith(TEXT("APPROVED")) ? BpSheet::Accent : BpSheet::Red;
			const FSlateFontInfo StampFont = SFont(TEXT("Bold"), 44.f);
			const float StampW = BpSheet::TextWidth(*Stamp, StampFont) + 64.f, StampH = 96.f;
			const FVector2f C(DFrame.Max.X - StampW * 0.5f - 60.f, DFrame.Min.Y + 120.f);
			Put(FBox2f(C - FVector2f(StampW, StampH) * 0.5f, C + FVector2f(StampW, StampH) * 0.5f), SNew(SBox).RenderTransformPivot(FVector2D(0.5, 0.5)).RenderTransform(FSlateRenderTransform(FQuat2D(FMath::DegreesToRadians(-7.f))))
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.94f)).Edge(StampInk).EdgePx(5.f)]
					+ SOverlay::Slot().Padding(9.f)[SNew(BpSheet::SPlate).Edge(StampInk.CopyWithNewOpacity(0.6f)).EdgePx(1.5f)]
					+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(*Stamp)).Font(StampFont).ColorAndOpacity(FSlateColor(StampInk))]
				]);
		}
		return SNew(SDPIScaler).DPIScale(DeckCards.Num() > 0 ? static_cast<float>(DeckCards[0]->GetDrawSize().X) / LW : DeckPxPerCm / DeckLayoutPxPerCm)
			[
				SNew(SBox).WidthOverride(LW).HeightOverride(LH)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(48.f).RulePx(5.f)]
					+ SOverlay::Slot()[Canvas]
				]
			];
	}
	// Opaque at the core (FAH: at 0.93 the city's lit windows, many times brighter than the panel, and the screens behind
	// read through it); the glass is its edge, its glow and its sheen.
	static const FSlateRoundedBoxBrush PaperPanel(PaperTone, 0.f, PaperEdge.CopyWithNewOpacity(0.95f), 4.f);
	static const FSlateRoundedBoxBrush PaperGlowBrush(PaperGlow.CopyWithNewOpacity(0.16f), 0.f);
	static const FSlateRoundedBoxBrush ApproveBrush(Amber, 0.f);
	static const FSlateRoundedBoxBrush DeclineBrush(FLinearColor::Transparent, 0.f, CyanEdge.CopyWithNewOpacity(0.9f), 3.f);
	static const FSlateRoundedBoxBrush TabGlass(Cyan.CopyWithNewOpacity(0.10f), 0.f, Cyan.CopyWithNewOpacity(0.7f), 2.5f);
	static const FSlateRoundedBoxBrush TabPaper(Ink.CopyWithNewOpacity(0.05f), 0.f, Ink.CopyWithNewOpacity(0.55f), 2.5f);
	static const FSlateRoundedBoxBrush TabOff(FLinearColor::Transparent, 0.f, Cyan.CopyWithNewOpacity(0.18f), 2.f);
	static const FSlateRoundedBoxBrush TabOffPaper(FLinearColor::Transparent, 0.f, Ink.CopyWithNewOpacity(0.18f), 2.f);

	const auto Label = [](const FString& Text, uint8 Style, const FLinearColor& Color)
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(DeckFont(Style)).ColorAndOpacity(FSlateColor(Color));
	};
	const auto Chip = [&Label, bPaper](const FString& Text, uint8 Look)
	{
		// A leading risk mark (▲ ◆ ▽) sets in Slate's default face: Barlow has no such glyphs.
		const bool bMark = Text.StartsWith(TEXT("▲")) || Text.StartsWith(TEXT("◆")) || Text.StartsWith(TEXT("▽"));
		TSharedRef<SHorizontalBox> Inside = SNew(SHorizontalBox);
		if (bMark) Inside->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 8.f, 0.f)[SNew(STextBlock).Text(FText::FromString(Text.Left(1))).Font(FCoreStyle::GetDefaultFontStyle("Bold", 18)).ColorAndOpacity(FSlateColor(ChipText(Look, bPaper)))];
		Inside->AddSlot().AutoWidth().VAlign(VAlign_Center)[Label(bMark ? Text.Mid(1).TrimStart() : Text, SKicker, ChipText(Look, bPaper))];
		return SNew(SBorder).BorderImage(ChipBrush(Look, bPaper)).Padding(FMargin(14.f, 7.f)).VAlign(VAlign_Center)[Inside];
	};

	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	// The page's sections take letters (the web's lettered bubbles), in order.
	int32 Section = 0;
	const auto SectionBubble = [&Section, bPaper]()
	{
		FSlateFontInfo Letter = DeckFont(SKicker);
		Letter.Size *= 0.8f;
		Letter.LetterSpacing = 0;
		return BpSheet::Bubble(FString(1, &TEXT("ABCDEFGHIJKLMNOPQRSTUVWXYZ")[FMath::Min(Section++, 25)]), Letter, 34.f, bPaper ? BpSheet::PaperLo : BpSheet::Ink);
	};
	const TArray<FDeckRow>& Page = Screen.Pages.IsValidIndex(PageIndex) ? Screen.Pages[PageIndex] : TArray<FDeckRow>();
	for (const FDeckRow& Row : Page)
	{
		TSharedPtr<SWidget> Content;
		switch (Row.Kind)
		{
		case RText:
			// row style 1: a bullet's indent; 2: the brief's quoted decline, in amber
			if (Row.Style == SHead)
			{
				Content = SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 14.f, 0.f)[SectionBubble()]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Label(Row.Texts[0], Row.Style, TextColor(Row.Style, bPaper))];
				break;
			}
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
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 12.f, 0.f)[SectionBubble()]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Label(TEXT("METRIC"), SHead, TextColor(SHead, bPaper))]
					]
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
	const FString Count = FString::Printf(TEXT("%d OF %d"), DeckAt + 1, DeckScreens.Num());
	TSharedRef<SVerticalBox> Counter = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)[Label(Count, SControl, ControlInk)];
	if (Screen.Pages.Num() > 1) Counter->AddSlot().AutoHeight().HAlign(HAlign_Center).Padding(0.f, 4.f, 0.f, 0.f)[Label(FString::Printf(TEXT("PAGE %d OF %d"), PageIndex + 1, Screen.Pages.Num()), SMeta, TextColor(SMeta, bPaper))];
	TSharedRef<SCanvas> Bar = SNew(SCanvas);
	const auto Place = [&Bar](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Bar->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	// Night two V4: the family's controls (BpSheet::Control) on every screen; the pager quieter than the answers.
	const FSlateFontInfo PagerFont = DeckFont(SControl);
	const bool bSheetLook = !bPaper;
	if (bSheetLook) Place(FBox2f(PrevBox.Min + FVector2f(0.f, 12.f), PrevBox.Max - FVector2f(0.f, 12.f)), BpSheet::Control(TEXT("‹  PREV"), PagerFont, bPrev ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
	else Place(PrevBox, Button(bPrev ? &TabPaper : &TabOffPaper, FString(), TEXT("‹  PREV"), bPrev ? ControlInk : ControlInk.CopyWithNewOpacity(0.3f)));
	Place(CountBox, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[Counter]);
	if (bSheetLook) Place(FBox2f(NextBox.Min + FVector2f(0.f, 12.f), NextBox.Max - FVector2f(0.f, 12.f)), BpSheet::Control(TEXT("NEXT  ›"), PagerFont, bNext ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
	else Place(NextBox, Button(bNext ? &TabPaper : &TabOffPaper, FString(), TEXT("NEXT  ›"), bNext ? ControlInk : ControlInk.CopyWithNewOpacity(0.3f)));
	if (DeckScanRoute()) Place(ScanBox, bSheetLook ? BpSheet::Control(TEXT("SCAN THIS ROOM"), PagerFont, BpSheet::ELook::Edge) : Button(&TabPaper, FString(), TEXT("SCAN THIS ROOM"), ControlInk));
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
	const int32 OpenCount = Screen.Kind == KSummary ? DeckOpenIds().Num() : 0;
	if (OpenCount > 0)
	{
		// D15: the decisions this room still holds, approved with one pinch.
		Place(ApproveAllBox, BpSheet::Control(FString::Printf(TEXT("APPROVE ALL (%d)"), OpenCount), DeckFont(SControl), BpSheet::ELook::Amber));
	}
	const FBox2f& NextBoxHere = OpenCount > 0 ? NextRoomNarrowBox : NextRoomBox;
	if (Next)
	{
		// The queue's end (WP3): the next room by urgency, its name and why on the button.
		Place(NextBoxHere, SNew(SBorder).BorderImage(&ApproveBrush).Padding(FMargin(22.f, 0.f)).VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()[Label(TEXT("NEXT ROOM  ›"), SControl, Ink)]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 2.f, 0.f, 0.f)[Label(TextWidth(FString::Printf(TEXT("%s  ·  %s"), *Next->name, *Why), SMeta) <= NextBoxHere.GetSize().X - 44.f ? FString::Printf(TEXT("%s  ·  %s"), *Next->name, *Why) : Next->name, SMeta, Ink)]
			]);
	}

	return SNew(SDPIScaler).DPIScale(DeckCards.Num() > 0 ? static_cast<float>(DeckCards[0]->GetDrawSize().X) / LW : DeckPxPerCm / DeckLayoutPxPerCm)
		[
			SNew(SBox).WidthOverride(LW).HeightOverride(LH)
			[
				SNew(SOverlay)
				// The sheet: opaque, the web's double wall and grid; the old warm paper only behind bp.DeckPaper.
				+ SOverlay::Slot()[bPaper ? TSharedRef<SWidget>(SNew(SOverlay) + SOverlay::Slot()[SNew(SBorder).BorderImage(&PaperGlowBrush)] + SOverlay::Slot().Padding(8.f)[SNew(SBorder).BorderImage(&PaperPanel)]) : TSharedRef<SWidget>(SNew(BpSheet::SSheet).GridPx(48.f).RulePx(5.f))]
				+ SOverlay::Slot().Padding(FMargin(PadX, PadTop, PadX, LH - BarY + BarGap))[Column]
				+ SOverlay::Slot()[Bar]
			]
		];
}

TSharedRef<SWidget> ABpTable::DeckWallDecision(int32 ScreenIndex) const
{
	// Wave U3 (the owner, night four: the room's decision on the wall was the deck's card scaled up, not the wall's family): the
	// stand-up's decision on the wall (BpStandup.cpp's DrawStandup, bWall) on the console's grid, from the deck's own data. The
	// header names the room and where the queue stands ("3 OF 19"); three columns: the kicker, the title, its consequence and
	// what each answer does; the finding's screen with its loupe; what it touches over the title block. The answers' row is the
	// deck's acts (DeckWallBoxes, DeckHit): APPROVE, DECLINE, PREV, NEXT, and SCAN THIS ROOM in the header.
	const FDeckScreen& Screen = DeckScreens[ScreenIndex];
	const bool bFront = ScreenIndex == DeckAt;
	if (bFront) { DeckWallLoupeAim = FVector2f(-1.f, -1.f); DeckWallTitleAim = FVector2f(-1.f, -1.f); }
	const FBpLinkModule& Link = FBpLinkModule::Get();
	const FBpScanState& State = Link.GetScanState();
	const FBpProposal* P = State.Scan.proposals.FindByPredicate([&Screen](const FBpProposal& X) { return X.id == Screen.Proposal; });
	const FBpPlanTile* Tile = P && SheetPlan.IsValid() ? SheetPlan->tiles.FindByPredicate([P](const FBpPlanTile& T) { return T.id == P->feature; }) : nullptr;
	const FBpPlanBay* Bay = Tile ? SheetPlan->bays.FindByPredicate([Tile](const FBpPlanBay& B) { return B.id == Tile->parentId; }) : nullptr;
	const FBpPlanRoom* Room = FindRoom(DeckRoom);
	const int32* Tier = P ? State.Tiers.Find(P->id) : nullptr;
	const FBpDecisionBrief* Brief = P ? DeckBrief(P->id) : nullptr;
	const bool bRepeat = Brief && FBpLinkModule::IsRepeat(*Brief);
	bool bInDraft = P && DeckInDraft.Contains(P->id);
	for (const FBpWave& Wave : State.Waves)
	{
		if (bInDraft || Wave.status != BpVocab::Wave::Status::Draft || !P) continue;
		for (const FBpWavePackage& Package : Wave.packages) if (Package.ids.Contains(P->id)) bInDraft = true;
	}
	const auto SFont = [](const TCHAR* Style, float CapPx) { return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style)); };
	const auto SPitch = [](float CapPx) { return BpSheet::LinePitch(CapPx, static_cast<float>(BpType::CapPerEm)); };
	const FSlateFontInfo SmallBold = SFont(TEXT("Bold"), 24.f), Small = SFont(TEXT("Regular"), 24.f), LabelFont = SFont(TEXT("Bold"), 28.f), AnswerFont = SFont(TEXT("Bold"), 32.f);
	const FSlateFontInfo TitleFont = SFont(TEXT("Bold"), 32.f), HeadTitle = SFont(TEXT("Bold"), 36.f);
	TSharedRef<SCanvas> Canvas = SNew(SCanvas);
	const auto Put = [&Canvas](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Canvas->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	const auto Words = [&Put](const FBox2f& Box, const FString& Text, const FSlateFontInfo& Font, const FLinearColor& Color, EVerticalAlignment V = VAlign_Top)
	{
		Put(Box, SNew(SBox).VAlign(V)[SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(FSlateColor(Color))]);
	};
	// The queue's place: the room's decisions (as the desk's card counts them).
	int32 Nth = 0, Of = 0;
	for (int32 Index = 0; Index < DeckScreens.Num(); ++Index) if (DeckScreens[Index].Kind == KDecision) { ++Of; if (Index == ScreenIndex) Nth = Of; }
	FBox2f ApproveB, DeclineB, PrevB, NextB, ScanB;
	DeckWallBoxes(bRepeat, ApproveB, DeclineB, PrevB, NextB, ScanB);

	// ---- The header: the bubble and the room, where the queue stands and whose morning, SCAN THIS ROOM ----------------------
	const FString RoomName = Room && !Room->name.IsEmpty() ? Room->name : FString(TEXT("This room"));
	const FString Pos = FString::Printf(TEXT("%d OF %d"), Nth, Of);
	const FString Whose = Link.HasPcLink() ? FString(TEXT("FROM YOUR PC")) : FString(TEXT("SAMPLE"));
	const float HeadX1 = (DeckScanRoute() ? ScanB.Min.X : LW - WPad) - 24.f;
	const float PosW = BpSheet::TextWidth(Pos, LabelFont), WhoseW = BpSheet::ChipWidth(Whose, SmallBold);
	Words(FBox2f(FVector2f(HeadX1 - PosW, WHeadY0), FVector2f(HeadX1, WHeadY1)), Pos, LabelFont, BpSheet::Ink.CopyWithNewOpacity(0.9f), VAlign_Center);
	// Whose morning stands at the sub-line's right end, so the room's name keeps the header (it was cut: "MEMBERSHIPS & PAYM...").
	Put(FBox2f(FVector2f(LW - WPad - WhoseW, WSubY + 2.f), FVector2f(LW - WPad, WSubY + 42.f)), BpSheet::Chip(Whose, SmallBold, 40.f, Link.HasPcLink() ? BpSheet::Accent : BpSheet::Amber, !Link.HasPcLink()));
	const float TitleX1 = HeadX1 - PosW - 24.f;
	Put(FBox2f(FVector2f(WPad, WHeadY0), FVector2f(TitleX1, WHeadY1)),
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 16.f, 0.f)[BpSheet::Bubble(TEXT("D"), SFont(TEXT("Bold"), 20.f), 44.f, BpSheet::Accent)]
		+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(BpSheet::Cut(RoomName.ToUpper(), HeadTitle, TitleX1 - WPad - 60.f))).Font(HeadTitle).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
	if (DeckScanRoute()) Put(ScanB, BpSheet::Control(TEXT("SCAN THIS ROOM"), LabelFont, BpSheet::ELook::Edge));
	// The sub-line: the finding's chips (the lens, the risk with the ledger's colour, the tier, IN DRAFT), then the fine rule.
	{
		float X = WPad;
		const float ChipY0 = WSubY + 2.f, ChipH = 40.f;
		const auto AddChip = [&](const FString& Text, const FLinearColor& Color, bool bSolid)
		{
			const float W = BpSheet::ChipWidth(Text, SmallBold);
			if (X + W > LW - WPad - WhoseW - 16.f) return;
			Put(FBox2f(FVector2f(X, ChipY0), FVector2f(X + W, ChipY0 + ChipH)), BpSheet::Chip(Text, SmallBold, ChipH, Color, bSolid));
			X += W + 12.f;
		};
		if (bRepeat) AddChip(TEXT("REPEATS A DECLINE"), BpSheet::Red, false);
		if (P) AddChip(LensWord(P->lens) + TEXT(" LENS"), BpSheet::Accent, false);
		if (P && P->risk > 0.0) AddChip(FString::Printf(TEXT("RISK %s"), *Number(P->risk)), BpSheet::RiskColor(P->risk), false);
		if (bInDraft) AddChip(TEXT("IN DRAFT WAVE"), BpSheet::Accent, true);
		Put(FBox2f(FVector2f(WPad, WSubY + 46.f), FVector2f(LW - WPad, WSubY + 48.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
	}
	// The strip: one segment per decision of the room, the one shown amber, those before it filled.
	{
		const int32 N = FMath::Max(1, Of);
		const float Gap = N > 24 ? 3.f : 6.f, W = (LW - 2.f * WPad - Gap * (N - 1)) / N;
		for (int32 Index = 0; Index < N; ++Index)
		{
			const FLinearColor Fill = Index + 1 == Nth ? BpSheet::Amber : Index + 1 < Nth ? BpSheet::Ink.CopyWithNewOpacity(0.55f) : FLinearColor::Transparent;
			const float X0 = WPad + Index * (W + Gap);
			Put(FBox2f(FVector2f(X0, WStripY0), FVector2f(X0 + W, WStripY1)), SNew(BpSheet::SPlate).Fill(Fill).Edge(BpSheet::Amber.CopyWithNewOpacity(0.85f)).EdgePx(1.5f));
		}
	}

	// ---- The frame and its three columns (the stand-up's wall: ColX1 = Pad + 506, the right column 340 wide) ---------------
	const FBox2f WFrame(FVector2f(WPad, WFrameY0), FVector2f(LW - WPad, WFrameY1));
	Put(WFrame, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.32f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
	const float TextX1 = WFrame.Max.X - 26.f, RightX0 = TextX1 - 340.f, ColX1 = WPad + 506.f;
	const bool bStop = Tier && *Tier == 0;
	const FLinearColor Tone = bRepeat || bStop ? BpSheet::Red : BpSheet::Amber;
	// The left column: the kicker, the title, the one line of consequence, what each answer does.
	FString Kicker = FString::Printf(TEXT("DECISION %d OF %d"), Nth, Of);
	if (BpSheet::TextWidth(Kicker + TEXT(" · IN THIS ROOM"), SmallBold) <= ColX1 - WInX) Kicker += TEXT(" · IN THIS ROOM");
	Words(FBox2f(FVector2f(WInX, WFrameY0 + 16.f), FVector2f(ColX1, WFrameY0 + 48.f)), Kicker, SmallBold, Tone);
	const FString HeadFit = BpSheet::Wrap(P ? P->title : Screen.Proposal, TitleFont, ColX1 - WInX, 3);
	const int32 HeadLines = BpSheet::Lines(HeadFit);
	const FBox2f HeadBox(FVector2f(WInX, WFrameY0 + 52.f), FVector2f(ColX1, WFrameY0 + 52.f + HeadLines * SPitch(32.f) + 6.f));
	Put(HeadBox, SNew(STextBlock).Text(FText::FromString(HeadFit)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
	if (bFront)
	{
		const int32 Break = HeadFit.Find(TEXT("\n"));
		DeckWallTitleAim = FVector2f(WInX + FMath::Min(BpSheet::TextWidth(Break == INDEX_NONE ? HeadFit : HeadFit.Left(Break), TitleFont), ColX1 - WInX) * 0.35f, HeadBox.Min.Y + SPitch(32.f) * 0.5f);
	}
	float Y = WFrameY0 + 58.f + HeadLines * SPitch(32.f) + 6.f;
	// The consequence: the brief's first line (where the change lands, what depends on it); without a brief, where it is.
	TArray<FString> Evidence = Brief ? Brief->lines : TArray<FString>();
	const FString First = Evidence.Num() > 0 ? Evidence[0] : P ? (Tile ? TEXT("On ") + Tile->name + (Bay ? TEXT(" in ") + Bay->name : FString()) : TEXT("On ") + P->feature) : FString();
	const bool bBriefLead = Evidence.Num() > 0;
	if (Evidence.Num() > 0) Evidence.RemoveAt(0);
	// Without a brief the line is only where it is, which the right column says: as the stand-up's wall, it is not repeated.
	if (!First.IsEmpty() && bBriefLead)
	{
		const FString Fit = BpSheet::Wrap(First, Small, ColX1 - WInX, 2);
		Put(FBox2f(FVector2f(WInX, Y), FVector2f(ColX1, Y + BpSheet::Lines(Fit) * SPitch(24.f) + 4.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(Small).ColorAndOpacity(FSlateColor(BpSheet::InkHi)));
		Y += BpSheet::Lines(Fit) * SPitch(24.f) + 10.f;
	}
	Y += 4.f;
	Words(FBox2f(FVector2f(WInX, Y), FVector2f(ColX1, Y + 34.f)), TEXT("WHAT EACH ANSWER DOES"), SmallBold, BpSheet::Accent);
	Y += 40.f;
	{
		// In the deck's own terms (DeckApprove, DeckDecline): what each of this sheet's answers does.
		struct FDoes { const TCHAR* Word; FString Does; FLinearColor Ink; };
		TArray<FDoes> Does;
		if (bRepeat) Does.Add({ TEXT("DECLINE"), TEXT("declined in the store, as a repeat"), BpSheet::Amber });
		Does.Add({ TEXT("APPROVE"), bRepeat ? TEXT("overrides: into the draft wave") : TEXT("into the draft wave"), bRepeat ? BpSheet::InkHi : BpSheet::Amber });
		if (!bRepeat) Does.Add({ TEXT("DECLINE"), TEXT("off this visit's queue"), BpSheet::InkHi });
		Does.Add({ TEXT("NEXT"), TEXT("it waits here for later"), BpSheet::InkHi });
		const float WordW = BpSheet::TextWidth(TEXT("APPROVE"), SmallBold) + 16.f;
		for (const FDoes& Each : Does)
		{
			const FString Fit = BpSheet::Wrap(Each.Does, Small, ColX1 - WInX - WordW, 2);
			const float H = BpSheet::Lines(Fit) * SPitch(24.f);
			if (Y + H > WFrame.Max.Y - 6.f) break;
			Put(FBox2f(FVector2f(WInX, Y), FVector2f(WInX + WordW, Y + SPitch(24.f) + 2.f)), SNew(STextBlock).Text(FText::FromString(Each.Word)).Font(SmallBold).ColorAndOpacity(FSlateColor(Each.Ink)));
			Put(FBox2f(FVector2f(WInX + WordW, Y), FVector2f(ColX1, Y + H + 2.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(Small).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.9f))));
			Y += H + 2.f;
		}
	}

	// The middle column: the finding's "before" at the top and its loupe under it (the densest words, several times larger), as
	// the stand-up's; no screen for this finding: its evidence there instead, quiet, each line whole.
	const float ImgX0 = ColX1 + 24.f, ImgX1 = RightX0 - 24.f, ImgW = ImgX1 - ImgX0;
	const bool bScreen = P && ABpPawn::FindBeforeShot(P->id) != nullptr;
	const bool bHave = bScreen && DeckShotFor == P->id && DeckShotBrush.IsValid() && DeckShot;
	FBox2f Img(FVector2f(ImgX0, WFrameY0 + 16.f), FVector2f(ImgX1, WFrameY0 + 16.f + ImgW * 9.f / 16.f));
	if (bScreen)
	{
		const FBox2f Lb(FVector2f(ImgX0, Img.Max.Y + 16.f), FVector2f(ImgX1, WFrame.Max.Y - 12.f));
		FBox2f Uv;
		if (bHave && Lb.GetSize().Y > 60.f && BpProjector::LoupeRegion(DeckShot.Get(), nullptr, Lb.GetSize().X / Lb.GetSize().Y, 0.2f, Uv))
		{
			const int32 Times = FMath::RoundToInt(Lb.GetSize().X / (Uv.GetSize().X * Img.GetSize().X));
			const TSharedPtr<FSlateBrush> Crop = MakeShared<FSlateBrush>(*DeckShotBrush);
			Crop->SetUVRegion(Uv);
			Put(Lb.ExpandBy(5.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Amber).EdgePx(3.f));
			Put(Lb, SNew(SImage).Image_Lambda([Crop]() { return Crop.Get(); }));
			const FString Cap = FString::Printf(TEXT("BEFORE · %d×"), Times);
			const float CapW = BpSheet::TextWidth(Cap, SmallBold) + 28.f;
			Put(FBox2f(Lb.Min, FVector2f(Lb.Min.X + CapW, Lb.Min.Y + 40.f)), BpSheet::Pin(Cap, SmallBold, 40.f, BpSheet::Ink, CapW));
			// Its place on the screen, a fine amber frame.
			Put(FBox2f(Img.Min + Uv.Min * Img.GetSize(), Img.Min + Uv.Max * Img.GetSize()).ExpandBy(2.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(3.f));
			if (bFront) DeckWallLoupeAim = Img.Min + (Uv.Min + Uv.Max) * 0.5f * Img.GetSize();
		}
		else if (bHave)
		{
			// No region of words worth a loupe: the screen takes the column, as large as it fits, centred.
			const float AvailH = Lb.Max.Y - (WFrameY0 + 16.f);
			const float H = FMath::Min(ImgW * 9.f / 16.f, AvailH), W = H * 16.f / 9.f;
			const float X0 = ImgX0 + (ImgW - W) * 0.5f, Y0 = WFrameY0 + 16.f + (AvailH - H) * 0.5f;
			Img = FBox2f(FVector2f(X0, Y0), FVector2f(X0 + W, Y0 + H));
		}
		if (bHave)
		{
			Put(Img.ExpandBy(5.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Ink.CopyWithNewOpacity(0.8f)).EdgePx(2.f));
			Put(Img, SNew(SImage).Image_Lambda([Brush = DeckShotBrush]() { return Brush.Get(); }));
		}
		else
		{
			Put(Img, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.4f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.35f)).EdgePx(2.f));
			Put(Img, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock)
				.Text(FText::FromString(DeckShotFor != P->id || bDeckShotLoading ? TEXT("READING THE SCREEN") : TEXT("NO SCREEN FOR THIS FINDING"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.55f)))]);
		}
		// The caption: which screen (the right column names the place), SAMPLE when it is one.
		const bool bSampleShot = bHave && bDeckShotSample;
		const float TagW = bSampleShot ? BpSheet::TextWidth(TEXT("SAMPLE"), SmallBold) + 28.f : 0.f;
		Put(FBox2f(FVector2f(Img.Min.X, Img.Max.Y - 40.f), Img.Max), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.9f)));
		Put(FBox2f(FVector2f(Img.Min.X + 12.f, Img.Max.Y - 40.f), FVector2f(Img.Max.X - TagW - 12.f, Img.Max.Y)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(TEXT("BEFORE"))).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::InkHi))]);
		if (bSampleShot) Put(FBox2f(FVector2f(Img.Max.X - TagW, Img.Max.Y - 40.f), Img.Max), BpSheet::Pin(TEXT("SAMPLE"), SmallBold, 40.f, BpSheet::Amber, TagW));
	}
	else
	{
		// The evidence (the brief's other lines; without a brief the finding's own words, its size and date), each whole.
		if (Evidence.Num() == 0 && P)
		{
			TArray<FString> Body;
			P->body.ParseIntoArrayLines(Body, true);
			for (const FString& Raw : Body)
			{
				FString Line = Plain(Raw);
				if (Line.StartsWith(TEXT("#")) || Line.IsEmpty()) continue;
				if (Line.StartsWith(TEXT("- ")) || Line.StartsWith(TEXT("* "))) Line = Line.Mid(2);
				Evidence.Add(Line);
				if (Evidence.Num() >= 4) break;
			}
		}
		float EY = WFrameY0 + 16.f;
		Words(FBox2f(FVector2f(ImgX0, EY), FVector2f(ImgX1, EY + 34.f)), TEXT("THE EVIDENCE"), SmallBold, BpSheet::Accent);
		EY += 44.f;
		for (const FString& Line : Evidence)
		{
			const FString Fit = BpSheet::Wrap(Line, Small, ImgW - 28.f, 0);
			const float H = BpSheet::Lines(Fit) * SPitch(24.f);
			if (EY + H > WFrame.Max.Y - 12.f) break;
			Put(FBox2f(FVector2f(ImgX0, EY + SPitch(24.f) * 0.5f - 7.f), FVector2f(ImgX0 + 12.f, EY + SPitch(24.f) * 0.5f + 5.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.45f)));
			Put(FBox2f(FVector2f(ImgX0 + 28.f, EY), FVector2f(ImgX1, EY + H + 4.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(Small).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.85f))));
			EY += H + 10.f;
		}
		Img = FBox2f(FVector2f(ImgX0, WFrameY0 + 120.f), FVector2f(ImgX1, WFrameY0 + 300.f));
	}

	// The right column: what it touches. The tier pin, the feature (bold) and where it is, who raised it, its size and age, a
	// precedent; each whole (two lines at most), down to the title block.
	{
		const float RX0 = RightX0, RX1 = TextX1;
		float RY = WFrameY0 + 16.f;
		Words(FBox2f(FVector2f(RX0, RY), FVector2f(RX1, RY + 34.f)), TEXT("WHAT IT TOUCHES"), SmallBold, BpSheet::Accent);
		const FString Chip = Tier ? FString::Printf(TEXT("T%d %s"), *Tier, *TierWord(*Tier)) : FString(TEXT("UNTIERED"));
		const float ChipW = FMath::Min(RX1 - RX0, BpSheet::TextWidth(Chip, SmallBold) + 28.f);
		Put(FBox2f(FVector2f(RX0, RY + 40.f), FVector2f(RX0 + ChipW, RY + 78.f)), BpSheet::Pin(Chip, SmallBold, 38.f, bStop ? BpSheet::Red : BpSheet::Amber, ChipW));
		RY += 84.f;
		struct FTouch { FString Words; const FSlateFontInfo* Face; FLinearColor Ink; };
		TArray<FTouch> Touches;
		Touches.Add({ Tile ? Tile->name : P ? P->feature : FString(), &SmallBold, BpSheet::InkHi });
		const FString Where = Bay ? FString::Printf(TEXT("in %s, %s"), *Bay->name, *RoomName) : FString::Printf(TEXT("in %s"), *RoomName);
		Touches.Add({ Where, &Small, BpSheet::Ink });
		if (P) Touches.Add({ FString::Printf(TEXT("Raised by the %s lens%s"), *BpWords::Lens(P->lens), P->risk > 0.0 ? *FString::Printf(TEXT(", risk %s"), *Number(P->risk)) : TEXT("")), &Small, BpSheet::Ink });
		if (P)
		{
			TArray<FString> Meta;
			if (!P->size.IsEmpty()) Meta.Add(TEXT("Size ") + P->size);
			if (!P->created_at.IsEmpty()) Meta.Add(TEXT("proposed ") + P->created_at.Left(10));
			if (Meta.Num() > 0) Touches.Add({ FString::Join(Meta, TEXT(" · ")), &Small, BpSheet::Ink.CopyWithNewOpacity(0.75f) });
		}
		if (Brief) for (const auto& Fact : Brief->facts) if (Fact.key == BpVocab::BriefFact::Key::Precedent || Fact.key == BpVocab::BriefFact::Key::Declined) Touches.Add({ Fact.text, &Small, Fact.key == BpVocab::BriefFact::Key::Declined ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.75f) });
		const float RYMax = WFrame.Max.Y - 52.f;
		for (const FTouch& Each : Touches)
		{
			if (Each.Words.IsEmpty()) continue;
			const FString Fit = BpSheet::Wrap(Each.Words, *Each.Face, RX1 - RX0, 2);
			const float H = BpSheet::Lines(Fit) * SPitch(24.f) * 0.92f;
			if (RY + H > RYMax) break;
			Put(FBox2f(FVector2f(RX0, RY), FVector2f(RX1, RY + H + 2.f)), SNew(STextBlock).Text(FText::FromString(Fit)).Font(*Each.Face).LineHeightPercentage(0.92f).ColorAndOpacity(FSlateColor(Each.Ink)));
			RY += H + 6.f;
		}
		// The title block closing the column: the finding's id, the product and whose morning.
		const FString No = P ? P->id.ToUpper() : Screen.Proposal.ToUpper();
		const FString ProductName = Link.GetProductName().IsEmpty() ? Link.NameOf(Link.GetProductSlug()) : Link.GetProductName();
		// The product and the day (a finding's id is longer than the stand-up's "M-04"; SAMPLE is the header's chip already).
		const FString Proj = ProductName.ToUpper() + (Link.HasPcLink() ? TEXT(" · ") + FDateTime::Now().ToString(TEXT("%d.%m.")) : FString());
		const FBox2f Block(FVector2f(RightX0 - 12.f, WFrame.Max.Y - 46.f), WFrame.Max);
		const float NoW = FMath::Min(BpSheet::TextWidth(No, SmallBold), Block.GetSize().X * 0.5f);
		Put(Block, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.5f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
		Put(FBox2f(FVector2f(Block.Min.X + NoW + 26.f, Block.Min.Y + 8.f), FVector2f(Block.Min.X + NoW + 28.f, Block.Max.Y - 8.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.5f)));
		Words(FBox2f(Block.Min + FVector2f(14.f, 0.f), FVector2f(Block.Min.X + NoW + 20.f, Block.Max.Y)), BpSheet::Cut(No, SmallBold, NoW + 4.f), SmallBold, BpSheet::Accent, VAlign_Center);
		Words(FBox2f(FVector2f(Block.Min.X + NoW + 40.f, Block.Min.Y), Block.Max - FVector2f(10.f, 0.f)), BpSheet::Cut(Proj, Small, Block.Max.X - Block.Min.X - NoW - 52.f), Small, BpSheet::Ink.CopyWithNewOpacity(0.85f), VAlign_Center);
	}

	// The answer taken lands as the stand-up's stamp, on the sheet as it slides away (GDeckStamp, DeckApprove/DeckDecline).
	if (const FString* Stamp = P ? GDeckStamp.Find(P->id) : nullptr)
	{
		const FLinearColor StampInk = Stamp->StartsWith(TEXT("APPROVED")) ? BpSheet::Accent : BpSheet::Red;
		const FSlateFontInfo StampFont = SFont(TEXT("Bold"), 40.f);
		const float StampW = BpSheet::TextWidth(*Stamp, StampFont) + 56.f, StampH = 84.f;
		const FVector2f C = Img.GetCenter();
		Put(FBox2f(C - FVector2f(StampW, StampH) * 0.5f, C + FVector2f(StampW, StampH) * 0.5f), SNew(SBox).RenderTransformPivot(FVector2D(0.5, 0.5)).RenderTransform(FSlateRenderTransform(FQuat2D(FMath::DegreesToRadians(-7.f))))
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.94f)).Edge(StampInk).EdgePx(5.f)]
				+ SOverlay::Slot().Padding(9.f)[SNew(BpSheet::SPlate).Edge(StampInk.CopyWithNewOpacity(0.6f)).EdgePx(1.5f)]
				+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(*Stamp)).Font(StampFont).ColorAndOpacity(FSlateColor(StampInk))]
			]);
	}

	// The status line, then the answers' row: PREV, the answers, NEXT (the deck's acts, DeckWallBoxes).
	const FString Status = bRepeat ? FString(TEXT("You declined this idea before: DECLINE · REPEAT declines it in the store, APPROVE overrides."))
		: FString(TEXT("APPROVE puts it in the draft wave; nothing is built."));
	Words(FBox2f(FVector2f(WPad + 4.f, WStatusY0), FVector2f(LW - WPad, WStatusY1)), BpSheet::CutWords(Status, Small, LW - 2.f * WPad - 8.f), Small, BpSheet::Ink.CopyWithNewOpacity(0.85f), VAlign_Center);
	const bool bPrevOk = DeckAt > 0, bNextOk = DeckAt + 1 < DeckScreens.Num();
	Put(PrevB, BpSheet::Control(TEXT("‹  PREV"), LabelFont, bPrevOk ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
	Put(NextB, BpSheet::Control(TEXT("NEXT  ›"), LabelFont, bNextOk ? BpSheet::ELook::Edge : BpSheet::ELook::Off));
	Put(ApproveB, BpSheet::Control(TEXT("APPROVE"), AnswerFont, bRepeat ? BpSheet::ELook::Edge : BpSheet::ELook::Amber));
	Put(DeclineB, BpSheet::Control(bRepeat ? TEXT("DECLINE · REPEAT") : TEXT("DECLINE"), AnswerFont, bRepeat ? BpSheet::ELook::Amber : BpSheet::ELook::Edge));
	if (bFront)
	{
		static FString Shown;
		const FString Key = FString::Printf(TEXT("%s %d/%d %d"), *Screen.Proposal, Nth, Of, bHave);
		if (Key != Shown)
		{
			Shown = Key;
			UE_LOG(LogBpTable, Log, TEXT("BpDeck: the wall's decision %s, %d of %d in %s (%s, the wall's three columns, drawn %.0f px wide)"), *Screen.Proposal, Nth, Of, *DeckRoom,
				bHave ? (DeckWallLoupeAim.X >= 0.f ? TEXT("its screen and loupe") : TEXT("its screen, no loupe")) : bScreen ? TEXT("its screen being read") : TEXT("no screen: its evidence"), DeckCards.Num() > 0 ? DeckCards[0]->GetDrawSize().X : 0.0);
		}
	}
	return SNew(SDPIScaler).DPIScale(DeckCards.Num() > 0 ? static_cast<float>(DeckCards[0]->GetDrawSize().X) / LW : DeckPxPerCm / DeckLayoutPxPerCm)
		[
			SNew(SBox).WidthOverride(LW).HeightOverride(LH)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(48.f).RulePx(5.f)]
				+ SOverlay::Slot()[Canvas]
			]
		];
}

TSharedRef<SWidget> ABpTable::SpineWidget(int32 ScreenIndex) const
{
	// A screen's edge (FAI): its surface, and along it, reading up, its kind and its title, cut to the spine's length.
	const FDeckScreen& Screen = DeckScreens[ScreenIndex];
	const bool bPaper = PaperScreen(Screen.Kind);
	static const FSlateRoundedBoxBrush GlassSpine(GlassDark, 0.f, CyanEdge.CopyWithNewOpacity(0.8f), 3.f);
	static const FSlateRoundedBoxBrush PaperSpine(PaperTone, 0.f, PaperEdge.CopyWithNewOpacity(0.9f), 3.f);
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
