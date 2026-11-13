// Ready-made reports for the Database tab: [title, what it shows, SQL].
// Each one runs in the read-only SQL console.
export const REPORTS: [string, string, string][] = [
 [
  "Best sellers",
  "JOIN + GROUP BY + ORDER BY",
  "SELECT p.name, SUM(oi.quantity) AS units_sold,\n       SUM(oi.quantity * oi.unit_price) AS revenue\n  FROM order_items oi\n  JOIN products p ON p.product_id = oi.product_id\n GROUP BY p.product_id, p.name\n ORDER BY units_sold DESC, revenue DESC"
 ],
 [
  "Price rank in each category",
  "window function: RANK() OVER (PARTITION BY)",
  "SELECT c.name AS category, p.name, p.price,\n       RANK() OVER (PARTITION BY p.category_id ORDER BY p.price DESC) AS price_rank,\n       ROUND(AVG(p.price) OVER (PARTITION BY p.category_id), 2) AS category_avg\n  FROM products p\n  JOIN categories c ON c.category_id = p.category_id\n ORDER BY c.name, price_rank"
 ],
 [
  "Running sales total",
  "window function: SUM() OVER (ORDER BY)",
  "SELECT order_id, order_date, total_amount,\n       SUM(total_amount) OVER (ORDER BY order_date, order_id) AS running_total\n  FROM orders\n ORDER BY order_date, order_id"
 ],
 [
  "Revenue by category",
  "3-table JOIN + COUNT(DISTINCT)",
  "SELECT c.name AS category, COUNT(DISTINCT oi.order_id) AS orders,\n       SUM(oi.quantity * oi.unit_price) AS revenue\n  FROM order_items oi\n  JOIN products p ON p.product_id = oi.product_id\n  JOIN categories c ON c.category_id = p.category_id\n GROUP BY c.category_id, c.name\n ORDER BY revenue DESC"
 ],
 [
  "Well-reviewed products",
  "LEFT JOIN + GROUP BY + HAVING",
  "SELECT p.name, COUNT(r.review_id) AS reviews,\n       ROUND(AVG(r.rating), 2) AS avg_rating\n  FROM products p\n  LEFT JOIN reviews r ON r.product_id = p.product_id\n GROUP BY p.product_id, p.name\nHAVING COUNT(r.review_id) > 0\n ORDER BY avg_rating DESC"
 ],
 [
  "Customer spend",
  "view: v_customer_spend",
  "SELECT customer, orders, total_spent\n  FROM v_customer_spend\n ORDER BY total_spent DESC"
 ],
 [
  "Loyalty tiers",
  "stored procedure with a cursor",
  "CALL sp_customer_tiers()"
 ],
 [
  "Low stock alert",
  "view: v_low_stock",
  "SELECT name, sku, stock_quantity, supplier, contact_email\n  FROM v_low_stock\n ORDER BY stock_quantity"
 ],
 [
  "Order totals check",
  "stored function: fn_order_total",
  "SELECT order_id, total_amount AS stored_total,\n       fn_order_total(order_id) AS from_lines,\n       total_amount = fn_order_total(order_id) AS matches\n  FROM orders"
 ],
 [
  "Category tree",
  "recursive CTE on the self reference",
  "WITH RECURSIVE tree (category_id, path, depth) AS (\n    SELECT category_id, CAST(name AS CHAR(300)), 0\n      FROM categories WHERE parent_category_id IS NULL\n    UNION ALL\n    SELECT c.category_id, CONCAT(tree.path, ' > ', c.name), tree.depth + 1\n      FROM categories c JOIN tree ON c.parent_category_id = tree.category_id\n)\nSELECT category_id, path, depth FROM tree ORDER BY path"
 ],
 [
  "Never ordered",
  "NOT EXISTS correlated subquery",
  "SELECT p.name, p.price\n  FROM products p\n WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.product_id)\n ORDER BY p.name"
 ],
 [
  "Pricier than average",
  "scalar subquery",
  "SELECT name, price\n  FROM products\n WHERE price > (SELECT AVG(price) FROM products)\n ORDER BY price DESC"
 ],
 [
  "Everyone we email",
  "UNION",
  "SELECT 'customer' AS who, email FROM customers\nUNION\nSELECT 'supplier', contact_email FROM suppliers\nORDER BY who, email"
 ],
 [
  "Order tracker",
  "view: v_order_summary + JOIN",
  "SELECT v.order_id, cu.first_name AS customer, v.status,\n       v.payment_method, v.payment_status, v.carrier, v.tracking_number\n  FROM v_order_summary v\n  JOIN customers cu ON cu.customer_id = v.customer_id\n ORDER BY v.order_id DESC"
 ]
];
