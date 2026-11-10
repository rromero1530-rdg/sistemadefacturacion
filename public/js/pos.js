// =====================================================================
// Pixel POS - Punto de venta
// El servidor es la fuente de verdad de precios, promociones e ISV:
// el carrito solo guarda {variant_id, qty} y pide /sales/quote en cada cambio.
// =====================================================================
const $ = (s) => document.querySelector(s);

const state = {
  cart: new Map(),          // variant_id -> qty
  info: new Map(),          // variant_id -> datos del producto (para mostrar stock)
  quote: null,
  method: 'cash',
  categoryId: null,
  categories: [],
  cash: null,
  settings: {},
};

const METHOD_LABEL = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito' };

// ---------------- Arranque ----------------
async function init() {
  document.querySelectorAll('.pm').forEach((b) => {
    b.className = 'pm text-sm py-2 rounded-md border border-slate-200 bg-white hover:border-brand-500';
    b.onclick = () => setMethod(b.dataset.method);
  });
  setMethod('cash');

  const [settings, categories, customers] = await Promise.all([
    api.get('/settings'), api.get('/categories'), api.get('/customers'),
  ]);
  state.settings = settings;
  state.categories = categories;
  $('#biz-name').textContent = settings.business_name || 'Mi tienda';
  $('#customer').insertAdjacentHTML('beforeend',
    customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.rtn ? ' · RTN ' + esc(c.rtn) : ''}</option>`).join(''));
  renderCategories();
  bindEvents();
  await Promise.all([search(''), refreshCash(), refreshAlerts(), refreshFiscal()]);
  renderCart();
  icons();
  setInterval(refreshAlerts, 5 * 60 * 1000);
}

function bindEvents() {
  let t;
  $('#search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 180); });
  $('#search').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    await scanOrSearch(e.target.value.trim());
  });
  $('#tendered').addEventListener('input', updateChange);
  $('#btn-pay').onclick = checkout;
  $('#btn-clear').onclick = () => { if (state.cart.size && confirm('¿Vaciar carrito?')) { state.cart.clear(); renderCart(); } };
  $('#btn-demand').onclick = openDemandModal;
  $('#btn-cash').onclick = openCashModal;
  $('#btn-alerts').onclick = openAlertsModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); openDemandModal(); }
    else if (e.key === 'F4') { e.preventDefault(); focusSearch(); }
    else if (e.key === 'F9') { e.preventDefault(); checkout(); }
    else if (e.key === 'Escape') closeModal();
  });
}

const focusSearch = () => { $('#search').focus(); $('#search').select(); };

// ---------------- Catálogo ----------------
function renderCategories() {
  const chip = (id, name) => {
    const active = state.categoryId === id;
    return `<button data-cat="${id ?? ''}" class="px-3 py-1.5 rounded-full text-sm border ${active
      ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 hover:border-brand-500'}">${esc(name)}</button>`;
  };
  $('#categories').innerHTML = chip(null, 'Todo') + state.categories.map((c) => chip(c.id, c.name)).join('');
  $('#categories').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    state.categoryId = b.dataset.cat ? Number(b.dataset.cat) : null;
    renderCategories();
    search($('#search').value);
  }));
}

async function search(q) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (state.categoryId) params.set('category_id', state.categoryId);
  const items = await api.get('/products?' + params);
  items.forEach((v) => state.info.set(v.id, v));
  renderResults(items);
  return items;
}

function renderResults(items) {
  if (!items.length) {
    $('#results').innerHTML = `<div class="col-span-full text-center text-slate-500 py-16">
      <p class="mb-3">Sin resultados.</p>
      <button class="text-amber-700 underline" onclick="openDemandModal($('#search').value)">Registrar como faltante</button></div>`;
    return;
  }
  $('#results').innerHTML = items.map((v) => {
    const out = v.stock <= 0;
    const low = !out && v.stock <= v.min_stock;
    return `<button data-id="${v.id}" class="text-left bg-white rounded-xl border border-slate-200 p-3 hover:border-brand-500 hover:shadow-sm transition ${out ? 'opacity-60' : ''}">
      <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(v.category_name)}</div>
      <div class="font-medium leading-snug line-clamp-2">${esc(v.product_name)}</div>
      <div class="text-xs text-slate-500 mt-0.5">${esc([v.size, v.color].filter(Boolean).join(' · '))}</div>
      <div class="flex items-end justify-between mt-2">
        <span class="font-semibold">${L(v.price)}</span>
        <span class="text-[11px] px-1.5 py-0.5 rounded ${out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
          ${out ? 'Agotado' : v.stock + ' disp.'}</span>
      </div></button>`;
  }).join('');
  $('#results').querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => addToCart(Number(b.dataset.id))));
}

/** Enter en el buscador: primero intenta código exacto (lector de barras), luego búsqueda. */
async function scanOrSearch(code) {
  if (!code) return;
  try {
    const v = await api.get('/products/code/' + encodeURIComponent(code));
    state.info.set(v.id, v);
    addToCart(v.id);
    $('#search').value = '';
    return;
  } catch { /* no es código: búsqueda normal */ }
  const items = await search(code);
  if (items.length === 1) { addToCart(items[0].id); $('#search').value = ''; }
  else if (!items.length) toast('No encontrado. Puedes registrarlo como faltante (F2).', 'warn');
}

// ---------------- Carrito ----------------
function addToCart(id, delta = 1) {
  const v = state.info.get(id);
  const next = (state.cart.get(id) || 0) + delta;
  if (delta > 0 && v && next > v.stock && state.settings.allow_negative_stock !== '1') {
    toast(`Stock insuficiente: ${v.product_name} (${v.stock} disp.)`, 'warn');
    if (v.stock <= 0 && confirm('Producto agotado. ¿Registrar como demanda insatisfecha?')) {
      openDemandModal(`${v.product_name} ${[v.size, v.color].filter(Boolean).join(' ')}`, { variant_id: v.id, category_id: v.category_id, reason: 'sin_stock' });
    }
    return;
  }
  if (next <= 0) state.cart.delete(id); else state.cart.set(id, next);
  renderCart();
  focusSearch();
}

let quoteSeq = 0;
async function renderCart() {
  const seq = ++quoteSeq;
  const items = [...state.cart].map(([variant_id, qty]) => ({ variant_id, qty }));
  const q = items.length ? await api.post('/sales/quote', { items }).catch((e) => { toast(e.message, 'error'); return null; }) : null;
  if (seq !== quoteSeq) return; // respuesta vieja
  state.quote = q;

  if (!q || !q.lines.length) {
    $('#cart').innerHTML = `<div class="h-full grid place-items-center text-slate-400 text-sm p-10 text-center">
      <div><i data-lucide="shopping-cart" class="mx-auto mb-2" style="width:32px;height:32px"></i>Escanea o selecciona productos</div></div>`;
  } else {
    $('#cart').innerHTML = q.lines.map((l) => `
      <div class="px-4 py-3 flex gap-3 items-start">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${esc(l.description)}</div>
          <div class="text-xs text-slate-500">${L(l.unit_price)} c/u · ${esc(l.sku)}</div>
          ${l.discount ? `<div class="text-xs text-emerald-700">Promoción −${L(l.discount)}</div>` : ''}
        </div>
        <div class="flex items-center gap-1">
          <button class="qty w-7 h-7 rounded border border-slate-200 hover:bg-slate-50" data-id="${l.variant_id}" data-d="-1">−</button>
          <span class="w-6 text-center text-sm">${l.qty}</span>
          <button class="qty w-7 h-7 rounded border border-slate-200 hover:bg-slate-50" data-id="${l.variant_id}" data-d="1">+</button>
        </div>
        <div class="w-24 text-right text-sm font-semibold">${L(l.line_total)}</div>
      </div>`).join('');
    $('#cart').querySelectorAll('.qty').forEach((b) => (b.onclick = () => addToCart(Number(b.dataset.id), Number(b.dataset.d))));
  }

  const t = q || {};
  $('#t-gross').textContent = L(t.gross);
  $('#t-discount').textContent = '−' + L(t.discount);
  $('#t-taxable15').textContent = L(t.taxable15);
  $('#t-tax15').textContent = L(t.tax15);
  $('#t-total').textContent = L(t.total);
  $('#promos').innerHTML = (t.promotions || []).map((p) =>
    `<div class="text-xs bg-emerald-50 text-emerald-800 rounded-md px-2 py-1 flex items-center gap-1.5">
       <i data-lucide="sparkles"></i>${esc(p.name)} ${p.times > 1 ? '×' + p.times : ''} · −${L(p.discount)}</div>`).join('');
  $('#btn-pay').disabled = !q?.lines.length;
  updateChange();
  icons();
}

function setMethod(m) {
  state.method = m;
  document.querySelectorAll('.pm').forEach((b) => {
    const on = b.dataset.method === m;
    b.classList.toggle('bg-brand-600', on); b.classList.toggle('text-white', on);
    b.classList.toggle('border-brand-600', on); b.classList.toggle('bg-white', !on);
  });
  $('#cash-box').classList.toggle('hidden', m !== 'cash');
  $('#pay-ref').classList.toggle('hidden', !(m === 'card' || m === 'transfer'));
}

function updateChange() {
  const total = state.quote?.total || 0;
  const tendered = toCents($('#tendered').value);
  const change = tendered - total;
  $('#change').textContent = L(Math.max(change, 0));
  $('#change').classList.toggle('text-red-600', tendered > 0 && change < 0);
}

// ---------------- Cobro ----------------
async function checkout() {
  const q = state.quote;
  if (!q?.lines.length) return;
  if (!state.cash) { toast('Abre la caja antes de vender', 'warn'); return openCashModal(); }

  const customerId = Number($('#customer').value) || null;
  const payment = { method: state.method, amount: q.total };
  if (state.method === 'cash') {
    const tendered = $('#tendered').value ? toCents($('#tendered').value) : q.total;
    if (tendered < q.total) return toast('El efectivo recibido es menor al total', 'error');
    payment.tendered = tendered;
  } else if (state.method === 'credit' && !customerId) {
    return toast('Selecciona un cliente para venta al crédito', 'error');
  } else {
    payment.reference = $('#pay-ref').value || null;
  }

  $('#btn-pay').disabled = true;
  try {
    const sale = await api.post('/sales', {
      items: q.lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty })),
      customer_id: customerId,
      payments: [payment],
    });
    state.cart.clear();
    $('#tendered').value = ''; $('#pay-ref').value = ''; $('#customer').value = '';
    setMethod('cash');
    await renderCart();
    search($('#search').value);
    refreshCash();
    showReceipt(sale);
  } catch (e) {
    toast(e.message + (e.details ? ' · ' + JSON.stringify(e.details) : ''), 'error');
  } finally {
    $('#btn-pay').disabled = !state.quote?.lines.length;
  }
}

function receiptHtml(sale, s) {
  const isInvoice = sale.doc_kind === 'factura';
  const row = (a, b) => `<div style="display:flex;justify-content:space-between"><span>${a}</span><span>${b}</span></div>`;
  return `<div style="font-family:monospace;font-size:12px;width:280px;margin:auto">
    <div style="text-align:center"><b>${esc(s.business_name)}</b><br>
      ${s.business_rtn ? 'RTN: ' + esc(s.business_rtn) + '<br>' : ''}${esc(s.business_address || '')}<br>${esc(s.business_phone || '')}</div>
    <hr>
    <div><b>${isInvoice ? 'FACTURA' : 'COMPROBANTE INTERNO'}</b> No. ${esc(sale.doc_number)}</div>
    ${isInvoice ? `<div>CAI: ${esc(sale.cai)}</div><div>Rango: ${esc(sale.cai_range_text)}</div><div>Fecha límite de emisión: ${esc(sale.cai_deadline)}</div>` : ''}
    <div>Fecha: ${esc(sale.created_at)}</div>
    <div>Cliente: ${esc(sale.customer_name)}</div>${sale.customer_rtn ? `<div>RTN cliente: ${esc(sale.customer_rtn)}</div>` : ''}
    <hr>
    ${sale.items.map((i) => `<div>${esc(i.description)}</div>${row(`${i.qty} x ${L(i.unit_price)}`, L(i.line_total))}${i.discount ? row('  Desc.', '−' + L(i.discount)) : ''}`).join('')}
    <hr>
    ${row('Descuentos', '−' + L(sale.discount_amount))}
    ${row('Importe exento', L(sale.exempt_amount))}
    ${row('Importe gravado 15%', L(sale.taxable15_amount))}
    ${sale.taxable18_amount ? row('Importe gravado 18%', L(sale.taxable18_amount)) : ''}
    ${row('ISV 15%', L(sale.tax15_amount))}
    ${sale.tax18_amount ? row('ISV 18%', L(sale.tax18_amount)) : ''}
    <div style="font-size:15px">${row('<b>TOTAL</b>', '<b>' + L(sale.total) + '</b>')}</div>
    ${sale.payments.map((p) => row(METHOD_LABEL[p.method], L(p.tendered || p.amount))).join('')}
    ${sale.change ? row('Cambio', L(sale.change)) : ''}
    <hr>
    <div style="text-align:center">${isInvoice ? 'La factura es beneficio de todos. ¡Exíjala!<br>Original: Cliente · Copia: Emisor'
      : 'Documento sin validez fiscal'}<br>¡Gracias por su compra!</div></div>`;
}

async function showReceipt(sale) {
  const full = await api.get('/sales/' + sale.id);
  full.change = sale.change;
  const html = receiptHtml(full, full.business);
  $('#receipt-print').innerHTML = html;
  openModal('Venta registrada', `
    <div class="text-center mb-4">
      <div class="text-4xl font-bold">${L(full.total)}</div>
      ${sale.change ? `<div class="text-lg text-emerald-700 mt-1">Cambio: <b>${L(sale.change)}</b></div>` : ''}
      <div class="text-sm text-slate-500 mt-1">${esc(full.doc_number)}</div>
    </div>
    <div class="border rounded-lg p-3 bg-slate-50 max-h-72 overflow-y-auto">${html}</div>
    <div class="flex gap-2 mt-4">
      <button onclick="window.print()" class="flex-1 py-2.5 rounded-lg border border-slate-200 flex items-center justify-center gap-2"><i data-lucide="printer"></i>Imprimir</button>
      <button data-close class="flex-1 py-2.5 rounded-lg bg-brand-600 text-white font-medium">Nueva venta</button>
    </div>`);
}

// ---------------- Demanda insatisfecha ----------------
function openDemandModal(prefill = '', extra = {}) {
  const opts = state.categories.map((c) => `<option value="${c.id}" ${extra.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const reasons = { sin_stock: 'Sin stock', no_manejamos: 'No lo manejamos', talla: 'No hay su talla', color: 'No hay su color', precio: 'Precio', otro: 'Otro' };
  openModal('Registrar faltante / demanda insatisfecha', `
    <form id="demand-form" class="space-y-3 text-sm">
      <div><label class="block text-slate-600 mb-1">¿Qué buscaba el cliente? *</label>
        <input name="description" required value="${esc(typeof prefill === 'string' ? prefill : '')}" class="w-full border rounded-md px-3 py-2" placeholder="Ej. Jeans wide leg negro talla 32" /></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-slate-600 mb-1">Motivo</label>
          <select name="reason" class="w-full border rounded-md px-2 py-2">${Object.entries(reasons).map(([k, v]) =>
            `<option value="${k}" ${extra.reason === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div><label class="block text-slate-600 mb-1">Categoría</label>
          <select name="category_id" class="w-full border rounded-md px-2 py-2"><option value="">—</option>${opts}</select></div>
        <div><label class="block text-slate-600 mb-1">Talla</label><input name="size" class="w-full border rounded-md px-3 py-2" /></div>
        <div><label class="block text-slate-600 mb-1">Color</label><input name="color" class="w-full border rounded-md px-3 py-2" /></div>
        <div><label class="block text-slate-600 mb-1">Cliente (opcional)</label><input name="customer_name" class="w-full border rounded-md px-3 py-2" /></div>
        <div><label class="block text-slate-600 mb-1">Teléfono para avisarle</label><input name="customer_phone" class="w-full border rounded-md px-3 py-2" /></div>
      </div>
      <button class="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium">Guardar <span class="kbd">Enter</span></button>
    </form>`);
  const form = $('#demand-form');
  form.description.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.category_id = Number(data.category_id) || null;
    if (extra.variant_id) data.variant_id = extra.variant_id;
    try { await api.post('/unmet-demand', data); closeModal(); toast('Faltante registrado'); }
    catch (err) { toast(err.message, 'error'); }
  };
}

// ---------------- Caja ----------------
async function refreshCash() {
  state.cash = await api.get('/cash/current');
  const btn = $('#btn-cash');
  if (state.cash) {
    $('#cash-label').textContent = `Caja abierta · ${L(state.cash.sales.total)}`;
    btn.classList.remove('border-red-300', 'bg-red-50', 'text-red-700');
  } else {
    $('#cash-label').textContent = 'Caja cerrada';
    btn.classList.add('border-red-300', 'bg-red-50', 'text-red-700');
  }
}

async function openCashModal() {
  await refreshCash();
  const c = state.cash;
  if (!c) {
    openModal('Apertura de caja', `
      <form id="open-form" class="space-y-3 text-sm">
        <label class="block text-slate-600">Efectivo inicial (fondo de caja)</label>
        <input name="amount" inputmode="decimal" required class="w-full border rounded-md px-3 py-2 text-lg" placeholder="0.00" />
        <button class="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium">Abrir caja</button>
      </form>`);
    const f = $('#open-form'); f.amount.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api.post('/cash/open', { opening_amount: toCents(f.amount.value) }); closeModal(); refreshCash(); toast('Caja abierta'); }
      catch (err) { toast(err.message, 'error'); }
    };
    return;
  }
  const r = (a, b, cls = '') => `<div class="flex justify-between ${cls}"><span>${a}</span><span>${b}</span></div>`;
  openModal('Corte y arqueo de caja', `
    <div class="text-xs text-slate-500 mb-3">Abierta: ${esc(c.session.opened_at)} · ${c.sales.count} ventas</div>
    <div class="grid grid-cols-2 gap-4 text-sm">
      <div class="space-y-1"><div class="font-medium mb-1">Ventas</div>
        ${r('Efectivo', L(c.byMethod.cash))}${r('Tarjeta', L(c.byMethod.card))}
        ${r('Transferencia', L(c.byMethod.transfer))}${r('Crédito', L(c.byMethod.credit))}
        ${r('Total', L(c.sales.total), 'font-semibold border-t pt-1')}</div>
      <div class="space-y-1"><div class="font-medium mb-1">Efectivo</div>
        ${r('Fondo inicial', L(c.session.opening_amount))}${r('+ Ventas', L(c.byMethod.cash))}
        ${r('+ Abonos', L(c.collections.cash))}${r('+ Ingresos', L(c.movements.deposit))}
        ${r('− Gastos', L(c.movements.expense))}${r('− Retiros', L(c.movements.withdrawal))}
        ${r('Esperado', L(c.expectedCash), 'font-semibold border-t pt-1')}</div>
    </div>
    <form id="mov-form" class="mt-5 grid grid-cols-[110px_1fr_100px_auto] gap-2 text-sm">
      <select name="type" class="border rounded-md px-2"><option value="expense">Gasto</option><option value="withdrawal">Retiro</option><option value="deposit">Ingreso</option></select>
      <input name="description" required placeholder="Descripción" class="border rounded-md px-2 py-1.5" />
      <input name="amount" required inputmode="decimal" placeholder="Monto" class="border rounded-md px-2 py-1.5" />
      <button class="px-3 rounded-md bg-slate-800 text-white">+</button>
    </form>
    <form id="close-form" class="mt-5 pt-4 border-t space-y-2 text-sm">
      <label class="block text-slate-600">Efectivo contado en caja</label>
      <input name="counted" required inputmode="decimal" class="w-full border rounded-md px-3 py-2 text-lg" placeholder="0.00" />
      <div id="diff" class="text-sm"></div>
      <button class="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium">Cerrar caja</button>
    </form>`);
  const cf = $('#close-form');
  cf.counted.oninput = () => {
    const d = toCents(cf.counted.value) - c.expectedCash;
    $('#diff').innerHTML = d === 0 ? '<span class="text-emerald-700">Cuadra exacto ✔</span>'
      : d > 0 ? `<span class="text-amber-700">Sobrante: ${L(d)}</span>` : `<span class="text-red-700">Faltante: ${L(-d)}</span>`;
  };
  $('#mov-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await api.post('/cash/movements', { type: f.type.value, description: f.description.value, amount: toCents(f.amount.value) }); openCashModal(); }
    catch (err) { toast(err.message, 'error'); }
  };
  cf.onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('¿Confirmas el cierre de caja?')) return;
    try {
      const res = await api.post('/cash/close', { counted_cash: toCents(cf.counted.value) });
      closeModal(); refreshCash();
      toast(`Caja cerrada. Diferencia: ${L(res.session.difference)}`, res.session.difference === 0 ? 'ok' : 'warn');
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ---------------- Alertas y estado fiscal ----------------
async function refreshAlerts() {
  const a = await api.get('/alerts');
  state.alerts = a;
  const n = a.counts.lowStock + a.counts.overdue + a.counts.slowMoving + a.counts.fiscal;
  $('#alert-count').textContent = n;
  $('#alert-count').classList.toggle('hidden', !n);
}

async function refreshFiscal() {
  const f = await api.get('/fiscal/status');
  const formal = f.mode === 'formal';
  $('#fiscal-badge').textContent = formal ? 'Factura SAR' : 'Comprobante interno';
  $('#fiscal-badge').className = `text-xs px-2 py-1 rounded-md ${formal ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`;
  const w = f.warnings[0];
  $('#fiscal-banner').classList.toggle('hidden', !w);
  if (w) {
    $('#fiscal-banner-text').textContent = w.message;
    $('#fiscal-banner').className = `${w.level === 'danger' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'} border-b text-xs px-5 py-1.5 flex items-center gap-2`;
  }
}

async function openAlertsModal() {
  await refreshAlerts();
  const a = state.alerts;
  const section = (icon, title, cls, rows) => `
    <div class="mb-4"><div class="flex items-center gap-2 font-medium mb-2 ${cls}"><i data-lucide="${icon}"></i>${title} (${rows.length})</div>
    ${rows.length ? `<ul class="text-sm divide-y border rounded-lg">${rows.join('')}</ul>` : '<div class="text-sm text-slate-400">Sin alertas</div>'}</div>`;
  const li = (a, b) => `<li class="px-3 py-2 flex justify-between gap-2"><span>${a}</span><span class="text-slate-500 shrink-0">${b}</span></li>`;
  openModal('Alertas', `
    ${section('hand-coins', 'Crédito vencido', 'text-red-700', a.overdue.map((o) => li(esc(o.customer_name), `${L(o.balance)} · ${o.days_overdue} días`)))}
    ${section('package-minus', 'Stock mínimo', 'text-amber-700', a.lowStock.slice(0, 30).map((v) => li(esc(`${v.product_name} ${v.size || ''} ${v.color || ''}`), `${v.stock} / mín ${v.min_stock}`)))}
    ${section('snail', `Lento movimiento (≥ ${a.slowDays} días)`, 'text-slate-700', a.slowMoving.slice(0, 30).map((v) => li(esc(`${v.product_name} ${v.size || ''} ${v.color || ''}`), `${v.idle_days} días · ${v.stock} u.`)))}
    ${a.fiscal.warnings.map((w) => `<div class="text-sm rounded-lg p-3 ${w.level === 'danger' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}">${esc(w.message)}</div>`).join('')}`);
}

// ---------------- Modal ----------------
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  icons();
}
function closeModal() {
  if ($('#modal').classList.contains('hidden')) return;
  $('#modal').classList.add('hidden');
  focusSearch();
}

window.openDemandModal = openDemandModal;
init().catch((e) => toast('No se pudo conectar con el servidor: ' + e.message, 'error'));
