"""INKPOW! - a small comic store built to show a 14-table e-commerce database.

This file is the web pages only: it reads the form or URL, calls a function in
db.py, and renders a template. All SQL and every other database part is in db.py.

Run:  python3 app.py     then open http://127.0.0.1:5000
"""
import math
import os
import secrets
from functools import wraps
from html import escape

from flask import (Flask, Response, abort, flash, g, redirect, render_template,
                   request, session, url_for)
from markupsafe import Markup

import db
from er_diagram import er_svg, mapping_rows

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".secret_key")

app = Flask(__name__)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.teardown_appcontext(db.close)

if not os.path.exists(KEY_PATH):
    with open(KEY_PATH, "w") as f:
        f.write(secrets.token_hex(32))
app.secret_key = open(KEY_PATH).read().strip()

LAST_WRITES = {}  # session id -> SQL run by that visitor's last form submit


# ---------------------------------------------------------------- session helpers

@app.before_request
def ensure_sid():
    if "sid" not in session:
        session["sid"] = secrets.token_hex(8)


@app.after_request
def remember_writes(resp):
    if request.method == "POST" and db.sql_log():
        LAST_WRITES[session["sid"]] = db.sql_log()
    return resp


def current_user():
    if "user" not in g:
        cid = session.get("customer_id")
        g.user = db.get_customer(cid) if cid else None
    return g.user


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            flash("Log in first, hero!")
            nxt = request.path if request.method == "GET" else url_for("home")
            return redirect(url_for("login", next=nxt))
        return view(*args, **kwargs)
    return wrapped


@app.context_processor
def inject():
    user = current_user()
    return dict(user=user, cart_count=db.cart_count(user["customer_id"]) if user else 0,
                last_action=LAST_WRITES.pop(session.get("sid"), None))


@app.template_filter("money")
def money(value):
    return f"₹{float(value or 0):,.2f}".replace(".00", "")


def safe_next(target):
    return target if target and target.startswith("/") and not target.startswith("//") else None


# ---------------------------------------------------------------- catalogue

@app.route("/")
def home():
    return render_template("home.html", featured=db.featured_product(),
                           products=db.latest_products(8), categories=db.list_categories(),
                           stats=db.review_summary(), quote=db.latest_five_star_review())


@app.route("/products")
def products():
    cat = request.args.get("c", type=int)
    search = request.args.get("q", "").strip()
    sort = request.args.get("sort", "new")
    if sort not in db.SORTS:
        sort = "new"
    return render_template("products.html", products=db.search_products(cat, search, sort),
                           categories=db.list_categories(), cat=cat, search=search,
                           sort=sort, sorts=db.SORTS)


@app.route("/product/<int:pid>")
def product(pid):
    item = db.get_product(pid)
    if not item:
        abort(404)
    wished = bool(current_user()) and db.is_wished(g.user["customer_id"], pid)
    return render_template("product.html", p=item, images=db.product_images(pid),
                           reviews=db.product_reviews(pid), summary=db.review_summary(pid),
                           wished=wished)


@app.route("/product/<int:pid>/review", methods=["POST"])
@login_required
def review(pid):
    rating = request.form.get("rating", type=int)
    comment = request.form.get("comment", "").strip()[:500]
    if rating not in (1, 2, 3, 4, 5):
        flash("Pick a rating from 1 to 5.")
    elif not db.get_product(pid):
        abort(404)
    else:
        db.add_review(pid, g.user["customer_id"], rating, comment)
        flash("Review saved. Thanks!")
    return redirect(url_for("product", pid=pid) + "#reviews")


# ---------------------------------------------------------------- accounts

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        f = {k: request.form.get(k, "").strip() for k in
             ("first_name", "last_name", "email", "phone")}
        password = request.form.get("password", "")
        if not (f["first_name"] and f["last_name"] and "@" in f["email"]) or len(password) < 6:
            flash("Fill in your name, a valid email and a password of 6+ characters.")
        else:
            cid = db.create_customer(f["first_name"], f["last_name"], f["email"].lower(),
                                     f["phone"], password)
            if cid is None:
                flash("That email already has an account.")
            else:
                session["customer_id"] = cid
                flash(f"Welcome aboard, {f['first_name']}!")
                return redirect(url_for("home"))
    return render_template("auth.html", mode="register")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        row = db.check_login(request.form.get("email", "").strip().lower(),
                             request.form.get("password", ""))
        if row:
            session["customer_id"] = row["customer_id"]
            flash(f"Welcome back, {row['first_name']}!")
            return redirect(safe_next(request.args.get("next")) or url_for("home"))
        flash("Wrong email or password.")
    return render_template("auth.html", mode="login")


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("customer_id", None)
    flash("Logged out. See you next issue!")
    return redirect(url_for("home"))


# ---------------------------------------------------------------- wishlist

@app.route("/wishlist")
@login_required
def wishlist():
    return render_template("wishlist.html", products=db.wishlist_products(g.user["customer_id"]))


@app.route("/wishlist/toggle/<int:pid>", methods=["POST"])
@login_required
def wishlist_toggle(pid):
    if not db.get_product(pid):
        abort(404)
    added = db.toggle_wishlist(g.user["customer_id"], pid)
    flash("Saved to wishlist!" if added else "Removed from wishlist.")
    return redirect(safe_next(request.form.get("next")) or url_for("product", pid=pid))


# ---------------------------------------------------------------- cart

@app.route("/cart")
@login_required
def cart():
    items = db.cart_rows(g.user["customer_id"])
    return render_template("cart.html", items=items, total=sum(i["line_total"] for i in items))


@app.route("/cart/add/<int:pid>", methods=["POST"])
@login_required
def cart_add(pid):
    qty = max(1, min(request.form.get("quantity", 1, type=int) or 1, 20))
    item = db.product_stock(pid)
    if not item:
        abort(404)
    if item["stock_quantity"] < 1:
        flash("Sold out, sorry!")
        return redirect(url_for("product", pid=pid))
    db.add_to_cart(g.user["customer_id"], pid, qty)
    flash(f"POW! {item['name']} is in your cart.")
    return redirect(safe_next(request.form.get("next")) or url_for("cart"))


@app.route("/cart/update/<int:item_id>", methods=["POST"])
@login_required
def cart_update(item_id):
    qty = min(request.form.get("quantity", 0, type=int) or 0, 20)
    db.set_cart_quantity(g.user["customer_id"], item_id, qty)
    return redirect(url_for("cart"))


# ---------------------------------------------------------------- checkout + orders

@app.route("/checkout", methods=["GET", "POST"])
@login_required
def checkout():
    cid = g.user["customer_id"]
    items = db.cart_rows(cid)
    if not items:
        flash("Your cart is empty.")
        return redirect(url_for("products"))

    if request.method == "POST":
        method = request.form.get("payment_method")
        if method not in db.PAYMENT_METHODS:
            flash("Choose a payment method.")
            return redirect(url_for("checkout"))
        choice = request.form.get("address_id", "new")
        address_id = new_address = None
        if choice == "new":
            new_address = {k: request.form.get(k, "").strip() for k in
                           ("address_line", "city", "state", "postal_code", "country")}
            if not all(new_address.values()):
                flash("Fill in every address field.")
                return redirect(url_for("checkout"))
        else:
            address_id = choice
        try:
            order_id = db.place_order(cid, method, address_id, new_address)
        except ValueError as e:
            flash(str(e))
            return redirect(url_for("cart"))
        flash(f"BOOM! Order #{order_id} placed.")
        return redirect(url_for("order", oid=order_id))

    return render_template("checkout.html", items=items,
                           total=sum(i["line_total"] for i in items),
                           addresses=db.customer_addresses(cid), methods=db.PAYMENT_METHODS)


@app.route("/orders")
@login_required
def orders():
    return render_template("orders.html", orders=db.list_orders(g.user["customer_id"]))


@app.route("/order/<int:oid>")
@login_required
def order(oid):
    o = db.get_order(oid, g.user["customer_id"])
    if not o:
        abort(404)
    return render_template("order.html", o=o, items=db.order_items(oid))


@app.route("/order/<int:oid>/advance", methods=["POST"])
@login_required
def order_advance(oid):
    """Demo button: plays the courier and moves the order one step forward."""
    o = db.get_order(oid, g.user["customer_id"])
    if not o:
        abort(404)
    db.advance_order(oid, o["status"])
    return redirect(url_for("order", oid=oid))


# ---------------------------------------------------------------- database explorer

@app.route("/database")
def database():
    sql = request.args.get("sql", "").strip()
    columns, rows, error = db.run_console(sql) if sql else ([], [], None)
    diagram = er_svg(lambda table: url_for("database", sql=f"SELECT * FROM {table}") + "#result")
    return render_template("database.html", schema=db.describe_schema(), reports=db.REPORTS,
                           sql=sql, columns=columns, rows=rows, error=error,
                           er=Markup(diagram), mapping=mapping_rows())


# ---------------------------------------------------------------- generated cover art

PALETTES = [("#F23A3A", "#FFD21F", "#1E9BE9"), ("#1E9BE9", "#FFD21F", "#F23A3A"),
            ("#FF9A1F", "#FFF6DC", "#7B2FF7"), ("#18B67A", "#FFD21F", "#F23A3A"),
            ("#7B2FF7", "#FFD21F", "#18B67A")]
GLYPHS = {"Superhero": "⚡", "Manga": "刀", "Indie": "✎", "Figures": "♜", "Posters": "★"}


def star(cx, cy, r_out, r_in, points, turn=0.0):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.pi * i / points + turn
        pts.append(f"{cx + r * math.cos(a):.1f},{cy + r * math.sin(a):.1f}")
    return " ".join(pts)


@app.route("/cover/<int:pid>/<int:n>.svg")
def cover(pid, n):
    """Draws a comic cover for a product, so the project needs no image files."""
    p = db.product_for_cover(pid)
    if not p:
        abort(404)
    bg, pop, accent = PALETTES[(pid + (n - 1) * 2) % len(PALETTES)]

    lines, line = [], ""
    for word in p["name"].upper().split():
        if line and len(line) + 1 + len(word) > 13:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    lines.append(line)
    size = min(44, int(262 / (max(len(l) for l in lines) * 0.56)))
    title = "".join(
        f'<text x="150" y="{78 + i * (size + 4)}" font-size="{size}" text-anchor="middle" '
        f'fill="{pop}" stroke="#111" stroke-width="6" paint-order="stroke" '
        f'stroke-linejoin="round">{escape(l)}</text>' for i, l in enumerate(lines))
    rays = "".join(
        f'<polygon points="150,250 {150 + 420 * math.cos(a):.0f},{250 + 420 * math.sin(a):.0f} '
        f'{150 + 420 * math.cos(a + 0.13):.0f},{250 + 420 * math.sin(a + 0.13):.0f}" '
        f'fill="#fff" opacity=".16"/>' for a in [i * math.pi / 9 for i in range(18)])
    turn = 0.2 if n == 1 else 0.5
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420" font-family="Impact, 'Arial Black', sans-serif">
<defs><pattern id="d" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#111" opacity=".18"/></pattern></defs>
<rect width="300" height="420" fill="{bg}"/>{rays}<rect width="300" height="420" fill="url(#d)"/>
<rect x="0" y="0" width="300" height="30" fill="#111"/>
<text x="12" y="21" font-size="15" fill="{pop}" letter-spacing="1.5">INKPOW! PRESENTS</text>
<text x="288" y="21" font-size="15" fill="#fff" text-anchor="end">{escape(p["category"].upper())}</text>
<polygon points="{star(150, 275, 105, 68, 12, turn)}" fill="{pop}" stroke="#111" stroke-width="6" stroke-linejoin="round"/>
<polygon points="{star(150, 275, 62, 44, 9, turn + 0.3)}" fill="{accent}" stroke="#111" stroke-width="5" stroke-linejoin="round"/>
<text x="150" y="298" font-size="64" text-anchor="middle" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke">{GLYPHS.get(p["category"], "!")}</text>
{title}
<rect x="0" y="390" width="300" height="30" fill="#111"/>
<text x="150" y="411" font-size="14" fill="#fff" text-anchor="middle" letter-spacing="2">{escape(p["sku"])} · {"FRONT" if n == 1 else "VARIANT"}</text>
<rect x="3" y="3" width="294" height="414" fill="none" stroke="#111" stroke-width="6"/>
</svg>"""
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "max-age=3600"})


db.init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
