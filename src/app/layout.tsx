import type { Metadata } from "next";
import "./globals.css";
import { brand, brandCssVars } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: "Reference corporate-onboarding portal integrating the KYC Sandbox API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // brandCssVars() publishes the theme tokens as CSS variables on <html>,
  // so editing src/lib/brand.ts re-skins the whole app.
  return (
    <html lang="en" style={brandCssVars() as React.CSSProperties}>
      <body>
        <header className="app-header">
          <div className="wordmark">
            <span className="mark">{brand.name}</span>
            <span className="tag">{brand.tagline}</span>
          </div>
        </header>
        {children}
        <footer>{brand.legalLine}</footer>
      </body>
    </html>
  );
}
