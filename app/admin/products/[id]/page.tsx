import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/db";
import { getDetails } from "@/lib/mongo";
import { requireAdmin } from "@/lib/auth";

export default async function EditDetails({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  const p = await getProduct(id);
  if (!p) notFound();
  const d = await getDetails(id);
  const action = `/api/admin/details/${id}`;
  return (
    <section className="band band-cream">
      <div className="section-head">
        <h2 className="ink">{p.name}: MongoDB document</h2>
        <p>Collection <code>product_details</code>, matched to MariaDB by <code>product_id = {id}</code>.
          Price and stock stay in MariaDB; these flexible specs live here.</p>
      </div>
      <div className="checkout">
        <form className="panel form" method="post" action={action}>
          <h3>{d ? "Update" : "Create"} (updateOne with upsert)</h3>
          <input type="hidden" name="action" value="save" />
          <label>Format <input name="format" defaultValue={d?.format ?? ""} placeholder="comic, manga, figure, poster…" /></label>
          <label>Specs (JSON object)
            <textarea name="specs" rows={10} spellCheck={false} className="mono" defaultValue={JSON.stringify(d?.specs ?? {}, null, 2)} /></label>
          <label>Tags (comma separated) <input name="tags" defaultValue={d?.tags.join(", ") ?? ""} /></label>
          <button className="btn btn-orange btn-block">Save document</button>
          <p className="hint">The collection has a $jsonSchema validator: product_id must be an int, specs an object, tags an array of strings.</p>
        </form>
        <div className="panel form">
          <h3>Read (findOne)</h3>
          <pre className="doc">{d ? JSON.stringify(d, null, 2) : "No document for this product."}</pre>
          {d && <>
            <h3>Tags ($addToSet / $pull)</h3>
            <p className="tags">{d.tags.map(t => (
              <form key={t} method="post" action={action} className="inline">
                <input type="hidden" name="action" value="tag" /><input type="hidden" name="add" value="0" /><input type="hidden" name="tag" value={t} />
                <button className="tag" title="Remove">{t} ✕</button>
              </form>))}</p>
            <form method="post" action={action} className="inline">
              <input type="hidden" name="action" value="tag" /><input type="hidden" name="add" value="1" />
              <input name="tag" placeholder="new tag" aria-label="New tag" /><button className="btn btn-small btn-white">Add tag</button>
            </form>
            <h3>Delete (deleteOne)</h3>
            <form method="post" action={action}>
              <input type="hidden" name="action" value="delete" />
              <button className="btn btn-small">Delete this document</button>
            </form>
          </>}
        </div>
      </div>
      <p><Link className="btn btn-white btn-small" href="/admin#products">← Back to admin</Link></p>
    </section>
  );
}
