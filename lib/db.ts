// lib/db.ts - every MariaDB part of INKPOW! is in this one file.
//
// The app never writes SQL anywhere else. Pages and API routes call the
// functions below. Sections:
//   1. Connections   one pool per database role (customer, admin, read-only)
//   2. Helpers       query / exec / call, turning SIGNALs into DatabaseError
//   3. Customers     sign up (a trigger creates the cart), log in
//   4. Catalogue     products come from the view v_product_catalog, search is FULLTEXT
//   5. Wishlist
//   6. Cart          adding goes through the procedure sp_add_to_cart
//   7. Orders        checkout is the procedure sp_place_order (one transaction)
//   8. Admin         dashboard numbers, stock edits, order status, restock procedure
//   9. Explorer      schema info, advanced objects, reports, read-only console
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import bcrypt from "bcryptjs";

type Row = Record<string, any>;

/** A rule in the database said no: a SIGNAL from a trigger or procedure, a CHECK
 * constraint or a unique key. The message is written for the person using the site. */
export class DatabaseError extends Error {}

// ================================================================ 1. connections
// Credentials come from environment variables (.env.local, written by setup.sh).
// Each pool logs in as a different MariaDB user, and each user holds one MariaDB
// role (see db/security.sql), so the database itself enforces who can do what.
export type DbRole = "customer" | "admin" | "readonly";

const g = globalThis as unknown as { __inkpowPools?: Record<DbRole, Pool> };

function makePool(user?: string, password?: string, extra: object = {}) {
  if (!user) throw new Error("Database settings are missing. Run `sudo sh setup.sh` to create .env.local.");
  return mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
    user, password, connectionLimit: 5, dateStrings: true, decimalNumbers: true, ...extra,
  });
}

function pool(role: DbRole): Pool {
  g.__inkpowPools ??= {
    customer: makePool(process.env.DB_CUSTOMER_USER, process.env.DB_CUSTOMER_PASSWORD),
    admin: makePool(process.env.DB_ADMIN_USER, process.env.DB_ADMIN_PASSWORD),
    readonly: makePool(process.env.DB_READONLY_USER, process.env.DB_READONLY_PASSWORD),
  };
  return g.__inkpowPools[role];
}

// ================================================================ 2. helpers
function friendly(e: any): Error {
  switch (e?.errno) {
    case 1644: return new DatabaseError(e.sqlMessage);                       // our own SIGNAL
    case 4025: return new DatabaseError("That value breaks a rule in the database (" + (e.sqlMessage.match(/CONSTRAINT `(\w+)`/)?.[1] ?? "CHECK") + ").");
    case 1062: return new DatabaseError("That already exists.");             // unique key
    case 1142: case 1143: case 1370: return new DatabaseError("The database refused: your role is not allowed to do that.");
    default: return e;
  }
}

export async function query<T = Row>(sql: string, args: any[] = [], role: DbRole = "customer"): Promise<T[]> {
  try {
    const [rows] = await pool(role).query<RowDataPacket[]>(sql, args);
    return rows as T[];
  } catch (e) { throw friendly(e); }
}

export async function one<T = Row>(sql: string, args: any[] = [], role: DbRole = "customer"): Promise<T | null> {
  return (await query<T>(sql, args, role))[0] ?? null;
}

/** INSERT / UPDATE / DELETE. Autocommit is on, so each statement is its own transaction. */
export async function exec(sql: string, args: any[] = [], role: DbRole = "customer") {
  try {
    const [res] = await pool(role).execute<ResultSetHeader>(sql, args);
    return res;
  } catch (e) { throw friendly(e); }
}

/** CALL a stored procedure on one connection. With an OUT parameter, its value is returned. */
async function call(procedure: string, args: any[], role: DbRole, out = false): Promise<any> {
  const con = await pool(role).getConnection();
  try {
    const marks = [...args.map(() => "?"), ...(out ? ["@out"] : [])].join(", ");
    const [res] = await con.query(`CALL ${procedure}(${marks})`, args);
    if (out) {
      const [r] = await con.query<RowDataPacket[]>("SELECT @out AS value");
      return r[0].value;
    }
    return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : [];
  } catch (e) { throw friendly(e); }
  finally { con.release(); }
}

// ================================================================ 3. customers
export type User = { customer_id: number; first_name: string; last_name: string; email: string; role: "customer" | "admin" };

export function getCustomer(id: number) {
  return one<User>("SELECT customer_id, first_name, last_name, email, role FROM customers WHERE customer_id = ?", [id]);
}

/** trg_customers_before_insert lower-cases the email and refuses duplicates;
 * trg_customers_after_insert gives the new customer an empty cart.
 * The customer role may not write the role column, so new accounts are always customers. */
export async function createCustomer(f: { first_name: string; last_name: string; email: string; phone: string; password: string }) {
  const res = await exec(
    "INSERT INTO customers (first_name, last_name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)",
    [f.first_name, f.last_name, f.email, f.phone || null, await bcrypt.hash(f.password, 10)]);
  return res.insertId;
}

export async function checkLogin(email: string, password: string) {
  const row = await one("SELECT customer_id, first_name, role, password_hash FROM customers WHERE email = ?",
    [email.trim().toLowerCase()]);
  if (row && row.password_hash && (await bcrypt.compare(password, row.password_hash))) return row as Row;
  return null;
}

// ================================================================ 4. catalogue
const PRODUCT_SELECT = "SELECT p.* FROM v_product_catalog p";

export const SORTS: Record<string, [string, string]> = {
  new: ["Newest", "p.created_at DESC"],
  low: ["Price: low to high", "p.price ASC"],
  high: ["Price: high to low", "p.price DESC"],
  top: ["Top rated", "p.rating DESC"],
};

/** Sub-categories with their parent's name (self join) and a product count. */
export function listCategories() {
  return query(`
    SELECT c.category_id, c.name, parent.name AS parent, COUNT(p.product_id) AS pieces
      FROM categories c
      JOIN categories parent ON parent.category_id = c.parent_category_id
      LEFT JOIN products p ON p.category_id = c.category_id
     GROUP BY c.category_id, c.name, parent.name
     ORDER BY parent.name, c.name`);
}

export const featuredProduct = () => one(PRODUCT_SELECT + " ORDER BY p.rating DESC, p.price DESC LIMIT 1");
export const latestProducts = (limit = 8) => query(PRODUCT_SELECT + " ORDER BY p.created_at DESC LIMIT ?", [limit]);

/** Search uses the FULLTEXT index ft_products_search (MATCH ... AGAINST in boolean
 * mode, so "robo*" matches "robots"). ids narrows to products picked by MongoDB (tag filter). */
export function searchProducts(opts: { category?: number; search?: string; sort?: string; ids?: number[] }) {
  const where: string[] = [], args: any[] = [];
  if (opts.category) {
    where.push("p.category_id IN (SELECT category_id FROM categories WHERE category_id = ? OR parent_category_id = ?)");
    args.push(opts.category, opts.category);
  }
  if (opts.search) {
    const words = opts.search.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
    if (words.length) {
      where.push("p.product_id IN (SELECT product_id FROM products WHERE MATCH(name, description) AGAINST (? IN BOOLEAN MODE))");
      args.push(words.map(w => w + "*").join(" "));
    }
  }
  if (opts.ids) {
    if (!opts.ids.length) return Promise.resolve([]);
    where.push(`p.product_id IN (${opts.ids.map(() => "?").join(",")})`);
    args.push(...opts.ids);
  }
  const order = SORTS[opts.sort ?? "new"]?.[1] ?? SORTS.new[1];
  return query(PRODUCT_SELECT + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY " + order, args);
}

export function productsByIds(ids: number[]) {
  if (!ids.length) return Promise.resolve([]);
  return query(PRODUCT_SELECT + ` WHERE p.product_id IN (${ids.map(() => "?").join(",")})`, ids);
}

export function getProduct(id: number) {
  return one(`
    SELECT p.*, c.name AS category, s.name AS supplier, s.address AS supplier_city
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
      JOIN suppliers s ON s.supplier_id = p.supplier_id
     WHERE p.product_id = ?`, [id]);
}

export const productImages = (id: number) =>
  query("SELECT image_url FROM product_images WHERE product_id = ? ORDER BY image_id", [id]);

export const productForCover = (id: number) =>
  one("SELECT p.name, p.sku, c.name AS category FROM products p JOIN categories c ON c.category_id = p.category_id WHERE p.product_id = ?", [id]);

export function productReviews(id: number) {
  return query(`
    SELECT r.rating, r.comment, r.review_date, cu.first_name
      FROM reviews r JOIN customers cu ON cu.customer_id = r.customer_id
     WHERE r.product_id = ? ORDER BY r.review_date DESC, r.review_id DESC`, [id]);
}

/** Average rating (stored function fn_product_rating) and count, for one product or the store. */
export function reviewSummary(id?: number) {
  if (id === undefined) return one("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews");
  return one("SELECT fn_product_rating(?) AS avg, COUNT(*) AS n FROM reviews WHERE product_id = ?", [id, id]);
}

export function latestFiveStarReview() {
  return one(`
    SELECT r.comment, cu.first_name, p.name AS product, p.product_id
      FROM reviews r
      JOIN customers cu ON cu.customer_id = r.customer_id
      JOIN products p ON p.product_id = r.product_id
     WHERE r.rating = 5 ORDER BY r.review_date DESC LIMIT 1`);
}

/** trg_reviews_before_insert (and the CHECK chk_reviews_rating) refuse ratings outside 1-5. */
export const addReview = (productId: number, customerId: number, rating: number, comment: string) =>
  exec("INSERT INTO reviews (product_id, customer_id, rating, comment) VALUES (?, ?, ?, ?)",
    [productId, customerId, rating, comment]);

// ================================================================ 5. wishlist
export function wishlistProducts(customerId: number) {
  return query(PRODUCT_SELECT + " JOIN wishlist w ON w.product_id = p.product_id WHERE w.customer_id = ? ORDER BY w.added_at DESC", [customerId]);
}

export async function isWished(customerId: number, productId: number) {
  return !!(await one("SELECT 1 AS yes FROM wishlist WHERE customer_id = ? AND product_id = ?", [customerId, productId]));
}

export async function toggleWishlist(customerId: number, productId: number) {
  const del = await exec("DELETE FROM wishlist WHERE customer_id = ? AND product_id = ?", [customerId, productId]);
  if (del.affectedRows) return false;
  await exec("INSERT INTO wishlist (customer_id, product_id) VALUES (?, ?)", [customerId, productId]);
  return true;
}

// ================================================================ 6. cart
export async function cartCount(customerId: number) {
  const r = await one("SELECT COALESCE(SUM(ci.quantity), 0) AS n FROM cart c JOIN cart_items ci ON ci.cart_id = c.cart_id WHERE c.customer_id = ?", [customerId]);
  return Number(r?.n ?? 0);
}

export function cartRows(customerId: number) {
  return query(`
    SELECT ci.cart_item_id, ci.quantity, p.product_id, p.name, p.price, p.stock_quantity,
           p.price * ci.quantity AS line_total, p.image_url
      FROM cart c
      JOIN cart_items ci ON ci.cart_id = c.cart_id
      JOIN v_product_catalog p ON p.product_id = ci.product_id
     WHERE c.customer_id = ?
     ORDER BY ci.added_at, ci.cart_item_id`, [customerId]);
}

/** sp_add_to_cart finds or makes the cart, refuses sold-out products and
 * bumps the quantity if the product is already there. */
export const addToCart = (customerId: number, productId: number, qty: number) =>
  call("sp_add_to_cart", [customerId, productId, qty], "customer");

/** Change a cart line, or delete it at 0. Only touches the customer's own cart. */
export async function setCartQuantity(customerId: number, itemId: number, qty: number) {
  const mine = "cart_id = (SELECT cart_id FROM cart WHERE customer_id = ? LIMIT 1)";
  if (qty < 1) await exec(`DELETE FROM cart_items WHERE cart_item_id = ? AND ${mine}`, [itemId, customerId]);
  else await exec(`UPDATE cart_items SET quantity = ? WHERE cart_item_id = ? AND ${mine}`, [qty, itemId, customerId]);
}

// ================================================================ 7. orders
export const PAYMENT_METHODS = ["UPI", "Card", "Net Banking", "Cash on Delivery"];

export const customerAddresses = (customerId: number) =>
  query("SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, address_id", [customerId]);

/** Checkout. sp_place_order runs it all as one transaction (with SELECT ... FOR UPDATE in
 * the stock trigger) and rolls everything back on any error. Returns the new order id. */
export function placeOrder(customerId: number, method: string, addressId: number | null,
  a: { address_line?: string; city?: string; state?: string; postal_code?: string; country?: string } = {}) {
  return call("sp_place_order", [customerId, addressId, a.address_line ?? null, a.city ?? null,
    a.state ?? null, a.postal_code ?? null, a.country ?? null, method], "customer", true) as Promise<number>;
}

export const listOrders = (customerId: number) =>
  query("SELECT order_id, order_date, status, total_amount, line_count, pieces FROM v_order_summary WHERE customer_id = ? ORDER BY order_id DESC", [customerId]);

/** One order with address, payment and shipment. customerId null = admin (any order). */
export function getOrder(orderId: number, customerId: number | null) {
  return one(`
    SELECT o.*, a.address_line, a.city, a.state, a.postal_code, a.country,
           pay.payment_method, pay.payment_status, s.carrier, s.tracking_number,
           s.shipped_date, s.delivered_date, s.status AS shipment_status,
           cu.first_name, cu.last_name
      FROM orders o
      JOIN customers cu ON cu.customer_id = o.customer_id
      JOIN addresses a ON a.address_id = o.shipping_address_id
      LEFT JOIN payments pay ON pay.order_id = o.order_id
      LEFT JOIN shipments s ON s.order_id = o.order_id
     WHERE o.order_id = ? AND (? IS NULL OR o.customer_id = ?)`,
    [orderId, customerId, customerId], customerId === null ? "admin" : "customer");
}

export const orderItems = (orderId: number, role: DbRole = "customer") => query(`
    SELECT oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total, p.product_id, p.name
      FROM order_items oi JOIN products p ON p.product_id = oi.product_id
     WHERE oi.order_id = ?`, [orderId], role);

// ================================================================ 8. admin (runs as the admin role)
export async function adminStats() {
  return one(`
    SELECT (SELECT COUNT(*) FROM orders) AS orders,
           (SELECT COALESCE(SUM(total_amount), 0) FROM orders) AS revenue,
           (SELECT COUNT(*) FROM customers WHERE role = 'customer') AS customers,
           (SELECT COUNT(*) FROM v_low_stock) AS low_stock,
           (SELECT COUNT(*) FROM orders WHERE status <> 'Delivered') AS open_orders`, [], "admin");
}

export const adminOrders = () => query(`
    SELECT v.order_id, v.order_date, v.status, v.total_amount, v.pieces, v.payment_method,
           v.payment_status, CONCAT(cu.first_name, ' ', cu.last_name) AS customer
      FROM v_order_summary v JOIN customers cu ON cu.customer_id = v.customer_id
     ORDER BY v.order_id DESC`, [], "admin");

export const adminProducts = () => query(`
    SELECT p.product_id, p.name, p.sku, p.price, p.stock_quantity, c.name AS category
      FROM products p JOIN categories c ON c.category_id = p.category_id
     ORDER BY p.product_id`, [], "admin");

/** CHECK constraints chk_products_price / chk_products_stock refuse negative values. */
export const updateProduct = (id: number, price: number, stock: number) =>
  exec("UPDATE products SET price = ?, stock_quantity = ? WHERE product_id = ?", [price, stock, id], "admin");

/** sp_advance_order moves the shipment one step; trg_shipments_after_update moves the order and payment. */
export const advanceOrder = (orderId: number) => call("sp_advance_order", [orderId], "admin");

/** Admin-only DELETE: removes a review (moderation). */
export const deleteReview = (reviewId: number) => exec("DELETE FROM reviews WHERE review_id = ?", [reviewId], "admin");
export const adminReviews = () => query(`
    SELECT r.review_id, r.rating, r.comment, r.review_date, p.name AS product, cu.first_name
      FROM reviews r JOIN products p ON p.product_id = r.product_id JOIN customers cu ON cu.customer_id = r.customer_id
     ORDER BY r.review_date DESC, r.review_id DESC`, [], "admin");

/** Cursor-based sp_restock_low_stock. Returns its report rows. */
export const restockLowStock = (threshold = 5, amount = 10) =>
  call("sp_restock_low_stock", [threshold, amount], "admin");

export const customerTiers = () => call("sp_customer_tiers", [], "admin");

// ================================================================ 9. explorer (Database tab)
export const TABLES = ["customers", "addresses", "categories", "suppliers", "products", "product_images",
  "reviews", "wishlist", "cart", "cart_items", "orders", "order_items", "payments", "shipments"];

export function browseSql(table: string) {
  return table === "customers"
    ? "SELECT customer_id, first_name, last_name, email, phone, role, created_at FROM customers"
    : `SELECT * FROM ${table}`;
}

export async function describeSchema() {
  const cols = await query(`
    SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS name, c.COLUMN_TYPE AS type, c.COLUMN_KEY = 'PRI' AS pk,
           CONCAT(k.REFERENCED_TABLE_NAME, '.', k.REFERENCED_COLUMN_NAME) AS fk
      FROM information_schema.COLUMNS c
      LEFT JOIN information_schema.KEY_COLUMN_USAGE k
             ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
            AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
     WHERE c.TABLE_SCHEMA = DATABASE()
     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`, [], "readonly");
  const counts = await query(TABLES.map(t => `SELECT '${t}' AS t, COUNT(*) AS n FROM \`${t}\``).join(" UNION ALL "), [], "readonly");
  return TABLES.map(t => ({ name: t, rows: counts.find(c => c.t === t)?.n ?? 0, cols: cols.filter(c => c.t === t) }));
}

export function splitSql(text: string) {
  let delimiter = ";", buf: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.toUpperCase().startsWith("DELIMITER ")) { delimiter = stripped.split(/\s+/)[1]; continue; }
    buf.push(line);
    const code = stripped.replace(/\s--\s.*$/, "").trimEnd();
    if (code.endsWith(delimiter)) {
      buf[buf.length - 1] = code.slice(0, -delimiter.length);
      const stmt = buf.join("\n").trim();
      buf = [];
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
    }
  }
  return out;
}

const KIND_TITLES: Record<string, string> = { VIEW: "Views", FUNCTION: "Stored functions",
  PROCEDURE: "Stored procedures", TRIGGER: "Triggers", INDEX: "Indexes" };

/** Objects defined in advanced.sql, each with its source and whether the live database has it. */
export async function advancedObjects() {
  const liveRows = await query(`
    SELECT 'VIEW' AS k, TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()
    UNION ALL SELECT ROUTINE_TYPE, ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
    UNION ALL SELECT 'TRIGGER', TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
    UNION ALL SELECT DISTINCT 'INDEX', INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`, [], "admin");
  const live = new Set(liveRows.map(r => `${r.k}:${r.n}`));
  const groups: Record<string, { name: string; sql: string; about: string; live: boolean }[]> =
    Object.fromEntries(Object.keys(KIND_TITLES).map(k => [k, []]));
  for (const stmt of splitSql(readFileSync(join(process.cwd(), "db", "advanced.sql"), "utf8"))) {
    const lines = stmt.split("\n");
    const comment = lines.filter(l => l.trim().startsWith("--")).map(l => l.trim().slice(2).trim())
      .filter(c => c && !/^=+$/.test(c));
    const body = lines.filter(l => !l.trim().startsWith("--")).join("\n").trim();
    const m = body.match(/CREATE\s+(VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX)\s+(\w+)/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    groups[kind].push({ name: m[2], sql: body, about: comment.slice(-3).join(" "), live: live.has(`${kind}:${m[2]}`) });
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => ({ title: KIND_TITLES[k], items: v }));
}

/** The ALTER / DROP migration and the role grants, shown on the Database tab. */
export function sqlFile(name: "migrations.sql" | "security.sql" | "schema.sql") {
  return readFileSync(join(process.cwd(), "db", name), "utf8");
}

/** The SQL console runs as inkpow_ro (role inkpow_readonly): SELECT only, 5 s limit. */
export async function runConsole(sql: string, limit = 200): Promise<{ columns: string[]; rows: any[][]; error?: string }> {
  const con = await pool("readonly").getConnection();
  try {
    await con.query("SET SESSION max_statement_time = 5");
    const [res, fields] = await con.query({ sql, rowsAsArray: true });
    let rows: any = res, cols: any = fields;
    if (Array.isArray(res) && Array.isArray(res[0]) && Array.isArray(fields?.[0])) { rows = res[0]; cols = fields[0]; } // CALL
    if (!Array.isArray(cols) || !cols.length) return { columns: [], rows: [] };
    return { columns: cols.map((f: any) => f.name), rows: (rows as any[]).slice(0, limit) };
  } catch (e: any) {
    return { columns: [], rows: [], error: e.sqlMessage ?? String(e.message ?? e) };
  } finally { con.release(); }
}
