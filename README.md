# INKPOW! DBMS project

An online comic and collectibles store built around a 14-table SQLite database:
customers, addresses, categories, suppliers, products, product_images, reviews,
wishlist, cart, cart_items, orders, order_items, payments and shipments.

The website is a comic-styled Flask app, but the project is about the database.
All SQL is written by hand, with no ORM.

## Running it

    pip install flask
    python3 app.py

Then open http://127.0.0.1:5000. On first run, `store.db` is built from `schema.sql`
and `seed.sql`. Delete `store.db` to start over with fresh sample data.

Demo login: `asha@example.com` / `demo1234`. Every seeded customer uses that password.

## Files

| File | What it holds |
|---|---|
| `schema.sql` | The 14 tables, matching the hand-drawn schema diagram column for column |
| `seed.sql` | Sample data |
| `db.py` | Every database operation: connection, queries, the checkout transaction, reports, the read-only SQL console |
| `app.py` | The web pages. It calls `db.py` and has no SQL of its own |
| `er_diagram.py` | Draws the ER diagram shown on the Database tab |
| `templates/`, `static/` | Page templates and styling |
| `docs/viva-notes.pdf` | Viva notes: ER diagram, schema diagram, relationships, normalization, transactions, sample queries |

## Seeing the database at work

Each page has a "SQL behind this page" panel at the bottom that lists the statements
it just ran, including the writes from your last click.

The Database tab shows the ER diagram, how each relationship turned into a foreign key
or a table, every table with its keys and row counts, eight ready-made reports and a
read-only SQL console.

Checkout runs as a single transaction across orders, order_items, products, payments,
shipments and cart_items. If any step fails, the whole thing rolls back.
