import type { NextRequest } from "next/server";
import { advanceOrder } from "@/lib/db";
import { apiUser, done, route, backTo } from "@/lib/http";

// POST /api/admin/orders/:id/advance  (admin) sp_advance_order -> trigger syncs order + payment
export const POST = route("/admin", async (req, { params }) => {
  const r = req as NextRequest;
  const { user, res } = await apiUser(r, "admin");
  if (!user) return res!;
  const id = Number((await params).id);
  await advanceOrder(id);
  return done(r, backTo(r, "/admin"), `Order #${id} moved one step forward.`);
});
