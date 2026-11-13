import { NextResponse, type NextRequest } from "next/server";
import { listOrders } from "@/lib/db";
import { apiUser } from "@/lib/http";

// GET /api/orders -> the logged-in customer's orders (view v_order_summary)
export async function GET(req: NextRequest) {
  const { user, res } = await apiUser(req);
  if (!user) return res!;
  return NextResponse.json(await listOrders(user.customer_id));
}
