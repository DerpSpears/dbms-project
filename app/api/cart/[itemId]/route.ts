import type { NextRequest } from "next/server";
import { setCartQuantity } from "@/lib/db";
import { apiUser, body, done, route } from "@/lib/http";

// POST /api/cart/:itemId  quantity (0 removes the line)
export const POST = route("/cart", async (req, { params }) => {
  const { user, res } = await apiUser(req as NextRequest);
  if (!user) return res!;
  const f = await body(req as NextRequest);
  await setCartQuantity(user.customer_id, Number((await params).itemId), Math.min(Number(f.quantity) || 0, 20));
  return done(req as NextRequest, "/cart");
});
