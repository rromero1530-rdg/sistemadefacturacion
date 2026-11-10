'use strict';
const { repos } = require('../repositories');
const fiscal = require('./fiscal');
const { todayLocal } = require('../lib/time');

/** Alertas inteligentes para el tablero principal y la campana del POS. */
function getAlerts() {
  const r = repos();
  const today = todayLocal();
  const slowDays = Number(r.settings.get('slow_moving_days') || 75);
  const lowStock = r.reports.lowStock();
  const overdue = r.reports.overdueReceivables(today);
  const slowMoving = r.reports.slowMoving(today, slowDays);
  const fiscalStatus = fiscal.status(r);
  return {
    counts: { lowStock: lowStock.length, overdue: overdue.length, slowMoving: slowMoving.length,
              fiscal: fiscalStatus.warnings.filter((w) => w.level !== 'info').length },
    lowStock, overdue, slowMoving, slowDays, fiscal: fiscalStatus,
  };
}

module.exports = { getAlerts };
