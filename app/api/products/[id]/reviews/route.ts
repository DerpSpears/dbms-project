import type { NextRequest } from "next/server";
import { addReview } from "@/lib/db";
import { apiUser, body, done, route } from "@/lib/http";

// POST /api/products/:id/reviews  rating, comment
// No range check here on purpose: trg_reviews_before_insert and CHECK chk_reviews_rating enforce 1-5.
export const POST = route("/shop", async (req, { params }) => {
  const r = req as NextRequest;
  const { user, res } = await apiUser(r);
  if (!user) return res!;
  const id = Number((await params).id);
  const f = await body(r);
  await addReview(id, user.customer_id, Number(f.rating), (f.comment || "").trim().slice(0, 500));
  return done(r, `/product/${id}#reviews`, "Review saved. Thanks!");
});
