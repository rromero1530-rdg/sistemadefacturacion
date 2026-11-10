'use strict';
const config = require('../config');

// 'sv-SE' produce el formato 'YYYY-MM-DD HH:MM:SS', ideal para SQLite y PostgreSQL.
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

const nowLocal = (d = new Date()) => fmt.format(d).replace('T', ' ');
const todayLocal = (d = new Date()) => nowLocal(d).slice(0, 10);

function addDays(dateStr, days) {
  const d = new Date(dateStr.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(fromDate.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(toDate.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

module.exports = { nowLocal, todayLocal, addDays, daysBetween };
