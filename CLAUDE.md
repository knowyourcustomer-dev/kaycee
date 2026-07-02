# CLAUDE.md

This file orients Claude Code (and other coding agents) working in this repository.

**Read [AGENTS.md](AGENTS.md) first: it is the source of truth for this repo.** This file adds only Claude Code specifics.

## The one thing to do before writing code

Fetch the API's machine-readable guide and build against it rather than guessing:

- Full self-contained guide: https://knowyourcustomer.com/developers/llms-full.txt
- Link map: https://knowyourcustomer.com/developers/llms.txt

It covers auth, the case model, the "readiness = structure populated, not the status field" seam, beneficial ownership, documents, AML, IDV, the error model, and per-jurisdiction latency. Fetch it once and keep it in context (in Claude Code, use WebFetch); it is written for agents and avoids the token cost of scraping the HTML docs.

## Quick facts

- **Run:** `npm install && npm run dev` (http://localhost:3000). By default, it uses the free sandbox `https://api.knowyourcustomer.dev` and auto-provisions a demo tenant, so no credentials are needed to try the journey.
- **API surface:** all of it is in `src/server/kyc-client.ts`. Keep new calls there.
- **Secrets:** the browser talks to the BFF (`src/server/bff.ts`); the server holds the token. Never log, echo, or commit `client_secret` or bearer tokens. `.env.example` shows the `SANDBOX_*` keys.
- **Verify changes:** `npm test`, then `npm run build`. Exercise the flow in the browser against the sandbox before proposing it is done.
- **Scope:** this is a fork-me sample app. Favor readable, legible code over abstraction; keep the journey (`src/components/Journey.tsx`) easy to follow.

## Access (human-gated by design)

A dedicated sandbox tenant and production are approval-gated: a person requests and signs a short agreement at https://knowyourcustomer.com/developers/access/, then credentials are emailed. Build and test against the auto-provisioned demo tenant first, then drop in the issued credentials (paste into the in-app connect screen or set `SANDBOX_CLIENT_ID`/`SANDBOX_CLIENT_SECRET`). No credentials live in this repo.
