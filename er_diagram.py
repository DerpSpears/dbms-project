"""Draws the project's ER diagram (Chen notation) as an SVG.

Rectangles are entities, diamonds are relationships, ovals are attributes.
Underlined attribute = key. Double rectangle / double diamond = weak entity and
its identifying relationship. Double line = total participation.
"""
import math
from html import escape

W, H = 1860, 1400

# key: label, centre, table it became, attributes, arc (degrees, 0 = right, 90 = down)
ENTITIES = {
    "customer": dict(label="Customer", at=(900, 215), table="customers", arc=(196, 335),
                     attrs=["customer_id*", "email", "first_name", "created_at", "last_name",
                            "phone", "password_hash"]),
    "cart": dict(label="Cart", at=(300, 215), table="cart", arc=(215, 300),
                 attrs=["cart_id*", "created_at"]),
    "address": dict(label="Address", at=(1500, 215), table="addresses", arc=(197, 372),
                    attrs=["address_id*", "city", "address_line", "state", "postal_code",
                           "country", "is_default"]),
    "review": dict(label="Reviews", at=(650, 560), table="reviews", arc=(150, 210),
                   attrs=["rating", "comment"]),
    "category": dict(label="Category", at=(185, 640), table="categories", arc=(150, 215),
                     attrs=["category_id*", "name"]),
    "supplier": dict(label="Supplier", at=(250, 915), table="suppliers", arc=(100, 250),
                     attrs=["supplier_id*", "phone", "name", "contact_email", "address"]),
    "product": dict(label="Product", at=(700, 915), table="products", arc=(12, 128),
                    attrs=["product_id*", "name", "description", "price", "stock_quantity",
                           "sku", "created_at"]),
    "image": dict(label="Product Image", at=(260, 1270), table="product_images", weak=True,
                  arc=(60, 150), attrs=["image_id~", "image_url"]),
    "order": dict(label="Order", at=(1350, 915), table="orders", arc=(95, 148),
                  attrs=["order_id*", "order_date", "total_amount", "status"]),
    "payment": dict(label="Payment", at=(1560, 650), table="payments", arc=(265, 420),
                    attrs=["payment_id*", "payment_method", "amount", "payment_status",
                           "transaction_date"]),
    "shipment": dict(label="Shipment", at=(1600, 1195), table="shipments", arc=(-30, 135),
                     attrs=["shipment_id*", "carrier", "tracking_number", "status",
                            "delivered_date", "shipped_date"]),
}

# label, centre, [(entity, cardinality, total participation)], how it was mapped to tables
RELATIONSHIPS = [
    dict(label="has", at=(1200, 215), ends=[("customer", "1", False), ("address", "N", True)],
         maps="addresses.customer_id (FK)"),
    dict(label="owns", at=(600, 215), ends=[("customer", "1", False), ("cart", "1", False)],
         maps="cart.customer_id (FK)"),
    dict(label="contains", at=(430, 560), ends=[("cart", "M", False), ("product", "N", False)],
         attrs=["quantity", "added_at"], arc=(155, 205), table="cart_items",
         maps="its own table: cart_items"),
    dict(label="wishes", at=(865, 560), ends=[("customer", "M", False), ("product", "N", False)],
         attrs=["added_at"], arc=(0, 0), table="wishlist", maps="its own table: wishlist"),
    dict(label="places", at=(1125, 560), ends=[("customer", "1", False), ("order", "N", False)],
         maps="orders.customer_id (FK)"),
    dict(label="contains", at=(1060, 915), ends=[("order", "M", False), ("product", "N", False)],
         attrs=["quantity", "unit_price"], arc=(232, 308), table="order_items",
         maps="its own table: order_items"),
    dict(label="ships to", at=(1425, 560), ends=[("order", "N", True), ("address", "1", True)],
         maps="orders.shipping_address_id (FK)"),
    dict(label="paid by", at=(1455, 782), ends=[("order", "1", True), ("payment", "N", True)],
         maps="payments.order_id (FK)"),
    dict(label="ship via", at=(1480, 1060), ends=[("order", "1", True), ("shipment", "N", True)],
         maps="shipments.order_id (FK)"),
    dict(label="supplies", at=(475, 915), ends=[("supplier", "1", False), ("product", "N", False)],
         maps="products.supplier_id (FK)"),
    dict(label="belongs to", at=(440, 765), ends=[("product", "N", False), ("category", "1", False)],
         maps="products.category_id (FK)"),
    dict(label="has", at=(480, 1090), ends=[("product", "1", False), ("image", "N", True)],
         identifying=True, maps="product_images.product_id (FK)"),
]
# Reviews is drawn as an entity sitting between Customer and Product
REVIEW_LINKS = [("customer", "1"), ("product", "1")]
PARENT = dict(label="parent", at=(185, 480), maps="categories.parent_category_id (FK to itself)")

INK, CREAM = "#111", "#FFF6DC"


def _spokes(cx, cy, attrs, arc, r_in=100, r_out=165):
    """Place attribute ovals on an arc around (cx, cy). Returns (lines, ovals) SVG."""
    lines, ovals = [], []
    n = len(attrs)
    for i, raw in enumerate(attrs):
        deg = arc[0] if n == 1 else arc[0] + (arc[1] - arc[0]) * i / (n - 1)
        r = r_in if n <= 3 else (r_out if i % 2 == 0 else r_in)
        ax = cx + r * 1.3 * math.cos(math.radians(deg))
        ay = cy + r * math.sin(math.radians(deg))
        name = raw.rstrip("*~")
        rx = max(32, len(name) * 4.4 + 14)
        deco = (' text-decoration="underline"' if raw.endswith("*") else "")
        dash = ""
        if raw.endswith("~"):  # partial key of a weak entity: dashed underline
            dash = (f'<line x1="{ax - rx + 14:.0f}" y1="{ay + 9:.0f}" x2="{ax + rx - 14:.0f}" '
                    f'y2="{ay + 9:.0f}" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3"/>')
        lines.append(f'<line x1="{cx}" y1="{cy}" x2="{ax:.0f}" y2="{ay:.0f}" class="spoke"/>')
        ovals.append(f'<ellipse cx="{ax:.0f}" cy="{ay:.0f}" rx="{rx:.0f}" ry="17" class="attr"/>'
                     f'<text x="{ax:.0f}" y="{ay + 5:.0f}" class="attr-t"{deco}>{name}</text>{dash}')
    return lines, ovals


def _edge(a, b, total=False):
    x1, y1, x2, y2 = *a, *b
    if total:  # double line = total participation
        return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{INK}" stroke-width="9"/>'
                f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{CREAM}" stroke-width="3"/>')
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="edge"/>'


def _card(entity_at, toward, text):
    """The hand-drawn diagram has no cardinality marks on these lines, so none are drawn."""
    return ""


def _diamond(x, y, label, double=False, w=68, h=36):
    pts = f"{x - w},{y} {x},{y - h} {x + w},{y} {x},{y + h}"
    inner = ""
    if double:
        inner = (f'<polygon points="{x - w + 13},{y} {x},{y - h + 7} {x + w - 13},{y} {x},{y + h - 7}" '
                 f'fill="none" stroke="#fff" stroke-width="2"/>')
    return (f'<polygon points="{pts}" class="rel-shadow" transform="translate(4 4)"/>'
            f'<polygon points="{pts}" class="rel"/>{inner}'
            f'<text x="{x}" y="{y + 5}" class="rel-t">{label}</text>')


def er_svg(link):
    """link(table_name) -> URL that shows that table's rows."""
    back, mid, front = [], [], []

    for r in RELATIONSHIPS:
        for key, card, total in r["ends"]:
            back.append(_edge(ENTITIES[key]["at"], r["at"], total))
            mid.append(_card(ENTITIES[key]["at"], r["at"], card))
        if r.get("attrs"):
            lines, ovals = _spokes(*r["at"], r["attrs"], r["arc"], r_in=96)
            back += lines
            front += ovals
        shape = _diamond(*r["at"], r["label"], r.get("identifying", False))
        tip = f'<title>{escape(r["label"])} → {escape(r["maps"])}</title>'
        if r.get("table"):
            shape = f'<a href="{escape(link(r["table"]))}">{tip}{shape}</a>'
        else:
            shape = f"<g>{tip}{shape}</g>"
        front.append(shape)

    rv = ENTITIES["review"]["at"]
    for key, card in REVIEW_LINKS:
        back.append(_edge(ENTITIES[key]["at"], rv))
        mid.append(_card(ENTITIES[key]["at"], rv, card))
        mid.append(_card(rv, ENTITIES[key]["at"], "N"))

    # Category's relationship with itself
    cx, cy = ENTITIES["category"]["at"]
    px, py = PARENT["at"]
    back.append(f'<path d="M{cx - 45},{cy} L{px - 45},{py}" class="edge"/>'
                f'<path d="M{cx + 45},{cy} L{px + 45},{py}" class="edge"/>')
    mid.append(f'<text x="{cx - 82}" y="{cy - 75}" class="card">(0,N)</text>'
               f'<text x="{cx + 82}" y="{cy - 75}" class="card">(0,1)</text>')
    front.append(f'<g><title>parent → {escape(PARENT["maps"])}</title>'
                 f'{_diamond(px, py, PARENT["label"])}</g>')

    for e in ENTITIES.values():
        x, y = e["at"]
        lines, ovals = _spokes(x, y, e["attrs"], e["arc"])
        back += lines
        front += ovals
        box = (f'<rect x="{x - 79}" y="{y - 23}" width="158" height="46" rx="5" class="ent-shadow"/>'
               f'<rect x="{x - 83}" y="{y - 27}" width="158" height="46" rx="5" class="ent"/>')
        if e.get("weak"):
            box += f'<rect x="{x - 77}" y="{y - 21}" width="146" height="34" rx="3" class="ent-in"/>'
        front.append(f'<a href="{escape(link(e["table"]))}"><title>{e["label"]} → table {e["table"]}</title>'
                     f'{box}<text x="{x - 4}" y="{y + 4}" class="ent-t"{' style="font-size:21px"' if len(e["label"]) > 10 else ""}>{e["label"]}</text></a>')

    return (f'<svg viewBox="0 0 {W} {H}" class="er" role="img" '
            f'aria-label="Entity relationship diagram of the store database">'
            + "".join(back) + "".join(mid) + "".join(front) + "</svg>")


def mapping_rows():
    """Relationship -> how it became tables/columns, for the table under the diagram."""
    rows = []
    for r in RELATIONSHIPS:
        a, b = r["ends"]
        rows.append((f'{ENTITIES[a[0]]["label"]} {r["label"]} {ENTITIES[b[0]]["label"]}',
                     f"{a[1]} : {b[1]}", r["maps"]))
    rows.append(("Customer reviews Product", "M : N", "its own table: reviews"))
    rows.append(("Category parent of Category", "1 : N", PARENT["maps"]))
    return rows
