// BFF: POST /api/webhooks/callback?t=<token> — the sandbox delivers webhook
// events here: `{eventType, body}` JSON, body carrying caseCommonId (string),
// caseName, message and per-event extras.
//
// AUTH: deliveries carry no auth headers/signature (parity with the real
// product), so we authenticate by the `t` token embedded in the URL we
// registered (see callback-token.ts). Wrong/missing token -> 401; we never
// accept arbitrary unauthenticated events.
//
// ACK: respond 2xx FAST on accepted events — the sandbox retries non-2xx up to
// 10 times and then blocks the URL for an hour. A payload that is valid JSON
// but not a usable event shape is acked (200) and dropped: retrying it would
// never help.
import { NextRequest, NextResponse } from "next/server";
import { callbackTokenMatches } from "@/server/callback-token";
import { recordEvent } from "@/server/event-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!callbackTokenMatches(req.nextUrl.searchParams.get("t"))) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const key = recordEvent(payload);
  // Ack immediately either way (see header comment); `accepted:false` just
  // means the shape wasn't a usable event.
  return NextResponse.json({ accepted: key !== null });
}
