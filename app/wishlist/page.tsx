import { wishlistProducts } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Empty, ProductCard } from "@/components/ui";

export const metadata = { title: "Wishlist" };

export default async function Wishlist() {
  const user = await requireUser("/wishlist");
  const products = await wishlistProducts(user.customer_id);
  return (
    <section className="band band-blue">
      <div className="section-head"><h2>Your wishlist</h2><p>{products.length} saved</p></div>
      {products.length
        ? <div className="grid">{products.map(p => <ProductCard key={p.product_id} p={p} next="/wishlist" />)}</div>
        : <Empty text="Nothing saved yet. Tap ♡ on any product page." />}
    </section>
  );
}
