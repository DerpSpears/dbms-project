"""db.py - every database part of INKPOW! lives in this one file.

The database is MariaDB (MySQL compatible). Sections:

  1. Connection   settings, one connection per request, building the database
  2. Helpers      query() for SELECT, execute() for INSERT / UPDATE / DELETE,
                  call() for stored procedures, commit(), rollback()
  3. Customers    sign up (a trigger creates the cart), log in
  4. Catalogue    products come from the view v_product_catalog
  5. Wishlist
  6. Cart         adding goes through the stored procedure sp_add_to_cart
  7. Orders       checkout is the stored procedure sp_place_order
  8. Explorer     schema info, the advanced objects, reports, read-only console

app.py holds the web pages only. It never writes SQL; it calls the functions here.
Every statement is logged so the page can show it in its "SQL behind this page" panel.

Command line:  python3 db.py reset    drop everything and rebuild from the .sql files
"""
import configparser
import os
import re
import sys

import pymysql
import pymysql.cursors
from flask import g
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "db_config.ini")
SQL_FILES = ["schema.sql", "seed.sql", "advanced.sql"]


class DatabaseError(ValueError):
    """A rule in the database said no (a SIGNAL from a trigger or procedure).
    The message is written for the customer, so pages can show it as it is."""


# ================================================================ 1. connection

def _settings():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("db_config.ini is missing. Run `sudo sh setup.sh` once to create the "
                 "MariaDB database and users.")
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    return cfg["database"]


def _open(readonly=False, autocommit=False):
    s = _settings()
    return pymysql.connect(
        host=s.get("host", "localhost"),
        database=s["name"],
        user=s["readonly_user"] if readonly else s["user"],
        password=s["readonly_password"] if readonly else s["password"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=autocommit,
    )


def connect():
    """One connection per web request, kept on flask.g."""
    if "db" not in g:
        g.db = _open()
        g.sql_log = []
    return g.db


def close(exc=None):
    con = g.pop("db", None)
    if con is not None:
        con.close()  # anything not committed is rolled back


def split_sql(text):
    """Split a .sql file into statements, honouring DELIMITER lines the way the
    mariadb command-line client does (procedures and triggers contain ';')."""
    delimiter, buf, out = ";", [], []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("DELIMITER "):
            delimiter = stripped.split(None, 1)[1]
            continue
        buf.append(line)
        code = re.sub(r"\s--\s.*$", "", stripped).rstrip()   # ignore a trailing "-- comment"
        if code.endswith(delimiter):
            buf[-1] = code[: -len(delimiter)]   # the last line without its delimiter
            stmt = "\n".join(buf).strip()
            buf = []
            if re.sub(r"--[^\n]*", "", stmt).strip():
                out.append(stmt)
    return out


def _run_files(con):
    with con.cursor() as cur:
        for name in SQL_FILES:
            with open(os.path.join(BASE, name)) as f:
                for stmt in split_sql(f.read()):
                    cur.execute(stmt)
        # every sample customer gets the password demo1234
        cur.execute("UPDATE customers SET password_hash = %s",
                    (generate_password_hash("demo1234"),))
    con.commit()


def init_db():
    """Build the database from the .sql files if the tables are not there yet."""
    con = _open(autocommit=True)
    try:
        with con.cursor() as cur:
            cur.execute("SHOW TABLES LIKE 'customers'")
            if cur.fetchone():
                return
        _run_files(con)
    finally:
        con.close()


def reset_db():
    """Drop every table, view, trigger and routine, then rebuild."""
    con = _open(autocommit=True)
    try:
        with con.cursor() as cur:
            cur.execute("SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()")
            for r in cur.fetchall():
                cur.execute(f"DROP VIEW IF EXISTS `{r['TABLE_NAME']}`")
            cur.execute("SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES "
                        "WHERE ROUTINE_SCHEMA = DATABASE()")
            for r in cur.fetchall():
                cur.execute(f"DROP {r['ROUTINE_TYPE']} IF EXISTS `{r['ROUTINE_NAME']}`")
            cur.execute("SET FOREIGN_KEY_CHECKS = 0")
            for t in TABLES:
                cur.execute(f"DROP TABLE IF EXISTS `{t}`")   # drops its triggers too
            cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        _run_files(con)
    finally:
        con.close()


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


def _signal_message(err):
    """Turn a SIGNAL from a trigger or procedure into a DatabaseError."""
    code = err.args[0] if err.args else None
    if code == 1644:   # ER_SIGNAL_EXCEPTION: raised by our own SIGNAL statements
        return DatabaseError(err.args[1])
    return None


def query(sql, args=(), one=False, hide=False):
    """Run a SELECT and return the rows (or just the first row)."""
    _log(sql, args, hide)
    with connect().cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=(), hide=False):
    """Run an INSERT / UPDATE / DELETE and return the new row id."""
    _log(sql, args, hide)
    try:
        with connect().cursor() as cur:
            cur.execute(sql, args)
            return cur.lastrowid
    except pymysql.MySQLError as e:
        rollback()
        raise _signal_message(e) or e


def call(procedure, args=(), out=False):
    """CALL a stored procedure. With out=True the last argument is an OUT
    parameter and its value is returned. Otherwise the procedure's result rows
    (if any) are returned."""
    placeholders = ", ".join(["%s"] * len(args) + (["@out"] if out else []))
    sql = f"CALL {procedure}({placeholders})"
    _log(sql, args)
    try:
        with connect().cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall() if cur.description else []
            while cur.nextset():
                pass
            if out:
                _log("SELECT @out")
                cur.execute("SELECT @out AS value")
                return cur.fetchone()["value"]
            return rows
    except pymysql.MySQLError as e:
        rollback()
        raise _signal_message(e) or e


def commit():
    _log("COMMIT")
    connect().commit()


def rollback():
    _log("ROLLBACK")
    connect().rollback()


# ================================================================ 3. customers

def get_customer(customer_id):
    return query("SELECT customer_id, first_name, last_name, email FROM customers "
                 "WHERE customer_id = %s", (customer_id,), one=True)


def create_customer(first_name, last_name, email, phone, password):
    """Insert a customer. Returns the new id, or None if the email is taken.
    trg_customers_before_insert lower-cases the email and rejects duplicates;
    trg_customers_after_insert creates the customer's cart."""
    try:
        customer_id = execute(
            "INSERT INTO customers (first_name, last_name, email, phone, password_hash) "
            "VALUES (%s, %s, %s, %s, %s)",
            (first_name, last_name, email, phone, generate_password_hash(password)), hide=True)
    except DatabaseError:
        return None
    commit()
    return customer_id


def check_login(email, password):
    """Return the customer row if the email and password match, else None."""
    row = query("SELECT customer_id, first_name, password_hash FROM customers WHERE email = %s",
                (email.strip().lower(),), one=True)
    if row and check_password_hash(row["password_hash"], password):
        return row
    return None


# ================================================================ 4. catalogue

# Product cards read from the view v_product_catalog (product, category name,
# first image and the average rating from fn_product_rating).
PRODUCT_SELECT = "SELECT p.* FROM v_product_catalog p"

SORTS = {
    "new": ("Newest", "p.created_at DESC"),
    "low": ("Price: low to high", "p.price ASC"),
    "high": ("Price: high to low", "p.price DESC"),
    "top": ("Top rated", "p.rating DESC"),
}


def list_categories():
    """Sub-categories with their parent's name (self join) and a product count."""
    return query("""
        SELECT c.category_id, c.name, parent.name AS parent, COUNT(p.product_id) AS pieces
          FROM categories c
          JOIN categories parent ON parent.category_id = c.parent_category_id
          LEFT JOIN products p ON p.category_id = c.category_id
         GROUP BY c.category_id, c.name, parent.name
         ORDER BY parent.name, c.name""")


def featured_product():
    return query(PRODUCT_SELECT + " ORDER BY p.rating DESC, p.price DESC LIMIT 1", one=True)


def latest_products(limit=8):
    return query(PRODUCT_SELECT + " ORDER BY p.created_at DESC LIMIT %s", (limit,))


def search_products(category_id=None, search="", sort="new"):
    where, args = [], []
    if category_id:  # a parent category also shows everything in its sub-categories
        where.append("p.category_id IN (SELECT category_id FROM categories "
                     "WHERE category_id = %s OR parent_category_id = %s)")
        args += [category_id, category_id]
    if search:
        where.append("(p.name LIKE %s OR p.description LIKE %s)")
        args += [f"%{search}%", f"%{search}%"]
    sql = PRODUCT_SELECT + (" WHERE " + " AND ".join(where) if where else "")
    return query(sql + f" ORDER BY {SORTS[sort][1]}", args)


def get_product(product_id):
    return query("""
        SELECT p.*, c.name AS category, s.name AS supplier, s.address AS supplier_city
          FROM products p
          JOIN categories c ON c.category_id = p.category_id
          JOIN suppliers s ON s.supplier_id = p.supplier_id
         WHERE p.product_id = %s""", (product_id,), one=True)


def product_images(product_id):
    return query("SELECT image_url FROM product_images WHERE product_id = %s ORDER BY image_id",
                 (product_id,))


def product_for_cover(product_id):
    """Just what the cover drawing needs. Not logged: it runs once per image, not per page."""
    with connect().cursor() as cur:
        cur.execute("SELECT p.name, p.sku, c.name AS category FROM products p "
                    "JOIN categories c ON c.category_id = p.category_id WHERE p.product_id = %s",
                    (product_id,))
        return cur.fetchone()


def product_reviews(product_id):
    return query("""
        SELECT r.rating, r.comment, r.review_date, cu.first_name, cu.customer_id
          FROM reviews r JOIN customers cu ON cu.customer_id = r.customer_id
         WHERE r.product_id = %s ORDER BY r.review_date DESC, r.review_id DESC""", (product_id,))


def review_summary(product_id=None):
    """Average rating and review count, for one product or for the whole store."""
    if product_id is None:
        return query("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews", one=True)
    return query("SELECT fn_product_rating(%s) AS avg, COUNT(*) AS n FROM reviews "
                 "WHERE product_id = %s", (product_id, product_id), one=True)


def latest_five_star_review():
    return query("""
        SELECT r.comment, r.rating, cu.first_name, p.name AS product, p.product_id
          FROM reviews r
          JOIN customers cu ON cu.customer_id = r.customer_id
          JOIN products p ON p.product_id = r.product_id
         WHERE r.rating = 5 ORDER BY r.review_date DESC LIMIT 1""", one=True)


def add_review(product_id, customer_id, rating, comment):
    """trg_reviews_before_insert rejects a rating outside 1 to 5."""
    execute("INSERT INTO reviews (product_id, customer_id, rating, comment) VALUES (%s, %s, %s, %s)",
            (product_id, customer_id, rating, comment))
    commit()


# ================================================================ 5. wishlist

def wishlist_products(customer_id):
    return query(PRODUCT_SELECT + """
        JOIN wishlist w ON w.product_id = p.product_id
        WHERE w.customer_id = %s ORDER BY w.added_at DESC""", (customer_id,))


def is_wished(customer_id, product_id):
    return query("SELECT 1 FROM wishlist WHERE customer_id = %s AND product_id = %s",
                 (customer_id, product_id), one=True) is not None


def toggle_wishlist(customer_id, product_id):
    """Add the product if it is not saved, remove it if it is. Returns True when added."""
    if is_wished(customer_id, product_id):
        execute("DELETE FROM wishlist WHERE customer_id = %s AND product_id = %s",
                (customer_id, product_id))
        added = False
    else:
        execute("INSERT INTO wishlist (customer_id, product_id) VALUES (%s, %s)",
                (customer_id, product_id))
        added = True
    commit()
    return added


# ================================================================ 6. cart

def cart_count(customer_id):
    return query("SELECT COALESCE(SUM(ci.quantity), 0) AS n FROM cart c "
                 "JOIN cart_items ci ON ci.cart_id = c.cart_id WHERE c.customer_id = %s",
                 (customer_id,), one=True)["n"]


def cart_rows(customer_id):
    return query("""
        SELECT ci.cart_item_id, ci.quantity, p.product_id, p.name, p.price, p.stock_quantity,
               p.price * ci.quantity AS line_total, p.image_url
          FROM cart c
          JOIN cart_items ci ON ci.cart_id = c.cart_id
          JOIN v_product_catalog p ON p.product_id = ci.product_id
         WHERE c.customer_id = %s
         ORDER BY ci.added_at, ci.cart_item_id""", (customer_id,))


def product_stock(product_id):
    return query("SELECT name, stock_quantity FROM products WHERE product_id = %s",
                 (product_id,), one=True)


def add_to_cart(customer_id, product_id, quantity):
    """sp_add_to_cart finds or makes the cart, refuses sold-out products and
    bumps the quantity if the product is already in the cart."""
    call("sp_add_to_cart", (customer_id, product_id, quantity))
    commit()


def set_cart_quantity(customer_id, cart_item_id, quantity):
    """Change a cart line, or delete it when the quantity is 0. Only touches the customer's own cart."""
    mine = "cart_id = (SELECT cart_id FROM cart WHERE customer_id = %s LIMIT 1)"
    if quantity < 1:
        execute(f"DELETE FROM cart_items WHERE cart_item_id = %s AND {mine}",
                (cart_item_id, customer_id))
    else:
        execute(f"UPDATE cart_items SET quantity = %s WHERE cart_item_id = %s AND {mine}",
                (quantity, cart_item_id, customer_id))
    commit()


# ================================================================ 7. orders

PAYMENT_METHODS = ["UPI", "Card", "Net Banking", "Cash on Delivery"]


def customer_addresses(customer_id):
    return query("SELECT * FROM addresses WHERE customer_id = %s "
                 "ORDER BY is_default DESC, address_id", (customer_id,))


def place_order(customer_id, payment_method, address_id=None, new_address=None):
    """Checkout. All the work is in the stored procedure sp_place_order, which runs
    as one transaction and rolls back on any error. Returns the new order id.
    Raises DatabaseError (a ValueError) with a message for the customer."""
    a = new_address or {}
    return call("sp_place_order",
                (customer_id, None if new_address else address_id,
                 a.get("address_line"), a.get("city"), a.get("state"),
                 a.get("postal_code"), a.get("country"), payment_method),
                out=True)


def list_orders(customer_id):
    return query("SELECT order_id, order_date, status, total_amount, line_count, pieces "
                 "FROM v_order_summary WHERE customer_id = %s ORDER BY order_id DESC",
                 (customer_id,))


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
         WHERE o.order_id = %s AND o.customer_id = %s""", (order_id, customer_id), one=True)


def order_items(order_id):
    return query("""
        SELECT oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total,
               p.product_id, p.name
          FROM order_items oi JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id = %s""", (order_id,))


def advance_order(order_id, current_status=None):
    """Demo: move an order one step forward. sp_advance_order updates the shipment,
    and trg_shipments_after_update moves the order and payment along with it."""
    call("sp_advance_order", (order_id,))
    commit()


# ================================================================ 8. explorer (Database tab)

TABLES = ["customers", "addresses", "categories", "suppliers", "products", "product_images",
          "reviews", "wishlist", "cart", "cart_items", "orders", "order_items", "payments",
          "shipments"]

# (title, what it demonstrates, SQL)
REPORTS = [
    ("Best sellers", "JOIN + GROUP BY + ORDER BY", """SELECT p.name, SUM(oi.quantity) AS units_sold,
       SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN products p ON p.product_id = oi.product_id
 GROUP BY p.product_id, p.name
 ORDER BY units_sold DESC, revenue DESC"""),
    ("Price rank in each category", "window function: RANK() OVER (PARTITION BY)", """SELECT c.name AS category, p.name, p.price,
       RANK() OVER (PARTITION BY p.category_id ORDER BY p.price DESC) AS price_rank,
       ROUND(AVG(p.price) OVER (PARTITION BY p.category_id), 2) AS category_avg
  FROM products p
  JOIN categories c ON c.category_id = p.category_id
 ORDER BY c.name, price_rank"""),
    ("Running sales total", "window function: SUM() OVER (ORDER BY)", """SELECT order_id, order_date, total_amount,
       SUM(total_amount) OVER (ORDER BY order_date, order_id) AS running_total
  FROM orders
 ORDER BY order_date, order_id"""),
    ("Revenue by category", "3-table JOIN + COUNT(DISTINCT)", """SELECT c.name AS category, COUNT(DISTINCT oi.order_id) AS orders,
       SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN products p ON p.product_id = oi.product_id
  JOIN categories c ON c.category_id = p.category_id
 GROUP BY c.category_id, c.name
 ORDER BY revenue DESC"""),
    ("Well-reviewed products", "LEFT JOIN + GROUP BY + HAVING", """SELECT p.name, COUNT(r.review_id) AS reviews,
       ROUND(AVG(r.rating), 2) AS avg_rating
  FROM products p
  LEFT JOIN reviews r ON r.product_id = p.product_id
 GROUP BY p.product_id, p.name
HAVING COUNT(r.review_id) > 0
 ORDER BY avg_rating DESC"""),
    ("Customer spend", "view: v_customer_spend", """SELECT customer, orders, total_spent
  FROM v_customer_spend
 ORDER BY total_spent DESC"""),
    ("Loyalty tiers", "stored procedure with a cursor", """CALL sp_customer_tiers()"""),
    ("Low stock alert", "view: v_low_stock", """SELECT name, sku, stock_quantity, supplier, contact_email
  FROM v_low_stock
 ORDER BY stock_quantity"""),
    ("Order totals check", "stored function: fn_order_total", """SELECT order_id, total_amount AS stored_total,
       fn_order_total(order_id) AS from_lines,
       total_amount = fn_order_total(order_id) AS matches
  FROM orders"""),
    ("Category tree", "recursive CTE on the self reference", """WITH RECURSIVE tree (category_id, path, depth) AS (
    SELECT category_id, CAST(name AS CHAR(300)), 0
      FROM categories WHERE parent_category_id IS NULL
    UNION ALL
    SELECT c.category_id, CONCAT(tree.path, ' > ', c.name), tree.depth + 1
      FROM categories c JOIN tree ON c.parent_category_id = tree.category_id
)
SELECT category_id, path, depth FROM tree ORDER BY path"""),
    ("Never ordered", "NOT EXISTS correlated subquery", """SELECT p.name, p.price
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.product_id)
 ORDER BY p.name"""),
    ("Pricier than average", "scalar subquery", """SELECT name, price
  FROM products
 WHERE price > (SELECT AVG(price) FROM products)
 ORDER BY price DESC"""),
    ("Everyone we email", "UNION", """SELECT 'customer' AS who, email FROM customers
UNION
SELECT 'supplier', contact_email FROM suppliers
ORDER BY who, email"""),
    ("Order tracker", "view: v_order_summary + JOIN", """SELECT v.order_id, cu.first_name AS customer, v.status,
       v.payment_method, v.payment_status, v.carrier, v.tracking_number
  FROM v_order_summary v
  JOIN customers cu ON cu.customer_id = v.customer_id
 ORDER BY v.order_id DESC"""),
]


def browse_sql(table):
    """SQL to show a table's rows in the console. The read-only user may not read
    customers.password_hash, so that table lists its other columns by name."""
    if table == "customers":
        return "SELECT customer_id, first_name, last_name, email, phone, created_at FROM customers"
    return f"SELECT * FROM {table}"


def describe_schema():
    """Every table with its columns, key markers and row count, read from information_schema."""
    cols = query("""
        SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS name, c.COLUMN_TYPE AS type,
               c.COLUMN_KEY = 'PRI' AS pk,
               CONCAT(k.REFERENCED_TABLE_NAME, '.', k.REFERENCED_COLUMN_NAME) AS fk
          FROM information_schema.COLUMNS c
          LEFT JOIN information_schema.KEY_COLUMN_USAGE k
                 ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
                AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL
         WHERE c.TABLE_SCHEMA = DATABASE()
         ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION""")
    schema = []
    for t in TABLES:
        rows = query(f"SELECT COUNT(*) AS n FROM `{t}`", one=True)["n"]
        schema.append(dict(name=t, rows=rows, cols=[c for c in cols if c["t"] == t]))
    return schema


KIND_TITLES = {"VIEW": "Views", "FUNCTION": "Stored functions", "PROCEDURE": "Stored procedures",
               "TRIGGER": "Triggers", "INDEX": "Indexes"}


def advanced_objects():
    """The objects defined in advanced.sql, each with its source and comment,
    and whether the live database really has it (checked in information_schema)."""
    live = set()
    for r in query("SELECT 'VIEW' AS k, TABLE_NAME AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() "
                   "UNION ALL SELECT ROUTINE_TYPE, ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() "
                   "UNION ALL SELECT 'TRIGGER', TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() "
                   "UNION ALL SELECT DISTINCT 'INDEX', INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()"):
        live.add((r["k"], r["n"]))
    with open(os.path.join(BASE, "advanced.sql")) as f:
        statements = split_sql(f.read())
    groups = {k: [] for k in KIND_TITLES}
    pattern = re.compile(r"CREATE\s+(VIEW|FUNCTION|PROCEDURE|TRIGGER|INDEX)\s+(\w+)", re.I)
    for stmt in statements:
        lines = stmt.splitlines()
        comment = [ln.strip()[2:].strip() for ln in lines if ln.strip().startswith("--")]
        body = "\n".join(ln for ln in lines if not ln.strip().startswith("--")).strip()
        m = pattern.search(body)
        if not m:
            continue
        kind, name = m.group(1).upper(), m.group(2)
        comment = [c for c in comment if c and not set(c) <= set("=")]
        groups[kind].append(dict(name=name, sql=body, about=" ".join(comment[-3:]),
                                 live=(kind, name) in live))
    return [(KIND_TITLES[k], v) for k, v in groups.items() if v]


def restock_low_stock(threshold=5, amount=10):
    """Run the cursor-based sp_restock_low_stock and return its report rows."""
    rows = call("sp_restock_low_stock", (threshold, amount))
    commit()
    return rows


def run_console(sql, limit=200):
    """Run whatever was typed into the SQL console, as the read-only user inkpow_ro.
    That user can SELECT and call sp_customer_tiers, nothing else, and cannot see
    customers.password_hash. Returns (columns, rows, error)."""
    con = _open(readonly=True, autocommit=True)
    try:
        with con.cursor() as cur:
            cur.execute("SET SESSION max_statement_time = 5")
            cur.execute(sql)
            columns = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchmany(limit) if columns else []
            return columns, [[r[c] for c in columns] for r in rows], None
    except pymysql.MySQLError as e:
        return [], [], str(e.args[1] if len(e.args) > 1 else e)
    finally:
        con.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["reset"]:
        reset_db()
        print("Database rebuilt from", ", ".join(SQL_FILES))
    else:
        print(__doc__)
