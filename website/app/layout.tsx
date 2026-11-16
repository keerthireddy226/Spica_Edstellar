import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Playfair_Display } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

// Fonts are downloaded at build time and served from this site, so visitors'
// browsers never contact Google.
const display = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const logo = Playfair_Display({ subsets: ["latin"], weight: ["700"], style: ["normal", "italic"], variable: "--font-logo", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"),
  title: { default: "Spica by Edstellar | Know your English level and prove it", template: "%s | Spica by Edstellar" },
  description:
    "Spica measures English in all four skills, helps people improve, and ends with a proctored test and a certificate anyone can check online. For companies, recruiters, universities and individuals.",
  openGraph: { siteName: "Spica by Edstellar", type: "website" },
};

export const viewport: Viewport = { themeColor: "#f3ebd8", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${logo.variable}`}>
      <body>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
