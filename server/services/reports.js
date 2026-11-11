'use strict';
const { repos } = require('../repositories');
const { todayLocal, addDays } = require('../lib/time');

function range(q) {
  const to = q.to || todayLocal();
  const from = q.from || addDays(to, -30);
  return { from: `${from.slice(0, 10)} 00:00:00`, to: `${to.slice(0, 10)} 23:59:59` };
}

/** Estado de resultados básico (todo sin ISV: el ISV cobrado es un pasivo con la SAR). */
function incomeStatement(q, r = repos()) {
  const { from, to } = range(q);
  const s = r.reports.salesSummary(from, to);
  const expenses = r.reports.expensesByCategory(from, to);
  const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const netRevenue = s.total - s.taxes;
  const grossProfit = netRevenue - s.cost;
  return { from, to, tickets: s.tickets, salesWithTax: s.total, taxCollected: s.taxes, discounts: s.discounts,
           netRevenue, costOfSales: s.cost, grossProfit, expenses, totalExpenses, netProfit: grossProfit - totalExpenses };
}

/** Indicadores principales del período. */
function summary(q, r = repos()) {
  const { from, to } = range(q);
  const t = r.reports.periodTotals(from, to);
  const netRevenue = t.total - t.taxes;
  return {
    from, to, tickets: t.tickets, units: t.units, total: t.total, taxes: t.taxes, discounts: t.discounts,
    manualDiscounts: t.manual_discounts, cost: t.cost, netRevenue, grossProfit: netRevenue - t.cost,
    marginPct: netRevenue ? Math.round(((netRevenue - t.cost) / netRevenue) * 1000) / 10 : 0,
    avgTicket: t.tickets ? Math.round(t.total / t.tickets) : 0,
  };
}
const paymentMethods = (q) => { const { from, to } = range(q); return repos().reports.paymentMethods(from, to); };
const byUser = (q) => { const { from, to } = range(q); return repos().reports.byUser(from, to); };
const discounts = (q) => { const { from, to } = range(q); return repos().reports.manualDiscounts(from, to); };
const byHour = (q) => { const { from, to } = range(q); return repos().reports.byHour(from, to); };

const sales = (q) => { const { from, to } = range(q); return repos().reports.salesByPeriod(from, to, q.group); };
const topProducts = (q) => { const { from, to } = range(q); return repos().reports.topProducts(from, to, Number(q.limit || 20)); };
const profitByCategory = (q) => { const { from, to } = range(q); return repos().reports.profitByCategory(from, to); };
const unmetDemand = (q) => repos().demand.summary(range(q).from);

module.exports = { incomeStatement, summary, paymentMethods, byUser, discounts, byHour, sales, topProducts,
                   profitByCategory, unmetDemand, range };
