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
	/** The floor: the old wall's smallest text (24 layout px of cap), and the board's other sizes. */
	constexpr float CapFloor = 24.f, CapLine = 28.f, CapTitle = 32.f, CapFigure = 32.f;

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

	/** A node of the touches map: a pill with a name, in one of three looks. */
	enum class ENode : uint8 { Feature, Room, Other };
	TSharedRef<SWidget> Node(const FString& Name, ENode Look, const FSlateFontInfo& NodeFont)
	{
		const FLinearColor Fill = Look == ENode::Feature ? BpSheet::Amber : BpSheet::PaperLo;
		const FLinearColor Edge = Look == ENode::Feature ? BpSheet::Amber : Look == ENode::Room ? BpSheet::Accent : BpSheet::Ink.CopyWithNewOpacity(0.55f);
		const FLinearColor Ink = Look == ENode::Feature ? BpSheet::PaperLo : Look == ENode::Room ? BpSheet::Accent : BpSheet::Ink;
		return SNew(SOverlay)
			+ SOverlay::Slot()[SNew(SBorder).BorderImage(Rounded(16.f)).BorderBackgroundColor(Edge).Padding(2.f)[SNew(SBorder).BorderImage(Rounded(14.f)).BorderBackgroundColor(Fill).Padding(0.f)]]
			+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(FMargin(14.f, 0.f))[SNew(STextBlock).Text(FText::FromString(Name)).Font(NodeFont).ColorAndOpacity(FSlateColor(Ink))];
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
		const FSlateFontInfo SmallBold = Font(TEXT("Bold"), CapFloor), Small = Font(TEXT("Regular"), CapFloor), LineFont = Font(TEXT("Regular"), CapLine);
		const FSlateFontInfo FigureFont = Font(TEXT("Bold"), CapFigure);
		const auto Words = [&Put](const FBox2f& Box, const FString& Text, const FSlateFontInfo& WordFont, const FLinearColor& Ink, EVerticalAlignment V = VAlign_Center, float LineH = 1.f)
		{
			Put(Box, SNew(SBox).VAlign(V)[SNew(STextBlock).Text(FText::FromString(Text)).Font(WordFont).LineHeightPercentage(LineH).ColorAndOpacity(FSlateColor(Ink))]);
		};
		const auto Tile = [&Put](const FBox2f& Box) { Put(Box, SNew(BpSheet::SPlate).Fill(TileFill).Edge(TileEdge).EdgePx(2.f)); };
		const FFacts F = Gather(In.Proposal);
		const FBpProposal* P = F.P;
		TArray<FString> Said;

		// ---- The title row: the chip, the title on one line (32, else 28, else cut at a word) --------------------------------
		{
			float X = X0;
			if (!In.Chip.IsEmpty())
			{
				const float W = BpSheet::ChipWidth(In.Chip, Font(TEXT("Bold"), CapLine));
				Put(FBox2f(FVector2f(X, TitleY0 + 2.f), FVector2f(X + W, TitleY1 - 2.f)), BpSheet::Chip(In.Chip, Font(TEXT("Bold"), CapLine), TitleY1 - TitleY0 - 4.f, BpSheet::Amber, true));
				X += W + 20.f;
			}
			const float Avail = X1 - X;
			const FSlateFontInfo Big = Font(TEXT("Bold"), CapTitle), Mid = Font(TEXT("Bold"), CapLine);
			const bool bBig = BpSheet::TextWidth(In.Title, Big) <= Avail;
			const FSlateFontInfo& TitleFont = bBig ? Big : Mid;
			Words(FBox2f(FVector2f(X, TitleY0), FVector2f(X1, TitleY1)), bBig ? In.Title : BpSheet::CutWords(In.Title, Mid, Avail), TitleFont, BpSheet::InkHi);
		}

		// ---- The left column: the hero, Glim's line, what it touches ----------------------------------------------------------
		const FBox2f Hero(FVector2f(X0, Y0), FVector2f(ColX1, Y0 + 150.f));
		const FBox2f GlimBox(FVector2f(X0, Hero.Max.Y + 10.f), FVector2f(ColX1, Hero.Max.Y + 100.f));
		const FBox2f Touch(FVector2f(X0, GlimBox.Max.Y + 10.f), FVector2f(ColX1, Y1));
		Tile(Hero);
		Tile(GlimBox);
		Tile(Touch);
		// Glim's line: the lens's reading, else the summary's sentence (when it says more than the title), else the impact.
		FString Glim = F.Reading;
		const auto SaysMore = [&In](const FString& S) { FString A = S, B = In.Title; A.RemoveFromEnd(TEXT(".")); B.RemoveFromEnd(TEXT(".")); return !S.IsEmpty() && !A.Equals(B, ESearchCase::IgnoreCase); };
		// The hero: the metric's today -> after; else the reading's first figure; else the risk.
		FString Today, After, Label, Muted;
		if (P && F.bMetric)
		{
			Today = Fmt(F.Today);
			After = Fmt(F.After);
			Label = (F.Unit.IsEmpty() ? F.Label : F.Label + TEXT(" · ") + F.Unit).ToUpper();
			TArray<FString> Bounds;
			if (F.bBudget) Bounds.Add(FString::Printf(TEXT("Budget %s %s"), *Fmt(F.Budget), *F.Unit).TrimEnd());
			if (F.bTarget) Bounds.Add(FString::Printf(TEXT("target %s %s"), *Fmt(F.Target), *F.Unit).TrimEnd());
			Muted = FString::Join(Bounds, TEXT(" · "));
			if (!Muted.IsEmpty()) Muted = Muted.Left(1).ToUpper() + Muted.Mid(1);
		}
		else if (P && FirstFigure(F.Reading, Today, Label))
		{
			Label = Label.ToUpper();
			// The figure is the reading: Glim says what the finding proposes instead.
			Glim = SaysMore(F.Summary) ? F.Summary : F.Impact;
			Muted = FString();
		}
		else if (P)
		{
			// The risk (the stage says what approving moves).
			Today = Fmt(P->risk);
			Label = FString::Printf(TEXT("RISK · %s LENS"), *BpWords::Lens(P->lens).ToUpper());
		}
		if (Glim.IsEmpty() && P) Glim = SaysMore(F.Summary) ? F.Summary : F.Impact;
		if (!P) Glim = In.Fallback;
		if (Muted == Glim) Muted.Reset();
		{
			const float In0 = Hero.Min.X + 22.f, In1 = Hero.Max.X - 22.f;
			if (!Today.IsEmpty())
			{
				// The largest cap the figures fit at (72, or 60 over a muted line, down to 40).
				float Cap = Muted.IsEmpty() ? 72.f : 60.f;
				const auto Width = [&](float C)
				{
					const FSlateFontInfo NumFont = Font(TEXT("Bold"), C);
					return BpSheet::TextWidth(Today, NumFont) + (After.IsEmpty() ? 0.f : BpSheet::TextWidth(After, NumFont) + C * 1.6f);
				};
				while (Cap > 40.f && Width(Cap) > In1 - In0) Cap -= 8.f;
				const FSlateFontInfo NumFont = Font(TEXT("Bold"), Cap);
				TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(Today)).Font(NumFont).ColorAndOpacity(FSlateColor(BpSheet::Amber))];
				if (!After.IsEmpty())
				{
					Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(Cap * 0.25f, 0.f)[Arrow(Cap * 0.8f, BpSheet::Ink.CopyWithNewOpacity(0.8f))];
					Row->AddSlot().AutoWidth().VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(After)).Font(NumFont).ColorAndOpacity(FSlateColor(BpSheet::Accent))];
				}
				// The figures, then the label and the muted line under them (the label rises when there is no muted line).
				const float NumY0 = Hero.Min.Y + (Muted.IsEmpty() ? 4.f : 0.f), NumY1 = Hero.Min.Y + (Muted.IsEmpty() ? 100.f : 78.f);
				Put(FBox2f(FVector2f(In0, NumY0), FVector2f(In1, NumY1)), SNew(SBox).VAlign(VAlign_Center)[Row]);
			}
			const float LabelY = Hero.Min.Y + (Muted.IsEmpty() ? 102.f : 84.f);
			Words(FBox2f(FVector2f(In0, LabelY), FVector2f(In1, LabelY + 38.f)), BpSheet::CutWords(Label, SmallBold, In1 - In0), SmallBold, BpSheet::InkHi);
			if (!Muted.IsEmpty()) Words(FBox2f(FVector2f(In0, LabelY + 32.f), FVector2f(In1, LabelY + 64.f)), BpSheet::CutWords(Muted, Small, In1 - In0), Small, BpSheet::Ink.CopyWithNewOpacity(0.7f));
			Said.Add(FString::Printf(TEXT("hero \"%s%s%s\" \"%s\"%s"), *Today, After.IsEmpty() ? TEXT("") : TEXT(" -> "), *After, *Label, Muted.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" \"%s\""), *Muted)));
		}
		{
			// Glim's line beside the lit lamp: two lines at 28, else at 24, cut at a word.
			const float DiscD = 56.f;
			const FVector2f C(GlimBox.Min.X + 22.f + DiscD * 0.5f, GlimBox.GetCenter().Y);
			Put(FBox2f(C - FVector2f(DiscD * 0.5f + 7.f), C + FVector2f(DiscD * 0.5f + 7.f)), SNew(BpSheet::SRing).Color(BpSheet::Amber.CopyWithNewOpacity(0.45f)).Thick(5.f));
			Put(FBox2f(C - FVector2f(DiscD * 0.5f), C + FVector2f(DiscD * 0.5f)), Disc(LampWhite, DiscD));
			const float TX0 = C.X + DiscD * 0.5f + 22.f, TX1 = GlimBox.Max.X - 18.f;
			const bool bBig = BpSheet::Lines(BpSheet::Wrap(Glim, LineFont, TX1 - TX0, 0)) <= 2;
			const FSlateFontInfo& GF = bBig ? LineFont : Small;
			Words(FBox2f(FVector2f(TX0, GlimBox.Min.Y + 4.f), FVector2f(TX1, GlimBox.Max.Y - 4.f)), BpSheet::Wrap(Glim, GF, TX1 - TX0, 2), GF, BpSheet::InkHi, VAlign_Center, 0.85f);
			Said.Add(FString::Printf(TEXT("Glim \"%s\""), *Glim));
		}
		{
			// What it touches: the room and the feature lit on the first row, what it depends on under it, linked.
			const FSlateFontInfo NodeFont = SmallBold;
			const float NodeH = 36.f, Pad = 18.f;
			// Three rows: the feature (and its room when it fits beside it whole), then the room and the features it depends on,
			// flowing over the second and third rows, each whole; "+N" says the ones left.
			const float RowA = Touch.Min.Y + 7.f, RowB = Touch.Min.Y + 51.f, RowC = Touch.Min.Y + 95.f;
			const auto PillW = [&](const FString& Name, float MaxW) { return FMath::Min(MaxW, BpSheet::TextWidth(Name, NodeFont) + 32.f); };
			const float Avail = Touch.GetSize().X - 2.f * Pad;
			const FString Room = F.RoomName.ToUpper();
			const float FeatW = PillW(F.FeatureName, Avail);
			const FBox2f FeatBox(FVector2f(Touch.Min.X + Pad, RowA), FVector2f(Touch.Min.X + Pad + FeatW, RowA + NodeH));
			const float RoomNatural = Room.IsEmpty() ? 0.f : BpSheet::TextWidth(Room, NodeFont) + 32.f;
			const bool bRoomA = RoomNatural > 0.f && FeatBox.Max.X + 28.f + RoomNatural <= Touch.Max.X - Pad;
			TArray<TArray<FVector2f>> Links;
			TArray<TTuple<FBox2f, FString, ENode>> Nodes;
			if (bRoomA)
			{
				const FBox2f RoomBox(FVector2f(FeatBox.Max.X + 28.f, RowA), FVector2f(FeatBox.Max.X + 28.f + RoomNatural, RowA + NodeH));
				Nodes.Add(MakeTuple(RoomBox, Room, ENode::Room));
				Links.Add({ FVector2f(FeatBox.Max.X, FeatBox.GetCenter().Y), FVector2f(RoomBox.Min.X, RoomBox.GetCenter().Y) });
			}
			TArray<TPair<FString, ENode>> Flow;
			if (!bRoomA && RoomNatural > 0.f) Flow.Add({ Room, ENode::Room });
			for (const FString& Each : F.Neighbours) Flow.Add({ Each, ENode::Other });
			float X = Touch.Min.X + Pad, Row = RowB;
			for (int32 Index = 0; Index < Flow.Num(); ++Index)
			{
				const float W = FMath::Min(BpSheet::TextWidth(Flow[Index].Key, NodeFont) + 32.f, Avail);
				const int32 Left = Flow.Num() - Index - 1;
				const float MoreW = Left > 0 && Row == RowC ? BpSheet::TextWidth(FString::Printf(TEXT("+%d"), Left), NodeFont) + 32.f + 12.f : 0.f;
				if (X + W + MoreW > Touch.Max.X - Pad)
				{
					if (Row == RowB) { Row = RowC; X = Touch.Min.X + Pad; --Index; continue; }
					const FString More = FString::Printf(TEXT("+%d"), Flow.Num() - Index);
					Nodes.Add(MakeTuple(FBox2f(FVector2f(X, Row), FVector2f(X + PillW(More, 100.f), Row + NodeH)), More, ENode::Other));
					break;
				}
				Nodes.Add(MakeTuple(FBox2f(FVector2f(X, Row), FVector2f(X + W, Row + NodeH)), Flow[Index].Key, Flow[Index].Value));
				X += W + 12.f;
			}
			for (const auto& Each : Nodes) if (Each.Get<0>().Min.Y >= RowB) Links.Add({ FVector2f(FMath::Clamp(Each.Get<0>().GetCenter().X, FeatBox.Min.X + 24.f, FeatBox.Max.X - 24.f), FeatBox.Max.Y), FVector2f(Each.Get<0>().GetCenter().X, Each.Get<0>().Min.Y) });
			Put(Touch, SNew(SLines).Color(BpSheet::Ink.CopyWithNewOpacity(0.45f)).Thick(2.f).Lines([&]() { TArray<TArray<FVector2f>> Local; for (const TArray<FVector2f>& L : Links) { TArray<FVector2f>& Into = Local.AddDefaulted_GetRef(); for (const FVector2f& Pt : L) Into.Add(Pt - Touch.Min); } return Local; }()));
			if (!F.FeatureName.IsEmpty()) Put(FeatBox, Node(BpSheet::Cut(F.FeatureName, NodeFont, FeatW - 28.f), ENode::Feature, NodeFont));
			for (const auto& Each : Nodes) Put(Each.Get<0>(), Node(BpSheet::Cut(Each.Get<1>(), NodeFont, Each.Get<0>().GetSize().X - 28.f), Each.Get<2>(), NodeFont));
			Said.Add(FString::Printf(TEXT("touches %s in %s, depends on [%s]"), *F.FeatureName, F.RoomName.IsEmpty() ? TEXT("-") : *F.RoomName, *FString::Join(F.Neighbours, TEXT(", "))));
		}

		// ---- The stage --------------------------------------------------------------------------------------------------------
		const FBox2f Stage(FVector2f(StageX0, Y0), FVector2f(X1, Y1));
		Out.Stage = Stage;
		Out.Case = P ? CaseOf(In.Proposal) : ECase::State;
		const FString LensRisk = P ? FString::Printf(TEXT("%s · RISK %s"), *BpWords::Lens(P->lens).ToUpper(), *Fmt(P->risk)) : FString();
		const float LensRiskW = LensRisk.IsEmpty() ? 0.f : BpSheet::ChipWidth(LensRisk, SmallBold);
		const auto TextureOf = [](const TSharedPtr<FSlateBrush>& Brush) { return Brush.IsValid() ? Cast<UTexture2D>(Brush->GetResourceObject()) : nullptr; };
		const auto Reading = [&](const FBox2f& Box, const TCHAR* What)
		{
			Put(Box, SNew(BpSheet::SPlate).Fill(BpSheet::PaperLo.CopyWithNewOpacity(0.4f)).Edge(BpSheet::Ink.CopyWithNewOpacity(0.35f)).EdgePx(2.f));
			Put(Box, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(What)).Font(SmallBold).ColorAndOpacity(FSlateColor(BpSheet::Ink.CopyWithNewOpacity(0.55f)))]);
		};
		const auto CornerChip = [&](const FBox2f& Img, bool bTop)
		{
			if (LensRisk.IsEmpty()) return;
			const float Y = bTop ? Img.Min.Y + 12.f : Img.Max.Y - 52.f;
			Put(FBox2f(FVector2f(Img.Max.X - 12.f - LensRiskW, Y), FVector2f(Img.Max.X - 12.f, Y + 40.f)), BpSheet::Chip(LensRisk, SmallBold, 40.f, BpSheet::Accent, true));
		};
		const auto Caption = [&](const FBox2f& Img, const FString& Word, const FLinearColor& Ink, bool bLeft)
		{
			const float W = BpSheet::ChipWidth(Word, SmallBold);
			const float CX = bLeft ? Img.Min.X + 12.f : Img.Max.X - 12.f - W;
			Put(FBox2f(FVector2f(CX, Img.Max.Y - 52.f), FVector2f(CX + W, Img.Max.Y - 12.f)), BpSheet::Chip(Word, SmallBold, 40.f, Ink, true));
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
			for (int32 S = 0; S < 3; ++S) StopControl(StopBox(S), StopWords[S], In.Stop == S, S);
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
			// The stage's heading row: what it shows at the left, the lens and the risk at the right.
			const auto Heading = [&](const FString& Text)
			{
				Words(FBox2f(FVector2f(SX0, Stage.Min.Y + 12.f), FVector2f(SX1 - LensRiskW - 16.f, Stage.Min.Y + 52.f)), BpSheet::CutWords(Text, SmallBold, SX1 - SX0 - LensRiskW - 16.f), SmallBold, BpSheet::Ink.CopyWithNewOpacity(0.75f));
				if (!LensRisk.IsEmpty()) Put(FBox2f(FVector2f(SX1 - LensRiskW, Stage.Min.Y + 12.f), FVector2f(SX1, Stage.Min.Y + 52.f)), BpSheet::Chip(LensRisk, SmallBold, 40.f, BpSheet::Accent, false));
			};
			// The feature's stages as the data has them (deprecated only when it is the feature's), the current one lit.
			TArray<const TCHAR*> Stages;
			for (const TCHAR* Each : BpVocab::Feature::Stage::AllValues) if (FCString::Strcmp(Each, BpVocab::Feature::Stage::Deprecated) != 0 || (F.Feature && F.Feature->stage == Each)) Stages.Add(Each);
			const int32 Here = F.Feature ? Stages.IndexOfByPredicate([&F](const TCHAR* S) { return F.Feature->stage == S; }) : INDEX_NONE;
			if (Out.Case == ECase::Metric)
			{
				Heading(FString());
				// One axis: TODAY and AFTER APPROVE, the budget and the target as dashed lines across both.
				const float BX0 = SX0, BX1 = SX1 - 110.f;
				double Max = FMath::Max(F.Today, F.After);
				if (F.bBudget) Max = FMath::Max(Max, F.Budget);
				if (F.bTarget) Max = FMath::Max(Max, F.Target);
				Max = FMath::Max(Max * 1.08, 1e-6);
				const auto XOf = [&](double V) { return BX0 + static_cast<float>(FMath::Clamp(V / Max, 0.0, 1.0)) * (BX1 - BX0); };
				const float T0 = Stage.Min.Y + 100.f, BarH = 50.f, A0 = T0 + BarH + 48.f, LabY = A0 + BarH + 8.f;
				Words(FBox2f(FVector2f(BX0, T0 - 38.f), FVector2f(BX0 + 300.f, T0 - 2.f)), TEXT("TODAY"), SmallBold, BpSheet::Amber);
				Words(FBox2f(FVector2f(BX0, A0 - 38.f), FVector2f(BX0 + 300.f, A0 - 2.f)), TEXT("AFTER APPROVE"), SmallBold, BpSheet::Accent);
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
					const FBox2f Over(FVector2f(SolidX, T0), FVector2f(TodayX, T0 + BarH));
					Put(Over, SNew(BpSheet::SPlate).Fill(BpSheet::Amber.CopyWithNewOpacity(0.35f)).Edge(BpSheet::Amber).EdgePx(2.f));
					Put(Over, SNew(SLines).Color(BpSheet::Amber).Thick(4.f).Lines(Hatch));
				}
				Put(FBox2f(FVector2f(BX0, A0), FVector2f(FMath::Max(BX0 + 2.f, AfterX), A0 + BarH)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
				Words(FBox2f(FVector2f(TodayX + 12.f, T0), FVector2f(SX1 + 20.f, T0 + BarH)), Today, FigureFont, BpSheet::Amber);
				Words(FBox2f(FVector2f(AfterX + 12.f, A0), FVector2f(SX1 + 20.f, A0 + BarH)), After, FigureFont, BpSheet::Accent);
				// The dashed lines and their words under the bars (the words never cross: the second moves right of the first).
				float LastLabelX1 = -1.f;
				const auto Rule = [&](double V, const FString& Word, const FLinearColor& Ink)
				{
					const float X = XOf(V);
					TArray<TArray<FVector2f>> Dashes;
					for (float Y = 0.f; Y < (A0 + BarH + 6.f) - (T0 - 8.f); Y += 18.f) Dashes.Add({ FVector2f(2.f, Y), FVector2f(2.f, FMath::Min(Y + 10.f, (A0 + BarH + 6.f) - (T0 - 8.f))) });
					Put(FBox2f(FVector2f(X - 2.f, T0 - 8.f), FVector2f(X + 2.f, A0 + BarH + 6.f)), SNew(SLines).Color(Ink).Thick(4.f).Lines(Dashes));
					const float W = BpSheet::TextWidth(Word, SmallBold);
					float LX = FMath::Clamp(X - W * 0.5f, SX0, SX1 - W);
					if (LastLabelX1 >= 0.f && LX < LastLabelX1 + 16.f) LX = LastLabelX1 + 16.f;
					Words(FBox2f(FVector2f(LX, LabY), FVector2f(LX + W + 4.f, LabY + 36.f)), Word, SmallBold, Ink);
					LastLabelX1 = LX + W;
				};
				TArray<TTuple<double, FString, FLinearColor>> Rules;
				if (F.bTarget) Rules.Add(MakeTuple(F.Target, FString::Printf(TEXT("TARGET %s"), *Fmt(F.Target)), TargetGreen));
				if (F.bBudget) Rules.Add(MakeTuple(F.Budget, FString::Printf(TEXT("BUDGET %s"), *Fmt(F.Budget)), BpSheet::InkHi));
				Rules.Sort([](const TTuple<double, FString, FLinearColor>& A, const TTuple<double, FString, FLinearColor>& B) { return A.Get<0>() < B.Get<0>(); });
				for (const auto& R : Rules) Rule(R.Get<0>(), R.Get<1>(), R.Get<2>());
				Out.Aim = FVector2f(TodayX, T0 + BarH * 0.5f);
				// The foot: where it stands (its stage and its parts done) and how it is measured.
				const float FootY = LabY + 44.f;
				Put(FBox2f(FVector2f(SX0, FootY), FVector2f(SX1, FootY + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.25f)));
				const float MidX = (SX0 + SX1) * 0.5f;
				if (F.Feature && !F.Feature->stage.IsEmpty())
				{
					int32 Done = 0;
					for (const FBpFeaturePartsItem& Part : F.Feature->parts) Done += Part.done ? 1 : 0;
					const FString Where = F.Feature->parts.Num() > 0 ? FString::Printf(TEXT("%s · %d OF %d PARTS"), *BpWords::Humanise(F.Feature->stage).ToUpper(), Done, F.Feature->parts.Num()) : BpWords::Humanise(F.Feature->stage).ToUpper();
					Words(FBox2f(FVector2f(SX0, FootY + 10.f), FVector2f(MidX - 12.f, FootY + 46.f)), TEXT("WHERE IT STANDS"), SmallBold, BpSheet::Ink.CopyWithNewOpacity(0.6f));
					Words(FBox2f(FVector2f(SX0, FootY + 46.f), FVector2f(MidX - 12.f, FootY + 84.f)), BpSheet::CutWords(Where, SmallBold, MidX - 12.f - SX0), SmallBold, BpSheet::InkHi);
				}
				if (!F.Method.IsEmpty())
				{
					Words(FBox2f(FVector2f(MidX + 12.f, FootY + 10.f), FVector2f(SX1, FootY + 46.f)), TEXT("HOW WE KNOW"), SmallBold, BpSheet::Ink.CopyWithNewOpacity(0.6f));
					Words(FBox2f(FVector2f(MidX + 12.f, FootY + 46.f), FVector2f(SX1, FootY + 84.f)), FString::Printf(TEXT("%s, again after it"), *BpWords::Humanise(F.Method)), Small, BpSheet::InkHi);
				}
				Said.Add(FString::Printf(TEXT("stage metric %s: today %s, after %s%s%s, method %s"), *Label, *Today, *After, F.bBudget ? *FString::Printf(TEXT(", budget %s%s"), *Fmt(F.Budget), F.Today > F.Budget ? TEXT(" (over, hatched)") : TEXT("")) : TEXT(""),
					F.bTarget ? *FString::Printf(TEXT(", target %s"), *Fmt(F.Target)) : TEXT(""), F.Method.IsEmpty() ? TEXT("-") : *F.Method));
			}
			else
			{
				Heading(TEXT("WHERE IT STANDS"));
				// The track: one dot per stage, the ones before the feature's filled, its own lit, the next marked (what an approval
				// moves it toward); the words alternate above and below so each is whole.
				const float TrackY = Stage.Min.Y + 128.f, Step = Stages.Num() > 1 ? (SX1 - SX0 - 80.f) / (Stages.Num() - 1) : 0.f;
				const float TX0 = SX0 + 40.f;
				Put(FBox2f(FVector2f(TX0, TrackY - 2.f), FVector2f(TX0 + Step * (Stages.Num() - 1), TrackY + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.35f)));
				if (Here > 0) Put(FBox2f(FVector2f(TX0, TrackY - 3.f), FVector2f(TX0 + Step * Here, TrackY + 3.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Accent));
				for (int32 Index = 0; Index < Stages.Num(); ++Index)
				{
					const FVector2f C(TX0 + Step * Index, TrackY);
					const bool bHere = Index == Here, bDone = Here != INDEX_NONE && Index < Here, bNext = Here != INDEX_NONE && Index == Here + 1;
					const float D = bHere ? 44.f : 28.f;
					if (bHere) Put(FBox2f(C - FVector2f(D * 0.5f + 8.f), C + FVector2f(D * 0.5f + 8.f)), SNew(BpSheet::SRing).Color(BpSheet::Amber.CopyWithNewOpacity(0.4f)).Thick(6.f));
					if (bHere || bDone) Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), Disc(bHere ? BpSheet::Amber : BpSheet::Accent, D));
					else
					{
						Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), Disc(BpSheet::PaperLo, D));
						Put(FBox2f(C - FVector2f(D * 0.5f), C + FVector2f(D * 0.5f)), SNew(BpSheet::SRing).Color(bNext ? BpSheet::Accent : BpSheet::Ink.CopyWithNewOpacity(0.45f)).Thick(bNext ? 4.f : 3.f));
					}
					const FString Word = BpWords::Humanise(Stages[Index]).ToUpper();
					const float W = BpSheet::TextWidth(Word, SmallBold);
					const float WX = FMath::Clamp(C.X - W * 0.5f, SX0, SX1 - W);
					const bool bAbove = Index % 2 == 1;
					const FLinearColor Ink = bHere ? BpSheet::Amber : bNext ? BpSheet::Accent : bDone ? BpSheet::Ink : BpSheet::Ink.CopyWithNewOpacity(0.55f);
					Words(FBox2f(FVector2f(WX, bAbove ? TrackY - 66.f : TrackY + 30.f), FVector2f(WX + W + 4.f, bAbove ? TrackY - 30.f : TrackY + 66.f)), Word, SmallBold, Ink);
					if (bHere) Out.Aim = C;
				}
				// What approving moves: the impact's sentence (the finding's own words).
				float Y = TrackY + 70.f;
				if (!F.Impact.IsEmpty())
				{
					const FString ImpactFit = BpSheet::Wrap(F.Impact, Small, SX1 - SX0, 2);
					const float ImpactH = BpSheet::Lines(ImpactFit) * Pitch(CapFloor) * 0.92f;
					Words(FBox2f(FVector2f(SX0, Y), FVector2f(SX1, Y + ImpactH + 4.f)), ImpactFit, Small, BpSheet::InkHi, VAlign_Top, 0.92f);
					Y += ImpactH + 10.f;
				}
				Put(FBox2f(FVector2f(SX0, Y), FVector2f(SX1, Y + 2.f)), SNew(BpSheet::SPlate).Fill(BpSheet::Ink.CopyWithNewOpacity(0.25f)));
				Y += 12.f;
				// The open findings on the feature, today and after this one (tiles), and the plan's latest note.
				const float MidX = SX0 + 250.f;
				if (P && F.Open > 0)
				{
					Words(FBox2f(FVector2f(SX0, Y), FVector2f(MidX - 12.f, Y + 36.f)), TEXT("OPEN FINDINGS"), SmallBold, BpSheet::Ink.CopyWithNewOpacity(0.6f));
					const float TY = Y + 40.f, TS = 52.f;
					const FBox2f A(FVector2f(SX0, TY), FVector2f(SX0 + TS, TY + TS)), B(FVector2f(SX0 + TS + 64.f, TY), FVector2f(SX0 + 2.f * TS + 64.f, TY + TS));
					Put(A, SNew(BpSheet::SPlate).Fill(BpSheet::Amber));
					Put(A, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(FString::FromInt(F.Open))).Font(FigureFont).ColorAndOpacity(FSlateColor(BpSheet::PaperLo))]);
					Put(FBox2f(FVector2f(A.Max.X, TY), FVector2f(B.Min.X, TY + TS)), SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[Arrow(30.f, BpSheet::Ink.CopyWithNewOpacity(0.8f))]);
					TArray<TArray<FVector2f>> Dash;
					for (float D = 0.f; D < TS * 4.f; D += 14.f)
					{
						// The dashed outline of "after", walked around the square.
						const auto At = [TS](float S) { S = FMath::Fmod(S, TS * 4.f); return S < TS ? FVector2f(S, 2.f) : S < 2.f * TS ? FVector2f(TS - 2.f, S - TS) : S < 3.f * TS ? FVector2f(3.f * TS - S, TS - 2.f) : FVector2f(2.f, 4.f * TS - S); };
						Dash.Add({ At(D), At(D + 8.f) });
					}
					Put(B, SNew(SLines).Color(BpSheet::Accent).Thick(3.f).Lines(Dash));
					Put(B, SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)[SNew(STextBlock).Text(FText::FromString(FString::FromInt(F.Open - 1))).Font(FigureFont).ColorAndOpacity(FSlateColor(BpSheet::Accent))]);
				}
				const FBpFeatureNotesItem* Note = nullptr;
				if (F.Feature) for (const FBpFeatureNotesItem& Each : F.Feature->notes) if (!Note || Each.date > Note->date) Note = &Each;
				if (Note && !Note->text.IsEmpty())
				{
					Words(FBox2f(FVector2f(MidX, Y), FVector2f(SX1, Y + 36.f)), TEXT("THE PLAN'S NOTE"), SmallBold, BpSheet::Ink.CopyWithNewOpacity(0.6f));
					const FString Fit = BpSheet::Wrap(FString::Printf(TEXT("\"%s\""), *Note->text), Small, SX1 - MidX, FMath::Max(1, FMath::FloorToInt((Stage.Max.Y - 10.f - (Y + 40.f)) / (Pitch(CapFloor) * 0.92f))));
					Words(FBox2f(FVector2f(MidX, Y + 40.f), FVector2f(SX1, Stage.Max.Y - 8.f)), Fit, Small, BpSheet::InkHi, VAlign_Top, 0.92f);
				}
				if (!P && !In.Fallback.IsEmpty()) Words(FBox2f(FVector2f(SX0, Stage.Min.Y + 70.f), FVector2f(SX1, Stage.Max.Y - 20.f)), BpSheet::Wrap(In.Fallback, Small, SX1 - SX0, 4), Small, BpSheet::InkHi, VAlign_Top);
				Said.Add(FString::Printf(TEXT("stage state: %s lit%s, open findings %d -> %d%s"), Here == INDEX_NONE ? TEXT("no stage") : *BpWords::Humanise(Stages[Here]), Here != INDEX_NONE && Here + 1 < Stages.Num() ? *FString::Printf(TEXT(", next %s"), *BpWords::Humanise(Stages[Here + 1])) : TEXT(""),
					F.Open, FMath::Max(0, F.Open - 1), Note ? TEXT(", the plan's note") : TEXT("")));
			}
		}
		Out.Said = FString::Join(Said, TEXT("; "));
	}
}
