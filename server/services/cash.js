'use strict';
const { repos } = require('../repositories');
const { nowLocal, todayLocal } = require('../lib/time');
const { badRequest, conflict } = require('../lib/errors');

function open({ opening_amount = 0, notes = null }, user = null) {
  const r = repos();
  if (r.cash.openSession()) throw conflict('Ya hay una caja abierta');
  const amount = Math.round(Number(opening_amount));
  if (!(amount >= 0)) throw badRequest('Monto inicial inválido');
  const id = r.cash.insertSession({ opened_at: nowLocal(), opening_amount: amount, notes, opened_by: user?.id ?? null });
  return summary(id, r);
}

/** Resumen de la caja: ventas por forma de pago, movimientos y efectivo esperado. */
function summary(sessionId, r = repos()) {
  const s = sessionId ? r.cash.session(sessionId) : r.cash.openSession();
  if (!s) return null;
  const byMethod = { cash: 0, card: 0, transfer: 0, credit: 0 };
  for (const row of r.cash.paymentsByMethod(s.id)) byMethod[row.method] = row.amount;
  const collections = { cash: 0, card: 0, transfer: 0 };
  for (const row of r.cash.receivablePaymentsByMethod(s.id)) collections[row.method] = row.amount;

  const movements = r.cash.movements(s.id);
  const sum = (type) => movements.filter((m) => m.type === type).reduce((a, m) => a + m.amount, 0);
  const mov = { expense: sum('expense'), withdrawal: sum('withdrawal'), deposit: sum('deposit') };

  const expectedCash = s.opening_amount + byMethod.cash + collections.cash + mov.deposit - mov.expense - mov.withdrawal;
  return { session: s, sales: r.cash.salesTotals(s.id), byMethod, collections, movements: mov,
           movementList: movements, expectedCash };
}

function addMovement({ type, amount, description, category = 'Gastos menores' }, user = null) {
  const r = repos();
  const s = r.cash.openSession();
  if (!s) throw conflict('No hay caja abierta');
  if (!['expense', 'withdrawal', 'deposit'].includes(type)) throw badRequest('Tipo inválido');
  const cents = Math.round(Number(amount));
  if (!(cents > 0)) throw badRequest('Monto inválido');
  if (!description) throw badRequest('Descripción requerida');
  return r.db.transaction(() => {
    let expenseId = null;
    if (type === 'expense') {
      // El gasto de caja también alimenta la contabilidad (estado de resultados)
      expenseId = r.cash.insertExpense({ expense_date: todayLocal(), category, description, amount: cents,
                                         payment_method: 'cash', cash_session_id: s.id, user_id: user?.id ?? null });
    }
    r.cash.insertMovement({ session_id: s.id, type, amount: cents, description, expense_id: expenseId, created_at: nowLocal(), user_id: user?.id ?? null });
    return summary(s.id, r);
  })();
}

/** Cierre y arqueo: compara efectivo contado vs esperado. */
function close({ counted_cash, notes = null }, user = null) {
  const r = repos();
  const sum = summary(null, r);
  if (!sum) throw conflict('No hay caja abierta');
  const counted = Math.round(Number(counted_cash));
  if (!(counted >= 0)) throw badRequest('Monto contado inválido');
  r.cash.closeSession({ id: sum.session.id, closed_at: nowLocal(), expected_cash: sum.expectedCash,
                        counted_cash: counted, difference: counted - sum.expectedCash, notes,
                        closed_by: user?.id ?? null });
  return summary(sum.session.id, r);
}

module.exports = { open, summary, addMovement, close };
