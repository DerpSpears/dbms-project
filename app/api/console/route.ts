import { NextResponse, type NextRequest } from "next/server";
import { runConsole } from "@/lib/db";

// GET /api/console?sql=...  runs as the read-only MariaDB user
export async function GET(req: NextRequest) {
  const sql = req.nextUrl.searchParams.get("sql") || "";
  return NextResponse.json(sql ? await runConsole(sql) : { columns: [], rows: [] });
}
