-- INKPOW! advanced database features (MariaDB / MySQL).
-- Loaded after schema.sql and seed.sql. The website uses every object here:
-- checkout, add to cart, sign-up and order tracking all go through these
-- procedures and triggers instead of plain INSERTs from Python.
--
--   1. Views               v_product_catalog, v_order_summary, v_customer_spend, v_low_stock
--   2. Stored functions    fn_product_rating, fn_cart_total, fn_order_total
--   3. Stored procedures   sp_add_to_cart, sp_place_order, sp_advance_order,
--                          sp_customer_tiers, sp_restock_low_stock
--   4. Cursors             inside sp_place_order, sp_customer_tiers, sp_restock_low_stock
--   5. Triggers            on customers, reviews, cart_items, order_items, shipments
--   6. Error handling      SIGNAL, RESIGNAL, DECLARE ... HANDLER
--   7. Transactions        START TRANSACTION / COMMIT / ROLLBACK inside sp_place_order
--   8. Indexes             single-column and composite
--   9. Users and privileges  MariaDB roles and GRANTs, in security.sql
--  10. Window functions and recursive CTEs are in the reports in db.py


-- =====================================================================
-- 8. Indexes
-- InnoDB already indexes every foreign key column. These cover the other
-- columns the site searches, sorts or filters on.
-- =====================================================================

CREATE INDEX idx_products_name        ON products (name);
CREATE INDEX idx_products_created     ON products (created_at);
CREATE INDEX idx_orders_date          ON orders (order_date);
CREATE INDEX idx_customers_email      ON customers (email);
CREATE INDEX idx_reviews_product_date ON reviews (product_id, review_date);   -- composite


DELIMITER $$

-- =====================================================================
-- 2. Stored functions
-- =====================================================================

-- Average star rating of one product, NULL if nobody has reviewed it.
CREATE FUNCTION fn_product_rating(p_product_id INT)
RETURNS DECIMAL(3,1)
READS SQL DATA
BEGIN
    DECLARE v_avg DECIMAL(3,1);
    SELECT ROUND(AVG(rating), 1) INTO v_avg FROM reviews WHERE product_id = p_product_id;
    RETURN v_avg;
END $$

-- Value of everything in a cart at today's prices.
CREATE FUNCTION fn_cart_total(p_cart_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT COALESCE(SUM(ci.quantity * p.price), 0) INTO v_total
      FROM cart_items ci JOIN products p ON p.product_id = ci.product_id
     WHERE ci.cart_id = p_cart_id;
    RETURN v_total;
END $$

-- Total of an order recomputed from its lines (used to check orders.total_amount).
CREATE FUNCTION fn_order_total(p_order_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_total
      FROM order_items WHERE order_id = p_order_id;
    RETURN v_total;
END $$


-- =====================================================================
-- 5. Triggers
-- =====================================================================

-- Emails are stored in lower case and must be unique. The schema diagram has
-- no UNIQUE constraint, so this trigger enforces it.
CREATE TRIGGER trg_customers_before_insert
BEFORE INSERT ON customers
FOR EACH ROW
BEGIN
    SET NEW.email = LOWER(TRIM(NEW.email));
    IF EXISTS (SELECT 1 FROM customers WHERE email = NEW.email) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'That email already has an account.';
    END IF;
END $$

-- Every new customer gets their one cart automatically (Customer owns Cart, 1:1).
CREATE TRIGGER trg_customers_after_insert
AFTER INSERT ON customers
FOR EACH ROW
BEGIN
    INSERT INTO cart (customer_id) VALUES (NEW.customer_id);
END $$

-- Ratings must be 1 to 5, on insert and on update.
CREATE TRIGGER trg_reviews_before_insert
BEFORE INSERT ON reviews
FOR EACH ROW
BEGIN
    IF NEW.rating IS NULL OR NEW.rating NOT BETWEEN 1 AND 5 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Rating must be between 1 and 5.';
    END IF;
END $$

CREATE TRIGGER trg_reviews_before_update
BEFORE UPDATE ON reviews
FOR EACH ROW
BEGIN
    IF NEW.rating IS NULL OR NEW.rating NOT BETWEEN 1 AND 5 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Rating must be between 1 and 5.';
    END IF;
END $$

-- Cart quantities must be positive.
CREATE TRIGGER trg_cart_items_before_insert
BEFORE INSERT ON cart_items
FOR EACH ROW
BEGIN
    IF NEW.quantity IS NULL OR NEW.quantity < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must be at least 1.';
    END IF;
END $$

CREATE TRIGGER trg_cart_items_before_update
BEFORE UPDATE ON cart_items
FOR EACH ROW
BEGIN
    IF NEW.quantity IS NULL OR NEW.quantity < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must be at least 1.';
    END IF;
END $$

-- Selling a product: refuse if there is not enough stock, fill in the price
-- if the caller left it out, and take the quantity out of stock.
CREATE TRIGGER trg_order_items_before_insert
BEFORE INSERT ON order_items
FOR EACH ROW
BEGIN
    DECLARE v_stock INT;
    DECLARE v_price DECIMAL(10,2);
    DECLARE v_name  VARCHAR(120);

    SELECT stock_quantity, price, name INTO v_stock, v_price, v_name
      FROM products WHERE product_id = NEW.product_id
       FOR UPDATE;                                   -- lock the row until COMMIT

    IF v_stock < NEW.quantity THEN
        SET @stock_msg = CONCAT('Not enough stock for ', v_name, ' (', v_stock, ' left).');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @stock_msg;
    END IF;
    IF NEW.unit_price IS NULL THEN
        SET NEW.unit_price = v_price;
    END IF;
    UPDATE products SET stock_quantity = stock_quantity - NEW.quantity
     WHERE product_id = NEW.product_id;
END $$

-- When a shipment moves on, keep the order and its payment in step.
CREATE TRIGGER trg_shipments_after_update
AFTER UPDATE ON shipments
FOR EACH ROW
BEGIN
    IF NEW.status <> OLD.status THEN
        IF NEW.status = 'In transit' THEN
            UPDATE orders SET status = 'Shipped' WHERE order_id = NEW.order_id;
        ELSEIF NEW.status = 'Delivered' THEN
            UPDATE orders   SET status = 'Delivered'      WHERE order_id = NEW.order_id;
            UPDATE payments SET payment_status = 'Paid'   WHERE order_id = NEW.order_id;
        END IF;
    END IF;
END $$


-- =====================================================================
-- 3. Stored procedures (with 4. cursors, 6. error handling, 7. transactions)
-- =====================================================================

-- Add a product to a customer's cart. Adding the same product again
-- increases the quantity instead of adding a second line.
CREATE PROCEDURE sp_add_to_cart(IN p_customer_id INT, IN p_product_id INT, IN p_quantity INT)
BEGIN
    DECLARE v_cart  INT;
    DECLARE v_stock INT;
    DECLARE v_line  INT;

    SELECT stock_quantity INTO v_stock FROM products WHERE product_id = p_product_id;
    IF v_stock IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No such product.';
    ELSEIF v_stock < 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sold out, sorry!';
    END IF;

    SELECT cart_id INTO v_cart FROM cart WHERE customer_id = p_customer_id LIMIT 1;
    IF v_cart IS NULL THEN
        INSERT INTO cart (customer_id) VALUES (p_customer_id);
        SET v_cart = LAST_INSERT_ID();
    END IF;

    SELECT cart_item_id INTO v_line FROM cart_items
     WHERE cart_id = v_cart AND product_id = p_product_id LIMIT 1;
    IF v_line IS NULL THEN
        INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (v_cart, p_product_id, p_quantity);
    ELSE
        UPDATE cart_items SET quantity = quantity + p_quantity WHERE cart_item_id = v_line;
    END IF;
END $$


-- Checkout. One transaction: create the order, copy each cart line with a
-- cursor (the order_items trigger checks and reduces stock), record the
-- payment and shipment, empty the cart. Any error rolls everything back.
-- Pass p_address_id for a saved address, or NULL plus the address fields
-- to save a new one as part of the same transaction.
CREATE PROCEDURE sp_place_order(
    IN  p_customer_id INT,
    IN  p_address_id  INT,
    IN  p_line        VARCHAR(200),
    IN  p_city        VARCHAR(80),
    IN  p_state       VARCHAR(80),
    IN  p_postal_code VARCHAR(12),
    IN  p_country     VARCHAR(80),
    IN  p_method      VARCHAR(30),
    OUT p_order_id    INT)
BEGIN
    DECLARE v_cart       INT;
    DECLARE v_total      DECIMAL(10,2);
    DECLARE v_product    INT;
    DECLARE v_quantity   INT;
    DECLARE v_first_addr BOOLEAN;
    DECLARE done         BOOLEAN DEFAULT FALSE;

    DECLARE cart_lines CURSOR FOR
        SELECT product_id, quantity FROM cart_items WHERE cart_id = v_cart ORDER BY cart_item_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;     -- undo every step, then pass the original error to the caller
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT cart_id INTO v_cart FROM cart WHERE customer_id = p_customer_id LIMIT 1;
    IF v_cart IS NULL OR NOT EXISTS (SELECT 1 FROM cart_items WHERE cart_id = v_cart) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Your cart is empty.';
    END IF;

    IF p_method NOT IN ('UPI', 'Card', 'Net Banking', 'Cash on Delivery') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose a payment method.';
    END IF;

    IF p_address_id IS NULL THEN
        SET v_first_addr = NOT EXISTS (SELECT 1 FROM addresses WHERE customer_id = p_customer_id);
        INSERT INTO addresses (customer_id, address_line, city, state, postal_code, country, is_default)
        VALUES (p_customer_id, p_line, p_city, p_state, p_postal_code, p_country, v_first_addr);
        SET p_address_id = LAST_INSERT_ID();
    ELSEIF NOT EXISTS (SELECT 1 FROM addresses
                        WHERE address_id = p_address_id AND customer_id = p_customer_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose one of your own addresses.';
    END IF;

    SET v_total = fn_cart_total(v_cart);
    INSERT INTO orders (customer_id, shipping_address_id, status, total_amount)
    VALUES (p_customer_id, p_address_id, 'Processing', v_total);
    SET p_order_id = LAST_INSERT_ID();

    -- cursor: one order line per cart line
    SET done = FALSE;
    OPEN cart_lines;
    copy_lines: LOOP
        FETCH cart_lines INTO v_product, v_quantity;
        IF done THEN
            LEAVE copy_lines;
        END IF;
        -- unit_price is left NULL: trg_order_items_before_insert fills in
        -- today's price, checks stock and reduces it
        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
        VALUES (p_order_id, v_product, v_quantity, NULL);
    END LOOP;
    CLOSE cart_lines;

    INSERT INTO payments (order_id, payment_method, amount, payment_status)
    VALUES (p_order_id, p_method, v_total,
            IF(p_method = 'Cash on Delivery', 'Pending', 'Paid'));

    INSERT INTO shipments (order_id, carrier, tracking_number, status)
    VALUES (p_order_id,
            ELT(1 + FLOOR(RAND() * 3), 'BlueDart', 'Delhivery', 'India Post'),
            CONCAT('INK', LPAD(FLOOR(RAND() * 100000000), 8, '0')),
            'Preparing');

    DELETE FROM cart_items WHERE cart_id = v_cart;

    COMMIT;
END $$


-- Move an order one step forward (the courier's job; a demo button on the site).
-- It only touches shipments; trg_shipments_after_update updates the order and payment.
CREATE PROCEDURE sp_advance_order(IN p_order_id INT)
BEGIN
    DECLARE v_status VARCHAR(20);
    SELECT status INTO v_status FROM orders WHERE order_id = p_order_id;

    IF v_status = 'Processing' THEN
        UPDATE shipments SET status = 'In transit', shipped_date = CURDATE()
         WHERE order_id = p_order_id;
    ELSEIF v_status = 'Shipped' THEN
        UPDATE shipments SET status = 'Delivered', delivered_date = CURDATE()
         WHERE order_id = p_order_id;
    END IF;
END $$


-- Loyalty tiers. A cursor walks every customer, works out what they have
-- spent and assigns Gold, Silver or Bronze. Read-only, so the SQL console may call it.
CREATE PROCEDURE sp_customer_tiers()
READS SQL DATA
BEGIN
    DECLARE v_id     INT;
    DECLARE v_name   VARCHAR(101);
    DECLARE v_orders INT;
    DECLARE v_spent  DECIMAL(10,2);
    DECLARE done     BOOLEAN DEFAULT FALSE;
    DECLARE everyone CURSOR FOR
        SELECT customer_id, CONCAT(first_name, ' ', last_name) FROM customers ORDER BY customer_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    DROP TEMPORARY TABLE IF EXISTS tmp_tiers;
    CREATE TEMPORARY TABLE tmp_tiers (
        customer_id INT, customer VARCHAR(101), orders INT, total_spent DECIMAL(10,2), tier VARCHAR(10));

    OPEN everyone;
    each_customer: LOOP
        FETCH everyone INTO v_id, v_name;
        IF done THEN
            LEAVE each_customer;
        END IF;
        SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO v_orders, v_spent
          FROM orders WHERE customer_id = v_id;
        INSERT INTO tmp_tiers VALUES (v_id, v_name, v_orders, v_spent,
            CASE WHEN v_spent >= 1500 THEN 'Gold'
                 WHEN v_spent >= 500  THEN 'Silver'
                 ELSE 'Bronze' END);
    END LOOP;
    CLOSE everyone;

    SELECT * FROM tmp_tiers ORDER BY total_spent DESC;
    DROP TEMPORARY TABLE tmp_tiers;
END $$


-- Restock: a cursor walks every product at or below the threshold and adds
-- stock, then reports what changed. Used by the "Restock" button on the Database tab.
CREATE PROCEDURE sp_restock_low_stock(IN p_threshold INT, IN p_amount INT)
MODIFIES SQL DATA
BEGIN
    DECLARE v_id    INT;
    DECLARE v_name  VARCHAR(120);
    DECLARE v_stock INT;
    DECLARE done    BOOLEAN DEFAULT FALSE;
    DECLARE low CURSOR FOR
        SELECT product_id, name, stock_quantity FROM products
         WHERE stock_quantity <= p_threshold ORDER BY stock_quantity;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    DROP TEMPORARY TABLE IF EXISTS tmp_restock;
    CREATE TEMPORARY TABLE tmp_restock (product VARCHAR(120), old_stock INT, new_stock INT);

    OPEN low;
    each_product: LOOP
        FETCH low INTO v_id, v_name, v_stock;
        IF done THEN
            LEAVE each_product;
        END IF;
        UPDATE products SET stock_quantity = stock_quantity + p_amount WHERE product_id = v_id;
        INSERT INTO tmp_restock VALUES (v_name, v_stock, v_stock + p_amount);
    END LOOP;
    CLOSE low;

    SELECT * FROM tmp_restock;
    DROP TEMPORARY TABLE tmp_restock;
END $$

DELIMITER ;


-- =====================================================================
-- 1. Views
-- =====================================================================

-- Everything a product card needs in one place.
CREATE VIEW v_product_catalog AS
SELECT p.product_id, p.name, p.description, p.price, p.sku, p.category_id, p.supplier_id,
       p.stock_quantity, p.created_at,
       c.name AS category,
       (SELECT i.image_url FROM product_images i
         WHERE i.product_id = p.product_id ORDER BY i.image_id LIMIT 1) AS image_url,
       fn_product_rating(p.product_id) AS rating,
       p.created_at >= NOW() - INTERVAL 30 DAY AS is_new
  FROM products p
  JOIN categories c ON c.category_id = p.category_id;

-- One row per order with its line count, payment and shipment.
CREATE VIEW v_order_summary AS
SELECT o.order_id, o.customer_id, o.order_date, o.status, o.total_amount,
       COUNT(oi.order_item_id) AS line_count, SUM(oi.quantity) AS pieces,
       pay.payment_method, pay.payment_status,
       s.carrier, s.tracking_number
  FROM orders o
  JOIN order_items oi    ON oi.order_id = o.order_id
  LEFT JOIN payments pay ON pay.order_id = o.order_id
  LEFT JOIN shipments s  ON s.order_id = o.order_id
 GROUP BY o.order_id, o.customer_id, o.order_date, o.status, o.total_amount,
          pay.payment_method, pay.payment_status, s.carrier, s.tracking_number;

-- How much each customer has spent, including customers with no orders.
CREATE VIEW v_customer_spend AS
SELECT cu.customer_id, CONCAT(cu.first_name, ' ', cu.last_name) AS customer,
       COUNT(o.order_id) AS orders,
       COALESCE(SUM(o.total_amount), 0) AS total_spent
  FROM customers cu
  LEFT JOIN orders o ON o.customer_id = cu.customer_id
 GROUP BY cu.customer_id, cu.first_name, cu.last_name;

-- Products that need restocking, with who to call.
CREATE VIEW v_low_stock AS
SELECT p.product_id, p.name, p.sku, p.stock_quantity, s.name AS supplier, s.contact_email
  FROM products p
  JOIN suppliers s ON s.supplier_id = p.supplier_id
 WHERE p.stock_quantity <= 5;

-- 9. Users and privileges: see security.sql (roles and GRANTs).
