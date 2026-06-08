"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
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
import ClientSidebar from "@/components/ClientSidebar";
import { supabase } from "@/lib/supabase";
import { ClientAuthRequiredError, requireClientUser } from "@/lib/client-auth";

const currentPlan = "free" as
  | "free"
  | "individual_pro"
  | "business"
  | "enterprise";
const isPaid = currentPlan !== "free";

const publicSiteOrigin = "https://dmi-cards.vercel.app";

type SavedQrCard = {
  slug: string;
  name: string;
  public_path: string;
  public_url: string;
  status: string;
};

const freeQrColours = [
  "#AC00FF",
  "#7C3AED",
  "#2563EB",
  "#059669",
  "#EF4444",
  "#0F172A",
];

const qrStyles = isPaid
  ? ["Classic", "Rounded", "Dots", "Modern", "Minimal"]
  : ["Classic"];

export default function ClientQrCodePage() {
  const [selectedCard, setSelectedCard] = useState<SavedQrCard | null>(null);
  const [loadingCard, setLoadingCard] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const qrMatrix = useMemo(
    () => (selectedCard ? createQrMatrix(selectedCard.public_url) : []),
    [selectedCard]
  );

  useEffect(() => {
    let ignore = false;

    async function loadSavedCard() {
      setLoadingCard(true);

      try {
        const { user } = await requireClientUser();

        const { data, error } = await supabase
          .from("cards")
          .select("card_name, slug, is_published, status")
          .eq("user_id", user.id)
          .or("status.eq.published,is_published.eq.true")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ignore) return;

        if (error || !data) {
          if (error) console.error("QR card fetch failed", error);
          setSelectedCard(null);
          return;
        }

        const slug = data.slug || "";

        if (!slug) {
          setSelectedCard(null);
          return;
        }

        setSelectedCard({
          slug,
          name: data.card_name || "Primary Digital Card",
          public_path: `/u/${slug}`,
          public_url: `${publicSiteOrigin}/u/${slug}`,
          status: data.is_published ? "published" : data.status || "draft",
        });
      } catch (error) {
        if (!(error instanceof ClientAuthRequiredError)) {
          console.error("QR card load failed", error);
        }
      } finally {
        if (!ignore) setLoadingCard(false);
      }
    }

    void loadSavedCard();

    return () => {
      ignore = true;
    };
  }, []);

  async function copyPublicLink() {
    if (!selectedCard) return;

    await navigator.clipboard?.writeText(selectedCard.public_url);
    setActionMessage("Public link copied.");
  }

  function viewPublicPage() {
    if (!selectedCard) return;

    window.open(selectedCard.public_url, "_blank", "noopener,noreferrer");
  }

  function downloadPng() {
    if (!selectedCard || qrMatrix.length === 0) return;

    const canvas = document.createElement("canvas");
    drawQrToCanvas(canvas, qrMatrix, 960);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `dmi-card-qr-${slugifyFilename(selectedCard.slug)}.png`;
    link.click();
    setActionMessage("QR code PNG downloaded.");
  }

  function printQr() {
    if (!selectedCard || qrMatrix.length === 0) return;

    const canvas = document.createElement("canvas");
    drawQrToCanvas(canvas, qrMatrix, 720);
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
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#AC00FF]">
              Client Portal
            </p>
            <h1 className="mt-3 text-4xl font-bold">QR Code</h1>
            <p className="mt-3 max-w-3xl text-white/50">
              Create and download a QR code for your public digital business
              card.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[#AC00FF]/30 bg-[#AC00FF]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
            {currentPlan === "free" ? "Free Plan" : "Pro Plan"}
          </span>
        </div>

        {loadingCard ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-white/50">
            Loading your published card...
          </div>
        ) : !selectedCard ? (
          <EmptyQrState />
        ) : (
          <>
            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Linked Card"
                value={selectedCard.name}
                icon={QrCode}
              />
              <SummaryCard
                label="Public URL"
                value={selectedCard.public_path}
                icon={ExternalLink}
              />
              <SummaryCard label="QR Status" value="Ready" icon={Check} />
              <SummaryCard label="Total Scans" value="Coming soon" icon={BarChart3} />
            </div>

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
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold shadow-lg shadow-purple-500/20 transition hover:shadow-purple-500/35"
            >
              <Sparkles className="h-4 w-4" />
              View Upgrade
            </button>
          </div>
            </div>

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="QR Settings"
                description="Choose the card, style, colour, and download format."
              />

              <div className="mt-6 space-y-6">
                <SettingsBlock title="Select Card">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <select className="inputStyle">
                      <option>{selectedCard.name}</option>
                    </select>
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-green-400/20 bg-green-500/15 px-3 py-2 text-xs font-semibold text-green-200">
                      <span className="h-2 w-2 rounded-full bg-green-300" />
                      Published
                    </span>
                  </div>
                </SettingsBlock>

                <SettingsBlock title="QR Style">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {qrStyles.map((style) => (
                      <button
                        key={style}
                        type="button"
                        className="rounded-2xl border border-[#AC00FF]/45 bg-[#AC00FF]/15 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-purple-500/10"
                      >
                        {style}
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
                  {isPaid ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center gap-3">
                        <Palette className="h-5 w-5 text-purple-200" />
                        <div>
                          <p className="font-semibold">Custom colour picker</p>
                          <p className="mt-1 text-sm text-white/45">
                            Colour picker and gradient controls will appear here.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-white/45">
                        Free users can choose from admin-approved QR colours.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        {freeQrColours.map((colour, index) => (
                          <button
                            key={colour}
                            type="button"
                            className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                              index === 0
                                ? "border-white shadow-lg shadow-purple-500/30"
                                : "border-white/10 hover:border-white/30"
                            }`}
                            style={{ backgroundColor: colour }}
                            aria-label={`Select ${colour}`}
                          >
                            {index === 0 && <Check className="h-5 w-5" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Logo in QR">
                  {isPaid ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-[#AC00FF]/35 bg-[#AC00FF]/10 p-5 text-left transition hover:border-[#AC00FF]/60 hover:bg-[#AC00FF]/15"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#AC00FF]/20">
                        <ImagePlus className="h-5 w-5 text-purple-100" />
                      </span>
                      <span>
                        <span className="block font-semibold">Upload logo</span>
                        <span className="mt-1 block text-sm text-white/45">
                          Placeholder upload for branded QR codes.
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <div className="flex gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                          <Lock className="h-5 w-5 text-white/50" />
                        </div>
                        <div>
                          <p className="font-semibold">
                            Upgrade to Individual Pro to add your logo to QR
                            codes.
                          </p>
                          <p className="mt-1 text-sm text-white/45">
                            Logo QR codes help clients recognise your brand at
                            a glance.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </SettingsBlock>

                <SettingsBlock title="Download">
                  <div className="flex flex-wrap gap-3">
                    <ActionButton icon={Download} onClick={downloadPng}>Download PNG</ActionButton>
                    <ActionButton icon={Printer} onClick={printQr}>
                      Print QR
                    </ActionButton>
                    <button
                      type="button"
                      disabled={!isPaid}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/45 transition enabled:text-white enabled:hover:border-[#AC00FF]/50 enabled:hover:bg-[#AC00FF]/15 disabled:cursor-not-allowed"
                    >
                      <Lock className="h-4 w-4" />
                      Download SVG
                    </button>
                  </div>
                </SettingsBlock>
              </div>
            </section>
          </div>

          <aside className="xl:sticky xl:top-8 xl:self-start">
            <section className="rounded-3xl border border-white/10 bg-[#101935]/70 p-6 shadow-2xl shadow-black/20">
              <SectionTitle
                title="Live QR Preview"
                description="Preview the QR code clients will scan."
              />

              <div className="mt-6 rounded-[2rem] border border-[#AC00FF]/25 bg-gradient-to-br from-[#1B1241] via-[#101935] to-[#070B1A] p-6 shadow-inner shadow-white/5">
                <div className="rounded-3xl bg-white p-5 text-[#0F172A] shadow-2xl shadow-purple-950/30">
                  <QrPreview matrix={qrMatrix} />
                  <div className="mt-5 text-center">
                    <p className="text-sm font-semibold">Scan to open</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedCard.public_path}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ActionButton icon={Copy} onClick={copyPublicLink}>
                    Copy Public Link
                  </ActionButton>
                  <ActionButton icon={ExternalLink} onClick={viewPublicPage}>View Public Page</ActionButton>
                  <ActionButton icon={Download} onClick={downloadPng}>Download PNG</ActionButton>
                  <ActionButton icon={Printer} onClick={printQr}>
                    Print
                  </ActionButton>
                </div>
                {actionMessage && (
                  <p className="mt-4 rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-center text-sm text-green-100">
                    {actionMessage}
                  </p>
                )}
              </div>
            </section>
          </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}


function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof QrCode;
}) {
  return (
    <div className="min-h-32 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
          {label}
        </p>
        <Icon className="h-5 w-5 text-purple-200" />
      </div>
      <p className="mt-5 break-words text-2xl font-semibold tracking-tight">
        {value}
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
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#AC00FF]/50 hover:bg-[#AC00FF]/15 hover:shadow-lg hover:shadow-purple-500/10"
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function EmptyQrState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-black/20">
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
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#AC00FF] to-[#6C2CFF] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:shadow-purple-400/35"
      >
        <ExternalLink className="h-4 w-4" />
        Create or Publish Card
      </a>
    </div>
  );
}

function QrPreview({ matrix }: { matrix: boolean[][] }) {
  const size = matrix.length;

  return (
    <div
      className="mx-auto grid aspect-square w-full max-w-[280px] rounded-3xl bg-white p-3"
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {matrix.flatMap((row, rowIndex) =>
        row.map((filled, colIndex) => (
          <span
            key={`${rowIndex}-${colIndex}`}
            className={filled ? "bg-[#0F172A]" : "bg-white"}
          />
        ))
      )}
    </div>
  );
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

function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  matrix: boolean[][],
  size: number
) {
  const quietZone = 4;
  const moduleCount = matrix.length + quietZone * 2;
  const scale = Math.floor(size / moduleCount);
  const canvasSize = scale * moduleCount;
  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasSize, canvasSize);
  context.fillStyle = "#0f172a";
  matrix.forEach((row, rowIndex) => {
    row.forEach((filled, colIndex) => {
      if (!filled) return;
      context.fillRect(
        (colIndex + quietZone) * scale,
        (rowIndex + quietZone) * scale,
        scale,
        scale
      );
    });
  });
}

function slugifyFilename(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
}
