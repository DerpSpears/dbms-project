import type { NextRequest } from "next/server";
import { updateProduct } from "@/lib/db";
import { apiUser, body, done, route } from "@/lib/http";

// POST /api/admin/products/:id  price, stock_quantity  (CHECK constraints refuse negatives)
export const POST = route("/admin#products", async (req, { params }) => {
  const r = req as NextRequest;
  const { user, res } = await apiUser(r, "admin");
  if (!user) return res!;
  const f = await body(r);
  const id = Number((await params).id);
  await updateProduct(id, Number(f.price), Number(f.stock_quantity));
  return done(r, "/admin#products", `Product #${id} updated.`);
});
