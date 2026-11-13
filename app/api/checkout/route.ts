import type { NextRequest } from "next/server";
import { getOrder, placeOrder } from "@/lib/db";
import { logEvent } from "@/lib/mongo";
import { apiUser, body, done, route } from "@/lib/http";

// POST /api/checkout  address_id ("new" or an id), address fields, payment_method
// Everything happens inside sp_place_order as one transaction.
export const POST = route("/cart", async (req: NextRequest) => {
  const { user, res } = await apiUser(req);
  if (!user) return res!;
  const f = await body(req);
  let addressId: number | null = null;
  const a = { address_line: f.address_line?.trim(), city: f.city?.trim(), state: f.state?.trim(),
    postal_code: f.postal_code?.trim(), country: f.country?.trim() };
  if ((f.address_id || "new") === "new") {
    if (!Object.values(a).every(Boolean)) return done(req, "/checkout", "Fill in every address field.", {}, 400);
  } else addressId = Number(f.address_id);
  const orderId = await placeOrder(user.customer_id, f.payment_method || "", addressId, a);
  const o = await getOrder(orderId, user.customer_id);
  await logEvent({ type: "order", order_id: orderId, customer_id: user.customer_id, total: Number(o?.total_amount ?? 0) });
  return done(req, `/orders/${orderId}`, `BOOM! Order #${orderId} placed.`, { order_id: orderId });
});
