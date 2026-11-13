// Small helpers shared by the API route handlers in app/api/.
// HTML forms post here and get a 303 redirect back with a one-time message;
// a client that sends Accept: application/json gets JSON instead.
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "./auth";
import { DatabaseError } from "./db";

export function wantsJson(req: NextRequest) {
  return (req.headers.get("accept") || "").includes("application/json");
}

export function done(req: NextRequest, to: string, message?: string, data: object = {}, status = 200) {
  if (wantsJson(req)) return NextResponse.json({ ok: status < 400, message, ...data }, { status });
  const res = NextResponse.redirect(new URL(to, req.url), 303);
  if (message) res.cookies.set("flash", encodeURIComponent(message), { path: "/", maxAge: 30 });
  return res;
}

/** Only allow redirects to paths on this site. */
export function safeNext(v: unknown, fallback: string) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

export async function body(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) return await req.json();
  const f = await req.formData();
  return Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
}

/** The page the form was on (same site only), so an error shows where it happened. */
export function backTo(req: NextRequest, fallback: string) {
  const ref = req.headers.get("referer");
  try {
    const u = new URL(ref || "");
    if (u.host === req.nextUrl.host) return u.pathname + u.search;
  } catch {}
  return fallback;
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Wrap a route: turn a DatabaseError (SIGNAL, CHECK, privilege refusal) into a message. */
export function route(fallbackPath: string, fn: Handler): Handler {
  return async (req, ctx) => {
    try { return await fn(req, ctx); }
    catch (e) {
      if (e instanceof DatabaseError) return done(req, backTo(req, fallbackPath), e.message, {}, 400);
      throw e;
    }
  };
}

export async function apiUser(req: NextRequest, role?: "admin") {
  const user = await currentUser();
  if (!user) return { user: null, res: done(req, "/login", "Log in first, hero!", {}, 401) };
  if (role && user.role !== role) return { user: null, res: done(req, "/", "Admins only.", {}, 403) };
  return { user, res: null };
}
