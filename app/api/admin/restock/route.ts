import type { NextRequest } from "next/server";
import { restockLowStock } from "@/lib/db";
import { apiUser, done, route } from "@/lib/http";

// POST /api/admin/restock  (admin) cursor-based sp_restock_low_stock(5, 10)
export const POST = route("/admin", async (req: NextRequest) => {
  const { user, res } = await apiUser(req, "admin");
  if (!user) return res!;
  const rows = await restockLowStock(5, 10);
  const msg = rows.length
    ? "Restocked: " + rows.map((r: any) => `${r.product} ${r.old_stock}→${r.new_stock}`).join(", ")
    : "Nothing is at 5 or below, so nothing was restocked.";
  return done(req, "/admin#products", msg, { rows });
});
