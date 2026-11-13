-- Sample data. Loaded before advanced.sql, so the triggers do not fire on it.
-- Every customer's password is set to "demo1234" by db.py after loading.

INSERT INTO customers (first_name, last_name, email, phone, password_hash, created_at) VALUES
 ('Asha',  'Menon',  'asha@example.com',  '9000000001', 'x', NOW() - INTERVAL 90 DAY),
 ('Rohan', 'Iyer',   'rohan@example.com', '9000000002', 'x', NOW() - INTERVAL 60 DAY),
 ('Meera', 'Kapoor', 'meera@example.com', '9000000003', 'x', NOW() - INTERVAL 30 DAY),
 ('Dev',   'Sharma', 'dev@example.com',   '9000000004', 'x', NOW() - INTERVAL 10 DAY);

INSERT INTO addresses (customer_id, address_line, city, state, postal_code, country, is_default) VALUES
 (1, '12 Lake View Road',   'Bengaluru', 'Karnataka',   '560001', 'India', 1),
 (1, '4 College Hostel',    'Mysuru',    'Karnataka',   '570001', 'India', 0),
 (2, '88 Marine Lines',     'Mumbai',    'Maharashtra', '400002', 'India', 1),
 (3, '5 Park Street',       'Kolkata',   'West Bengal', '700016', 'India', 1),
 (4, '21 Sector 14',        'Gurugram',  'Haryana',     '122001', 'India', 1);

INSERT INTO categories (category_id, name, parent_category_id) VALUES
 (1, 'Comics',       NULL),
 (2, 'Superhero',    1),
 (3, 'Manga',        1),
 (4, 'Indie',        1),
 (5, 'Collectibles', NULL),
 (6, 'Figures',      5),
 (7, 'Posters',      5);

INSERT INTO suppliers (name, contact_email, phone, address) VALUES
 ('Halftone Press',     'orders@halftone.example',  '080-555-0101', 'Bengaluru, Karnataka'),
 ('Tanuki Imports',     'hello@tanuki.example',     '022-555-0102', 'Mumbai, Maharashtra'),
 ('Brick & Burst Toys', 'supply@brickburst.example','011-555-0103', 'New Delhi, Delhi');

INSERT INTO products (name, description, price, sku, category_id, supplier_id, stock_quantity, created_at) VALUES
 ('Captain Voltage #1',         'A lineman is struck by lightning and wakes up as the city''s loudest hero. 32 pages, full colour.', 299.00, 'CMX-CV-001', 2, 1, 40, NOW() - INTERVAL 200 DAY),
 ('Night Sparrow: Year Zero',   'The origin of the rooftop detective, told across one long rainy night. 48 pages.',                 349.00, 'CMX-NS-000', 2, 1, 25, NOW() - INTERVAL 150 DAY),
 ('The Crimson Imp #5',         'The Imp bets his horns in a card game and loses. Chaos, as usual. 28 pages.',                     249.00, 'CMX-CI-005', 2, 1, 18, NOW() - INTERVAL 5 DAY),
 ('Ronin of Neon City Vol. 1',  'A masterless swordsman takes courier jobs in a city that never turns its signs off. 192 pages.',  499.00, 'MNG-RN-001', 3, 2, 30, NOW() - INTERVAL 120 DAY),
 ('Mecha Chai Club Vol. 3',     'Giant robots, small tea stall. The club enters the inter-college finals. 180 pages.',             449.00, 'MNG-MC-003', 3, 2, 22, NOW() - INTERVAL 3 DAY),
 ('Paper Moons',                'A quiet graphic novel about two sisters running a failing print shop. 120 pages.',                399.00, 'IND-PM-001', 4, 1, 15, NOW() - INTERVAL 80 DAY),
 ('The Quiet Kaiju',            'A sea monster moves into a fishing village and tries very hard not to break anything. 96 pages.', 379.00, 'IND-QK-001', 4, 1, 4,  NOW() - INTERVAL 60 DAY),
 ('Captain Voltage 7" Figure',  'Poseable figure with 14 joints, lightning stand and a spare pair of hands.',                     1499.00, 'FIG-CV-007', 6, 3, 12, NOW() - INTERVAL 45 DAY),
 ('Crimson Imp Vinyl Figure',   'Soft vinyl, 5 inches tall, arms crossed and unimpressed.',                                       1299.00, 'FIG-CI-005', 6, 3, 8,  NOW() - INTERVAL 7 DAY),
 ('Night Sparrow Poster A2',    'Offset print on 200 gsm matte paper. Ships rolled in a tube.',                                    599.00, 'PST-NS-A2',  7, 1, 50, NOW() - INTERVAL 100 DAY),
 ('Sound Effects Poster Set',   'Four A3 prints: POW, BOOM, ZZZZ and OUCH. Frame them together or apart.',                         799.00, 'PST-SFX-04', 7, 1, 35, NOW() - INTERVAL 20 DAY),
 ('Ronin of Neon City Box Set', 'Volumes 1 to 4 in a slipcase with a fold-out city map.',                                         1899.00, 'MNG-RN-BOX', 3, 2, 3,  NOW() - INTERVAL 15 DAY);

-- two generated covers per product (the /cover route draws them from the product row)
INSERT INTO product_images (product_id, image_url)
SELECT product_id, CONCAT('/cover/', product_id, '/1.svg') FROM products;
INSERT INTO product_images (product_id, image_url)
SELECT product_id, CONCAT('/cover/', product_id, '/2.svg') FROM products;

INSERT INTO reviews (product_id, customer_id, rating, comment, review_date) VALUES
 (1,  1, 5, 'Read it twice on the bus. The lightning pages are worth the price alone.', CURDATE() - INTERVAL 40 DAY),
 (1,  2, 4, 'Great art, the story ends a bit suddenly.',                               CURDATE() - INTERVAL 35 DAY),
 (4,  2, 5, 'The city feels alive in every panel. Ordered the box set right after.',   CURDATE() - INTERVAL 25 DAY),
 (4,  3, 5, 'Best manga I picked up this year.',                                       CURDATE() - INTERVAL 20 DAY),
 (8,  2, 4, 'Solid joints and the stand is sturdy. Paint on the boots is a little thin.', CURDATE() - INTERVAL 18 DAY),
 (6,  3, 5, 'Gentle and funny. Made me call my sister.',                               CURDATE() - INTERVAL 12 DAY),
 (10, 1, 4, 'Colours are deep and it arrived without a crease.',                       CURDATE() - INTERVAL 30 DAY),
 (7,  4, 3, 'Sweet idea but short for the price.',                                     CURDATE() - INTERVAL 6 DAY),
 (2,  4, 5, 'Moody and sharp. The rain looks wet.',                                    CURDATE() - INTERVAL 4 DAY);

INSERT INTO wishlist (customer_id, product_id) VALUES (1, 12), (1, 9), (2, 5), (3, 8);

INSERT INTO cart (customer_id) VALUES (1), (2), (3), (4);
INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (1, 5, 1), (4, 3, 2);

INSERT INTO orders (customer_id, shipping_address_id, order_date, status, total_amount) VALUES
 (1, 1, CURDATE() - INTERVAL 45 DAY, 'Delivered',  1197.00),
 (2, 3, CURDATE() - INTERVAL 8 DAY,  'Shipped',    1998.00),
 (3, 4, CURDATE() - INTERVAL 1 DAY,  'Processing', 1899.00);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
 (1, 1,  2, 299.00),
 (1, 10, 1, 599.00),
 (2, 4,  1, 499.00),
 (2, 8,  1, 1499.00),
 (3, 12, 1, 1899.00);

INSERT INTO payments (order_id, payment_method, amount, payment_status, transaction_date) VALUES
 (1, 'UPI',              1197.00, 'Paid',    NOW() - INTERVAL 45 DAY),
 (2, 'Card',             1998.00, 'Paid',    NOW() - INTERVAL 8 DAY),
 (3, 'Cash on Delivery', 1899.00, 'Pending', NOW() - INTERVAL 1 DAY);

INSERT INTO shipments (order_id, carrier, tracking_number, shipped_date, delivered_date, status) VALUES
 (1, 'BlueDart',   'INK10000001', CURDATE() - INTERVAL 44 DAY, CURDATE() - INTERVAL 41 DAY, 'Delivered'),
 (2, 'Delhivery',  'INK10000002', CURDATE() - INTERVAL 7 DAY,  NULL,                   'In transit'),
 (3, 'India Post', 'INK10000003', NULL,                   NULL,                   'Preparing');
