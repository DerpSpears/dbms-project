import { NextResponse, type NextRequest } from "next/server";
import { changeTag, deleteDetails, getDetails, saveDetails } from "@/lib/mongo";
import { apiUser, body, done } from "@/lib/http";

// MongoDB product_details for one product.
// GET  -> the document
// POST action=save   format, specs (JSON text), tags (comma separated)  -> upsert
// POST action=tag    tag, add=1|0                                        -> $addToSet / $pull
// POST action=delete                                                     -> deleteOne
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json(await getDetails(Number((await params).id)));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, res } = await apiUser(req, "admin");
  if (!user) return res!;
  const id = Number((await params).id);
  const f = await body(req);
  const back = `/admin/products/${id}`;
  if (f.action === "delete") {
    await deleteDetails(id);
    return done(req, back, "MongoDB document deleted.");
  }
  if (f.action === "tag") {
    const tag = (f.tag || "").trim().toLowerCase();
    if (tag) await changeTag(id, tag, f.add === "1");
    return done(req, back, f.add === "1" ? `Tag “${tag}” added.` : `Tag “${tag}” removed.`);
  }
  let specs: Record<string, unknown>;
  try {
    specs = JSON.parse(f.specs || "{}");
    if (!specs || typeof specs !== "object" || Array.isArray(specs)) throw new Error();
  } catch { return done(req, back, "Specs must be a JSON object, like {\"pages\": 32}.", {}, 400); }
  const tags = (f.tags || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  try { await saveDetails(id, { format: (f.format || "").trim() || "other", specs, tags }); }
  catch (e: any) { return done(req, back, "MongoDB refused it: " + (e.errmsg || e.message), {}, 400); }
  return done(req, back, "MongoDB document saved.");
}
