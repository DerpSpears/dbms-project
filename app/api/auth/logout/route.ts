import type { NextRequest } from "next/server";
import { endSession } from "@/lib/auth";
import { done } from "@/lib/http";

export async function POST(req: NextRequest) {
  await endSession();
  return done(req, "/", "Logged out. See you next issue!");
}
