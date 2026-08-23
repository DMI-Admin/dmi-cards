"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Lock,
  Palette,
  Printer,
  QrCode,
  Sparkles,
} from "lucide-react";
import CardRenderer, {
  type CardRendererTemplate,
} from "@/components/CardRenderer";
import ClientSidebar from "@/components/ClientSidebar";
import UpgradeToProButton from "@/components/UpgradeToProButton";
import { supabase } from "@/lib/supabase";
import { ClientAuthRequiredError, getCurrentUser } from "@/lib/client-auth";
import { useClientPlan } from "@/lib/use-client-plan";
import { getClientVisibleTemplates } from "@/lib/templates";
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
  type CardTemplate,
  type CardFieldOrder,
  type ClientCardPlan,
  type SharedClientCard,
  type SupabaseCardRow,
} from "@/lib/services/card-payload";

const publicSiteOrigin = "https://dmi-cards.vercel.app";

const qrSafeColours = [
  { name: "Purple", value: "#AC00FF" },
  { name: "Blue", value: "#2563EB" },
  { name: "Green", value: "#059669" },
  { name: "Red", value: "#EF4444" },
  { name: "Black", value: "#0F172A" },
];
const defaultQrColour = "#0F172A";
const qrColourStorageKey = "dmi-cards-qr-colour";
const qrStyleOptions = ["Classic", "Rounded", "Dots", "Modern", "Minimal"] as const;
const qrSlots = [1, 2, 3] as const;
const qrQuietZone = 4;
const qrLogoBackingRatio = 0.18;
const qrLogoImageRatio = 0.12;
type QrStyle = (typeof qrStyleOptions)[number];
type QrSlot = (typeof qrSlots)[number];
type QrLogo = {
  dataUrl: string;
  name: string;
  type: string;
};

type SavedQrCard = {
  id: string;
  card_slot: QrSlot;
  slug: string;
  name: string;
  public_path: string;
  public_url: string;
  status: string;
  cardData: SharedClientCard;
  template: CardRendererTemplate | null;
};

export default function ClientQrCodePage() {
  const { isPaid, plan } = useClientPlan();
  const [publishedCards, setPublishedCards] = useState<SavedQrCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [loadingCard, setLoadingCard] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [selectedColour, setSelectedColour] = useState(() =>
    getInitialQrColour()
  );
  const [selectedStyle, setSelectedStyle] = useState<QrStyle>("Classic");
  const [qrLogo, setQrLogo] = useState<QrLogo | null>(null);
  const [previewFlipped, setPreviewFlipped] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const currentPlan = (plan || "free") as ClientCardPlan;
  const selectedCard = useMemo(
    () =>
      publishedCards.find((card) => card.id === selectedCardId) ||
      publishedCards[0] ||
      null,
    [publishedCards, selectedCardId]
  );
  const qrMatrix = useMemo(
    () => (selectedCard ? createQrMatrix(selectedCard.public_url) : []),
    [selectedCard]
  );
  const qrStyles: QrStyle[] = isPaid ? [...qrStyleOptions] : ["Classic"];
  const effectiveQrStyle: QrStyle = isPaid ? selectedStyle : "Classic";

  useEffect(() => {
    let ignore = false;

    async function loadSavedCard() {
      setLoadingCard(true);

      try {
        const user = await getCurrentUser();

        if (!user) {
          throw new ClientAuthRequiredError();
        }

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
          if (error) console.error("QR card fetch failed", error);
          setPublishedCards([]);
          setSelectedCardId("");
          return;
        }

        const nextCards = (data || [])
          .map((row) =>
            toSavedQrCard(
              row as SupabaseCardRow,
              templates,
              currentPlan,
              defaultTemplate
            )
          )
          .filter((card): card is SavedQrCard => Boolean(card));

        setPublishedCards(nextCards);
        setSelectedCardId((currentSelectedCardId) => {
          if (nextCards.some((card) => card.id === currentSelectedCardId)) {
            return currentSelectedCardId;
          }

          return nextCards[0]?.id || "";
        });
      } catch (error) {
        if (!(error instanceof ClientAuthRequiredError)) {
          console.error("QR card load failed", error);
        }
        if (!ignore) {
          setPublishedCards([]);
          setSelectedCardId("");
        }
      } finally {
        if (!ignore) setLoadingCard(false);
      }
    }

    void loadSavedCard();

    return () => {
      ignore = true;
    };
  }, [currentPlan]);

  async function copyPublicLink() {
    if (!selectedCard) return;

    await navigator.clipboard?.writeText(selectedCard.public_url);
    setActionMessage("Public link copied.");
  }

  function selectQrColour(colour: string) {
    const nextColour = normaliseHexColour(colour);

    if (!nextColour) return;

    if (!isReliableQrColour(nextColour)) {
      setActionMessage("Choose a darker QR colour for reliable scanning.");
      return;
    }

    setSelectedColour(nextColour);
    window.localStorage.setItem(qrColourStorageKey, nextColour);
    setActionMessage("");
  }

  function resetQrColour() {
    setSelectedColour(defaultQrColour);
    window.localStorage.setItem(qrColourStorageKey, defaultQrColour);
    setActionMessage("");
  }

  function selectQrStyle(style: QrStyle) {
    setSelectedStyle(style);
    setActionMessage("");
  }

  function viewPublicPage() {
    if (!selectedCard) return;

    window.open(selectedCard.public_url, "_blank", "noopener,noreferrer");
  }

  function selectCard(cardId: string) {
    setSelectedCardId(cardId);
    setActionMessage("");
    setPreviewFlipped(false);
  }

  async function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setActionMessage("Upload a PNG or JPG logo for now.");
      event.target.value = "";
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setQrLogo({ dataUrl, name: file.name, type: file.type });
    setActionMessage("Logo added to QR preview.");
    event.target.value = "";
  }

  function removeLogo() {
    setQrLogo(null);
    setActionMessage("Logo removed.");
  }

  async function downloadPng() {
    if (!selectedCard || qrMatrix.length === 0) return;

    const canvas = document.createElement("canvas");
    await drawQrToCanvas(
      canvas,
      qrMatrix,
      960,
      selectedColour,
      effectiveQrStyle,
      qrLogo
    );
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `dmi-card-qr-${slugifyFilename(selectedCard.slug)}.png`;
    link.click();
    setActionMessage("QR code PNG downloaded.");
  }

  function downloadSvg() {
    if (!selectedCard || qrMatrix.length === 0 || !isPaid) return;

    const svg = buildQrSvgMarkup(
      qrMatrix,
      selectedColour,
      effectiveQrStyle,
      qrLogo
    );
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `dmi-card-qr-${slugifyFilename(selectedCard.slug)}.svg`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    setActionMessage("QR code SVG downloaded.");
  }

  async function printQr() {
    if (!selectedCard || qrMatrix.length === 0) return;

    const canvas = document.createElement("canvas");
    await drawQrToCanvas(
      canvas,
      qrMatrix,
      720,
      selectedColour,
      effectiveQrStyle,
      qrLogo
    );
    const imageUrl = canvas.toDataURL("image/png");
    const printWindow = window.open("", "_blank", "noopener,noreferrer");

    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>DMI Cards QR Code</title>
          <style>
            body {
              align-items: center;
              color: #0f172a;
              display: flex;
              font-family: Arial, sans-serif;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
            }
            main { text-align: center; }
            img { width: 320px; height: 320px; }
            p { color: #475569; font-size: 14px; margin-top: 16px; }
          </style>
        </head>
        <body>
          <main>
            <img src="${imageUrl}" alt="DMI Cards QR code" />
            <p>${selectedCard.public_url}</p>
          </main>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  return (
    <main className="flex min-h-screen bg-[#070B1A] text-white">
      <ClientSidebar />

      <section className="flex-1 p-10">
        <div className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-4xl font-bold">QR Code</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Create and download a QR code for your public digital business
              card.
            </p>
          </div>
        </div>

        {loadingCard ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-white/50">
            Loading your published card...
          </div>
        ) : (
          <>
            {!isPaid && (
            <div className="mb-6 rounded-3xl border border-[#AC00FF]/25 bg-[#AC00FF]/10 p-5 shadow-lg shadow-purple-950/15">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-purple-100">
                Upgrade to Individual Pro
              </p>
              <p className="mt-1 text-sm text-white/55">
                Upgrade to Individual Pro for custom QR styles, logo QR codes,
                SVG downloads, and scan analytics.
              </p>
            </div>
            <UpgradeToProButton
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35 md:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              View Upgrade
            </UpgradeToProButton>
          </div>
            </div>
            )}

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
                  <SectionTitle
                    title="QR Settings"
                    description="Choose the card, style, colour, and logo."
                  />

                  <div className="mt-6 space-y-6">
                    <SettingsBlock title="Select Card">
                      <CardSelector
                        cards={publishedCards}
                        selectedCardId={selectedCard?.id || ""}
                        onSelect={selectCard}
                      />
                    </SettingsBlock>

                    <SettingsBlock title="QR Style">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        {qrStyles.map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => selectQrStyle(style)}
                            className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition ${
                              effectiveQrStyle === style
                                ? "border-[#AC00FF] bg-[#AC00FF]/20 text-white shadow-lg shadow-purple-500/20 ring-2 ring-[#AC00FF]/45"
                                : "border-white/10 bg-white/5 text-white/60 hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10 hover:text-white"
                            }`}
                            aria-pressed={effectiveQrStyle === style}
                          >
                            <span className="inline-flex items-center gap-2">
                              {effectiveQrStyle === style && (
                                <Check className="h-4 w-4" />
                              )}
                              {style}
                            </span>
                          </button>
                        ))}
                      </div>

                      {!isPaid && (
                        <LockedMessage>
                          Rounded, dots, modern, and minimal styles unlock with
                          Individual Pro.
                        </LockedMessage>
                      )}
                    </SettingsBlock>

                    <SettingsBlock title="QR Colour">
                      <QrColourPicker
                        selectedColour={selectedColour}
                        onSelectColour={selectQrColour}
                        onReset={resetQrColour}
                      />
                    </SettingsBlock>

                    <SettingsBlock title="Logo in QR">
                      <QrLogoPicker
                        isPaid={isPaid}
                        logo={qrLogo}
                        inputRef={logoInputRef}
                        onLogoUpload={handleLogoUpload}
                        onRemoveLogo={removeLogo}
                      />
                    </SettingsBlock>
                  </div>
                </section>
              </div>

              <aside className="xl:sticky xl:top-8 xl:self-start">
                <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
                  <SectionTitle
                    title="Live QR Preview"
                    description="Preview the QR code clients will scan."
                  />

                  {selectedCard ? (
                    <QrPreviewFlipPanel
                      actionMessage={actionMessage}
                      card={selectedCard}
                      colour={selectedColour}
                      flipped={previewFlipped}
                      isPaid={isPaid}
                      logo={qrLogo}
                      matrix={qrMatrix}
                      onBack={() => setPreviewFlipped(false)}
                      onCopy={copyPublicLink}
                      onDownloadPng={downloadPng}
                      onDownloadSvg={downloadSvg}
                      onFlip={() => setPreviewFlipped(true)}
                      onPrint={printQr}
                      onView={viewPublicPage}
                      style={effectiveQrStyle}
                    />
                  ) : (
                    <div className="mt-6">
                      <EmptyQrState />
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}


function CardSelector({
  cards,
  selectedCardId,
  onSelect,
}: {
  cards: SavedQrCard[];
  selectedCardId: string;
  onSelect: (cardId: string) => void;
}) {
  const cardsBySlot = new Map(cards.map((card) => [card.card_slot, card]));

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {qrSlots.map((slot) => {
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
              <p className="text-xs text-white/35">Publish a card in this slot to create its QR code.</p>
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
                Slot {card.card_slot}
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

function QrColourPicker({
  selectedColour,
  onSelectColour,
  onReset,
}: {
  selectedColour: string;
  onSelectColour: (colour: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#AC00FF]/15">
            <Palette className="h-5 w-5 text-purple-100" />
          </span>
          <div>
            <p className="font-semibold">Foreground colour</p>
            <p className="mt-1 font-mono text-sm text-white/60">
              {selectedColour}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="h-11 w-11 rounded-xl border border-white/15"
            style={{ backgroundColor: selectedColour }}
            aria-hidden="true"
          />
          <select
            value={selectedColour}
            onChange={(event) => onSelectColour(event.target.value)}
            className="min-h-11 rounded-xl border border-white/10 bg-[#101935] px-4 text-sm font-semibold text-white outline-none transition hover:border-[#AC00FF]/45 focus:border-[#AC00FF] focus:ring-2 focus:ring-[#AC00FF]/30"
            aria-label="Choose QR-safe foreground colour"
          >
            {qrSafeColours.map((colour) => (
              <option key={colour.value} value={colour.value}>
                {colour.name} · {colour.value}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:border-[#AC00FF]/45 hover:bg-[#AC00FF]/10"
          >
            Reset to default
          </button>
        </div>
      </div>
      <p className="mt-4 text-sm text-white/45">
        Choose from QR-safe foreground colours. White background is fixed for
        scan reliability.
      </p>
    </div>
  );
}

function QrLogoPicker({
  isPaid,
  logo,
  inputRef,
  onLogoUpload,
  onRemoveLogo,
}: {
  isPaid: boolean;
  logo: QrLogo | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onLogoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
}) {
  if (!isPaid) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
            <Lock className="h-5 w-5 text-white/50" />
          </div>
          <div>
            <p className="font-semibold">
              Upgrade to Individual Pro to add your logo to QR codes.
            </p>
            <p className="mt-1 text-sm text-white/45">
              Logo QR codes help clients recognise your brand at a glance.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={onLogoUpload}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.dataUrl}
                alt=""
                className="h-full w-full object-contain p-2"
              />
            ) : (
              <ImagePlus className="h-6 w-6 text-slate-500" />
            )}
          </span>
          <span>
            <span className="block font-semibold">
              {logo ? logo.name : "Add centre logo"}
            </span>
            <span className="mt-1 block text-sm text-white/45">
              PNG or JPG, embedded with a white backing area.
            </span>
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#AC00FF]/40 bg-[#AC00FF]/15 px-4 text-sm font-semibold text-white transition hover:border-[#AC00FF]/70 hover:bg-[#AC00FF]/20"
          >
            {logo ? "Replace logo" : "Upload logo"}
          </button>
          {logo && (
            <button
              type="button"
              onClick={onRemoveLogo}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
            >
              Remove logo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QrPreviewFlipPanel({
  actionMessage,
  card,
  colour,
  flipped,
  isPaid,
  logo,
  matrix,
  onBack,
  onCopy,
  onDownloadPng,
  onDownloadSvg,
  onFlip,
  onPrint,
  onView,
  style,
}: {
  actionMessage: string;
  card: SavedQrCard;
  colour: string;
  flipped: boolean;
  isPaid: boolean;
  logo: QrLogo | null;
  matrix: boolean[][];
  onBack: () => void;
  onCopy: () => void;
  onDownloadPng: () => void;
  onDownloadSvg: () => void;
  onFlip: () => void;
  onPrint: () => void;
  onView: () => void;
  style: QrStyle;
}) {
  return (
    <div className="mt-6 h-[560px]" style={{ perspective: "1200px" }}>
      <div
        className="relative h-full w-full transform-gpu transition-transform duration-[420ms] motion-reduce:transition-none"
        style={{
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transformStyle: "preserve-3d",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <div
            className="flex h-full flex-col justify-between rounded-[2rem] border border-[#AC00FF]/25 p-3 shadow-inner shadow-white/5 sm:p-6"
            style={{
              background:
                "linear-gradient(135deg, #1B1241 0%, #101935 54%, #070B1A 100%)",
            }}
          >
            <div className="rounded-3xl bg-white p-4 text-[#0F172A] shadow-2xl shadow-purple-950/30 sm:p-5">
              <QrPreview
                matrix={matrix}
                colour={colour}
                style={style}
                logo={logo}
              />
              <div className="mt-5 text-center text-[#0F172A]">
                <p
                  className="text-sm font-semibold"
                  style={{ color: "#0F172A", opacity: 1 }}
                >
                  {card.name}
                </p>
                <p
                  className="mt-1 text-sm font-medium"
                  style={{ color: "#0F172A", opacity: 1 }}
                >
                  Scan to open this published card
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onFlip}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
            >
              <Download className="h-4 w-4" />
              Download & Share
            </button>
            <StatusMessage message={actionMessage} />
          </div>
        </div>
        <div
          className="absolute inset-0"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <div className="flex h-full flex-col rounded-[2rem] border border-[#AC00FF]/25 bg-[#101935] p-5 shadow-2xl shadow-purple-950/25 sm:p-6">
            <div>
              <p className="text-lg font-semibold">{card.name}</p>
              <p className="mt-1 text-sm text-white/45">
                QR actions for Slot {card.card_slot}
              </p>
            </div>
            <div className="mt-6 grid gap-3">
              <ActionButton icon={Copy} onClick={onCopy}>
                Copy Public Link
              </ActionButton>
              <ActionButton icon={ExternalLink} onClick={onView}>
                View Public Page
              </ActionButton>
              <ActionButton icon={Download} onClick={onDownloadPng}>
                Download PNG
              </ActionButton>
              <button
                type="button"
                disabled={!isPaid}
                onClick={onDownloadSvg}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/45 transition enabled:text-white enabled:hover:border-[#AC00FF]/50 enabled:hover:bg-[#AC00FF]/15 disabled:cursor-not-allowed"
              >
                {isPaid ? (
                  <Download className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                Download SVG
              </button>
              <ActionButton icon={Printer} onClick={onPrint}>
                Print QR
              </ActionButton>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="mt-auto inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
            >
              Back to Preview
            </button>
            <StatusMessage message={actionMessage} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  if (!message) return null;

  return (
    <p
      className="mt-4 rounded-2xl border px-4 py-3 text-center text-sm font-semibold shadow-lg shadow-emerald-950/20"
      style={{
        backgroundColor: "#047857",
        borderColor: "rgba(16, 185, 129, 0.78)",
        color: "#ffffff",
        opacity: 1,
      }}
    >
      {message}
    </p>
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
  children: React.ReactNode;
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

function LockedMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
      <p>{children}</p>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon: typeof QrCode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:shadow-lg hover:shadow-purple-500/10 sm:w-auto"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function EmptyQrState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl shadow-black/20 sm:p-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#AC00FF]/15 text-purple-100">
        <QrCode className="h-7 w-7" />
      </div>
      <h2 className="mt-6 text-2xl font-semibold">Publish a card first to generate your QR code.</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/50">
        Your free QR code is created from your published public card URL. Once
        your first card is published, this page will show copy, download, and
        print tools.
      </p>
      <a
        href="/client/cards"
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35 sm:w-auto"
      >
        <ExternalLink className="h-4 w-4" />
        Create or Publish Card
      </a>
    </div>
  );
}

function QrPreview({
  matrix,
  colour,
  style,
  logo,
}: {
  matrix: boolean[][];
  colour: string;
  style: QrStyle;
  logo: QrLogo | null;
}) {
  const moduleCount = matrix.length + qrQuietZone * 2;

  return (
    <svg
      className="mx-auto aspect-square w-full max-w-[280px] rounded-3xl bg-white"
      viewBox={`0 0 ${moduleCount} ${moduleCount}`}
      role="img"
      aria-label="QR code preview"
      shapeRendering={style === "Classic" ? "crispEdges" : "geometricPrecision"}
    >
      <rect width={moduleCount} height={moduleCount} fill="#ffffff" />
      {matrix.flatMap((row, rowIndex) =>
        row.map((filled, colIndex) => {
          if (!filled) return null;

          return (
            <QrSvgModule
              key={`${rowIndex}-${colIndex}`}
              col={colIndex}
              row={rowIndex}
              size={matrix.length}
              colour={colour}
              style={style}
            />
          );
        })
      )}
      {logo && <QrLogoSvg logo={logo} moduleCount={moduleCount} />}
    </svg>
  );
}

function QrLogoSvg({
  logo,
  moduleCount,
}: {
  logo: QrLogo;
  moduleCount: number;
}) {
  const backingSize = moduleCount * qrLogoBackingRatio;
  const logoSize = moduleCount * qrLogoImageRatio;
  const backingOffset = (moduleCount - backingSize) / 2;
  const logoOffset = (moduleCount - logoSize) / 2;

  return (
    <>
      <rect
        x={backingOffset}
        y={backingOffset}
        width={backingSize}
        height={backingSize}
        rx={1.2}
        fill="#ffffff"
      />
      <image
        href={logo.dataUrl}
        x={logoOffset}
        y={logoOffset}
        width={logoSize}
        height={logoSize}
        preserveAspectRatio="xMidYMid meet"
      />
    </>
  );
}

function QrSvgModule({
  col,
  row,
  size,
  colour,
  style,
}: {
  col: number;
  row: number;
  size: number;
  colour: string;
  style: QrStyle;
}) {
  const x = col + qrQuietZone;
  const y = row + qrQuietZone;
  const finder = isFinderModule(size, row, col);
  const shape = qrModuleShape(style, finder);

  if (shape.kind === "circle") {
    return <circle cx={x + 0.5} cy={y + 0.5} r={shape.radius} fill={colour} />;
  }

  return (
    <rect
      x={x + shape.inset}
      y={y + shape.inset}
      width={1 - shape.inset * 2}
      height={1 - shape.inset * 2}
      rx={shape.radius}
      ry={shape.radius}
      fill={colour}
    />
  );
}

function toSavedQrCard(
  row: SupabaseCardRow,
  templates: CardTemplate[],
  plan: ClientCardPlan,
  defaultTemplate: CardTemplate | null
): SavedQrCard | null {
  const id = row.id || "";
  const slug = row.slug?.trim() || "";
  const cardSlot = normalizeCardSlot(row.card_slot);

  if (!id || !slug || !cardSlot) return null;

  const cardData = mapSupabaseCard(row, templates, plan);
  const cardTemplate = templateForCard(cardData, templates, plan) || defaultTemplate;
  const previewTemplate = buildQrCardPreviewTemplate(cardTemplate, cardData);

  return {
    id,
    card_slot: cardSlot,
    slug,
    name: cardData.card_name || "Primary Digital Card",
    public_path: `/u/${slug}`,
    public_url: `${publicSiteOrigin}/u/${slug}`,
    status: row.is_published ? "published" : row.status || "draft",
    cardData,
    template: previewTemplate,
  };
}

function buildQrCardPreviewTemplate(
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

function normalizeCardSlot(value: number | null | undefined): QrSlot | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function createQrMatrix(value: string) {
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

  addFinder(matrix, reserved, 0, 0);
  addFinder(matrix, reserved, size - 7, 0);
  addFinder(matrix, reserved, 0, size - 7);
  addTiming(matrix, reserved);
  addAlignment(matrix, reserved, 30, 30);
  reserveFormat(matrix, reserved);
  setFunctionModule(matrix, reserved, 8, size - 8, true);

  const data = buildQrDataCodewords(value, dataCodewords);
  const ecc = reedSolomonRemainder(data, errorCodewords);
  const bits = [...data, ...ecc].flatMap((codeword) =>
    byteToBits(codeword)
  );

  for (let index = 0; index < remainderBits; index += 1) bits.push(false);

  placeDataBits(matrix, reserved, bits);
  applyMask0(matrix, reserved);
  addFormatBits(matrix, reserved);

  return matrix.map((row) => row.map(Boolean));
}

function addFinder(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number
) {
  for (let row = -1; row <= 7; row += 1) {
    for (let col = -1; col <= 7; col += 1) {
      const nextX = x + col;
      const nextY = y + row;
      if (!inBounds(matrix, nextX, nextY)) continue;

      const filled =
        (row >= 0 && row <= 6 && (col === 0 || col === 6)) ||
        (col >= 0 && col <= 6 && (row === 0 || row === 6)) ||
        (row >= 2 && row <= 4 && col >= 2 && col <= 4);
      setFunctionModule(matrix, reserved, nextX, nextY, filled);
    }
  }
}

function addTiming(matrix: (boolean | null)[][], reserved: boolean[][]) {
  for (let index = 8; index < matrix.length - 8; index += 1) {
    const filled = index % 2 === 0;
    setFunctionModule(matrix, reserved, index, 6, filled);
    setFunctionModule(matrix, reserved, 6, index, filled);
  }
}

function addAlignment(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  centerX: number,
  centerY: number
) {
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const filled = Math.max(Math.abs(row), Math.abs(col)) !== 1;
      setFunctionModule(matrix, reserved, centerX + col, centerY + row, filled);
    }
  }
}

function reserveFormat(matrix: (boolean | null)[][], reserved: boolean[][]) {
  const size = matrix.length;
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      reserveModule(matrix, reserved, 8, index);
      reserveModule(matrix, reserved, index, 8);
    }
  }
  for (let index = size - 8; index < size; index += 1) {
    reserveModule(matrix, reserved, 8, index);
    reserveModule(matrix, reserved, index, 8);
  }
}

function addFormatBits(matrix: (boolean | null)[][], reserved: boolean[][]) {
  const size = matrix.length;
  const bits = "111011111000100".split("").map((bit) => bit === "1");

  for (let index = 0; index <= 5; index += 1) setFunctionModule(matrix, reserved, index, 8, bits[index]);
  setFunctionModule(matrix, reserved, 7, 8, bits[6]);
  setFunctionModule(matrix, reserved, 8, 8, bits[7]);
  setFunctionModule(matrix, reserved, 8, 7, bits[8]);
  for (let index = 9; index < 15; index += 1) setFunctionModule(matrix, reserved, 8, 14 - index, bits[index]);

  for (let index = 0; index < 8; index += 1) setFunctionModule(matrix, reserved, size - 1 - index, 8, bits[index]);
  for (let index = 8; index < 15; index += 1) setFunctionModule(matrix, reserved, 8, size - 15 + index, bits[index]);
}

function setFunctionModule(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number,
  filled: boolean
) {
  if (!inBounds(matrix, x, y)) return;
  matrix[y][x] = filled;
  reserved[y][x] = true;
}

function reserveModule(
  matrix: (boolean | null)[][],
  reserved: boolean[][],
  x: number,
  y: number
) {
  if (!inBounds(matrix, x, y)) return;
  reserved[y][x] = true;
}

function inBounds(matrix: unknown[][], x: number, y: number) {
  return y >= 0 && y < matrix.length && x >= 0 && x < matrix.length;
}

function buildQrDataCodewords(value: string, capacity: number) {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > capacity - 2) {
    throw new Error("QR URL is too long for the free QR generator.");
  }

  const bits = [
    false,
    true,
    false,
    false,
    ...byteToBits(bytes.length),
    ...bytes.flatMap((byte) => byteToBits(byte)),
  ];
  const maxBits = capacity * 8;
  const terminatorLength = Math.min(4, maxBits - bits.length);
  for (let index = 0; index < terminatorLength; index += 1) bits.push(false);
  while (bits.length % 8 !== 0) bits.push(false);

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(bitsToByte(bits.slice(index, index + 8)));
  }
  for (let pad = 0xec; codewords.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) {
    codewords.push(pad);
  }
  return codewords;
}

function placeDataBits(
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

function applyMask0(matrix: (boolean | null)[][], reserved: boolean[][]) {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!reserved[row][col] && (row + col) % 2 === 0) {
        matrix[row][col] = !matrix[row][col];
      }
    }
  }
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const result = Array.from({ length: degree }, () => 0);

  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }

  return result;
}

function reedSolomonGenerator(degree: number) {
  let result = [1];
  for (let index = 0; index < degree; index += 1) {
    result = polynomialMultiply(result, [1, gfPow(2, index)]);
  }
  return result.slice(1);
}

function polynomialMultiply(left: number[], right: number[]) {
  const result = Array.from({ length: left.length + right.length - 1 }, () => 0);
  left.forEach((leftValue, leftIndex) => {
    right.forEach((rightValue, rightIndex) => {
      result[leftIndex + rightIndex] ^= gfMultiply(leftValue, rightValue);
    });
  });
  return result;
}

function gfPow(value: number, power: number) {
  let result = 1;
  for (let index = 0; index < power; index += 1) {
    result = gfMultiply(result, value);
  }
  return result;
}

function gfMultiply(left: number, right: number) {
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

function byteToBits(byte: number) {
  return Array.from({ length: 8 }, (_, index) => Boolean(byte & (1 << (7 - index))));
}

function bitsToByte(bits: boolean[]) {
  return bits.reduce((value, bit) => (value << 1) | (bit ? 1 : 0), 0);
}

async function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  matrix: boolean[][],
  size: number,
  colour: string,
  style: QrStyle,
  logo: QrLogo | null
) {
  const moduleCount = matrix.length + qrQuietZone * 2;
  const scale = Math.floor(size / moduleCount);
  const canvasSize = scale * moduleCount;
  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasSize, canvasSize);
  context.fillStyle = colour;
  matrix.forEach((row, rowIndex) => {
    row.forEach((filled, colIndex) => {
      if (!filled) return;
      drawCanvasQrModule(
        context,
        (colIndex + qrQuietZone) * scale,
        (rowIndex + qrQuietZone) * scale,
        scale,
        style,
        isFinderModule(matrix.length, rowIndex, colIndex)
      );
    });
  });

  if (logo) {
    await drawLogoToCanvas(context, logo, canvasSize);
  }
}

function buildQrSvgMarkup(
  matrix: boolean[][],
  colour: string,
  style: QrStyle,
  logo: QrLogo | null
) {
  const moduleCount = matrix.length + qrQuietZone * 2;
  const modules = matrix
    .flatMap((row, rowIndex) =>
      row.map((filled, colIndex) => {
        if (!filled) return "";

        return qrSvgModuleMarkup(
          colIndex,
          rowIndex,
          matrix.length,
          safeSvgColour(colour),
          style
        );
      })
    )
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${moduleCount} ${moduleCount}" role="img" aria-label="DMI Cards QR code" shape-rendering="${
      style === "Classic" ? "crispEdges" : "geometricPrecision"
    }">`,
    `<rect width="${moduleCount}" height="${moduleCount}" fill="#ffffff"/>`,
    modules,
    logo ? qrLogoSvgMarkup(logo, moduleCount) : "",
    "</svg>",
  ].join("");
}

function qrLogoSvgMarkup(logo: QrLogo, moduleCount: number) {
  const backingSize = moduleCount * qrLogoBackingRatio;
  const logoSize = moduleCount * qrLogoImageRatio;
  const backingOffset = (moduleCount - backingSize) / 2;
  const logoOffset = (moduleCount - logoSize) / 2;

  return [
    `<rect x="${backingOffset}" y="${backingOffset}" width="${backingSize}" height="${backingSize}" rx="1.2" fill="#ffffff"/>`,
    `<image href="${escapeSvgAttribute(logo.dataUrl)}" x="${logoOffset}" y="${logoOffset}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`,
  ].join("");
}

function qrSvgModuleMarkup(
  col: number,
  row: number,
  size: number,
  colour: string,
  style: QrStyle
) {
  const x = col + qrQuietZone;
  const y = row + qrQuietZone;
  const shape = qrModuleShape(style, isFinderModule(size, row, col));

  if (shape.kind === "circle") {
    return `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="${shape.radius}" fill="${colour}"/>`;
  }

  return `<rect x="${x + shape.inset}" y="${y + shape.inset}" width="${
    1 - shape.inset * 2
  }" height="${1 - shape.inset * 2}" rx="${shape.radius}" ry="${
    shape.radius
  }" fill="${colour}"/>`;
}

function drawCanvasQrModule(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  style: QrStyle,
  finder: boolean
) {
  const shape = qrModuleShape(style, finder);
  const inset = shape.inset * scale;
  const moduleSize = scale - inset * 2;

  if (shape.kind === "circle") {
    context.beginPath();
    context.arc(x + scale / 2, y + scale / 2, shape.radius * scale, 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (shape.radius === 0) {
    context.fillRect(x + inset, y + inset, moduleSize, moduleSize);
    return;
  }

  drawRoundedRect(
    context,
    x + inset,
    y + inset,
    moduleSize,
    moduleSize,
    shape.radius * scale
  );
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const cornerRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + cornerRadius, y);
  context.lineTo(x + width - cornerRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  context.lineTo(x + width, y + height - cornerRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
  context.lineTo(x + cornerRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  context.lineTo(x, y + cornerRadius);
  context.quadraticCurveTo(x, y, x + cornerRadius, y);
  context.closePath();
  context.fill();
}

async function drawLogoToCanvas(
  context: CanvasRenderingContext2D,
  logo: QrLogo,
  canvasSize: number
) {
  const image = await loadImage(logo.dataUrl);
  const backingSize = canvasSize * qrLogoBackingRatio;
  const logoSize = canvasSize * qrLogoImageRatio;
  const backingOffset = (canvasSize - backingSize) / 2;
  const logoOffset = (canvasSize - logoSize) / 2;

  context.fillStyle = "#ffffff";
  drawRoundedRect(
    context,
    backingOffset,
    backingOffset,
    backingSize,
    backingSize,
    backingSize * 0.16
  );
  context.drawImage(image, logoOffset, logoOffset, logoSize, logoSize);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load QR logo."));
    image.src = src;
  });
}

function qrModuleShape(style: QrStyle, finder: boolean) {
  if (finder) {
    return { kind: "rect" as const, inset: 0, radius: style === "Modern" ? 0.08 : 0 };
  }

  switch (style) {
    case "Rounded":
      return { kind: "rect" as const, inset: 0.08, radius: 0.28 };
    case "Dots":
      return { kind: "circle" as const, inset: 0, radius: 0.42 };
    case "Modern":
      return { kind: "rect" as const, inset: 0.06, radius: 0.18 };
    case "Minimal":
      return { kind: "rect" as const, inset: 0.13, radius: 0.02 };
    case "Classic":
    default:
      return { kind: "rect" as const, inset: 0, radius: 0 };
  }
}

function isFinderModule(size: number, row: number, col: number) {
  return (
    (row <= 6 && col <= 6) ||
    (row <= 6 && col >= size - 7) ||
    (row >= size - 7 && col <= 6)
  );
}

function safeSvgColour(colour: string) {
  return /^#[0-9a-f]{6}$/i.test(colour) ? colour : defaultQrColour;
}

function escapeSvgAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read logo file."));
    reader.onload = () => resolve(String(reader.result || ""));

    reader.readAsDataURL(file);
  });
}

function normaliseHexColour(value: string) {
  const trimmedValue = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
    return trimmedValue.toUpperCase();
  }

  return null;
}

function isReliableQrColour(value: string) {
  const luminance = relativeLuminance(value);
  const contrastWithWhite = (1.05) / (luminance + 0.05);

  return contrastWithWhite >= 3;
}

function relativeLuminance(value: string) {
  const red = parseInt(value.slice(1, 3), 16) / 255;
  const green = parseInt(value.slice(3, 5), 16) / 255;
  const blue = parseInt(value.slice(5, 7), 16) / 255;
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );

  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}

function slugifyFilename(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
}

function getInitialQrColour() {
  if (typeof window === "undefined") return defaultQrColour;

  const savedColour = window.localStorage.getItem(qrColourStorageKey);
  const validSavedColour = qrSafeColours.some(
    (colour) => colour.value === savedColour
  );

  return validSavedColour && savedColour ? savedColour : defaultQrColour;
}
