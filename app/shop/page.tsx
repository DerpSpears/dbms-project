import Link from "next/link";
import { listCategories, searchProducts, SORTS } from "@/lib/db";
import { idsWithTag, logEvent, tagCloud } from "@/lib/mongo";
import { ProductCard, plural } from "@/components/ui";

export const metadata = { title: "Shop" };

export default async function Shop({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const search = (sp.q || "").trim(), cat = Number(sp.c) || undefined, sort = SORTS[sp.sort] ? sp.sort : "new";
  const tag = (sp.tag || "").trim();
  // The tag filter asks MongoDB which products carry the tag; MariaDB does the rest.
  const ids = tag ? await idsWithTag(tag) : undefined;
  const [products, categories, tags] = await Promise.all([
    searchProducts({ category: cat, search, sort, ids }), listCategories(), tagCloud()]);
  if (search) await logEvent({ type: "search", query: search, results: products.length });
  const here = "/shop?" + new URLSearchParams(Object.entries(sp)).toString();
  return (
    <section className="band band-blue">
      <div className="section-head">
        <h2>The shelf</h2>
        <p>{plural(products.length, "result")}{search && <> for “{search}”</>}{tag && <> tagged “{tag}”</>}</p>
      </div>
      <form className="filters" method="get">
        <input type="search" name="q" defaultValue={search} placeholder="Search titles and descriptions…" aria-label="Search" />
        <select name="c" defaultValue={cat ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.parent} › {c.name}</option>)}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s[0]}</option>)}
        </select>
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button className="btn btn-small">Go</button>
        {(cat || search || tag) && <Link className="btn btn-small btn-white" href="/shop">Clear</Link>}
      </form>
      <p className="tags">
        <small>Tags from MongoDB:</small>
        {tags.map(t => (
          <Link key={t.tag} className={`tag${t.tag === tag ? " on" : ""}`}
            href={`/shop?${new URLSearchParams({ ...sp, tag: t.tag === tag ? "" : t.tag }).toString()}`}>
            {t.tag} <i>{t.n}</i>
          </Link>
        ))}
      </p>
      {products.length
        ? <div className="grid">{products.map((p, i) => <ProductCard key={p.product_id} p={p} index={i + 1} total={products.length} next={here} />)}</div>
        : <p className="bubble big">Nothing matches that. Try a shorter search or another category.</p>}
    </section>
  );
}
