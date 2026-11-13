import Link from "next/link";
import * as db from "@/lib/db";
import { trending } from "@/lib/mongo";
import Opener from "@/components/Opener";
import { Burst, ProductCard, money, plural } from "@/components/ui";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [featured, products, categories, stats, quote, hot] = await Promise.all([
    db.featuredProduct(), db.latestProducts(8), db.listCategories(), db.reviewSummary(),
    db.latestFiveStarReview(), trending(7, 4)]);
  const hotProducts = await db.productsByIds(hot.map(h => h.product_id));
  return (
    <>
      <Opener />
      {sp.denied && <div className="flashes"><div className="bubble">That page is for admins only.</div></div>}
      <section className="hero">
        <div className="hero-text">
          <h1><span>Comics, manga and figures</span> picked by readers, packed flat and shipped fast.</h1>
          <p>A small store with two databases underneath: MariaDB for products, carts and orders,
            MongoDB for product specs and the activity feed. Open the Database tab to watch them change.</p>
          <div className="actions">
            <Link className="btn btn-orange" href="/shop">Explore the shelf</Link>
            <Link className="btn" href="/database">See the database</Link>
          </div>
        </div>
        {featured && (
          <Link className="hero-cover" href={`/product/${featured.product_id}`}>
            <span className="cloud">Top rated<br />{featured.rating} ★</span>
            <img src={featured.image_url} alt={`Cover of ${featured.name}`} />
            <span className="hero-tag">{featured.name} · {money(featured.price)}</span>
          </Link>
        )}
      </section>

      <section className="band band-blue">
        <div className="section-head">
          <h2>Fresh off the press</h2>
          <p>{plural(products.length, "piece")}, newest first.</p>
          <Link className="btn btn-small" href="/shop">Shop all</Link>
        </div>
        <div className="grid">{products.map((p, i) => <ProductCard key={p.product_id} p={p} index={i + 1} total={products.length} next="/" />)}</div>
      </section>

      {hotProducts.length > 0 && (
        <section className="band band-yellow">
          <div className="section-head">
            <h2 className="ink">Trending this week</h2>
            <p>Most viewed in the last 7 days, worked out by a MongoDB aggregation over the activity log.</p>
          </div>
          <ol className="flow">
            {hot.map(h => {
              const p = hotProducts.find(x => x.product_id === h.product_id);
              return p ? <li key={h.product_id}><b><Link href={`/product/${p.product_id}`}>{p.name}</Link></b><span>{h.views} views</span></li> : null;
            })}
          </ol>
        </section>
      )}

      <section className="band band-cream">
        <div className="section-head">
          <h2 className="ink">Pick a shelf</h2>
          <p>Each category points at its parent through <code>parent_category_id</code>.</p>
        </div>
        <ul className="shelves">
          {categories.map(c => (
            <li key={c.category_id}><Link href={`/shop?c=${c.category_id}`}>
              <small>{c.parent}</small><strong>{c.name}</strong><span>{plural(c.pieces, "piece")}</span>
            </Link></li>
          ))}
        </ul>
      </section>

      <section className="band band-yellow">
        <div className="section-head">
          <h2 className="ink">One order, five tables</h2>
          <p>Checkout is one stored procedure running one transaction. If any step fails, all of it rolls back.</p>
        </div>
        <ol className="flow">
          <li><b>cart_items</b><span>what you picked</span></li>
          <li><b>orders</b><span>one row per checkout</span></li>
          <li><b>order_items</b><span>price frozen at purchase</span></li>
          <li><b>payments</b><span>how it was paid</span></li>
          <li><b>shipments</b><span>carrier and tracking</span></li>
        </ol>
      </section>

      {quote && (
        <section className="band band-red">
          <div className="proof">
            <Burst text="YEAH!" fill="#fff" color="#F23A3A" />
            <div>
              <p className="proof-stat">{stats?.avg} out of 5 from {stats?.n} reader reviews</p>
              <blockquote className="bubble big">“{quote.comment}”</blockquote>
              <p className="proof-by">{quote.first_name}, on <Link href={`/product/${quote.product_id}`}>{quote.product}</Link></p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
