// The web app's drawing-set language on the table's reading surfaces (wave 4's visual pass): the sheet's paper and ink from
// apps/web's tokens (globals.css: --paper-mid, --ink, --line, --accent, --amber, --red), the double-rule wall (.lg-page's
// "3px double var(--line)"), the faint grid, square corners and square markers. The wrist panel and the screen deck draw on
// it: one quad, drawn into its own render target only when what it shows changes, so none of this costs a frame's overdraw.
#pragma once

#include "Brushes/SlateRoundedBoxBrush.h"
#include "CoreMinimal.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
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

	/** A text's width in a font, in the widget's pixels (the renderer's measure; an estimate before Slate runs). */
	inline float TextWidth(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return static_cast<float>(Renderer->GetFontMeasureService()->Measure(Text, Font).X);
		}
		return Text.Len() * 0.5f * Font.Size * 96.f / 72.f;
	}

	/** The fit rule (blueprint-ui.md): the text, else cut at a character with an ellipsis, never drawn smaller. */
	inline FString Cut(const FString& Text, const FSlateFontInfo& Font, float MaxW)
	{
		if (TextWidth(Text, Font) <= MaxW) return Text;
		for (int32 Keep = Text.Len() - 1; Keep > 0; --Keep)
		{
			const FString Shorter = Text.Left(Keep).TrimEnd() + TEXT("…");
			if (TextWidth(Shorter, Font) <= MaxW) return Shorter;
		}
		return FString();
	}

	/** The fit rule for words (night two V2): the text, else whole words with an ellipsis, never cut inside a word; a single
	 *  word too long for MaxW falls back to Cut. */
	inline FString CutWords(const FString& Text, const FSlateFontInfo& Font, float MaxW)
	{
		if (TextWidth(Text, Font) <= MaxW) return Text;
		int32 At = Text.Len();
		while ((At = Text.Left(At).Find(TEXT(" "), ESearchCase::CaseSensitive, ESearchDir::FromEnd)) > 0)
		{
			FString Shorter = Text.Left(At).TrimEnd();
			while (Shorter.EndsWith(TEXT("·")) || Shorter.EndsWith(TEXT(",")) || Shorter.EndsWith(TEXT(":"))) Shorter = Shorter.LeftChop(1).TrimEnd();
			Shorter += TEXT("…");
			if (TextWidth(Shorter, Font) <= MaxW) return Shorter;
		}
		return Cut(Text, Font, MaxW);
	}

	/** Words into lines of MaxW; past MaxLines the last kept line takes the rest, cut. */
	inline FString Wrap(const FString& Text, const FSlateFontInfo& Font, float MaxW, int32 MaxLines)
	{
		TArray<FString> Words, Lines;
		Text.Replace(TEXT("\n"), TEXT(" ")).ParseIntoArrayWS(Words);
		FString Line;
		for (const FString& Word : Words)
		{
			const FString Try = Line.IsEmpty() ? Word : Line + TEXT(" ") + Word;
			if (TextWidth(Try, Font) <= MaxW) { Line = Try; continue; }
			if (!Line.IsEmpty()) Lines.Add(Line);
			Line = Cut(Word, Font, MaxW);
		}
		if (!Line.IsEmpty()) Lines.Add(Line);
		if (MaxLines > 0 && Lines.Num() > MaxLines)
		{
			FString Rest = Lines[MaxLines - 1];
			for (int32 Index = MaxLines; Index < Lines.Num(); ++Index) Rest += TEXT(" ") + Lines[Index];
			Lines.SetNum(MaxLines);
			Lines.Last() = CutWords(Rest, Font, MaxW);
		}
		return FString::Join(Lines, TEXT("\n"));
	}

	/** Wave U2: a model's reply as plain words for the sheet, the caption and the wrist (the voice is cleaned on the server):
	 *  markdown's headings, bullets and numbered list marks at a line's start, emphasis (*, **, _, __ at a word's edge),
	 *  backticks and a link's [words](url) go; the words stay. Lines are joined with spaces. */
	inline FString PlainWords(const FString& In)
	{
		TArray<FString> Lines, Kept;
		In.Replace(TEXT("\r"), TEXT("")).ParseIntoArray(Lines, TEXT("\n"), true);
		for (FString Line : Lines)
		{
			Line.TrimStartAndEndInline();
			while (Line.StartsWith(TEXT("#"))) Line.RemoveAt(0);
			Line.TrimStartInline();
			if (Line.StartsWith(TEXT(">"))) { Line.RemoveAt(0); Line.TrimStartInline(); }
			if (Line.Len() > 1 && (Line[0] == TEXT('-') || Line[0] == TEXT('*') || Line[0] == TEXT('+') || Line[0] == TEXT('•')) && Line[1] == TEXT(' ')) Line = Line.Mid(2);
			{
				int32 D = 0;
				while (D < Line.Len() && FChar::IsDigit(Line[D])) ++D;
				if (D > 0 && D < 3 && Line.Len() > D + 1 && (Line[D] == TEXT('.') || Line[D] == TEXT(')')) && Line[D + 1] == TEXT(' ')) Line = Line.Mid(D + 2);
			}
			if (!Line.IsEmpty()) Kept.Add(Line);
		}
		const FString Joined = FString::Join(Kept, TEXT(" "));
		FString Out;
		Out.Reserve(Joined.Len());
		for (int32 I = 0; I < Joined.Len(); ++I)
		{
			const TCHAR C = Joined[I];
			if (C == TEXT('`')) continue;
			// A heading's marks inside a line (the lines joined): "## " after a space goes ("#12" stays).
			if (C == TEXT('#') && (I == 0 || FChar::IsWhitespace(Joined[I - 1])))
			{
				int32 J = I;
				while (J < Joined.Len() && Joined[J] == TEXT('#')) ++J;
				if (J < Joined.Len() && FChar::IsWhitespace(Joined[J])) { I = J; continue; }
			}
			// A link's words: "[words](url)" keeps "words".
			if (C == TEXT('['))
			{
				const int32 Close = Joined.Find(TEXT("]("), ESearchCase::CaseSensitive, ESearchDir::FromStart, I);
				const int32 End = Close > I ? Joined.Find(TEXT(")"), ESearchCase::CaseSensitive, ESearchDir::FromStart, Close) : INDEX_NONE;
				if (Close > I && End > Close) { Out += Joined.Mid(I + 1, Close - I - 1); I = End; continue; }
			}
			// Emphasis marks: a run of * or _ touching a word on one side and a space, the line's edge or punctuation on the other
			// (a * between spaces, "3 * 4", and a snake_case word's _ stay).
			if (C == TEXT('*') || C == TEXT('_'))
			{
				int32 J = I;
				while (J < Joined.Len() && Joined[J] == C) ++J;
				const TCHAR Before = I > 0 ? Joined[I - 1] : TEXT(' ');
				const TCHAR After = J < Joined.Len() ? Joined[J] : TEXT(' ');
				const bool bWordBefore = FChar::IsAlnum(Before), bWordAfter = FChar::IsAlnum(After);
				const bool bEdge = C == TEXT('*') ? !(FChar::IsWhitespace(Before) && FChar::IsWhitespace(After)) : bWordBefore != bWordAfter;
				if (bEdge) { I = J - 1; continue; }
			}
			Out.AppendChar(C);
		}
		while (Out.ReplaceInline(TEXT("  "), TEXT(" ")) > 0) {}
		return Out.TrimStartAndEnd();
	}

	/** A plate: a flat fill and a square edge EdgePx thick drawn inside its bounds (the sheet's controls and rows), and an
	 *  optional accent bar BarPx wide down its left edge (the row the table shows, the lit tab). */
	class SPlate : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SPlate) : _Fill(FLinearColor::Transparent), _Edge(FLinearColor::Transparent), _EdgePx(2.f), _Bar(FLinearColor::Transparent), _BarPx(0.f) {}
			SLATE_ARGUMENT(FLinearColor, Fill)
			SLATE_ARGUMENT(FLinearColor, Edge)
			SLATE_ARGUMENT(float, EdgePx)
			SLATE_ARGUMENT(FLinearColor, Bar)
			SLATE_ARGUMENT(float, BarPx)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args)
		{
			Fill = Args._Fill;
			Edge = Args._Edge;
			EdgePx = Args._EdgePx;
			Bar = Args._Bar;
			BarPx = Args._BarPx;
		}
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(16.0, 16.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
			if (Fill.A > 0.f) FSlateDrawElement::MakeBox(Out, Layer, Geometry.ToPaintGeometry(), White, ESlateDrawEffect::None, Fill);
			if (Edge.A > 0.f && EdgePx > 0.f)
			{
				const float H = EdgePx * 0.5f;
				TArray<FVector2f> Points = { FVector2f(H, H), FVector2f(Size.X - H, H), FVector2f(Size.X - H, Size.Y - H), FVector2f(H, Size.Y - H), FVector2f(H, H) };
				FSlateDrawElement::MakeLines(Out, Layer + 1, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Edge, false, EdgePx);
			}
			if (Bar.A > 0.f && BarPx > 0.f)
			{
				FSlateDrawElement::MakeBox(Out, Layer + 1, Geometry.ToPaintGeometry(FVector2f(BarPx, Size.Y), FSlateLayoutTransform()), White, ESlateDrawEffect::None, Bar);
			}
			return Layer + 2;
		}

	private:
		FLinearColor Fill;
		FLinearColor Edge;
		float EdgePx = 2.f;
		FLinearColor Bar;
		float BarPx = 0.f;
	};

	// ---- One control family (night two V2): every row, tile and button on the console, the stand-up and the wrist ----------
	/** A row's or a quiet button's fill: a step lighter than the sheet; the focus (a hand's ray, the pad) a clear step more. */
	inline FLinearColor RowFill(bool bFocus) { return Ink.CopyWithNewOpacity(bFocus ? 0.17f : 0.075f); }
	inline FLinearColor RowEdge(bool bFocus) { return bFocus ? Amber : Ink.CopyWithNewOpacity(0.3f); }
	/** A control that cannot act now: no fill, a faint edge, faint words. */
	inline FLinearColor OffEdge() { return Ink.CopyWithNewOpacity(0.2f); }
	inline FLinearColor OffInk() { return Ink.CopyWithNewOpacity(0.38f); }

	/** A value or a state at a row's right (OPEN counts, FOCUS, OFFLINE, 100 %): one chip, an edge and words in the tone's
	 *  colour on a dark fill, Height px tall, as wide as its words. */
	inline TSharedRef<SWidget> Chip(const FString& Text, const FSlateFontInfo& Font, float Height, const FLinearColor& Color, bool bSolid = false)
	{
		return SNew(SBox).HeightOverride(Height).VAlign(VAlign_Fill)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(SPlate).Fill(bSolid ? Color : PaperLo.CopyWithNewOpacity(0.7f)).Edge(Color.CopyWithNewOpacity(0.85f)).EdgePx(2.f)]
				+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(FMargin(14.f, 0.f))
				[
					SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(FSlateColor(bSolid ? PaperLo : Color))
				]
			];
	}
	inline float ChipWidth(const FString& Text, const FSlateFontInfo& Font) { return TextWidth(Text, Font) + 30.f; }

	/** A quiet drawing in the sheet's own line language for an empty page (no image: the widget's own lines). Kind: 0 a
	 *  package (an isometric box on its dimension line), 1 a set of sheets (stacked, a title block on the top one), 2 the lamp
	 *  (its shade, arm and pool of light on the paper). */
	class SMotif : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SMotif) : _Kind(0) {}
			SLATE_ARGUMENT(int32, Kind)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Kind = Args._Kind; }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(64.0, 64.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const float U = FMath::Min(Size.X, Size.Y) / 10.f;
			const FVector2f O = Size * 0.5f;
			const FLinearColor Strong = Ink.CopyWithNewOpacity(0.34f), Faint = Ink.CopyWithNewOpacity(0.16f);
			const auto Poly = [&](std::initializer_list<FVector2f> Points, const FLinearColor& Color, float Thick, bool bClosed)
			{
				TArray<FVector2f> P;
				for (const FVector2f& Each : Points) P.Add(O + Each * U);
				if (bClosed && P.Num() > 0) { const FVector2f First = P[0]; P.Add(First); }
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), P, ESlateDrawEffect::None, Color, true, Thick);
			};
			// A dimension line under every drawing, with its ticks: the drawing set's own way of saying "a thing, measured".
			const auto Dimension = [&](float X0, float X1, float Y)
			{
				Poly({ FVector2f(X0, Y), FVector2f(X1, Y) }, Faint, 1.5f, false);
				Poly({ FVector2f(X0, Y - 0.35f), FVector2f(X0, Y + 0.35f) }, Faint, 1.5f, false);
				Poly({ FVector2f(X1, Y - 0.35f), FVector2f(X1, Y + 0.35f) }, Faint, 1.5f, false);
			};
			if (Kind == 0)
			{
				// The box: top face, then the two visible sides, its seam taped across the top.
				const FVector2f T(0.f, -3.f), L(-3.2f, -1.4f), R(3.2f, -1.4f), C(0.f, 0.2f), LB(-3.2f, 2.4f), RB(3.2f, 2.4f), CB(0.f, 4.f);
				Poly({ T, R, C, L }, Strong, 2.f, true);
				Poly({ L, C, CB, LB }, Strong, 2.f, true);
				Poly({ C, R, RB, CB }, Strong, 2.f, true);
				Poly({ FVector2f(-1.6f, -2.2f), FVector2f(1.6f, -0.6f) }, Faint, 2.f, false);
				Dimension(-3.2f, 3.2f, 4.9f);
			}
			else if (Kind == 1)
			{
				// Three sheets fanned back, the front one with its grid and title block.
				for (int32 I = 2; I >= 0; --I)
				{
					const float D = I * 0.55f;
					Poly({ FVector2f(-3.6f + D, -3.f - D), FVector2f(3.f + D, -3.f - D), FVector2f(3.f + D, 2.6f - D), FVector2f(-3.6f + D, 2.6f - D) }, I == 0 ? Strong : Faint, 2.f, true);
				}
				for (float X = -2.6f; X < 3.f; X += 1.f) Poly({ FVector2f(X, -3.f), FVector2f(X, 2.6f) }, Faint, 1.f, false);
				Poly({ FVector2f(0.6f, 1.6f), FVector2f(3.f, 1.6f) }, Strong, 1.5f, false);
				Poly({ FVector2f(0.6f, 1.6f), FVector2f(0.6f, 2.6f) }, Strong, 1.5f, false);
				Dimension(-3.6f, 3.f, 3.6f);
			}
			else
			{
				// The lamp: its base, the two arms, the shade, and the pool of light it throws.
				Poly({ FVector2f(-3.8f, 3.6f), FVector2f(-1.8f, 3.6f) }, Strong, 2.5f, false);
				Poly({ FVector2f(-2.8f, 3.6f), FVector2f(-1.4f, -0.6f), FVector2f(1.0f, -2.6f) }, Strong, 2.f, false);
				Poly({ FVector2f(0.4f, -3.4f), FVector2f(2.6f, -1.8f), FVector2f(2.0f, -1.0f), FVector2f(0.0f, -2.4f) }, Strong, 2.f, true);
				Poly({ FVector2f(2.3f, -1.4f), FVector2f(4.4f, 3.6f) }, Faint, 1.5f, false);
				Poly({ FVector2f(2.3f, -1.4f), FVector2f(0.6f, 3.6f) }, Faint, 1.5f, false);
				Poly({ FVector2f(0.2f, 3.6f), FVector2f(4.8f, 3.6f) }, Faint, 1.5f, false);
				Dimension(-3.8f, 4.8f, 4.6f);
			}
			return Layer + 1;
		}

	private:
		int32 Kind = 0;
	};

	// ---- Night two V4: the text size, the family's control, a fit that never cuts ------------------------------------------
	/** SETTINGS › ACCESSIBILITY's TEXT SIZE (bp.TextSize, BpAudio.cpp: 1.0, 1.15, 1.3): the console, the wrist and the captions
	 *  scale as a whole by it (their world size, so every layout holds by construction and the type grows with it). */
	inline float TextScale()
	{
		static IConsoleVariable* Var = nullptr;
		if (!Var) Var = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.TextSize"));
		return Var ? FMath::Clamp(Var->GetFloat(), 1.f, 1.3f) : 1.f;
	}

	/** One control's looks: the primary (amber), the system's (cyan), a quiet edge, and one that cannot act now. */
	enum class ELook : uint8 { Amber, Fill, Edge, Off };
	/** The family's control (the console's, the stand-up's, the wrist's, the deck's): a fill and an edge by its look; under a
	 *  hand's ray or the pad (bLit) the quiet one a step brighter; pressed (bDown) it sinks: darker and drawn 3 px in. */
	inline TSharedRef<SWidget> Control(const FString& Word, const FSlateFontInfo& Font, ELook Look, bool bLit = false, bool bDown = false)
	{
		FLinearColor Fill = Look == ELook::Fill ? Accent : Look == ELook::Amber ? Amber : Look == ELook::Off ? FLinearColor::Transparent : RowFill(bLit);
		const FLinearColor Edge = Look == ELook::Edge ? Ink.CopyWithNewOpacity(bLit ? 1.f : 0.7f) : Look == ELook::Off ? OffEdge() : FLinearColor::Transparent;
		const FLinearColor Words = Look == ELook::Edge ? InkHi : Look == ELook::Off ? OffInk() : PaperLo;
		if (bDown) Fill = Look == ELook::Edge ? Ink.CopyWithNewOpacity(0.32f) : Fill * 0.72f;
		return SNew(SBox).Padding(bDown ? 3.f : 0.f)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(SPlate).Fill(Fill).Edge(Edge).EdgePx(2.5f)]
				+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(FMargin(10.f, 0.f))
				[
					SNew(STextBlock).Text(FText::FromString(Word)).Font(Font).ColorAndOpacity(FSlateColor(Words))
				]
			];
	}

	/** A line's pitch for a cap height in a font of the family (Barlow's 1.2 em). */
	inline float LinePitch(float CapPx, float CapPerEm) { return CapPx / CapPerEm * 1.2f; }
	inline int32 Lines(const FString& Wrapped) { int32 N = 1; for (const TCHAR C : Wrapped) N += C == TEXT('\n') ? 1 : 0; return Wrapped.IsEmpty() ? 0 : N; }

	/** Whole sentences, as many as fit MaxLines of MaxW (night two V4: a long reply is never cut inside a sentence, never with
	 *  an ellipsis); the first sentence always, wrapped in full. bOutMore says whether any was left out. */
	inline FString Sentences(const FString& Text, const FSlateFontInfo& Font, float MaxW, int32 MaxLines, bool& bOutMore)
	{
		bOutMore = false;
		const FString All = Wrap(Text, Font, MaxW, 0);
		if (MaxLines <= 0 || Lines(All) <= MaxLines) return All;
		TArray<FString> Parts;
		FString Rest = Text.Replace(TEXT("\n"), TEXT(" "));
		while (true)
		{
			int32 Best = INDEX_NONE;
			for (const TCHAR* End : { TEXT(". "), TEXT("? "), TEXT("! "), TEXT(": ") })
			{
				const int32 Found = Rest.Find(End);
				if (Found != INDEX_NONE && (Best == INDEX_NONE || Found < Best)) Best = Found;
			}
			if (Best == INDEX_NONE) { Parts.Add(Rest); break; }
			Parts.Add(Rest.Left(Best + 1));
			Rest = Rest.Mid(Best + 2);
		}
		FString Kept = Parts[0];
		for (int32 Index = 1; Index < Parts.Num(); ++Index)
		{
			const FString Try = Kept + TEXT(" ") + Parts[Index];
			if (Lines(Wrap(Try, Font, MaxW, 0)) > MaxLines) { bOutMore = true; break; }
			Kept = Try;
		}
		return Wrap(Kept, Font, MaxW, 0);
	}

	/** A status or a sub-line in one line, never cut inside a clause (night two V4): whole; else its trailing " · " clauses
	 *  dropped one at a time; else its parenthesis; only then whole words with an ellipsis (a single clause too long). */
	inline FString FitClause(const FString& Text, const FSlateFontInfo& Font, float MaxW)
	{
		FString Fit = Text;
		while (TextWidth(Fit, Font) > MaxW)
		{
			const int32 At = Fit.Find(TEXT(" · "), ESearchCase::CaseSensitive, ESearchDir::FromEnd);
			if (At <= 0) break;
			Fit = Fit.Left(At);
		}
		FString Plain, Aside;
		if (TextWidth(Fit, Font) > MaxW && Fit.Split(TEXT(" ("), &Plain, &Aside)) Fit = Plain;
		return TextWidth(Fit, Font) <= MaxW ? Fit : CutWords(Fit, Font, MaxW);
	}

	/** The risk band's mark and colour, as the ledger shows them (useLedger.ts riskBand; ▲ high, ◆ medium, ▽ low). */
	inline const TCHAR* RiskMark(double Risk) { return Risk >= 7.0 ? TEXT("▲") : Risk >= 4.0 ? TEXT("◆") : TEXT("▽"); }
	inline FLinearColor RiskColor(double Risk) { return Risk >= 7.0 ? Red : Risk >= 4.0 ? Amber : Accent; }
}
