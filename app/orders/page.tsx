import Link from "next/link";
import { listOrders } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Empty, money } from "@/components/ui";

export const metadata = { title: "Orders" };

export default async function Orders() {
  const user = await requireUser("/orders");
  const orders = await listOrders(user.customer_id);
  return (
    <section className="band band-cream">
      <div className="section-head"><h2 className="ink">Your orders</h2></div>
      {orders.length ? (
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Date</th><th>Pieces</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr key={o.order_id}>
                <td><Link href={`/orders/${o.order_id}`}>#{o.order_id}</Link></td>
                <td>{String(o.order_date).slice(0, 10)}</td><td>{o.pieces}</td>
                <td><span className={`status status-${String(o.status).toLowerCase()}`}>{o.status}</span></td>
                <td className="num">{money(o.total_amount)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      ) : <Empty text="No orders yet. Your first one is a few clicks away." />}
    </section>
  );
}
