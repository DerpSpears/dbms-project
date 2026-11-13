import { redirect } from "next/navigation";
import { cartRows, customerAddresses, PAYMENT_METHODS } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { money, plural } from "@/components/ui";

export const metadata = { title: "Checkout" };

export default async function Checkout() {
  const user = await requireUser("/checkout");
  const [items, addresses] = await Promise.all([cartRows(user.customer_id), customerAddresses(user.customer_id)]);
  if (!items.length) redirect("/shop");
  const total = items.reduce((s, i) => s + Number(i.line_total), 0);
  return (
    <section className="band band-cream">
      <div className="section-head"><h2 className="ink">Checkout</h2><p>{plural(items.length, "item")} · {money(total)}</p></div>
      <form method="post" action="/api/checkout" className="checkout">
        <div className="panel form">
          <h3>Ship to</h3>
          {addresses.map((a, i) => (
            <label key={a.address_id} className="radio">
              <input type="radio" name="address_id" value={a.address_id} defaultChecked={i === 0} />
              <span>{a.address_line}, {a.city}, {a.state} {a.postal_code}, {a.country}{a.is_default ? <> <b className="pill">default</b></> : null}</span>
            </label>
          ))}
          <label className="radio"><input type="radio" name="address_id" value="new" defaultChecked={!addresses.length} /><span>A new address</span></label>
          <div className="new-address">
            <label>Address line <input name="address_line" /></label>
            <div className="two"><label>City <input name="city" /></label><label>State <input name="state" /></label></div>
            <div className="two"><label>Postal code <input name="postal_code" /></label><label>Country <input name="country" defaultValue="India" /></label></div>
          </div>
        </div>
        <div className="panel form">
          <h3>Pay with</h3>
          {PAYMENT_METHODS.map((m, i) => <label key={m} className="radio"><input type="radio" name="payment_method" value={m} defaultChecked={i === 0} /><span>{m}</span></label>)}
          <p className="hint">This is a class demo. No real payment is taken.</p>
          <h3>Summary</h3>
          <ul className="summary">
            {items.map(i => <li key={i.cart_item_id}><span>{i.quantity} × {i.name}</span><span>{money(i.line_total)}</span></li>)}
            <li className="total"><span>Total</span><span>{money(total)}</span></li>
          </ul>
          <button className="btn btn-orange btn-block">Place order</button>
        </div>
      </form>
    </section>
  );
}
