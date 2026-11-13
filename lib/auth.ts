// Login sessions: a signed JWT (HS256) in an httpOnly cookie. The secret comes from
// SESSION_SECRET. The role inside the token decides which pages and API routes a
// user may reach; the database role of the connection decides what SQL may run.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { getCustomer, type User } from "./db";

const COOKIE = "inkpow_session";
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET || "");

export async function startSession(customerId: number) {
  const token = await new SignJWT({ sub: String(customerId) })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400,
    secure: process.env.NODE_ENV === "production" });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The logged-in user, read fresh from MariaDB (so a role change applies at once). */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return await getCustomer(Number(payload.sub));
  } catch { return null; }
});

/** For pages: send guests to the login page. */
export async function requireUser(next: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/?denied=1");
  return user;
}
