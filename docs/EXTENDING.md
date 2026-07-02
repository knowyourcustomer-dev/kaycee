# Extending this reference app

This app is a **customer-facing SME corporate account-opening journey**.
Everything below is either a deliberate scope boundary or a place we expect a
bank to plug its own systems in. Each has a clear home in the code.

## 0. The internal view (demo affordance, not auth)

The top-right **Internal view** toggle (default ON) reveals the API debug stream
and the close-report download. It is **not authentication** — it's a demo
control so a reviewer can see the raw sandbox traffic and the resulting report.
In production this surface would sit behind the bank's staff console / real auth,
not a client-side toggle. Lives in `src/components/Journey.tsx` (`internalView`).

## 0b. Who must verify ID (the ownership rule)

`src/lib/ubo.ts` decides which people are asked for an identity document from the
org chart: every individual with **> 25% effective ownership**; if none reach
25%, the **directors plus the single largest-control individual**; deduplicated
by name. Adjust the threshold or the fallback there. The heuristic for
"individual vs company" is a name/role check — tighten it for your jurisdictions.
`src/lib/member-resolve.ts` then routes each person to their own individual
member case (by `member.caseCommonId`, never by display name) and filters to
**natural persons only** — a corporate member (memberType "Company" /
`entityName`) never gets a photo-ID row, even when it carries a case id.

## 1. Where credentials come from (no auto-provisioning)

Credentials are always the user's own, issued through the **developer-portal
access request** (<https://knowyourcustomer.com/developers/access/>): pasted on
the connect screen (sealed into an encrypted HttpOnly cookie — `session-seal.ts`)
or set in the environment for a static deployment. `src/server/auth.ts` is the
whole token broker; there is deliberately **no** anonymous/auto-provision path,
so a fork inherits the correct posture by default. If your bank fronts this app
with its own identity layer, mint or look up the tenant credentials there and
inject them via the same two seams (cookie or env).

## 1b. Webhooks vs polling (how the app learns a case is ready)

`src/server/webhooks.ts` registers the subscription (idempotent, deduped by
callback URL); `src/app/api/webhooks/callback/route.ts` receives deliveries
(URL-token authenticated — deliveries carry no auth headers, by design);
`src/server/event-store.ts` buffers them (in-memory, single replica — swap for
Redis or push-to-client in production); `Journey.tsx` flips to ready on the
`CaseReady` event, with a slow direct status check as the safety net. Without
`APP_PUBLIC_URL` the journey uses the classic **polling** loop instead — kept
in `Journey.tsx` as the documented alternative for apps the platform cannot
reach.

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
- **Sandbox credentials expire** (48h). A `401`/`410` surfaces as a clear
  "re-connect" message — the app never silently swaps you onto a different
  tenant. Request fresh credentials from the developer portal.
