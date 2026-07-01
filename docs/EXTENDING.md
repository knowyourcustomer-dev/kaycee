# Extending this reference app

This app is a **customer-facing SME corporate account-opening journey**.
Everything below is either a deliberate scope boundary or a place we expect a
bank to plug its own systems in. Each has a clear home in the code.

## 0. The developer view (demo affordance, not auth)

The top-right **Developer view** toggle (default ON) reveals the API debug stream
and the close-report download. It is **not authentication**. It is a demo control
so a reviewer can see the raw sandbox traffic and the resulting report. In
production this surface would sit behind the onboarding provider's own staff
console and real auth, not a client-side toggle. Lives in
`src/components/Journey.tsx` (`internalView`).

## 0b. Who must verify ID (the ownership rule)

`src/lib/ubo.ts` decides which people are asked for an identity document from the
org chart: every individual with **> 25% effective ownership**; if none reach
25%, the **directors plus the single largest-control individual**; deduplicated
by name. Adjust the threshold or the fallback there. The heuristic for
"individual vs company" is a name/role check — tighten it for your jurisdictions.

## 1. The self-service signup gate (the planned change)

**Today:** a credential-less developer is auto-provisioned a fresh sandbox by
calling the open `POST /sandbox/provision` endpoint directly. No gate.

**Planned:** a click-through agreement + light registration in front of
provisioning.

**Where it goes:** `src/server/auth.ts`, function `obtainCredentials()`. There
is a marked `// <-- gate goes here` comment. Replace the direct provision call
with your gated flow that provisions only after consent. **Nothing downstream
changes** — the token broker, the typed client, and every screen stay the same.
Only *where the credentials come from* changes.

## 2. Live monitoring — intentionally excluded

Ongoing/perpetual monitoring (`lm-cases`, `lm-alerts`, `lm-alerts-action`) is
**not part of this sample by design**. Banks typically run ongoing monitoring as
a separate workflow owned by a different team, so including it here would widen
the surface a reader has to absorb before they understand onboarding. The
sandbox API supports it; add it as a separate "monitoring" example or screen if
you need it. The pattern mirrors the case endpoints already in `kyc-client.ts`.

## 3. Individual (person) cases

The corporate journey is the headline. Person cases are a near-clone:
`POST /v2/Individuals`, then poll, members, steps, AML, close — the same shape
as companies. Add the methods to `kyc-client.ts` and reuse the journey
components.

## 4. Step notes, user assignment, review dates

Operational niceties supported by the API but out of v1 scope:
- step notes — `/v2/CaseStepNotes`
- user assignment — assign a case to a user
- review-date scheduling — `PUT /v2/Companies/{id}/review-date`

## 5. Your own user authentication

This app models **sandbox** auth (OAuth2 client-credentials, server-side). It
does **not** implement auth for *your* end users. Add your identity provider in
front of the screens; the BFF already isolates the sandbox credential from the
browser, so your user-auth layer sits cleanly on top.

## 6. Persistence

There is no database. The journey is session-scoped in the browser. Add your
case-list persistence where you'd expect — a `cases` table keyed by
`caseCommonId`, populated as you create cases.

## 7. Replace the BFF with your gateway

`src/app/api/*` is a **thin** backend-for-frontend: hold the secret, broker the
token, proxy `/v2`. It is a pattern, not a framework. In production a bank
routes these calls through its own API gateway. Token/credential state here is
in-process memory (`auth.ts`); behind multiple instances, move it to a shared
cache (e.g. Redis).

## 8. Replace the design system

All brand tokens (name, tagline, colours, font) live in `src/lib/brand.ts`.
Components use CSS variables published from there. Swap `brand.ts` to re-skin;
swap the components in `src/components/` to change layout.

## Sandbox limitations (documented, not hidden)

- **AML-only / import paths are refused** by the sandbox by design
  (`POST /v2/Companies/import` and AML-only processing types return a documented
  refusal). Don't build screens that assume they work.
- **No live registry, no fees.** Cases come from a pre-loaded catalogue.
- **Ephemeral sandboxes expire.** A `410` with `[SANDBOX_EXPIRED]` means
  provision a fresh one; this app does that automatically on the next call.
