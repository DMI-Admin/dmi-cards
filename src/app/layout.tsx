import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import {
  DM_Sans,
  Geist,
  Geist_Mono,
  Inter,
  Lato,
  Montserrat,
  Nunito,
  Outfit,
  Playfair_Display,
  Poppins,
  Roboto,
  Space_Mono,
  Syne,
} from "next/font/google";
import ThemeInitializer from "@/components/ThemeInitializer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DMI Cards Admin",
  description: "DMI Cards business admin platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${poppins.variable} ${montserrat.variable} ${lato.variable} ${roboto.variable} ${playfairDisplay.variable} ${dmSans.variable} ${outfit.variable} ${nunito.variable} ${spaceMono.variable} ${syne.variable} h-full antialiased`}
        data-theme="system"
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <ThemeInitializer />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
