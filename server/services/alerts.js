'use strict';
const { repos } = require('../repositories');
const fiscal = require('./fiscal');
const { slowTiers } = require('./inventory');
const { todayLocal } = require('../lib/time');

/**
 * Agrupa lo que no se vende por niveles. Con niveles 15,30,60:
 *   "15 a 29 días", "30 a 59 días", "60 días o más".
 */
function groupSlow(rows, tiers) {
  return tiers.map((from, i) => {
    const to = tiers[i + 1];
    return {
      from, to: to ? to - 1 : null,
      label: to ? `${from} a ${to - 1} días` : `${from} días o más`,
      items: rows.filter((v) => v.idle_days >= from && (!to || v.idle_days < to)),
    };
  });
}

/** Alertas inteligentes para el tablero principal y la campana del POS. */
function getAlerts() {
  const r = repos();
  const today = todayLocal();
  const tiers = slowTiers(r);
  const lowStock = r.reports.lowStock();
  const overdue = r.reports.overdueReceivables(today);
  const slowMoving = r.reports.slowMoving(today, tiers[0]);
  const fiscalStatus = fiscal.status(r);
  return {
    counts: { lowStock: lowStock.length, overdue: overdue.length, slowMoving: slowMoving.length,
              fiscal: fiscalStatus.warnings.filter((w) => w.level !== 'info').length },
    lowStock, overdue, slowMoving, slowDays: tiers[0], slowTiers: tiers, slowGroups: groupSlow(slowMoving, tiers),
    fiscal: fiscalStatus,
  };
}

module.exports = { getAlerts, groupSlow };
