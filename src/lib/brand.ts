/**
 * brand.ts — THE SINGLE PLACE TO RE-BRAND THIS APP.
 * =================================================
 * Everything visible to a user (bank name, wordmark, tagline, colours, fonts)
 * is defined here. Change these tokens and the whole app re-skins. No other file
 * hard-codes the brand.
 *
 * NOTE ON THE NAME: "Kaycee Bank" is a *provisional, fictitious* brand — a
 * phonetic play on "KYC" (Know Your Customer). It exists only to make this
 * reference app look like a real bank's onboarding portal so it can double as a
 * sales demo. It is not a real institution. Rename it in one edit below.
 */

export const brand = {
  // --- Identity -----------------------------------------------------------
  /** Full legal-ish name shown in the wordmark and page titles. */
  name: "Kaycee Bank",
  /** Short form / wordmark suffix. */
  shortName: "Kaycee",
  /** One-line descriptor under the wordmark. */
  tagline: "Corporate Onboarding Portal",
  /** Footer / about line. */
  legalLine:
    "Kaycee Bank is a fictitious demonstration brand. This portal is a reference integration against the KYC Sandbox.",

  // --- Theme tokens (restrained, bank-like) -------------------------------
  // Referenced as CSS variables in globals.css via applyBrandTheme().
  theme: {
    primary: "#0b3d63", // deep navy — headers, primary actions
    primaryHover: "#0e4d7c",
    accent: "#1f8a70", // muted teal — success / ready states
    accentSoft: "#e6f4ef",
    danger: "#b3261e",
    dangerSoft: "#fbeceb",
    warning: "#a8741a",
    warningSoft: "#fcf3e2",
    bg: "#f4f6f8", // page background
    surface: "#ffffff", // cards
    border: "#dde3ea",
    text: "#1b2733",
    textMuted: "#5b6b7b",
    radius: "10px",
    fontSans:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
} as const;

export type Brand = typeof brand;

/** Inline style object that publishes the theme tokens as CSS variables. */
export function brandCssVars(): Record<string, string> {
  const t = brand.theme;
  return {
    "--color-primary": t.primary,
    "--color-primary-hover": t.primaryHover,
    "--color-accent": t.accent,
    "--color-accent-soft": t.accentSoft,
    "--color-danger": t.danger,
    "--color-danger-soft": t.dangerSoft,
    "--color-warning": t.warning,
    "--color-warning-soft": t.warningSoft,
    "--color-bg": t.bg,
    "--color-surface": t.surface,
    "--color-border": t.border,
    "--color-text": t.text,
    "--color-text-muted": t.textMuted,
    "--radius": t.radius,
    "--font-sans": t.fontSans,
  } as Record<string, string>;
}
