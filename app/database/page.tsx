import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as db from "@/lib/db";
import { describeMongo } from "@/lib/mongo";
import { REPORTS } from "@/lib/reports";

export const metadata = { title: "Database" };

const q = (sql: string) => `/database?sql=${encodeURIComponent(sql)}#result`;

const PIPELINES: [string, string, string][] = [
  ["Trending products", "admin dashboard, home page", `db.activity.aggregate([
  { $match: { type: "view", at: { $gte: <7 days ago> } } },
  { $group: { _id: "$product_id", views: { $sum: 1 },
              viewers: { $addToSet: "$customer_id" } } },
  { $project: { product_id: "$_id", views: 1, viewers: { $size: "$viewers" } } },
  { $sort: { views: -1 } }, { $limit: 5 }
])`],
  ["Tag cloud", "shop page", `db.product_details.aggregate([
  { $unwind: "$tags" },
  { $group: { _id: "$tags", n: { $sum: 1 } } },
  { $sort: { n: -1, _id: 1 } }
])`],
  ["Related products", "product page", `db.product_details.aggregate([
  { $match: { product_id: { $ne: <id> }, tags: { $in: <this product's tags> } } },
  { $project: { product_id: 1,
      shared: { $size: { $setIntersection: ["$tags", <this product's tags>] } } } },
  { $sort: { shared: -1 } }, { $limit: 4 }
])`],
  ["Events per day", "admin dashboard", `db.activity.aggregate([
  { $match: { at: { $gte: <14 days ago> } } },
  { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$at" } },
                     type: "$type" }, n: { $sum: 1 } } },
  { $group: { _id: "$_id.day", counts: { $push: { k: "$_id.type", v: "$n" } } } },
  { $replaceRoot: { newRoot: { $mergeObjects: [{ day: "$_id" }, { $arrayToObject: "$counts" }] } } },
  { $sort: { day: 1 } }
])`],
];

export default async function Database({ searchParams }: { searchParams: Promise<{ sql?: string }> }) {
  const sql = ((await searchParams).sql || "").trim();
  const [schema, objects, mongoInfo, result] = await Promise.all([
    db.describeSchema(), db.advancedObjects(), describeMongo(), sql ? db.runConsole(sql) : null]);
  const er = readFileSync(join(process.cwd(), "data", "er.svg"), "utf8");
  const mapping: [string, string, string][] = JSON.parse(readFileSync(join(process.cwd(), "data", "mapping.json"), "utf8"));
  return (
    <>
      <section className="band band-cream">
        <div className="section-head">
          <h2 className="ink">The ER diagram</h2>
          <p>Where the design starts. Click an entity to see its rows; hover a diamond to see what it turned into.</p>
        </div>
        <label className="fit"><input type="checkbox" /> Fit the whole diagram on screen (otherwise scroll sideways)</label>
        <div className="er-wrap" dangerouslySetInnerHTML={{ __html: er }} />
        <ul className="legend">
          <li><i className="lg lg-ent" /> entity</li><li><i className="lg lg-weak" /> weak entity</li>
          <li><i className="lg lg-rel" /> relationship</li><li><i className="lg lg-attr" /> attribute</li>
          <li><u>underlined</u> = key</li><li><i className="lg lg-total" /> double line, as drawn</li>
        </ul>
        <h3 className="sub">From diagram to tables</h3>
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Relationship</th><th>Type</th><th>Became</th></tr></thead>
            <tbody>{mapping.map(([n, k, m]) => <tr key={n}><td>{n}</td><td>{k}</td><td><code>{m}</code></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="band band-yellow">
        <div className="section-head">
          <h2 className="ink">The tables (MariaDB)</h2>
          <p>{schema.length} tables. Click a table to see its rows.</p>
        </div>
        <div className="schema">
          {schema.map(t => (
            <div key={t.name} className="panel table-card">
              <Link className="table-name" href={q(db.browseSql(t.name))}>{t.name} <span className="pill">{t.rows} rows</span></Link>
              <ul>{t.cols.map((c: any) => (
                <li key={c.name}>
                  <span>{c.name}{c.pk ? <> <b className="key pk">PK</b></> : null}{c.fk && <> <b className="key fk" title={`references ${c.fk}`}>FK → {c.fk}</b></>}</span>
                  <small>{String(c.type).toLowerCase()}</small>
                </li>))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="band band-cream" id="ddl">
        <div className="section-head">
          <h2 className="ink">Changing the schema: ALTER and DROP</h2>
          <p><code>db/schema.sql</code> is the diagram exactly as drawn. <code>db/migrations.sql</code> then changes the live
            database: a role column, CHECK constraints, a UNIQUE key and a FULLTEXT index.</p>
        </div>
        <div className="adv-grid">
          <div className="panel adv wide"><h3>db/migrations.sql</h3><pre>{db.sqlFile("migrations.sql")}</pre></div>
          <div className="panel adv">
            <h3>Try them</h3>
            <ul className="try">
              <li><Link href={q("SELECT CONSTRAINT_NAME, TABLE_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()")}>List the CHECK constraints</Link></li>
              <li><Link href={q("SELECT name, price FROM products WHERE MATCH(name, description) AGAINST ('city* robot*' IN BOOLEAN MODE)")}>Full-text search</Link></li>
              <li><Link href={q("SELECT first_name, email, role FROM customers")}>See the role column</Link></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="band band-red" id="advanced">
        <div className="section-head">
          <h2>Advanced features</h2>
          <p>Everything in <code>db/advanced.sql</code>, checked live against the database. Sign-up, add to cart, checkout and order tracking all run through them.</p>
        </div>
        <div className="adv-grid">
          {objects.map(g => (
            <div key={g.title} className="panel adv">
              <h3>{g.title} <span className="pill">{g.items.length}</span></h3>
              {g.items.map(o => (
                <details key={o.name}>
                  <summary><code>{o.name}</code>{o.live ? <b className="live" title="exists in the live database">live</b> : <b className="live missing">missing</b>}</summary>
                  {o.about && <p>{o.about}</p>}
                  <pre>{o.sql}</pre>
                </details>
              ))}
            </div>
          ))}
          <div className="panel adv">
            <h3>Try them</h3>
            <p>Each link loads a query into the console below.</p>
            <ul className="try">
              <li><Link href={q("SELECT name, price, rating, image_url FROM v_product_catalog ORDER BY rating DESC")}>Query a view</Link></li>
              <li><Link href={q("SELECT name, fn_product_rating(product_id) AS rating FROM products")}>Call a stored function</Link></li>
              <li><Link href={q("CALL sp_customer_tiers()")}>Call a procedure that uses a cursor</Link></li>
              <li><Link href={q("SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()")}>List the triggers</Link></li>
              <li><Link href={q("SELECT password_hash FROM customers")}>See a privilege refuse a column</Link></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="band band-yellow" id="roles">
        <div className="section-head">
          <h2 className="ink">Roles and privileges</h2>
          <p>Two kinds of user in the app (customer, admin), and a MariaDB role behind each one. The web app logs in to
            MariaDB as a different user depending on who is using it, so the database itself refuses what a role may not do.</p>
        </div>
        <div className="adv-grid">
          <div className="panel adv">
            <h3>Who connects as what</h3>
            <table className="mini">
              <thead><tr><th>App user</th><th>MariaDB user</th><th>Role</th></tr></thead>
              <tbody>
                <tr><td>Guest / customer</td><td>inkpow_web</td><td>inkpow_customer</td></tr>
                <tr><td>Admin</td><td>inkpow_staff</td><td>inkpow_admin</td></tr>
                <tr><td>SQL console</td><td>inkpow_ro</td><td>inkpow_readonly</td></tr>
                <tr><td>Reset script</td><td>inkpow</td><td>owner (DDL)</td></tr>
              </tbody>
            </table>
            <p className="hint">Customers may INSERT into customers but not the role column, so nobody can sign up as an admin. Admins can change data but not DROP or ALTER.</p>
          </div>
          <div className="panel adv wide"><h3>db/security.sql</h3><pre>{db.sqlFile("security.sql")}</pre></div>
        </div>
      </section>

      <section className="band band-blue" id="mongo">
        <div className="section-head">
          <h2>MongoDB: the document side</h2>
          <p>Product specs differ by product type, and the activity log is a high-volume stream that is only ever summarised.
            Neither fits fixed SQL columns well, so they live in MongoDB, linked to MariaDB by <code>product_id</code>.</p>
        </div>
        <div className="adv-grid">
          {mongoInfo.map(c => (
            <div key={c.name} className="panel adv">
              <h3>{c.name} <span className="pill">{c.count} docs</span></h3>
              <table className="mini"><thead><tr><th>Index</th><th>Key</th></tr></thead>
                <tbody>{c.indexes.map(i => <tr key={i.name}><td>{i.name}{i.unique ? " (unique)" : ""}{i.ttl ? ` (TTL ${i.ttl / 86400} days)` : ""}</td><td><code>{i.key}</code></td></tr>)}</tbody></table>
              <details><summary>Sample document</summary><pre>{JSON.stringify(c.sample, null, 2)}</pre></details>
            </div>
          ))}
          <div className="panel adv">
            <h3>Aggregation pipelines <span className="pill">{PIPELINES.length}</span></h3>
            {PIPELINES.map(([t, where, code]) => (
              <details key={t}><summary><code>{t}</code> <small>{where}</small></summary><pre>{code}</pre></details>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-blue">
        <div className="section-head">
          <h2>Ready-made reports</h2>
          <p>Each one loads into the console below, so you can read the SQL and edit it.</p>
        </div>
        <div className="reports">
          {REPORTS.map(([title, tag, sqlText]) => (
            <Link key={title} className="report" href={q(sqlText)}><strong>{title}</strong><span>{tag}</span></Link>
          ))}
        </div>
      </section>

      <section className="band band-cream" id="result">
        <div className="section-head">
          <h2 className="ink">SQL console</h2>
          <p>Runs as the read-only MariaDB user <code>inkpow_ro</code>: SELECT and CALL sp_customer_tiers work, writes are refused, and customers.password_hash is off limits.</p>
        </div>
        <form method="get" action="/database#result" className="console">
          <textarea name="sql" rows={Math.min(Math.max(sql.split("\n").length + 1, 4), 14)} spellCheck={false} aria-label="SQL query"
            placeholder="SELECT name, price FROM products ORDER BY price DESC;" defaultValue={sql} key={sql} />
          <button className="btn btn-orange">Run query</button>
        </form>
        {result?.error ? <p className="bubble error">OUCH! {result.error}</p> : result && <>
          <p className="hint">{result.rows.length} row{result.rows.length === 1 ? "" : "s"}{result.rows.length === 200 && " (showing the first 200)"}</p>
          {result.columns.length > 0 && (
            <div className="panel table-wrap">
              <table className="data">
                <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                <tbody>{result.rows.map((r, i) => <tr key={i}>{r.map((v: any, j: number) => <td key={j}>{v === null ? <i className="null">NULL</i> : String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </>}
      </section>
    </>
  );
}
