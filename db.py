"""db.py - every database part of INKPOW! lives in this one file.

  1. Connection   open store.db, build it from schema.sql + seed.sql on first run
  2. Helpers      query() for SELECT, execute() for INSERT / UPDATE / DELETE, commit()
  3. Customers    sign up, log in
  4. Catalogue    categories, products, images, reviews
  5. Wishlist
  6. Cart
  7. Orders       checkout as one transaction, order history, order status
  8. Explorer     schema info, ready-made reports and the read-only SQL console

app.py holds the web pages only. It never writes SQL; it calls the functions here.
All SQL is plain text (no ORM), and every statement is logged so pages can show it.
"""
import os
import secrets
import sqlite3

from flask import g
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "store.db")

IntegrityError = sqlite3.IntegrityError


# ================================================================ 1. connection

def init_db():
    """Create store.db from schema.sql + seed.sql the first time the app runs."""
    if os.path.exists(DB_PATH):
        return
    con = sqlite3.connect(DB_PATH)
    try:
        for name in ("schema.sql", "seed.sql"):
            with open(os.path.join(BASE, name)) as f:
                con.executescript(f.read())
        con.execute("UPDATE customers SET password_hash = ?",
                    (generate_password_hash("demo1234"),))
        con.commit()
    except Exception:
        con.close()
        os.remove(DB_PATH)
        raise
    con.close()


def connect():
    """One connection per web request, kept on flask.g."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row          # rows behave like dicts: row["name"]
        g.db.execute("PRAGMA foreign_keys = ON")  # SQLite checks FKs only when asked
        g.sql_log = []
    return g.db


def close(exc=None):
    con = g.pop("db", None)
    if con is not None:
        con.close()  # anything not committed is rolled back


# ================================================================ 2. helpers

def _log(sql, args=(), hide=False):
    connect()
    text = " ".join(sql.split())
    if args:
        text += "   -- " + ("(hidden)" if hide else repr(tuple(args)))
    g.sql_log.append(text)


def sql_log():
    """The statements run so far in this request."""
    return g.get("sql_log", [])


def query(sql, args=(), one=False, hide=False):
    """Run a SELECT and return the rows (or just the first row)."""
    _log(sql, args, hide)
    rows = connect().execute(sql, args).fetchall()
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=(), hide=False):
    """Run an INSERT / UPDATE / DELETE and return the new row id."""
    _log(sql, args, hide)
    return connect().execute(sql, args).lastrowid


def commit():
    _log("COMMIT")
    connect().commit()


def rollback():
    _log("ROLLBACK")
    connect().rollback()


# ================================================================ 3. customers

def get_customer(customer_id):
    return query("SELECT customer_id, first_name, last_name, email FROM customers "
                 "WHERE customer_id = ?", (customer_id,), one=True)


def create_customer(first_name, last_name, email, phone, password):
    """Insert a customer and their empty cart. Returns the new id, or None if the email is taken."""
    if query("SELECT 1 FROM customers WHERE email = ?", (email,), one=True):
        return None
    customer_id = execute(
        "INSERT INTO customers (first_name, last_name, email, phone, password_hash) "
        "VALUES (?, ?, ?, ?, ?)",
        (first_name, last_name, email, phone, generate_password_hash(password)), hide=True)
    execute("INSERT INTO cart (customer_id) VALUES (?)", (customer_id,))
    commit()
    return customer_id


def check_login(email, password):
    """Return the customer row if the email and password match, else None."""
    row = query("SELECT customer_id, first_name, password_hash FROM customers WHERE email = ?",
                (email,), one=True)
    if row and check_password_hash(row["password_hash"], password):
        return row
    return None


# ================================================================ 4. catalogue

# Shared SELECT for product cards: product + category name + first image + average rating.
PRODUCT_SELECT = """
    SELECT p.*, c.name AS category,
           (SELECT image_url FROM product_images i
             WHERE i.product_id = p.product_id ORDER BY i.image_id LIMIT 1) AS image_url,
           (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
             WHERE r.product_id = p.product_id) AS rating,
           p.created_at >= datetime('now', '-30 day') AS is_new
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
"""

SORTS = {
    "new": ("Newest", "p.created_at DESC"),
    "low": ("Price: low to high", "p.price ASC"),
    "high": ("Price: high to low", "p.price DESC"),
    "top": ("Top rated", "rating DESC"),
}


def list_categories():
    """Sub-categories with their parent's name (self join) and a product count."""
    return query("""
        SELECT c.category_id, c.name, parent.name AS parent, COUNT(p.product_id) AS pieces
          FROM categories c
          JOIN categories parent ON parent.category_id = c.parent_category_id
          LEFT JOIN products p ON p.category_id = c.category_id
         GROUP BY c.category_id
         ORDER BY parent.name, c.name""")


def featured_product():
    return query(PRODUCT_SELECT + " ORDER BY rating DESC, p.price DESC LIMIT 1", one=True)


def latest_products(limit=8):
    return query(PRODUCT_SELECT + " ORDER BY p.created_at DESC LIMIT ?", (limit,))


def search_products(category_id=None, search="", sort="new"):
    where, args = [], []
    if category_id:  # a parent category also shows everything in its sub-categories
        where.append("p.category_id IN (SELECT category_id FROM categories "
                     "WHERE category_id = ? OR parent_category_id = ?)")
        args += [category_id, category_id]
    if search:
        where.append("(p.name LIKE ? OR p.description LIKE ?)")
        args += [f"%{search}%", f"%{search}%"]
    sql = PRODUCT_SELECT + (" WHERE " + " AND ".join(where) if where else "")
    return query(sql + f" ORDER BY {SORTS[sort][1]}", args)


def get_product(product_id):
    return query("""
        SELECT p.*, c.name AS category, s.name AS supplier, s.address AS supplier_city
          FROM products p
          JOIN categories c ON c.category_id = p.category_id
          JOIN suppliers s ON s.supplier_id = p.supplier_id
         WHERE p.product_id = ?""", (product_id,), one=True)


def product_images(product_id):
    return query("SELECT image_url FROM product_images WHERE product_id = ? ORDER BY image_id",
                 (product_id,))


def product_for_cover(product_id):
    """Just what the cover drawing needs. Not logged: it runs once per image, not per page."""
    return connect().execute(
        "SELECT p.name, p.sku, c.name AS category FROM products p "
        "JOIN categories c ON c.category_id = p.category_id WHERE p.product_id = ?",
        (product_id,)).fetchone()


def product_reviews(product_id):
    return query("""
        SELECT r.rating, r.comment, r.review_date, cu.first_name, cu.customer_id
          FROM reviews r JOIN customers cu ON cu.customer_id = r.customer_id
         WHERE r.product_id = ? ORDER BY r.review_date DESC, r.review_id DESC""", (product_id,))


def review_summary(product_id=None):
    """Average rating and review count, for one product or for the whole store."""
    if product_id is None:
        return query("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews", one=True)
    return query("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews "
                 "WHERE product_id = ?", (product_id,), one=True)


def latest_five_star_review():
    return query("""
        SELECT r.comment, r.rating, cu.first_name, p.name AS product, p.product_id
          FROM reviews r
          JOIN customers cu ON cu.customer_id = r.customer_id
          JOIN products p ON p.product_id = r.product_id
         WHERE r.rating = 5 ORDER BY r.review_date DESC LIMIT 1""", one=True)


def add_review(product_id, customer_id, rating, comment):
    execute("INSERT INTO reviews (product_id, customer_id, rating, comment) VALUES (?, ?, ?, ?)",
            (product_id, customer_id, rating, comment))
    commit()


# ================================================================ 5. wishlist

def wishlist_products(customer_id):
    return query(PRODUCT_SELECT + """
        JOIN wishlist w ON w.product_id = p.product_id
        WHERE w.customer_id = ? ORDER BY w.added_at DESC""", (customer_id,))


def is_wished(customer_id, product_id):
    return query("SELECT 1 FROM wishlist WHERE customer_id = ? AND product_id = ?",
                 (customer_id, product_id), one=True) is not None


def toggle_wishlist(customer_id, product_id):
    """Add the product if it is not saved, remove it if it is. Returns True when added."""
    if is_wished(customer_id, product_id):
        execute("DELETE FROM wishlist WHERE customer_id = ? AND product_id = ?",
                (customer_id, product_id))
        added = False
    else:
        execute("INSERT INTO wishlist (customer_id, product_id) VALUES (?, ?)",
                (customer_id, product_id))
        added = True
    commit()
    return added


# ================================================================ 6. cart

def cart_id_for(customer_id):
    """Each customer owns one cart; make it if it is missing."""
    row = query("SELECT cart_id FROM cart WHERE customer_id = ?", (customer_id,), one=True)
    return row["cart_id"] if row else execute("INSERT INTO cart (customer_id) VALUES (?)",
                                              (customer_id,))


def cart_count(customer_id):
    return query("SELECT COALESCE(SUM(ci.quantity), 0) AS n FROM cart c "
                 "JOIN cart_items ci ON ci.cart_id = c.cart_id WHERE c.customer_id = ?",
                 (customer_id,), one=True)["n"]


def cart_rows(customer_id):
    return query("""
        SELECT ci.cart_item_id, ci.quantity, p.product_id, p.name, p.price, p.stock_quantity,
               p.price * ci.quantity AS line_total,
               (SELECT image_url FROM product_images i
                 WHERE i.product_id = p.product_id ORDER BY i.image_id LIMIT 1) AS image_url
          FROM cart c
          JOIN cart_items ci ON ci.cart_id = c.cart_id
          JOIN products p ON p.product_id = ci.product_id
         WHERE c.customer_id = ?
         ORDER BY ci.added_at, ci.cart_item_id""", (customer_id,))


def product_stock(product_id):
    return query("SELECT name, stock_quantity FROM products WHERE product_id = ?",
                 (product_id,), one=True)


def add_to_cart(customer_id, product_id, quantity):
    """Adding a product that is already in the cart bumps its quantity."""
    cart = cart_id_for(customer_id)
    row = query("SELECT cart_item_id FROM cart_items WHERE cart_id = ? AND product_id = ?",
                (cart, product_id), one=True)
    if row:
        execute("UPDATE cart_items SET quantity = quantity + ? WHERE cart_item_id = ?",
                (quantity, row["cart_item_id"]))
    else:
        execute("INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)",
                (cart, product_id, quantity))
    commit()


def set_cart_quantity(customer_id, cart_item_id, quantity):
    """Change a cart line, or delete it when the quantity is 0. Only touches the customer's own cart."""
    mine = "cart_id = (SELECT cart_id FROM cart WHERE customer_id = ?)"
    if quantity < 1:
        execute(f"DELETE FROM cart_items WHERE cart_item_id = ? AND {mine}",
                (cart_item_id, customer_id))
    else:
        execute(f"UPDATE cart_items SET quantity = ? WHERE cart_item_id = ? AND {mine}",
                (quantity, cart_item_id, customer_id))
    commit()


# ================================================================ 7. orders

PAYMENT_METHODS = ["UPI", "Card", "Net Banking", "Cash on Delivery"]
CARRIERS = ["BlueDart", "Delhivery", "India Post"]


def customer_addresses(customer_id):
    return query("SELECT * FROM addresses WHERE customer_id = ? "
                 "ORDER BY is_default DESC, address_id", (customer_id,))


def place_order(customer_id, payment_method, address_id=None, new_address=None):
    """Checkout as ONE transaction: every step below happens, or none of them do.

    Pass address_id to ship to a saved address, or new_address (a dict) to add one.
    Returns the new order id. Raises ValueError with a message if it cannot go ahead.
    """
    items = cart_rows(customer_id)
    if not items:
        raise ValueError("Your cart is empty.")
    short = [i["name"] for i in items if i["quantity"] > i["stock_quantity"]]
    if short:
        raise ValueError("Not enough stock for: " + ", ".join(short))
    total = sum(i["line_total"] for i in items)

    try:
        if new_address is not None:
            first = not customer_addresses(customer_id)
            address_id = execute(
                "INSERT INTO addresses (customer_id, address_line, city, state, postal_code, "
                "country, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (customer_id, new_address["address_line"], new_address["city"],
                 new_address["state"], new_address["postal_code"], new_address["country"],
                 1 if first else 0))
        elif not query("SELECT 1 FROM addresses WHERE address_id = ? AND customer_id = ?",
                       (address_id, customer_id), one=True):
            raise ValueError("Choose one of your own addresses.")

        cart = cart_id_for(customer_id)
        # 1. the order itself
        order_id = execute(
            "INSERT INTO orders (customer_id, shipping_address_id, status, total_amount) "
            "VALUES (?, ?, 'Processing', ?)", (customer_id, address_id, total))
        # 2. copy the cart lines, freezing today's price as unit_price
        execute("""
            INSERT INTO order_items (order_id, product_id, quantity, unit_price)
            SELECT ?, ci.product_id, ci.quantity, p.price
              FROM cart_items ci JOIN products p ON p.product_id = ci.product_id
             WHERE ci.cart_id = ?""", (order_id, cart))
        # 3. take the bought quantity out of stock
        execute("""
            UPDATE products
               SET stock_quantity = stock_quantity -
                   (SELECT quantity FROM cart_items
                     WHERE cart_id = ? AND product_id = products.product_id)
             WHERE product_id IN (SELECT product_id FROM cart_items WHERE cart_id = ?)""",
                (cart, cart))
        # 4. payment and 5. shipment
        execute("INSERT INTO payments (order_id, payment_method, amount, payment_status) "
                "VALUES (?, ?, ?, ?)",
                (order_id, payment_method, total,
                 "Pending" if payment_method == "Cash on Delivery" else "Paid"))
        execute("INSERT INTO shipments (order_id, carrier, tracking_number, status) "
                "VALUES (?, ?, ?, 'Preparing')",
                (order_id, secrets.choice(CARRIERS), f"INK{secrets.randbelow(10**8):08d}"))
        # 6. empty the cart
        execute("DELETE FROM cart_items WHERE cart_id = ?", (cart,))
        commit()
    except (sqlite3.IntegrityError, ValueError) as e:
        rollback()  # undo every step so no half-made order is left behind
        if isinstance(e, ValueError):
            raise
        raise ValueError("Checkout failed and was rolled back. Check stock and try again.")
    return order_id


def list_orders(customer_id):
    return query("""
        SELECT o.order_id, o.order_date, o.status, o.total_amount,
               COUNT(oi.order_item_id) AS lines, SUM(oi.quantity) AS pieces
          FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
         WHERE o.customer_id = ?
         GROUP BY o.order_id
         ORDER BY o.order_id DESC""", (customer_id,))


def get_order(order_id, customer_id):
    """One order with its address, payment and shipment (only if it belongs to the customer)."""
    return query("""
        SELECT o.*, a.address_line, a.city, a.state, a.postal_code, a.country,
               pay.payment_method, pay.payment_status, pay.transaction_date,
               s.carrier, s.tracking_number, s.shipped_date, s.delivered_date,
               s.status AS shipment_status
          FROM orders o
          JOIN addresses a ON a.address_id = o.shipping_address_id
          LEFT JOIN payments pay ON pay.order_id = o.order_id
          LEFT JOIN shipments s ON s.order_id = o.order_id
         WHERE o.order_id = ? AND o.customer_id = ?""", (order_id, customer_id), one=True)


def order_items(order_id):
    return query("""
        SELECT oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total,
               p.product_id, p.name
          FROM order_items oi JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id = ?""", (order_id,))


def advance_order(order_id, current_status):
    """Demo: move an order one step forward (Processing -> Shipped -> Delivered)."""
    if current_status == "Processing":
        execute("UPDATE orders SET status = 'Shipped' WHERE order_id = ?", (order_id,))
        execute("UPDATE shipments SET status = 'In transit', shipped_date = CURRENT_DATE "
                "WHERE order_id = ?", (order_id,))
    elif current_status == "Shipped":
        execute("UPDATE orders SET status = 'Delivered' WHERE order_id = ?", (order_id,))
        execute("UPDATE shipments SET status = 'Delivered', delivered_date = CURRENT_DATE "
                "WHERE order_id = ?", (order_id,))
        execute("UPDATE payments SET payment_status = 'Paid' WHERE order_id = ?", (order_id,))
    commit()


# ================================================================ 8. explorer (Database tab)

TABLES = ["customers", "addresses", "categories", "suppliers", "products", "product_images",
          "reviews", "wishlist", "cart", "cart_items", "orders", "order_items", "payments",
          "shipments"]

# (title, what it demonstrates, SQL)
REPORTS = [
    ("Best sellers", "JOIN + GROUP BY + SUM", """SELECT p.name, SUM(oi.quantity) AS units_sold,
       SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN products p ON p.product_id = oi.product_id
 GROUP BY p.product_id
 ORDER BY units_sold DESC, revenue DESC"""),
    ("Revenue by category", "3-table JOIN", """SELECT c.name AS category, COUNT(DISTINCT oi.order_id) AS orders,
       SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
 GROUP BY c.category_id
 ORDER BY revenue DESC"""),
    ("Average rating per product", "LEFT JOIN + HAVING", """SELECT p.name, COUNT(r.review_id) AS reviews,
       ROUND(AVG(r.rating), 2) AS avg_rating
  FROM products p
  LEFT JOIN reviews r ON r.product_id = p.product_id
 GROUP BY p.product_id
HAVING COUNT(r.review_id) > 0
 ORDER BY avg_rating DESC"""),
    ("Customer spend", "LEFT JOIN + COALESCE", """SELECT cu.first_name || ' ' || cu.last_name AS customer,
       COUNT(o.order_id) AS orders,
       COALESCE(SUM(o.total_amount), 0) AS total_spent
  FROM customers cu
  LEFT JOIN orders o ON o.customer_id = cu.customer_id
 GROUP BY cu.customer_id
 ORDER BY total_spent DESC"""),
    ("Low stock alert", "WHERE + ORDER BY", """SELECT p.name, p.sku, p.stock_quantity, s.name AS supplier, s.contact_email
  FROM products p
  JOIN suppliers s ON s.supplier_id = p.supplier_id
 WHERE p.stock_quantity <= 5
 ORDER BY p.stock_quantity"""),
    ("Category tree", "recursive CTE on the self reference", """WITH RECURSIVE tree(category_id, path, depth) AS (
    SELECT category_id, name, 0 FROM categories WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.category_id, tree.path || ' > ' || c.name, tree.depth + 1
      FROM categories c JOIN tree ON c.parent_category_id = tree.category_id
)
SELECT category_id, path, depth FROM tree ORDER BY path"""),
    ("Never ordered", "NOT EXISTS subquery", """SELECT p.name, p.price
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.product_id)
 ORDER BY p.name"""),
    ("Order tracker", "5-table JOIN", """SELECT o.order_id, cu.first_name AS customer, a.city, o.status,
       pay.payment_method, pay.payment_status, s.carrier, s.tracking_number
  FROM orders o
  JOIN customers cu ON cu.customer_id = o.customer_id
  JOIN addresses a ON a.address_id = o.shipping_address_id
  JOIN payments pay ON pay.order_id = o.order_id
  JOIN shipments s ON s.order_id = o.order_id
 ORDER BY o.order_id DESC"""),
]


def _readonly():
    """A second connection that cannot write, cannot read password hashes,
    and gives up on runaway queries. Used only by the Database tab."""
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    def guard(action, arg1, arg2, dbname, source):
        if action == sqlite3.SQLITE_READ and arg1 == "customers" and arg2 == "password_hash":
            return sqlite3.SQLITE_IGNORE  # the column reads as NULL
        return sqlite3.SQLITE_OK

    con.set_authorizer(guard)
    con.set_progress_handler(lambda: 1, 20_000_000)
    return con


def describe_schema():
    """Every table with its columns, key markers and row count, read from SQLite itself."""
    con = _readonly()
    try:
        schema = []
        for t in TABLES:
            fks = {r["from"]: f'{r["table"]}.{r["to"]}'
                   for r in con.execute(f"PRAGMA foreign_key_list({t})")}
            cols = [dict(name=c["name"], type=c["type"], pk=c["pk"], fk=fks.get(c["name"]))
                    for c in con.execute(f"PRAGMA table_info({t})")]
            rows = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            schema.append(dict(name=t, cols=cols, rows=rows))
        return schema
    finally:
        con.close()


def run_console(sql, limit=200):
    """Run whatever was typed into the SQL console. Returns (columns, rows, error)."""
    con = _readonly()
    try:
        cur = con.execute(sql)
        columns = [d[0] for d in cur.description] if cur.description else []
        return columns, cur.fetchmany(limit), None
    except (sqlite3.Error, sqlite3.Warning) as e:
        return [], [], str(e)
    finally:
        con.close()
