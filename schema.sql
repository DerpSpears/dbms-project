-- INKPOW! store schema.
-- Exactly the 14 tables from the schema diagram: same table names, same columns,
-- same column order, same data types, same primary and foreign keys.
-- Nothing else is added: no extra columns, no UNIQUE or CHECK constraints, no indexes.
--
-- Two things SQLite needs that a drawing does not show:
--   * a primary key is written INTEGER PRIMARY KEY (SQLite's auto-numbered int)
--   * DEFAULT CURRENT_TIMESTAMP / CURRENT_DATE fills the date columns on insert

PRAGMA foreign_keys = ON;

CREATE TABLE customers (
    customer_id   INTEGER PRIMARY KEY,
    first_name    VARCHAR,
    last_name     VARCHAR,
    email         VARCHAR NOT NULL,
    phone         VARCHAR,
    password_hash VARCHAR,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE addresses (
    address_id   INTEGER PRIMARY KEY,
    customer_id  INT REFERENCES customers(customer_id),
    address_line VARCHAR,
    city         VARCHAR,
    state        VARCHAR,
    postal_code  VARCHAR,
    country      VARCHAR,
    is_default   BOOLEAN
);

CREATE TABLE categories (
    category_id        INTEGER PRIMARY KEY,
    name               VARCHAR,
    parent_category_id INT REFERENCES categories(category_id)
);

CREATE TABLE suppliers (
    supplier_id   INTEGER PRIMARY KEY,
    name          VARCHAR,
    contact_email VARCHAR,
    phone         VARCHAR,
    address       VARCHAR
);

CREATE TABLE products (
    product_id     INTEGER PRIMARY KEY,
    name           VARCHAR,
    description    TEXT,
    price          DECIMAL(10,2),
    sku            VARCHAR,
    category_id    INT REFERENCES categories(category_id),
    supplier_id    INT REFERENCES suppliers(supplier_id),
    stock_quantity INT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_images (
    image_id   INTEGER PRIMARY KEY,
    product_id INT REFERENCES products(product_id),
    image_url  VARCHAR
);

CREATE TABLE reviews (
    review_id   INTEGER PRIMARY KEY,
    product_id  INT REFERENCES products(product_id),
    customer_id INT REFERENCES customers(customer_id),
    rating      INT,
    comment     TEXT,
    review_date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE wishlist (
    wishlist_id INTEGER PRIMARY KEY,
    customer_id INT REFERENCES customers(customer_id),
    product_id  INT REFERENCES products(product_id),
    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart (
    cart_id     INTEGER PRIMARY KEY,
    customer_id INT REFERENCES customers(customer_id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart_items (
    cart_item_id INTEGER PRIMARY KEY,
    cart_id      INT REFERENCES cart(cart_id),
    product_id   INT REFERENCES products(product_id),
    quantity     INT,
    added_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    order_id            INTEGER PRIMARY KEY,
    customer_id         INT REFERENCES customers(customer_id),
    shipping_address_id INT REFERENCES addresses(address_id),
    order_date          DATE DEFAULT CURRENT_DATE,
    status              VARCHAR,
    total_amount        DECIMAL(10,2)
);

CREATE TABLE order_items (
    order_item_id INTEGER PRIMARY KEY,
    order_id      INT REFERENCES orders(order_id),
    product_id    INT REFERENCES products(product_id),
    quantity      INT,
    unit_price    DECIMAL(10,2)
);

CREATE TABLE payments (
    payment_id       INTEGER PRIMARY KEY,
    order_id         INT REFERENCES orders(order_id),
    payment_method   VARCHAR,
    amount           DECIMAL(10,2),
    payment_status   VARCHAR,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shipments (
    shipment_id     INTEGER PRIMARY KEY,
    order_id        INT REFERENCES orders(order_id),
    carrier         VARCHAR,
    tracking_number VARCHAR,
    shipped_date    DATE,
    delivered_date  DATE,
    status          VARCHAR
);
