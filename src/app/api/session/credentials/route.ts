// BFF: BYO ("bring your own") sandbox credentials.
//
//   POST   /api/session/credentials { clientId, clientSecret }
//          Verify the pasted creds (mint a token), SEAL them (AES-GCM) into the
//          HttpOnly session cookie, and return { connected, clientId }. The
//          clientSecret is consumed server-side and never echoed back.
//   DELETE /api/session/credentials
//          Clear the BYO cookie — the app falls back to static/demo mode.
//
// The cookie is the ONLY session state (no server store), so any replica can
// serve the next request. The secret lives only inside the encrypted cookie
// blob, which the browser cannot read (HttpOnly) or decrypt.
import { NextResponse } from "next/server";
import { connect, NotConnectedError } from "@/server/auth";
import { SESSION_COOKIE } from "@/server/session-context";

export const dynamic = "force-dynamic";

// The sealed cookie lives as long as the sandbox creds plausibly do (48h TTL).
// When the creds expire the next token mint fails and the UI re-prompts.
const SESSION_MAX_AGE = 48 * 60 * 60; // seconds

export async function POST(req: Request) {
  let clientId = "";
  let clientSecret = "";
  try {
    const body = await req.json();
    clientId = String(body.clientId || "");
    clientSecret = String(body.clientSecret || "");
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Expected JSON body." },
      { status: 400 },
    );
  }
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "bad_request", detail: "Both clientId and clientSecret are required." },
      { status: 400 },
    );
  }
  try {
    const { sessionSeal } = await connect(clientId, clientSecret);
    // Return only the non-secret clientId for the connected-tenant banner.
    const res = NextResponse.json({ connected: true, clientId: clientId.trim() });
    res.cookies.set(SESSION_COOKIE, sessionSeal, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Host-only cookie (no Domain attribute); Path "/" so every /api/* call
      // sends it.
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ error: "not_connected", detail: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "connect_failed", detail: message }, { status: 502 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ connected: false });
  // Expire the cookie. Next /api/session then reports static/demo mode again.
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
