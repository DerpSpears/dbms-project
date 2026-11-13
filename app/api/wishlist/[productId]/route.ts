import type { NextRequest } from "next/server";
import { toggleWishlist } from "@/lib/db";
import { apiUser, done, route, backTo } from "@/lib/http";

// POST /api/wishlist/:productId  toggles the product in or out of the wishlist
export const POST = route("/wishlist", async (req, { params }) => {
  const r = req as NextRequest;
  const { user, res } = await apiUser(r);
  if (!user) return res!;
  const added = await toggleWishlist(user.customer_id, Number((await params).productId));
  return done(r, backTo(r, "/wishlist"), added ? "Saved to wishlist!" : "Removed from wishlist.", { added });
});
