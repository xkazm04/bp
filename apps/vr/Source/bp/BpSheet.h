// The web app's drawing-set language on the table's reading surfaces (wave 4's visual pass): the sheet's paper and ink from
// apps/web's tokens (globals.css: --paper-mid, --ink, --line, --accent, --amber, --red), the double-rule wall (.lg-page's
// "3px double var(--line)"), the faint grid, square corners and square markers. The wrist panel and the screen deck draw on
// it: one quad, drawn into its own render target only when what it shows changes, so none of this costs a frame's overdraw.
#pragma once

#include "Brushes/SlateRoundedBoxBrush.h"
#include "CoreMinimal.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace BpSheet
{
	inline const FLinearColor PaperMid(FColor(0x12, 0x3A, 0x72));
	inline const FLinearColor Ink(FColor(0xDF, 0xF0, 0xFF));
	inline const FLinearColor InkHi = FLinearColor::White;
	inline const FLinearColor Accent(FColor(0x7F, 0xE0, 0xFF));
	inline const FLinearColor Amber(FColor(0xFF, 0xC3, 0x5A));
	inline const FLinearColor Red(FColor(0xFF, 0x6A, 0x58));
	/** The pin's ink on its colour (the plan's --paper-lo). */
	inline const FLinearColor PaperLo(FColor(0x06, 0x14, 0x2E));

	/** The paper with its grid and double-rule wall: the surface's own quad fill, so the panel is opaque. */
	class SSheet : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SSheet) : _GridPx(40.f), _RulePx(3.5f) {}
			SLATE_ARGUMENT(float, GridPx)
			SLATE_ARGUMENT(float, RulePx)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args)
		{
			GridPx = Args._GridPx;
			RulePx = Args._RulePx;
		}
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(64.0, 64.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			FSlateDrawElement::MakeBox(Out, Layer, Geometry.ToPaintGeometry(), FCoreStyle::Get().GetBrush("WhiteBrush"), ESlateDrawEffect::None, PaperMid);
			const auto Line = [&](const FVector2f& A, const FVector2f& B, const FLinearColor& Color, float Thick)
			{
				TArray<FVector2f> Points = { A, B };
				FSlateDrawElement::MakeLines(Out, Layer + 1, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, false, Thick);
			};
			// The grid: every fifth line a little stronger, as the plan's paper.
			int32 Count = 0;
			for (float X = GridPx; X < Size.X; X += GridPx) Line(FVector2f(X, 0.f), FVector2f(X, Size.Y), Ink.CopyWithNewOpacity(++Count % 5 == 0 ? 0.045f : 0.018f), 1.f);
			Count = 0;
			for (float Y = GridPx; Y < Size.Y; Y += GridPx) Line(FVector2f(0.f, Y), FVector2f(Size.X, Y), Ink.CopyWithNewOpacity(++Count % 5 == 0 ? 0.045f : 0.018f), 1.f);
			// The wall: a heavy outer rule and a fine one inside it.
			const auto Rect = [&](float Inset, const FLinearColor& Color, float Thick)
			{
				const FVector2f A(Inset, Inset), B(Size.X - Inset, Inset), C(Size.X - Inset, Size.Y - Inset), D(Inset, Size.Y - Inset);
				Line(A, B, Color, Thick); Line(B, C, Color, Thick); Line(C, D, Color, Thick); Line(D, A, Color, Thick);
			};
			Rect(RulePx * 0.5f + 0.5f, Ink.CopyWithNewOpacity(0.92f), RulePx);
			Rect(RulePx + 6.f, Ink.CopyWithNewOpacity(0.6f), 1.2f);
			return Layer + 2;
		}

	private:
		float GridPx = 40.f;
		float RulePx = 3.5f;
	};

	/** A thin circle, the bubble's ring (a rounded box brush's outline does not draw at a radius past half its size). */
	class SRing : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SRing) : _Color(FLinearColor::White), _Thick(2.f) {}
			SLATE_ARGUMENT(FLinearColor, Color)
			SLATE_ARGUMENT(float, Thick)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Color = Args._Color; Thick = Args._Thick; }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(16.0, 16.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const FVector2f Centre = Size * 0.5f;
			const float Radius = FMath::Min(Size.X, Size.Y) * 0.5f - Thick * 0.5f - 0.5f;
			TArray<FVector2f> Points;
			for (int32 Step = 0; Step <= 36; ++Step)
			{
				const float A = 2.f * UE_PI * Step / 36.f;
				Points.Add(Centre + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius);
			}
			FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thick);
			return Layer + 1;
		}

	private:
		FLinearColor Color = FLinearColor::White;
		float Thick = 2.f;
	};

	/** A lettered section bubble (the web's "(A) BUSINESS"), Diameter px across, in the ink given. */
	inline TSharedRef<SWidget> Bubble(const FString& Letter, const FSlateFontInfo& Font, float Diameter, const FLinearColor& Color)
	{
		return SNew(SBox).WidthOverride(Diameter).HeightOverride(Diameter)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(SRing).Color(Color.CopyWithNewOpacity(0.9f)).Thick(FMath::Max(1.5f, Diameter * 0.055f))]
				+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Letter)).Font(Font).ColorAndOpacity(FSlateColor(Color))
				]
			];
	}

	/** The plan's marker: a small rounded square in a colour, its short word in the paper's ink (backlog.css .sc-pin). */
	inline TSharedRef<SWidget> Pin(const FString& Text, const FSlateFontInfo& Font, float Height, const FLinearColor& Color, float Width = 0.f)
	{
		static const FSlateRoundedBoxBrush Square(FLinearColor::White, 6.f);
		return SNew(SBox).HeightOverride(Height).MinDesiredWidth(Width > 0.f ? Width : Height).HAlign(HAlign_Fill)
			[
				SNew(SBorder).BorderImage(&Square).BorderBackgroundColor(Color).HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(FMargin(8.f, 0.f))
				[
					SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(FSlateColor(PaperLo))
				]
			];
	}

	/** The risk band's mark and colour, as the ledger shows them (useLedger.ts riskBand; ▲ high, ◆ medium, ▽ low). */
	inline const TCHAR* RiskMark(double Risk) { return Risk >= 7.0 ? TEXT("▲") : Risk >= 4.0 ? TEXT("◆") : TEXT("▽"); }
	inline FLinearColor RiskColor(double Risk) { return Risk >= 7.0 ? Red : Risk >= 4.0 ? Amber : Accent; }
}
