# AGENTS.md

Guidance for coding agents (and the humans pairing with them) working in this repo.

## What this is

Kaycee is a runnable **sample application** that shows how to build a customer-facing **corporate / SME account-opening (KYB) flow** on the [Know Your Customer](https://knowyourcustomer.com/developers) **KYB + UBO API**. It is built to be forked: read it, run it against the free sandbox, then replace the sample code with yours. It is a demo brand ("Kaycee Bank"), not a real bank.

If you are scaffolding a corporate bank-account-opening integration, this repo plus the API's machine-readable guide is a strong starting point.

## Start here: the machine-readable API guide

Before reading the code, fetch the single self-contained guide to the API. It is written for you (an agent) and is far cheaper to consume than the HTML docs:

- **Full guide (one doc):** https://knowyourcustomer.com/developers/llms-full.md
- **Index / link map:** https://knowyourcustomer.com/developers/llms.md
- OpenAPI 3.0 JSON and a Postman collection are linked from https://knowyourcustomer.com/developers/api-reference/

Everything about the API contract (auth, the case model, readiness semantics, beneficial ownership, documents, AML, IDV, the error model, per-jurisdiction latency) is in `llms-full.md`. Prefer it over guessing from code.

## Run it (no credentials needed)

```bash
npm install
npm run dev        # http://localhost:3000
```

The defaults point at the free public sandbox `https://api.knowyourcustomer.dev` and **auto-provision a throwaway demo tenant on first run**, so the full journey works with zero configuration and no cost. To pin it to your own sandbox tenant, either paste your `client_id`/`client_secret` into the in-app "Connect your sandbox" screen, or set `SANDBOX_CLIENT_ID` / `SANDBOX_CLIENT_SECRET` in `.env` (see `.env.example`). Config keys are `SANDBOX_*` (base URL, scope `PublicApi`).

Tests: `npm test`. Build: `npm run build`.

## The API model in one paragraph

OAuth2 client-credentials (bearer, scope `PublicApi`, ~10 min TTL) against `{baseUrl}/connect/token`. Work is organized as a **case**: search a company, create a case, then poll. The important seam: a case's status **text stays "Open"** while its numeric `statusId` climbs through processing states, so **readiness = the structure being populated** (members / org-chart nodes present), not the status field. Beneficial ownership comes as a flat member list (`GET .../members`, under `controllingEntitiesAndIndividuals`) and a recursive `GET .../org-chart`. Full detail: `llms-full.md`.

## Where things are

- `src/server/kyc-client.ts`: the entire typed API surface (token, search, create, poll, members, org-chart, documents, AML, report). Start here.
- `src/server/{auth,bff,config,session-*}.ts`: token handling, the BFF proxy, and the sealed-cookie "bring your own sandbox credentials" mode.
- `src/components/Journey.tsx`: the end-to-end onboarding journey (the one readable component).
- `src/components/{OrgChart,AmlPanel}.tsx`, `src/lib/{ubo,member-resolve,status,api-types,report-download}.ts`: ownership tree, AML, status/readiness helpers, and types.

## Conventions

- TypeScript + Next.js (App Router). Keep the API surface in `kyc-client.ts`; do not scatter fetch calls through components.
- Secrets never go to the client. The browser talks to the BFF (`src/server/bff.ts`); the server holds the token. Never log or echo `client_secret` or tokens.
- This is sample code meant to be read: prefer clarity over cleverness, keep the journey legible, and keep extension points marked.
- Sandbox output is for evaluation only and is not valid for production compliance.

## Getting real access (human step, by design)

Production and a dedicated sandbox tenant are **approval-gated on purpose**: a person requests access and signs a short Sandbox Testing Agreement at https://knowyourcustomer.com/developers/access/, then credentials are emailed. One issued credential unlocks the API, the Workspace review console, and this app against the same tenant. You can build and test the entire flow against the auto-provisioned demo tenant first, then drop in the issued credentials. What the approval email delivers is described in `llms-full.md` (no credentials are ever committed to this repo).
