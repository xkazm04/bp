// Glim's board (wave W1): BpBoard.h says what it is and what it reads.
#include "BpBoard.h"

#include "BpLink.h"
#include "BpProjector.h"
#include "BpSheet.h"
#include "BpTable.h"
#include "BpType.h"
#include "BpWords.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Engine/Texture2D.h"
#include "Schema/BpSchemaVocab.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	/** The board's few tones beyond the family's: the lamp's warm white, and the target's green (the design's #7fe0a8). */
	const FLinearColor LampWhite(FColor(0xFF, 0xF3, 0xD6));
	const FLinearColor TargetGreen(FColor(0x7F, 0xE0, 0xA8));
	/** The tiles' plate (the design's #0b1e35 over the sheet) and edge. */
	const FLinearColor TileFill = BpSheet::PaperLo.CopyWithNewOpacity(0.55f);
	const FLinearColor TileEdge = BpSheet::Ink.CopyWithNewOpacity(0.32f);
	/** Wave W3, the floor: the wall is 53.1 degrees wide now (bp.Projector.WidthCm 260 at 260 cm), 24.1 layout px a degree, so
	 *  19 layout px of cap (BpBoard::CapS) is 47 arc minutes (an x-height of 0.72 of it, 34), over W2's floor (20 px at 26.2 px
	 *  a degree: 46 and 33) and the projector README's 40 arc minute body. */
	constexpr float CapFloor = BpBoard::CapS;

	FSlateFontInfo Font(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Object = ABpTable::TextFontObject()) return FSlateFontInfo(Object, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}
	float Pitch(float CapPx) { return CapPx / static_cast<float>(BpType::CapPerEm) * 1.2f; }

	/** A figure as the finding's words write it: whole from 100 up and when whole, else one decimal. */
	FString Fmt(double V)
	{
		if (FMath::Abs(V) >= 100.0 || FMath::IsNearlyEqual(V, FMath::RoundToDouble(V), 1e-6)) return FString::Printf(TEXT("%.0f"), V);
		return FString::Printf(TEXT("%.1f"), V);
	}

	/** Lines in the sheet's ink: each a polyline (the touches' links, a dashed rule, the hatch). */
	class SLines : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SLines) : _Color(FLinearColor::White), _Thick(2.f) {}
			SLATE_ARGUMENT(FLinearColor, Color)
			SLATE_ARGUMENT(float, Thick)
			SLATE_ARGUMENT(TArray<TArray<FVector2f>>, Lines)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Color = Args._Color; Thick = Args._Thick; Lines = Args._Lines; }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(16.0, 16.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			for (const TArray<FVector2f>& Points : Lines) if (Points.Num() > 1) FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thick);
			return Layer + 1;
		}

	private:
		FLinearColor Color;
		float Thick = 2.f;
		TArray<TArray<FVector2f>> Lines;
	};

	/** A rounded fill (a disc when Radius is half its size), its colour given at use. */
	const FSlateBrush* Rounded(float Radius)
	{
		static TMap<int32, TSharedPtr<FSlateRoundedBoxBrush>> Made;
		const int32 Key = FMath::RoundToInt(Radius);
		if (const TSharedPtr<FSlateRoundedBoxBrush>* Found = Made.Find(Key)) return Found->Get();
		return Made.Add(Key, MakeShared<FSlateRoundedBoxBrush>(FLinearColor::White, static_cast<float>(Key))).Get();
	}
	TSharedRef<SWidget> Disc(const FLinearColor& Color, float Diameter)
	{
		return SNew(SBorder).BorderImage(Rounded(Diameter * 0.5f)).BorderBackgroundColor(Color).Padding(0.f);
	}

	/** The arrow between a figure today and after (the family's face has no arrow: the default face's, as the deck's). */
	TSharedRef<SWidget> Arrow(float CapPx, const FLinearColor& Color)
	{
		return SNew(STextBlock).Text(FText::FromString(TEXT("→"))).Font(FCoreStyle::GetDefaultFontStyle("Bold", FMath::RoundToInt(CapPx / (0.711f * 96.f / 72.f)))).ColorAndOpacity(FSlateColor(Color));
	}

	/** The words of a section of the finding's body ("## Impact" -> its first line), or empty. */
	FString Section(const FString& Body, const TCHAR* Heading)
	{
		TArray<FString> Lines;
		Body.ParseIntoArrayLines(Lines, true);
		for (int32 Index = 0; Index + 1 < Lines.Num(); ++Index)
		{
			if (Lines[Index].TrimStartAndEnd() == FString(TEXT("## ")) + Heading) return BpSheet::PlainWords(Lines[Index + 1].TrimStartAndEnd());
		}
		return FString();
	}

	/** The first sentence of a paragraph (to its first ". "), with its stop. */
	FString FirstSentence(const FString& Text)
	{
		const int32 At = Text.Find(TEXT(". "));
		return At == INDEX_NONE ? Text : Text.Left(At + 1);
	}

	/** Wave W2 (no ellipses on the board): a name shortened by whole words to MaxW, never inside a word and with no ellipsis: a
	 *  bracket's words go first, then words from the end, a dangling joiner ("&", "to", "of") with them. Empty when not even
	 *  its first word fits. */
	FString ShortenWords(const FString& Name, const FSlateFontInfo& NameFont, float MaxW)
	{
		if (BpSheet::TextWidth(Name, NameFont) <= MaxW) return Name;
		FString S = Name;
		int32 Open = INDEX_NONE;
		if (S.FindChar(TEXT('('), Open) && Open > 0)
		{
			S = S.Left(Open).TrimEnd();
			if (BpSheet::TextWidth(S, NameFont) <= MaxW) return S;
		}
		static const TCHAR* const Joiners[] = { TEXT("&"), TEXT("and"), TEXT("to"), TEXT("of"), TEXT("for"), TEXT("the"), TEXT("a"), TEXT("in"), TEXT("on"), TEXT("with"), TEXT("from"), TEXT("under"), TEXT("by"), TEXT("at"), TEXT("into"), TEXT("over"), TEXT("·"), TEXT("-") };
		const auto Dangles = [](const FString& Word) { for (const TCHAR* J : Joiners) if (Word.Equals(J, ESearchCase::IgnoreCase)) return true; return false; };
		TArray<FString> W;
		S.ParseIntoArrayWS(W);
		while (W.Num() > 1)
		{
			W.Pop();
			while (W.Num() > 1 && Dangles(W.Last())) W.Pop();
			W.Last().RemoveFromEnd(TEXT(","));
			const FString Try = FString::Join(W, TEXT(" "));
			if (BpSheet::TextWidth(Try, NameFont) <= MaxW) return Try;
		}
		return W.Num() == 1 && BpSheet::TextWidth(W[0], NameFont) <= MaxW ? W[0] : FString();
	}

	/** Whole words into at most MaxLines lines of MaxW (no ellipsis): the words past them are left off, a dangling joiner with
	 *  them. bAll (when given): every word fit. */
	FString WrapWhole(const FString& Text, const FSlateFontInfo& WrapFont, float MaxW, int32 MaxLines, bool* bAll = nullptr)
	{
		TArray<FString> Tokens, Lines;
		Text.Replace(TEXT("\n"), TEXT(" ")).ParseIntoArrayWS(Tokens);
		FString Line;
		bool bFit = true;
		for (const FString& Word : Tokens)
		{
			const FString Try = Line.IsEmpty() ? Word : Line + TEXT(" ") + Word;
			if (BpSheet::TextWidth(Try, WrapFont) <= MaxW) { Line = Try; continue; }
			if (Line.IsEmpty() || Lines.Num() + 1 >= MaxLines) { bFit = false; break; }
			Lines.Add(Line);
			Line = Word;
		}
		if (!Line.IsEmpty() && Lines.Num() < MaxLines) Lines.Add(Line);
		if (!bFit && Lines.Num() > 0)
		{
			// The last kept line ends on a word that carries meaning.
			static const TCHAR* const Joiners[] = { TEXT("&"), TEXT("and"), TEXT("to"), TEXT("of"), TEXT("for"), TEXT("the"), TEXT("a"), TEXT("in"), TEXT("on"), TEXT("with"), TEXT("from"), TEXT("under"), TEXT("by"), TEXT("at"), TEXT("into"), TEXT("over"), TEXT("·"), TEXT("-") };
			TArray<FString> Last;
			Lines.Last().ParseIntoArrayWS(Last);
			for (bool bCut = true; bCut && Last.Num() > 1;)
			{
				bCut = false;
				for (const TCHAR* J : Joiners) if (Last.Last().Equals(J, ESearchCase::IgnoreCase)) { Last.Pop(); bCut = true; break; }
			}
			if (Last.Num() > 0) Last.Last().RemoveFromEnd(TEXT(","));
			Lines.Last() = FString::Join(Last, TEXT(" "));
		}
		if (bAll) *bAll = bFit;
		return FString::Join(Lines, TEXT("\n"));
	}

	/** Wave W3b: a name in two lines of about even width (the split between whole words whose wider line is the narrowest), or
	 *  one line when it fits MaxW; empty when neither fits. */
	FString TwoEven(const FString& Text, const FSlateFontInfo& EvenFont, float MaxW)
	{
		if (BpSheet::TextWidth(Text, EvenFont) <= MaxW) return Text;
		TArray<FString> W;
		Text.ParseIntoArrayWS(W);
		FString Best;
		float BestW = MaxW + 1.f;
		for (int32 Cut = 1; Cut < W.Num(); ++Cut)
		{
			// No line ends on a joiner.
			if (W[Cut - 1] == TEXT("&") || W[Cut - 1] == TEXT("·") || W[Cut - 1] == TEXT("-")) continue;
			const FString A = FString::Join(TArrayView<const FString>(W.GetData(), Cut), TEXT(" "));
			const FString B = FString::Join(TArrayView<const FString>(W.GetData() + Cut, W.Num() - Cut), TEXT(" "));
			const float Wide = FMath::Max(BpSheet::TextWidth(A, EvenFont), BpSheet::TextWidth(B, EvenFont));
			if (Wide < BestW) { BestW = Wide; Best = A + TEXT("\n") + B; }
		}
		return BestW <= MaxW ? Best : FString();
	}

	/** Wave W2: Figure stands in Text as a figure of its own ("1" is not in "11 px"). */
	bool HasFigure(const FString& Text, const FString& Figure)
	{
		const auto Digitish = [&Text](int32 I) { return I >= 0 && I < Text.Len() && (FChar::IsDigit(Text[I]) || (Text[I] == TEXT('.') && I + 1 < Text.Len() && FChar::IsDigit(Text[I + 1]))); };
		for (int32 At = Text.Find(Figure); At != INDEX_NONE; At = Text.Find(Figure, ESearchCase::CaseSensitive, ESearchDir::FromStart, At + 1))
		{
			if (!Digitish(At - 1) && !Digitish(At + Figure.Len())) return true;
		}
		return false;
	}

	/** The number after Marker in Text ("over the " -> 1000 in "over the 1000 ms budget"), or false. */
	bool NumberAfter(const FString& Text, const FString& Marker, double& Out, int32 From = 0)
	{
		const int32 At = Text.Find(Marker, ESearchCase::IgnoreCase, ESearchDir::FromStart, From);
		if (At == INDEX_NONE) return false;
		int32 I = At + Marker.Len();
		const int32 Start = I;
		while (I < Text.Len() && (FChar::IsDigit(Text[I]) || Text[I] == TEXT('.'))) ++I;
		if (I == Start) return false;
		Out = FCString::Atod(*Text.Mid(Start, I - Start));
		return true;
	}

	/** The first figure in a reading and the words around it: "Only 23% adoption." -> 23%, "adoption"; "Costs 2840 USD a month."
	 *  -> 2840 USD, "a month"; "2 incidents in 30 days." -> 2, "incidents in 30 days". */
	bool FirstFigure(const FString& Reading, FString& OutFigure, FString& OutWords)
	{
		int32 I = 0;
		// A digit that starts a figure (not the 95 of "p95").
		while (I < Reading.Len() && !(FChar::IsDigit(Reading[I]) && (I == 0 || !FChar::IsAlpha(Reading[I - 1])))) ++I;
		if (I >= Reading.Len()) return false;
		const int32 Start = I;
		while (I < Reading.Len() && (FChar::IsDigit(Reading[I]) || ((Reading[I] == TEXT('.') || Reading[I] == TEXT(',')) && I + 1 < Reading.Len() && FChar::IsDigit(Reading[I + 1])))) ++I;
		OutFigure = Reading.Mid(Start, I - Start);
		if (I < Reading.Len() && Reading[I] == TEXT('%')) { OutFigure += TEXT("%"); ++I; }
		else
		{
			// A currency in capitals after it ("2840 USD").
			int32 J = I;
			while (J < Reading.Len() && Reading[J] == TEXT(' ')) ++J;
			int32 K = J;
			while (K < Reading.Len() && FChar::IsUpper(Reading[K])) ++K;
			if (K - J >= 2 && (K >= Reading.Len() || !FChar::IsAlpha(Reading[K]))) { OutFigure += TEXT(" ") + Reading.Mid(J, K - J); I = K; }
		}
		OutWords = Reading.Mid(I).TrimStartAndEnd();
		OutWords.RemoveFromEnd(TEXT("."));
		// Nothing after it: the words before it ("Costs" is a verb; "2 incidents" has its noun after).
		if (OutWords.IsEmpty()) { OutWords = Reading.Left(Start).TrimStartAndEnd(); }
		return true;
	}

	/** What the data says about one finding, gathered once per draw. */
	struct FFacts
	{
		const FBpProposal* P = nullptr;
		const FBpFeature* Feature = nullptr;
		FString FeatureName, RoomName;
		TArray<FString> Neighbours;
		/** The lens's reading ("p95 1450 ms, over the 1000 ms budget."), the summary's and the impact's sentences. */
		FString Reading, Summary, Impact;
		/** A metric with a measured value and an expected change. */
		bool bMetric = false;
		double Today = 0.0, After = 0.0;
		FString Label, Unit, Method;
		bool bBudget = false, bTarget = false;
		double Budget = 0.0, Target = 0.0;
		/** The open findings on its feature today. */
		int32 Open = 0;
	};

	FFacts Gather(const FString& Id)
	{
		FFacts F;
		const FBpLinkModule& Link = FBpLinkModule::Get();
		const FBpScanState& State = Link.GetScanState();
		F.P = State.Scan.proposals.FindByPredicate([&Id](const FBpProposal& X) { return X.id == Id; });
		if (!F.P) return F;
		const FBpProposal& P = *F.P;
		F.Feature = Link.FindFeature(P.feature);
		// Names: the plan's tile and room, else the structure's feature.
		const FBpPlan* Plan = Link.GetPlan();
		const auto NameOf = [&](const FString& Slug) -> FString
		{
			if (Plan) if (const FBpPlanTile* T = Plan->tiles.FindByPredicate([&Slug](const FBpPlanTile& X) { return X.id == Slug; })) return T->name;
			if (const FBpFeature* Other = Link.FindFeature(Slug); Other && !Other->name.IsEmpty()) return Other->name;
			return BpWords::Humanise(Slug);
		};
		F.FeatureName = NameOf(P.feature);
		if (Plan)
		{
			const FBpPlanTile* T = Plan->tiles.FindByPredicate([&P](const FBpPlanTile& X) { return X.id == P.feature; });
			const FBpPlanBay* Bay = T ? Plan->bays.FindByPredicate([T](const FBpPlanBay& B) { return B.id == T->parentId; }) : nullptr;
			const FBpPlanRoom* Room = Bay ? Plan->rooms.FindByPredicate([Bay](const FBpPlanRoom& R) { return R.id == Bay->parentId; }) : nullptr;
			if (Room) F.RoomName = Room->name;
		}
		if (F.Feature) for (const FString& Dep : F.Feature->depends_on) { if (F.Neighbours.Num() >= 4) break; F.Neighbours.Add(NameOf(Dep)); }
		// The body's sentences: the lens's reading ("The Design lens reads: ..."), the summary and the impact.
		F.Summary = FirstSentence(Section(P.body, TEXT("Summary")));
		F.Impact = Section(P.body, TEXT("Impact"));
		if (F.Impact.IsEmpty()) F.Impact = Section(P.body, TEXT("Expected impact"));
		{
			const FString Marker = TEXT("lens reads: ");
			const int32 At = P.body.Find(Marker);
			if (At != INDEX_NONE)
			{
				FString Rest = P.body.Mid(At + Marker.Len());
				int32 End;
				if (Rest.FindChar(TEXT('\n'), End)) Rest = Rest.Left(End);
				F.Reading = Rest.TrimStartAndEnd();
			}
		}
		// The metric: today from the finding's own "before" readings (their median), else the feature's facet; the change from
		// the scan's expected_delta (present on the wire, BpLink's Deltas).
		if (!P.metric.IsEmpty())
		{
			TArray<double> Before;
			FString MeasuredUnit;
			for (const FBpMeasurement& M : State.Scan.measurements)
			{
				if (M.proposal_id != P.id || M.metric != P.metric || M.phase != BpVocab::Measurement::Phase::Before) continue;
				Before.Add(M.value);
				MeasuredUnit = M.unit;
				if (F.Method.IsEmpty()) F.Method = M.method;
			}
			double Today = 0.0;
			bool bToday = Before.Num() > 0;
			if (bToday) { Before.Sort(); Today = Before[Before.Num() / 2]; }
			else bToday = Link.FindFacetNumber(P.feature, P.lens, P.metric, Today);
			const double* Delta = State.Deltas.Find(P.id);
			if (bToday && Delta)
			{
				F.bMetric = true;
				F.Today = Today;
				F.After = Today + *Delta;
				F.Label = BpWords::Metric(P.lens, P.metric);
				F.Unit = BpWords::Unit(P.lens, P.metric, MeasuredUnit);
				// A unit the label already says ("Console errors · errors") is not said twice.
				if (F.Label.Contains(F.Unit, ESearchCase::IgnoreCase)) F.Unit.Reset();
			}
			// How it is measured: the reading's method, else the evaluation's "(probe)".
			if (F.Method.IsEmpty())
			{
				const FString Eval = Section(P.body, TEXT("Evaluation"));
				int32 Open = INDEX_NONE, Close = INDEX_NONE;
				if (Eval.FindChar(TEXT('('), Open) && Eval.FindChar(TEXT(')'), Close) && Close > Open)
				{
					FString Word = Eval.Mid(Open + 1, Close - Open - 1);
					Word.Split(TEXT(","), &Word, nullptr);
					for (const TCHAR* Known : BpVocab::Measurement::Method::AllValues) if (Word == Known) F.Method = Word;
				}
			}
			// The budget the reading names, only when the reading is about this figure ("p95 1450 ms, over the 1000 ms budget"),
			// and the target the impact names ("(target 500)").
			if (F.bMetric && F.Reading.Contains(Fmt(F.Today)) && NumberAfter(F.Reading, TEXT("over the "), F.Budget)) F.bBudget = F.Reading.Contains(TEXT(" budget"));
			if (F.bMetric) F.bTarget = NumberAfter(P.body, TEXT("(target "), F.Target);
		}
		for (const FBpProposal& Each : State.Scan.proposals) if (Each.feature == P.feature && Each.status == BpVocab::Proposal::Status::Proposed) ++F.Open;
		return F;
	}

	/** A node of the touches map: a compact rounded label with a name (wave W3b: in one line or two), the feature's or another's
	 *  (wave W3: a label's corners, not a pill's). */
	enum class ENode : uint8 { Feature, Other };
	TSharedRef<SWidget> Node(const FString& Name, ENode Look, const FSlateFontInfo& NodeFont)
	{
		const FLinearColor Fill = Look == ENode::Feature ? BpSheet::Amber : BpSheet::PaperLo;
		const FLinearColor Edge = Look == ENode::Feature ? BpSheet::Amber : BpSheet::Ink.CopyWithNewOpacity(0.55f);
		const FLinearColor Ink = Look == ENode::Feature ? BpSheet::PaperLo : BpSheet::Ink;
		return SNew(SOverlay)
			+ SOverlay::Slot()[SNew(SBorder).BorderImage(Rounded(9.f)).BorderBackgroundColor(Edge).Padding(2.f)[SNew(SBorder).BorderImage(Rounded(7.f)).BorderBackgroundColor(Fill).Padding(0.f)]]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(FMargin(10.f, 0.f))[SNew(STextBlock).Text(FText::FromString(Name)).Font(NodeFont).Justification(ETextJustify::Center).LineHeightPercentage(Name.Contains(TEXT("\n")) ? 0.82f : 1.f).Clipping(EWidgetClipping::Inherit).ColorAndOpacity(FSlateColor(Ink))];
	}

	/** Words (a token with a letter in it) in a text. */
	int32 WordsIn(const FString& Text)
	{
		TArray<FString> Tokens;
		Text.ParseIntoArrayWS(Tokens);
		int32 N = 0;
		for (const FString& Token : Tokens) for (const TCHAR C : Token) if (FChar::IsAlpha(C)) { ++N; break; }
		return N;
	}

	/** A segment crosses a box (Liang-Barsky). */
	bool SegmentHits(const FVector2f& A, const FVector2f& B, const FBox2f& Box)
	{
		float T0 = 0.f, T1 = 1.f;
		const FVector2f D = B - A;
		const float P[4] = { -D.X, D.X, -D.Y, D.Y };
		const float Q[4] = { A.X - Box.Min.X, Box.Max.X - A.X, A.Y - Box.Min.Y, Box.Max.Y - A.Y };
		for (int32 I = 0; I < 4; ++I)
		{
			if (FMath::IsNearlyZero(P[I])) { if (Q[I] < 0.f) return false; continue; }
			const float T = Q[I] / P[I];
			if (P[I] < 0.f) T0 = FMath::Max(T0, T); else T1 = FMath::Min(T1, T);
			if (T0 > T1) return false;
		}
		return true;
	}
}

namespace BpBoard
{
	const TCHAR* CaseWord(ECase Case)
	{
		switch (Case)
		{
		case ECase::Split: return TEXT("split (before and after screens)");
		case ECase::Shot: return TEXT("screen (before only)");
		case ECase::Metric: return TEXT("metric (today and after)");
		default: return TEXT("state (stage track)");
		}
	}

	const FBpShot* FindShot(const FString& Proposal, const TCHAR* Phase)
	{
		if (Proposal.IsEmpty()) return nullptr;
		return FBpLinkModule::Get().GetScanState().Scan.shots.FindByPredicate([&Proposal, Phase](const FBpShot& Each) { return Each.proposal_id == Proposal && Each.phase == Phase && Each.path.EndsWith(TEXT(".png")); });
	}

	ECase CaseOf(const FString& Proposal)
	{
		const bool bBefore = FindShot(Proposal, BpVocab::Shot::Phase::Before) != nullptr;
		if (bBefore && FindShot(Proposal, BpVocab::Shot::Phase::After)) return ECase::Split;
		if (bBefore) return ECase::Shot;
		return Gather(Proposal).bMetric ? ECase::Metric : ECase::State;
	}

	FBox2f StopBox(int32 Stop)
	{
		const float W = 200.f, Gap = 14.f, Y = Y1 - 52.f;
		const float Start = StageX0 + 4.f;
		return FBox2f(FVector2f(Start + Stop * (W + Gap), Y), FVector2f(Start + Stop * (W + Gap) + W, Y1));
	}

	void Draw(const FIn& In, FPut Put, FStopControl StopControl, FOut& Out)
	{
		// Wave W3: three sizes only (BpBoard.h): CapL the title, CapM Glim's line, the hero's label and the stage's labels, CapS
		// (the floor) the muted headings, the notes and the map's names. The figures (the hero's, the bars') are figures.
		const auto FontAt = [](bool bBold, float Cap) { return Font(bBold ? TEXT("Bold") : TEXT("Regular"), Cap); };
		const FSlateFontInfo SBold = FontAt(true, CapS), SReg = FontAt(false, CapS), MBold = FontAt(true, CapM), MReg = FontAt(false, CapM), LBold = FontAt(true, CapL);
		const FLinearColor Muted = BpSheet::Ink.CopyWithNewOpacity(0.62f);
		// Wave W2: the board's own words are counted (a token with a letter in it; figures and arrows are not words). Wave W3:
		// and every block is measured against its box, and every block that lost words is named (FOut, BpBoard.Audit).
		int32 WordCount = 0;
		float MinCap = 1000.f;
		TArray<FString> Over, Short;
		const auto Count = [&WordCount](const FString& Text) { WordCount += WordsIn(Text); };
		const auto Check = [&](const TCHAR* What, const FString& Text, const FSlateFontInfo& WordFont, float Cap, const FBox2f& Box, float LineH)
		{
			MinCap = FMath::Min(MinCap, Cap);
			TArray<FString> Lines;
			Text.ParseIntoArrayLines(Lines, false);
			float W = 0.f;
			for (const FString& Line : Lines) W = FMath::Max(W, BpSheet::TextWidth(Line, WordFont));
			// The ink: the lines' pitch between the first cap and the last, and the last line's cap and descender.
			const float Ink = FMath::Max(0, Lines.Num() - 1) * Pitch(Cap) * LineH + Cap * 1.29f;
			if (W > Box.GetSize().X + 0.5f || Ink > Box.GetSize().Y + 1.f)
				Over.Add(FString::Printf(TEXT("%s \"%s\" %.0fx%.0f in %.0fx%.0f"), What, *Text.Replace(TEXT("\n"), TEXT(" / ")), W, Ink, Box.GetSize().X, Box.GetSize().Y));
		};
		const auto Words = [&](const TCHAR* What, const FBox2f& Box, const FString& Text, float Cap, bool bBold, const FLinearColor& Ink, EVerticalAlignment V = VAlign_Center, float LineH = 1.f)
		{
			if (Text.IsEmpty()) return;
			const FSlateFontInfo WordFont = FontAt(bBold, Cap);
			Count(Text);
			Check(What, Text, WordFont, Cap, Box, LineH);
			Put(Box, SNew(SBox).VAlign(V)[SNew(STextBlock).Text(FText::FromString(Text)).Font(WordFont).LineHeightPercentage(LineH).Clipping(EWidgetClipping::Inherit).ColorAndOpacity(FSlateColor(Ink))]);
		};
		const auto Shorten = [&](const TCHAR* What, const FString& Name, const FSlateFontInfo& NameFont, float MaxW)
		{
			const FString S = ShortenWords(Name, NameFont, MaxW);
			if (S != Name) Short.Add(FString::Printf(TEXT("%s \"%s\" -> \"%s\""), What, *Name, *S));
			return S;
		};
		const auto Wrap = [&](const TCHAR* What, const FString& Text, const FSlateFontInfo& WrapFont, float MaxW, int32 MaxLines, bool* bAllOut = nullptr)
		{
			bool bAll = false;
			const FString S = WrapWhole(Text, WrapFont, MaxW, MaxLines, &bAll);
			if (!bAll && !bAllOut) Short.Add(FString::Printf(TEXT("%s \"%s\" -> \"%s\""), What, *Text, *S.Replace(TEXT("\n"), TEXT(" "))));
			if (bAllOut) *bAllOut = bAll;
			return S;
		};
		// A chip is as wide as its words (ChipWidth): its words are counted and its cap kept.
		const auto ChipAt = [&](const FBox2f& Box, const FString& Word, const FSlateFontInfo& ChipFont, float Cap, const FLinearColor& Tone, bool bSolid)
		{
			Count(Word);
			MinCap = FMath::Min(MinCap, Cap);
			Put(Box, BpSheet::Chip(Word, ChipFont, Box.GetSize().Y, Tone, bSolid));
		};
		const auto Tile = [&Put](const FBox2f& Box) { Put(Box, SNew(BpSheet::SPlate).Fill(TileFill).Edge(TileEdge).EdgePx(2.f)); };
		const FFacts F = Gather(In.Proposal);
		const FBpProposal* P = F.P;
		Out.Case = P ? CaseOf(In.Proposal) : ECase::State;
		TArray<FString> Said;

		// ---- The title row: the chip, the title on one line at CapL, else at CapM, else two lines at CapS; never cut ---------
		{
			float X = X0;
			if (!In.Chip.IsEmpty())
			{
				const float W = BpSheet::ChipWidth(In.Chip, MBold), CY = (TitleY0 + TitleY1) * 0.5f;
				ChipAt(FBox2f(FVector2f(X, CY - 20.f), FVector2f(X + W, CY + 20.f)), In.Chip, MBold, CapM, BpSheet::Amber, true);
				X += W + 20.f;
			}
			const float Avail = X1 - X;
			const FBox2f TitleBox(FVector2f(X, TitleY0), FVector2f(X1, TitleY1));
			float Cap = CapL;
			if (BpSheet::TextWidth(In.Title, LBold) <= Avail) Words(TEXT("title"), TitleBox, In.Title, CapL, true, BpSheet::InkHi);
			else if (BpSheet::TextWidth(In.Title, MBold) <= Avail) { Cap = CapM; Words(TEXT("title"), TitleBox, In.Title, CapM, true, BpSheet::InkHi); }
			else
			{
				Cap = CapS;
				Words(TEXT("title"), TitleBox, Wrap(TEXT("title"), In.Title, SBold, Avail, 2), CapS, true, BpSheet::InkHi, VAlign_Center, 0.78f);
			}
			Said.Add(FString::Printf(TEXT("title at %.0f"), Cap));
		}

		// ---- The left column: the hero, Glim's line, what it touches ----------------------------------------------------------
		// Wave W3b: the hero as tall as its figures and label, Glim's tile as tall as its line (one line or two), and what it
		// touches the rest of the column (190 to 230 of its 398 px, from 182).
		FBox2f Hero(FVector2f(X0, Y0), FVector2f(ColX1, Y0 + 116.f));
		FBox2f GlimBox = Hero, Touch = Hero;
		const auto SaysMore = [&In](const FString& S) { FString A = S, B = In.Title; A.RemoveFromEnd(TEXT(".")); B.RemoveFromEnd(TEXT(".")); return !S.IsEmpty() && !A.Equals(B, ESearchCase::IgnoreCase); };
		const FString Proposes = SaysMore(F.Summary) ? F.Summary : F.Impact;
		// Glim's line: the lens's reading; when another tile already says what it says (the hero its figure, the chart the
		// budget, the track the stage), what the finding proposes instead. Each fact once.
		FString Glim = F.Reading;
		// The hero: the metric's today -> after; else the reading's first figure; else the open findings this one closes; else the
		// risk. Wave W3: no muted verdict under it (the chart says the budget, once).
		FString Today, After, Label;
		bool bHeroFindings = false, bHeroRisk = false;
		// A sentence another tile already says: the hero's figures, the chart's budget (and target), the track's stage.
		const auto Repeats = [&](const FString& S)
		{
			if (S.IsEmpty() || !SaysMore(S)) return true;
			if (!bHeroFindings && !bHeroRisk && !Today.IsEmpty() && HasFigure(S, Today)) return true;
			if (!bHeroFindings && !bHeroRisk && !After.IsEmpty() && After != Today && HasFigure(S, After)) return true;
			if (F.bMetric && F.bBudget && S.Contains(TEXT(" budget"))) return true;
			if (Out.Case == ECase::State && F.Feature && !F.Feature->stage.IsEmpty() && S.Contains(BpWords::Humanise(F.Feature->stage), ESearchCase::IgnoreCase)) return true;
			return false;
		};
		if (P && F.bMetric)
		{
			Today = Fmt(F.Today);
			After = Fmt(F.After);
			Label = (F.Unit.IsEmpty() ? F.Label : F.Label + TEXT(" · ") + F.Unit).ToUpper();
		}
		else if (P && FirstFigure(F.Reading, Today, Label))
		{
			// Wave W3: a long reading's words split at their first joint: the hero's label takes the part with the figure, Glim's
			// line the rest ("38 customer requests in 30 days and nobody can use it yet": CUSTOMER REQUESTS IN 30 DAYS; "Nobody
			// can use it yet.").
			FString Rest;
			if (BpSheet::TextWidth(Label.ToUpper(), MBold) > Hero.GetSize().X - 48.f)
			{
				for (const TCHAR* Joint : { TEXT(", and "), TEXT(" and "), TEXT(", "), TEXT("; "), TEXT(" while ") })
				{
					FString A, B;
					if (Label.Split(Joint, &A, &B) && !A.IsEmpty() && !B.IsEmpty())
					{
						Label = A;
						Rest = B.Left(1).ToUpper() + B.Mid(1);
						if (!Rest.EndsWith(TEXT("."))) Rest += TEXT(".");
						break;
					}
				}
			}
			Label = Label.ToUpper();
			Glim = !Rest.IsEmpty() ? Rest : Proposes;
		}
		else if (P && F.Open > 0)
		{
			Today = FString::FromInt(F.Open);
			After = FString::FromInt(F.Open - 1);
			Label = F.Open == 1 ? TEXT("OPEN FINDING") : TEXT("OPEN FINDINGS");
			bHeroFindings = true;
		}
		else if (P)
		{
			Today = Fmt(P->risk);
			Label = FString::Printf(TEXT("RISK · %s LENS"), *BpWords::Lens(P->lens).ToUpper());
			bHeroRisk = true;
		}
		// Glim's line says what no other tile says: the reading, else what the finding proposes (its summary, its impact), else
		// (a metric against a budget) the verdict in words, the chart keeping the budget's figure.
		if (P && Repeats(Glim))
		{
			FString Pick;
			for (const FString& Each : { F.Reading, F.Summary, F.Impact }) if (Pick.IsEmpty() && !Repeats(Each)) Pick = Each;
			if (Pick.IsEmpty() && F.bMetric && F.bBudget)
				Pick = F.Today > F.Budget ? (F.After <= F.Budget ? TEXT("Over budget today; under it once approved.") : TEXT("Over budget today, and still over once approved.")) : TEXT("Within budget today; approving cuts it further.");
			if (!Pick.IsEmpty()) Glim = Pick;
		}
		if (Glim.IsEmpty() && P) Glim = Proposes;
		if (!P) Glim = In.Fallback;
		{
			// Wave W3b: the label beside the figures (in two lines at most) when it fits there, the tile then only as tall as the
			// figures (92 px); else under them, the figures at most 64 px of cap (116 px).
			const float In0 = Hero.Min.X + 24.f, In1 = Hero.Max.X - 24.f;
			float Cap = 72.f;
			FString Beside;
			if (!Today.IsEmpty())
			{
				// The largest cap the figures fit at, down to 44.
				const auto Width = [&](float C)
				{
					const FSlateFontInfo NumFont = Font(TEXT("Bold"), C);
					return BpSheet::TextWidth(Today, NumFont) + (After.IsEmpty() ? 0.f : BpSheet::TextWidth(After, NumFont) + C * 1.6f);
				};
				while (Cap > 44.f && Width(Cap) > In1 - In0) Cap -= 4.f;
				// Beside: the largest cap from there down to 56 that leaves the label room in one line or two even ones.
				for (float Try = Cap; Try >= 56.f && Beside.IsEmpty(); Try -= 4.f)
				{
					const float Avail = In1 - (In0 + Width(Try) + 28.f);
					if (Avail > 110.f) Beside = TwoEven(Label, MBold, Avail);
					if (!Beside.IsEmpty()) Cap = Try;
				}
				if (Beside.IsEmpty()) { while (Cap > 64.f) Cap -= 4.f; while (Cap > 44.f && Width(Cap) > In1 - In0) Cap -= 4.f; }
				const float LX = In0 + Width(Cap) + 28.f;
				Hero.Max.Y = Hero.Min.Y + (Beside.IsEmpty() ? 10.f + Cap + 6.f + 32.f + 4.f : FMath::Max(Cap + 20.f, Beside.Contains(TEXT("\n")) ? 80.f : 52.f));
				Tile(Hero);
				const FSlateFontInfo NumFont = Font(TEXT("Bold"), Cap);
				TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Today)).Font(NumFont).ColorAndOpacity(FSlateColor(BpSheet::Amber))];
				if (!After.IsEmpty())
				{
					Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(Cap * 0.25f, 0.f)[Arrow(Cap * 0.8f, BpSheet::Ink.CopyWithNewOpacity(0.8f))];
					Row->AddSlot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(After)).Font(NumFont).ColorAndOpacity(FSlateColor(BpSheet::Accent))];
				}
				// The figures' line box sits about a twelfth of the cap above their ink: the ink centred in the tile when beside.
				const float Mid = Beside.IsEmpty() ? Hero.Min.Y + 10.f + Cap * 0.5f : Hero.GetCenter().Y - Cap * 0.08f;
				Put(FBox2f(FVector2f(In0, Mid - Cap * 0.8f), FVector2f(In1, Mid + Cap * 0.8f)), SNew(SBox).VAlign(VAlign_Center)[Row]);
				if (!Beside.IsEmpty())
				{
					const float InkMid = Hero.GetCenter().Y;
					const float Half = FMath::Max(Cap * 0.5f + 4.f, Beside.Contains(TEXT("\n")) ? 35.f : 20.f);
					Words(TEXT("hero's label"), FBox2f(FVector2f(LX, InkMid - Half), FVector2f(In1, InkMid + Half)), Beside, CapM, true, BpSheet::InkHi, VAlign_Center, 0.82f);
				}
			}
			else Tile(Hero);
			if (Beside.IsEmpty())
			{
				const float LabelY = Hero.Min.Y + 10.f + Cap + 6.f;
				Words(TEXT("hero's label"), FBox2f(FVector2f(In0, LabelY), FVector2f(In1, LabelY + 32.f)), Shorten(TEXT("hero's label"), Label, MBold, In1 - In0), CapM, true, BpSheet::InkHi);
			}
			GlimBox = FBox2f(FVector2f(X0, Hero.Max.Y + 8.f), FVector2f(ColX1, Hero.Max.Y + 8.f + GlimTwoH));
			Touch = FBox2f(FVector2f(X0, GlimBox.Max.Y + 8.f), FVector2f(ColX1, Y1));
			Said.Add(FString::Printf(TEXT("hero \"%s%s%s\" at %.0f \"%s\""), *Today, After.IsEmpty() ? TEXT("") : TEXT(" -> "), *After, Cap, *Label));
		}
		{
			// Glim's line beside the lit lamp: two lines at CapM, else its first sentence; whole words only, never smaller.
			const float DiscD = 44.f;
			const float DiscX = GlimBox.Min.X + 20.f + DiscD * 0.5f;
			const float TX0 = DiscX + DiscD * 0.5f + 20.f, TX1 = GlimBox.Max.X - 16.f;
			// Wave W3: the first form that fits whole, never a sentence cut short: the line, without its asides in brackets, its
			// first sentence; then another sentence no tile says that fits; only then cut, at a clause's joint.
			const auto Forms = [&F](const FString& S)
			{
				TArray<FString> Out;
				const auto Plain = [](FString T)
				{
					for (int32 Open = T.Find(TEXT(" (")); Open != INDEX_NONE; Open = T.Find(TEXT(" (")))
					{
						const int32 Close = T.Find(TEXT(")"), ESearchCase::CaseSensitive, ESearchDir::FromStart, Open);
						if (Close == INDEX_NONE) break;
						T = T.Left(Open) + T.Mid(Close + 1);
					}
					return T;
				};
				for (const FString& Each : { S, Plain(S), FirstSentence(S), Plain(FirstSentence(S)) }) if (!Each.IsEmpty()) Out.AddUnique(Each);
				// The feature's name is the map's lit node (and the title's): "it" says it again in one word, and comes first.
				if (!F.FeatureName.IsEmpty())
				{
					TArray<FString> Its;
					for (const FString& Each : Out)
					{
						if (!Each.Contains(F.FeatureName)) continue;
						FString It = Each.Replace(*F.FeatureName, TEXT("it"));
						Its.AddUnique(It.Left(1).ToUpper() + It.Mid(1));
					}
					for (const FString& Each : Out) Its.AddUnique(Each);
					return Its;
				}
				return Out;
			};
			bool bAll = false;
			FString Fit;
			TArray<FString> Tries = Forms(Glim);
			if (P) for (const FString& Other : { F.Reading, F.Summary, F.Impact }) if (Other != Glim && !Repeats(Other)) Tries.Append(Forms(Other));
			for (const FString& Try : Tries)
			{
				if (bAll) break;
				Fit = WrapWhole(Try, MReg, TX1 - TX0, 2, &bAll);
				// Only a form that lost words is a shortening ("it" for the feature's name is the same sentence).
				if (bAll && Try != Glim && Forms(Glim)[0] != Try) Short.Add(FString::Printf(TEXT("Glim's line \"%s\" -> \"%s\""), *Glim, *Try));
			}
			if (!bAll)
			{
				// Still too long: it ends at its last clause's joint, a sentence again, rather than on a stray word.
				Fit = WrapWhole(Glim, MReg, TX1 - TX0, 2);
				FString Flat = Fit.Replace(TEXT("\n"), TEXT(" "));
				int32 Cut = INDEX_NONE;
				for (const TCHAR* Joint : { TEXT(", "), TEXT("; "), TEXT(": ") }) Cut = FMath::Max(Cut, Flat.Find(Joint, ESearchCase::CaseSensitive, ESearchDir::FromEnd));
				if (Cut > Flat.Len() / 3) Fit = WrapWhole(Flat.Left(Cut) + TEXT("."), MReg, TX1 - TX0, 2);
				else if (!Fit.IsEmpty() && FChar::IsAlnum(Fit[Fit.Len() - 1])) Fit += TEXT(".");
				Short.Add(FString::Printf(TEXT("Glim's line \"%s\" cut to \"%s\""), *Glim, *Fit.Replace(TEXT("\n"), TEXT(" "))));
			}
			// Wave W3b: the tile as tall as the line (one line most often), what it touches taking the rest.
			if (!Fit.Contains(TEXT("\n")))
			{
				GlimBox.Max.Y = GlimBox.Min.Y + GlimOneH;
				Touch.Min.Y = GlimBox.Max.Y + 8.f;
			}
			Tile(GlimBox);
			const FVector2f C(DiscX, GlimBox.GetCenter().Y);
			Put(FBox2f(C - FVector2f(DiscD * 0.5f + 6.f), C + FVector2f(DiscD * 0.5f + 6.f)), SNew(BpSheet::SRing).Color(BpSheet::Amber.CopyWithNewOpacity(0.45f)).Thick(5.f));
			Put(FBox2f(C - FVector2f(DiscD * 0.5f), C + FVector2f(DiscD * 0.5f)), Disc(LampWhite, DiscD));
			Words(TEXT("Glim's line"), FBox2f(FVector2f(TX0, GlimBox.Min.Y + 4.f), FVector2f(TX1, GlimBox.Max.Y - 4.f)), Fit, CapM, false, BpSheet::InkHi, VAlign_Center, 0.82f);
			Said.Add(FString::Printf(TEXT("Glim \"%s\"%s"), *Fit.Replace(TEXT("\n"), TEXT(" ")), bAll ? TEXT("") : TEXT(" (shortened)")));
		}
		Tile(Touch);
		{
			// What it touches (wave W3b, the design's tile): the feature, the largest node, filled amber; what it depends on (the
			// structure's depends_on, the data's direction: each line starts at the feature and ends in an arrowhead at the
			// dependency), each joined by one straight line from the feature's edge to its own; the room an outlined caption, never
			// in a line's path. 0: the feature alone in the middle, "Stands alone" under it; 1: the feature at the top left, the
			// dependency down at the right (a diagonal); 2: a V under the feature; 3 and 4: a fan, the feature at the left (two
			// lines of name when it is long) with the room under it, the dependencies in a column at the right, every line from one
			// point on the feature's right edge. The room sits on the heading's row up to two, under the feature in a fan. Names
			// shorten by whole words to their places.
			const float GL = Touch.Min.X + 14.f, GR = Touch.Max.X - 14.f, CX = Touch.GetCenter().X, Span = GR - GL;
			const float NH = 38.f;
			const int32 N = FMath::Min(F.Neighbours.Num(), 4);
			const bool bFan = N >= 3;
			const FString TouchWord = TEXT("WHAT IT TOUCHES");
			const FBox2f LabelBox(FVector2f(Touch.Min.X + 18.f, Touch.Min.Y + 4.f), FVector2f(Touch.Min.X + 22.f + BpSheet::TextWidth(TouchWord, SBold), Touch.Min.Y + 32.f));
			Words(TEXT("map's heading"), LabelBox, TouchWord, CapS, true, Muted);
			const auto Natural = [&](const FString& Name, const FSlateFontInfo& NameFont)
			{
				TArray<FString> Lines;
				Name.ParseIntoArrayLines(Lines);
				float W = 0.f;
				for (const FString& Line : Lines) W = FMath::Max(W, BpSheet::TextWidth(Line, NameFont));
				return W * 1.03f + 24.f;
			};
			const auto Room = [](float SlotW) { return (SlotW - 24.f) / 1.03f; };
			struct FNode { FBox2f Box; FString Name; ENode Look; };
			TArray<FNode> Nodes;
			// The feature's name: one line; beside one dependency or in a fan, two even ones when one would take more than its side.
			const float FeatMax = bFan ? Span * 0.5f : N == 1 ? Span * 0.6f : Span;
			FString FeatName = F.FeatureName;
			if (!FeatName.IsEmpty() && Natural(FeatName, MBold) > FeatMax)
			{
				const FString Two = bFan || N == 1 ? TwoEven(FeatName, MBold, Room(FeatMax)) : FString();
				FeatName = !Two.IsEmpty() ? Two : Shorten(TEXT("map's feature"), FeatName, MBold, Room(FeatMax));
			}
			const bool bTwoLines = FeatName.Contains(TEXT("\n"));
			const float FH = bTwoLines ? 74.f : 44.f;
			const float FeatW = FeatName.IsEmpty() ? 0.f : Natural(FeatName, MBold);
			// The room's caption: on the heading's row, or (a fan) under the feature at the tile's foot (placed once the lines are).
			FString RoomWord;
			FBox2f RoomBox(FVector2f(GR, LabelBox.Min.Y), FVector2f(GR, LabelBox.Min.Y));
			const float RoomH = 32.f, RoomTop = Touch.Max.Y - 8.f - RoomH;
			const auto PlaceRoom = [&](float RoomMax)
			{
				if (F.RoomName.IsEmpty()) return;
				// In capitals when they fit, else as the plan writes it, else shortened by whole words.
				RoomWord = BpSheet::TextWidth(F.RoomName.ToUpper(), SBold) <= RoomMax - 30.f ? F.RoomName.ToUpper() : Shorten(TEXT("map's room"), F.RoomName, SBold, RoomMax - 30.f);
				if (RoomWord.IsEmpty()) return;
				const float W = BpSheet::ChipWidth(RoomWord, SBold);
				RoomBox = bFan ? FBox2f(FVector2f(GL, RoomTop), FVector2f(GL + W, RoomTop + RoomH)) : FBox2f(FVector2f(GR - W, Touch.Min.Y + 3.f), FVector2f(GR, Touch.Min.Y + 3.f + RoomH));
				ChipAt(RoomBox, RoomWord, SBold, CapS, BpSheet::Accent, false);
			};
			if (!bFan) PlaceRoom(GR - LabelBox.Max.X - 12.f);
			const float A0 = Touch.Min.Y + 42.f, A1 = Touch.Max.Y - 10.f;
			FBox2f FeatBox;
			if (bFan)
			{
				// At the left, in the middle of what the heading and the room leave.
				const float Top = LabelBox.Max.Y + 8.f, Bottom = F.RoomName.IsEmpty() ? A1 : RoomTop - 10.f;
				const float FY = FMath::Max(Top, (Top + Bottom) * 0.5f - FH * 0.5f);
				FeatBox = FBox2f(FVector2f(GL, FY), FVector2f(GL + FeatW, FY + FH));
			}
			else
			{
				const float FX = N == 1 ? GL + Span * 0.3f : CX;
				const float FY = N == 0 ? (A0 + A1) * 0.5f - FH * 0.5f - 18.f : A0;
				const float FL = FMath::Max(GL, FX - FeatW * 0.5f);
				FeatBox = FBox2f(FVector2f(FL, FY), FVector2f(FL + FeatW, FY + FH));
			}
			if (!FeatName.IsEmpty()) Nodes.Add({ FeatBox, FeatName, ENode::Feature });
			if (N == 0 && !FeatName.IsEmpty())
			{
				const FString Alone = TEXT("Stands alone");
				const float W = BpSheet::TextWidth(Alone, MReg) + 4.f;
				Words(TEXT("map's note"), FBox2f(FVector2f(CX - W * 0.5f, FeatBox.Max.Y + 8.f), FVector2f(CX + W * 0.5f, FeatBox.Max.Y + 40.f)), Alone, CapM, false, Muted);
			}
			// The dependencies' places: a slot [XA, XB] on a row, the node at its left (-1), centre (0) or right (+1).
			struct FSlot { float XA, XB, Y; int32 Align; };
			TArray<FSlot> Slots;
			if (N == 1) Slots = { { GL + Span * 0.4f, GR, A1 - NH, 0 } };
			else if (N == 2) Slots = { { GL, CX - 8.f, A1 - NH, 0 }, { CX + 8.f, GR, A1 - NH, 0 } };
			else if (bFan)
			{
				// A column spread over the tile's height (gaps of at most 20 px), its names' left edges in line, as far right as the
				// widest lets it (the lines as long as the tile allows).
				const float FanX = FMath::Max(GL + FeatW + 48.f, LabelBox.Max.X + 20.f);
				float Widest = 0.f;
				for (int32 I = 0; I < N; ++I) Widest = FMath::Max(Widest, Natural(ShortenWords(F.Neighbours[I], MReg, Room(GR - FanX)), MReg));
				const float XA = FMath::Max(FanX, GR - Widest - 2.f), T = Touch.Min.Y + 8.f, B = Touch.Max.Y - 8.f;
				const float Gap = FMath::Min(20.f, (B - T - N * NH) / (N - 1));
				const float Y = (T + B) * 0.5f - (N * NH + (N - 1) * Gap) * 0.5f;
				for (int32 I = 0; I < N; ++I) Slots.Add({ XA, GR, Y + I * (NH + Gap), -1 });
			}
			const FVector2f FC = FeatName.IsEmpty() ? FVector2f(CX, A0) : FeatBox.GetCenter();
			// Where the line from the feature's centre toward a point leaves the feature's box.
			const auto Leave = [&](const FVector2f& T)
			{
				const FVector2f D = T - FC, Half = FeatBox.GetExtent();
				float S = 1.f;
				if (FMath::Abs(D.X) > 0.01f) S = FMath::Min(S, Half.X / FMath::Abs(D.X));
				if (FMath::Abs(D.Y) > 0.01f) S = FMath::Min(S, Half.Y / FMath::Abs(D.Y));
				return FC + D * S;
			};
			TArray<TArray<FVector2f>> Thin;
			TArray<TPair<FVector2f, FVector2f>> Links;
			TArray<FString> LinkTo;
			int32 Placed = 0;
			for (int32 I = 0; I < Slots.Num(); ++I)
			{
				const FSlot& S = Slots[I];
				const FString& Name = F.Neighbours[I];
				const FString Fit = Shorten(TEXT("map's dependency"), Name, MReg, Room(S.XB - S.XA));
				if (Fit.IsEmpty()) { Short.Add(FString::Printf(TEXT("map's dependency \"%s\" left off (no place)"), *Name)); continue; }
				const float W = Natural(Fit, MReg);
				const float BX = S.Align < 0 ? S.XA : S.Align > 0 ? S.XB - W : (S.XA + S.XB - W) * 0.5f;
				const FBox2f Box(FVector2f(BX, S.Y), FVector2f(BX + W, S.Y + NH));
				Nodes.Add({ Box, Fit, ENode::Other });
				++Placed;
				// The line: from the feature's edge (a fan's from one point on its right edge) to the node's near edge.
				const FVector2f End = bFan ? FVector2f(Box.Min.X, Box.GetCenter().Y) : FVector2f(Box.GetCenter().X, Box.Min.Y);
				const FVector2f Start = bFan ? FVector2f(FeatBox.Max.X, FC.Y) : Leave(End);
				const FVector2f Dir = (End - Start).GetSafeNormal();
				const FVector2f From = Start + Dir * 4.f, Tip = End - Dir * 3.f;
				const FVector2f Side(-Dir.Y, Dir.X);
				Thin.Add({ From - Touch.Min, Tip - Touch.Min });
				Thin.Add({ Tip - Dir * 12.f + Side * 7.f - Touch.Min, Tip - Touch.Min, Tip - Dir * 12.f - Side * 7.f - Touch.Min });
				Links.Add(TPair<FVector2f, FVector2f>(From, Tip));
				LinkTo.Add(Fit);
			}
			if (bFan)
			{
				// The room under the feature, clear of the column and of the lowest line (where it comes down to the room's top).
				float RoomMax = (Slots.Num() > 0 ? Slots[0].XA : GR) - GL - 24.f;
				for (const TPair<FVector2f, FVector2f>& L : Links)
					if (L.Value.Y > RoomTop - 6.f && L.Value.Y > L.Key.Y) RoomMax = FMath::Min(RoomMax, L.Key.X + (RoomTop - 6.f - L.Key.Y) / (L.Value.Y - L.Key.Y) * (L.Value.X - L.Key.X) - 10.f - GL);
				PlaceRoom(RoomMax);
			}
			Put(Touch, SNew(SLines).Color(BpSheet::Ink.CopyWithNewOpacity(0.75f)).Thick(3.f).Lines(Thin));
			for (const FNode& Each : Nodes)
			{
				Count(Each.Name);
				MinCap = FMath::Min(MinCap, CapM);
				Put(Each.Box, Node(Each.Name, Each.Look, Each.Look == ENode::Feature ? MBold : MReg));
			}
			// The map's own check: every node inside the tile with a margin and clear of the heading and the room; no two nodes
			// meet; no line crosses a node, the heading, the room or another line, and none is shorter than its arrowhead's run.
			const FBox2f Inside(FVector2f(Touch.Min.X + 8.f, Touch.Min.Y + 6.f), FVector2f(Touch.Max.X - 8.f, Touch.Max.Y - 6.f));
			for (int32 A = 0; A < Nodes.Num(); ++A)
			{
				const FBox2f BoxA = Nodes[A].Box;
				if (BoxA.Min.X < Inside.Min.X || BoxA.Max.X > Inside.Max.X || BoxA.Min.Y < Inside.Min.Y || BoxA.Max.Y > Inside.Max.Y) Over.Add(FString::Printf(TEXT("map's node \"%s\" leaves its tile"), *Nodes[A].Name));
				if (BoxA.Intersect(LabelBox.ExpandBy(4.f))) Over.Add(FString::Printf(TEXT("map's node \"%s\" meets the heading"), *Nodes[A].Name));
				if (BoxA.Intersect(RoomBox.ExpandBy(4.f))) Over.Add(FString::Printf(TEXT("map's node \"%s\" meets the room"), *Nodes[A].Name));
				for (int32 B = A + 1; B < Nodes.Num(); ++B) if (BoxA.ExpandBy(4.f).Intersect(Nodes[B].Box)) Over.Add(FString::Printf(TEXT("map's nodes \"%s\" and \"%s\" meet"), *Nodes[A].Name, *Nodes[B].Name));
			}
			TArray<FBox2f> Blocks;
			for (const FNode& Each : Nodes) Blocks.Add(Each.Box.ExpandBy(-1.f));
			Blocks.Add(LabelBox);
			if (RoomBox.GetSize().X > 0.f) Blocks.Add(RoomBox);
			const auto Cross = [](const FVector2f& P1, const FVector2f& P2, const FVector2f& Q1, const FVector2f& Q2)
			{
				const auto Turn = [](const FVector2f& A, const FVector2f& B, const FVector2f& C) { return FVector2f::CrossProduct(B - A, C - A); };
				const float D1 = Turn(Q1, Q2, P1), D2 = Turn(Q1, Q2, P2), D3 = Turn(P1, P2, Q1), D4 = Turn(P1, P2, Q2);
				return ((D1 > 0.f && D2 < 0.f) || (D1 < 0.f && D2 > 0.f)) && ((D3 > 0.f && D4 < 0.f) || (D3 < 0.f && D4 > 0.f));
			};
			for (int32 L = 0; L < Links.Num(); ++L)
			{
				const FVector2f& P1 = Links[L].Key;
				const FVector2f& P2 = Links[L].Value;
				if (FVector2f::Distance(P1, P2) < 24.f) Over.Add(FString::Printf(TEXT("map's line to \"%s\" is %.0f px, under its arrowhead's run"), *LinkTo[L], FVector2f::Distance(P1, P2)));
				for (const FBox2f& Block : Blocks) if (SegmentHits(P1, P2, Block)) Over.Add(FString::Printf(TEXT("map's line to \"%s\" crosses a block at (%.0f,%.0f)"), *LinkTo[L], Block.Min.X, Block.Min.Y));
				for (int32 K = L + 1; K < Links.Num(); ++K) if (Cross(P1, P2, Links[K].Key, Links[K].Value)) Over.Add(FString::Printf(TEXT("map's lines to \"%s\" and \"%s\" cross"), *LinkTo[L], *LinkTo[K]));
			}
			if (!FeatName.IsEmpty()) Out.TouchAim = FeatBox.GetCenter();
			Said.Add(FString::Printf(TEXT("touches %s in %s, depends on [%s] (%d placed%s), map %.0f px tall%s"), *F.FeatureName, F.RoomName.IsEmpty() ? TEXT("-") : *F.RoomName, *FString::Join(F.Neighbours, TEXT(", ")),
				Placed, F.Neighbours.Num() > 4 ? *FString::Printf(TEXT(", %d more not drawn"), F.Neighbours.Num() - 4) : TEXT(""), Touch.GetSize().Y, bFan ? TEXT(" (a fan)") : TEXT("")));
		}

		// ---- The stage --------------------------------------------------------------------------------------------------------
		const FBox2f Stage(FVector2f(StageX0, Y0), FVector2f(X1, Y1));
		Out.Stage = Stage;
		// The lens and the risk, once (not when the hero is the risk).
		const FString LensRisk = P && !bHeroRisk ? FString::Printf(TEXT("%s · RISK %s"), *BpWords::Lens(P->lens).ToUpper(), *Fmt(P->risk)) : FString();
		const float LensRiskW = LensRisk.IsEmpty() ? 0.f : BpSheet::ChipWidth(LensRisk, MBold);
		const auto TextureOf = [](const TSharedPtr<FSlateBrush>& Brush) { return Brush.IsValid() ? Cast<UTexture2D>(Brush->GetResourceObject()) : nullptr; };
		const auto Reading = [&](const FBox2f& Box, const TCHAR* What)
		{
			Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.4f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.35f)).EdgePx(2.f));
			Put(Box, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(What)).Font(MBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.55f)))]);
		};
		const auto CornerChip = [&](const FBox2f& Img, bool bTop)
		{
			if (LensRisk.IsEmpty()) return;
			const float Y = bTop ? Img.Min.Y + 12.f : Img.Max.Y - 50.f;
			ChipAt(FBox2f(FVector2f(Img.Max.X - 12.f - LensRiskW, Y), FVector2f(Img.Max.X - 12.f, Y + 38.f)), LensRisk, MBold, CapM, BpSheet::Accent, true);
		};
		const auto Caption = [&](const FBox2f& Img, const FString& Word, const FLinearColor& Ink, bool bLeft)
		{
			const float W = BpSheet::ChipWidth(Word, MBold);
			const float CX = bLeft ? Img.Min.X + 12.f : Img.Max.X - 12.f - W;
			ChipAt(FBox2f(FVector2f(CX, Img.Max.Y - 50.f), FVector2f(CX + W, Img.Max.Y - 12.f)), Word, MBold, CapM, Ink, true);
		};

		if (Out.Case == ECase::Split)
		{
			// One screen, split: "before" under, "after" over it from the line to the right; the line at the stop. TODAY shows most
			// of the before, PROPOSED most of the after.
			const float H = Stage.GetSize().Y - 52.f - 14.f, W = FMath::Min(Stage.GetSize().X, H * 16.f / 9.f);
			const FBox2f Img(FVector2f(Stage.Min.X + (Stage.GetSize().X - W) * 0.5f, Stage.Min.Y), FVector2f(Stage.Min.X + (Stage.GetSize().X + W) * 0.5f, Stage.Min.Y + W * 9.f / 16.f));
			const float At = In.Stop == StopToday ? 0.85f : In.Stop == StopProposed ? 0.15f : 0.5f;
			if (In.Before.IsValid() && In.After.IsValid())
			{
				Put(Img.ExpandBy(4.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Ink.CopyWithNewOpacity(0.8f)).EdgePx(2.f));
				Put(Img, SNew(SImage).Image_Lambda([Brush = In.Before]() { return Brush.Get(); }));
				const TSharedPtr<FSlateBrush> Crop = MakeShared<FSlateBrush>(*In.After);
				Crop->SetUVRegion(FBox2f(FVector2f(At, 0.f), FVector2f(1.f, 1.f)));
				const float LineX = Img.Min.X + At * Img.GetSize().X;
				Put(FBox2f(FVector2f(LineX, Img.Min.Y), Img.Max), SNew(SImage).Image_Lambda([Crop]() { return Crop.Get(); }));
				Put(FBox2f(FVector2f(LineX - 3.f, Img.Min.Y), FVector2f(LineX + 3.f, Img.Max.Y)), SNew(BpSheet::SPlate).Fill(BpSheet::Amber));
				const FVector2f K(LineX, Img.GetCenter().Y);
				Put(FBox2f(K - FVector2f(26.f), K + FVector2f(26.f)), Disc(BpSheet::Amber, 52.f));
				Put(FBox2f(K - FVector2f(26.f), K + FVector2f(26.f)), SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[Arrow(26.f, BpSheet::PaperLo)]);
				Out.Aim = K;
			}
			else Reading(Img, In.bReading ? TEXT("READING THE SCREENS") : TEXT("THE SCREENS DID NOT READ"));
			Caption(Img, TEXT("TODAY"), BpSheet::Ink, true);
			Caption(Img, TEXT("PROPOSED"), BpSheet::Amber, false);
			CornerChip(Img, true);
			static const TCHAR* const StopWords[] = { TEXT("TODAY"), TEXT("SPLIT"), TEXT("PROPOSED") };
			for (int32 S = 0; S < 3; ++S) { Count(StopWords[S]); StopControl(StopBox(S), StopWords[S], In.Stop == S, S); }
			Said.Add(FString::Printf(TEXT("stage split at %s (%.0f%% after)"), StopWords[FMath::Clamp(In.Stop, 0, 2)], (1.f - At) * 100.f));
		}
		else if (Out.Case == ECase::Shot)
		{
			// The screen as large as the stage holds it, its densest words ringed.
			const float W = FMath::Min(Stage.GetSize().X, Stage.GetSize().Y * 16.f / 9.f), H = W * 9.f / 16.f;
			const FBox2f Img(FVector2f(Stage.Min.X + (Stage.GetSize().X - W) * 0.5f, Stage.Min.Y), FVector2f(Stage.Min.X + (Stage.GetSize().X + W) * 0.5f, Stage.Min.Y + H));
			if (In.Before.IsValid())
			{
				Put(Img.ExpandBy(4.f), SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo).Edge(BpSheet::Ink.CopyWithNewOpacity(0.8f)).EdgePx(2.f));
				Put(Img, SNew(SImage).Image_Lambda([Brush = In.Before]() { return Brush.Get(); }));
				FBox2f Uv;
				if (const UTexture2D* T = TextureOf(In.Before); T && BpProjector::LoupeRegion(T, nullptr, 2.f, 0.3f, Uv))
				{
					const FBox2f Ring(Img.Min + Uv.Min * Img.GetSize(), Img.Min + Uv.Max * Img.GetSize());
					Put(Ring.ExpandBy(4.f), SNew(BpSheet::SPlate).Edge(BpSheet::Amber).EdgePx(4.f));
					Out.Aim = Ring.GetCenter();
					Said.Add(FString::Printf(TEXT("stage screen %.0fx%.0f, ringed %.0fx%.0f at %.0f,%.0f"), W, H, Ring.GetSize().X, Ring.GetSize().Y, Ring.Min.X, Ring.Min.Y));
				}
				else
				{
					Out.Aim = Img.GetCenter();
					Said.Add(FString::Printf(TEXT("stage screen %.0fx%.0f, no region of words to ring"), W, H));
				}
			}
			else Reading(Img, In.bReading ? TEXT("READING THE SCREEN") : TEXT("THE SCREEN DID NOT READ"));
			Caption(Img, TEXT("TODAY"), BpSheet::Ink, true);
			CornerChip(Img, false);
		}
		else
		{
			Tile(Stage);
			const float SX0 = Stage.Min.X + 28.f, SX1 = Stage.Max.X - 28.f;
			// The stage's heading row: a muted heading at the left (when there is one), the lens and the risk at the right.
			const auto Heading = [&](const FString& Text)
			{
				if (!Text.IsEmpty()) Words(TEXT("stage's heading"), FBox2f(FVector2f(SX0, Stage.Min.Y + 14.f), FVector2f(SX1 - LensRiskW - 16.f, Stage.Min.Y + 48.f)), Shorten(TEXT("stage's heading"), Text, SBold, SX1 - SX0 - LensRiskW - 16.f), CapS, true, Muted);
				if (!LensRisk.IsEmpty()) ChipAt(FBox2f(FVector2f(SX1 - LensRiskW, Stage.Min.Y + 12.f), FVector2f(SX1, Stage.Min.Y + 50.f)), LensRisk, MBold, CapM, BpSheet::Accent, false);
			};
			// The feature's stages as the data has them (deprecated only when it is the feature's), the current one lit.
			TArray<const TCHAR*> Stages;
			for (const TCHAR* Each : BpVocab::Feature::Stage::AllValues) if (FCString::Strcmp(Each, BpVocab::Feature::Stage::Deprecated) != 0 || (F.Feature && F.Feature->stage == Each)) Stages.Add(Each);
			const int32 Here = F.Feature ? Stages.IndexOfByPredicate([&F](const TCHAR* S) { return F.Feature->stage == S; }) : INDEX_NONE;
			if (Out.Case == ECase::Metric)
			{
				// The design's chart: the row's word at the left, its bar on one axis to the right; the budget and the target as
				// dashed lines across both bars, their words over them; the part over the budget hatched. Wave W3: no heading (the
				// hero's label names the figure; once).
				Heading(FString());
				const float LabW = FMath::Max(BpSheet::TextWidth(TEXT("TODAY"), MBold), BpSheet::TextWidth(TEXT("AFTER APPROVE"), MBold)) + 20.f;
				const float BX0 = SX0 + LabW, BX1 = SX1 - 90.f;
				double Max = FMath::Max(F.Today, F.After);
				if (F.bBudget) Max = FMath::Max(Max, F.Budget);
				if (F.bTarget) Max = FMath::Max(Max, F.Target);
				Max = FMath::Max(Max * 1.08, 1e-6);
				const auto XOf = [&](double V) { return BX0 + static_cast<float>(FMath::Clamp(V / Max, 0.0, 1.0)) * (BX1 - BX0); };
				const float BarH = 48.f, T0 = Stage.Min.Y + 110.f, A0 = T0 + BarH + 40.f;
				Words(TEXT("bar's label"), FBox2f(FVector2f(SX0, T0), FVector2f(BX0 - 8.f, T0 + BarH)), TEXT("TODAY"), CapM, true, BpSheet::Amber);
				Words(TEXT("bar's label"), FBox2f(FVector2f(SX0, A0), FVector2f(BX0 - 8.f, A0 + BarH)), TEXT("AFTER APPROVE"), CapM, true, BpSheet::Accent);
				const float TodayX = XOf(F.Today), AfterX = XOf(F.After);
				const bool bOver = F.bBudget && F.Today > F.Budget;
				const float SolidX = bOver ? XOf(F.Budget) : TodayX;
				Put(FBox2f(FVector2f(BX0, T0), FVector2f(FMath::Max(BX0 + 2.f, SolidX), T0 + BarH)), SNew(BpSheet::SPlate).Fill(BpSheet::Amber));
				if (bOver)
				{
					// The part over the budget, hatched.
					const FVector2f Size(TodayX - SolidX, BarH);
					TArray<TArray<FVector2f>> Hatch;
					for (float C = 0.f; C < Size.X + Size.Y; C += 14.f)
					{
						const float YA = FMath::Max(0.f, C - Size.X), YB = FMath::Min(Size.Y, C);
						if (YB > YA) Hatch.Add({ FVector2f(C - YA, YA), FVector2f(C - YB, YB) });
					}
					const FBox2f OverBox(FVector2f(SolidX, T0), FVector2f(TodayX, T0 + BarH));
					Put(OverBox, SNew(BpSheet::SPlate).Fill(BpSheet::Amber.CopyWithNewOpacity(0.35f)).Edge(BpSheet::Amber).EdgePx(2.f));
					Put(OverBox, SNew(SLines).Color(BpSheet::Amber).Thick(4.f).Lines(Hatch));
				}
				Put(FBox2f(FVector2f(BX0, A0), FVector2f(FMath::Max(BX0 + 2.f, AfterX), A0 + BarH)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
				// A bar's figure right of its end, and right of a dashed line that would cross it.
				const auto FigureX = [&](float EndX, const FString& Figure)
				{
					float X = EndX + 12.f;
					const float W = BpSheet::TextWidth(Figure, LBold);
					for (const double V : { F.bBudget ? F.Budget : -1.0, F.bTarget ? F.Target : -1.0 })
					{
						if (V < 0.0) continue;
						const float RX = XOf(V);
						if (RX >= X - 6.f && RX <= X + W + 6.f) X = RX + 12.f;
					}
					return X;
				};
				const float TodayFigX = FigureX(TodayX, Today), AfterFigX = FigureX(AfterX, After);
				Put(FBox2f(FVector2f(TodayFigX, T0), FVector2f(SX1 + 20.f, T0 + BarH)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Today)).Font(LBold).ColorAndOpacity(FSlateColor(BpSheet::Amber))]);
				Put(FBox2f(FVector2f(AfterFigX, A0), FVector2f(SX1 + 20.f, A0 + BarH)), SNew(SBox).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(After)).Font(LBold).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
				// The dashed lines across both bars and their words over them (the words never cross: the second moves right).
				const float RuleY0 = T0 - 12.f, RuleY1 = A0 + BarH + 12.f, LabY = T0 - 46.f;
				// Wave W3: two words that would meet stand apart about their lines (the lower's ends at its line, the higher's
				// starts at its), and over each other when even that cannot part them; never past the stage.
				struct FRuleWord { float X, W, LX; FString Word; FLinearColor Ink; };
				TArray<FRuleWord> RuleWords;
				const auto Rule = [&](double V, const FString& Word, const FLinearColor& Ink)
				{
					const float X = XOf(V);
					TArray<TArray<FVector2f>> Dashes;
					for (float Y = 0.f; Y < RuleY1 - RuleY0; Y += 18.f) Dashes.Add({ FVector2f(2.f, Y), FVector2f(2.f, FMath::Min(Y + 10.f, RuleY1 - RuleY0)) });
					Put(FBox2f(FVector2f(X - 2.f, RuleY0), FVector2f(X + 2.f, RuleY1)), SNew(SLines).Color(Ink).Thick(4.f).Lines(Dashes));
					const float W = BpSheet::TextWidth(Word, MBold);
					RuleWords.Add({ X, W, FMath::Clamp(X - W * 0.5f, SX0, SX1 - W), Word, Ink });
				};
				const auto PlaceRuleWords = [&]()
				{
					float Row1 = 0.f;
					if (RuleWords.Num() == 2 && RuleWords[1].LX < RuleWords[0].LX + RuleWords[0].W + 16.f)
					{
						FRuleWord& A = RuleWords[0];
						FRuleWord& B = RuleWords[1];
						A.LX = FMath::Clamp(A.X - A.W - 6.f, SX0, SX1 - A.W);
						B.LX = FMath::Clamp(B.X + 6.f, SX0, SX1 - B.W);
						if (B.LX < A.LX + A.W + 16.f) { B.LX = FMath::Clamp(B.X - B.W * 0.5f, SX0, SX1 - B.W); Row1 = -34.f; }
					}
					for (int32 I = 0; I < RuleWords.Num(); ++I)
					{
						const FRuleWord& R = RuleWords[I];
						const float Y = LabY + (I == 1 ? Row1 : 0.f);
						Words(TEXT("rule's label"), FBox2f(FVector2f(R.LX, Y), FVector2f(R.LX + R.W + 4.f, Y + 32.f)), R.Word, CapM, true, R.Ink);
					}
				};
				TArray<TTuple<double, FString, FLinearColor>> Rules;
				if (F.bTarget) Rules.Add(MakeTuple(F.Target, FString::Printf(TEXT("TARGET %s"), *Fmt(F.Target)), TargetGreen));
				if (F.bBudget) Rules.Add(MakeTuple(F.Budget, FString::Printf(TEXT("BUDGET %s"), *Fmt(F.Budget)), BpSheet::InkHi));
				Rules.Sort([](const TTuple<double, FString, FLinearColor>& A, const TTuple<double, FString, FLinearColor>& B) { return A.Get<0>() < B.Get<0>(); });
				for (const auto& R : Rules) Rule(R.Get<0>(), R.Get<1>(), R.Get<2>());
				PlaceRuleWords();
				Out.Aim = FVector2f(TodayX, T0 + BarH * 0.5f);
				// The foot, once each: where it stands (its stage and its parts, a segment each) and how it is measured.
				const float FootY = RuleY1 + 18.f;
				Put(FBox2f(FVector2f(SX0, FootY), FVector2f(SX1, FootY + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.25f)));
				const float MidX = (SX0 + SX1) * 0.5f;
				if (F.Feature && !F.Feature->stage.IsEmpty())
				{
					Words(TEXT("foot's heading"), FBox2f(FVector2f(SX0, FootY + 8.f), FVector2f(MidX - 12.f, FootY + 36.f)), TEXT("WHERE IT STANDS"), CapS, true, Muted);
					int32 Done = 0;
					for (const FBpFeaturePartsItem& Part : F.Feature->parts) Done += Part.done ? 1 : 0;
					const int32 Parts = FMath::Min(F.Feature->parts.Num(), 12);
					float WY = FootY + 40.f;
					if (Parts > 0)
					{
						const float SegGap = 6.f, SegW = (MidX - 12.f - SX0 - SegGap * (Parts - 1)) / Parts;
						for (int32 Index = 0; Index < Parts; ++Index)
						{
							const FBox2f Seg(FVector2f(SX0 + Index * (SegW + SegGap), WY), FVector2f(SX0 + Index * (SegW + SegGap) + SegW, WY + 14.f));
							if (Index < Done) Put(Seg, SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
							else Put(Seg, SNew(BpSheet::SPlate).Edge(BpSheet::Ink.CopyWithNewOpacity(0.5f)).EdgePx(2.f));
						}
						WY += 20.f;
					}
					const FString Where = F.Feature->parts.Num() > 0 ? FString::Printf(TEXT("%s · %d of %d parts done"), *BpWords::Humanise(F.Feature->stage), Done, F.Feature->parts.Num()) : BpWords::Humanise(F.Feature->stage);
					Words(TEXT("where it stands"), FBox2f(FVector2f(SX0, WY), FVector2f(MidX - 12.f, WY + 30.f)), Shorten(TEXT("where it stands"), Where, SReg, MidX - 12.f - SX0), CapS, false, BpSheet::InkHi);
				}
				if (!F.Method.IsEmpty())
				{
					Words(TEXT("foot's heading"), FBox2f(FVector2f(MidX + 12.f, FootY + 8.f), FVector2f(SX1, FootY + 36.f)), TEXT("HOW WE KNOW"), CapS, true, Muted);
					Words(TEXT("how we know"), FBox2f(FVector2f(MidX + 12.f, FootY + 40.f), FVector2f(SX1, FootY + 92.f)), Wrap(TEXT("how we know"), FString::Printf(TEXT("%s, again after it"), *BpWords::Humanise(F.Method)), SReg, SX1 - MidX - 12.f, 2), CapS, false, BpSheet::InkHi, VAlign_Top, 0.88f);
				}
				Said.Add(FString::Printf(TEXT("stage metric %s: today %s, after %s%s%s, method %s"), *Label, *Today, *After, F.bBudget ? *FString::Printf(TEXT(", budget %s%s"), *Fmt(F.Budget), F.Today > F.Budget ? TEXT(" (over, hatched)") : TEXT("")) : TEXT(""),
					F.bTarget ? *FString::Printf(TEXT(", target %s"), *Fmt(F.Target)) : TEXT(""), F.Method.IsEmpty() ? TEXT("-") : *F.Method));
			}
			else
			{
				Heading(TEXT("WHERE IT STANDS"));
				// The track: one dot per stage, the ones before the feature's filled, its own the largest and lit, the next marked
				// (what an approval moves it toward); every word under its dot at CapM (a two-word one on two lines when it would
				// crowd), all at CapS when one would still meet its neighbour's.
				const float TX0 = SX0 + 36.f, TX1 = SX1 - 36.f;
				const float TrackY = Stage.Min.Y + 112.f, Step = Stages.Num() > 1 ? (TX1 - TX0) / (Stages.Num() - 1) : 0.f;
				Put(FBox2f(FVector2f(TX0, TrackY - 2.f), FVector2f(TX0 + Step * (Stages.Num() - 1), TrackY + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.35f)));
				if (Here > 0) Put(FBox2f(FVector2f(TX0, TrackY - 3.f), FVector2f(TX0 + Step * Here, TrackY + 3.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
				const auto TrackWord = [&](int32 Index, const FSlateFontInfo& WordFont, float& OutW)
				{
					FString Word = BpWords::Humanise(Stages[Index]).ToUpper();
					int32 Space = INDEX_NONE;
					if (BpSheet::TextWidth(Word, WordFont) > Step * 0.6f && Word.FindChar(TEXT(' '), Space)) Word = Word.Left(Space) + TEXT("\n") + Word.Mid(Space + 1);
					TArray<FString> Parts;
					Word.ParseIntoArrayLines(Parts);
					OutW = 0.f;
					for (const FString& Part : Parts) OutW = FMath::Max(OutW, BpSheet::TextWidth(Part, WordFont));
					return Word;
				};
				float TrackCap = CapM;
				for (int32 Index = 0; Index < Stages.Num(); ++Index) { float W = 0.f; TrackWord(Index, MBold, W); if (W > Step - 14.f) TrackCap = CapS; }
				const FSlateFontInfo TrackFont = TrackCap == CapM ? MBold : SBold;
				float PrevX1 = -1.e6f;
				for (int32 Index = 0; Index < Stages.Num(); ++Index)
				{
					const FVector2f C(TX0 + Step * Index, TrackY);
					const bool bHere = Index == Here, bDone = Here != INDEX_NONE && Index < Here, bNext = Here != INDEX_NONE && Index == Here + 1;
					const float D = bHere ? 48.f : 28.f;
					if (bHere) Put(FBox2f(C - FVector2f(D * 0.5f + 9.f), C + FVector2f(D * 0.5f + 9.f)), SNew(BpSheet::SRing).Color(BpSheet::Amber.CopyWithNewOpacity(0.4f)).Thick(7.f));
					if (bHere || bDone) Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), Disc(bHere ? BpSheet::Amber : BpSheet::Accent, D));
					else
					{
						Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), Disc(BpSheet::PaperLo, D));
						Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), SNew(BpSheet::SRing).Color(bNext ? BpSheet::Accent : BpSheet::Ink.CopyWithNewOpacity(0.45f)).Thick(bNext ? 4.f : 3.f));
					}
					float W = 0.f;
					const FString Word = TrackWord(Index, TrackFont, W);
					const float WX = FMath::Clamp(C.X - W * 0.5f, SX0, SX1 - W);
					const FLinearColor Ink = bHere ? BpSheet::Amber : bNext ? BpSheet::Accent : bDone ? BpSheet::Ink : BpSheet::Ink.CopyWithNewOpacity(0.55f);
					const FBox2f WordBox(FVector2f(WX, TrackY + 32.f), FVector2f(WX + W + 4.f, TrackY + 100.f));
					Put(WordBox, SNew(SBox).VAlign(VAlign_Top)
						[SNew(STextBlock).Text(FText::FromString(Word)).Font(TrackFont).Justification(ETextJustify::Center).LineHeightPercentage(0.8f).ColorAndOpacity(FSlateColor(Ink))]);
					Count(Word);
					Check(TEXT("track's word"), Word, TrackFont, TrackCap, WordBox, 0.8f);
					if (WX < PrevX1 + 8.f) Over.Add(FString::Printf(TEXT("track's word \"%s\" meets the one before it"), *Word.Replace(TEXT("\n"), TEXT(" "))));
					PrevX1 = WX + W;
					if (bHere) Out.Aim = C;
				}
				float Y = TrackY + 106.f;
				// The open findings this one closes, when the hero does not say them already.
				if (P && F.Open > 0 && !bHeroFindings)
				{
					// The family's face has no arrow: the figures and the default face's arrow in a row.
					Count(TEXT("OPEN FINDINGS"));
					MinCap = FMath::Min(MinCap, CapS);
					Put(FBox2f(FVector2f(SX0, Y), FVector2f(SX1, Y + 30.f)), SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 14.f, 0.f)[SNew(STextBlock).Text(FText::FromString(TEXT("OPEN FINDINGS"))).Font(SBold).ColorAndOpacity(FSlateColor(Muted))]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(FString::FromInt(F.Open))).Font(MBold).ColorAndOpacity(FSlateColor(BpSheet::Amber))]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.f, 0.f)[Arrow(CapM, BpSheet::Ink.CopyWithNewOpacity(0.8f))]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(FString::FromInt(F.Open - 1))).Font(MBold).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
					Y += 38.f;
				}
				// The plan's latest note at CapS (a note is the smallest size): whole when it fits, else its first sentence. Wave W3:
				// the board reads at most 60 words, and the note, the last thing on it, has what is left after its heading's three;
				// a note that cannot keep a whole sentence in that is left for the desk's sheet, never cut short.
				const FBpFeatureNotesItem* Note = nullptr;
				if (F.Feature) for (const FBpFeatureNotesItem& Each : F.Feature->notes) if (!Note || Each.date > Note->date) Note = &Each;
				bool bWhole = false;
				FString NoteFit;
				const float NoteY0 = Y + 40.f, NoteY1 = Stage.Max.Y - 10.f;
				if (Note && !Note->text.IsEmpty())
				{
					// Lines that fit: the first line's ink and a pitch for each further one.
					const int32 MaxLines = FMath::Max(1, 1 + FMath::FloorToInt((NoteY1 - NoteY0 - CapS * 1.29f) / (Pitch(CapS) * 0.88f)));
					const int32 Budget = FMath::Max(0, 60 - WordCount - 3);
					const FString Whole = FString::Printf(TEXT("\"%s\""), *Note->text);
					NoteFit = Wrap(TEXT("plan's note"), Whole, SReg, SX1 - SX0, MaxLines, &bWhole);
					bWhole = bWhole && WordsIn(Whole) <= Budget;
					if (!bWhole)
					{
						bool bFirst = false;
						const FString First = FirstSentence(Note->text);
						NoteFit = WordsIn(First) <= Budget ? Wrap(TEXT("plan's note"), FString::Printf(TEXT("\"%s\""), *First), SReg, SX1 - SX0, MaxLines, &bFirst) : FString();
						if (!bFirst) NoteFit.Reset();
						Short.Add(NoteFit.IsEmpty() ? FString::Printf(TEXT("plan's note left off (%d words; %d left on the board)"), WordsIn(Whole), Budget)
							: FString::Printf(TEXT("plan's note (%d words; %d left on the board) -> its first sentence"), WordsIn(Whole), Budget));
					}
				}
				if (!NoteFit.IsEmpty())
				{
					Put(FBox2f(FVector2f(SX0, Y), FVector2f(SX1, Y + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.25f)));
					Words(TEXT("note's heading"), FBox2f(FVector2f(SX0, Y + 8.f), FVector2f(SX1, Y + 36.f)), TEXT("THE PLAN'S NOTE"), CapS, true, Muted);
					Words(TEXT("plan's note"), FBox2f(FVector2f(SX0, NoteY0), FVector2f(SX1, NoteY1)), NoteFit, CapS, false, BpSheet::InkHi, VAlign_Top, 0.88f);
				}
				if (!P && !In.Fallback.IsEmpty()) Words(TEXT("fallback"), FBox2f(FVector2f(SX0, Stage.Min.Y + 70.f), FVector2f(SX1, Stage.Max.Y - 20.f)), Wrap(TEXT("fallback"), In.Fallback, SReg, SX1 - SX0, 4), CapS, false, BpSheet::InkHi, VAlign_Top);
				Said.Add(FString::Printf(TEXT("stage state: %s lit%s, open findings %d -> %d%s, track words at %.0f"), Here == INDEX_NONE ? TEXT("no stage") : *BpWords::Humanise(Stages[Here]), Here != INDEX_NONE && Here + 1 < Stages.Num() ? *FString::Printf(TEXT(", next %s"), *BpWords::Humanise(Stages[Here + 1])) : TEXT(""),
					F.Open, FMath::Max(0, F.Open - 1), NoteFit.IsEmpty() ? (Note ? TEXT(", the plan's note left off") : TEXT("")) : bWhole ? TEXT(", the plan's note whole") : TEXT(", the plan's note's first sentence"), TrackCap));
			}
		}
		// Glim's beam: the stage's subject, else the lit feature on the map.
		if (Out.Aim.X < 0.f && Out.TouchAim.X >= 0.f) Out.Aim = Out.TouchAim;
		Said.Add(FString::Printf(TEXT("%d words on the board, smallest cap %.0f px%s%s"), WordCount, MinCap < 999.f ? MinCap : 0.f,
			Over.Num() > 0 ? *FString::Printf(TEXT(", %d overflow"), Over.Num()) : TEXT(""), Short.Num() > 0 ? *FString::Printf(TEXT(", %d shortened"), Short.Num()) : TEXT("")));
		Out.Said = FString::Join(Said, TEXT("; "));
		Out.Words = WordCount;
		Out.MinCap = MinCap < 999.f ? MinCap : 0.f;
		Out.Overflow = MoveTemp(Over);
		Out.Shortened = MoveTemp(Short);
	}

	/** Wave W3: BpBoard.Audit lays out every decision of the scan on both boards (the stand-up's, with GLIM ASKS; a room's, without),
	 *  with no widgets kept and no screens read, and logs what each showed. */
	void Audit()
	{
		const FBpScanState& State = FBpLinkModule::Get().GetScanState();
		const auto Cvar = [](const TCHAR* Name, float Default) { const IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name); return V ? V->GetFloat() : Default; };
		const float WidthCm = Cvar(TEXT("bp.Projector.WidthCm"), 260.f), DistanceCm = Cvar(TEXT("bp.Projector.DistanceCm"), 260.f);
		const float Deg = 2.f * FMath::RadiansToDegrees(FMath::Atan2(WidthCm * 0.5f, FMath::Max(1.f, DistanceCm)));
		// The board's layout is the wall's 1280 px.
		const float PxPerDeg = (X1 + X0) / FMath::Max(1.f, Deg);
		const auto Arcmin = [PxPerDeg](float Cap) { return Cap / PxPerDeg * 60.f; };
		TArray<int32> Counts;
		int32 Boards = 0, Overflowing = 0, UnderFloor = 0;
		TArray<FString> ShortenedIds;
		int32 Most = -1;
		FString Wordiest;
		for (const FBpProposal& P : State.Scan.proposals)
		{
			for (int32 Which = 0; Which < 2; ++Which)
			{
				FIn In;
				In.Proposal = P.id;
				In.Title = P.title;
				if (Which == 0) In.Chip = TEXT("GLIM ASKS");
				In.bReading = true;
				FOut Out;
				Draw(In, [](const FBox2f&, const TSharedRef<SWidget>&) {}, [](const FBox2f&, const FString&, bool, int32) {}, Out);
				++Boards;
				Counts.Add(Out.Words);
				if (Out.Overflow.Num() > 0) ++Overflowing;
				if (Out.MinCap < CapFloor - 0.01f) ++UnderFloor;
				if (Out.Shortened.Num() > 0) ShortenedIds.AddUnique(P.id);
				if (Out.Words > Most) { Most = Out.Words; Wordiest = FString::Printf(TEXT("%s (%s)"), *P.id, Which == 0 ? TEXT("stand-up") : TEXT("room")); }
				UE_LOG(LogBpTable, Log, TEXT("BpBoard.Audit: %s %s, stage %s: %d words, smallest cap %.0f px (%.0f arcmin, x-height %.0f), overflow %d%s, shortened %d%s"),
					*P.id, Which == 0 ? TEXT("stand-up") : TEXT("room"), CaseWord(Out.Case), Out.Words, Out.MinCap, Arcmin(Out.MinCap), Arcmin(Out.MinCap) * 0.72f,
					Out.Overflow.Num(), Out.Overflow.Num() > 0 ? *FString::Printf(TEXT(" [%s]"), *FString::Join(Out.Overflow, TEXT("; "))) : TEXT(""),
					Out.Shortened.Num(), Out.Shortened.Num() > 0 ? *FString::Printf(TEXT(" [%s]"), *FString::Join(Out.Shortened, TEXT("; "))) : TEXT(""));
				UE_LOG(LogBpTable, Log, TEXT("BpBoard.Audit:   %s"), *Out.Said);
			}
		}
		Counts.Sort();
		const int32 N = Counts.Num();
		UE_LOG(LogBpTable, Log, TEXT("BpBoard.Audit: %d boards (%d decisions x the stand-up's and a room's) on a %.1f degree wall (%.1f layout px a degree): words min %d, median %d, max %d (%s); over 60 words %d; overflowing %d; under the floor (%.0f px, %.0f arcmin cap) %d; shortened somewhere: %d decisions [%s]"),
			Boards, State.Scan.proposals.Num(), Deg, PxPerDeg, N ? Counts[0] : 0, N ? Counts[N / 2] : 0, N ? Counts.Last() : 0, *Wordiest,
			Counts.FilterByPredicate([](int32 C) { return C > 60; }).Num(), Overflowing, CapS, Arcmin(CapS), UnderFloor, ShortenedIds.Num(), *FString::Join(ShortenedIds, TEXT(", ")));
	}

	FAutoConsoleCommand GBoardAudit(TEXT("BpBoard.Audit"), TEXT("Wave W3: lays out every sample decision on the stand-up's and a room's board (no widgets kept) and logs per decision its words, its smallest text and any block that overflowed or was shortened, then the distribution."),
		FConsoleCommandDelegate::CreateStatic(&Audit));
}
