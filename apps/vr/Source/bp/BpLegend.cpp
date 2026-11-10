// The controls legend beside the table (wave Q1). The owner, after three minutes in the Quest 3S on 2026-11-10: "The
// orientation which control element does what was not clear, hinting graphics/legend on left or right side from the table
// could help."
//
// A small standing plate beyond the table's right end, at its near corner, turned to the seated eye: the right side because
// Glim lives at the far left and the wrist is the left hand. It is part of the drawing set (BpSheet.h: the paper, the
// double-rule wall, the ink), never a floating tooltip: one opaque, unlit widget quad, drawn into its render target only when
// what it shows changes (LegendKey), with no tick of its own. It belongs to the table, so it stays in your room.
//
//   HANDS (the default)    pinch-tap, pinch and pull, push away or BACK, hold Glim or TALK, the left wrist
//   CONTROLLERS            the stick, A, B, Y, hold X, the trigger (when the controllers lead: UBpHands' input)
//
// At rest the lines are ink at 60 %; during a tour step the line that step asks for is lit in amber; in a room the lines
// that act there lead. Each line is a glyph drawn with the widget's own lines (a pinch, an arrow, a ring with its letter) and
// three or four words. bp.Legend (SETTINGS > LEGEND, saved through FBpStore by BpAudio.cpp's list) turns it off;
// bp.Legend.Mode forces a column for a capture.
#include "BpTable.h"

#include "BpHands.h"
#include "BpPawn.h"
#include "BpSheet.h"
#include "BpType.h"
#include "Components/WidgetComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	TAutoConsoleVariable<int32> CVarLegend(TEXT("bp.Legend"), 1,
		TEXT("The controls legend beside the table (BpLegend.cpp): 1 shown (default), 0 hidden. SETTINGS > LEGEND toggles it; saved across runs."));
	TAutoConsoleVariable<int32> CVarLegendMode(TEXT("bp.Legend.Mode"), -1,
		TEXT("The legend's column: -1 follows the input (hands, or the controllers when they lead), 0 HANDS, 1 CONTROLLERS (captures)."));

	/** Where it stands, in the table's space (cm): on the table's right end at its near corner (the table is 180 wide, the
	 *  paper 166, the near edge at -45), its foot on the top. Turned to the eye, its inner edge stays over the frame's rim and
	 *  every ray from the seat through it lands beyond the paper's edge, so it covers no paper. About 106 cm from the eye. */
	constexpr float LegendXCm = -30.f;
	constexpr float LegendYCm = 92.f;
	constexpr float LegendFootCm = 0.5f;
	constexpr float LegendPxPerCm = 20.f;
	/** Every line's cap height (cm): 1.05 cm at 110 cm is about 33 arcminutes (the brief's floor: 30). */
	constexpr float LegendCapCm = 1.05f;
	/** Ink at rest. */
	constexpr float LegendRest = 0.6f;

	enum class EGlyph : uint8 { Tap, Pull, Push, Talk, Wrist, Stick, Button, Trigger };

	struct FLegendLine
	{
		const TCHAR* Id;
		EGlyph Glyph;
		const TCHAR* Letter;
		const TCHAR* Key;
		const TCHAR* Words;
	};

	const FLegendLine HandLines[] = {
		{ TEXT("tap"), EGlyph::Tap, TEXT(""), TEXT("Pinch-tap"), TEXT("open or press") },
		{ TEXT("pull"), EGlyph::Pull, TEXT(""), TEXT("Pinch and pull"), TEXT("bring closer") },
		{ TEXT("push"), EGlyph::Push, TEXT(""), TEXT("Push away or BACK"), TEXT("step out") },
		{ TEXT("talk"), EGlyph::Talk, TEXT(""), TEXT("Hold Glim or TALK"), TEXT("talk") },
		{ TEXT("wrist"), EGlyph::Wrist, TEXT(""), TEXT("Turn your left wrist"), TEXT("quick decisions") },
	};
	const FLegendLine PadLines[] = {
		{ TEXT("stick"), EGlyph::Stick, TEXT(""), TEXT("Stick"), TEXT("move the focus") },
		{ TEXT("a"), EGlyph::Button, TEXT("A"), TEXT("A"), TEXT("select") },
		{ TEXT("b"), EGlyph::Button, TEXT("B"), TEXT("B"), TEXT("back") },
		{ TEXT("y"), EGlyph::Button, TEXT("Y"), TEXT("Y"), TEXT("menu") },
		{ TEXT("x"), EGlyph::Button, TEXT("X"), TEXT("Hold X"), TEXT("talk") },
		{ TEXT("trigger"), EGlyph::Trigger, TEXT(""), TEXT("Trigger"), TEXT("pinch") },
	};

	FSlateFontInfo LegendFont(const TCHAR* Style, float CapPx)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
	}

	/** A line's glyph, drawn with lines in its box (no image, no controller art). */
	class SLegendGlyph : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SLegendGlyph) : _Kind(EGlyph::Tap), _Color(FLinearColor::White) {}
			SLATE_ARGUMENT(EGlyph, Kind)
			SLATE_ARGUMENT(FLinearColor, Color)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Kind = Args._Kind; Color = Args._Color; }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(40.0, 40.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const float U = FMath::Min(Size.X, Size.Y) / 40.f;
			const FVector2f O = (Size - FVector2f(40.f * U)) * 0.5f;
			const float T = FMath::Max(2.f, 2.6f * U);
			const auto P = [&](float X, float Y) { return O + FVector2f(X, Y) * U; };
			const auto Poly = [&](std::initializer_list<FVector2f> Points, bool bClosed = false)
			{
				TArray<FVector2f> Pts(Points);
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Pts, ESlateDrawEffect::None, Color, true, T);
				if (bClosed && Pts.Num() > 2)
				{
					TArray<FVector2f> Close = { Pts.Last(), Pts[0] };
					FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Close, ESlateDrawEffect::None, Color, true, T);
				}
			};
			const auto Arc = [&](float CX, float CY, float R, float FromDeg, float ToDeg)
			{
				TArray<FVector2f> Pts;
				for (int32 Step = 0; Step <= 16; ++Step)
				{
					const float A = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, Step / 16.f));
					Pts.Add(P(CX + R * FMath::Cos(A), CY + R * FMath::Sin(A)));
				}
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Pts, ESlateDrawEffect::None, Color, true, T);
			};
			// A thumb and a finger closing on a point.
			const auto Pinch = [&](float X, float Y)
			{
				Poly({ P(X - 11.f, Y + 9.f), P(X - 6.f, Y + 1.f), P(X - 1.f, Y) });
				Poly({ P(X + 11.f, Y - 9.f), P(X + 6.f, Y - 2.f), P(X + 1.f, Y) });
				Arc(X, Y, 2.2f, 0.f, 360.f);
			};
			const auto Arrow = [&](float X0, float Y0, float X1, float Y1)
			{
				Poly({ P(X0, Y0), P(X1, Y1) });
				const FVector2f D = (FVector2f(X1 - X0, Y1 - Y0)).GetSafeNormal();
				const FVector2f N(-D.Y, D.X);
				const FVector2f Tip(X1, Y1);
				const FVector2f L = Tip - D * 6.f + N * 5.f, R = Tip - D * 6.f - N * 5.f;
				Poly({ P(L.X, L.Y), P(Tip.X, Tip.Y), P(R.X, R.Y) });
			};
			switch (Kind)
			{
			case EGlyph::Tap:
				Pinch(20.f, 22.f);
				Poly({ P(20.f, 9.f), P(20.f, 13.f) });
				Poly({ P(29.f, 13.f), P(26.f, 16.f) });
				Poly({ P(11.f, 13.f), P(14.f, 16.f) });
				break;
			case EGlyph::Pull:
				Pinch(20.f, 12.f);
				Arrow(20.f, 18.f, 20.f, 36.f);
				break;
			case EGlyph::Push:
				Poly({ P(9.f, 34.f), P(31.f, 34.f) });
				Poly({ P(11.f, 34.f), P(11.f, 28.f) });
				Poly({ P(29.f, 34.f), P(29.f, 28.f) });
				Arrow(20.f, 30.f, 20.f, 5.f);
				break;
			case EGlyph::Talk:
				// Glim's head (a ring with its lens), and two arcs of voice.
				Arc(15.f, 20.f, 9.f, 0.f, 360.f);
				Arc(15.f, 20.f, 3.f, 0.f, 360.f);
				Arc(26.f, 20.f, 5.f, -50.f, 50.f);
				Arc(28.f, 20.f, 10.f, -45.f, 45.f);
				break;
			case EGlyph::Wrist:
				// The band on a forearm, and the turn.
				Poly({ P(6.f, 25.f), P(34.f, 25.f) });
				Poly({ P(6.f, 34.f), P(34.f, 34.f) });
				Poly({ P(15.f, 22.f), P(25.f, 22.f), P(25.f, 37.f), P(15.f, 37.f) }, true);
				Arc(20.f, 16.f, 10.f, 200.f, 340.f);
				Arrow(28.f, 11.5f, 30.f, 15.5f);
				break;
			case EGlyph::Stick:
				Arc(20.f, 20.f, 13.f, 0.f, 360.f);
				Arc(20.f, 20.f, 4.f, 0.f, 360.f);
				Poly({ P(20.f, 3.f), P(17.f, 6.5f) }); Poly({ P(20.f, 3.f), P(23.f, 6.5f) });
				Poly({ P(20.f, 37.f), P(17.f, 33.5f) }); Poly({ P(20.f, 37.f), P(23.f, 33.5f) });
				Poly({ P(3.f, 20.f), P(6.5f, 17.f) }); Poly({ P(3.f, 20.f), P(6.5f, 23.f) });
				Poly({ P(37.f, 20.f), P(33.5f, 17.f) }); Poly({ P(37.f, 20.f), P(33.5f, 23.f) });
				break;
			case EGlyph::Trigger:
				// A finger's curl on a trigger's edge.
				Poly({ P(10.f, 6.f), P(10.f, 22.f), P(14.f, 30.f), P(22.f, 34.f), P(32.f, 34.f) });
				Arc(24.f, 16.f, 7.f, 90.f, 250.f);
				break;
			case EGlyph::Button:
				break;
			}
			return Layer + 1;
		}

	private:
		EGlyph Kind = EGlyph::Tap;
		FLinearColor Color = FLinearColor::White;
	};

	float TextW(const FString& Text, const FSlateFontInfo& Font) { return BpSheet::TextWidth(Text, Font); }
}

bool ABpPawn::UsesControllers() const
{
	return Hands && Hands->UsesControllers();
}

void ABpTable::InitLegend()
{
	Legend = NewObject<UWidgetComponent>(this, TEXT("Legend"));
	Legend->SetupAttachment(Root);
	Legend->SetWidgetSpace(EWidgetSpace::World);
	Legend->SetDrawAtDesiredSize(false);
	Legend->SetPivot(FVector2D(0.5, 0.5));
	// Opaque and unlit (the widget's own material), as the console: the plate is the whole quad, nothing behind it drawn twice.
	Legend->SetBlendMode(EWidgetBlendMode::Opaque);
	Legend->SetTwoSided(false);
	Legend->SetBackgroundColor(FLinearColor::Transparent);
	Legend->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Legend->SetCastShadow(false);
	Legend->SetWindowFocusable(false);
	Legend->SetManuallyRedraw(true);
	Legend->SetTintColorAndOpacity(FLinearColor(0.95f, 0.95f, 0.95f, 1.f));
	Legend->RegisterComponent();
	// No tick of its own: a change asks for one render (RequestRenderUpdate).
	Legend->SetTickMode(ETickMode::Disabled);
	Legend->SetVisibility(false);
}

FString ABpTable::LegendLitLine(bool bControllers) const
{
	if (!IsTourRunning()) return FString();
	const FString& Id = TourStepId;
	const bool bTap = Id == TEXT("open-wing") || Id == TEXT("open-room") || Id == TEXT("step-in") || Id == TEXT("decide") || Id == TEXT("standup")
		|| Id == TEXT("morning-decide") || Id == TEXT("scan-arm") || Id == TEXT("room-switch") || Id == TEXT("room-back") || Id == TEXT("text-size")
		|| Id == TEXT("pc-pair") || Id == TEXT("talk-choice");
	if (Id == TEXT("menu")) return bControllers ? TEXT("y") : TEXT("tap");
	if (bTap) return bControllers ? TEXT("a") : TEXT("tap");
	if (Id == TEXT("back") || Id == TEXT("hands-push")) return bControllers ? TEXT("b") : TEXT("push");
	if (Id == TEXT("hands-pull")) return bControllers ? TEXT("a") : TEXT("pull");
	if (Id == TEXT("hands-wrist")) return bControllers ? TEXT("a") : TEXT("wrist");
	if (Id == TEXT("talk") || Id == TEXT("talk-hold")) return bControllers ? TEXT("x") : TEXT("talk");
	return FString();
}

void ABpTable::TickLegend()
{
	if (!Legend) return;
	const bool bOn = CVarLegend.GetValueOnGameThread() != 0 && HasPlan() && PlacedHeightCm > 0.f;
	const UWorld* World = GetWorld();
	const APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
	const ABpPawn* Pawn = PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	const int32 Forced = CVarLegendMode.GetValueOnGameThread();
	const bool bPad = Forced >= 0 ? Forced == 1 : Pawn && Pawn->UsesControllers();
	const bool bRoom = !RoomModeId.IsEmpty();
	const FString Lit = LegendLitLine(bPad);
	const float S = BpSheet::TextScale();
	const FString Key = bOn ? FString::Printf(TEXT("%d|%d|%s|%.2f|%.1f"), bPad, bRoom, *Lit, S, PlacedHeightCm) : FString(TEXT("off"));
	if (Key == LegendKey) return;
	LegendKey = Key;
	if (!bOn)
	{
		Legend->SetVisibility(false);
		UE_LOG(LogBpTable, Log, TEXT("BpLegend: hidden (%s)"), CVarLegend.GetValueOnGameThread() == 0 ? TEXT("bp.Legend 0") : TEXT("no plan yet"));
		return;
	}

	// The lines, in the order that fits where the person is: in a room what acts there leads.
	TArray<const FLegendLine*> Lines;
	const auto Add = [&Lines](const FLegendLine* Set, int32 Num, std::initializer_list<const TCHAR*> Order)
	{
		for (const TCHAR* Id : Order) for (int32 I = 0; I < Num; ++I) if (FCString::Strcmp(Set[I].Id, Id) == 0) Lines.Add(&Set[I]);
	};
	if (bPad) Add(PadLines, UE_ARRAY_COUNT(PadLines), bRoom ? std::initializer_list<const TCHAR*>{ TEXT("a"), TEXT("b"), TEXT("stick"), TEXT("y"), TEXT("x"), TEXT("trigger") }
		: std::initializer_list<const TCHAR*>{ TEXT("stick"), TEXT("a"), TEXT("b"), TEXT("y"), TEXT("x"), TEXT("trigger") });
	else Add(HandLines, UE_ARRAY_COUNT(HandLines), bRoom ? std::initializer_list<const TCHAR*>{ TEXT("tap"), TEXT("push"), TEXT("talk"), TEXT("wrist"), TEXT("pull") }
		: std::initializer_list<const TCHAR*>{ TEXT("tap"), TEXT("pull"), TEXT("push"), TEXT("talk"), TEXT("wrist") });

	const float Cap = LegendCapCm * LegendPxPerCm;
	const FSlateFontInfo KeyFont = LegendFont(TEXT("Bold"), Cap), WordFont = LegendFont(TEXT("Regular"), Cap), TitleFont = LegendFont(TEXT("Bold"), Cap);
	const float Pitch = BpSheet::LinePitch(Cap, static_cast<float>(BpType::CapPerEm));
	const float Pad = 26.f, GlyphPx = 44.f, Gap = 16.f, RowH = FMath::Max(GlyphPx, Pitch) + 12.f, TitleH = Pitch + 14.f;
	const FString Title = bPad ? TEXT("CONTROLLERS") : TEXT("HANDS");
	float TextMax = TextW(TEXT("LEGEND  ·  ") + Title, TitleFont);
	for (const FLegendLine* L : Lines) TextMax = FMath::Max(TextMax, GlyphPx + Gap + TextW(FString(L->Key) + TEXT("  ·  "), KeyFont) + TextW(L->Words, WordFont));
	const float W = FMath::CeilToFloat(Pad * 2.f + TextMax + 8.f);
	const float H = FMath::CeilToFloat(Pad + TitleH + 10.f + Lines.Num() * RowH + Pad * 0.6f);
	const FLinearColor Rest = BpSheet::Ink.CopyWithNewOpacity(LegendRest);

	TSharedRef<SVerticalBox> Body = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[SNew(STextBlock).Text(FText::FromString(TEXT("LEGEND  ·  "))).Font(TitleFont).ColorAndOpacity(FSlateColor(Rest))]
			+ SHorizontalBox::Slot().AutoWidth()[SNew(STextBlock).Text(FText::FromString(Title)).Font(TitleFont).ColorAndOpacity(FSlateColor(BpSheet::Accent.CopyWithNewOpacity(0.8f)))]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 8.f, 0.f, 4.f)[SNew(SBox).HeightOverride(2.f)[SNew(BpSheet::SPlate).Fill(Rest.CopyWithNewOpacity(0.35f))]];
	for (const FLegendLine* L : Lines)
	{
		const bool bLit = Lit == L->Id;
		const FLinearColor Ink = bLit ? BpSheet::Amber : Rest;
		TSharedRef<SWidget> Glyph = L->Glyph == EGlyph::Button
			? BpSheet::Bubble(L->Letter, LegendFont(TEXT("Bold"), Cap * 0.95f), GlyphPx - 4.f, Ink)
			: StaticCastSharedRef<SWidget>(SNew(SLegendGlyph).Kind(L->Glyph).Color(Ink));
		Body->AddSlot().AutoHeight()
		[
			SNew(SBox).HeightOverride(RowH)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(SBox).WidthOverride(GlyphPx).HeightOverride(GlyphPx).HAlign(HAlign_Center).VAlign(VAlign_Center)[Glyph]]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(Gap, 0.f, 0.f, 0.f)[SNew(STextBlock).Text(FText::FromString(FString(L->Key) + TEXT("  ·  "))).Font(KeyFont).ColorAndOpacity(FSlateColor(bLit ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(LegendRest + 0.1f)))]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(L->Words)).Font(WordFont).ColorAndOpacity(FSlateColor(Ink))]
			]
		];
	}
	if (Legend->GetDrawSize() != FVector2D(W, H)) Legend->SetDrawSize(FVector2D(W, H));
	Legend->SetSlateWidget(
		SNew(SBox).WidthOverride(W).HeightOverride(H)
		[
			SNew(SOverlay)
			+ SOverlay::Slot()[SNew(BpSheet::SSheet).GridPx(40.f).RulePx(3.f)]
			+ SOverlay::Slot().Padding(FMargin(Pad, Pad * 0.8f, Pad, Pad * 0.6f))[Body]
		]);
	// Placed and turned to the seat: its foot just over the table's top, its centre up by half its height (scaled by TEXT SIZE).
	const float HeightCm = H / LegendPxPerCm * S;
	const FVector At(LegendXCm, LegendYCm, PlacedHeightCm + LegendFootCm + HeightCm * 0.5f);
	const FVector Eye = EyeLocal();
	Legend->SetRelativeTransform(FTransform((Eye - At).Rotation(), At, FVector(S / LegendPxPerCm)));
	Legend->SetVisibility(true);
	Legend->RequestRenderUpdate();
	++LegendDraws;
	const double Dist = FVector::Dist(Eye, At);
	const double Arcmin = FMath::RadiansToDegrees(FMath::Atan2(static_cast<double>(LegendCapCm * S), Dist)) * 60.0;
	UE_LOG(LogBpTable, Log, TEXT("BpLegend: drawn #%d %s%s%s (%d lines, %.0f x %.0f px = %.1f x %.1f cm, %.0f cm from the eye, cap %.2f cm = %.1f arcmin)"), LegendDraws, *Title,
		bRoom ? TEXT(" in a room") : TEXT(""), Lit.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", lit %s"), *Lit), Lines.Num(), W, H, W / LegendPxPerCm * S, HeightCm, Dist, LegendCapCm * S, Arcmin);
}
