# INKPOW! DBMS project

An online comic and collectibles store built around a 14-table MariaDB database:
customers, addresses, categories, suppliers, products, product_images, reviews,
wishlist, cart, cart_items, orders, order_items, payments and shipments.

The website is a comic-styled Flask app, but the project is about the database.
All SQL is written by hand, with no ORM, and the important work happens inside
MariaDB itself through views, stored procedures, functions and triggers.

## Running it

You need MariaDB (or MySQL) running locally, plus Python with Flask and PyMySQL.

    pip install flask pymysql
    sudo sh setup.sh      # once: creates the database and its two users
    python3 app.py

Then open http://127.0.0.1:5000. On first run the app loads `schema.sql`,
`seed.sql` and `advanced.sql` into the `inkpow` database.
`python3 db.py reset` rebuilds everything with fresh sample data.

Demo login: `asha@example.com` / `demo1234`. Every seeded customer uses that password.

## Advanced database features

All of these are in `advanced.sql`, and the store uses them.

| Feature | Objects |
|---|---|
| Views | `v_product_catalog`, `v_order_summary`, `v_customer_spend`, `v_low_stock` |
| Stored functions | `fn_product_rating`, `fn_cart_total`, `fn_order_total` |
| Stored procedures | `sp_add_to_cart`, `sp_place_order`, `sp_advance_order`, `sp_customer_tiers`, `sp_restock_low_stock` |
| Cursors | inside `sp_place_order`, `sp_customer_tiers` and `sp_restock_low_stock` |
| Triggers | 8, on customers, reviews, cart_items, order_items and shipments |
| Error handling | `SIGNAL`, `RESIGNAL`, `DECLARE ... HANDLER` |
| Transactions | checkout is one transaction inside `sp_place_order`, with row locking |
| Indexes | 5, including a composite one |
| Users and privileges | a read-only user with column-level `SELECT` for the SQL console |
| Window functions, recursive CTE, subqueries, UNION | in the reports on the Database tab |

## Files

| File | What it holds |
|---|---|
| `schema.sql` | The 14 tables, matching the hand-drawn schema diagram column for column |
| `seed.sql` | Sample data |
| `advanced.sql` | Views, functions, procedures, cursors, triggers, indexes and grants |
| `setup.sh` | One-time MariaDB setup; writes `db_config.ini`, which git ignores |
| `db.py` | Every database call from Python, the reports and the read-only console |
| `app.py` | The web pages. It calls `db.py` and has no SQL of its own |
| `er_diagram.py` | Draws the ER diagram shown on the Database tab |
| `templates/`, `static/` | Page templates and styling |
| `docs/viva-notes.pdf` | Viva notes: diagrams, relationships, normalization, every advanced feature with real output |

## Seeing the database at work

Each page has a "SQL behind this page" panel at the bottom that lists the statements
it just ran, including the procedure calls from your last click.

The Database tab shows the ER diagram, every table with its keys and row counts,
every view, function, procedure, trigger and index with its source, fourteen
ready-made reports and a SQL console that runs as the read-only user.
