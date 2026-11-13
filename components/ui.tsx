import Link from "next/link";

export const money = (v: unknown) => "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function Burst({ text, fill = "#FFD21F", color = "#F23A3A", className = "" }: { text: string; fill?: string; color?: string; className?: string }) {
  return (
    <svg className={`burst ${className}`} viewBox="0 0 200 140" aria-hidden="true">
      <polygon points="100,4 118,30 150,10 150,40 190,34 166,62 196,84 160,90 172,128 136,108 118,138 100,110 78,136 66,106 28,126 42,90 4,84 36,62 10,32 52,40 52,8 84,30"
        fill={fill} stroke="#111" strokeWidth="6" strokeLinejoin="round" />
      <text x="100" y="86" textAnchor="middle" fontSize="42" fill={color} stroke="#111" strokeWidth="5" paintOrder="stroke" transform="rotate(-8 100 70)">{text}</text>
    </svg>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  const r = rating ? Math.round(Number(rating)) : 0;
  return <span className="stars" title={`${rating ?? "No"} rating`}>{"★".repeat(r)}<i>{"★".repeat(5 - r)}</i></span>;
}

export function ProductCard({ p, index, total, next = "/shop" }: { p: any; index?: number; total?: number; next?: string }) {
  return (
    <article className="card">
      <Link className="card-img" href={`/product/${p.product_id}`}>
        <img src={p.image_url} alt={`Cover of ${p.name}`} loading="lazy" />
        {p.stock_quantity === 0 ? <span className="badge badge-dark">Sold out</span>
          : p.stock_quantity <= 5 ? <span className="badge badge-red">Only {p.stock_quantity} left</span>
          : p.is_new ? <span className="badge">New</span> : null}
      </Link>
      <div className="card-body">
        <div className="card-meta">
          <span>{p.category}</span>
          {index ? <span>{String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}</span> : null}
        </div>
        <h3><Link href={`/product/${p.product_id}`}>{p.name}</Link></h3>
        <div className="card-row"><strong className="price">{money(p.price)}</strong><Stars rating={p.rating} /></div>
        <form method="post" action="/api/cart">
          <input type="hidden" name="product_id" value={p.product_id} />
          <input type="hidden" name="next" value={next} />
          <button className="btn btn-small btn-block" disabled={p.stock_quantity === 0}>Quick add</button>
        </form>
      </div>
    </article>
  );
}

export function Empty({ text, href = "/shop", cta = "Browse the shelf" }: { text: string; href?: string; cta?: string }) {
  return <><p className="bubble big">{text}</p><p><Link className="btn" href={href}>{cta}</Link></p></>;
}
