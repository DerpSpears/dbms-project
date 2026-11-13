import { NextResponse, type NextRequest } from "next/server";
import { searchProducts } from "@/lib/db";

// GET /api/products?q=&c=&sort=  -> products as JSON (FULLTEXT search in MariaDB)
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams;
  return NextResponse.json(await searchProducts({ search: s.get("q") || "", category: Number(s.get("c")) || undefined, sort: s.get("sort") || "new" }));
}
