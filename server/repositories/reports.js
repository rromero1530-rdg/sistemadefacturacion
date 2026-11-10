'use strict';
// Nota PostgreSQL: strftime() -> to_char()/date_trunc() al migrar.
const GROUPS = {
  day: "substr(created_at, 1, 10)",
  week: "strftime('%Y-S%W', created_at)",
  month: "substr(created_at, 1, 7)",
};

module.exports = (db) => ({
  salesByPeriod(from, to, group = 'day') {
    const g = GROUPS[group] || GROUPS.day;
    return db.prepare(`SELECT ${g} AS period, COUNT(*) AS tickets, SUM(total) AS total,
                              SUM(discount_amount) AS discounts, SUM(tax15_amount + tax18_amount) AS taxes,
                              SUM(cost_total) AS cost, SUM(total - tax15_amount - tax18_amount - cost_total) AS gross_profit
                       FROM sales WHERE status = 'completed' AND created_at BETWEEN @from AND @to
                       GROUP BY 1 ORDER BY 1`).all({ from, to });
  },
  topProducts(from, to, limit = 20) {
    return db.prepare(`SELECT p.id AS product_id, p.name, c.name AS category, SUM(i.qty) AS units,
                              SUM(i.line_total) AS revenue,
                              SUM(ROUND(i.line_total / (1 + i.tax_rate / 100.0)) - i.qty * i.unit_cost) AS profit
                       FROM sale_items i
                       JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
                       JOIN product_variants v ON v.id = i.variant_id
                       JOIN products p ON p.id = v.product_id
                       JOIN categories c ON c.id = p.category_id
                       WHERE s.created_at BETWEEN @from AND @to
                       GROUP BY p.id ORDER BY units DESC LIMIT @limit`).all({ from, to, limit });
  },
  profitByCategory(from, to) {
    return db.prepare(`SELECT c.name AS category, SUM(i.qty) AS units,
                              SUM(ROUND(i.line_total / (1 + i.tax_rate / 100.0))) AS net_revenue,
                              SUM(i.qty * i.unit_cost) AS cost
                       FROM sale_items i
                       JOIN sales s ON s.id = i.sale_id AND s.status = 'completed'
                       JOIN product_variants v ON v.id = i.variant_id
                       JOIN products p ON p.id = v.product_id
                       JOIN categories c ON c.id = p.category_id
                       WHERE s.created_at BETWEEN @from AND @to
                       GROUP BY c.id ORDER BY net_revenue DESC`).all({ from, to })
      .map((r) => ({ ...r, profit: r.net_revenue - r.cost,
                     margin_pct: r.net_revenue ? Math.round(((r.net_revenue - r.cost) / r.net_revenue) * 10000) / 100 : 0 }));
  },
  salesSummary(from, to) {
    return db.prepare(`SELECT COUNT(*) AS tickets, COALESCE(SUM(total),0) AS total,
                              COALESCE(SUM(tax15_amount + tax18_amount),0) AS taxes,
                              COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(discount_amount),0) AS discounts
                       FROM sales WHERE status = 'completed' AND created_at BETWEEN @from AND @to`).get({ from, to });
  },
  expensesByCategory(from, to) {
    return db.prepare(`SELECT category, SUM(amount) AS amount FROM expenses
                       WHERE expense_date BETWEEN @from AND @to GROUP BY category ORDER BY amount DESC`)
      .all({ from: from.slice(0, 10), to: to.slice(0, 10) });
  },
  lowStock() {
    return db.prepare(`SELECT id, sku, product_name, size, color, stock, min_stock, category_name
                       FROM v_variants WHERE active = 1 AND stock <= min_stock ORDER BY stock, product_name`).all();
  },
  slowMoving(today, defaultDays) {
    return db.prepare(`SELECT v.id, v.sku, v.product_name, v.size, v.color, v.stock, v.cost, v.category_name,
                              COALESCE(v.last_sold_at, v.last_received_at, v.created_at) AS last_activity,
                              CAST(julianday(@today) - julianday(COALESCE(v.last_sold_at, v.last_received_at, v.created_at)) AS INTEGER) AS idle_days
                       FROM v_variants v JOIN categories c ON c.id = v.category_id
                       WHERE v.active = 1 AND v.stock > 0
                         AND julianday(@today) - julianday(COALESCE(v.last_sold_at, v.last_received_at, v.created_at))
                             >= COALESCE(c.slow_days, @defaultDays)
                       ORDER BY idle_days DESC LIMIT 200`).all({ today, defaultDays });
  },
  overdueReceivables(today) {
    return db.prepare(`SELECT r.id, r.customer_id, c.name AS customer_name, c.phone, r.balance, r.due_date,
                              CAST(julianday(@today) - julianday(r.due_date) AS INTEGER) AS days_overdue
                       FROM receivables r JOIN customers c ON c.id = r.customer_id
                       WHERE r.status = 'open' AND r.balance > 0 AND r.due_date < @today
                       ORDER BY r.due_date`).all({ today });
  },
});
