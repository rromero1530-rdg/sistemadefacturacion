// =====================================================================
// Zoe Closet - Punto de venta
// El servidor es la fuente de verdad de precios, promociones, descuentos e ISV:
// el carrito solo guarda {variant_id, qty, descuento manual} y pide /sales/quote en cada cambio.
// =====================================================================
const $ = (s) => document.querySelector(s);

const state = {
  cart: new Map(),          // variant_id -> qty
  disc: new Map(),          // variant_id -> { pct } | { amount } (descuento manual, centavos)
  discountReason: '',
  info: new Map(),          // variant_id -> datos del producto (para mostrar stock)
  quote: null,
  method: 'cash',
  categoryId: null,
  categories: [],
  cash: null,
  settings: {},
  user: null,
  bill: null,               // { customer_id, name, doc } o { name, doc } (se crea al cobrar) o null = Consumidor Final
  view: 'grid',
  onlyStock: false,
  lastItems: [],
};

const METHOD_LABEL = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito' };
const isAdmin = () => state.user?.role === 'admin';
const maxDiscount = () => (isAdmin() ? 100 : Number(state.settings.max_cashier_discount_pct ?? 10));
const pref = {
  get(k, d) { try { return localStorage.getItem('zc.pos.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('zc.pos.' + k, v); } catch { /* sin almacenamiento */ } },
};

// ---------------- Arranque ----------------
async function init() {
  const status = await renderLayout();
  if (!status) return;
  state.user = status.user;
  document.querySelectorAll('.pm').forEach((b) => {
    b.className = 'pm text-sm py-2 rounded-md border border-slate-200 bg-white hover:border-brand-500';
    b.onclick = () => setMethod(b.dataset.method);
  });
  setMethod('cash');
  state.view = pref.get('view', 'grid');
  state.onlyStock = pref.get('onlyStock', '0') === '1';
  $('#only-stock').checked = state.onlyStock;
  renderViewToggle();

  const [settings, categories] = await Promise.all([api.get('/settings'), api.get('/categories')]);
  state.settings = settings;
  state.categories = categories;
  renderCategories();
  renderBill();
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
  $('#btn-clear').onclick = () => { if (state.cart.size && confirm('¿Vaciar carrito?')) resetSale(); };
  $('#btn-demand').onclick = () => openDemandModal();
  $('#btn-cash').onclick = openCashModal;
  $('#btn-alerts').onclick = openAlertsModal;
  $('#btn-history').onclick = () => openHistory();
  $('#btn-discount').onclick = () => openDiscountModal(null);
  $('#customer-btn').onclick = openBillModal;
  $('#view-grid').onclick = () => setView('grid');
  $('#view-list').onclick = () => setView('list');
  $('#only-stock').onchange = (e) => { state.onlyStock = e.target.checked; pref.set('onlyStock', state.onlyStock ? '1' : '0'); renderResults(state.lastItems); };
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

function setView(v) {
  state.view = v;
  pref.set('view', v);
  renderViewToggle();
  renderResults(state.lastItems);
}
function renderViewToggle() {
  for (const v of ['grid', 'list']) {
    const b = $('#view-' + v);
    const on = state.view === v;
    b.classList.toggle('bg-brand-600', on); b.classList.toggle('text-white', on);
    b.classList.toggle('hover:bg-slate-50', !on);
    b.setAttribute('aria-pressed', String(on));
  }
}

async function search(q) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (state.categoryId) params.set('category_id', state.categoryId);
  const items = await api.get('/products?' + params);
  items.forEach((v) => state.info.set(v.id, v));
  state.lastItems = items;
  renderResults(items);
  return items;
}

function stockBadge(v) {
  const out = v.stock <= 0;
  const low = !out && v.stock <= v.min_stock;
  return `<span class="text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
    ${out ? 'Agotado' : v.stock + ' disp.'}</span>`;
}

function renderResults(all) {
  const items = state.onlyStock ? all.filter((v) => v.stock > 0) : all;
  const box = $('#results');
  if (!items.length) {
    box.className = 'flex-1 overflow-y-auto pb-4';
    box.innerHTML = `<div class="text-center text-slate-500 py-16">
      <p class="mb-3">${all.length ? 'Todo lo encontrado está agotado.' : 'Sin resultados.'}</p>
      <button id="empty-demand" class="text-amber-700 underline">Registrar como faltante</button></div>`;
    $('#empty-demand').onclick = () => openDemandModal($('#search').value);
    return;
  }
  if (state.view === 'list') {
    box.className = 'flex-1 overflow-y-auto pb-4 bg-white rounded-xl border border-slate-200';
    box.innerHTML = `<table class="w-full text-sm"><thead class="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
        <tr class="text-left"><th class="px-3 py-2">Producto</th><th class="px-3 py-2">Talla</th><th class="px-3 py-2">Color</th>
        <th class="px-3 py-2">Código</th><th class="px-3 py-2 text-right">Precio</th><th class="px-3 py-2 text-right">Existencia</th><th></th></tr></thead>
      <tbody class="divide-y divide-slate-100">${items.map((v) => `
        <tr data-id="${v.id}" class="cursor-pointer hover:bg-brand-50 ${v.stock <= 0 ? 'opacity-60' : ''}">
          <td class="px-3 py-2"><div class="font-medium">${esc(v.product_name)}</div><div class="text-[11px] text-slate-400">${esc(v.category_name)}</div></td>
          <td class="px-3 py-2">${esc(v.size || '—')}</td><td class="px-3 py-2">${esc(v.color || '—')}</td>
          <td class="px-3 py-2 font-mono text-xs text-slate-500">${esc(v.product_code || v.sku)}</td>
          <td class="px-3 py-2 text-right font-semibold whitespace-nowrap">${L(v.price)}</td>
          <td class="px-3 py-2 text-right">${stockBadge(v)}</td>
          <td class="px-3 py-2 text-right text-brand-700"><i data-lucide="plus-circle"></i></td></tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => addToCart(Number(tr.dataset.id))));
  } else {
    box.className = 'flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 content-start pb-4';
    box.innerHTML = items.map((v) => `<button data-id="${v.id}" class="text-left bg-white rounded-xl border border-slate-200 p-3 hover:border-brand-500 hover:shadow-sm transition ${v.stock <= 0 ? 'opacity-60' : ''}">
      <div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(v.category_name)}</div>
      <div class="font-medium leading-snug line-clamp-2">${esc(v.product_name)}</div>
      <div class="text-xs text-slate-500 mt-0.5">${esc([v.size, v.color].filter(Boolean).join(' · '))}</div>
      <div class="flex items-end justify-between mt-2">
        <span class="font-semibold">${L(v.price)}</span>${stockBadge(v)}
      </div></button>`).join('');
    box.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => addToCart(Number(b.dataset.id))));
  }
  icons();
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
  if (next <= 0) { state.cart.delete(id); state.disc.delete(id); } else state.cart.set(id, next);
  renderCart();
  focusSearch();
}

const cartItems = () => [...state.cart].map(([variant_id, qty]) => {
  const d = state.disc.get(variant_id);
  return { variant_id, qty, ...(d?.pct != null ? { discount_pct: d.pct } : d?.amount != null ? { discount_amount: d.amount } : {}) };
});

let quoteSeq = 0;
async function renderCart() {
  const seq = ++quoteSeq;
  const items = cartItems();
  const q = items.length ? await api.post('/sales/quote', { items }).catch((e) => { toast(e.message, 'error'); return null; }) : null;
  if (seq !== quoteSeq) return; // respuesta vieja
  state.quote = q;
  if (!state.disc.size) state.discountReason = '';

  if (!q || !q.lines.length) {
    $('#cart').innerHTML = `<div class="h-full grid place-items-center text-slate-400 text-sm p-10 text-center">
      <div><i data-lucide="shopping-cart" class="mx-auto mb-2" style="width:32px;height:32px"></i>Escanea o selecciona productos</div></div>`;
  } else {
    $('#cart').innerHTML = q.lines.map((l) => `
      <div class="px-4 py-3 flex gap-3 items-start">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${esc(l.description)}</div>
          <div class="text-xs text-slate-500">${L(l.unit_price)} c/u · ${esc(l.sku)}</div>
          ${l.promo_discount ? `<div class="text-xs text-emerald-700">Promoción −${L(l.promo_discount)}</div>` : ''}
          ${l.manual_discount ? `<div class="text-xs text-emerald-700">Descuento ${l.discount_pct != null ? l.discount_pct + ' %' : ''} −${L(l.manual_discount)}</div>` : ''}
        </div>
        <div class="flex items-center gap-1">
          <button class="disc w-7 h-7 rounded border ${l.manual_discount ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'} hover:bg-emerald-50 text-xs font-semibold"
            data-id="${l.variant_id}" title="Descuento a este artículo">%</button>
          <button class="qty w-7 h-7 rounded border border-slate-200 hover:bg-slate-50" data-id="${l.variant_id}" data-d="-1">−</button>
          <span class="w-6 text-center text-sm">${l.qty}</span>
          <button class="qty w-7 h-7 rounded border border-slate-200 hover:bg-slate-50" data-id="${l.variant_id}" data-d="1">+</button>
        </div>
        <div class="w-24 text-right text-sm font-semibold">${L(l.line_total)}
          ${l.discount ? `<div class="text-[11px] text-slate-400 line-through font-normal">${L(l.qty * l.unit_price)}</div>` : ''}</div>
      </div>`).join('');
    $('#cart').querySelectorAll('.qty').forEach((b) => (b.onclick = () => addToCart(Number(b.dataset.id), Number(b.dataset.d))));
    $('#cart').querySelectorAll('.disc').forEach((b) => (b.onclick = () => openDiscountModal(Number(b.dataset.id))));
  }

  const t = q || {};
  $('#t-gross').textContent = L(t.gross);
  $('#t-discount').textContent = '−' + L(t.discount);
  $('#t-taxable15').textContent = L(t.taxable15);
  $('#t-tax15').textContent = L(t.tax15);
  $('#t-total').textContent = L(t.total);
  $('#promos').innerHTML = (t.promotions || []).map((p) =>
    `<div class="text-xs bg-emerald-50 text-emerald-800 rounded-md px-2 py-1 flex items-center gap-1.5">
       <i data-lucide="sparkles"></i>${esc(p.name)} ${p.times > 1 ? '×' + p.times : ''} · −${L(p.discount)}</div>`).join('')
    + (t.manualDiscount ? `<div class="text-xs bg-emerald-50 text-emerald-800 rounded-md px-2 py-1 flex items-center gap-1.5">
       <i data-lucide="percent"></i>Descuento manual −${L(t.manualDiscount)}${state.discountReason ? ' · ' + esc(state.discountReason) : ''}
       <button id="disc-clear" class="ml-auto underline">Quitar</button></div>` : '');
  $('#disc-clear')?.addEventListener('click', () => { state.disc.clear(); state.discountReason = ''; renderCart(); });
  $('#btn-pay').disabled = !q?.lines.length;
  $('#btn-discount').disabled = !q?.lines.length;
  updateChange();
  icons();
}

// ---------------- Descuento manual ----------------
/** id = una línea; null = toda la venta. */
function openDiscountModal(id) {
  if (!state.cart.size) return;
  const line = id ? state.quote?.lines.find((l) => l.variant_id === id) : null;
  const cur = id ? state.disc.get(id) : null;
  const max = maxDiscount();
  openModal(id ? 'Descuento a un artículo' : 'Descuento a toda la venta', `
    <form id="disc-form" class="space-y-3 text-sm">
      ${line ? `<div class="rounded-lg bg-slate-50 px-3 py-2"><div class="font-medium">${esc(line.description)}</div>
        <div class="text-xs text-slate-500">${line.qty} × ${L(line.unit_price)} = ${L(line.qty * line.unit_price)}</div></div>`
        : `<p class="text-slate-600">Se aplica el mismo porcentaje a todos los artículos del carrito.</p>`}
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <input name="value" required inputmode="decimal" class="border rounded-md px-3 py-2 text-lg"
          value="${cur?.pct ?? (cur?.amount != null ? (cur.amount / 100).toFixed(2) : '')}" placeholder="0" />
        <select name="kind" class="border rounded-md px-2" ${id ? '' : 'disabled'}>
          <option value="pct" ${cur?.amount != null ? '' : 'selected'}>%</option>
          <option value="L" ${cur?.amount != null ? 'selected' : ''}>Lempiras</option></select>
      </div>
      <div><label class="block text-slate-600 mb-1">Motivo *</label>
        <input name="reason" required maxlength="200" value="${esc(state.discountReason)}" list="disc-reasons" class="w-full border rounded-md px-3 py-2" placeholder="Ej. cliente frecuente, prenda con detalle" />
        <datalist id="disc-reasons"><option value="Cliente frecuente"><option value="Prenda con detalle"><option value="Liquidación"><option value="Autorizado por gerencia"></datalist></div>
      ${isAdmin() ? '' : `<p class="text-xs text-slate-500">Como cajero puedes dar hasta ${max} % de descuento.</p>`}
      <p id="disc-err" class="hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
      <div class="flex gap-2">
        ${(id ? cur : state.disc.size) ? '<button type="button" id="disc-remove" class="px-4 py-2.5 rounded-lg border border-slate-200">Quitar descuento</button>' : ''}
        <button class="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium">Aplicar descuento</button>
      </div>
    </form>`);
  const f = $('#disc-form');
  f.value.focus(); f.value.select();
  const err = (m) => { $('#disc-err').textContent = m; $('#disc-err').classList.remove('hidden'); };
  $('#disc-remove')?.addEventListener('click', () => {
    if (id) state.disc.delete(id); else state.disc.clear();
    closeModal(); renderCart();
  });
  f.onsubmit = (e) => {
    e.preventDefault();
    const n = Number(String(f.value.value).replace(',', '.'));
    if (!(n > 0)) return err('Escribe un descuento mayor que 0');
    const kind = id ? f.kind.value : 'pct';
    if (kind === 'pct') {
      if (n > 100) return err('El porcentaje no puede pasar de 100 %');
      if (n > max) return err(`Como cajero puedes dar hasta ${max} %. Pide a un administrador.`);
    } else {
      const gross = line.qty * line.unit_price;
      const cents = toCents(n);
      if (cents > gross) return err('El descuento no puede ser mayor que el precio');
      if ((cents / gross) * 100 > max + 0.005) return err(`Como cajero puedes dar hasta ${max} % (${L(Math.floor((gross * max) / 100))}).`);
    }
    if (!f.reason.value.trim()) return err('Escribe el motivo');
    state.discountReason = f.reason.value.trim();
    const d = kind === 'pct' ? { pct: n } : { amount: toCents(n) };
    if (id) state.disc.set(id, d);
    else for (const vid of state.cart.keys()) state.disc.set(vid, d);
    closeModal(); renderCart();
  };
}

// ---------------- Datos de la factura / cliente ----------------
function renderBill() {
  const b = state.bill;
  $('#customer-name').textContent = b?.name || 'Consumidor Final';
  $('#customer-doc').textContent = b?.doc ? `${b.doc.length === 14 ? 'RTN' : 'DNI'} ${b.doc}${b.customer_id ? '' : ' · cliente nuevo'}` : '';
}

function openBillModal() {
  const b = state.bill || {};
  openModal('Factura a nombre de', `
    <div class="space-y-4 text-sm">
      <form id="bill-form" class="space-y-3">
        <div><label class="block text-slate-600 mb-1">RTN (14 dígitos) o DNI (13 dígitos)</label>
          <input name="doc" inputmode="numeric" maxlength="16" value="${esc(b.doc || '')}" class="w-full border rounded-md px-3 py-2 font-mono" placeholder="Ej. 0801199912345" /></div>
        <div><label class="block text-slate-600 mb-1">Nombre de la persona o empresa</label>
          <input name="name" maxlength="120" value="${esc(b.name || '')}" class="w-full border rounded-md px-3 py-2" /></div>
        <p id="bill-hint" class="text-xs text-slate-500">Si el RTN/DNI ya está registrado se llena solo. Si no, el cliente se agrega automáticamente al cobrar.</p>
        <p id="bill-err" class="hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
        <div class="flex gap-2">
          <button type="button" id="bill-cf" class="px-4 py-2.5 rounded-lg border border-slate-200">Consumidor Final</button>
          <button class="flex-1 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">Usar estos datos</button>
        </div>
      </form>
      <div class="border-t pt-4">
        <label class="block text-slate-600 mb-1">…o busca un cliente registrado</label>
        <input id="bill-search" autocomplete="off" class="w-full border rounded-md px-3 py-2" placeholder="Nombre, RTN, DNI o teléfono" />
        <ul id="bill-results" class="mt-2 divide-y border rounded-lg max-h-56 overflow-y-auto empty:hidden"></ul>
      </div>
    </div>`);
  const f = $('#bill-form');
  const digits = () => f.doc.value.replace(/\D/g, '');
  let found = b.customer_id ? { id: b.customer_id, name: b.name, rtn: b.doc, dni: b.doc } : null;
  const err = (m) => { $('#bill-err').textContent = m; $('#bill-err').classList.toggle('hidden', !m); };
  f.doc.focus();
  f.doc.oninput = async () => {
    err(''); found = null;
    const d = digits();
    if (d.length !== 13 && d.length !== 14) { $('#bill-hint').textContent = 'RTN = 14 dígitos · DNI = 13 dígitos.'; return; }
    try {
      const c = await api.get('/customers/by-doc/' + d);
      found = c; f.name.value = c.name;
      $('#bill-hint').innerHTML = `<span class="text-emerald-700">Cliente registrado: <b>${esc(c.name)}</b></span>`;
    } catch {
      $('#bill-hint').textContent = `${d.length === 14 ? 'RTN' : 'DNI'} nuevo: escribe el nombre; se registrará como cliente al cobrar.`;
    }
  };
  $('#bill-cf').onclick = () => { state.bill = null; renderBill(); closeModal(); };
  f.onsubmit = (e) => {
    e.preventDefault();
    const d = digits(), name = f.name.value.trim();
    if (d && d.length !== 13 && d.length !== 14) return err('El RTN debe tener 14 dígitos y el DNI 13');
    if (!name && !found) return err('Escribe el nombre');
    if (!d && !name) { state.bill = null; } else {
      state.bill = found && (!d || [found.rtn, found.dni].includes(d))
        ? { customer_id: found.id, name: name || found.name, doc: d || found.rtn || found.dni || '' }
        : { name, doc: d };
    }
    renderBill(); closeModal();
  };
  let t;
  $('#bill-search').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (!q) { $('#bill-results').innerHTML = ''; return; }
      const list = await api.get('/customers?q=' + encodeURIComponent(q));
      $('#bill-results').innerHTML = list.slice(0, 20).map((c) => `<li><button data-id="${c.id}" class="w-full text-left px-3 py-2 hover:bg-slate-50">
          <div class="font-medium">${esc(c.name)}</div>
          <div class="text-xs text-slate-500">${esc(c.rtn ? 'RTN ' + c.rtn : c.dni ? 'DNI ' + c.dni : '')} ${esc(c.phone || '')}
            ${c.credit_limit ? ` · crédito disp. ${L(c.credit_limit - c.balance)}` : ''}</div></button></li>`).join('')
        || '<li class="px-3 py-2 text-slate-400">Sin resultados</li>';
      $('#bill-results').querySelectorAll('button[data-id]').forEach((btn) => (btn.onclick = () => {
        const c = list.find((x) => x.id === Number(btn.dataset.id));
        state.bill = { customer_id: c.id, name: c.name, doc: c.rtn || c.dni || '' };
        renderBill(); closeModal();
      }));
    }, 200);
  };
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

function resetSale() {
  state.cart.clear(); state.disc.clear(); state.discountReason = ''; state.bill = null;
  $('#tendered').value = ''; $('#pay-ref').value = '';
  setMethod('cash'); renderBill(); renderCart();
}

// ---------------- Cobro ----------------
async function checkout() {
  const q = state.quote;
  if (!q?.lines.length) return;
  if (!state.cash) { toast('Abre la caja antes de vender', 'warn'); return openCashModal(); }
  if (q.manualDiscount && !state.discountReason) { toast('Falta el motivo del descuento', 'warn'); return openDiscountModal(null); }

  const bill = state.bill;
  const payment = { method: state.method, amount: q.total };
  if (state.method === 'cash') {
    const tendered = $('#tendered').value ? toCents($('#tendered').value) : q.total;
    if (tendered < q.total) return toast('El efectivo recibido es menor al total', 'error');
    payment.tendered = tendered;
  } else if (state.method === 'credit' && !bill?.customer_id) {
    toast('Para vender al crédito elige un cliente registrado con límite de crédito', 'error');
    return openBillModal();
  } else {
    payment.reference = $('#pay-ref').value || null;
  }

  $('#btn-pay').disabled = true;
  try {
    const sale = await api.post('/sales', {
      items: cartItems(),
      customer_id: bill?.customer_id || null,
      invoice: bill && !bill.customer_id ? { doc: bill.doc || null, name: bill.name || null } : bill ? { name: bill.name } : null,
      discount_reason: state.discountReason || null,
      payments: [payment],
    });
    resetSale();
    search($('#search').value);
    refreshCash();
    refreshAlerts();
    if (sale.customerCreated) toast(`Cliente agregado: ${sale.customer_name}`);
    showReceipt(sale);
  } catch (e) {
    toast(e.message + (e.details ? ' · ' + JSON.stringify(e.details) : ''), 'error');
  } finally {
    $('#btn-pay').disabled = !state.quote?.lines.length;
  }
}

function receiptHtml(sale, s, { reprint = null } = {}) {
  const isInvoice = sale.doc_kind === 'factura';
  const row = (a, b) => `<div style="display:flex;justify-content:space-between"><span>${a}</span><span>${b}</span></div>`;
  return `<div style="font-family:monospace;font-size:12px;width:280px;margin:auto">
    ${reprint ? `<div style="text-align:center;border:2px solid #000;padding:4px;margin-bottom:6px;font-size:14px"><b>*** REIMPRESIÓN ***</b><br>
      <span style="font-size:11px">Copia del documento original · ${esc(reprint)}</span></div>` : ''}
    <div style="text-align:center"><b>${esc(s.business_name)}</b><br>
      ${s.business_rtn ? 'RTN: ' + esc(s.business_rtn) + '<br>' : ''}${esc(s.business_address || '')}<br>${esc(s.business_phone || '')}</div>
    <hr>
    <div><b>${isInvoice ? 'FACTURA' : 'COMPROBANTE INTERNO'}</b> No. ${esc(sale.doc_number)}</div>
    ${isInvoice ? `<div>CAI: ${esc(sale.cai)}</div><div>Rango: ${esc(sale.cai_range_text)}</div><div>Fecha límite de emisión: ${esc(sale.cai_deadline)}</div>` : ''}
    <div>Fecha: ${esc(sale.created_at)}</div>
    <div>Cliente: ${esc(sale.customer_name)}</div>
    ${sale.customer_rtn ? `<div>RTN cliente: ${esc(sale.customer_rtn)}</div>` : ''}
    ${sale.customer_dni ? `<div>DNI cliente: ${esc(sale.customer_dni)}</div>` : ''}
    ${sale.user_name ? `<div>Atendió: ${esc(sale.user_name)}</div>` : ''}
    <hr>
    ${sale.items.map((i) => `<div>${esc(i.description)}</div>${row(`${i.qty} x ${L(i.unit_price)}`, L(i.qty * i.unit_price))}${i.discount ? row('  Desc.', '−' + L(i.discount)) : ''}`).join('')}
    <hr>
    ${row('Subtotal', L(sale.gross_amount))}
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
      : 'Documento sin validez fiscal'}<br>¡Gracias por su compra!</div>
    ${reprint ? '<div style="text-align:center;margin-top:6px"><b>*** REIMPRESIÓN ***</b></div>' : ''}</div>`;
}

function stockAlertHtml(a) {
  if (!a || (!a.out.length && !a.low.length)) return '';
  return `
    ${a.out.length ? `<div class="mb-3 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-red-800" role="alert">
      <div class="flex items-center gap-2 font-semibold"><i data-lucide="alert-triangle"></i>¡Se agotó! Ya no queda de:</div>
      <ul class="mt-1 text-sm list-disc pl-6">${a.out.map((v) => `<li>${esc(v.description)}</li>`).join('')}</ul>
      <p class="text-xs mt-1">Retíralo de exhibición o haz el pedido al proveedor.</p></div>` : ''}
    ${a.low.length ? `<div class="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
      <div class="flex items-center gap-2 font-medium"><i data-lucide="package-minus"></i>Quedan pocas unidades:</div>
      <ul class="mt-1 text-sm list-disc pl-6">${a.low.map((v) => `<li>${esc(v.description)} — quedan ${v.stock}</li>`).join('')}</ul></div>` : ''}`;
}

async function showReceipt(sale) {
  const full = await api.get('/sales/' + sale.id);
  full.change = sale.change;
  const html = receiptHtml(full, full.business);
  $('#receipt-print').innerHTML = html;
  const out = sale.stockAlerts?.out.length;
  openModal(out ? '¡Venta registrada · producto agotado!' : 'Venta registrada', `
    ${stockAlertHtml(sale.stockAlerts)}
    <div class="text-center mb-4">
      <div class="text-4xl font-bold">${L(full.total)}</div>
      ${sale.change ? `<div class="text-lg text-emerald-700 mt-1">Cambio: <b>${L(sale.change)}</b></div>` : ''}
      <div class="text-sm text-slate-500 mt-1">${esc(full.doc_number)}</div>
    </div>
    <div class="border rounded-lg p-3 bg-slate-50 max-h-72 overflow-y-auto">${html}</div>
    <div class="flex gap-2 mt-4">
      <button id="btn-print" class="flex-1 py-2.5 rounded-lg border border-slate-200 flex items-center justify-center gap-2"><i data-lucide="printer"></i>Imprimir</button>
      <button data-close class="flex-1 py-2.5 rounded-lg bg-brand-600 text-white font-medium">Nueva venta</button>
    </div>`);
  $('#btn-print').onclick = () => window.print();
}

// ---------------- Ventas del día y reimpresión ----------------
async function openHistory(date = null, q = '') {
  const day = date || new Date().toLocaleDateString('sv-SE');
  const list = await api.get(`/sales?date=${day}&q=${encodeURIComponent(q)}`);
  const total = list.filter((s) => s.status === 'completed').reduce((a, s) => a + s.total, 0);
  openModal('Ventas y reimpresión', `
    <div class="flex gap-2 mb-3 text-sm">
      <input id="h-date" type="date" value="${day}" class="border rounded-md px-2 py-1.5" />
      <input id="h-q" value="${esc(q)}" placeholder="No. de documento, cliente, RTN o DNI" class="flex-1 min-w-0 border rounded-md px-3 py-1.5" />
    </div>
    <div class="text-xs text-slate-500 mb-2">${list.length} venta(s) · Total ${L(total)}</div>
    ${list.length ? `<ul class="divide-y border rounded-lg text-sm max-h-[55vh] overflow-y-auto">${list.map((s) => `<li class="px-3 py-2 flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="font-mono text-xs">${esc(s.doc_number)} ${s.status === 'voided' ? '<span class="text-red-600">(anulada)</span>' : ''}</div>
          <div class="truncate">${esc(s.customer_name)}</div>
          <div class="text-xs text-slate-500">${esc(s.created_at.slice(11, 16))} · ${s.units} art. · ${esc((s.methods || '').split(',').map((m) => METHOD_LABEL[m] || m).join(' + '))}
            ${s.user_name ? '· ' + esc(s.user_name) : ''}${s.reprint_count ? ` · reimpresa ${s.reprint_count}×` : ''}</div>
        </div>
        <div class="font-semibold whitespace-nowrap">${L(s.total)}</div>
        <button data-reprint="${s.id}" class="px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 flex items-center gap-1 text-xs whitespace-nowrap">
          <i data-lucide="printer"></i>Reimprimir</button></li>`).join('')}</ul>`
      : '<p class="text-sm text-slate-400 py-6 text-center">No hay ventas en ese día.</p>'}`);
  $('#h-date').onchange = (e) => openHistory(e.target.value, $('#h-q').value);
  let t;
  $('#h-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => openHistory($('#h-date').value, e.target.value), 300); };
  $('#modal-body').querySelectorAll('[data-reprint]').forEach((b) => (b.onclick = () => reprintSale(Number(b.dataset.reprint))));
}

async function reprintSale(id) {
  try {
    const sale = await api.post(`/sales/${id}/reprint`);
    const html = receiptHtml(sale, sale.business, { reprint: `reimpreso ${sale.reprinted_at}` });
    $('#receipt-print').innerHTML = html;
    openModal('Reimpresión', `
      <div class="border rounded-lg p-3 bg-slate-50 max-h-[60vh] overflow-y-auto">${html}</div>
      <div class="flex gap-2 mt-4">
        <button id="btn-back" class="px-4 py-2.5 rounded-lg border border-slate-200">Volver</button>
        <button id="btn-print" class="flex-1 py-2.5 rounded-lg bg-brand-600 text-white font-medium flex items-center justify-center gap-2"><i data-lucide="printer"></i>Imprimir</button>
      </div>`);
    $('#btn-print').onclick = () => window.print();
    $('#btn-back').onclick = () => openHistory();
  } catch (e) { toast(e.message, 'error'); }
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
  $('#fiscal-badge').className = `whitespace-nowrap text-xs px-2 py-1 rounded-md ${formal ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`;
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
  const li = (x, y) => `<li class="px-3 py-2 flex justify-between gap-2"><span>${x}</span><span class="text-slate-500 shrink-0">${y}</span></li>`;
  const name = (v) => esc(`${v.product_name} ${v.size || ''} ${v.color || ''}`);
  const tierCls = ['text-amber-600', 'text-amber-700', 'text-red-700'];
  openModal('Alertas', `
    ${section('hand-coins', 'Crédito vencido', 'text-red-700', a.overdue.map((o) => li(esc(o.customer_name), `${L(o.balance)} · ${o.days_overdue} días`)))}
    ${section('package-minus', 'Stock mínimo', 'text-amber-700', a.lowStock.slice(0, 30).map((v) => li(name(v), `${v.stock} / mín ${v.min_stock}`)))}
    ${a.slowGroups.map((g, i) => section('snail', `Sin vender: ${g.label}`, tierCls[Math.min(i, 2)],
      g.items.slice(0, 30).map((v) => li(name(v), `${v.idle_days} días · ${v.stock} u.`)))).join('')}
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
