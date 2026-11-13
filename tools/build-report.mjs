// Build docs/project-report.pdf from the live databases.
//   node tools/build-report.mjs <screenshotDir> <testResults.txt>
// Reads table definitions, report output and MongoDB details straight from the
// running databases, then prints the HTML to PDF with headless Chrome.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(ROOT, ".env.local"));
const env = process.env;
const [shotDir, testFile] = process.argv.slice(2);

const owner = await mysql.createConnection({ host: env.DB_HOST, database: env.DB_NAME, user: env.DB_OWNER_USER, password: env.DB_OWNER_PASSWORD, dateStrings: true, decimalNumbers: true });
const ro = await mysql.createConnection({ host: env.DB_HOST, database: env.DB_NAME, user: env.DB_READONLY_USER, password: env.DB_READONLY_PASSWORD, dateStrings: true, decimalNumbers: true });
const mongo = await new MongoClient(env.MONGODB_URI).connect();
const mdb = mongo.db(env.MONGODB_DB);

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const code = s => `<pre>${esc(s.trim())}</pre>`;
const img = (p, cls = "") => `<img class="${cls}" src="data:image/${p.endsWith(".png") ? "png" : p.endsWith(".svg") ? "svg+xml" : "jpeg"};base64,${readFileSync(p).toString("base64")}">`;
const sql = f => readFileSync(join(ROOT, "db", f), "utf8");

// ---------------------------------------------------------------- live data
const [cols] = await owner.query(`
  SELECT c.TABLE_NAME t, c.COLUMN_NAME name, c.COLUMN_TYPE type, c.IS_NULLABLE nullable, c.COLUMN_KEY k, c.COLUMN_DEFAULT def,
         CONCAT(u.REFERENCED_TABLE_NAME, '.', u.REFERENCED_COLUMN_NAME) fk
    FROM information_schema.COLUMNS c
    LEFT JOIN information_schema.KEY_COLUMN_USAGE u ON u.TABLE_SCHEMA = c.TABLE_SCHEMA AND u.TABLE_NAME = c.TABLE_NAME
         AND u.COLUMN_NAME = c.COLUMN_NAME AND u.REFERENCED_TABLE_NAME IS NOT NULL
   WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME NOT LIKE 'v\\_%'
   ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
const TABLES = ["customers", "addresses", "categories", "suppliers", "products", "product_images", "reviews", "wishlist", "cart", "cart_items", "orders", "order_items", "payments", "shipments"];
const counts = {};
for (const t of TABLES) counts[t] = (await owner.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n;
const [checks] = await owner.query("SELECT CONSTRAINT_NAME n, TABLE_NAME t, CHECK_CLAUSE c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME");
const [idx] = await owner.query("SELECT TABLE_NAME t, INDEX_NAME n, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c, NON_UNIQUE nu, INDEX_TYPE ty FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME <> 'PRIMARY' GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE ORDER BY TABLE_NAME");
const [trg] = await owner.query("SELECT TRIGGER_NAME n, ACTION_TIMING w, EVENT_MANIPULATION e, EVENT_OBJECT_TABLE t FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY EVENT_OBJECT_TABLE");
const [routines] = await owner.query("SELECT ROUTINE_TYPE ty, ROUTINE_NAME n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_TYPE, ROUTINE_NAME");
const [views] = await owner.query("SELECT TABLE_NAME n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()");
const fkCount = cols.filter(c => c.fk).length;

const DESCRIBE = {
  customer_id: "Surrogate key", first_name: "Given name", last_name: "Family name", email: "Login name, stored in lower case, unique",
  phone: "Contact number", password_hash: "bcrypt hash, never the password", role: "customer or admin (added by ALTER)", created_at: "When the row was created",
  address_id: "Surrogate key", address_line: "Street and number", city: "City", state: "State", postal_code: "PIN code", country: "Country", is_default: "1 for the default address",
  category_id: "Surrogate key", name: "Display name", parent_category_id: "Parent category, NULL for a top-level one",
  supplier_id: "Surrogate key", contact_email: "Supplier email", address: "Supplier city and state",
  product_id: "Surrogate key", description: "Long text shown on the product page", price: "Current price in rupees", sku: "Stock keeping unit", stock_quantity: "Units on the shelf",
  image_id: "Surrogate key", image_url: "Path of the cover image",
  review_id: "Surrogate key", rating: "Stars, 1 to 5", comment: "Review text", review_date: "Day of the review",
  wishlist_id: "Surrogate key", added_at: "When it was added", cart_id: "Surrogate key", cart_item_id: "Surrogate key", quantity: "Number of units",
  order_id: "Surrogate key", shipping_address_id: "Where the order ships", order_date: "Day the order was placed", status: "Processing, Shipped or Delivered (orders); Preparing, In transit or Delivered (shipments)",
  total_amount: "Order total, fixed at purchase", order_item_id: "Surrogate key", unit_price: "Price on the day of the order",
  payment_id: "Surrogate key", payment_method: "UPI, Card, Net Banking or Cash on Delivery", amount: "Amount charged", payment_status: "Pending or Paid", transaction_date: "When it was paid",
  shipment_id: "Surrogate key", carrier: "Courier", tracking_number: "Courier tracking number", shipped_date: "Day it left", delivered_date: "Day it arrived",
};

const REPORTS = [
  ["Best sellers (JOIN, GROUP BY, ORDER BY, aggregates)", `SELECT p.name, SUM(oi.quantity) AS units_sold, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi JOIN products p ON p.product_id = oi.product_id
 GROUP BY p.product_id, p.name ORDER BY units_sold DESC, revenue DESC`],
  ["Well-reviewed products (LEFT JOIN, HAVING)", `SELECT p.name, COUNT(r.review_id) AS reviews, ROUND(AVG(r.rating), 2) AS avg_rating
  FROM products p LEFT JOIN reviews r ON r.product_id = p.product_id
 GROUP BY p.product_id, p.name HAVING COUNT(r.review_id) > 0 ORDER BY avg_rating DESC`],
  ["Products never ordered (correlated subquery, NOT EXISTS)", `SELECT p.name, p.price FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.product_id) ORDER BY p.name`],
  ["Pricier than average (scalar subquery)", `SELECT name, price FROM products WHERE price > (SELECT AVG(price) FROM products) ORDER BY price DESC`],
  ["Category tree (recursive CTE)", `WITH RECURSIVE tree (category_id, path, depth) AS (
    SELECT category_id, CAST(name AS CHAR(300)), 0 FROM categories WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.category_id, CONCAT(tree.path, ' > ', c.name), tree.depth + 1
      FROM categories c JOIN tree ON c.parent_category_id = tree.category_id)
SELECT category_id, path, depth FROM tree ORDER BY path`],
  ["Price rank in each category (window functions)", `SELECT c.name AS category, p.name, p.price,
       RANK() OVER (PARTITION BY p.category_id ORDER BY p.price DESC) AS price_rank
  FROM products p JOIN categories c ON c.category_id = p.category_id ORDER BY c.name, price_rank`],
  ["Revenue by category (3-table JOIN)", `SELECT c.name AS category, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi JOIN products p ON p.product_id = oi.product_id JOIN categories c ON c.category_id = p.category_id
 GROUP BY c.category_id, c.name ORDER BY revenue DESC`],
  ["Everyone we email (UNION)", `SELECT 'customer' AS who, email FROM customers UNION SELECT 'supplier', contact_email FROM suppliers ORDER BY who, email`],
  ["Customer spend (view)", `SELECT customer, orders, total_spent FROM v_customer_spend ORDER BY total_spent DESC`],
  ["Order totals check (stored function)", `SELECT order_id, total_amount, fn_order_total(order_id) AS from_lines FROM orders`],
  ["Loyalty tiers (procedure with a cursor)", `CALL sp_customer_tiers()`],
  ["Full-text search (FULLTEXT index)", `SELECT name, price FROM products WHERE MATCH(name, description) AGAINST ('city* robot*' IN BOOLEAN MODE)`],
];
const reportHtml = [];
for (const [title, q] of REPORTS) {
  let [rows, fields] = await ro.query(q);
  if (Array.isArray(rows[0])) { rows = rows[0]; fields = fields[0]; }
  const names = fields.map(f => f.name);
  reportHtml.push(`<div class="q"><h3>${esc(title)}</h3>${code(q)}${table(names, rows.slice(0, 12).map(r => names.map(n => esc(r[n] ?? "NULL"))))}</div>`);
}

const mongoInfo = [];
for (const name of ["product_details", "activity"]) {
  const c = mdb.collection(name);
  mongoInfo.push({ name, count: await c.countDocuments(), indexes: await c.indexes(),
    sample: await c.findOne(name === "activity" ? {} : { product_id: 8 }, { projection: { _id: 0 }, sort: name === "activity" ? { at: -1 } : {} }) });
}
const fig = await mdb.collection("product_details").findOne({ product_id: 8 }, { projection: { _id: 0 } });
const tagCloud = await mdb.collection("product_details").aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 8 }]).toArray();
const trending = await mdb.collection("activity").aggregate([
  { $match: { type: "view" } }, { $group: { _id: "$product_id", views: { $sum: 1 } } }, { $sort: { views: -1, _id: 1 } }, { $limit: 5 }]).toArray();
const [pnames] = await owner.query("SELECT product_id, name FROM products");
const pname = id => pnames.find(p => p.product_id === id)?.name ?? id;

const tests = existsSync(testFile || "") ? readFileSync(testFile, "utf8").split("\n").filter(l => /^[✔✖]/.test(l)) : [];
const shots = shotDir && existsSync(shotDir) ? readdirSync(shotDir).filter(f => /^\d\d-.*\.png$/.test(f)).sort() : [];
const SHOT_CAPTIONS = {
  "01-home-opener": "Home page opening: the cover splits as you scroll.", "02-home": "Home page, with trending products from a MongoDB aggregation.",
  "03-shop-search": "Shop: full-text search (MATCH ... AGAINST).", "04-shop-tag": "Shop: tag filter, product ids come from MongoDB.",
  "05-product": "Product page: price and stock from MariaDB, specs and tags from MongoDB.", "06-cart": "Cart (customer).",
  "07-checkout": "Checkout form. Submitting calls sp_place_order.", "08-order": "Order tracking. Status is kept in step by a trigger.",
  "09-admin": "Admin dashboard (admin role only).", "10-admin-mongo": "Admin editing a MongoDB document (create, read, update, delete).",
  "11-database": "Database tab: ER diagram, tables, advanced objects, MongoDB, reports.", "12-console-denied": "Read-only console: the column privilege refuses password_hash.",
  "13-login": "Login page with the two demo roles.",
};

// ---------------------------------------------------------------- document
const architecture = `<svg viewBox="0 0 760 330" class="arch" font-family="Archivo, sans-serif" font-size="12">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
<rect x="10" y="130" width="120" height="60" rx="8" fill="#fff6dc" stroke="#111" stroke-width="2"/><text x="70" y="156" text-anchor="middle" font-weight="700">Browser</text><text x="70" y="174" text-anchor="middle">HTML forms</text>
<rect x="180" y="20" width="250" height="290" rx="10" fill="#e8f4fd" stroke="#111" stroke-width="2"/><text x="305" y="42" text-anchor="middle" font-weight="700">Next.js 15 server (Node)</text>
<rect x="200" y="58" width="210" height="60" rx="6" fill="#fff" stroke="#111"/><text x="305" y="82" text-anchor="middle" font-weight="700">Pages (server components)</text><text x="305" y="100" text-anchor="middle">app/*/page.tsx: read data, render</text>
<rect x="200" y="130" width="210" height="60" rx="6" fill="#fff" stroke="#111"/><text x="305" y="154" text-anchor="middle" font-weight="700">API layer (route handlers)</text><text x="305" y="172" text-anchor="middle">app/api/**/route.ts: every write</text>
<rect x="200" y="202" width="210" height="44" rx="6" fill="#fff" stroke="#111"/><text x="305" y="222" text-anchor="middle" font-weight="700">lib/auth.ts</text><text x="305" y="238" text-anchor="middle">JWT cookie, role checks</text>
<rect x="200" y="256" width="100" height="44" rx="6" fill="#fff" stroke="#111"/><text x="250" y="276" text-anchor="middle" font-weight="700">lib/db.ts</text><text x="250" y="292" text-anchor="middle">3 pools by role</text>
<rect x="310" y="256" width="100" height="44" rx="6" fill="#fff" stroke="#111"/><text x="360" y="276" text-anchor="middle" font-weight="700">lib/mongo.ts</text><text x="360" y="292" text-anchor="middle">collections</text>
<rect x="490" y="40" width="250" height="150" rx="10" fill="#ffe1e1" stroke="#111" stroke-width="2"/><text x="615" y="62" text-anchor="middle" font-weight="700">MariaDB 11.8 (MySQL)</text>
<text x="505" y="86">14 tables, 18 foreign keys</text><text x="505" y="104">4 views, 3 functions, 5 procedures</text><text x="505" y="122">8 triggers, CHECKs, FULLTEXT</text><text x="505" y="140">roles: inkpow_customer, inkpow_admin,</text><text x="505" y="156">inkpow_readonly</text><text x="505" y="176">users: inkpow_web, inkpow_staff, inkpow_ro</text>
<rect x="490" y="220" width="250" height="90" rx="10" fill="#e3f7ec" stroke="#111" stroke-width="2"/><text x="615" y="242" text-anchor="middle" font-weight="700">MongoDB 7</text>
<text x="505" y="264">product_details (validator, text index)</text><text x="505" y="282">activity (event log, TTL index)</text><text x="505" y="300">aggregation pipelines</text>
<path d="M130,160 L196,160" stroke="#111" stroke-width="2" marker-end="url(#a)"/><path d="M130,150 L196,92" stroke="#111" stroke-width="2" marker-end="url(#a)"/>
<path d="M300,278 L486,120" stroke="#111" stroke-width="2" marker-end="url(#a)"/><path d="M410,278 L486,262" stroke="#111" stroke-width="2" marker-end="url(#a)"/>
<text x="440" y="190" font-size="11">SQL as the role's user</text><text x="425" y="252" font-size="11">MongoDB driver</text>
</svg>`;

const relRows = [
  ["Customer has Address", "1:N", "addresses.customer_id"], ["Customer owns Cart", "1:1", "cart.customer_id"],
  ["Cart contains Product", "M:N (quantity, added_at)", "table cart_items"], ["Customer wishes Product", "M:N (added_at)", "table wishlist"],
  ["Customer places Order", "1:N", "orders.customer_id"], ["Order contains Product", "M:N (quantity, unit_price)", "table order_items"],
  ["Order ships to Address", "N:1", "orders.shipping_address_id"], ["Order paid by Payment", "1:N", "payments.order_id"],
  ["Order ship via Shipment", "1:N", "shipments.order_id"], ["Supplier supplies Product", "1:N", "products.supplier_id"],
  ["Product belongs to Category", "N:1", "products.category_id"], ["Product has Product Image", "1:N identifying (weak entity)", "product_images.product_id"],
  ["Customer reviews Product", "M:N (rating, comment)", "table reviews"], ["Category parent of Category", "1:N recursive", "categories.parent_category_id"],
];

const QA = [
  ["Why two databases?", "The data is not all the same shape. Orders, payments and stock need transactions, foreign keys and exact numbers, so they are in MariaDB. Product specs have different fields for every kind of product, and the activity log is a stream of events that is only ever summarised. Those fit documents better, so they are in MongoDB. The two are linked by product_id."],
  ["Why not put the specs in SQL?", "A column per spec would leave most cells NULL (a poster has no page count, a comic has no paper weight), and every new kind of product would need an ALTER TABLE. An entity-attribute-value table avoids the NULLs but loses types and makes every read a pivot. A document holds exactly the fields that product has."],
  ["Why is MongoDB not used for orders?", "An order touches five tables and the stock of every product in it, and it must all happen or none of it. MariaDB gives that with one transaction and row locks. Money also needs DECIMAL and foreign keys."],
  ["How are the two kept consistent?", "MariaDB is the source of truth for every product. A MongoDB document carries the same product_id, has a unique index on it, and is created, updated or deleted by the admin page. If a document is missing the product page still works; it just shows no specs."],
  ["What does the MongoDB validator do?", "product_details has a $jsonSchema rule: product_id must be an int of at least 1, format a string, specs an object and tags an array of strings. MongoDB refuses any insert or update that breaks it."],
  ["What is a TTL index?", "An index on a date field with expireAfterSeconds. MongoDB deletes activity events older than 90 days by itself."],
  ["Which aggregation stages did you use?", "$match, $group, $unwind, $project, $sort, $limit, $addToSet, $setIntersection, $dateToString, $replaceRoot with $arrayToObject, and $cond for the conversion rate."],
  ["How do the two roles work?", "The app has customers and admins (customers.role). Each kind of user also gets a different MariaDB login: shoppers use inkpow_web, which holds the role inkpow_customer, and admins use inkpow_staff with inkpow_admin. So even if the app had a bug, a customer request could not change prices or run admin procedures; MariaDB would refuse it."],
  ["How do you stop someone signing up as admin?", "inkpow_customer has INSERT on customers for five columns only, and role is not one of them. The column default makes every new account a customer."],
  ["Why did you use ALTER instead of putting the column in CREATE TABLE?", "schema.sql is the hand-drawn diagram exactly. migrations.sql shows how the live database changed afterwards: the role column, CHECK constraints, a UNIQUE index replacing a plain one, and a FULLTEXT index."],
  ["How are passwords stored?", "As bcrypt hashes (cost 10) in customers.password_hash. The console user cannot even read that column. Database passwords and the session secret are in .env.local, which git ignores."],
  ["What is the API layer?", "Every write goes through a Next.js route handler under app/api. Handlers check the login and role, call a function in lib/db.ts or lib/mongo.ts, and turn database errors into a message."],
  ["What is the difference between a view and a table?", "A table stores rows. A view stores a SELECT and works out its rows each time it is read. v_product_catalog always shows the current rating because it calls fn_product_rating."],
  ["Procedure or function?", "A function returns one value and can be used in a SELECT, like fn_order_total(order_id). A procedure is run with CALL, can have OUT parameters, return result sets and run transactions, like sp_place_order."],
  ["BEFORE or AFTER trigger?", "BEFORE when the trigger checks or changes the incoming row (email lower-cased, rating checked, unit_price filled in). AFTER when the row must exist first, as when the new customer_id is needed to create the cart."],
  ["What is a cursor and why use one?", "A cursor walks a result one row at a time. sp_place_order uses one to copy each cart line into order_items, so the stock trigger runs per line. A NOT FOUND handler ends the loop."],
  ["What happens if checkout fails halfway?", "sp_place_order runs in START TRANSACTION. An EXIT HANDLER catches any error, even one from a trigger, runs ROLLBACK and RESIGNALs it. The test suite checks that no order, address or stock change is left behind."],
  ["Is the schema in 3NF?", "Yes apart from deliberate stored values: orders.total_amount and payments.amount can be computed from order_items, but they record what was charged at the time. The report Order totals check proves they agree."],
  ["Why indexes, and why not on foreign keys?", "InnoDB indexes every foreign key by itself. The extra ones cover search and sorting: product name, order date, a composite on reviews (product_id, review_date), the unique email and the FULLTEXT index."],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>INKPOW! project report</title>
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Archivo:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 16mm 14mm; }
body { font: 10.5pt/1.5 Archivo, sans-serif; color: #111; }
h1 { font: 44pt Bangers, cursive; letter-spacing: 1px; margin: 0; color: #F23A3A; -webkit-text-stroke: 1px #111; }
h2 { font: 22pt Bangers, cursive; letter-spacing: .5px; border-bottom: 3px solid #111; margin: 0 0 10px; padding-bottom: 2px; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14px 0 6px; break-after: avoid; }
section { break-before: page; }
section.flow { break-before: auto; margin-top: 18px; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 9pt; break-inside: auto; }
th { background: #FFD21F; text-align: left; border: 1px solid #111; padding: 3px 6px; }
td { border: 1px solid #999; padding: 3px 6px; vertical-align: top; }
tr { break-inside: avoid; }
pre { font: 8pt/1.35 "JetBrains Mono", monospace; background: #fffbe8; border: 1px solid #111; border-radius: 4px; padding: 6px 8px; white-space: pre-wrap; margin: 4px 0 8px; }
code { font: 8.5pt "JetBrains Mono", monospace; background: #f3f0e0; padding: 0 3px; }
.q { break-inside: avoid; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover p { font-size: 13pt; max-width: 150mm; }
.box { border: 2px solid #111; border-radius: 6px; padding: 8px 12px; margin: 8px 0; background: #f5fbff; break-inside: avoid; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tcard { break-inside: avoid; }
.shot { width: 100%; border: 1px solid #111; }
.shotwrap { break-inside: avoid; margin-bottom: 14px; }
.shotwrap p { margin: 2px 0 0; font-size: 9pt; font-style: italic; }
.er svg, img.er { width: 100%; height: auto; }
.arch { width: 100%; }
img.photo { width: 100%; max-height: 240mm; object-fit: contain; }
.toc li { margin: 2px 0; }
dl dt { font-weight: 800; margin-top: 8px; break-after: avoid; } dl dd { margin: 2px 0 0 0; }
.pass { color: #0a7a3c; font-weight: 800; }
</style></head><body>

<div class="cover">
  <h1>INKPOW!</h1>
  <p><b>An online comic and collectibles store built on MariaDB (SQL) and MongoDB (NoSQL)</b></p>
  <p>DBMS Experiential Learning, Level 3 project report<br>Database Management System, Aug to Dec 2026</p>
  ${table(["Team member", "SRN", "Responsibilities"], [
    ["&nbsp;", "&nbsp;", "MariaDB design: ER diagram, schema, constraints, triggers, procedures, roles"],
    ["&nbsp;", "&nbsp;", "MongoDB model and aggregations, Next.js interface and API routes, testing"]])}
  <p style="font-size:10pt">Stack: Next.js 15 (App Router, route handlers), MariaDB 11.8 (MySQL compatible), MongoDB 7, Node.js 24.<br>
  Source: github.com/DerpSpears/dbms-project</p>
</div>

<section><h2>Contents</h2><ol class="toc">
<li>Problem statement and motivation</li><li>Objectives</li><li>Scope</li><li>Functional requirements</li><li>Database choice and justification</li>
<li>System architecture</li><li>ER diagram</li><li>Relational schema and mapping</li><li>Data dictionary</li><li>Keys, constraints and normalization</li>
<li>SQL implementation: DDL (CREATE, ALTER, DROP)</li><li>Advanced SQL: views, functions, procedures, cursors, triggers, transactions, indexes</li>
<li>NoSQL implementation (MongoDB)</li><li>Important queries with output</li><li>Authentication and role-based access control</li>
<li>Data validation, integrity and security</li><li>Application screenshots</li><li>Testing results</li><li>Conclusion and future enhancements</li>
<li>Viva questions</li><li>Appendix: setup, hand-drawn diagrams</li></ol>
<div class="box"><b>Requirement checklist.</b> SQL database: MariaDB (MySQL). NoSQL database: MongoDB. ER diagram converted to a relational schema (sections 7 and 8).
DDL with CREATE, ALTER and DROP (section 11). DML: INSERT, UPDATE, DELETE and SELECT, all used by the app. JOIN, GROUP BY, HAVING, ORDER BY, aggregates, nested, correlated and recursive queries (section 14).
Advanced concepts: transactions, views, stored procedures and functions, triggers, indexing, full-text search, NoSQL aggregation (sections 12 and 13). Next.js interface with an API layer (sections 6 and 17).
Credentials in environment variables. Two app roles (customer, admin) backed by MariaDB roles (section 15). Validation inside the database (section 16). bcrypt password hashes.</div>
</section>

<section><h2>1. Problem statement and motivation</h2>
<p>Small comic and collectibles shops sell a mixed catalogue: single comic issues, manga volumes, graphic novels, figures and posters. Selling them online raises two different data problems.</p>
<p>The first is the money side. Customers fill carts, order several items, pay in different ways and wait for shipments. Stock is limited, especially for figures and box sets, so two people must not be able to buy the last copy. Every order touches several tables and must be all or nothing.</p>
<p>The second is the catalogue side. A comic is described by its issue number, page count, writer and artist; a figure by its height, material and joints; a poster by its size and paper. A fixed set of columns does not fit them all. The shop also wants to know what people look at and search for, which produces a large stream of small events.</p>
<p>INKPOW! is a working store that handles both: a relational database for customers, carts, orders, payments and shipments, and a document database for flexible product specs and the activity log.</p>
</section>

<section class="flow"><h2>2. Objectives</h2><ul>
<li>Turn a hand-drawn ER diagram into a normalised 14-table MySQL-compatible schema with all keys and constraints.</li>
<li>Keep business rules inside the database (triggers, CHECK constraints, procedures) so no program can skip them.</li>
<li>Make checkout a single ACID transaction that cannot oversell stock.</li>
<li>Store data whose shape varies, or that is written constantly and only summarised, in MongoDB, and justify the split.</li>
<li>Give customers and admins different rights, enforced by MariaDB roles as well as by the app.</li>
<li>Build a Next.js web app where every database feature is visible and usable.</li></ul></section>

<section class="flow"><h2>3. Scope</h2>
<div class="two"><div><h3>In scope</h3><ul><li>Sign up, log in, log out</li><li>Browse, full-text search, category and tag filters</li><li>Product pages with specs, reviews, related products</li><li>Wishlist, cart, checkout, order tracking</li><li>Admin: orders, prices and stock, restock, review moderation, MongoDB spec editing, activity analytics</li><li>A Database tab that shows the ER diagram, tables, objects and a read-only SQL console</li></ul></div>
<div><h3>Out of scope</h3><ul><li>Real payment gateways (payment is simulated)</li><li>Real courier integration (carrier and tracking number are generated)</li><li>Image uploads (covers are drawn as SVG from the product row)</li><li>Email notifications</li></ul></div></div></section>

<section class="flow"><h2>4. Functional requirements</h2>
${table(["#", "Requirement", "Who", "Database work"], [
  ["F1", "Register with name, email, phone and password", "Guest", "INSERT customers; triggers lower-case email, refuse duplicates, create the cart"],
  ["F2", "Log in and log out", "Guest, customer, admin", "SELECT customers; bcrypt compare"],
  ["F3", "Search and filter products", "Everyone", "FULLTEXT MATCH AGAINST; category subquery; tag lookup in MongoDB"],
  ["F4", "View a product with specs, reviews and related items", "Everyone", "v_product_catalog, fn_product_rating; MongoDB findOne and aggregation; view event logged"],
  ["F5", "Review a product", "Customer", "INSERT reviews; trigger and CHECK on rating"],
  ["F6", "Wishlist add and remove", "Customer", "INSERT / DELETE wishlist; UNIQUE (customer_id, product_id)"],
  ["F7", "Cart add, change, remove", "Customer", "CALL sp_add_to_cart; UPDATE / DELETE cart_items"],
  ["F8", "Checkout with saved or new address", "Customer", "CALL sp_place_order (transaction, cursor, stock trigger)"],
  ["F9", "See own orders and track one", "Customer", "v_order_summary; JOINs over five tables"],
  ["F10", "Move an order to shipped or delivered", "Admin", "CALL sp_advance_order; trigger updates order and payment"],
  ["F11", "Change price and stock, run restock", "Admin", "UPDATE products (CHECKs); CALL sp_restock_low_stock (cursor)"],
  ["F12", "Delete a review", "Admin", "DELETE reviews"],
  ["F13", "Create, read, update, delete product specs", "Admin", "MongoDB updateOne upsert, findOne, $addToSet, $pull, deleteOne"],
  ["F14", "See trending products, top searches, conversion", "Admin", "MongoDB aggregation pipelines"],
  ["F15", "Run read-only SQL", "Everyone", "Separate MariaDB user with SELECT only"],
])}</section>

<section><h2>5. Database choice and justification</h2>
${table(["Data", "Stored in", "Why"], [
  ["Customers, addresses, categories, suppliers, products (price, stock)", "MariaDB", "Fixed structure, referenced by many tables, needs foreign keys and unique emails"],
  ["Carts, orders, order items, payments, shipments", "MariaDB", "Money and stock: needs ACID transactions, row locks, DECIMAL, foreign keys"],
  ["Reviews, wishlist", "MariaDB", "M:N links between customers and products, need referential integrity"],
  ["Product specs and tags", "MongoDB product_details", "Every product type has different fields; nested arrays (accessories, volumes); new fields need no ALTER"],
  ["Activity events (views, searches, cart adds, orders)", "MongoDB activity", "Append-only, high volume, no joins, shape changes as tracking grows; read only through aggregation; old events expire by TTL"],
])}
<h3>Why MariaDB</h3><p>MariaDB is a MySQL-compatible server (same SQL, same client protocol, same mysql2 driver). It gives InnoDB transactions with row-level locking, foreign keys, CHECK constraints, stored procedures, triggers, roles with column-level privileges, window functions, recursive CTEs and FULLTEXT indexes. Every one of these is used.</p>
<h3>Why MongoDB</h3><p>The figure's document below has a height, a material, a joint count and an array of accessories. A comic's has issue, pages, writer and artist. In SQL this needs either a sparse table with a column for every possible spec, or an entity-attribute-value table that loses types. MongoDB stores each product's own fields, validates the parts every document must have, indexes the tags array, and runs the analytics as aggregation pipelines on the server.</p>
${code(JSON.stringify(fig, null, 2))}
<p>The link between the two is <code>product_id</code>. MariaDB stays the source of truth: if a MongoDB document is missing, the product still sells.</p></section>

<section><h2>6. System architecture</h2>${architecture}
<ul><li><b>Pages</b> (<code>app/**/page.tsx</code>) are React server components. They run on the server and read through <code>lib/db.ts</code> and <code>lib/mongo.ts</code>.</li>
<li><b>API layer</b> (<code>app/api/**/route.ts</code>): 16 route handlers. Every form posts to one of them. A handler checks the session and role, calls the data layer, and redirects back with a message (or returns JSON when asked).</li>
<li><b>lib/db.ts</b> holds every SQL statement in the app. It keeps three connection pools, one per MariaDB role, and picks the pool by who is asking.</li>
<li><b>lib/mongo.ts</b> holds every MongoDB operation.</li>
<li><b>Configuration</b> comes from environment variables in <code>.env.local</code>, written by <code>setup.sh</code> with random passwords. Nothing is hard-coded.</li></ul>
${table(["Folder", "Contents"], [["db/", "schema.sql, seed.sql, advanced.sql, migrations.sql, security.sql, mongo-seed.json"], ["lib/", "db.ts, mongo.ts, auth.ts, http.ts, reports.ts"], ["app/", "pages and app/api route handlers"], ["scripts/reset-db.mjs", "rebuilds both databases from db/"], ["tests/", "21 automated database tests"], ["tools/", "ER diagram generator, screenshot and report builders"]])}
</section>

<section><h2>7. ER diagram</h2>
<p>Drawn by hand first (Appendix B), then redrawn in Chen notation. Rectangles are entities, the double rectangle is the weak entity Product Image, diamonds are relationships, ovals are attributes and underlined attributes are keys.</p>
<div class="er">${readFileSync(join(ROOT, "data", "er.svg"), "utf8")}</div>
<h3>Relationships and cardinality</h3>${table(["Relationship", "Cardinality", "Became"], relRows.map(r => r.map(esc)))}</section>

<section><h2>8. Relational schema and mapping</h2>
<p>The 14 tables below come from <code>information_schema</code> of the live database. PK is the primary key, FK a foreign key with the column it references. ${fkCount} foreign keys in total.</p>
<div class="two">${TABLES.map(t => `<div class="tcard"><h3>${t} <small>(${counts[t]} rows)</small></h3>${table(["Column", "Type", "Key"], cols.filter(c => c.t === t).map(c => [esc(c.name), esc(c.type), c.k === "PRI" ? "PK" : c.fk ? "FK → " + esc(c.fk) : c.k === "UNI" ? "UNIQUE" : ""]))}</div>`).join("")}</div>
<h3>Mapping rules used</h3>${table(["Rule", "Applied to"], [
  ["Strong entity becomes a table with its key as primary key", "customers, addresses, categories, suppliers, products, cart, orders, payments, shipments"],
  ["Weak entity: table that includes the owner's key", "product_images.product_id"],
  ["1:N: key of the one side goes on the many side", "addresses, orders, payments, shipments, products (supplier, category)"],
  ["1:1: key on the side with total participation", "cart.customer_id"],
  ["M:N: new table with both keys and the relationship's attributes", "cart_items, wishlist, order_items, reviews"],
  ["Recursive relationship: foreign key to the same table", "categories.parent_category_id"],
  ["Composite attribute split into simple columns", "address parts, first and last name"]])}</section>

<section><h2>9. Data dictionary</h2>
${TABLES.map(t => `<h3>${t}</h3>${table(["Column", "Type", "Null", "Key", "Default", "Meaning"], cols.filter(c => c.t === t).map(c => [esc(c.name), esc(c.type), c.nullable === "YES" ? "yes" : "no", c.k === "PRI" ? "PK" : c.fk ? "FK" : c.k === "UNI" ? "UQ" : c.k === "MUL" ? "index" : "", esc(c.def ?? ""), esc(DESCRIBE[c.name] ?? "")]))}`).join("")}</section>

<section><h2>10. Keys, constraints and normalization</h2>
<h3>Primary and foreign keys</h3><p>Each table has a single INT AUTO_INCREMENT primary key. All ${fkCount} foreign keys use InnoDB, which always enforces them: an order for a missing customer is refused, and a customer with orders cannot be deleted.</p>
<h3>CHECK constraints (added by ALTER)</h3>${table(["Constraint", "Table", "Rule"], checks.map(c => [esc(c.n), esc(c.t), `<code>${esc(c.c)}</code>`]))}
<h3>Other constraints</h3><ul><li>NOT NULL on customers.email and customers.role.</li><li>UNIQUE on customers.email (uq_customers_email) and on wishlist (customer_id, product_id).</li><li>ENUM('customer', 'admin') on customers.role.</li><li>Defaults: timestamps and dates default to now; role defaults to customer.</li></ul>
<h3>Rules enforced by triggers</h3>${table(["Trigger", "When", "Table"], trg.map(t => [esc(t.n), `${t.w} ${t.e}`, esc(t.t)]))}
<h3>Normalization</h3>
<p><b>1NF.</b> Every column holds one value. Addresses and images are rows in their own tables, not lists.</p>
<p><b>2NF.</b> Every primary key is a single column, so no column can depend on part of a key.</p>
<p><b>3NF.</b> No non-key column depends on another non-key column. Product, category, supplier and address details are each stored once and referenced by id.</p>
<p><b>Deliberate stored values.</b> orders.total_amount and payments.amount could be computed from order_items, and order_items.unit_price looks like products.price. They are kept because they record what was charged on the day, which must not change when a price changes. fn_order_total checks that the totals agree.</p>
</section>

<section><h2>11. SQL implementation: DDL</h2>
<h3>CREATE (db/schema.sql, extract)</h3>${code(sql("schema.sql").split("CREATE TABLE products")[0].split("CREATE TABLE customers")[1].replace(/^/, "CREATE TABLE customers"))}
${code("CREATE TABLE products" + sql("schema.sql").split("CREATE TABLE products")[1].split(";")[0] + ";")}
<h3>ALTER and DROP (db/migrations.sql)</h3><p>schema.sql is the diagram as drawn. The migration then changes the live database.</p>${code(sql("migrations.sql"))}
<h3>DROP in the reset script</h3>${code(`-- scripts/reset-db.mjs, before rebuilding
DROP VIEW IF EXISTS v_product_catalog;            -- every view
DROP PROCEDURE IF EXISTS sp_place_order;          -- every routine
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS order_items;                 -- every table (drops its triggers too)
SET FOREIGN_KEY_CHECKS = 1;`)}
<h3>DML used by the app</h3>${table(["Statement", "Where"], [
  ["INSERT", "sign up, reviews, wishlist add; inside procedures: cart_items, orders, order_items, payments, shipments, addresses"],
  ["UPDATE", "cart quantity, admin price and stock, shipments (sp_advance_order), products stock (trigger), orders and payments (trigger)"],
  ["DELETE", "cart line at quantity 0, wishlist remove, admin review delete, cart emptied at checkout"],
  ["SELECT", "every page"]])}</section>

<section><h2>12. Advanced SQL features</h2>
${table(["Feature", "Objects", "Used by"], [
  ["Views", views.map(v => v.n).join(", "), "product cards, orders pages, admin dashboard, reports"],
  ["Stored functions", routines.filter(r => r.ty === "FUNCTION").map(r => r.n).join(", "), "ratings, checkout total, totals check"],
  ["Stored procedures", routines.filter(r => r.ty === "PROCEDURE").map(r => r.n).join(", "), "cart, checkout, order status, loyalty tiers, restock"],
  ["Cursors", "in sp_place_order, sp_customer_tiers, sp_restock_low_stock", "row-by-row work"],
  ["Triggers", trg.length + " triggers", "validation and keeping tables in step"],
  ["Error handling", "SIGNAL, RESIGNAL, DECLARE EXIT / CONTINUE HANDLER", "messages shown to the user, rollback"],
  ["Transactions", "START TRANSACTION, COMMIT, ROLLBACK, SELECT ... FOR UPDATE", "checkout"],
  ["Indexes", idx.length + " secondary indexes incl. composite, unique and FULLTEXT", "search, sorting, uniqueness"],
  ["Roles and privileges", "CREATE ROLE, GRANT (table, column, routine), SET DEFAULT ROLE", "customer, admin and read-only access"],
  ["Window functions, recursive CTE", "RANK() OVER, SUM() OVER, WITH RECURSIVE", "reports"]])}
<h3>Indexes</h3>${table(["Table", "Index", "Columns", "Kind"], idx.map(i => [esc(i.t), esc(i.n), esc(i.c), i.ty === "FULLTEXT" ? "FULLTEXT" : i.nu ? "BTREE" : "UNIQUE"]))}
<h3>Checkout transaction: sp_place_order</h3>
${code(sql("advanced.sql").match(/CREATE PROCEDURE sp_place_order[\s\S]*?END \$\$/)[0])}
<p>Steps: check the cart and payment method (SIGNAL if wrong), use or insert the address, create the order with fn_cart_total, copy each cart line into order_items with a cursor (the BEFORE INSERT trigger locks the product row with SELECT ... FOR UPDATE, checks stock, fills unit_price and reduces stock), record the payment and shipment, empty the cart and COMMIT. Any error runs the EXIT HANDLER: ROLLBACK then RESIGNAL.</p>
<p><b>Atomicity:</b> all of it or none. <b>Consistency:</b> stock never goes negative (trigger and CHECK). <b>Isolation:</b> the row lock stops two checkouts selling the same last copy. <b>Durability:</b> InnoDB writes the commit to its redo log.</p>
<h3>Stock trigger</h3>${code(sql("advanced.sql").match(/CREATE TRIGGER trg_order_items_before_insert[\s\S]*?END \$\$/)[0])}
<h3>Order status trigger</h3>${code(sql("advanced.sql").match(/CREATE TRIGGER trg_shipments_after_update[\s\S]*?END \$\$/)[0])}
<h3>View used for every product card</h3>${code(sql("advanced.sql").match(/CREATE VIEW v_product_catalog[\s\S]*?;/)[0])}
</section>

<section><h2>13. NoSQL implementation (MongoDB)</h2>
${mongoInfo.map(c => `<h3>Collection ${c.name} (${c.count} documents)</h3>${table(["Index", "Key", "Options"], c.indexes.map(i => [esc(i.name), `<code>${esc(JSON.stringify(i.key))}</code>`, [i.unique ? "unique" : "", i.expireAfterSeconds ? `TTL ${i.expireAfterSeconds / 86400} days` : "", i.weights ? "text" : ""].filter(Boolean).join(", ")]))}<p>Sample document:</p>${code(JSON.stringify(c.sample, null, 2))}`).join("")}
<h3>Data model</h3>${table(["Field", "Type", "Meaning"], [
  ["product_id", "int (required, unique)", "same id as products.product_id in MariaDB"], ["sku", "string", "copy of the SKU for readability"],
  ["format", "string (required)", "comic, manga, graphic novel, figure, poster, box set"], ["specs", "object (required)", "fields that depend on the format, may nest arrays"],
  ["tags", "array of strings (required)", "search and recommendations; multikey index"], ["updated_at", "date", "last change"]])}
<p>activity documents have <code>type</code> (view, search, add_to_cart, order), <code>at</code> (date) and fields for that type: product_id, customer_id, query and results, quantity, order_id and total.</p>
<h3>Validator on product_details</h3>${code(`{ $jsonSchema: { bsonType: "object", required: ["product_id", "format", "specs", "tags"],
  properties: { product_id: { bsonType: "int", minimum: 1 }, format: { bsonType: "string" },
                specs: { bsonType: "object" }, tags: { bsonType: "array", items: { bsonType: "string" } } } } }`)}
<h3>Create, read, update, delete</h3>${table(["Operation", "Call", "Where in the app"], [
  ["Create / update", "updateOne({product_id}, {$set: {...}}, {upsert: true})", "admin, Edit specs"], ["Update one tag", "$addToSet / $pull on tags", "admin, tag buttons"],
  ["Read", "findOne({product_id})", "product page, admin"], ["Read by tag", "find({tags: tag})", "shop tag filter"],
  ["Delete", "deleteOne({product_id})", "admin, Delete document"], ["Insert event", "insertOne({type, ..., at})", "every view, search, cart add, order"]])}
<h3>Aggregation pipelines</h3>
${code(`// Trending products: most views in 7 days
db.activity.aggregate([
  { $match: { type: "view", at: { $gte: sevenDaysAgo } } },
  { $group: { _id: "$product_id", views: { $sum: 1 }, viewers: { $addToSet: "$customer_id" } } },
  { $project: { product_id: "$_id", views: 1, viewers: { $size: "$viewers" } } },
  { $sort: { views: -1 } }, { $limit: 5 } ])

// Related products: most shared tags
db.product_details.aggregate([
  { $match: { product_id: { $ne: id }, tags: { $in: myTags } } },
  { $project: { product_id: 1, shared: { $size: { $setIntersection: ["$tags", myTags] } } } },
  { $sort: { shared: -1 } }, { $limit: 4 } ])

// View to cart conversion per product
db.activity.aggregate([
  { $match: { type: { $in: ["view", "add_to_cart"] } } },
  { $group: { _id: "$product_id",
      views: { $sum: { $cond: [{ $eq: ["$type", "view"] }, 1, 0] } },
      adds:  { $sum: { $cond: [{ $eq: ["$type", "add_to_cart"] }, 1, 0] } } } },
  { $project: { views: 1, adds: 1, rate: { $round: [{ $multiply: [{ $divide: ["$adds", "$views"] }, 100] }, 0] } } } ])`)}
<div class="two"><div><h3>Output: tag cloud</h3>${table(["Tag", "Products"], tagCloud.map(t => [esc(t._id), t.n]))}</div>
<div><h3>Output: most viewed</h3>${table(["Product", "Views"], trending.map(t => [esc(pname(t._id)), t.views]))}</div></div>
</section>

<section><h2>14. Important queries with output</h2><p>Run live as the read-only user. Long results are cut to 12 rows.</p>${reportHtml.join("")}</section>

<section><h2>15. Authentication and role-based access control</h2>
<h3>In the application</h3><ul>
<li>Passwords are hashed with bcrypt (cost 10) on sign up and checked with bcrypt.compare on log in.</li>
<li>A successful log in sets an httpOnly, SameSite=Lax cookie holding a JWT signed with HS256 and SESSION_SECRET, valid for 7 days.</li>
<li>Every request reads the user and role fresh from customers, so a role change applies at once.</li>
<li>Pages call requireUser or requireAdmin; API routes call apiUser(req, "admin"). A customer opening /admin is sent away, and a customer posting to an admin API gets 403.</li></ul>
<h3>In the database</h3>${table(["App user", "MariaDB user", "Role", "Can", "Cannot"], [
  ["Guest, customer", "inkpow_web", "inkpow_customer", "read the shop; insert customers (5 columns), reviews, addresses, wishlist; update cart quantity; CALL sp_add_to_cart, sp_place_order", "write customers.role, update products, delete orders, call admin procedures"],
  ["Admin", "inkpow_staff", "inkpow_admin", "SELECT, INSERT, UPDATE, DELETE and EXECUTE on the inkpow schema", "CREATE, ALTER, DROP"],
  ["SQL console", "inkpow_ro", "inkpow_readonly", "SELECT tables and views, the functions, sp_customer_tiers", "read customers.password_hash, any write"],
  ["Reset script", "inkpow", "owner", "DDL", "(not used by the web app)"]])}
${code(sql("security.sql").split("-- ---------------------------------------------------------------- admin role")[0])}
</section>

<section><h2>16. Data validation, integrity and security</h2>
${table(["Rule", "Enforced in the database by"], [
  ["Email present, unique, lower case", "NOT NULL, uq_customers_email, trg_customers_before_insert"], ["Every customer has one cart", "trg_customers_after_insert"],
  ["Rating 1 to 5", "trg_reviews_before_insert / _update and chk_reviews_rating"], ["Quantity at least 1", "trg_cart_items_before_insert / _update, chk_order_items_qty"],
  ["Price and stock not negative", "chk_products_price, chk_products_stock"], ["No overselling", "trg_order_items_before_insert with SELECT ... FOR UPDATE"],
  ["Payment method is valid, cart not empty", "SIGNAL in sp_place_order"], ["Order status follows shipment", "trg_shipments_after_update"],
  ["Every reference points at a real row", `${fkCount} foreign keys`], ["Product spec document shape", "MongoDB $jsonSchema validator, unique product_id index"],
  ["Nobody signs up as admin", "column-level INSERT grant without role"]])}
<p>The API routes do not re-check the rating, stock or payment method. They send the values to the database and show its message, so the rules live in one place.</p>
<h3>Security practices</h3><ul>
<li>No credentials in source code. setup.sh generates random passwords for four MariaDB users and the session secret, and writes them to .env.local (chmod 600, ignored by git). .env.example lists the variable names.</li>
<li>Passwords stored only as bcrypt hashes.</li><li>All SQL uses placeholders (?), so input is never pasted into SQL.</li>
<li>Least privilege: each part of the app uses a MariaDB user that can do only what it needs.</li>
<li>Session cookie is httpOnly and signed; redirects only go to paths on the same site.</li>
<li>The SQL console has a 5 second statement limit and cannot write.</li></ul></section>

<section><h2>17. Application screenshots</h2>
${shots.map(f => `<div class="shotwrap">${img(join(shotDir, f), "shot")}<p>${esc(SHOT_CAPTIONS[f.replace(".png", "")] ?? f)}</p></div>`).join("")}</section>

<section><h2>18. Testing results</h2>
<p>tests/database.test.mjs runs with <code>npm test</code> (Node's built-in test runner). Each test connects as the MariaDB user the app uses for that job.</p>
${table(["#", "Test", "Result"], tests.map((t, i) => [i + 1, esc(t.replace(/^[✔✖]\s*/, "").replace(/\s*\([\d.]+ms\)$/, "")), t.startsWith("✔") ? '<span class="pass">pass</span>' : "FAIL"]))}
<p><b>${tests.filter(t => t.startsWith("✔")).length} of ${tests.length} passed.</b></p>
<h3>Manual tests through the web app</h3>${table(["Action", "Expected", "Result"], [
  ["Log in as asha@example.com", "Customer menu (wishlist, orders, cart)", "pass"], ["Log in as admin@inkpow.test", "Admin menu, dashboard opens", "pass"],
  ["Customer opens /admin", "Sent to home with 'admins only'", "pass"], ["Customer posts to /api/admin/restock", "403 Admins only", "pass"],
  ["Register with an existing email in capitals", "'That email already has an account.'", "pass"], ["Review with rating 9 (sent directly to the API)", "'Rating must be between 1 and 5.'", "pass"],
  ["Checkout more box sets than in stock", "'Not enough stock for ...', nothing saved", "pass"], ["Checkout with payment method Bitcoin", "'Choose a payment method.'", "pass"],
  ["Checkout with a new address, Cash on Delivery", "Order placed, payment Pending", "pass"], ["Admin marks the order shipped", "Order Shipped, shipment In transit", "pass"],
  ["Admin sets price to -5", "'That value breaks a rule in the database (chk_products_price).'", "pass"], ["Admin runs restock", "Products at 5 or below get 10 more", "pass"],
  ["Admin saves specs that are not a JSON object", "Refused with a message", "pass"], ["Admin adds and removes a tag, deletes a document", "MongoDB updated", "pass"],
  ["Console: SELECT password_hash FROM customers", "SELECT command denied", "pass"], ["Search 'robot'", "Mecha Chai Club Vol. 3 (word is only in the description)", "pass"]])}</section>

<section><h2>19. Conclusion and future enhancements</h2>
<p>INKPOW! turns a hand-drawn ER diagram into a working store. The relational part keeps the diagram's 14 tables and adds the rules a shop needs inside MariaDB itself: triggers, CHECK constraints, procedures and a checkout transaction that cannot oversell. MongoDB holds the data that does not fit fixed columns, product specs and the activity stream, and turns the stream into trending lists and conversion figures with aggregation pipelines. Customers and admins are separated in the app and again by MariaDB roles.</p>
<h3>Future enhancements</h3><ul><li>Vector embeddings of product descriptions for semantic search ("a quiet story about a monster").</li><li>A real payment gateway with webhooks updating payments.</li><li>A staff role between customer and admin (can ship orders, cannot change prices).</li><li>Change streams from MongoDB to update the dashboard live.</li><li>Read replicas for the catalogue and partitioning orders by year once data grows.</li></ul></section>

<section><h2>20. Viva questions</h2><dl>${QA.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("")}</dl></section>

<section><h2>Appendix A: setup and run</h2>${code(`# MariaDB and MongoDB must be running (sudo systemctl start mariadb mongod)
sudo sh setup.sh        # database, roles, users, .env.local with random passwords
npm install
npm run db:reset        # builds both databases from db/
npm run build && npm start      # http://localhost:3000   (or: npm run dev)
npm test                # 21 database tests, then npm run db:reset

Demo logins:  customer asha@example.com / demo1234     admin admin@inkpow.test / admin1234`)}</section>
<section><h2>Appendix B: hand-drawn ER diagram</h2>${img(join(ROOT, "docs/diagrams/er-hand-drawn.jpg"), "photo")}</section>
<section><h2>Appendix C: hand-drawn schema diagram</h2>${img(join(ROOT, "docs/diagrams/schema-hand-drawn.jpg"), "photo")}</section>
</body></html>`;

const out = join(ROOT, "docs", "project-report.html");
writeFileSync(out, html);
await owner.end(); await ro.end(); await mongo.close();
execFileSync("google-chrome", ["--headless=new", "--no-pdf-header-footer", "--virtual-time-budget=8000",
  `--print-to-pdf=${join(ROOT, "docs", "project-report.pdf")}`, "file://" + out], { stdio: "ignore" });
console.log("wrote docs/project-report.pdf");
