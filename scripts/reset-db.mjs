// Rebuild both databases from the files in db/.
//   npm run db:reset
// MariaDB: drops every view, routine and table, then runs schema.sql, seed.sql,
//          advanced.sql, migrations.sql and security.sql as the owner account.
// MongoDB: drops the inkpow database, loads mongo-seed.json, creates the
//          indexes and some sample activity.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(ROOT, ".env.local"));
const env = process.env;

const SQL_FILES = ["schema.sql", "seed.sql", "advanced.sql", "migrations.sql", "security.sql"];
const TABLES = ["customers", "addresses", "categories", "suppliers", "products", "product_images",
  "reviews", "wishlist", "cart", "cart_items", "orders", "order_items", "payments", "shipments"];

// Split a .sql file into statements, honouring DELIMITER lines like the mariadb client does.
export function splitSql(text) {
  let delimiter = ";", buf = [];
  const out = [];
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

async function resetMaria() {
  const con = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME,
    user: env.DB_OWNER_USER, password: env.DB_OWNER_PASSWORD,
  });
  const [views] = await con.query("SELECT TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()");
  for (const v of views) await con.query(`DROP VIEW IF EXISTS \`${v.n}\``);
  const [routines] = await con.query("SELECT ROUTINE_NAME AS n, ROUTINE_TYPE AS t FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()");
  for (const r of routines) await con.query(`DROP ${r.t} IF EXISTS \`${r.n}\``);
  await con.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of TABLES) await con.query(`DROP TABLE IF EXISTS \`${t}\``);
  await con.query("SET FOREIGN_KEY_CHECKS = 1");

  for (const file of SQL_FILES) {
    for (const stmt of splitSql(readFileSync(join(ROOT, "db", file), "utf8"))) {
      try { await con.query(stmt); }
      catch (e) { throw new Error(`${file}: ${e.message}\n${stmt.slice(0, 200)}`); }
    }
  }
  // Sample passwords: every customer gets demo1234, the admin gets admin1234.
  await con.execute("UPDATE customers SET password_hash = ? WHERE role = 'customer'", [bcrypt.hashSync("demo1234", 10)]);
  await con.execute("UPDATE customers SET password_hash = ? WHERE role = 'admin'", [bcrypt.hashSync("admin1234", 10)]);
  await con.end();
}

async function resetMongo() {
  const client = await new MongoClient(env.MONGODB_URI).connect();
  const db = client.db(env.MONGODB_DB);
  await db.dropDatabase();
  const seed = JSON.parse(readFileSync(join(ROOT, "db", "mongo-seed.json"), "utf8"));

  // product_details: one flexible document per product, keyed by the SQL product_id.
  await db.createCollection("product_details", {
    validator: { $jsonSchema: {
      bsonType: "object", required: ["product_id", "format", "specs", "tags"],
      properties: {
        product_id: { bsonType: "int", minimum: 1 },
        format: { bsonType: "string" },
        specs: { bsonType: "object" },
        tags: { bsonType: "array", items: { bsonType: "string" } },
      },
    } },
  });
  const now = new Date();
  await db.collection("product_details").insertMany(seed.product_details.map(d => ({ ...d, updated_at: now })));
  await db.collection("product_details").createIndex({ product_id: 1 }, { unique: true });
  await db.collection("product_details").createIndex({ tags: 1 });
  await db.collection("product_details").createIndex(
    { tags: "text", format: "text", "specs.writer": "text", "specs.artist": "text", "specs.mangaka": "text" },
    { name: "details_text" });

  // activity: an append-only event log (views, searches, cart adds, orders).
  const act = db.collection("activity");
  await act.createIndex({ type: 1, at: -1 });
  await act.createIndex({ product_id: 1, at: -1 });
  await act.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });   // TTL: kept 90 days
  const searches = ["voltage", "manga", "figure", "poster", "ronin", "kaiju", "sparrow", "box set"];
  let seedN = 7;
  const rand = n => { seedN = (seedN * 9301 + 49297) % 233280; return Math.floor((seedN / 233280) * n); };
  const events = [];
  for (let i = 0; i < 260; i++) {
    const at = new Date(now.getTime() - rand(14 * 24) * 3600e3);
    const r = rand(10);
    if (r < 6) events.push({ type: "view", product_id: 1 + rand(12), customer_id: rand(3) ? 1 + rand(4) : null, at });
    else if (r < 8) events.push({ type: "search", query: searches[rand(searches.length)], results: 1 + rand(4), at });
    else events.push({ type: "add_to_cart", product_id: 1 + rand(12), customer_id: 1 + rand(4), quantity: 1 + rand(2), at });
  }
  await act.insertMany(events);
  await client.close();
}

await resetMaria();
console.log("MariaDB rebuilt from", SQL_FILES.join(", "));
await resetMongo();
console.log("MongoDB rebuilt: product_details, activity");
