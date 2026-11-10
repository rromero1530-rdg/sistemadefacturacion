'use strict';
const { repos } = require('../repositories');
const { todayLocal, daysBetween } = require('../lib/time');
const { conflict, badRequest } = require('../lib/errors');

const pad = (n, w) => String(n).padStart(w, '0');
const formatNumber = (cai, n) => `${cai.establishment}-${cai.emission_point}-${cai.doc_type}-${pad(n, 8)}`;

/** Estado fiscal y alertas (modo informal, CAI por vencer, rango por agotarse). */
function status(r = repos()) {
  const mode = r.settings.get('fiscal_mode') || 'informal';
  const cai = r.fiscal.activeCai();
  const warnings = [];
  let info = null;

  if (mode !== 'formal') {
    warnings.push({ level: 'info', code: 'FISCAL_INFORMAL',
      message: 'Modo informal: se emiten comprobantes internos (no son facturas válidas ante la SAR). ' +
               'Al inscribirte (RTN + CAI) activa el modo fiscal en Configuración.' });
  } else if (!cai) {
    warnings.push({ level: 'danger', code: 'NO_CAI', message: 'Modo fiscal activo pero no hay C.A.I. vigente. No se puede facturar.' });
  } else {
    const today = todayLocal();
    const daysLeft = daysBetween(today, cai.deadline);
    const remaining = cai.range_end - cai.next_number + 1;
    const total = cai.range_end - cai.range_start + 1;
    info = { ...cai, days_left: daysLeft, remaining, used_pct: Math.round(((total - remaining) / total) * 100),
             range_text: `${formatNumber(cai, cai.range_start)} al ${formatNumber(cai, cai.range_end)}` };
    if (daysLeft < 0) warnings.push({ level: 'danger', code: 'CAI_EXPIRED', message: `El C.A.I. venció el ${cai.deadline}.` });
    else if (daysLeft <= 30) warnings.push({ level: 'warning', code: 'CAI_DEADLINE', message: `El C.A.I. vence en ${daysLeft} días (${cai.deadline}). Solicita uno nuevo.` });
    if (remaining <= Math.max(50, total * 0.1)) warnings.push({ level: 'warning', code: 'CAI_RANGE', message: `Quedan ${remaining} facturas en el rango autorizado.` });
  }
  return { mode, cai: info, warnings };
}

/** Siguiente número de documento. Debe llamarse DENTRO de la transacción de la venta. */
function nextDocument(r) {
  const mode = r.settings.get('fiscal_mode') || 'informal';
  if (mode !== 'formal') {
    const seq = Number(r.settings.get('internal_seq') || 0) + 1;
    r.settings.set('internal_seq', seq);
    return { doc_kind: 'comprobante', doc_number: `CI-${pad(seq, 8)}`, cai_id: null, cai: null, cai_deadline: null, cai_range_text: null };
  }
  const cai = r.fiscal.activeCai();
  if (!cai) throw conflict('No hay C.A.I. vigente con rango disponible.');
  if (todayLocal() > cai.deadline) throw conflict(`El C.A.I. venció el ${cai.deadline}. No se puede emitir factura.`);
  r.fiscal.consume(cai.id);
  return {
    doc_kind: 'factura',
    doc_number: formatNumber(cai, cai.next_number),
    cai_id: cai.id, cai: cai.cai, cai_deadline: cai.deadline,
    cai_range_text: `${formatNumber(cai, cai.range_start)} al ${formatNumber(cai, cai.range_end)}`,
  };
}

function addCai(input) {
  const c = {
    cai: String(input.cai || '').trim().toUpperCase(),
    establishment: pad(input.establishment ?? 0, 3),
    emission_point: pad(input.emission_point ?? 1, 3),
    doc_type: pad(input.doc_type ?? 1, 2),
    range_start: Number(input.range_start),
    range_end: Number(input.range_end),
    deadline: input.deadline,
  };
  // CAI: 6 grupos hexadecimales separados por guiones (formato SAR)
  if (!/^[0-9A-F]{6}(-[0-9A-F]{6}){4}-[0-9A-F]{2}$/.test(c.cai)) throw badRequest('Formato de C.A.I. inválido (XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XX)');
  if (!(c.range_end >= c.range_start && c.range_start > 0)) throw badRequest('Rango inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.deadline || '')) throw badRequest('Fecha límite inválida (AAAA-MM-DD)');
  return repos().fiscal.insert(c);
}

module.exports = { status, nextDocument, addCai, formatNumber };
