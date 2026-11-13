import Link from "next/link";
import { cartRows } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Empty, money } from "@/components/ui";

export const metadata = { title: "Cart" };

export default async function Cart() {
  const user = await requireUser("/cart");
  const items = await cartRows(user.customer_id);
  const total = items.reduce((s, i) => s + Number(i.line_total), 0);
  return (
    <section className="band band-cream">
      <div className="section-head"><h2 className="ink">Your cart</h2></div>
      {items.length ? <>
        <div className="panel table-wrap">
          <table>
            <thead><tr><th colSpan={2}>Item</th><th>Price</th><th>Qty</th><th className="num">Total</th></tr></thead>
            <tbody>{items.map(i => (
              <tr key={i.cart_item_id}>
                <td className="thumb"><img src={i.image_url} alt="" /></td>
                <td><Link href={`/product/${i.product_id}`}>{i.name}</Link>
                  {i.quantity > i.stock_quantity && <><br /><small className="low">Only {i.stock_quantity} in stock</small></>}</td>
                <td>{money(i.price)}</td>
                <td>
                  <form method="post" action={`/api/cart/${i.cart_item_id}`} className="inline">
                    <input type="number" name="quantity" defaultValue={i.quantity} min={0} max={20} aria-label={`Quantity for ${i.name}`} />
                    <button className="btn btn-small btn-white">Update</button>
                  </form>
                </td>
                <td className="num">{money(i.line_total)}</td>
              </tr>))}
            </tbody>
            <tfoot><tr><th colSpan={4}>Total</th><th className="num">{money(total)}</th></tr></tfoot>
          </table>
        </div>
        <p className="hint">Set a quantity to 0 to remove an item.</p>
        <div className="actions">
          <Link className="btn btn-orange" href="/checkout">Checkout</Link>
          <Link className="btn btn-white" href="/shop">Keep shopping</Link>
        </div>
      </> : <Empty text="Your cart is empty. The shelf is not." />}
    </section>
  );
}
