// lib/mongo.ts - every MongoDB part of INKPOW! is in this one file.
//
// Why MongoDB next to MariaDB:
//   * product_details - specs differ completely by kind of product. A comic has
//     issue, pages, writer, artist; a figure has height, material, joints,
//     accessories; a poster has size, paper weight, finish. In SQL that is either
//     a wide table full of NULLs or an entity-attribute-value table that is
//     painful to query. A document per product holds exactly its own fields.
//     The SQL product_id links the two: MariaDB stays the source of truth for
//     price, stock and orders (money needs transactions and foreign keys).
//   * activity - an append-only stream of events (views, searches, cart adds,
//     orders). High write volume, no joins, no updates, a shape that changes as
//     we track new things, and only ever summarised. A TTL index expires old events.
//
// Collections and indexes (created by scripts/reset-db.mjs):
//   product_details  {product_id: unique}, {tags: 1}, text index on tags/format/creators,
//                    $jsonSchema validator (product_id int, format, specs object, tags array)
//   activity         {type: 1, at: -1}, {product_id: 1, at: -1}, TTL {at: 1} 90 days
import "server-only";
import { MongoClient, type Db } from "mongodb";

const g = globalThis as unknown as { __inkpowMongo?: Promise<MongoClient> };

export async function mongo(): Promise<Db> {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set. Run `sudo sh setup.sh`.");
  g.__inkpowMongo ??= new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 }).connect();
  return (await g.__inkpowMongo).db(process.env.MONGODB_DB || "inkpow");
}

export type ProductDetails = {
  product_id: number; sku?: string; format: string;
  specs: Record<string, unknown>; tags: string[]; updated_at?: Date;
};

// ---------------------------------------------------------------- product_details (CRUD)

/** Read one product's document. */
export async function getDetails(productId: number) {
  const db = await mongo();
  return db.collection<ProductDetails>("product_details").findOne({ product_id: productId }, { projection: { _id: 0 } });
}

/** Create or update (upsert) one product's document. The $jsonSchema validator rejects bad shapes. */
export async function saveDetails(productId: number, d: { format: string; specs: Record<string, unknown>; tags: string[] }) {
  const db = await mongo();
  await db.collection("product_details").updateOne(
    { product_id: productId },
    { $set: { format: d.format, specs: d.specs, tags: d.tags, updated_at: new Date() } },
    { upsert: true });
}

/** Add or remove a single tag ($addToSet / $pull update operators). */
export async function changeTag(productId: number, tag: string, add: boolean) {
  const db = await mongo();
  await db.collection("product_details").updateOne({ product_id: productId },
    add ? { $addToSet: { tags: tag }, $set: { updated_at: new Date() } }
        : { $pull: { tags: tag }, $set: { updated_at: new Date() } } as any);
}

/** Delete one product's document. */
export async function deleteDetails(productId: number) {
  const db = await mongo();
  return (await db.collection("product_details").deleteOne({ product_id: productId })).deletedCount;
}

/** Product ids that carry a tag (uses the multikey index on tags). */
export async function idsWithTag(tag: string) {
  const db = await mongo();
  const docs = await db.collection("product_details").find({ tags: tag }, { projection: { product_id: 1 } }).toArray();
  return docs.map(d => d.product_id as number);
}

/** Product ids whose specs/tags match words, by text score (uses the text index). */
export async function textSearchIds(words: string) {
  const db = await mongo();
  const docs = await db.collection("product_details")
    .find({ $text: { $search: words } }, { projection: { product_id: 1, score: { $meta: "textScore" } } })
    .sort({ score: { $meta: "textScore" } }).toArray();
  return docs.map(d => d.product_id as number);
}

/** Every tag with how many products carry it ($unwind + $group aggregation). */
export async function tagCloud() {
  const db = await mongo();
  return db.collection("product_details").aggregate<{ tag: string; n: number }>([
    { $unwind: "$tags" },
    { $group: { _id: "$tags", n: { $sum: 1 } } },
    { $sort: { n: -1, _id: 1 } },
    { $project: { _id: 0, tag: "$_id", n: 1 } },
  ]).toArray();
}

/** Products sharing the most tags with this one (aggregation with $setIntersection). */
export async function relatedIds(productId: number, limit = 4) {
  const db = await mongo();
  const me = await getDetails(productId);
  if (!me) return [];
  const docs = await db.collection("product_details").aggregate([
    { $match: { product_id: { $ne: productId }, tags: { $in: me.tags } } },
    { $project: { product_id: 1, shared: { $size: { $setIntersection: ["$tags", me.tags] } } } },
    { $sort: { shared: -1, product_id: 1 } },
    { $limit: limit },
  ]).toArray();
  return docs.map(d => d.product_id as number);
}

// ---------------------------------------------------------------- activity (event log)

export type ActivityEvent =
  | { type: "view"; product_id: number; customer_id: number | null }
  | { type: "search"; query: string; results: number }
  | { type: "add_to_cart"; product_id: number; customer_id: number; quantity: number }
  | { type: "order"; order_id: number; customer_id: number; total: number };

/** Append one event. Never lets a logging failure break the page. */
export async function logEvent(e: ActivityEvent) {
  try { await (await mongo()).collection("activity").insertOne({ ...e, at: new Date() }); }
  catch (err) { console.error("activity log failed", err); }
}

/** Most viewed products in the last N days ($match + $group + $sort + $limit). */
export async function trending(days = 7, limit = 5) {
  const db = await mongo();
  return db.collection("activity").aggregate<{ product_id: number; views: number; viewers: number }>([
    { $match: { type: "view", at: { $gte: new Date(Date.now() - days * 864e5) } } },
    { $group: { _id: "$product_id", views: { $sum: 1 }, viewers: { $addToSet: "$customer_id" } } },
    { $project: { _id: 0, product_id: "$_id", views: 1, viewers: { $size: "$viewers" } } },
    { $sort: { views: -1, product_id: 1 } },
    { $limit: limit },
  ]).toArray();
}

/** What people search for ($group on the query string). */
export async function topSearches(limit = 6) {
  const db = await mongo();
  return db.collection("activity").aggregate<{ query: string; times: number; avg_results: number }>([
    { $match: { type: "search" } },
    { $group: { _id: { $toLower: "$query" }, times: { $sum: 1 }, avg_results: { $avg: "$results" } } },
    { $sort: { times: -1 } },
    { $limit: limit },
    { $project: { _id: 0, query: "$_id", times: 1, avg_results: { $round: ["$avg_results", 1] } } },
  ]).toArray();
}

/** Events per day and type for the last 14 days ($dateToString + $group). */
export async function dailyActivity(days = 14) {
  const db = await mongo();
  return db.collection("activity").aggregate<{ day: string; view: number; search: number; add_to_cart: number; order: number }>([
    { $match: { at: { $gte: new Date(Date.now() - days * 864e5) } } },
    { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, type: "$type" }, n: { $sum: 1 } } },
    { $group: { _id: "$_id.day", counts: { $push: { k: "$_id.type", v: "$n" } } } },
    { $replaceRoot: { newRoot: { $mergeObjects: [{ day: "$_id", view: 0, search: 0, add_to_cart: 0, order: 0 }, { $arrayToObject: "$counts" }] } } },
    { $sort: { day: 1 } },
  ]).toArray();
}

/** View -> cart conversion per product ($facet-free: one $group with $cond). */
export async function conversion(limit = 8) {
  const db = await mongo();
  return db.collection("activity").aggregate<{ product_id: number; views: number; adds: number; rate: number }>([
    { $match: { type: { $in: ["view", "add_to_cart"] } } },
    { $group: { _id: "$product_id",
        views: { $sum: { $cond: [{ $eq: ["$type", "view"] }, 1, 0] } },
        adds: { $sum: { $cond: [{ $eq: ["$type", "add_to_cart"] }, 1, 0] } } } },
    { $project: { _id: 0, product_id: "$_id", views: 1, adds: 1,
        rate: { $cond: [{ $gt: ["$views", 0] }, { $round: [{ $multiply: [{ $divide: ["$adds", "$views"] }, 100] }, 0] }, 0] } } },
    { $sort: { rate: -1, views: -1 } },
    { $limit: limit },
  ]).toArray();
}

/** Collection stats and indexes, for the Database tab. */
export async function describeMongo() {
  const db = await mongo();
  const out = [];
  for (const name of ["product_details", "activity"]) {
    const c = db.collection(name);
    out.push({
      name,
      count: await c.estimatedDocumentCount(),
      indexes: (await c.indexes()).map(i => ({ name: i.name, key: JSON.stringify(i.key), unique: !!i.unique,
        ttl: i.expireAfterSeconds as number | undefined })),
      sample: await c.findOne({}, { projection: { _id: 0 }, sort: name === "activity" ? { at: -1 } : { product_id: 1 } }),
    });
  }
  return out;
}
