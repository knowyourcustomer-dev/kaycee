# Kaycee: SME business onboarding sample app

Kaycee is a runnable sample application that shows how to build a customer facing
**SME business onboarding** flow on top of the [Know Your Customer](https://knowyourcustomer.com/developers)
**KYB and UBO API**. It walks a new business customer through opening an account:
find the company, answer an onboarding questionnaire, verify the people who own
and control it, screen them for AML, and submit. It runs against a **free
sandbox**, so you can try the whole journey with no cost and no commitment.

It is built to be forked. The entire API surface lives in one typed client file,
the journey is one readable component, and the extension points are marked in the
code. The goal is simple: read it in twenty minutes, then start replacing the
sample code with yours.

Topics: **KYB** (Know Your Business), **KYC**, **UBO** (ultimate beneficial
ownership), business onboarding, beneficial ownership resolution, AML screening,
company verification, webhooks, developer sandbox.

![Kaycee onboarding journey: opening a business account against the Know Your Customer KYB API](docs/screenshot.png)

## Quickstart

Requires Node.js 20 or later.

1. Request free sandbox access at
   <https://knowyourcustomer.com/developers/access/>. You will be emailed a
   `client_id` and `client_secret`.
2. Run the app:

   ```bash
   npm install
   npm run dev
   ```

3. Open <http://localhost:3000> and paste your credentials into the **connect
   screen**. The whole journey then runs against **your own sandbox tenant**:
   the same cases you see when you call the API directly or use the developer
   tools on the portal.

Your secret is sent once to the app server, sealed into an encrypted, HttpOnly
session cookie, and is never stored in the browser or returned to it.

Alternatively, set `SANDBOX_CLIENT_ID` / `SANDBOX_CLIENT_SECRET` in `.env` and
the app starts already connected as that tenant (useful for a private
deployment). There is no anonymous demo tenant: credentials are yours to bring,
and one credential works across every surface.

## What you can create

The sandbox is preloaded with companies and individuals you can create and run,
including synthetic scenario cases (for example a PEP match or a long processing
delay) and real companies drawn from live registries. The full list is on the
[sandbox test cases](https://knowyourcustomer.com/developers/test-cases/) page.
You create a company by searching for it and then creating it by its exact name.

## The journey

0. **Connect**: paste your sandbox `client_id` and `client_secret` (skipped when
   the deployment carries its own credentials in the environment).
1. **Identify** the company by name or registration number and country.
2. **Confirm** the entity, which creates the case and starts the asynchronous
   build.
3. **Your details**: the onboarding questionnaire, attached to the case as a note.
4. **Verifying**: the journey flips to ready on the **`CaseReady` webhook
   event** when the app has a public URL (the recommended integration, matching
   how the real product notifies you), and **falls back to polling** when it
   does not. A developer view shows the raw API calls, status transitions, and
   received webhook events.
5. **Documents**: identity documents for every individual who controls the
   company (over 25 percent effective ownership, or the directors plus the
   largest controller if none reach 25 percent). Only natural persons get an ID
   row; a corporate shareholder never does (its corporate documents live on the
   company case). Plus a board resolution.
6. **Screening**: the automatic AML screening result, read-only.
7. **Done**: the case auto-closes and the close report is available in the
   developer view.

A **developer view** toggle (top right, default on) reveals the API debug stream
(including live webhook events) and the close report. It is a demo affordance,
not authentication. Turn it off to see the customer-facing journey on its own.

## Webhooks or polling (both included, deliberately)

The real Know Your Customer product notifies integrators with **webhooks**, so
this sample consumes case events the same way, and that is the pattern to copy:

- **Webhook mode** (set `APP_PUBLIC_URL` to this app's own public origin,
  reachable by the sandbox): on case creation the app idempotently registers a
  subscription for `CaseReady`, `DocumentUploaded`, `AmlMatch` and `CaseClosed`,
  deduplicated by callback URL. The sandbox POSTs events to
  `/api/webhooks/callback?t=<token>`; the token, derived from `SESSION_SECRET`,
  authenticates deliveries. The journey flips on `CaseReady`, with a slow direct
  status check as a safety net so a lost delivery can never wedge it.
- **Polling mode** (no `APP_PUBLIC_URL`, for example a local clone the sandbox
  cannot reach): the journey polls the case status every few seconds. Kept fully
  working and marked in the source as the documented alternative.

If subscription creation fails, the app logs it and falls back to polling:
webhooks being unavailable never breaks the journey.

## How it is built

The browser never sees a credential. All API calls go through the Next.js server
route handlers (a backend-for-frontend), which hold the credential, broker a
short-lived bearer token, and proxy the `/v2` API.

```
src/
  lib/brand.ts          re-brand here (name, tagline, theme, one file)
  lib/api-types.ts      shared types, countries, sample companies, questionnaire bands
  lib/ubo.ts            who must verify ID: over-25% owners, else directors + largest
  lib/member-resolve.ts individuals-only member-to-case resolution (ID documents
                        route to the person's own case; corporate members never
                        get ID rows)
  lib/bff-fetch.ts      browser to our own /api/* (never the API directly)
  server/
    config.ts           configuration (base URL, optional credentials, APP_PUBLIC_URL)
    auth.ts             token broker: BYO sealed-cookie session or static env credentials
    session-seal.ts     encrypts the connect-your-sandbox session cookie (AES-256-GCM)
    kyc-client.ts       the API map: one typed method per API call
    webhooks.ts         webhook subscription lifecycle (idempotent ensure, URL dedupe)
    event-store.ts      in-memory received-events buffer (single replica; see comments)
    callback-token.ts   shared-secret token for the callback URL
    bff.ts              thin error-translation helper
  app/
    api/...             the backend-for-frontend route handlers
    page.tsx            the page
  components/
    Journey.tsx         the whole onboarding journey in one file
    OrgChart.tsx        recursive ownership-tree renderer
    AmlPanel.tsx        AML screening view, read-only
```

See [`docs/EXTENDING.md`](docs/EXTENDING.md) for the marked extension points
(self-service signup gate, ongoing monitoring, individual cases, your own user
auth, persistence, design system, and replacing the backend-for-frontend with
your own gateway).

## Configuration

Copy `.env.example` to `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `SANDBOX_BASE_URL` | `https://api.knowyourcustomer.dev` | The API base URL (the free public sandbox). |
| `SANDBOX_CLIENT_ID` / `SANDBOX_CLIENT_SECRET` | blank | Optional. Your own credentials from the [access request](https://knowyourcustomer.com/developers/access/). Set both for an always-connected deployment; leave blank and each visitor connects their own on the connect screen. |
| `SANDBOX_SCOPE` | `PublicApi` | OAuth scope. |
| `SESSION_SECRET` | insecure dev fallback | Server key sealing pasted credentials into the HttpOnly cookie, and deriving the webhook callback token. Set a long random string in any real deployment. |
| `APP_PUBLIC_URL` | blank | This app's own public origin. Set it and case events arrive via webhooks; leave it blank and the journey polls. |
| `SANDBOX_TOKEN_URL` | derived | Optional token-endpoint override when auth lives on a separate host. |

**Graduate to production:** point `SANDBOX_BASE_URL` at the live Know Your
Customer Public API and drop in real credentials. The shapes match the live v2
contract, so the typed client and every screen are unchanged.

## Links

- Developer portal: <https://knowyourcustomer.com/developers>
- Request sandbox credentials: <https://knowyourcustomer.com/developers/access/>
- API reference: <https://knowyourcustomer.com/developers/api-reference/>
- Free sandbox: <https://knowyourcustomer.com/developers/sandbox/>
- Sandbox test cases: <https://knowyourcustomer.com/developers/test-cases/>

## License

MIT. See [`LICENSE`](LICENSE). Copyright 2026 Know Your Customer Limited.

## Notes

- No charges. Sandbox cases come from a preloaded catalogue; nothing calls a live
  registry or incurs a fee.
- Sandbox credentials are time-limited. When they expire the app surfaces a
  clear message and the connect screen; request fresh credentials from the
  developer portal. The app never silently switches you to a different tenant.
- The sandbox is for evaluation and development. Sandbox data and reports are not
  for production compliance use.
- This is a readable reference, not a production-hardened product. Session state
  is in-process and the webhook event buffer is single-replica; see
  `docs/EXTENDING.md`.
