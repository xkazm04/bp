// The shared focus, followed (the "one place" morning; BpTable.h declares the API and the constants). Another surface - the
// web's Morning Watch, a phone, the companion - publishes the place the owner is looking at (packages/core/src/session/
// focus.ts), BpLink reads it (FBpLinkModule::OnFollow) and the table goes there by its own routes: a room in room mode
// (the lift entry from the site plan, so the eye sees where before the paper turns to the room's map; a switch from
// another room's map), a wing by its lift, the site plan home. The person sits still and the view never moves (the VR
// comfort rule, docs/concepts/vr-light-table/companion-lamp-plan.md U3); every step eases, none jumps. A quiet caption on
// the frame's near rim says whom the table follows (and on which product, when it is not the one on the table) and where.
#include "BpTable.h"

#include "BpGameMode.h"
#include "BpLink.h"
#include "BpType.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Components/WidgetComponent.h"
#include "HAL/IConsoleManager.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	const FLinearColor FollowCyan(FColor(0xBF, 0xE8, 0xFF));
	const FLinearColor FollowGlass(FColor(0x08, 0x16, 0x2E));

	/** The caption's font at a cap height in its widget's pixels (BpType's family, as the lamp's caption). */
	FSlateFontInfo FollowFont(const TCHAR* Style, float CapPx)
	{
		return FSlateFontInfo(ABpTable::TextFontObject(), CapPx / (static_cast<float>(BpType::CapPerEm) * 96.f / 72.f), FName(Style));
	}

	/** A slug as words ("demo-studio" -> "Demo studio"): a product the table knows only by its slug. */
	FString SlugWords(const FString& Slug)
	{
		FString Out = Slug.Replace(TEXT("-"), TEXT(" "));
		return Out.Left(1).ToUpper() + Out.Mid(1);
	}
}

void ABpTable::InitFollow()
{
	FollowCaption = NewObject<UWidgetComponent>(this, TEXT("FollowCaption"));
	FollowCaption->SetupAttachment(Root);
	FollowCaption->SetWidgetSpace(EWidgetSpace::World);
	FollowCaption->SetDrawSize(FVector2D(FollowCaptionWidthCm * FollowCaptionPxPerCm, FollowCaptionHeightCm * FollowCaptionPxPerCm));
	FollowCaption->SetDrawAtDesiredSize(false);
	FollowCaption->SetPivot(FVector2D(0.5, 0.5));
	FollowCaption->SetBlendMode(EWidgetBlendMode::Transparent);
	FollowCaption->SetTwoSided(false);
	FollowCaption->SetBackgroundColor(FLinearColor::Transparent);
	FollowCaption->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	FollowCaption->SetCastShadow(false);
	FollowCaption->SetWindowFocusable(false);
	FollowCaption->SetManuallyRedraw(true);
	FollowCaption->RegisterComponent();
	FollowCaption->SetVisibility(false);
}

void ABpTable::Follow(const FBpFollowPlace& Place)
{
	if (!SheetPlan.IsValid())
	{
		// ApplyPlan takes BpLink's last place when the plan lands.
		bFollowPending = true;
		UE_LOG(LogBpTable, Log, TEXT("BpFollow: %s %s:%s waits for the plan"), *Place.Label, *Place.Kind, *Place.Id);
		return;
	}
	const FBpLinkModule& Link = FBpLinkModule::Get();
	// A demo product is a copy of Kettle's map, so its ids are this plan's; the caption says which product it was.
	const bool bOtherProduct = !Place.Product.IsEmpty() && Place.Product != Link.GetProductSlug();
	const FString Who = Place.Label + (bOtherProduct ? TEXT("  ·  ") + SlugWords(Place.Product) : FString());

	// The site: home, out of room mode.
	if (Place.Kind.IsEmpty() || Place.Kind == TEXT("site") || Place.Id.IsEmpty())
	{
		UE_LOG(LogBpTable, Log, TEXT("BpFollow: %s -> the site plan (rev %d)"), *Place.Label, Place.Rev);
		Home();
		ShowFollowCaption(Who, TEXT("Site plan"));
		return;
	}

	// The id, as a room, a bay, a wing, then a feature: a live product's room is a capability, which is a bay on Kettle's
	// plan; a feature is a tile in both. A feature target is looked up as a tile first.
	const FBpPlanRoom* Room = nullptr;
	const FBpPlanWing* Wing = nullptr;
	const FBpPlanBay* Bay = nullptr;
	const FBpPlanTile* Tile = nullptr;
	const auto FindTile = [this, &Place]() { return SheetPlan->tiles.FindByPredicate([&Place](const FBpPlanTile& T) { return T.id == Place.Id; }); };
	if (Place.Kind == TEXT("feature")) Tile = FindTile();
	if (!Tile) Room = FindRoom(Place.Id);
	if (!Tile && !Room) Bay = SheetPlan->bays.FindByPredicate([&Place](const FBpPlanBay& B) { return B.id == Place.Id; });
	if (!Tile && !Room && !Bay) Wing = FindWing(Place.Id);
	if (!Tile && !Room && !Bay && !Wing) Tile = FindTile();
	if (Tile) Bay = SheetPlan->bays.FindByPredicate([Tile](const FBpPlanBay& B) { return B.id == Tile->parentId; });
	if (Bay) Room = FindRoom(Bay->parentId);
	const TCHAR* As = Tile ? TEXT("feature") : Bay ? TEXT("bay") : Room ? TEXT("room") : Wing ? TEXT("wing") : TEXT("nothing");

	if (Wing)
	{
		UE_LOG(LogBpTable, Log, TEXT("BpFollow: %s -> wing %s \"%s\" (%s:%s, rev %d)"), *Place.Label, *Wing->id, *Wing->name, *Place.Kind, *Place.Id, Place.Rev);
		// A wing lifts on the site plan: out of a room's map first (its fade runs with the lift).
		if (!RoomModeId.IsEmpty()) ExitRoomMode();
		EnterWing(Wing->id);
		ShowFollowCaption(Who, Wing->letter + TEXT(" ") + Wing->name);
		return;
	}
	if (!Room)
	{
		// Nothing on this table answers to it: the table stays where it is and says so.
		UE_LOG(LogBpTable, Log, TEXT("BpFollow: %s -> %s:%s is on no level of this plan; the table stays (rev %d)"), *Place.Label, *Place.Kind, *Place.Id, Place.Rev);
		ShowFollowCaption(Who, Place.Id + TEXT(" is not on this table"));
		return;
	}
	UE_LOG(LogBpTable, Log, TEXT("BpFollow: %s -> room %s \"%s\" as %s (%s:%s, rev %d)"), *Place.Label, *Room->id, *Room->name, As, *Place.Kind, *Place.Id, Place.Rev);
	// A feature's screen comes to the deck's front once the map settles; for a bay, its first feature the deck holds.
	FollowFeature = Tile ? Tile->id : FString();
	FollowBay = !Tile && Bay ? Bay->id : FString();
	if (RoomModeId != Room->id)
	{
		bFollowEntering = true;
		if (RoomModeId.IsEmpty()) EnterRoomMode(Room->id);
		else SwitchRoom(Room->id, TEXT("follow"));
		bFollowEntering = false;
	}
	ShowFollowCaption(Who, Tile ? Tile->name + TEXT(" in ") + Room->name : Bay ? Bay->name + TEXT(" in ") + Room->name : Room->name);
}

bool ABpTable::TickFollow(float DeltaSeconds)
{
	// A followed feature's screen (or a followed bay's first in the deck) comes to the front once its room's map has settled.
	if ((!FollowFeature.IsEmpty() || !FollowBay.IsEmpty()) && !RoomModeId.IsEmpty() && ShownRoomMode == RoomModeId && RoomFade >= 1.f)
	{
		if (!FollowFeature.IsEmpty()) DeckFocus(FollowFeature);
		else if (const FBpPlanTile* First = SheetPlan->tiles.FindByPredicate([this](const FBpPlanTile& T) { return T.parentId == FollowBay && DeckScreens.ContainsByPredicate([&T](const FDeckScreen& S) { return S.Feature == T.id; }); }))
		{
			DeckFocus(First->id);
		}
		FollowFeature.Reset();
		FollowBay.Reset();
	}
	// BpLink.Follow off: the caption goes with it.
	const bool bShow = !FollowLine.IsEmpty() && FBpLinkModule::Get().IsFollowing();
	const float Want = bShow ? 1.f : 0.f;
	if (FollowCaptionAlpha == Want) return false;
	const IConsoleVariable* Reduced = IConsoleManager::Get().FindConsoleVariable(TEXT("bp.ReducedMotion"));
	const float Step = Reduced && Reduced->GetInt() != 0 ? 1.f : DeltaSeconds / FollowCaptionFadeS;
	FollowCaptionAlpha = Want > FollowCaptionAlpha ? FMath::Min(Want, FollowCaptionAlpha + Step) : FMath::Max(Want, FollowCaptionAlpha - Step);
	ApplyFollowCaption();
	return FollowCaptionAlpha != Want;
}

void ABpTable::ShowFollowCaption(const FString& Who, const FString& Where)
{
	FollowLine = TEXT("Following ") + (Who.IsEmpty() ? FString(TEXT("the shared focus")) : Who) + TEXT("\n") + Where;
	UE_LOG(LogBpTable, Log, TEXT("BpFollow: caption \"%s\""), *FollowLine.Replace(TEXT("\n"), TEXT(" / ")));
	if (!FollowCaption) return;
	static const FSlateRoundedBoxBrush Plate(FollowGlass.CopyWithNewOpacity(0.9f), 14.f, FollowCyan.CopyWithNewOpacity(0.45f), 2.f);
	const float W = FollowCaptionWidthCm * FollowCaptionPxPerCm, H = FollowCaptionHeightCm * FollowCaptionPxPerCm, Pad = 22.f;
	const FSlateFontInfo WhoFont = FollowFont(TEXT("Bold"), FollowCaptionCapCm * FollowCaptionPxPerCm);
	const FSlateFontInfo WhereFont = FollowFont(TEXT("Regular"), FollowCaptionPlaceCapCm * FollowCaptionPxPerCm);
	FString Line1, Line2;
	FollowLine.Split(TEXT("\n"), &Line1, &Line2);
	FollowCaption->SetSlateWidget(
		SNew(SBox).WidthOverride(W).HeightOverride(H)
		[
			SNew(SOverlay)
			+ SOverlay::Slot().Padding(3.f)[SNew(SBorder).BorderImage(&Plate)]
			+ SOverlay::Slot().Padding(FMargin(Pad, 6.f)).VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Line1)).Font(WhoFont).ColorAndOpacity(FSlateColor(FollowCyan)).OverflowPolicy(ETextOverflowPolicy::Ellipsis)]
				+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Line2)).Font(WhereFont)
					.ColorAndOpacity(FSlateColor(FLinearColor(0.92f, 0.92f, 0.92f, 0.85f))).OverflowPolicy(ETextOverflowPolicy::Ellipsis)]
			]
		]);
	FollowCaption->RequestRedraw();
	const FVector At(FollowCaptionXCm, FollowCaptionYCm, PlacedHeightCm + FollowCaptionAboveTopCm);
	const double Distance = FVector::Dist(EyeLocal(), At);
	UE_LOG(LogBpTable, Log, TEXT("BpType: follow caption cap_cm=%.2f/%.2f; %.1f cm from the target eye: %.1f/%.1f px"), FollowCaptionCapCm, FollowCaptionPlaceCapCm,
		Distance, FollowCaptionCapCm * 800.0 / Distance, FollowCaptionPlaceCapCm * 800.0 / Distance);
	SetActorTickInterval(0.f);
	ApplyFollowCaption();
}

void ABpTable::ApplyFollowCaption()
{
	if (!FollowCaption) return;
	const bool bVisible = FollowCaptionAlpha > 0.f;
	if (FollowCaption->IsVisible() != bVisible) FollowCaption->SetVisibility(bVisible);
	// On the near rim, square to the target view (its face toward the eye along the view's axis, not toward the eye's
	// point): so close to the eye and off the view's centre, a plate turned to the point reads tilted in a capture.
	const FVector At(FollowCaptionXCm, FollowCaptionYCm, PlacedHeightCm + FollowCaptionAboveTopCm);
	FollowCaption->SetRelativeTransform(FTransform(FRotator(-ABpGameMode::TargetPitchDeg, 180.f, 0.f), At, FVector(1.0 / FollowCaptionPxPerCm)));
	FollowCaption->SetTintColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, FMath::InterpEaseInOut(0.f, 1.f, FollowCaptionAlpha, 2.f)));
	FollowCaption->SetTranslucentSortPriority(14);
}
