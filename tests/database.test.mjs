// Database tests: constraints, triggers, procedures, transactions, roles and MongoDB.
//   npm test          (run `npm run db:reset` afterwards to restore the sample data)
// Each test connects as the same MariaDB user the web app uses for that job.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const env = process.env;
const connect = (user, password) => mysql.createConnection({ host: env.DB_HOST, database: env.DB_NAME, user, password, dateStrings: true });
const customer = await connect(env.DB_CUSTOMER_USER, env.DB_CUSTOMER_PASSWORD);
const admin = await connect(env.DB_ADMIN_USER, env.DB_ADMIN_PASSWORD);
const ro = await connect(env.DB_READONLY_USER, env.DB_READONLY_PASSWORD);
const mongoClient = await new MongoClient(env.MONGODB_URI).connect();
const mdb = mongoClient.db(env.MONGODB_DB);
const val = async (con, sql, args = []) => Object.values((await con.query(sql, args))[0][0])[0];

after(async () => { await customer.end(); await admin.end(); await ro.end(); await mongoClient.close(); });

const email = `t${Date.now()}@test.example`;

// ---------------------------------------------------------------- triggers and constraints
test("sign-up trigger lower-cases the email and creates a cart", async () => {
  const [r] = await customer.query("INSERT INTO customers (first_name, last_name, email, password_hash) VALUES ('Tia', 'Test', ?, 'x')", [email.toUpperCase()]);
  assert.equal(await val(customer, "SELECT email FROM customers WHERE customer_id = ?", [r.insertId]), email);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM cart WHERE customer_id = ?", [r.insertId]), 1);
});

test("duplicate email is refused by trg_customers_before_insert", async () => {
  await assert.rejects(customer.query("INSERT INTO customers (email) VALUES (?)", [email]), /already has an account/);
});

test("rating outside 1-5 is refused (trigger and CHECK)", async () => {
  await assert.rejects(customer.query("INSERT INTO reviews (product_id, customer_id, rating) VALUES (1, 1, 9)"), /between 1 and 5/);
  await assert.rejects(admin.query("UPDATE reviews SET rating = 0 WHERE review_id = 1"), /between 1 and 5|chk_reviews_rating/);
});

test("CHECK constraint refuses a negative price", async () => {
  await assert.rejects(admin.query("UPDATE products SET price = -1 WHERE product_id = 1"), /chk_products_price/);
});

test("cart quantity below 1 is refused by trigger", async () => {
  await assert.rejects(customer.query("UPDATE cart_items SET quantity = 0 WHERE cart_item_id = 1"), /at least 1/);
});

test("email is NOT NULL", async () => {
  await assert.rejects(admin.query("INSERT INTO customers (first_name) VALUES ('NoEmail')"), /email/);
});

test("foreign key refuses an order for a customer that does not exist", async () => {
  await assert.rejects(admin.query("INSERT INTO orders (customer_id, shipping_address_id, total_amount) VALUES (99999, 1, 10)"), /foreign key/i);
});

// ---------------------------------------------------------------- procedures and transactions
test("sp_add_to_cart refuses an unknown product", async () => {
  await assert.rejects(customer.query("CALL sp_add_to_cart(1, 9999, 1)"), /No such product/);
});

test("sp_place_order: a full checkout writes order, items, payment and shipment", async () => {
  const id = await val(customer, "SELECT customer_id FROM customers WHERE email = ?", [email]);
  await customer.query("CALL sp_add_to_cart(?, 1, 2)", [id]);
  const stockBefore = await val(customer, "SELECT stock_quantity FROM products WHERE product_id = 1");
  await customer.query("CALL sp_place_order(?, NULL, '1 Test Road', 'Pune', 'MH', '411001', 'India', 'UPI', @o)", [id]);
  const orderId = await val(customer, "SELECT @o");
  assert.ok(orderId > 0);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM order_items WHERE order_id = ?", [orderId]), 1);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM payments WHERE order_id = ?", [orderId]), 1);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM shipments WHERE order_id = ?", [orderId]), 1);
  assert.equal(await val(customer, "SELECT stock_quantity FROM products WHERE product_id = 1"), stockBefore - 2);
  assert.equal(await val(customer, "SELECT fn_order_total(?) = total_amount FROM orders WHERE order_id = ?", [orderId, orderId]), 1);
});

test("sp_place_order rolls everything back when stock runs out", async () => {
  const id = await val(customer, "SELECT customer_id FROM customers WHERE email = ?", [email]);
  await customer.query("CALL sp_add_to_cart(?, 2, 1)", [id]);
  await customer.query("CALL sp_add_to_cart(?, 12, 999)", [id]);
  const orders = await val(customer, "SELECT COUNT(*) FROM orders");
  const addresses = await val(customer, "SELECT COUNT(*) FROM addresses");
  const stock2 = await val(customer, "SELECT stock_quantity FROM products WHERE product_id = 2");
  await assert.rejects(customer.query("CALL sp_place_order(?, NULL, 'x', 'x', 'x', 'x', 'x', 'UPI', @o)", [id]), /Not enough stock/);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM orders"), orders);
  assert.equal(await val(customer, "SELECT COUNT(*) FROM addresses"), addresses);
  assert.equal(await val(customer, "SELECT stock_quantity FROM products WHERE product_id = 2"), stock2, "stock of the first line is restored");
});

test("sp_advance_order + trigger move the order and payment along", async () => {
  const orderId = await val(admin, "SELECT MAX(order_id) FROM orders");
  await admin.query("CALL sp_advance_order(?)", [orderId]);
  assert.equal(await val(admin, "SELECT status FROM orders WHERE order_id = ?", [orderId]), "Shipped");
  await admin.query("CALL sp_advance_order(?)", [orderId]);
  assert.equal(await val(admin, "SELECT status FROM orders WHERE order_id = ?", [orderId]), "Delivered");
  assert.equal(await val(admin, "SELECT payment_status FROM payments WHERE order_id = ?", [orderId]), "Paid");
});

test("FULLTEXT search finds a word in the description", async () => {
  const [rows] = await customer.query("SELECT name FROM products WHERE MATCH(name, description) AGAINST ('robot*' IN BOOLEAN MODE)");
  assert.deepEqual(rows.map(r => r.name), ["Mecha Chai Club Vol. 3"]);
});

// ---------------------------------------------------------------- roles and privileges
test("customer role cannot write the role column (no self-made admins)", async () => {
  await assert.rejects(customer.query("INSERT INTO customers (email, role) VALUES ('x@x', 'admin')"), /denied.*role/);
});

test("customer role cannot change prices or call admin procedures", async () => {
  await assert.rejects(customer.query("UPDATE products SET price = 1"), /denied/);
  await assert.rejects(customer.query("CALL sp_restock_low_stock(5, 10)"), /denied/);
});

test("admin role can change data but cannot DROP or ALTER", async () => {
  await assert.rejects(admin.query("DROP TABLE wishlist"), /denied/);
  await assert.rejects(admin.query("ALTER TABLE products ADD COLUMN x INT"), /denied/);
});

test("read-only role cannot see password_hash or write", async () => {
  await assert.rejects(ro.query("SELECT password_hash FROM customers"), /denied.*password_hash/);
  await assert.rejects(ro.query("DELETE FROM reviews"), /denied/);
  const [rows] = await ro.query("SELECT COUNT(*) AS n FROM v_product_catalog");
  assert.equal(rows[0].n, 12);
});

// ---------------------------------------------------------------- MongoDB
test("MongoDB validator refuses a badly shaped product document", async () => {
  await assert.rejects(mdb.collection("product_details").insertOne({ product_id: "seven", format: 1 }), /validation/i);
});

test("MongoDB unique index refuses a second document for the same product", async () => {
  await assert.rejects(mdb.collection("product_details").insertOne({ product_id: 1, format: "comic", specs: {}, tags: [] }), /duplicate key/);
});

test("MongoDB update, read and delete of a product document", async () => {
  const c = mdb.collection("product_details");
  await c.updateOne({ product_id: 500 }, { $set: { format: "test", specs: { pages: 1 }, tags: ["a"] } }, { upsert: true });
  await c.updateOne({ product_id: 500 }, { $addToSet: { tags: "b" } });
  assert.deepEqual((await c.findOne({ product_id: 500 })).tags, ["a", "b"]);
  assert.equal((await c.deleteOne({ product_id: 500 })).deletedCount, 1);
});

test("MongoDB aggregation: tag cloud and trending", async () => {
  const tags = await mdb.collection("product_details").aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
  assert.equal(tags[0]._id, "superhero");
  const trending = await mdb.collection("activity").aggregate([{ $match: { type: "view" } }, { $group: { _id: "$product_id", v: { $sum: 1 } } }]).toArray();
  assert.ok(trending.length > 0);
});

test("MongoDB activity has a TTL index", async () => {
  const idx = await mdb.collection("activity").indexes();
  assert.ok(idx.some(i => i.expireAfterSeconds === 90 * 86400));
});
