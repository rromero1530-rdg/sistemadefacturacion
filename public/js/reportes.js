// Zoe Closet - Reportes: indicadores, gráficas y tablas del período elegido.
const $ = (s) => document.querySelector(s);
const METHOD = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito' };
const REASON = { sin_stock: 'Sin stock', no_manejamos: 'No lo manejamos', talla: 'Talla', color: 'Color', precio: 'Precio', otro: 'Otro' };
let data = null;

// ---------------- Fechas ----------------
const iso = (d) => d.toLocaleDateString('sv-SE');
const today = () => new Date();
const PRESETS = {
  hoy: ['Hoy', () => [today(), today()]],
  semana: ['7 días', () => { const t = today(); const f = new Date(t); f.setDate(t.getDate() - 6); return [f, t]; }],
  mes: ['Este mes', () => { const t = today(); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; }],
  pasado: ['Mes pasado', () => { const t = today(); return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)]; }],
  anio: ['Este año', () => { const t = today(); return [new Date(t.getFullYear(), 0, 1), t]; }],
};
let preset = 'mes';

function renderPresets() {
  $('#presets').innerHTML = Object.entries(PRESETS).map(([k, [label]]) => `<button data-p="${k}" class="px-3 py-1.5 rounded-lg ${preset === k
    ? 'bg-brand-600 text-white' : 'hover:bg-slate-100'}">${label}</button>`).join('');
  $('#presets').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    preset = b.dataset.p;
    const [f, t] = PRESETS[preset][1]();
    $('#from').value = iso(f); $('#to').value = iso(t);
    renderPresets(); load();
  }));
}

// ---------------- Componentes ----------------
const kpi = (label, value, sub = '') => `<div class="bg-white rounded-xl border border-slate-200 p-4">
  <div class="text-xs text-slate-500">${label}</div><div class="text-xl font-semibold mt-1">${value}</div>
  ${sub ? `<div class="text-xs text-slate-500 mt-0.5">${sub}</div>` : ''}</div>`;
const empty = (msg = 'Sin datos en este período.') => `<p class="text-sm text-slate-400 py-6 text-center">${msg}</p>`;
const table = (cols, rows) => `<div class="overflow-x-auto"><table class="w-full text-sm">
  <thead class="text-xs text-slate-500 uppercase tracking-wide"><tr class="text-left">${cols.map(([l, r]) => `<th class="py-1.5 pr-2 ${r ? 'text-right' : ''}">${l}</th>`).join('')}</tr></thead>
  <tbody class="divide-y divide-slate-100">${rows.map((r) => `<tr>${r.map((c, i) => `<td class="py-1.5 pr-2 ${cols[i][1] ? 'text-right whitespace-nowrap' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

// Tooltip compartido para las barras
const tip = $('#tip');
function bindTips(scope) {
  scope.querySelectorAll('[data-tip]').forEach((el) => {
    const show = (x, y) => { tip.innerHTML = el.dataset.tip; tip.classList.remove('hidden');
      tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (y - tip.offsetHeight - 10) + 'px'; };
    el.addEventListener('mousemove', (e) => show(e.clientX, e.clientY));
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(r.left, r.top); });
    el.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    el.addEventListener('blur', () => tip.classList.add('hidden'));
  });
}

/** Columnas verticales de una sola serie; el área sensible es la columna completa, no solo la barra. */
function columns(el, points, { height = 200 } = {}) {
  if (!points.length || !points.some((p) => p.value > 0)) { el.innerHTML = empty(); return; }
  const max = Math.max(...points.map((p) => p.value));
  const every = Math.ceil(points.length / 12);   // no amontonar etiquetas
  el.innerHTML = `
    <div class="flex items-end gap-[2px] border-b border-slate-200" style="height:${height}px">
      ${points.map((p) => `<div class="flex-1 h-full flex items-end cursor-default" tabindex="0" data-tip="${esc(p.tip)}" aria-label="${esc(p.label)}: ${esc(L(p.value))}">
        <div class="bar w-full" style="height:${Math.max(p.value > 0 ? 2 : 0, (p.value / max) * 100)}%"></div></div>`).join('')}
    </div>
    <div class="flex gap-[2px] mt-1 text-[10px] text-slate-500">
      ${points.map((p, i) => `<div class="flex-1 text-center truncate">${i % every === 0 ? esc(p.short) : ''}</div>`).join('')}
    </div>
    <div class="text-[11px] text-slate-500 mt-1">Máximo: ${L(max)}</div>`;
  bindTips(el);
}

/** Barras horizontales con etiqueta y valor escritos (no depende del color). */
function hbars(rows, fmt = L) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<ul class="space-y-2 text-sm">${rows.map((r) => `<li>
    <div class="flex justify-between gap-2"><span class="truncate">${esc(r.label)}</span><span class="font-medium whitespace-nowrap">${fmt(r.value)}</span></div>
    <div class="h-2 mt-1 bg-slate-100 rounded"><div class="hbar h-2" style="width:${(r.value / max) * 100}%"></div></div>
    ${r.sub ? `<div class="text-[11px] text-slate-500 mt-0.5">${r.sub}</div>` : ''}</li>`).join('')}</ul>`;
}

// ---------------- Carga y dibujo ----------------
async function load() {
  const from = $('#from').value, to = $('#to').value;
  if (!from || !to) return;
  data = await api.get(`/reports/dashboard?from=${from}&to=${to}`);
  $('#range-label').textContent = `Del ${from} al ${to} · Montos con ISV, salvo donde dice "sin ISV".`;
  render();
}

function render() {
  const s = data.summary;
  $('#kpis').innerHTML =
    kpi('Ventas', L(s.total), `${s.tickets} ventas · ${s.units} prendas`) +
    kpi('Venta promedio', L(s.avgTicket), 'por cliente') +
    kpi('Utilidad bruta', L(s.grossProfit), `Margen ${s.marginPct} % sobre venta sin ISV`) +
    kpi('Costo de lo vendido', L(s.cost)) +
    kpi('Descuentos dados', L(s.discounts), `Manuales: ${L(s.manualDiscounts)}`) +
    kpi('ISV cobrado', L(s.taxes), 'a declarar a la SAR');

  // Ventas por período
  const label = (p) => (p.length === 10 ? p.slice(8) + '/' + p.slice(5, 7) : p.length === 7 ? p.slice(5) + '/' + p.slice(0, 4) : p.replace('-S', ' sem '));
  const g = data.byPeriod.length && data.byPeriod[0].period.length === 10 ? 'día' : data.byPeriod[0]?.period.length === 7 ? 'mes' : 'semana';
  $('#period-title').textContent = `Ventas por ${g}`;
  columns($('#chart-period'), data.byPeriod.map((p) => ({
    value: p.total, label: p.period, short: label(p.period),
    tip: `<b>${label(p.period)}</b><br>${L(p.total)} · ${p.tickets} ventas<br>Utilidad ${L(p.gross_profit)}`,
  })));

  // Formas de pago
  $('#pay').innerHTML = data.paymentMethods.length ? hbars(data.paymentMethods.map((m) => ({
    label: METHOD[m.method] || m.method, value: m.amount, sub: `${m.tickets} ventas`,
  }))) : empty();

  // Más vendidos
  $('#top').innerHTML = data.topProducts.length ? table([['#'], ['Producto'], ['Unidades', 1], ['Venta', 1], ['Utilidad', 1]],
    data.topProducts.map((p, i) => [i + 1, `${esc(p.name)}<div class="text-[11px] text-slate-400">${esc(p.category)}</div>`, p.units, L(p.revenue), L(p.profit)])) : empty();

  // Categorías
  $('#cat').innerHTML = data.profitByCategory.length ? table([['Categoría'], ['Unidades', 1], ['Venta sin ISV', 1], ['Utilidad', 1], ['Margen', 1]],
    data.profitByCategory.map((c) => [esc(c.category), c.units, L(c.net_revenue), L(c.profit), c.margin_pct + ' %'])) : empty();

  // Estado de resultados
  const i = data.income;
  const line = (a, b, cls = '') => `<div class="flex justify-between py-1 ${cls}"><span>${a}</span><span class="whitespace-nowrap">${b}</span></div>`;
  $('#income').innerHTML = `<div class="text-sm">
    ${line('Ventas con ISV', L(i.salesWithTax))}${line('− ISV cobrado', L(i.taxCollected), 'text-slate-500')}
    ${line('Ingresos (sin ISV)', L(i.netRevenue), 'font-medium border-t')}${line('− Costo de ventas', L(i.costOfSales), 'text-slate-500')}
    ${line('Utilidad bruta', L(i.grossProfit), 'font-medium border-t')}
    ${i.expenses.map((e) => line('− ' + esc(e.category), L(e.amount), 'text-slate-500')).join('') || line('− Gastos', L(0), 'text-slate-500')}
    ${line('Utilidad neta', L(i.netProfit), `font-semibold border-t text-base ${i.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`)}</div>
    <p class="text-[11px] text-slate-400 mt-2">Gastos = los registrados en caja (gastos menores).</p>`;

  // Por hora (8 a 20 h siempre visibles)
  const byH = new Map(data.byHour.map((h) => [h.hour, h]));
  const hours = [...new Set([...Array.from({ length: 13 }, (_, k) => k + 8), ...byH.keys()])].sort((a, b) => a - b);
  columns($('#chart-hour'), hours.map((h) => ({
    value: byH.get(h)?.total || 0, label: `${h}:00`, short: String(h),
    tip: `<b>${h}:00 a ${h}:59</b><br>${L(byH.get(h)?.total || 0)} · ${byH.get(h)?.tickets || 0} ventas`,
  })), { height: 140 });

  // Vendedores
  $('#users').innerHTML = data.byUser.length ? hbars(data.byUser.map((u) => ({
    label: u.user_name, value: u.total, sub: `${u.tickets} ventas${u.manual_discounts ? ' · descuentos ' + L(u.manual_discounts) : ''}`,
  }))) : empty();

  // Descuentos manuales
  $('#disc').innerHTML = data.discounts.length ? table([['Fecha'], ['Documento'], ['Vendedor'], ['Motivo'], ['Descuento', 1]],
    data.discounts.map((d) => [esc(d.created_at.slice(0, 16)), `<span class="font-mono text-xs">${esc(d.doc_number)}</span>`, esc(d.user_name), esc(d.reason || '—'), L(d.amount)]))
    : empty('No se dieron descuentos manuales.');

  // Faltantes
  $('#demand').innerHTML = data.unmetDemand.length ? table([['Lo que buscaban'], ['Motivo'], ['Veces', 1], ['Última vez']],
    data.unmetDemand.map((d) => [esc(d.item), REASON[d.reason] || d.reason, d.requests, esc(String(d.last_at).slice(0, 10))]))
    : empty('No se registraron faltantes.');
  icons();
}

function exportCsv(which) {
  const f = $('#from').value, t = $('#to').value;
  const sets = {
    period: ['ventas-por-periodo', ['Período', 'Ventas', 'Cantidad de ventas', 'Descuentos', 'ISV', 'Costo', 'Utilidad'],
      data.byPeriod.map((p) => [p.period, csvMoney(p.total), p.tickets, csvMoney(p.discounts), csvMoney(p.taxes), csvMoney(p.cost), csvMoney(p.gross_profit)])],
    top: ['mas-vendidos', ['Producto', 'Categoría', 'Unidades', 'Venta', 'Utilidad'],
      data.topProducts.map((p) => [p.name, p.category, p.units, csvMoney(p.revenue), csvMoney(p.profit)])],
    cat: ['rentabilidad-categorias', ['Categoría', 'Unidades', 'Venta sin ISV', 'Costo', 'Utilidad', 'Margen %'],
      data.profitByCategory.map((c) => [c.category, c.units, csvMoney(c.net_revenue), csvMoney(c.cost), csvMoney(c.profit), c.margin_pct])],
    disc: ['descuentos-manuales', ['Fecha', 'Documento', 'Cliente', 'Vendedor', 'Motivo', 'Descuento', 'Total venta'],
      data.discounts.map((d) => [d.created_at, d.doc_number, d.customer_name, d.user_name, d.reason, csvMoney(d.amount), csvMoney(d.total)])],
  };
  const [name, headers, rows] = sets[which];
  downloadCsv(`${name}_${f}_${t}.csv`, headers, rows);
}

(async () => {
  if (!(await renderLayout())) return;
  const [f, t] = PRESETS[preset][1]();
  $('#from').value = iso(f); $('#to').value = iso(t);
  renderPresets();
  const custom = () => { preset = null; renderPresets(); load(); };
  $('#from').onchange = custom; $('#to').onchange = custom;
  $('#btn-print').onclick = () => window.print();
  document.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => exportCsv(b.dataset.csv)));
  await load();
  icons();
})();
