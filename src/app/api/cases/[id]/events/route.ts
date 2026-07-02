// BFF: GET /api/cases/{id}/events?since=N — the browser's view of the webhook
// events received for a case (from the in-memory event store, NOT a sandbox
// call — this endpoint is local and cheap, so the client can follow it on a
// short interval without touching the sandbox).
//
// Returns { events, cursor, ready }: pass `cursor` back as `since` to read
// incrementally; `ready` flips true once a CaseReady event has arrived. In
// polling mode (no APP_PUBLIC_URL) this endpoint simply never has events and
// the client uses the direct status-poll path instead.
import { NextRequest, NextResponse } from "next/server";
import { eventsForCase, caseIsReady } from "@/server/event-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = Math.max(0, Number(req.nextUrl.searchParams.get("since")) || 0);
  const { events, cursor } = eventsForCase(id, since);
  return NextResponse.json({ events, cursor, ready: caseIsReady(id) });
}
