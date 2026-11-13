-- INKPOW! store schema for MariaDB / MySQL.
-- Exactly the 14 tables from the schema diagram: same table names, same columns,
-- same column order, same data types, same primary and foreign keys.
-- No UNIQUE or CHECK constraints are added; the rules they would cover are
-- enforced by the triggers and procedures in advanced.sql.
--
-- Two things MariaDB needs that the drawing does not show:
--   * VARCHAR needs a maximum length, so each one has a sensible size
--   * primary keys use AUTO_INCREMENT so new rows get the next number

CREATE TABLE customers (
    customer_id   INT AUTO_INCREMENT PRIMARY KEY,
    first_name    VARCHAR(50),
    last_name     VARCHAR(50),
    email         VARCHAR(120) NOT NULL,
    phone         VARCHAR(20),
    password_hash VARCHAR(255),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

CREATE TABLE addresses (
    address_id   INT AUTO_INCREMENT PRIMARY KEY,
    customer_id  INT,
    address_line VARCHAR(200),
    city         VARCHAR(80),
    state        VARCHAR(80),
    postal_code  VARCHAR(12),
    country      VARCHAR(80),
    is_default   BOOLEAN,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE = InnoDB;

CREATE TABLE categories (
    category_id        INT AUTO_INCREMENT PRIMARY KEY,
    name               VARCHAR(80),
    parent_category_id INT,
    FOREIGN KEY (parent_category_id) REFERENCES categories(category_id)
) ENGINE = InnoDB;

CREATE TABLE suppliers (
    supplier_id   INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(120),
    contact_email VARCHAR(120),
    phone         VARCHAR(20),
    address       VARCHAR(200)
) ENGINE = InnoDB;

CREATE TABLE products (
    product_id     INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(120),
    description    TEXT,
    price          DECIMAL(10,2),
    sku            VARCHAR(40),
    category_id    INT,
    supplier_id    INT,
    stock_quantity INT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
) ENGINE = InnoDB;

CREATE TABLE product_images (
    image_id   INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    image_url  VARCHAR(255),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE = InnoDB;

CREATE TABLE reviews (
    review_id   INT AUTO_INCREMENT PRIMARY KEY,
    product_id  INT,
    customer_id INT,
    rating      INT,
    comment     TEXT,
    review_date DATE DEFAULT (CURRENT_DATE),
    FOREIGN KEY (product_id)  REFERENCES products(product_id),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE = InnoDB;

CREATE TABLE wishlist (
    wishlist_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    product_id  INT,
    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
    FOREIGN KEY (product_id)  REFERENCES products(product_id)
) ENGINE = InnoDB;

CREATE TABLE cart (
    cart_id     INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
) ENGINE = InnoDB;

CREATE TABLE cart_items (
    cart_item_id INT AUTO_INCREMENT PRIMARY KEY,
    cart_id      INT,
    product_id   INT,
    quantity     INT,
    added_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cart_id)    REFERENCES cart(cart_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE = InnoDB;

CREATE TABLE orders (
    order_id            INT AUTO_INCREMENT PRIMARY KEY,
    customer_id         INT,
    shipping_address_id INT,
    order_date          DATE DEFAULT (CURRENT_DATE),
    status              VARCHAR(20),
    total_amount        DECIMAL(10,2),
    FOREIGN KEY (customer_id)         REFERENCES customers(customer_id),
    FOREIGN KEY (shipping_address_id) REFERENCES addresses(address_id)
) ENGINE = InnoDB;

CREATE TABLE order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id      INT,
    product_id    INT,
    quantity      INT,
    unit_price    DECIMAL(10,2),
    FOREIGN KEY (order_id)   REFERENCES orders(order_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE = InnoDB;

CREATE TABLE payments (
    payment_id       INT AUTO_INCREMENT PRIMARY KEY,
    order_id         INT,
    payment_method   VARCHAR(30),
    amount           DECIMAL(10,2),
    payment_status   VARCHAR(20),
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
) ENGINE = InnoDB;

CREATE TABLE shipments (
    shipment_id     INT AUTO_INCREMENT PRIMARY KEY,
    order_id        INT,
    carrier         VARCHAR(60),
    tracking_number VARCHAR(40),
    shipped_date    DATE,
    delivered_date  DATE,
    status          VARCHAR(20),
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
) ENGINE = InnoDB;
