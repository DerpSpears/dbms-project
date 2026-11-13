import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder, orderItems } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { money } from "@/components/ui";

export default async function Order({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const user = await requireUser(`/orders/${id}`);
  const admin = user.role === "admin";
  // Customers only see their own orders; an admin may open any (and reads it with the admin role).
  const o = await getOrder(id, admin ? null : user.customer_id);
  if (!o) notFound();
  const items = await orderItems(id, admin ? "admin" : "customer");
  const step = ({ Processing: 1, Shipped: 2, Delivered: 3 } as Record<string, number>)[o.status] ?? 1;
  return (
    <section className="band band-cream">
      <div className="section-head">
        <h2 className="ink">Order #{o.order_id}</h2>
        <p>Placed {String(o.order_date).slice(0, 10)}{admin && <> by {o.first_name} {o.last_name}</>}</p>
        <span className={`status status-${String(o.status).toLowerCase()}`}>{o.status}</span>
      </div>
      <ol className="track">
        <li className="done"><b>Processing</b><span>{String(o.order_date).slice(0, 10)}</span></li>
        <li className={step >= 2 ? "done" : ""}><b>Shipped</b><span>{o.shipped_date ?? "waiting"}</span></li>
        <li className={step >= 3 ? "done" : ""}><b>Delivered</b><span>{o.delivered_date ?? "waiting"}</span></li>
      </ol>
      <div className="order-grid">
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th className="num">Total</th></tr></thead>
            <tbody>{items.map((i, k) => (
              <tr key={k}><td><Link href={`/product/${i.product_id}`}>{i.name}</Link></td><td>{i.quantity}</td>
                <td>{money(i.unit_price)}</td><td className="num">{money(i.line_total)}</td></tr>))}
            </tbody>
            <tfoot><tr><th colSpan={3}>Total</th><th className="num">{money(o.total_amount)}</th></tr></tfoot>
          </table>
        </div>
        <div className="panel facts">
          <h3>Ship to</h3>
          <p>{o.address_line}<br />{o.city}, {o.state} {o.postal_code}<br />{o.country}</p>
          <h3>Payment</h3>
          <p>{o.payment_method} · <b>{o.payment_status}</b></p>
          <h3>Shipment</h3>
          <p>{o.carrier} · {o.tracking_number}<br /><b>{o.shipment_status}</b></p>
          {admin && step < 3 && <>
            <form method="post" action={`/api/admin/orders/${id}/advance`}>
              <button className="btn btn-small btn-block">Mark as {step === 1 ? "shipped" : "delivered"}</button>
            </form>
            <p className="hint">Admin only. Calls sp_advance_order; a trigger then updates the order and payment.</p>
          </>}
        </div>
      </div>
      <p><Link className="btn btn-white btn-small" href={admin ? "/admin" : "/orders"}>← All orders</Link></p>
    </section>
  );
}
