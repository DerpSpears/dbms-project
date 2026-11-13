import type { NextRequest } from "next/server";
import { checkLogin } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { body, done, safeNext } from "@/lib/http";

// POST /api/auth/login  email, password, next
export async function POST(req: NextRequest) {
  const f = await body(req);
  const row = await checkLogin(f.email || "", f.password || "");
  if (!row) return done(req, "/login", "Wrong email or password.", {}, 401);
  await startSession(row.customer_id);
  const fallback = row.role === "admin" ? "/admin" : "/";
  return done(req, safeNext(f.next, fallback), `Welcome back, ${row.first_name}!`, { role: row.role });
}
