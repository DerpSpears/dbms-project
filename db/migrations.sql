-- INKPOW! migration 2: changes made after the first version of the schema.
-- schema.sql is the diagram exactly as drawn. This file shows how a live
-- database is changed afterwards with ALTER and DROP, without rebuilding it.
-- Loaded after schema.sql, seed.sql and advanced.sql.

-- 1. Roles in the application. The store now has two kinds of user: customers
--    and admins (who manage stock and move orders along). ENUM limits the
--    values; NOT NULL DEFAULT makes every existing row a customer.
ALTER TABLE customers
    ADD COLUMN role ENUM('customer', 'admin') NOT NULL DEFAULT 'customer' AFTER password_hash;

-- 2. Swap the plain email index for a UNIQUE one. The trigger already refuses
--    duplicate emails with a friendly message; the unique index is the
--    guarantee underneath it, even for rows written by an admin tool.
ALTER TABLE customers DROP INDEX idx_customers_email;
ALTER TABLE customers ADD UNIQUE INDEX uq_customers_email (email);

-- 3. CHECK constraints for values that can never be valid.
ALTER TABLE products
    ADD CONSTRAINT chk_products_price CHECK (price >= 0),
    ADD CONSTRAINT chk_products_stock CHECK (stock_quantity >= 0);
ALTER TABLE reviews
    ADD CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE order_items
    ADD CONSTRAINT chk_order_items_qty CHECK (quantity >= 1);

-- 4. A product can be saved to a wishlist once per customer.
ALTER TABLE wishlist
    ADD CONSTRAINT uq_wishlist_customer_product UNIQUE (customer_id, product_id);

-- 5. Full-text search over product names and descriptions. The shop's search
--    box uses MATCH ... AGAINST instead of LIKE '%word%'.
ALTER TABLE products ADD FULLTEXT INDEX ft_products_search (name, description);

-- 6. The first admin account (password set by the reset script).
INSERT INTO customers (first_name, last_name, email, phone, password_hash, role)
VALUES ('Admin', 'Inkpow', 'admin@inkpow.test', '9000000000', 'x', 'admin');
