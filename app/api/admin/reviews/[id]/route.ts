import type { NextRequest } from "next/server";
import { deleteReview } from "@/lib/db";
import { apiUser, done, route } from "@/lib/http";

// POST /api/admin/reviews/:id  (admin) DELETE a review
export const POST = route("/admin#reviews", async (req, { params }) => {
  const r = req as NextRequest;
  const { user, res } = await apiUser(r, "admin");
  if (!user) return res!;
  await deleteReview(Number((await params).id));
  return done(r, "/admin#reviews", "Review deleted.");
});
