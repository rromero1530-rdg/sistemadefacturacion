'use strict';
const { repos } = require('../repositories');
const { nowLocal } = require('../lib/time');
const { badRequest, notFound, conflict } = require('../lib/errors');

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const text = (v, max = 200) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};

/**
 * Documento de identidad hondureño: RTN = 14 dígitos, DNI = 13 dígitos.
 * Devuelve { rtn, dni } normalizados (solo dígitos) o lanza error si no es válido.
 */
function parseDoc({ rtn, dni, doc } = {}) {
  const out = { rtn: digits(rtn) || null, dni: digits(dni) || null };
  const d = digits(doc);
  if (d) {
    if (d.length === 14) out.rtn = d;
    else if (d.length === 13) out.dni = d;
    else throw badRequest('El RTN debe tener 14 dígitos y el DNI 13');
  }
  if (out.rtn && out.rtn.length !== 14) throw badRequest('El RTN debe tener 14 dígitos');
  if (out.dni && out.dni.length !== 13) throw badRequest('El DNI debe tener 13 dígitos');
  return out;
}

function cleanCustomer(r, input, exceptId = null) {
  const name = text(input.name, 120);
  if (!name) throw badRequest('El nombre es obligatorio');
  const { rtn, dni } = parseDoc(input);
  for (const [field, value, label] of [['rtn', rtn, 'RTN'], ['dni', dni, 'DNI']]) {
    const other = value && r.partners.customerDocTaken(field, value, exceptId);
    if (other) throw conflict(`Ya existe el cliente "${other.name}" con ese ${label}`);
  }
  const limit = Math.round(Number(input.credit_limit || 0));
  const days = Math.trunc(Number(input.credit_days ?? 30));
  if (!(limit >= 0)) throw badRequest('Límite de crédito inválido');
  if (!(days >= 0)) throw badRequest('Días de crédito inválidos');
  return {
    name, rtn, dni, phone: text(input.phone, 40), email: text(input.email, 120), address: text(input.address, 250),
    credit_limit: limit, credit_days: days, notes: text(input.notes, 500),
  };
}

function createCustomer(input) {
  const r = repos();
  return r.partners.insertCustomer(cleanCustomer(r, input));
}

function updateCustomer(id, input) {
  const r = repos();
  if (!r.partners.customer(id)) throw notFound('Cliente no existe');
  r.partners.updateCustomer(id, cleanCustomer(r, input, id));
  return r.partners.customer(id);
}

/**
 * Para facturar con nombre: si ya existe un cliente con ese RTN/DNI se usa; si no, se crea solo.
 * Se llama dentro de la transacción de la venta.
 */
function findOrCreateByDoc(r, { doc, name }) {
  const { rtn, dni } = parseDoc({ doc });
  const key = rtn || dni;
  if (!key) throw badRequest('Escribe el RTN o DNI');
  const found = r.partners.customerByDoc(key);
  if (found) return { customer: found, created: false };
  const cleanName = text(name, 120);
  if (!cleanName) throw badRequest('Escribe el nombre de la persona o empresa');
  const id = r.partners.insertCustomer({ name: cleanName, rtn, dni, phone: null, email: null, address: null,
                                        credit_limit: 0, credit_days: 30, notes: 'Creado automáticamente al facturar' });
  return { customer: r.partners.customer(id), created: true };
}

function customerDetail(id) {
  const r = repos();
  const c = r.partners.customer(id);
  if (!c) throw notFound('Cliente no existe');
  return { ...c, history: r.partners.customerHistory(id), receivables: r.partners.openReceivables(id) };
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
    const open = r.partners.openReceivables(customerId);
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

// ---------------- Proveedores ----------------
function cleanSupplier(input) {
  const name = text(input.name, 120);
  if (!name) throw badRequest('El nombre es obligatorio');
  const rtn = digits(input.rtn) || null;
  if (rtn && rtn.length !== 14) throw badRequest('El RTN debe tener 14 dígitos');
  return {
    name, rtn, contact_name: text(input.contact_name, 120), phone: text(input.phone, 40), email: text(input.email, 120),
    address: text(input.address, 250), country: text(input.country, 60) || 'Honduras', notes: text(input.notes, 500),
  };
}

function createSupplier(input) {
  return repos().partners.insertSupplier(cleanSupplier(input));
}

function updateSupplier(id, input) {
  const r = repos();
  if (!r.partners.supplier(id)) throw notFound('Proveedor no existe');
  r.partners.updateSupplier(id, cleanSupplier(input));
  return r.partners.supplier(id);
}

function supplierDetail(id) {
  const r = repos();
  const s = r.partners.supplier(id);
  if (!s) throw notFound('Proveedor no existe');
  return { ...s, purchases: r.partners.supplierPurchases(id) };
}

module.exports = {
  parseDoc, createCustomer, updateCustomer, findOrCreateByDoc, customerDetail, registerPayment,
  createSupplier, updateSupplier, supplierDetail,
};
