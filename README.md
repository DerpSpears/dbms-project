# INKPOW!

An online comic and collectibles store with two databases underneath it:

- **MariaDB** (MySQL compatible) for customers, the catalogue, carts, orders, payments and shipments. These need transactions, foreign keys and exact money values.
- **MongoDB** for product specs, which have different fields for every kind of product, and for an activity log of views, searches, cart adds and orders that the admin dashboard summarises.

The web app is Next.js 15. Pages read data on the server, and every form posts to an API route under `app/api`. All SQL is in `lib/db.ts` and all MongoDB code is in `lib/mongo.ts`.

The full write-up is in [`docs/project-report.pdf`](docs/project-report.pdf). It covers the problem statement, ER diagram, schema, data dictionary, every query with its output, screenshots, test results and viva questions.

## Setup

You need MariaDB, MongoDB and Node.js 20 or newer.

```sh
sudo systemctl start mariadb mongod
sudo sh setup.sh          # creates the database, 3 roles, 4 users and .env.local with random passwords
npm install
npm run db:reset          # builds both databases from db/
npm run build && npm start    # http://localhost:3000  (or npm run dev)
```

Demo logins:

| Role | Email | Password |
|---|---|---|
| Customer | asha@example.com | demo1234 |
| Admin | admin@inkpow.test | admin1234 |

Run the tests with `npm test`, then `npm run db:reset` to put the sample data back.

## What is where

| Path | Contents |
|---|---|
| `db/schema.sql` | The 14 tables, exactly as in the hand-drawn schema diagram |
| `db/seed.sql` | Sample data |
| `db/advanced.sql` | Views, functions, procedures with cursors, triggers, indexes |
| `db/migrations.sql` | ALTER and DROP: role column, CHECK constraints, UNIQUE email, FULLTEXT index |
| `db/security.sql` | What each MariaDB role may do |
| `db/mongo-seed.json` | Product spec documents |
| `lib/db.ts` | Every SQL statement the app runs, with one connection pool per role |
| `lib/mongo.ts` | MongoDB CRUD and aggregation pipelines |
| `lib/auth.ts` | bcrypt passwords and a signed JWT session cookie |
| `app/api/` | The API layer: 16 route handlers |
| `scripts/reset-db.mjs` | Rebuilds MariaDB and MongoDB |
| `tests/database.test.mjs` | 21 tests of constraints, triggers, transactions, roles and MongoDB |
| `docs/` | Project report, hand-drawn diagrams |

## Database features

| Feature | Where |
|---|---|
| CREATE, ALTER, DROP | `schema.sql`, `migrations.sql`, reset script |
| Primary keys, 18 foreign keys, NOT NULL, UNIQUE, CHECK, ENUM, defaults | `schema.sql`, `migrations.sql` |
| 4 views, 3 stored functions, 5 stored procedures | `advanced.sql` |
| Cursors, SIGNAL / RESIGNAL, handlers | inside the procedures |
| 8 triggers | email check, cart creation, rating, quantity, stock, order status |
| Transaction with row locking | checkout (`sp_place_order`) |
| Indexes: single, composite, unique, FULLTEXT | `advanced.sql`, `migrations.sql` |
| Roles and column-level privileges | `setup.sh`, `security.sql` |
| JOIN, GROUP BY, HAVING, subqueries, UNION, window functions, recursive CTE | reports on the Database tab |
| MongoDB validator, unique, multikey, text and TTL indexes | `scripts/reset-db.mjs` |
| MongoDB CRUD and aggregation pipelines | `lib/mongo.ts`, admin pages |

## Roles

Customers and admins see different menus and pages. Behind that, the app connects to MariaDB as a different user for each role:

| App user | MariaDB user | Role | Notes |
|---|---|---|---|
| Guest or customer | `inkpow_web` | `inkpow_customer` | Can shop and check out. Cannot write `customers.role` or change prices. |
| Admin | `inkpow_staff` | `inkpow_admin` | Can change any data. Cannot CREATE, ALTER or DROP. |
| SQL console | `inkpow_ro` | `inkpow_readonly` | SELECT only. Cannot read `password_hash`. |
