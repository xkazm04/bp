// The wrist panel (spark vr-fidelity-40 FC1, element 11; BpPawn.h): the concept's "Packages" on the left wrist. It shows
// the latest wave (GET .../waves: the last dispatched one, else the newest draft) and, per package, its name, its model
// and effort, and a ring for how many of its findings are built (done, accepted or released in the store; a draft's
// rings say "draft"), all read from BpLink's scan state. With no wave it says so. Nothing here composes, dispatches or
// computes a wave. In room mode (spark vr-room-layers WP3) two tabs switch it to the product's rooms by urgency, the
// room shown marked; a tap on a row switches rooms (ABpTable::SwitchRoom, "the wrist").
#include "BpPawn.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpTable.h"
#include "BpType.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "MotionControllerComponent.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/SlateRenderer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SCanvas.h"
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

	// ---- The rooms tab's layout, in the panel's pixels (WristPanelWidthCm x WristPanelHeightCm at WristPanelPxPerCm): the
	// content's left and right edges inside the glow, the panel and their pads; the tabs on the title's row, right; the
	// rows under the title and its sub-line; the pager under them. The hands' boxes are these.
	constexpr float WristW = ABpPawn::WristPanelWidthCm * ABpPawn::WristPanelPxPerCm;
	constexpr float WristH = ABpPawn::WristPanelHeightCm * ABpPawn::WristPanelPxPerCm;
	constexpr float WristX0 = 29.f;
	constexpr float WristX1 = WristW - 29.f;
	const FBox2f WristTabPackages(FVector2f(WristX1 - 320.f, 16.f), FVector2f(WristX1 - 166.f, 60.f));
	const FBox2f WristTabRooms(FVector2f(WristX1 - 154.f, 16.f), FVector2f(WristX1, 60.f));
	/** With a headset, SEAT left of the tabs (BpHeadset.cpp: the table comes to the seated eye again). */
	const FBox2f WristSeat(FVector2f(WristX1 - 430.f, 16.f), FVector2f(WristX1 - 332.f, 60.f));
	constexpr float WristRowTop = 112.f;
	constexpr float WristRowH = 60.f;
	constexpr float WristRowStep = 66.f;
	const FBox2f WristPrev(FVector2f(WristX0, WristRowTop + 5 * WristRowStep), FVector2f(WristX0 + 160.f, WristRowTop + 5 * WristRowStep + 44.f));
	const FBox2f WristNext(FVector2f(WristX1 - 160.f, WristRowTop + 5 * WristRowStep), FVector2f(WristX1, WristRowTop + 5 * WristRowStep + 44.f));

	float WristTextWidth(const FString& Text, const FSlateFontInfo& Font)
	{
		if (FSlateApplication::IsInitialized())
		{
			if (FSlateRenderer* Renderer = FSlateApplication::Get().GetRenderer()) return static_cast<float>(Renderer->GetFontMeasureService()->Measure(Text, Font).X);
		}
		return Text.Len() * 0.5f * Font.Size * 96.f / 72.f;
	}

	FString WristCut(const FString& Text, const FSlateFontInfo& Font, float MaxW)
	{
		if (WristTextWidth(Text, Font) <= MaxW) return Text;
		for (int32 Keep = Text.Len() - 1; Keep > 0; --Keep)
		{
			const FString Cut = Text.Left(Keep).TrimEnd() + BpType::Ellipsis();
			if (WristTextWidth(Cut, Font) <= MaxW) return Cut;
		}
		return FString();
	}

	ABpPawn* WristPawn(UWorld* World)
	{
		APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
		return PC ? Cast<ABpPawn>(PC->GetPawn()) : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs CmdWristTap(
		TEXT("BpWrist.Tap"),
		TEXT("BpWrist.Tap <wrist:tab:rooms|wrist:tab:packages|wrist:room:<id>|wrist:page:next|wrist:page:prev|wrist:seat>: what a hand's tap on that control of the wrist panel does (room mode shows the tabs, a headset SEAT)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ABpPawn* Pawn = WristPawn(World);
			if (Args.Num() == 0 || !Pawn)
			{
				UE_LOG(LogBpTable, Warning, TEXT("BpWrist: usage BpWrist.Tap <id> (a playing world with the bp pawn)"));
				return;
			}
			Pawn->WristTap(Args[0]);
		}));
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
	// Room mode brings the rooms tab (WP3).
	if (TActorIterator<ABpTable> It(GetWorld()); It)
	{
		WristTable = *It;
		RoomHandle = It->OnRoomModeChanged().AddUObject(this, &ABpPawn::OnWristRoomChanged);
		WristRoomMode = It->GetRoomModeId();
	}
	FBpLinkModule& Link = FBpLinkModule::Get();
	ScanHandle = Link.OnScanState().AddUObject(this, &ABpPawn::ReceiveScanState);
	ReceiveScanState(Link.GetScanState());
}

void ABpPawn::OnWristRoomChanged(const FString& RoomId)
{
	WristRoomMode = RoomId;
	if (RoomId.IsEmpty()) bWristRooms = false;
	RefreshWrist();
}

bool ABpPawn::WristHit(const FVector& WorldOrigin, const FVector& WorldDir, FString& OutId) const
{
	if (!WristPanel || !WristPanel->IsVisible() || WristBoxes.Num() == 0) return false;
	const FTransform& T = WristPanel->GetComponentTransform();
	const FVector Normal = T.GetUnitAxis(EAxis::X);
	const double Denom = FVector::DotProduct(WorldDir, Normal);
	if (FMath::IsNearlyZero(Denom)) return false;
	const double Along = FVector::DotProduct(T.GetLocation() - WorldOrigin, Normal) / Denom;
	if (Along < 0.0) return false;
	// UWidgetComponent's mapping (as the deck's): widget x = -local Y, y = -local Z, from its pivot, in draw pixels.
	const FVector Local = T.InverseTransformPosition(WorldOrigin + WorldDir * Along);
	const FVector2f Px(static_cast<float>(-Local.Y + WristW * 0.5f), static_cast<float>(-Local.Z + WristH * 0.5f));
	for (const FWristBox& Each : WristBoxes)
	{
		if (Each.Box.IsInside(Px))
		{
			OutId = Each.Id;
			return true;
		}
	}
	return false;
}

FVector ABpPawn::GetWristWorld() const
{
	return WristPanel ? WristPanel->GetComponentLocation() : GetActorLocation();
}

bool ABpPawn::WristAim(const FString& Id, FVector& OutWorld) const
{
	const FWristBox* Box = WristBoxes.FindByPredicate([&Id](const FWristBox& Each) { return Each.Id == Id; });
	if (!WristPanel || !Box) return false;
	const FVector2f C = Box->Box.GetCenter();
	OutWorld = WristPanel->GetComponentTransform().TransformPosition(FVector(0.0, -(C.X - WristW * 0.5f), -(C.Y - WristH * 0.5f)));
	return true;
}

void ABpPawn::WristTap(const FString& Id)
{
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist tap %s"), *Id);
	ABpTable* Table = WristTable.Get();
	if (Id == TEXT("wrist:tab:rooms") && !WristRoomMode.IsEmpty())
	{
		bWristRooms = true;
		// The page with the room shown.
		if (Table)
		{
			const TArray<ABpTable::FRoomRank> Ranks = Table->RoomsByUrgency();
			const int32 At = Ranks.IndexOfByPredicate([this](const ABpTable::FRoomRank& R) { return R.Id == WristRoomMode; });
			WristPage = At == INDEX_NONE ? 0 : At / WristRoomsPerPage;
		}
	}
	else if (Id == TEXT("wrist:tab:packages")) bWristRooms = false;
	else if (Id == TEXT("wrist:page:next")) ++WristPage;
	else if (Id == TEXT("wrist:page:prev")) WristPage = FMath::Max(0, WristPage - 1);
	else if (Id.StartsWith(TEXT("wrist:room:")) && Table)
	{
		Table->SwitchRoom(Id.Mid(11), TEXT("wrist"));
		return;
	}
	else if (Id == TEXT("wrist:seat"))
	{
		Seat();
		return;
	}
	else
	{
		UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist tap %s does nothing here"), *Id);
		return;
	}
	RefreshWrist();
}

void ABpPawn::WristTextClasses(TArray<BpType::FClassSample>& Out) const
{
	if (!WristPanel) return;
	// The panel's caps in its pixels (RefreshWrist's), at its centre, rising along its up; its world scale is cm a pixel.
	const FTransform& T = WristPanel->GetComponentTransform();
	const double CmPerPx = T.GetScale3D().X;
	const auto Add = [&](const TCHAR* Name, double CapPx) { Out.Add({ Name, CapPx * CmPerPx, T.GetLocation(), T.GetUnitAxis(EAxis::Z) }); };
	Add(TEXT("wrist room name"), 25.0);
	Add(TEXT("wrist room counts"), 19.0);
	Add(TEXT("wrist package"), 32.0);
	Add(TEXT("wrist sub-line"), 21.0);
}

void ABpPawn::SetWristParent(USceneComponent* Parent, FName Socket, const FTransform& Relative)
{
	if (!WristPanel || !Parent) return;
	if (WristPanel->IsRegistered()) WristPanel->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform, Socket);
	else WristPanel->SetupAttachment(Parent, Socket);
	WristPanel->SetRelativeTransform(Relative);
}

void ABpPawn::ReceiveScanState(const FBpScanState&)
{
	RefreshWrist();
}

void ABpPawn::RefreshWrist()
{
	if (!WristPanel) return;
	const FBpScanState& State = FBpLinkModule::Get().GetScanState();
	// The wave shown: the draft the screen deck last wrote to (spark vr-room-layers WP2: the wrist reflects each Approve),
	// else the last dispatched, else the newest draft.
	const FBpWave* Wave = State.Waves.FindByPredicate([](const FBpWave& Each) { return Each.status == TEXT("draft") && Each.id == FBpLinkModule::Get().GetFocusWaveId(); });
	for (const FBpWave& Each : State.Waves)
	{
		if (Wave && Wave->id == FBpLinkModule::Get().GetFocusWaveId()) break;
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
			Key += FString::Printf(TEXT("|%s:%d/%d:%s"), *Package.id, Built, Package.ids.Num(), *Package.name);
		}
	}
	// A draft (composed, not dispatched) has queued nothing, so its rings say "draft" rather than a built share (FAD).
	const bool bDraft = Wave && Wave->status == TEXT("draft");
	// Room mode's tabs and the rooms tab (WP3): the ranks it shows are part of what it shows.
	ABpTable* Table = WristTable.Get();
	const bool bTabs = !WristRoomMode.IsEmpty() && Table;
	const bool bRooms = bTabs && bWristRooms;
	TArray<ABpTable::FRoomRank> Ranks;
	if (bRooms)
	{
		Ranks = Table->RoomsByUrgency();
		const int32 Pages = FMath::Max(1, FMath::DivideAndRoundUp(Ranks.Num(), WristRoomsPerPage));
		WristPage = FMath::Clamp(WristPage, 0, Pages - 1);
		Key += FString::Printf(TEXT("|rooms %s p%d|"), *WristRoomMode, WristPage);
		for (const ABpTable::FRoomRank& Rank : Ranks) Key += FString::Printf(TEXT("%s:%d,%d,%d;"), *Rank.Id, Rank.T0, Rank.T1, Rank.Open);
	}
	else if (bTabs)
	{
		Key += TEXT("|tabs");
	}
	const bool bSeat = IsHeadsetOn();
	if (bSeat) Key += TEXT("|seat");
	if (Key == WristKey) return;
	WristKey = Key;
	WristBoxes.Reset();

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
		// FAH (WP1's review: Kettle's panel read blank): the empty state as a row of its own, an empty package outline, the
		// way to fill it, and an empty ring.
		static const FSlateRoundedBoxBrush EmptyRow(Cyan.CopyWithNewOpacity(0.05f), 12.f, CyanEdge.CopyWithNewOpacity(0.45f), 2.f);
		List->AddSlot().AutoHeight().Padding(0.f, 12.f, 0.f, 0.f)
		[
			SNew(SBorder).BorderImage(&EmptyRow).Padding(FMargin(12.f, 14.f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBpBlocks).Count(1)
				]
				+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center).Padding(12.f, 0.f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("No draft yet"))).Font(CapFont(TEXT("Bold"), 32.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 7.f, 0.f, 0.f)
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("Approve a decision to start one"))).Font(CapFont(TEXT("Regular"), 21.f)).ColorAndOpacity(FSlateColor(CyanText))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()
					[
						SNew(SBpRing).Fraction(0.f)
					]
					+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("0"))).Font(CapFont(TEXT("Bold"), 20.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
					]
				]
			]
		];
	}
	FString Sub = Wave ? FString::Printf(TEXT("%s · %s"), *Wave->name, *Wave->status) : FString(TEXT("Draft wave · none"));
	FString Title = TEXT("PACKAGES");
	// The tabs and the rooms tab (WP3), at fixed places in the panel (WristHit reads the same boxes).
	TSharedRef<SCanvas> Over = SNew(SCanvas);
	const auto Put = [&Over](const FBox2f& Box, const TSharedRef<SWidget>& Widget)
	{
		Over->AddSlot().Position(FVector2D(Box.Min.X, Box.Min.Y)).Size(FVector2D(Box.GetSize().X, Box.GetSize().Y))[Widget];
	};
	if (bTabs)
	{
		static const FSlateRoundedBoxBrush TabOn(Cyan.CopyWithNewOpacity(0.32f), 10.f, CyanEdge, 2.5f);
		static const FSlateRoundedBoxBrush TabOff(Cyan.CopyWithNewOpacity(0.06f), 10.f, CyanEdge.CopyWithNewOpacity(0.5f), 2.f);
		const auto Tab = [&](const FBox2f& Box, const TCHAR* Text, bool bOn, const TCHAR* Id)
		{
			Put(Box, SNew(SBorder).BorderImage(bOn ? &TabOn : &TabOff).HAlign(HAlign_Center).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Text)).Font(CapFont(TEXT("Bold"), 20.f)).ColorAndOpacity(FSlateColor(bOn ? FLinearColor::White : CyanText.CopyWithNewOpacity(0.8f)))
				]);
			WristBoxes.Add({ Id, Box });
		};
		Tab(WristTabPackages, TEXT("PACKAGES"), !bRooms, TEXT("wrist:tab:packages"));
		Tab(WristTabRooms, TEXT("ROOMS"), bRooms, TEXT("wrist:tab:rooms"));
	}
	if (bSeat)
	{
		static const FSlateRoundedBoxBrush SeatBrush(Amber.CopyWithNewOpacity(0.10f), 10.f, Amber.CopyWithNewOpacity(0.8f), 2.f);
		Put(WristSeat, SNew(SBorder).BorderImage(&SeatBrush).HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("SEAT"))).Font(CapFont(TEXT("Bold"), 20.f)).ColorAndOpacity(FSlateColor(Amber))
			]);
		WristBoxes.Add({ TEXT("wrist:seat"), WristSeat });
	}
	if (bRooms)
	{
		// The rooms by urgency, a page of them: the name, and the counts that rank it; the room shown marked.
		List = SNew(SVerticalBox);
		Title = TEXT("ROOMS");
		int32 Findings = 0;
		if (Wave) for (const FBpWavePackage& Package : Wave->packages) Findings += Package.ids.Num();
		Sub = FString::Printf(TEXT("By urgency · %d rooms · draft %d %s"), Ranks.Num(), Findings, Findings == 1 ? TEXT("finding") : TEXT("findings"));
		static const FSlateRoundedBoxBrush RoomRow(Cyan.CopyWithNewOpacity(0.10f), 10.f, CyanEdge.CopyWithNewOpacity(0.55f), 2.f);
		static const FSlateRoundedBoxBrush RoomHere(Cyan.CopyWithNewOpacity(0.30f), 10.f, Amber, 3.f);
		static const FSlateRoundedBoxBrush Pager(Cyan.CopyWithNewOpacity(0.08f), 10.f, CyanEdge.CopyWithNewOpacity(0.6f), 2.f);
		const FSlateFontInfo NameFont = CapFont(TEXT("Bold"), 25.f), CountFont = CapFont(TEXT("Bold"), 19.f);
		for (int32 Index = 0; Index < WristRoomsPerPage; ++Index)
		{
			const int32 At = WristPage * WristRoomsPerPage + Index;
			if (!Ranks.IsValidIndex(At)) break;
			const ABpTable::FRoomRank& Rank = Ranks[At];
			const bool bHere = Rank.Id == WristRoomMode;
			FString Counts;
			if (Rank.T0 > 0) Counts += FString::Printf(TEXT("T0 %d · "), Rank.T0);
			if (Rank.T1 > 0) Counts += FString::Printf(TEXT("T1 %d · "), Rank.T1);
			Counts += Rank.Open > 0 ? FString::Printf(TEXT("%d OPEN"), Rank.Open) : FString(TEXT("NOTHING OPEN"));
			const FLinearColor CountInk = Rank.T0 + Rank.T1 > 0 ? Amber : Rank.Open > 0 ? CyanText : CyanText.CopyWithNewOpacity(0.6f);
			const float CountW = WristTextWidth(Counts, CountFont) + 8.f;
			const float HereW = bHere ? WristTextWidth(TEXT("HERE"), CountFont) + 18.f : 0.f;
			const FString Name = WristCut(FString::Printf(TEXT("%d  %s"), At + 1, *Rank.Name), NameFont, WristX1 - WristX0 - 28.f - CountW - HereW - 12.f);
			const FBox2f Box(FVector2f(WristX0, WristRowTop + Index * WristRowStep), FVector2f(WristX1, WristRowTop + Index * WristRowStep + WristRowH));
			TSharedRef<SHorizontalBox> Line = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Name)).Font(NameFont).ColorAndOpacity(FSlateColor(FLinearColor::White))
				];
			if (bHere)
			{
				Line->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(0.f, 0.f, 12.f, 0.f)
				[
					SNew(STextBlock).Text(FText::FromString(TEXT("HERE"))).Font(CountFont).ColorAndOpacity(FSlateColor(Cyan))
				];
			}
			Line->AddSlot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Counts)).Font(CountFont).ColorAndOpacity(FSlateColor(CountInk))
			];
			Put(Box, SNew(SBorder).BorderImage(bHere ? &RoomHere : &RoomRow).Padding(FMargin(14.f, 0.f)).VAlign(VAlign_Center)[Line]);
			WristBoxes.Add({ TEXT("wrist:room:") + Rank.Id, Box });
		}
		// The pager.
		const int32 Pages = FMath::Max(1, FMath::DivideAndRoundUp(Ranks.Num(), WristRoomsPerPage));
		const auto PagerTab = [&](const FBox2f& Box, const TCHAR* Text, bool bOn, const TCHAR* Id)
		{
			Put(Box, SNew(SBorder).BorderImage(&Pager).HAlign(HAlign_Center).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Text)).Font(CapFont(TEXT("Bold"), 19.f)).ColorAndOpacity(FSlateColor(bOn ? FLinearColor::White : CyanText.CopyWithNewOpacity(0.3f)))
				]);
			if (bOn) WristBoxes.Add({ Id, Box });
		};
		PagerTab(WristPrev, TEXT("‹  PREV"), WristPage > 0, TEXT("wrist:page:prev"));
		PagerTab(WristNext, TEXT("NEXT  ›"), WristPage + 1 < Pages, TEXT("wrist:page:next"));
		Put(FBox2f(FVector2f(WristPrev.Max.X, WristPrev.Min.Y), FVector2f(WristNext.Min.X, WristNext.Max.Y)),
			SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("PAGE %d OF %d"), WristPage + 1, Pages))).Font(CapFont(TEXT("Bold"), 19.f)).ColorAndOpacity(FSlateColor(CyanText))
			]);
	}
	WristPanel->SetSlateWidget(
		SNew(SOverlay)
		+ SOverlay::Slot()
		[
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
				SNew(STextBlock).Text(FText::FromString(Title)).Font(CapFont(TEXT("Bold"), 25.f)).ColorAndOpacity(FSlateColor(FLinearColor::White))
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
		]
		]
		// The tabs and the rooms tab over it, at the panel's own pixels (the glow's pads included).
		+ SOverlay::Slot()[Over]);
	WristPanel->RequestRedraw();
	UE_LOG(LogBpTable, Log, TEXT("BpPawn: wrist wave=%s packages=%d%s"), Wave ? *Wave->id : TEXT("none"), Rows.Num(),
		bRooms ? *FString::Printf(TEXT(" rooms tab page %d (%d rooms, here %s)"), WristPage + 1, Ranks.Num(), *WristRoomMode) : bTabs ? TEXT(" (tabs)") : TEXT(""));
}
