import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { addToCart, cartRows, getProduct } from "@/lib/db";
import { logEvent } from "@/lib/mongo";
import { apiUser, body, done, route, safeNext } from "@/lib/http";

// GET /api/cart  -> the cart as JSON
export async function GET(req: NextRequest) {
  const { user, res } = await apiUser(req);
  if (!user) return res!;
  return NextResponse.json(await cartRows(user.customer_id));
}

// POST /api/cart  product_id, quantity, next   (stored procedure sp_add_to_cart)
export const POST = route("/cart", async (req: NextRequest) => {
  const { user, res } = await apiUser(req);
  if (!user) return res!;
  const f = await body(req);
  const pid = Number(f.product_id), qty = Math.max(1, Math.min(Number(f.quantity) || 1, 20));
  const p = await getProduct(pid);
  if (!p) return done(req, "/shop", "No such product.", {}, 404);
  await addToCart(user.customer_id, pid, qty);
  await logEvent({ type: "add_to_cart", product_id: pid, customer_id: user.customer_id, quantity: qty });
  return done(req, safeNext(f.next, "/cart"), `POW! ${p.name} is in your cart.`);
});
