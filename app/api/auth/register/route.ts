import type { NextRequest } from "next/server";
import { createCustomer } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { body, done, route } from "@/lib/http";

// POST /api/auth/register  first_name, last_name, email, phone, password
export const POST = route("/register", async (req: NextRequest) => {
  const f = await body(req);
  const v = { first_name: (f.first_name || "").trim(), last_name: (f.last_name || "").trim(),
    email: (f.email || "").trim(), phone: (f.phone || "").trim(), password: f.password || "" };
  if (!v.first_name || !v.last_name || !v.email.includes("@") || v.password.length < 6)
    return done(req, "/register", "Fill in your name, a valid email and a password of 6+ characters.", {}, 400);
  // trg_customers_before_insert refuses a duplicate email with its own message
  const id = await createCustomer(v);
  await startSession(id);
  return done(req, "/", `Welcome aboard, ${v.first_name}!`, { customer_id: id });
});
