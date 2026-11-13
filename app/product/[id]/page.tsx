import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/lib/db";
import { getDetails, logEvent, relatedIds } from "@/lib/mongo";
import { currentUser } from "@/lib/auth";
import { ProductCard, Stars, money, plural } from "@/components/ui";

const label = (k: string) => k.replace(/_/g, " ").replace(/\bcm\b/, "(cm)").replace(/\bgsm\b/, "(gsm)");
const show = (v: unknown) => Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

export default async function Product({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const p = await db.getProduct(id);
  if (!p) notFound();
  const user = await currentUser();
  const [images, reviews, summary, details, wished, rel] = await Promise.all([
    db.productImages(id), db.productReviews(id), db.reviewSummary(id), getDetails(id),
    user ? db.isWished(user.customer_id, id) : false, relatedIds(id)]);
  const related = await db.productsByIds(rel);
  await logEvent({ type: "view", product_id: id, customer_id: user?.customer_id ?? null });
  return (
    <>
      <section className="band band-cream">
        <div className="detail">
          <div className="gallery">{images.map((img, i) => <img key={i} src={img.image_url} alt={`${p.name} cover ${i + 1}`} />)}</div>
          <div className="detail-info">
            <p className="crumb"><Link href={`/shop?c=${p.category_id}`}>{p.category}</Link> · SKU {p.sku}</p>
            <h1 className="ink">{p.name}</h1>
            <p><Stars rating={summary?.avg} /> {summary?.n ? <>{summary.avg} from <a href="#reviews">{plural(summary.n, "review")}</a></> : "No reviews yet"}</p>
            <p className="price big">{money(p.price)}</p>
            <p>{p.description}</p>
            <p className={`stock${p.stock_quantity <= 5 ? " low" : ""}`}>
              {p.stock_quantity === 0 ? "Sold out" : p.stock_quantity <= 5 ? `Only ${p.stock_quantity} left` : `${p.stock_quantity} in stock`}
              {" "}· supplied by {p.supplier}, {p.supplier_city}
            </p>
            <div className="actions">
              <form method="post" action="/api/cart" className="inline">
                <input type="hidden" name="product_id" value={id} />
                <input type="number" name="quantity" defaultValue={1} min={1} max={Math.min(p.stock_quantity, 20) || 1} aria-label="Quantity" />
                <button className="btn btn-orange" disabled={p.stock_quantity === 0}>Add to cart</button>
              </form>
              <form method="post" action={`/api/wishlist/${id}`}>
                <button className="btn btn-white">{wished ? "♥ In wishlist" : "♡ Wishlist"}</button>
              </form>
            </div>
            {details && (
              <div className="panel specs">
                <h3>Specs <span className="pill">{details.format}</span> <small>from MongoDB</small></h3>
                <dl>{Object.entries(details.specs).map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd>{show(v)}</dd></div>)}</dl>
                <p className="tags">{details.tags.map(t => <Link key={t} className="tag" href={`/shop?tag=${encodeURIComponent(t)}`}>{t}</Link>)}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="band band-yellow" id="reviews">
        <div className="section-head"><h2 className="ink">Reader reviews</h2></div>
        <div className="reviews">
          {reviews.length ? reviews.map((r, i) => (
            <div key={i} className="bubble review">
              <p><Stars rating={r.rating} /> <b>{r.first_name}</b> <small>{String(r.review_date).slice(0, 10)}</small></p>
              <p>{r.comment}</p>
            </div>
          )) : <p className="bubble">Nobody has reviewed this yet. Be the first.</p>}
        </div>
        {user ? (
          <form className="panel form" method="post" action={`/api/products/${id}/reviews`}>
            <h3>Write a review</h3>
            <label>Rating
              <select name="rating" required>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</select>
            </label>
            <label>Comment <textarea name="comment" rows={3} maxLength={500} placeholder="What did you think?" /></label>
            <button className="btn">Post review</button>
          </form>
        ) : <p><Link className="btn btn-small" href={`/login?next=/product/${id}`}>Log in to review</Link></p>}
      </section>

      {related.length > 0 && (
        <section className="band band-blue">
          <div className="section-head"><h2>You might also like</h2><p>Products sharing the most tags, found by a MongoDB aggregation.</p></div>
          <div className="grid">{related.map(r => <ProductCard key={r.product_id} p={r} next={`/product/${id}`} />)}</div>
        </section>
      )}
    </>
  );
}
