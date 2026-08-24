"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Palette,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import CardRenderer, {
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ClientSidebar from "@/components/ClientSidebar";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";
import { buildPublicCardUrl } from "@/lib/public-url";
import {
  defaultTemplateForPlan,
  firstTemplateColour,
  getInitialFieldOrder,
  hiddenFieldsForCard,
  isFieldHidden,
  mapSupabaseCard,
  mergeAllowedFieldsWithFieldOrder,
  selectedColourForTemplate,
  selectedTextColourForTemplate,
  templateForCard,
  type CardFieldOrder,
  type CardTemplate,
  type ClientCardPlan,
  type SharedClientCard,
  type SupabaseCardRow,
} from "@/lib/services/card-payload";
import { supabase } from "@/lib/supabase";
import { getClientVisibleTemplates } from "@/lib/templates";
import { useClientPlan } from "@/lib/use-client-plan";

const walletSlots = [1, 2, 3] as const;
const defaultWalletBackgroundColour = "#000000";
const defaultWalletTextColour = "#FFFFFF";
const minimumWalletContrastRatio = 4.5;
const walletQrQuietZone = 4;

type WalletSlot = (typeof walletSlots)[number];
type WalletColourMode = "default" | "custom";
type AppleWalletPassLink = {
  passPath: string;
  publicPassUrl: string;
};

type PublishedWalletCard = {
  id: string;
  slot: WalletSlot;
  name: string;
  publicUrl: string;
  publicPath: string;
  fullName: string;
  company: string;
  jobTitle: string;
  backgroundColor: string;
  cardData: SharedClientCard;
  template: CardRendererTemplate | null;
};

export default function ClientWalletPage() {
  const { isPaid, plan } = useClientPlan();
  const currentPlan = (plan || "free") as ClientCardPlan;
  const [cards, setCards] = useState<PublishedWalletCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const selectedCard = useMemo(
    () =>
      cards.find((card) => card.id === selectedCardId) ||
      cards[0] ||
      null,
    [cards, selectedCardId]
  );

  useEffect(() => {
    let ignore = false;

    async function loadPublishedCards() {
      setLoading(true);
      setLoadError("");

      try {
        const { user } = await requireClientUser();
        const templates = (await getClientVisibleTemplates(
          currentPlan
        )) as CardTemplate[];
        const defaultTemplate = defaultTemplateForPlan(templates, currentPlan);
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("user_id", user.id)
          .or("status.eq.published,is_published.eq.true")
          .order("card_slot", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });

        if (ignore) return;

        if (error) {
          console.error("Wallet published cards fetch failed", error);
          setLoadError("Could not load your published cards.");
          setCards([]);
          setSelectedCardId("");
          return;
        }

        const nextCards = (data || [])
          .map((row) =>
            toPublishedWalletCard(
              row as SupabaseCardRow,
              templates,
              currentPlan,
              defaultTemplate
            )
          )
          .filter((card): card is PublishedWalletCard => Boolean(card));

        setCards(nextCards);
        setSelectedCardId((currentSelectedCardId) => {
          if (nextCards.some((card) => card.id === currentSelectedCardId)) {
            return currentSelectedCardId;
          }

          return nextCards[0]?.id || "";
        });
      } catch (error) {
        if (ignore) return;

        if (error instanceof ClientAuthRequiredError) {
          setLoadError("Please sign in to manage Wallet.");
          return;
        }

        console.error("Wallet cards load failed", error);
        setLoadError("Could not load Wallet details.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadPublishedCards();

    return () => {
      ignore = true;
    };
  }, [currentPlan]);

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-4xl font-bold">Wallet</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Add your digital business card to Apple Wallet or Google Wallet.
            </p>
          </div>
        </div>

        {loading ? (
          <MessageCard
            icon={WalletCards}
            title="Loading Wallet details..."
            message="Checking your published card slots."
          />
        ) : loadError ? (
          <MessageCard icon={AlertCircle} title="Wallet unavailable" message={loadError} />
        ) : (
          <WalletReadyState
            cards={cards}
            isPaid={isPaid}
            selectedCard={selectedCard}
            selectedCardId={selectedCard?.id || ""}
            onSelectCard={(cardId) => setSelectedCardId(cardId)}
          />
        )}
      </section>
    </main>
  );
}

function WalletReadyState({
  cards,
  isPaid,
  selectedCard,
  selectedCardId,
  onSelectCard,
}: {
  cards: PublishedWalletCard[];
  isPaid: boolean;
  selectedCard: PublishedWalletCard | null;
  selectedCardId: string;
  onSelectCard: (cardId: string) => void;
}) {
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleError, setAppleError] = useState("");
  const [passLink, setPassLink] = useState<AppleWalletPassLink | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<WalletColourMode>("default");
  const [customBackgroundColour, setCustomBackgroundColour] = useState("#AC00FF");
  const [textMode, setTextMode] = useState<WalletColourMode>("default");
  const [customTextColour, setCustomTextColour] = useState(defaultWalletTextColour);
  const selectedBackgroundColour =
    isPaid && backgroundMode === "custom"
      ? customBackgroundColour
      : defaultWalletBackgroundColour;
  const selectedTextColour =
    isPaid && textMode === "custom" ? customTextColour : defaultWalletTextColour;
  const selectedLabelColour = labelColourForWalletPass(
    selectedBackgroundColour,
    selectedTextColour
  );
  const contrastRatio = colourContrastRatio(selectedBackgroundColour, selectedTextColour);
  const contrastError =
    contrastRatio < minimumWalletContrastRatio
      ? "Choose a text colour with stronger contrast against the Wallet background."
      : "";

  async function handleAppleWalletDownload() {
    if (appleLoading || !selectedCard) return;

    if (contrastError) {
      setAppleError(contrastError);
      return;
    }

    setAppleLoading(true);
    setAppleError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setAppleError("Please sign in again before adding this pass.");
        return;
      }

      const response = await fetch(
        `/api/client/wallet/apple/${encodeURIComponent(
          selectedCard.id
        )}/link`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            backgroundColor: selectedBackgroundColour,
            foregroundColor: selectedTextColour,
            labelColor: selectedLabelColour,
          }),
          cache: "no-store",
        }
      );

      if (!response.ok) {
        setAppleError(await appleWalletErrorMessage(response));
        return;
      }

      const nextPassLink = (await response.json()) as AppleWalletPassLink;

      if (isAppleWalletNativeBrowser()) {
        window.location.assign(nextPassLink.passPath);
        return;
      }

      setPassLink(nextPassLink);
    } catch (error) {
      console.error("Apple Wallet download failed", error);
      setAppleError("Could not generate your Apple Wallet pass. Please try again.");
    } finally {
      setAppleLoading(false);
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]">
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <SectionTitle
            title="Wallet Settings"
            description="Choose the published card and pass colour for Wallet."
          />

          <div className="mt-6 space-y-6">
            <SettingsBlock title="Select Card">
              <WalletCardSelector
                cards={cards}
                selectedCardId={selectedCardId}
                onSelect={onSelectCard}
              />
            </SettingsBlock>

            <SettingsBlock title="Wallet Colour">
              <WalletAppearanceControls
                backgroundMode={backgroundMode}
                contrastError={contrastError}
                customBackgroundColour={customBackgroundColour}
                customTextColour={customTextColour}
                isPaid={isPaid}
                labelColour={selectedLabelColour}
                onBackgroundModeChange={setBackgroundMode}
                onCustomBackgroundColourChange={setCustomBackgroundColour}
                onCustomTextColourChange={setCustomTextColour}
                onReset={() => {
                  setBackgroundMode("default");
                  setTextMode("default");
                  setCustomBackgroundColour("#AC00FF");
                  setCustomTextColour(defaultWalletTextColour);
                }}
                onTextModeChange={setTextMode}
                selectedBackgroundColour={selectedBackgroundColour}
                selectedTextColour={selectedTextColour}
                textMode={textMode}
              />
            </SettingsBlock>
          </div>
        </section>
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <SectionTitle
            title="Add to Wallet"
            description="Generate a real wallet pass from the selected published card."
          />

          <div className="mt-6 space-y-4">
            <SelectedWalletSummary
              card={selectedCard}
              selectedColour={selectedBackgroundColour}
            />
            <AppleWalletButton
              loading={appleLoading}
              error={appleError || contrastError}
              disabled={!selectedCard || Boolean(contrastError)}
              onClick={handleAppleWalletDownload}
            />
            <GoogleWalletButton />
          </div>
        </section>
      </aside>

      {passLink && selectedCard && (
        <AppleWalletFallbackModal
          card={selectedCard}
          passLink={passLink}
          onClose={() => setPassLink(null)}
        />
      )}
    </div>
  );
}

function AppleWalletFallbackModal({
  card,
  onClose,
  passLink,
}: {
  card: PublishedWalletCard;
  onClose: () => void;
  passLink: AppleWalletPassLink;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101935] p-5 text-white shadow-2xl shadow-black/40 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Add to Apple Wallet</h2>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Scan with your iPhone to open the real Apple Wallet pass for {card.name}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close Apple Wallet dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 rounded-[2rem] bg-white p-5 text-[#0F172A]">
          <WalletQrCode value={passLink.publicPassUrl} />
          <p className="mt-4 text-center text-sm font-semibold text-[#0F172A]">
            Scan with your iPhone
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <a
            href={passLink.passPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
          >
            Download Pass
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletCardSelector({
  cards,
  selectedCardId,
  onSelect,
}: {
  cards: PublishedWalletCard[];
  selectedCardId: string;
  onSelect: (cardId: string) => void;
}) {
  const cardsBySlot = new Map(cards.map((card) => [card.slot, card]));

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {walletSlots.map((slot) => {
        const card = cardsBySlot.get(slot);

        if (!card) {
          return (
            <div
              key={slot}
              className="flex min-h-[190px] flex-col justify-between rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-3 text-white/45"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                  Slot {slot}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold">
                  Empty
                </span>
              </div>
              <div className="flex min-h-28 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm">
                Empty
              </div>
              <p className="text-xs text-white/35">
                Publish a card in this slot to create a wallet pass.
              </p>
            </div>
          );
        }

        const selected = card.id === selectedCardId;

        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(card.id)}
            className={`min-h-[190px] rounded-2xl border p-3 text-left transition ${
              selected
                ? "border-[#AC00FF]/70 shadow-lg shadow-purple-500/15 ring-2 ring-[#AC00FF]/45"
                : "border-white/10 bg-white/5 hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10"
            }`}
            style={selected ? { backgroundColor: "rgba(172, 0, 255, 0.12)" } : undefined}
            aria-pressed={selected}
          >
            <span className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                Slot {card.slot}
              </span>
              <PublishedBadge />
            </span>
            <span className="block h-28 overflow-hidden rounded-xl border border-white/10 bg-black/70 text-white">
              {card.template ? (
                <span className="flex w-full justify-center overflow-hidden">
                  <span className="origin-top scale-[0.44]">
                    <CardRenderer
                      template={card.template}
                      cardData={card.cardData}
                      mode="compact"
                    />
                  </span>
                </span>
              ) : (
                <span className="flex h-full items-center justify-center text-sm text-white/45">
                  Preview unavailable
                </span>
              )}
            </span>
            <span className="mt-3 block truncate text-sm font-semibold text-white">
              {card.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WalletAppearanceControls({
  backgroundMode,
  contrastError,
  customBackgroundColour,
  customTextColour,
  isPaid,
  labelColour,
  onBackgroundModeChange,
  onCustomBackgroundColourChange,
  onCustomTextColourChange,
  onReset,
  onTextModeChange,
  selectedBackgroundColour,
  selectedTextColour,
  textMode,
}: {
  backgroundMode: WalletColourMode;
  contrastError: string;
  customBackgroundColour: string;
  customTextColour: string;
  isPaid: boolean;
  labelColour: string;
  onBackgroundModeChange: (mode: WalletColourMode) => void;
  onCustomBackgroundColourChange: (colour: string) => void;
  onCustomTextColourChange: (colour: string) => void;
  onReset: () => void;
  onTextModeChange: (mode: WalletColourMode) => void;
  selectedBackgroundColour: string;
  selectedTextColour: string;
  textMode: WalletColourMode;
}) {
  return (
    <div className="space-y-5">
      <AppearanceSection
        customColour={customBackgroundColour}
        customLabel="Custom background"
        defaultColour={defaultWalletBackgroundColour}
        isPaid={isPaid}
        label="Wallet background colour"
        mode={backgroundMode}
        onCustomColourChange={onCustomBackgroundColourChange}
        onModeChange={onBackgroundModeChange}
      />
      <AppearanceSection
        customColour={customTextColour}
        customLabel="Custom text"
        defaultColour={defaultWalletTextColour}
        isPaid={isPaid}
        label="Text Colour"
        mode={textMode}
        onCustomColourChange={onCustomTextColourChange}
        onModeChange={onTextModeChange}
      />

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-xs font-semibold"
              style={{
                backgroundColor: selectedBackgroundColour,
                color: selectedTextColour,
              }}
              aria-hidden="true"
            >
              Aa
            </span>
            <div>
              <p className="font-mono text-sm font-semibold text-white">
                {selectedBackgroundColour} / {selectedTextColour}
              </p>
              <p className="mt-1 text-xs text-white/45">
                Label colour will be calculated as {labelColour}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10"
          >
            Reset to default
          </button>
        </div>
        {contrastError && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100">
            {contrastError}
          </p>
        )}
      </div>
    </div>
  );
}

function AppearanceSection({
  customColour,
  customLabel,
  defaultColour,
  isPaid,
  label,
  mode,
  onCustomColourChange,
  onModeChange,
}: {
  customColour: string;
  customLabel: string;
  defaultColour: string;
  isPaid: boolean;
  label: string;
  mode: WalletColourMode;
  onCustomColourChange: (colour: string) => void;
  onModeChange: (mode: WalletColourMode) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold">{label}</p>
        <span className="font-mono text-xs text-white/45">
          {mode === "custom" && isPaid ? customColour : defaultColour}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AppearanceOption
          active={mode === "default" || !isPaid}
          colour={defaultColour}
          label="Default"
          onClick={() => onModeChange("default")}
        />
        <AppearanceOption
          active={mode === "custom" && isPaid}
          colour={customColour}
          disabled={!isPaid}
          label={customLabel}
          onClick={() => {
            if (isPaid) onModeChange("custom");
          }}
          pro
        />
      </div>
      {mode === "custom" && isPaid && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-3 text-sm font-semibold">
            <Palette className="h-4 w-4 text-purple-100" />
            Choose custom colour
          </label>
          <input
            type="color"
            value={customColour}
            onChange={(event) => {
              const safeColour = safeHexColor(event.target.value);
              if (safeColour) onCustomColourChange(safeColour);
            }}
            className="h-11 w-full rounded-xl border border-white/10 bg-[#101935] p-1 sm:w-24"
            aria-label={`Choose ${label.toLowerCase()}`}
          />
        </div>
      )}
    </div>
  );
}

function AppearanceOption({
  active,
  colour,
  disabled = false,
  label,
  onClick,
  pro = false,
}: {
  active: boolean;
  colour: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pro?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-3 text-left transition ${
        active
          ? "border-[#AC00FF]/70 bg-[#AC00FF]/15 text-white ring-2 ring-[#AC00FF]/35"
          : "border-white/10 bg-white/5 text-white/60 hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
      } disabled:cursor-not-allowed disabled:opacity-55`}
      aria-pressed={active}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        {active && <Check className="h-4 w-4 text-purple-100" />}
      </span>
      <span className="mt-3 flex items-center gap-2">
        <span
          className="h-6 w-6 rounded-lg border border-white/20"
          style={{ backgroundColor: colour }}
          aria-hidden="true"
        />
        <span className="font-mono text-xs">{colour}</span>
        {pro && <ProBadge />}
      </span>
    </button>
  );
}

function ProBadge() {
  return (
    <span
      className="ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{
        borderColor: "var(--border-accent)",
        background: "var(--brand-gradient-subtle)",
        color: "var(--text-accent)",
      }}
    >
      Pro
    </span>
  );
}

function SelectedWalletSummary({
  card,
  selectedColour,
}: {
  card: PublishedWalletCard | null;
  selectedColour: string;
}) {
  if (!card) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-white/45">
        Publish and select a card before adding it to Wallet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-center gap-3">
        <span
          className="h-11 w-11 rounded-2xl border border-white/10"
          style={{ backgroundColor: selectedColour }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{card.name}</p>
          <p className="mt-1 text-sm text-white/45">
            Slot {card.slot} will be used for the Apple Wallet pass.
          </p>
        </div>
      </div>
    </div>
  );
}

function PublishedBadge() {
  return (
    <span
      className="inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold"
      style={{
        borderColor: "color-mix(in srgb, var(--success) 28%, transparent)",
        background: "var(--success-bg)",
        color: "var(--success)",
      }}
    >
      Published
    </span>
  );
}

function AppleWalletButton({
  loading,
  error,
  disabled,
  onClick,
}: {
  loading: boolean;
  error: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-4">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-[#AC00FF]/35 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Add to Apple Wallet"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-white/75">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing pass...
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/wallet/add-to-apple-wallet.svg"
            alt="Add to Apple Wallet"
            className="h-[35px] w-auto"
          />
        )}
      </button>
      <p className="mt-3 text-sm leading-6 text-white/55">
        {error || "Creates a signed Apple Wallet pass from the selected card."}
      </p>
    </div>
  );
}

function GoogleWalletButton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <button
        type="button"
        disabled
        className="inline-flex min-h-14 w-full cursor-not-allowed items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 opacity-45"
        aria-label="Add to Google Wallet coming soon"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wallet/add-to-google-wallet.svg"
          alt="Add to Google Wallet"
          className="h-[35px] w-auto"
        />
      </button>
      <p className="mt-3 text-sm font-semibold leading-6 text-white/50">
        Google Wallet coming soon
      </p>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
    </div>
  );
}

function SettingsBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-white/45">
        {title}
      </p>
      {children}
    </div>
  );
}

function MessageCard({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-black/20">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
        <Icon className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
        {message}
      </p>
    </div>
  );
}

function toPublishedWalletCard(
  row: SupabaseCardRow,
  templates: CardTemplate[],
  plan: ClientCardPlan,
  defaultTemplate: CardTemplate | null
): PublishedWalletCard | null {
  const id = row.id || "";
  const slug = row.slug?.trim() || "";
  const slot = normalizeWalletSlot(row.card_slot);

  if (!id || !slug || !slot) return null;

  const cardData = mapSupabaseCard(row, templates, plan);
  const fullName =
    cardData.full_name ||
    [cardData.first_name, cardData.last_name].filter(Boolean).join(" ") ||
    cardData.card_name ||
    "Full Name";
  const cardTemplate = templateForCard(cardData, templates, plan) || defaultTemplate;
  const previewTemplate = buildWalletCardPreviewTemplate(cardTemplate, cardData);

  return {
    id,
    slot,
    name: cardData.card_name || fullName,
    publicUrl: buildPublicCardUrl(slug),
    publicPath: `/u/${slug}`,
    fullName,
    company: cardData.company_name || "Company",
    jobTitle: cardData.job_title || "Job title",
    backgroundColor: cardData.selected_colour || defaultWalletBackgroundColour,
    cardData,
    template: previewTemplate,
  };
}

function buildWalletCardPreviewTemplate(
  template: CardTemplate | null,
  card: SharedClientCard
): CardRendererTemplate | null {
  if (!template) return null;

  const fieldOrder = card.field_order || getInitialFieldOrder(template);
  const rendererFieldOrder = fieldOrderForRenderer(
    fieldOrder,
    hiddenFieldsForCard(card)
  );
  const hiddenFieldSet = new Set(hiddenFieldsForCard(card));
  const allowedFields = mergeAllowedFieldsWithFieldOrder(
    template.allowed_fields || [],
    rendererFieldOrder,
    hiddenFieldSet
  );
  const selectedColour = selectedColourForTemplate(
    template,
    card.selected_colour || firstTemplateColour(template)
  );
  const selectedTextColour = selectedTextColourForTemplate(
    template,
    card.selected_text_colour,
    selectedColour
  );

  if (template.access_level === "free") {
    return {
      ...template,
      allowed_fields: allowedFields,
      custom_fields: rendererFieldOrder,
      free_colour_palette: [selectedColour],
      colour_palette: [selectedColour],
      primary_color: selectedColour,
      secondary_color: selectedColour,
      text_color: selectedTextColour,
      show_personal_section:
        (template.show_personal_section ?? true) &&
        rendererFieldOrder.personal.length > 0,
      show_company_section:
        (template.show_company_section ?? true) &&
        rendererFieldOrder.company.length > 0,
      show_contact_section:
        (template.show_contact_section ?? true) &&
        rendererFieldOrder.contact.length > 0,
      show_social_section:
        (template.show_social_section ?? false) &&
        rendererFieldOrder.social.length > 0,
    };
  }

  return {
    ...template,
    allowed_fields: allowedFields,
    custom_fields: rendererFieldOrder,
    text_color: selectedTextColour || template.text_color,
    show_personal_section:
      (template.show_personal_section ?? true) &&
      rendererFieldOrder.personal.length > 0,
    show_company_section:
      (template.show_company_section ?? true) &&
      rendererFieldOrder.company.length > 0,
    show_contact_section:
      (template.show_contact_section ?? true) &&
      rendererFieldOrder.contact.length > 0,
    show_social_section:
      (template.show_social_section ?? false) &&
      rendererFieldOrder.social.length > 0,
  };
}

function fieldOrderForRenderer(
  fieldOrder: CardFieldOrder,
  hiddenFields: string[] = []
): CardFieldOrder {
  const hiddenFieldSet = new Set(hiddenFields);

  return {
    personal: fieldOrder.personal.filter(
      (field) => field !== "full_name" && !isFieldHidden(field, hiddenFieldSet)
    ),
    company: fieldOrder.company.filter((field) => !isFieldHidden(field, hiddenFieldSet)),
    contact: fieldOrder.contact.filter(
      (field) => field !== "website" && !isFieldHidden(field, hiddenFieldSet)
    ),
    social: fieldOrder.social.filter((field) => !isFieldHidden(field, hiddenFieldSet)),
  };
}

function normalizeWalletSlot(value: number | null | undefined): WalletSlot | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

async function appleWalletErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; code?: string };

    if (body.message) {
      return body.message;
    }
  } catch {
    // The API should return JSON for errors, but keep a readable fallback.
  }

  if (response.status === 401) return "Please sign in again before adding this pass.";
  if (response.status === 404) return "Could not find a published card for this account.";
  if (response.status === 409) return "Publish this card before adding it to Apple Wallet.";
  if (response.status === 503) return "Apple Wallet is not configured yet.";

  return "Could not generate your Apple Wallet pass. Please try again.";
}

function WalletQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => createWalletQrMatrix(value), [value]);
  const moduleCount = matrix.length + walletQrQuietZone * 2;

  return (
    <svg
      className="mx-auto aspect-square w-full max-w-[260px] rounded-2xl bg-white"
      viewBox={`0 0 ${moduleCount} ${moduleCount}`}
      role="img"
      aria-label="Apple Wallet pass QR code"
      shapeRendering="crispEdges"
    >
      <rect width={moduleCount} height={moduleCount} fill="#ffffff" />
      {matrix.flatMap((row, rowIndex) =>
        row.map((filled, colIndex) => {
          if (!filled) return null;

          return (
            <rect
              key={`${rowIndex}-${colIndex}`}
              x={colIndex + walletQrQuietZone}
              y={rowIndex + walletQrQuietZone}
              width={1}
              height={1}
              fill="#0F172A"
            />
          );
        })
      )}
    </svg>
  );
}

function createWalletQrMatrix(value: string) {
  const version = 5;
  const size = 17 + version * 4;
  const dataCodewords = 108;
  const errorCodewords = 26;
  const remainderBits = 7;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  addWalletQrFinder(matrix, reserved, 0, 0);
  addWalletQrFinder(matrix, reserved, size - 7, 0);
  addWalletQrFinder(matrix, reserved, 0, size - 7);
  addWalletQrTiming(matrix, reserved);
  addWalletQrAlignment(matrix, reserved, 30, 30);
  reserveWalletQrFormat(matrix, reserved);
  setWalletQrFunctionModule(matrix, reserved, 8, size - 8, true);

  const data = buildWalletQrDataCodewords(value, dataCodewords);
  const ecc = walletQrReedSolomonRemainder(data, errorCodewords);
  const bits = [...data, ...ecc].flatMap((codeword) =>
    walletQrByteToBits(codeword)
  );

  for (let index = 0; index < remainderBits; index += 1) bits.push(false);

  placeWalletQrDataBits(matrix, reserved, bits);
  applyWalletQrMask0(matrix, reserved);
  addWalletQrFormatBits(matrix, reserved);

  return matrix.map((row) => row.map(Boolean));
}

function addWalletQrFinder(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number
) {
  for (let row = -1; row <= 7; row += 1) {
    for (let col = -1; col <= 7; col += 1) {
      const nextX = x + col;
      const nextY = y + row;
      if (!walletQrInBounds(matrix, nextX, nextY)) continue;

      const filled =
        (row >= 0 && row <= 6 && (col === 0 || col === 6)) ||
        (col >= 0 && col <= 6 && (row === 0 || row === 6)) ||
        (row >= 2 && row <= 4 && col >= 2 && col <= 4);
      setWalletQrFunctionModule(matrix, reserved, nextX, nextY, filled);
    }
  }
}

function addWalletQrTiming(matrix: (boolean | null)[][], reserved: boolean[][]) {
  for (let index = 8; index < matrix.length - 8; index += 1) {
    const filled = index % 2 === 0;
    setWalletQrFunctionModule(matrix, reserved, index, 6, filled);
    setWalletQrFunctionModule(matrix, reserved, 6, index, filled);
  }
}

function addWalletQrAlignment(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  centerX: number,
  centerY: number
) {
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const filled = Math.max(Math.abs(row), Math.abs(col)) !== 1;
      setWalletQrFunctionModule(matrix, reserved, centerX + col, centerY + row, filled);
    }
  }
}

function reserveWalletQrFormat(matrix: (boolean | null)[][], reserved: boolean[][]) {
  const size = matrix.length;
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      reserveWalletQrModule(matrix, reserved, 8, index);
      reserveWalletQrModule(matrix, reserved, index, 8);
    }
  }
  for (let index = size - 8; index < size; index += 1) {
    reserveWalletQrModule(matrix, reserved, 8, index);
    reserveWalletQrModule(matrix, reserved, index, 8);
  }
}

function addWalletQrFormatBits(matrix: (boolean | null)[][], reserved: boolean[][]) {
  const size = matrix.length;
  const bits = "111011111000100".split("").map((bit) => bit === "1");

  for (let index = 0; index <= 5; index += 1) {
    setWalletQrFunctionModule(matrix, reserved, index, 8, bits[index]);
  }
  setWalletQrFunctionModule(matrix, reserved, 7, 8, bits[6]);
  setWalletQrFunctionModule(matrix, reserved, 8, 8, bits[7]);
  setWalletQrFunctionModule(matrix, reserved, 8, 7, bits[8]);
  for (let index = 9; index < 15; index += 1) {
    setWalletQrFunctionModule(matrix, reserved, 8, 14 - index, bits[index]);
  }

  for (let index = 0; index < 8; index += 1) {
    setWalletQrFunctionModule(matrix, reserved, size - 1 - index, 8, bits[index]);
  }
  for (let index = 8; index < 15; index += 1) {
    setWalletQrFunctionModule(matrix, reserved, 8, size - 15 + index, bits[index]);
  }
}

function setWalletQrFunctionModule(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number,
  filled: boolean
) {
  if (!walletQrInBounds(matrix, x, y)) return;

  matrix[y][x] = filled;
  reserved[y][x] = true;
}

function reserveWalletQrModule(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number
) {
  if (!walletQrInBounds(matrix, x, y)) return;

  reserved[y][x] = true;
}

function walletQrInBounds(matrix: unknown[][], x: number, y: number) {
  return y >= 0 && y < matrix.length && x >= 0 && x < matrix.length;
}

function buildWalletQrDataCodewords(value: string, capacity: number) {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > capacity - 2) {
    throw new Error("Wallet pass URL is too long for the QR generator.");
  }

  const bits = [
    false,
    true,
    false,
    false,
    ...walletQrByteToBits(bytes.length),
    ...bytes.flatMap((byte) => walletQrByteToBits(byte)),
  ];
  const maxBits = capacity * 8;
  const terminatorLength = Math.min(4, maxBits - bits.length);
  for (let index = 0; index < terminatorLength; index += 1) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(walletQrBitsToByte(bits.slice(index, index + 8)));
  }
  for (let pad = 0xec; codewords.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) {
    codewords.push(pad);
  }
  return codewords;
}

function placeWalletQrDataBits(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  bits: boolean[]
) {
  const size = matrix.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        matrix[row][col] = bits[bitIndex] || false;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function applyWalletQrMask0(matrix: (boolean | null)[][], reserved: boolean[][]) {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!reserved[row][col] && (row + col) % 2 === 0) {
        matrix[row][col] = !matrix[row][col];
      }
    }
  }
}

function walletQrReedSolomonRemainder(data: number[], degree: number) {
  const generator = walletQrReedSolomonGenerator(degree);
  const result = Array.from({ length: degree }, () => 0);

  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= walletQrGfMultiply(coefficient, factor);
    });
  }

  return result;
}

function walletQrReedSolomonGenerator(degree: number) {
  let result = [1];
  for (let index = 0; index < degree; index += 1) {
    result = walletQrPolynomialMultiply(result, [1, walletQrGfPow(2, index)]);
  }
  return result.slice(1);
}

function walletQrPolynomialMultiply(left: number[], right: number[]) {
  const result = Array.from({ length: left.length + right.length - 1 }, () => 0);
  left.forEach((leftValue, leftIndex) => {
    right.forEach((rightValue, rightIndex) => {
      result[leftIndex + rightIndex] ^= walletQrGfMultiply(leftValue, rightValue);
    });
  });
  return result;
}

function walletQrGfPow(value: number, power: number) {
  let result = 1;
  for (let index = 0; index < power; index += 1) {
    result = walletQrGfMultiply(result, value);
  }
  return result;
}

function walletQrGfMultiply(left: number, right: number) {
  let result = 0;
  let a = left;
  let b = right;
  while (b > 0) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return result;
}

function walletQrByteToBits(byte: number) {
  return Array.from({ length: 8 }, (_, index) => Boolean(byte & (1 << (7 - index))));
}

function walletQrBitsToByte(bits: boolean[]) {
  return bits.reduce((value, bit) => (value << 1) | (bit ? 1 : 0), 0);
}

function isAppleWalletNativeBrowser() {
  const userAgent = navigator.userAgent;
  const isAppleDevice = /Macintosh|iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|Edg/i.test(userAgent);

  return isAppleDevice && isSafari;
}

function safeHexColor(color: string) {
  const value = color.trim();

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : "";
}

function labelColourForWalletPass(backgroundColor: string, textColor: string) {
  const whiteLabel = "#D1D5DB";
  const darkLabel = "#4B5563";

  if (colourContrastRatio(backgroundColor, whiteLabel) >= minimumWalletContrastRatio) {
    return whiteLabel;
  }

  if (colourContrastRatio(backgroundColor, darkLabel) >= minimumWalletContrastRatio) {
    return darkLabel;
  }

  return textColor;
}

function colourContrastRatio(firstColour: string, secondColour: string) {
  const firstLuminance = relativeLuminance(firstColour);
  const secondLuminance = relativeLuminance(secondColour);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(colour: string) {
  const safeColour = safeHexColor(colour) || "#000000";
  const red = parseInt(safeColour.slice(1, 3), 16) / 255;
  const green = parseInt(safeColour.slice(3, 5), 16) / 255;
  const blue = parseInt(safeColour.slice(5, 7), 16) / 255;
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );

  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}
