-- INKPOW! users, roles and privileges (role-based access control in MariaDB).
-- setup.sh (run as root) creates the three roles and the database users and
-- gives each user its role. This file says what each role may do. Loaded last.
--
--   role             used by                          can
--   ---------------  -------------------------------  ---------------------------------------
--   inkpow_customer  web app for shoppers and guests  read the shop, manage own cart/wishlist,
--                                                     review, sign up, check out (procedures)
--   inkpow_admin     web app for admin pages          read and change store data, run every
--                                                     procedure; no DDL (cannot DROP or ALTER)
--   inkpow_readonly  SQL console on the Database tab  SELECT only, never customers.password_hash
--
-- The table owner 'inkpow' (DDL, used only by the reset script) is not used by the web app.


-- ---------------------------------------------------------------- customer role
GRANT SELECT ON categories        TO inkpow_customer;
GRANT SELECT (supplier_id, name, address) ON suppliers TO inkpow_customer;
GRANT SELECT ON products          TO inkpow_customer;
GRANT SELECT ON product_images    TO inkpow_customer;
GRANT SELECT ON v_product_catalog TO inkpow_customer;
GRANT SELECT ON v_order_summary   TO inkpow_customer;

-- Sign up and log in. INSERT is limited to these columns, so a customer
-- connection can never write role = 'admin'.
GRANT SELECT (customer_id, first_name, last_name, email, phone, password_hash, role, created_at)
      ON customers TO inkpow_customer;
GRANT INSERT (first_name, last_name, email, phone, password_hash) ON customers TO inkpow_customer;

GRANT SELECT, INSERT          ON addresses  TO inkpow_customer;
GRANT SELECT, INSERT          ON reviews    TO inkpow_customer;
GRANT SELECT, INSERT, DELETE  ON wishlist   TO inkpow_customer;
GRANT SELECT                  ON cart       TO inkpow_customer;
GRANT SELECT, DELETE          ON cart_items TO inkpow_customer;
GRANT UPDATE (quantity)       ON cart_items TO inkpow_customer;
GRANT SELECT ON orders        TO inkpow_customer;
GRANT SELECT ON order_items   TO inkpow_customer;
GRANT SELECT ON payments      TO inkpow_customer;
GRANT SELECT ON shipments     TO inkpow_customer;

-- Writes that touch stock, orders and payments only happen inside these.
GRANT EXECUTE ON PROCEDURE sp_add_to_cart    TO inkpow_customer;
GRANT EXECUTE ON PROCEDURE sp_place_order    TO inkpow_customer;
GRANT EXECUTE ON FUNCTION  fn_product_rating TO inkpow_customer;
GRANT EXECUTE ON FUNCTION  fn_cart_total     TO inkpow_customer;
GRANT EXECUTE ON FUNCTION  fn_order_total    TO inkpow_customer;


-- ---------------------------------------------------------------- admin role
GRANT SELECT, INSERT, UPDATE, DELETE ON inkpow.* TO inkpow_admin;
GRANT EXECUTE ON inkpow.* TO inkpow_admin;


-- ---------------------------------------------------------------- read-only role
GRANT SELECT (customer_id, first_name, last_name, email, phone, role, created_at)
      ON customers TO inkpow_readonly;
GRANT SELECT ON addresses         TO inkpow_readonly;
GRANT SELECT ON categories        TO inkpow_readonly;
GRANT SELECT ON suppliers         TO inkpow_readonly;
GRANT SELECT ON products          TO inkpow_readonly;
GRANT SELECT ON product_images    TO inkpow_readonly;
GRANT SELECT ON reviews           TO inkpow_readonly;
GRANT SELECT ON wishlist          TO inkpow_readonly;
GRANT SELECT ON cart              TO inkpow_readonly;
GRANT SELECT ON cart_items        TO inkpow_readonly;
GRANT SELECT ON orders            TO inkpow_readonly;
GRANT SELECT ON order_items       TO inkpow_readonly;
GRANT SELECT ON payments          TO inkpow_readonly;
GRANT SELECT ON shipments         TO inkpow_readonly;
GRANT SELECT ON v_product_catalog TO inkpow_readonly;
GRANT SELECT ON v_order_summary   TO inkpow_readonly;
GRANT SELECT ON v_customer_spend  TO inkpow_readonly;
GRANT SELECT ON v_low_stock       TO inkpow_readonly;
GRANT EXECUTE ON FUNCTION  fn_product_rating TO inkpow_readonly;
GRANT EXECUTE ON FUNCTION  fn_cart_total     TO inkpow_readonly;
GRANT EXECUTE ON FUNCTION  fn_order_total    TO inkpow_readonly;
GRANT EXECUTE ON PROCEDURE sp_customer_tiers TO inkpow_readonly;
