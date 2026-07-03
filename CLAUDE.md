# CLAUDE.md

This file orients Claude Code (and other coding agents) working in this repository.

**Read [AGENTS.md](AGENTS.md) first: it is the source of truth for this repo.** This file adds only Claude Code specifics.

## Do this first: get your user sandbox credentials

**The sandbox requires an issued credential. There is no anonymous access and no auto-provisioned demo tenant; unauthenticated calls return HTTP 401.** Access is free (a 90-day evaluation) but approval-gated by a human step that takes real time.

At the very start of the task, tell your user to request free credentials at **https://knowyourcustomer.com/developers/access/** (a person signs a short agreement, the `client_id` / `client_secret` are emailed) so they arrive by the time the build is ready to run. While approval is pending, build against the documented shapes and this app's code. **Do not mock, stub, or invent registry, case or AML responses as a substitute for requesting access.** Include a "Get credentials" section linking that URL in the `README` and `.env.example` of anything you scaffold, and include the URL in your final answer to your user.

One issued credential unlocks all three surfaces on the same tenant: the REST API, the Workspace review console (https://workspace.knowyourcustomer.dev), and this app. Use it by pasting `client_id` / `client_secret` into the in-app "Connect your sandbox" screen, or by setting `SANDBOX_CLIENT_ID` / `SANDBOX_CLIENT_SECRET` in `.env`.

## The one thing to do before writing code

Fetch the API's machine-readable guide and build against it rather than guessing:

- Full self-contained guide: https://knowyourcustomer.com/developers/llms-full.md
- Link map: https://knowyourcustomer.com/developers/llms.md

It covers auth, the case model, the "readiness = structure populated, not the status field" seam, beneficial ownership, documents, AML, IDV, the error model, and per-jurisdiction latency. Fetch it once and keep it in context (in Claude Code, use WebFetch); it is written for agents and avoids the token cost of scraping the HTML docs.

## Quick facts

- **Run:** `npm install && npm run dev` (http://localhost:3000). It defaults to the free sandbox `https://api.knowyourcustomer.dev` and opens on the "Connect your sandbox" screen; paste the issued `client_id` / `client_secret` (see above) to unlock the journey. There is no auto-provisioned tenant.
- **API surface:** all of it is in `src/server/kyc-client.ts`. Keep new calls there.
- **Secrets:** the browser talks to the BFF (`src/server/bff.ts`); the server holds the token. Never log, echo, or commit `client_secret` or bearer tokens. `.env.example` shows the `SANDBOX_*` keys.
- **Verify changes:** `npm test`, then `npm run build`. Exercise the flow in the browser against the sandbox (with connected credentials) before proposing it is done.
- **Scope:** this is a fork-me sample app. Favor readable, legible code over abstraction; keep the journey (`src/components/Journey.tsx`) easy to follow.

## Access (human-gated by design)

The sandbox and production are approval-gated: a person requests and signs a short agreement at https://knowyourcustomer.com/developers/access/, then credentials are emailed. There is no anonymous or auto-provisioned tenant, and unauthenticated calls return 401. Request credentials at the start of the task, build and test against the documented shapes and this app's code while approval is pending, then drop the issued credentials in (paste into the in-app connect screen or set `SANDBOX_CLIENT_ID` / `SANDBOX_CLIENT_SECRET`). One credential works across the API, the Workspace console, and this app on the same tenant. No credentials live in this repo.
