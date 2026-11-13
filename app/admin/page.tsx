import Link from "next/link";
import * as db from "@/lib/db";
import * as m from "@/lib/mongo";
import { requireAdmin } from "@/lib/auth";
import { money } from "@/components/ui";

export const metadata = { title: "Admin" };

export default async function Admin() {
  await requireAdmin();
  const [stats, orders, products, reviews, tiers, hot, searches, daily, conv] = await Promise.all([
    db.adminStats(), db.adminOrders(), db.adminProducts(), db.adminReviews(), db.customerTiers(),
    m.trending(7, 5), m.topSearches(), m.dailyActivity(), m.conversion()]);
  const name = (id: number) => products.find(p => p.product_id === id)?.name ?? `#${id}`;
  const peak = Math.max(1, ...daily.map(d => d.view + d.search + d.add_to_cart + d.order));
  return (
    <>
      <section className="band band-cream">
        <div className="section-head">
          <h2 className="ink">Admin dashboard</h2>
          <p>Every query on this page runs as the MariaDB user <code>inkpow_staff</code> (role <code>inkpow_admin</code>).
            Shoppers use <code>inkpow_web</code> (role <code>inkpow_customer</code>), which cannot do any of this.</p>
        </div>
        <div className="kpis">
          <div className="panel"><small>Orders</small><b>{stats?.orders}</b></div>
          <div className="panel"><small>Revenue</small><b>{money(stats?.revenue)}</b></div>
          <div className="panel"><small>Open orders</small><b>{stats?.open_orders}</b></div>
          <div className="panel"><small>Customers</small><b>{stats?.customers}</b></div>
          <div className="panel"><small>Low stock</small><b>{stats?.low_stock}</b></div>
        </div>
      </section>

      <section className="band band-yellow" id="orders">
        <div className="section-head"><h2 className="ink">Orders</h2><p>From the view <code>v_order_summary</code>. Moving an order calls <code>sp_advance_order</code>.</p></div>
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Pieces</th><th>Payment</th><th>Status</th><th className="num">Total</th><th></th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.order_id}>
                <td><Link href={`/orders/${o.order_id}`}>#{o.order_id}</Link></td><td>{o.customer}</td>
                <td>{String(o.order_date).slice(0, 10)}</td><td>{o.pieces}</td>
                <td>{o.payment_method} · {o.payment_status}</td>
                <td><span className={`status status-${String(o.status).toLowerCase()}`}>{o.status}</span></td>
                <td className="num">{money(o.total_amount)}</td>
                <td>{o.status !== "Delivered" && (
                  <form method="post" action={`/api/admin/orders/${o.order_id}/advance`}>
                    <button className="btn btn-small btn-white">{o.status === "Processing" ? "Ship" : "Deliver"}</button>
                  </form>)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="band band-blue" id="products">
        <div className="section-head">
          <h2>Stock and prices</h2>
          <p>UPDATE on products. CHECK constraints refuse a negative price or stock.</p>
          <form method="post" action="/api/admin/restock"><button className="btn btn-small btn-orange">Run sp_restock_low_stock(5, 10)</button></form>
        </div>
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>#</th><th>Product</th><th>Category</th><th>Price and stock</th><th>MongoDB specs</th></tr></thead>
            <tbody>{products.map(p => (
              <tr key={p.product_id}>
                <td>{p.product_id}</td><td><Link href={`/product/${p.product_id}`}>{p.name}</Link><br /><small>{p.sku}</small></td>
                <td>{p.category}</td>
                <td>
                  <form method="post" action={`/api/admin/products/${p.product_id}`} className="inline">
                    <input type="number" name="price" step="0.01" defaultValue={p.price} aria-label="Price" />
                    <input type="number" name="stock_quantity" defaultValue={p.stock_quantity} aria-label="Stock" className={p.stock_quantity <= 5 ? "low" : ""} />
                    <button className="btn btn-small btn-white">Save</button>
                  </form>
                </td>
                <td><Link className="btn btn-small" href={`/admin/products/${p.product_id}`}>Edit specs</Link></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="band band-cream" id="insights">
        <div className="section-head"><h2 className="ink">Activity insights (MongoDB)</h2>
          <p>Aggregation pipelines over the <code>activity</code> collection. Every product view, search, cart add and order is logged there.</p></div>
        <div className="adv-grid">
          <div className="panel adv">
            <h3>Trending (7 days)</h3>
            <table className="mini"><thead><tr><th>Product</th><th>Views</th><th>Viewers</th></tr></thead>
              <tbody>{hot.map(h => <tr key={h.product_id}><td>{name(h.product_id)}</td><td>{h.views}</td><td>{h.viewers}</td></tr>)}</tbody></table>
            <p className="hint">$match → $group → $project → $sort → $limit</p>
          </div>
          <div className="panel adv">
            <h3>Top searches</h3>
            <table className="mini"><thead><tr><th>Query</th><th>Times</th><th>Avg results</th></tr></thead>
              <tbody>{searches.map(s => <tr key={s.query}><td>{s.query}</td><td>{s.times}</td><td>{s.avg_results}</td></tr>)}</tbody></table>
            <p className="hint">$group on $toLower(query), $avg of results</p>
          </div>
          <div className="panel adv">
            <h3>View → cart conversion</h3>
            <table className="mini"><thead><tr><th>Product</th><th>Views</th><th>Adds</th><th>%</th></tr></thead>
              <tbody>{conv.map(c => <tr key={c.product_id}><td>{name(c.product_id)}</td><td>{c.views}</td><td>{c.adds}</td><td>{c.rate}</td></tr>)}</tbody></table>
            <p className="hint">$group with $cond counts, then $divide</p>
          </div>
          <div className="panel adv wide">
            <h3>Events per day (14 days)</h3>
            <div className="bars" role="img" aria-label="Events per day">
              {daily.map(d => {
                const total = d.view + d.search + d.add_to_cart + d.order;
                return <div key={d.day} title={`${d.day}: ${d.view} views, ${d.search} searches, ${d.add_to_cart} cart adds, ${d.order} orders`}>
                  <i style={{ height: `${(total / peak) * 100}%` }} /><span>{d.day.slice(8)}</span></div>;
              })}
            </div>
            <p className="hint">$dateToString → two $group stages → $arrayToObject</p>
          </div>
        </div>
      </section>

      <section className="band band-yellow" id="reviews">
        <div className="section-head"><h2 className="ink">Customers and reviews</h2><p>Loyalty tiers come from <code>sp_customer_tiers</code> (a cursor). Deleting a review is admin-only.</p></div>
        <div className="adv-grid">
          <div className="panel adv">
            <h3>Loyalty tiers</h3>
            <table className="mini"><thead><tr><th>Customer</th><th>Spent</th><th>Tier</th></tr></thead>
              <tbody>{tiers.map((t: any, i: number) => <tr key={i}><td>{t.customer}</td><td>{money(t.total_spent)}</td><td>{t.tier}</td></tr>)}</tbody></table>
          </div>
          <div className="panel adv wide">
            <h3>Reviews</h3>
            <table className="mini"><thead><tr><th>Product</th><th>By</th><th>★</th><th>Comment</th><th></th></tr></thead>
              <tbody>{reviews.map(r => (
                <tr key={r.review_id}><td>{r.product}</td><td>{r.first_name}</td><td>{r.rating}</td><td>{r.comment}</td>
                  <td><form method="post" action={`/api/admin/reviews/${r.review_id}`}><button className="btn btn-small btn-white">Delete</button></form></td></tr>))}
              </tbody></table>
          </div>
        </div>
      </section>
    </>
  );
}
