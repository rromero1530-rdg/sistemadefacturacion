'use strict';
const { repos } = require('../repositories');
const { nowLocal } = require('../lib/time');
const { badRequest, notFound, conflict } = require('../lib/errors');

function createCustomer(input) {
  if (!input.name) throw badRequest('Nombre requerido');
  if (input.rtn && !/^\d{14}$/.test(String(input.rtn).replace(/\D/g, ''))) throw badRequest('El RTN debe tener 14 dígitos');
  return repos().partners.insertCustomer({
    name: input.name.trim(), rtn: input.rtn ? String(input.rtn).replace(/\D/g, '') : null, dni: input.dni || null,
    phone: input.phone || null, email: input.email || null, address: input.address || null,
    credit_limit: Math.round(Number(input.credit_limit || 0)), credit_days: Number(input.credit_days || 30),
    notes: input.notes || null,
  });
}

function customerDetail(id) {
  const r = repos();
  const c = r.partners.customer(id);
  if (!c) throw notFound('Cliente no existe');
  return { ...c, history: r.partners.customerHistory(id),
           receivables: r.db.prepare("SELECT * FROM receivables WHERE customer_id = ? AND status = 'open' ORDER BY due_date").all(id) };
}

/** Abono de cliente: se aplica a las cuentas más antiguas primero (FIFO). */
function registerPayment(customerId, { amount, method = 'cash', reference = null }) {
  const r = repos();
  let left = Math.round(Number(amount));
  if (!(left > 0)) throw badRequest('Monto inválido');
  if (!['cash', 'card', 'transfer'].includes(method)) throw badRequest('Forma de pago inválida');
  const session = r.cash.openSession();
  if (method === 'cash' && !session) throw conflict('Abre la caja para recibir abonos en efectivo');
  return r.db.transaction(() => {
    const open = r.db.prepare("SELECT * FROM receivables WHERE customer_id = ? AND status = 'open' ORDER BY due_date, id").all(customerId);
    const debt = open.reduce((a, x) => a + x.balance, 0);
    if (left > debt) throw badRequest(`El abono excede la deuda (${debt})`);
    const now = nowLocal();
    for (const rec of open) {
      if (!left) break;
      const pay = Math.min(left, rec.balance);
      r.db.prepare(`INSERT INTO receivable_payments (receivable_id, amount, method, cash_session_id, reference, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(rec.id, pay, method, session?.id ?? null, reference, now);
      r.db.prepare(`UPDATE receivables SET balance = balance - ?, status = CASE WHEN balance - ? = 0 THEN 'paid' ELSE status END
                    WHERE id = ?`).run(pay, pay, rec.id);
      left -= pay;
    }
    return customerDetail(customerId);
  })();
}

function createSupplier(input) {
  if (!input.name) throw badRequest('Nombre requerido');
  return repos().partners.insertSupplier({
    name: input.name.trim(), rtn: input.rtn || null, contact_name: input.contact_name || null, phone: input.phone || null,
    email: input.email || null, address: input.address || null, country: input.country || 'Honduras', notes: input.notes || null,
  });
}

module.exports = { createCustomer, customerDetail, registerPayment, createSupplier };
