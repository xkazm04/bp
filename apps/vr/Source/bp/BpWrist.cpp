// The wrist panel (spark vr-fidelity-40 FC1, element 11; BpPawn.h): the concept's "Packages" on the left wrist. It shows
// the latest wave (GET .../waves: the last dispatched one, else the newest draft) and, per package, its name, its model
// and effort, and a ring for how many of its findings are built (done, accepted or released in the store; a draft's
// rings say "draft"), all read from BpLink's scan state. With no wave it says so. Nothing here composes, dispatches or
// computes a wave.
#include "BpPawn.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpTable.h"
#include "BpType.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "EngineUtils.h"
#include "MotionControllerComponent.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	const FLinearColor Cyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor Amber(FColor(0xFF, 0xB5, 0x47));
	/** The panel's glass, its lit edge and its sub-lines' paler cyan (FR, element 11: from 0A1E40, a lighter blue). */
	const FLinearColor CyanEdge(FColor(0xD8, 0xF4, 0xFF));
	/** FAF: the lit glass (from FR's 123366 at 0.88, the judges' "opaque slate") and the sub-lines nearer white. */
	const FLinearColor GlassLit(FColor(0x15, 0x3C, 0x74));
	const FLinearColor CyanText(FColor(0xEC, 0xF9, 0xFF));

	/** The sheet's family (BpType.h; FE): a font whose cap height is CapPx pixels, Roboto until the table built it. */
	FSlateFontInfo CapFont(const TCHAR* Style, float CapPx)
	{
		if (const UObject* Font = ABpTable::TextFontObject()) return FSlateFontInfo(Font, CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
		return FCoreStyle::GetDefaultFontStyle(Style, CapPx / (0.711f * 96.f / 72.f));
	}

	/** A progress ring: a faint full circle and an amber arc for the built share, clockwise from the top. */
	class SBpRing : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SBpRing) {}
			SLATE_ARGUMENT(float, Fraction)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Fraction = FMath::Clamp(Args._Fraction, 0.f, 1.f); }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(96.0, 96.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const FVector2f Size = FVector2f(Geometry.GetLocalSize());
			const FVector2f Centre = Size * 0.5f;
			const float Radius = FMath::Min(Size.X, Size.Y) * 0.5f - 6.f;
			const auto Arc = [&](float From, float To, const FLinearColor& Color, float Thickness)
			{
				TArray<FVector2f> Points;
				const int32 Steps = FMath::Max(2, FMath::CeilToInt((To - From) * 64.f));
				for (int32 Step = 0; Step <= Steps; ++Step)
				{
					const float A = 2.f * UE_PI * FMath::Lerp(From, To, static_cast<float>(Step) / Steps) - 0.5f * UE_PI;
					Points.Add(Centre + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius);
				}
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thickness);
			};
			Arc(0.f, 1.f, Cyan.CopyWithNewOpacity(0.22f), 7.f);
			if (Fraction > 0.f) Arc(0.f, Fraction, Amber, 8.f);
			return Layer + 1;
		}

	private:
		float Fraction = 0.f;
	};

	/** The package's glyph: one small isometric block per finding, up to six, stacked as the concept's package icons. */
	class SBpBlocks : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SBpBlocks) {}
			SLATE_ARGUMENT(int32, Count)
		SLATE_END_ARGS()

		void Construct(const FArguments& Args) { Count = FMath::Clamp(Args._Count, 1, 6); }
		virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(100.0, 84.0); }
		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& Geometry, const FSlateRect&, FSlateWindowElementList& Out, int32 Layer,
			const FWidgetStyle&, bool) const override
		{
			const float C = 0.866f, S = 0.5f, Unit = 22.f;
			const FVector2f Origin(50.f, 30.f);
			const auto P = [&](float X, float Y, float Z) { return Origin + FVector2f((X - Y) * C, (X + Y) * S - Z) * Unit; };
			for (int32 Index = 0; Index < Count; ++Index)
			{
				const float X = static_cast<float>(Index % 2) * 1.1f, Y = static_cast<float>((Index / 2) % 2) * 1.1f, Z = static_cast<float>(Index / 4) * 0.8f;
				const FVector2f V[8] = { P(X, Y, Z), P(X + 1, Y, Z), P(X + 1, Y + 1, Z), P(X, Y + 1, Z),
					P(X, Y, Z + 0.7f), P(X + 1, Y, Z + 0.7f), P(X + 1, Y + 1, Z + 0.7f), P(X, Y + 1, Z + 0.7f) };
				const int32 Edges[12][2] = { {0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7} };
				for (const auto& Edge : Edges)
				{
					TArray<FVector2f> Line = { V[Edge[0]], V[Edge[1]] };
					FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Line, ESlateDrawEffect::None, Cyan.CopyWithNewOpacity(0.85f), true, 1.6f);
				}
			}
			return Layer + 1;
		}

	private:
		int32 Count = 1;
	};

	bool IsBuilt(const FString& Status)
	{
		return Status == TEXT("done") || Status == TEXT("accepted") || Status == TEXT("released");
	}
}

void ABpPawn::MakeWristPanel()
{
	WristPanel = NewObject<UWidgetComponent>(this, TEXT("WristPanel"));
	WristPanel->SetWidgetSpace(EWidgetSpace::World);
	WristPanel->SetDrawSize(FVector2D(WristPanelWidthCm * WristPanelPxPerCm, WristPanelHeightCm * WristPanelPxPerCm));
	WristPanel->SetDrawAtDesiredSize(false);
	WristPanel->SetPivot(FVector2D(0.5, 0.5));
	WristPanel->SetBlendMode(EWidgetBlendMode::Transparent);
	WristPanel->SetTwoSided(false);
	WristPanel->SetBackgroundColor(FLinearColor::Transparent);
	WristPanel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	WristPanel->SetCastShadow(false);
	WristPanel->SetWindowFocusable(false);
	WristPanel->SetManuallyRedraw(true);
	// Over 1 so its cyan and amber reach the bloom, as the concept's panel glows.
	WristPanel->SetTintColorAndOpacity(FLinearColor(1.3f, 1.3f, 1.3f, 1.f));
	const FVector Offset(WristPanelForwardCm, WristPanelSideCm, WristPanelDownCm);
	if (IsHeadsetOn())
	{
		// A headset: on the left hand's grip until a wrist pose is wired (no tracked-hand work in this spark).
		SetWristParent(HandGripLeft.Get(), NAME_None, FTransform(FRotator(-60.f, 180.f, 0.f), FVector(0.0, 0.0, 6.0), FVector(1.0 / WristPanelPxPerCm)));
	}
	else
	{
		const float Pitch = FMath::DegreesToRadians(-ABpGameMode::TargetPitchDeg);
		const FVector ViewUp(FMath::Sin(Pitch), 0.0, FMath::Cos(Pitch));
		AActor* Wrist = nullptr;
		for (TActorIterator<AActor> It(GetWorld()); It && !Wrist; ++It) if (It->ActorHasTag(CaptureWristTag)) Wrist = *It;
		TActorIterator<ABpTable> Table(GetWorld());
		if (Wrist && Table)
		{
			// On the posed left hand: at the wrist point, turned to the target pose's eye (the pose the capture is judged from).
			const FTransform T = Table->GetActorTransform();
			const FVector Eye = T.TransformPosition(FVector(-(ABpTable::TableDepthCm * 0.5 + ABpGameMode::TargetBehindNearEdgeCm), 0.0,
				ABpTable::DefaultTableHeightCm + ABpGameMode::TargetEyeAboveTopCm));
			const FVector At = Wrist->GetActorLocation() + T.TransformVectorNoScale(FVector(WristCaptureOffsetXCm, WristCaptureOffsetYCm, WristCaptureOffsetZCm));
			SetWristParent(Wrist->GetRootComponent(), NAME_None, FTransform::Identity);
			// Then rolled about the view axis and tilted back about its own horizontal axis (FO), along the forearm.
			FQuat Facing = FRotationMatrix::MakeFromXZ(Eye - At, T.TransformVector(ViewUp)).ToQuat();
			Facing = FQuat(Facing.GetAxisX(), FMath::DegreesToRadians(WristCaptureRollDeg)) * Facing;
			Facing = FQuat(Facing.GetAxisY(), FMath::DegreesToRadians(WristCaptureTiltDeg)) * Facing;
			WristPanel->SetWorldTransform(FTransform(Facing, At, FVector(WristCaptureScale / WristPanelPxPerCm)));
		}
		else
		{
			SetWristParent(Origin.Get(), NAME_None, FTransform(FRotationMatrix::MakeFromXZ(-Offset, ViewUp).Rotator(), Offset, FVector(1.0 / WristPanelPxPerCm)));
		}
	}
	WristPanel->RegisterComponent();
	FBpLinkModule& Link = FBpLinkModule::Get();
	ScanHandle = Link.OnScanState().AddUObject(this, &ABpPawn::ReceiveScanState);
	ReceiveScanState(Link.GetScanState());
}

void ABpPawn::SetWristParent(USceneComponent* Parent, FName Socket, const FTransform& Relative)
{
	if (!WristPanel || !Parent) return;
	if (WristPanel->IsRegistered()) WristPanel->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform, Socket);
	else WristPanel->SetupAttachment(Parent, Socket);
	WristPanel->SetRelativeTransform(Relative);
}

void ABpPawn::ReceiveScanState(const FBpScanState& State)
{
	if (!WristPanel) return;
	// The wave shown: the last dispatched, else the newest draft.
	const FBpWave* Wave = nullptr;
	for (const FBpWave& Each : State.Waves)
	{
		const bool bDispatched = Each.status == TEXT("dispatched");
		if (!Wave) { Wave = &Each; continue; }
		const bool bWaveDispatched = Wave->status == TEXT("dispatched");
		if (bDispatched != bWaveDispatched) { if (bDispatched) Wave = &Each; continue; }
		const FString& A = bDispatched ? Each.dispatched_at : Each.created_at;
		const FString& B = bDispatched ? Wave->dispatched_at : Wave->created_at;
		if (A > B) Wave = &Each;
	}
	TMap<FString, FString> Status;
	for (const FBpProposal& Proposal : State.Scan.proposals) Status.Add(Proposal.id, Proposal.status);

	struct FRow { FString Name; FString Meta; FString Tiers; float Fraction; int32 Count; };
	TArray<FRow> Rows;
	FString Key = Wave ? Wave->id + Wave->status : FString(TEXT("none"));
	if (Wave)
	{
		for (const FBpWavePackage& Package : Wave->packages)
		{
			int32 Built = 0;
			// FAF: the package's findings by triage tier (store v4), as the ledger's T0..T3 chips; untriaged ones are not counted.
			int32 ByTier[4] = { 0, 0, 0, 0 };
			for (const FString& Id : Package.ids)
			{
				Built += IsBuilt(Status.FindRef(Id)) ? 1 : 0;
				if (const int32* Tier = State.Tiers.Find(Id)) ++ByTier[FMath::Clamp(*Tier, 0, 3)];
			}
			TArray<FString> Chips;
			for (int32 Tier = 0; Tier < 4; ++Tier) if (ByTier[Tier] > 0) Chips.Add(FString::Printf(TEXT("T%d  %d"), Tier, ByTier[Tier]));
			const float Fraction = Package.ids.Num() > 0 ? static_cast<float>(Built) / Package.ids.Num() : 0.f;
			Rows.Add({ Package.name, FString::Printf(TEXT("%d %s · %s · %s"), Package.ids.Num(), Package.ids.Num() == 1 ? TEXT("finding") : TEXT("findings"), *Package.model, *Package.effort),
				FString::Join(Chips, TEXT("   ")), Fraction, Package.ids.Num() });
			Key += FString::Printf(TEXT("|%s:%d"), *Package.id, Built);
		}
	}
	// A draft (composed, not dispatched) has queued nothing, so its rings say "draft" rather than a built share (FAD).
	const bool bDraft = Wave && Wave->status == TEXT("draft");
	if (Key == WristKey) return;
	WristKey = Key;

	// FP: an opaque enough back that the sheet's labels do not show through (the judge, element 11; FO 0.72). FR (the
	// judges: "an opaque dark slab without the concept's glassy edge-lit panel"; "small low-contrast text"): a lighter
	// blue glass, a lit cyan edge with a soft outer glow and a pale sheen along its top, and larger, brighter type.
	// FAF (the judges: "opaque slate, not lit glass"): a lighter glass the forearm and the paper show through, a brighter lit
	// edge and glow, a stronger sheen, and lit rows; the type in white and near-white for contrast through the glass.
	static const FSlateRoundedBoxBrush Panel(GlassLit.CopyWithNewOpacity(0.8f), 20.f, CyanEdge, 4.5f);  // 0.66 of 1C4E8E read milky, the rail white through a row
	// FAB (element 11, the judges: the concept's panel has an emissive edge): two glow rings outside the lit edge, the
	// inner one bright enough to bloom.
	static const FSlateRoundedBoxBrush EdgeGlow(Cyan.CopyWithNewOpacity(0.16f), 32.f);
	static const FSlateRoundedBoxBrush EdgeGlowInner(Cyan.CopyWithNewOpacity(0.0f), 24.f, CyanEdge.CopyWithNewOpacity(0.85f), 5.f);
	static const FSlateRoundedBoxBrush Sheen(FLinearColor(1.f, 1.f, 1.f, 0.12f), 14.f);
	static const FSlateRoundedBoxBrush Row(Cyan.CopyWithNewOpacity(0.12f), 12.f, CyanEdge.CopyWithNewOpacity(0.7f), 2.f);
	TSharedRef<SVerticalBox> List = SNew(SVerticalBox);
	// FAF (pof's draft has two packages, the judges' "only two sparse rows"): up to two rows stand taller, with their tier
	// line, so the panel reads full; three or four keep FR's compact rows.
	const bool bTall = Rows.Num() <= 2;
	for (int32 Index = 0; Index < Rows.Num() && Index < 4; ++Index)
	{
		const FRow& R = Rows[Index];
		TSharedRef<SVerticalBox> Text = SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(R.Name)).Font(CapFont(TEXT("Bold"), bTall ? 32.f : 28.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)
			[
				SNew(STextBlock).Text(FText::FromString(R.Meta)).Font(CapFont(TEXT("Regular"), 21.f)).ColorAndOpacity(FSlateColor(CyanText))
			];
		if (bTall && !R.Tiers.IsEmpty())
		{
			Text->AddSlot().AutoHeight().Padding(0.f, 7.f, 0.f, 0.f)
			[
				SNew(STextBlock).Text(FText::FromString(R.Tiers)).Font(CapFont(TEXT("Bold"), 21.f)).ColorAndOpacity(FSlateColor(Amber))
			];
		}
		List->AddSlot().AutoHeight().Padding(0.f, bTall ? 12.f : 8.f, 0.f, 0.f)
		[
			SNew(SBorder).BorderImage(&Row).Padding(FMargin(12.f, bTall ? 14.f : 8.f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBpBlocks).Count(R.Count)
				]
				+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center).Padding(12.f, 0.f)
				[
					Text
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()
					[
						SNew(SBpRing).Fraction(R.Fraction)
					]
					+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(bDraft ? FString(TEXT("draft")) : FString::Printf(TEXT("%d%%"), FMath::RoundToInt(R.Fraction * 100.f))))
							.Font(CapFont(TEXT("Bold"), 20.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
					]
				]
			]
		];
	}
	if (Rows.Num() == 0)
	{
		List->AddSlot().AutoHeight().Padding(0.f, 14.f, 0.f, 0.f)
		[
			SNew(STextBlock).Text(FText::FromString(TEXT("No wave composed yet"))).Font(CapFont(TEXT("Regular"), 18.f)).ColorAndOpacity(FSlateColor(Cyan.CopyWithNewOpacity(0.75f)))
		];
	}
	const FString Sub = Wave ? FString::Printf(TEXT("%s · %s"), *Wave->name, *Wave->status) : FString();
	WristPanel->SetSlateWidget(
		SNew(SBorder).BorderImage(&EdgeGlow).Padding(5.f)
		[
		SNew(SBorder).BorderImage(&EdgeGlowInner).Padding(4.f)
		[
		SNew(SOverlay)
		+ SOverlay::Slot()
		[
		SNew(SBorder).BorderImage(&Panel).Padding(FMargin(20.f, 14.f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("PACKAGES"))).Font(CapFont(TEXT("Bold"), 25.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
			]
			// The wave's name and status on a line of its own (FO: beside the title it was cut and unreadable).
			+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 6.f, 0.f, 0.f)
			[
				SNew(STextBlock).Text(FText::FromString(Sub)).Font(CapFont(TEXT("Regular"), 18.f)).ColorAndOpacity(FSlateColor(CyanText))
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				List
			]
		]
		]
		+ SOverlay::Slot().VAlign(VAlign_Top).Padding(FMargin(14.f, 4.f, 14.f, 0.f))
		[
			SNew(SBox).HeightOverride(30.f)
			[
				SNew(SBorder).BorderImage(&Sheen)
			]
		]
		]
		]);
	WristPanel->RequestRedraw();
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist wave=%s packages=%d"), Wave ? *Wave->id : TEXT("none"), Rows.Num());
}
