// Zoe Closet - Clientes (todos) y proveedores (solo administrador)
const $ = (s) => document.querySelector(s);
const st = { tab: 'customers', rows: [], isAdmin: false };
const METHOD = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
const docOf = (c) => (c.rtn ? `RTN ${c.rtn}` : c.dni ? `DNI ${c.dni}` : '');
const date = (s) => (s ? String(s).slice(0, 10) : '—');

const field = (label, name, value = '', attrs = '') => `<div><label class="block text-slate-600 mb-1">${label}</label>
  <input name="${name}" value="${esc(value ?? '')}" ${attrs} class="w-full border rounded-md px-3 py-2" /></div>`;

// ---------------- Lista ----------------
async function load() {
  const q = $('#q').value.trim();
  const url = (st.tab === 'customers' ? '/customers' : '/suppliers') + (q ? '?q=' + encodeURIComponent(q) : '');
  st.rows = await api.get(url);
  render();
}

function render() {
  const th = (cols) => `<tr class="text-left">${cols.map(([l, right]) => `<th class="px-3 py-2.5 ${right ? 'text-right' : ''}">${l}</th>`).join('')}</tr>`;
  const empty = (n) => `<tr><td colspan="${n}" class="px-3 py-12 text-center text-slate-400">Sin registros.</td></tr>`;
  if (st.tab === 'customers') {
    $('#head').innerHTML = th([['Nombre'], ['RTN / DNI'], ['Teléfono'], ['Compras', 1], ['Última compra'], ['Saldo pendiente', 1], ['Límite de crédito', 1]]);
    $('#rows').innerHTML = st.rows.length ? st.rows.map((c) => `<tr data-id="${c.id}" class="cursor-pointer hover:bg-slate-50">
        <td class="px-3 py-2.5 font-medium">${esc(c.name)}</td>
        <td class="px-3 py-2.5 text-slate-600 font-mono text-xs">${esc(docOf(c)) || '—'}</td>
        <td class="px-3 py-2.5">${esc(c.phone || '—')}</td>
        <td class="px-3 py-2.5 text-right">${c.purchases}</td>
        <td class="px-3 py-2.5 text-slate-600">${date(c.last_purchase)}</td>
        <td class="px-3 py-2.5 text-right ${c.balance > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}">${L(c.balance)}</td>
        <td class="px-3 py-2.5 text-right text-slate-600">${c.credit_limit ? L(c.credit_limit) : '—'}</td></tr>`).join('') : empty(7);
  } else {
    $('#head').innerHTML = th([['Proveedor'], ['RTN'], ['Contacto'], ['Teléfono'], ['Compras', 1], ['Total comprado', 1], ['Última compra']]);
    $('#rows').innerHTML = st.rows.length ? st.rows.map((s) => `<tr data-id="${s.id}" class="cursor-pointer hover:bg-slate-50">
        <td class="px-3 py-2.5 font-medium">${esc(s.name)}</td>
        <td class="px-3 py-2.5 text-slate-600 font-mono text-xs">${esc(s.rtn || '—')}</td>
        <td class="px-3 py-2.5">${esc(s.contact_name || '—')}</td>
        <td class="px-3 py-2.5">${esc(s.phone || '—')}</td>
        <td class="px-3 py-2.5 text-right">${s.purchases}</td>
        <td class="px-3 py-2.5 text-right">${L(s.purchased_total)}</td>
        <td class="px-3 py-2.5 text-slate-600">${date(s.last_purchase)}</td></tr>`).join('') : empty(7);
  }
  $('#rows').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () =>
    (st.tab === 'customers' ? openCustomer : openSupplier)(Number(tr.dataset.id))));
}

function renderTabs() {
  const tabs = [['customers', 'Clientes', 'users']];
  if (st.isAdmin) tabs.push(['suppliers', 'Proveedores', 'truck']);
  $('#tabs').innerHTML = tabs.map(([k, l, i]) => `<button data-tab="${k}" class="px-4 py-1.5 rounded-lg flex items-center gap-1.5 ${st.tab === k
    ? 'bg-brand-600 text-white' : 'hover:bg-slate-100'}"><i data-lucide="${i}"></i>${l}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; renderTabs(); load(); }));
  $('#btn-new-label').textContent = st.tab === 'customers' ? 'Nuevo cliente' : 'Nuevo proveedor';
  $('#q').placeholder = st.tab === 'customers' ? 'Buscar por nombre, RTN, DNI o teléfono…' : 'Buscar por nombre, RTN, contacto o teléfono…';
  icons();
}

// ---------------- Clientes ----------------
function customerForm(c = {}) {
  const body = modal.open(c.id ? 'Editar cliente' : 'Nuevo cliente', `
    <form class="space-y-3 text-sm">
      ${field('Nombre de la persona o empresa *', 'name', c.name, 'required maxlength="120"')}
      <div class="grid grid-cols-2 gap-3">
        ${field('RTN (14 dígitos)', 'rtn', c.rtn, 'inputmode="numeric" maxlength="16"')}
        ${field('DNI (13 dígitos)', 'dni', c.dni, 'inputmode="numeric" maxlength="15"')}
        ${field('Teléfono', 'phone', c.phone)}
        ${field('Correo', 'email', c.email, 'type="email"')}
      </div>
      ${field('Dirección', 'address', c.address)}
      <div class="grid grid-cols-2 gap-3">
        ${field('Límite de crédito (L)', 'credit_limit', c.credit_limit ? (c.credit_limit / 100).toFixed(2) : '', 'inputmode="decimal" placeholder="0 = sin crédito"')}
        ${field('Días de crédito', 'credit_days', c.credit_days ?? 30, 'inputmode="numeric"')}
      </div>
      ${field('Notas', 'notes', c.notes)}
      <p class="err hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
      <button class="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">${c.id ? 'Guardar cambios' : 'Crear cliente'}</button>
    </form>`);
  const f = body.querySelector('form');
  f.name.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    data.credit_limit = toCents(data.credit_limit || 0);
    try {
      const saved = c.id ? await api.put(`/customers/${c.id}`, data) : await api.post('/customers', data);
      toast(c.id ? 'Cliente actualizado' : 'Cliente creado');
      await load();
      openCustomer(saved.id);
    } catch (err) { showErr(f, err); }
  };
}

async function openCustomer(id) {
  const c = await api.get('/customers/' + id);
  const info = (l, v) => `<div><div class="text-xs text-slate-500">${l}</div><div>${v || '—'}</div></div>`;
  const body = modal.open(c.name, `
    <div class="grid sm:grid-cols-3 gap-3 text-sm mb-4">
      ${info('RTN', esc(c.rtn))}${info('DNI', esc(c.dni))}${info('Teléfono', esc(c.phone))}
      ${info('Correo', esc(c.email))}${info('Dirección', esc(c.address))}${info('Crédito', c.credit_limit ? `${L(c.credit_limit)} · ${c.credit_days} días` : 'Sin crédito')}
    </div>
    ${c.notes ? `<p class="text-sm text-slate-600 mb-4">${esc(c.notes)}</p>` : ''}
    <div class="flex flex-wrap gap-2 mb-5"><button class="edit px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm flex items-center gap-1.5"><i data-lucide="pencil"></i>Editar datos</button></div>

    <div class="rounded-xl border ${c.balance > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200'} p-4 mb-5">
      <div class="flex items-center justify-between"><span class="font-medium">Saldo pendiente</span>
        <span class="text-xl font-bold ${c.balance > 0 ? 'text-red-700' : ''}">${L(c.balance)}</span></div>
      ${c.receivables.length ? `<ul class="mt-2 text-sm divide-y divide-red-100">${c.receivables.map((r) => `<li class="py-1.5 flex justify-between">
        <span>Vence ${date(r.due_date)}</span><span>${L(r.balance)} de ${L(r.original_amount)}</span></li>`).join('')}</ul>
      <form class="pay mt-3 grid grid-cols-[1fr_130px_auto] gap-2 text-sm">
        <input name="amount" required inputmode="decimal" placeholder="Monto del abono (L)" class="border rounded-md px-3 py-2 bg-white" />
        <select name="method" class="border rounded-md px-2 bg-white">${Object.entries(METHOD).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <button class="px-3 rounded-md bg-slate-800 text-white">Registrar abono</button>
      </form><p class="err hidden mt-2 text-red-700 text-sm"></p>` : ''}
    </div>

    <h3 class="font-medium mb-2">Historial de compras (${c.history.length})</h3>
    ${c.history.length ? `<table class="w-full text-sm"><tbody class="divide-y">${c.history.map((s) => `<tr>
        <td class="py-1.5 font-mono text-xs">${esc(s.doc_number)}</td><td class="py-1.5 text-slate-600">${esc(s.created_at)}</td>
        <td class="py-1.5 text-right ${s.status === 'voided' ? 'line-through text-slate-400' : ''}">${L(s.total)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="text-sm text-slate-400">Todavía no tiene compras.</p>'}`, { wide: true });
  body.querySelector('.edit').onclick = () => customerForm(c);
  const pay = body.querySelector('form.pay');
  if (pay) pay.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/customers/${c.id}/payments`, { amount: toCents(pay.amount.value), method: pay.method.value });
      toast('Abono registrado'); load(); openCustomer(c.id);
    } catch (err) { showErr(body, err); }
  };
}

// ---------------- Proveedores ----------------
function supplierForm(s = {}) {
  const body = modal.open(s.id ? 'Editar proveedor' : 'Nuevo proveedor', `
    <form class="space-y-3 text-sm">
      ${field('Nombre del proveedor *', 'name', s.name, 'required maxlength="120"')}
      <div class="grid grid-cols-2 gap-3">
        ${field('RTN (14 dígitos)', 'rtn', s.rtn, 'inputmode="numeric" maxlength="16"')}
        ${field('Persona de contacto', 'contact_name', s.contact_name)}
        ${field('Teléfono / WhatsApp', 'phone', s.phone)}
        ${field('Correo', 'email', s.email, 'type="email"')}
        ${field('País', 'country', s.country || 'Honduras')}
        ${field('Dirección', 'address', s.address)}
      </div>
      ${field('Notas (qué vende, condiciones de pago…)', 'notes', s.notes)}
      <p class="err hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
      <button class="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">${s.id ? 'Guardar cambios' : 'Crear proveedor'}</button>
    </form>`);
  const f = body.querySelector('form');
  f.name.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const saved = s.id ? await api.put(`/suppliers/${s.id}`, Object.fromEntries(new FormData(f)))
        : await api.post('/suppliers', Object.fromEntries(new FormData(f)));
      toast(s.id ? 'Proveedor actualizado' : 'Proveedor creado');
      await load();
      openSupplier(saved.id);
    } catch (err) { showErr(f, err); }
  };
}

async function openSupplier(id) {
  const s = await api.get('/suppliers/' + id);
  const info = (l, v) => `<div><div class="text-xs text-slate-500">${l}</div><div>${v || '—'}</div></div>`;
  const body = modal.open(s.name, `
    <div class="grid sm:grid-cols-3 gap-3 text-sm mb-4">
      ${info('RTN', esc(s.rtn))}${info('Contacto', esc(s.contact_name))}${info('Teléfono', esc(s.phone))}
      ${info('Correo', esc(s.email))}${info('País', esc(s.country))}${info('Dirección', esc(s.address))}
    </div>
    ${s.notes ? `<p class="text-sm text-slate-600 mb-4">${esc(s.notes)}</p>` : ''}
    <button class="edit mb-5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm flex items-center gap-1.5"><i data-lucide="pencil"></i>Editar datos</button>
    <h3 class="font-medium mb-2">Entradas de mercancía (${s.purchases.length})</h3>
    ${s.purchases.length ? `<table class="w-full text-sm"><thead class="text-xs text-slate-500"><tr class="text-left">
        <th class="py-1">Fecha</th><th>Factura</th><th class="text-right">Unidades</th><th class="text-right">Flete</th><th class="text-right">Total</th></tr></thead>
      <tbody class="divide-y">${s.purchases.map((p) => `<tr><td class="py-1.5">${date(p.purchase_date)}</td>
        <td>${esc(p.document_number || '—')}</td><td class="text-right">${p.units ?? 0}</td>
        <td class="text-right">${L(p.extra_cost)}</td><td class="text-right font-medium">${L(p.total_cost)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="text-sm text-slate-400">Aún no hay entradas. Se registran desde Inventario → Entrada de mercancía.</p>'}`, { wide: true });
  body.querySelector('.edit').onclick = () => supplierForm(s);
}

function showErr(scope, err) {
  const el = scope.querySelector('.err');
  el.textContent = err.message; el.classList.remove('hidden');
}

function exportCsv() {
  if (st.tab === 'customers') {
    downloadCsv('clientes.csv', ['Nombre', 'RTN', 'DNI', 'Teléfono', 'Correo', 'Dirección', 'Compras', 'Última compra', 'Saldo', 'Límite de crédito'],
      st.rows.map((c) => [c.name, c.rtn, c.dni, c.phone, c.email, c.address, c.purchases, date(c.last_purchase), csvMoney(c.balance), csvMoney(c.credit_limit)]));
  } else {
    downloadCsv('proveedores.csv', ['Proveedor', 'RTN', 'Contacto', 'Teléfono', 'Correo', 'País', 'Compras', 'Total comprado', 'Última compra'],
      st.rows.map((s) => [s.name, s.rtn, s.contact_name, s.phone, s.email, s.country, s.purchases, csvMoney(s.purchased_total), date(s.last_purchase)]));
  }
}

(async () => {
  const status = await renderLayout();
  if (!status) return;
  st.isAdmin = status.user.role === 'admin';
  if (new URLSearchParams(location.search).get('tab') === 'proveedores' && st.isAdmin) st.tab = 'suppliers';
  renderTabs();
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
  $('#btn-new').onclick = () => (st.tab === 'customers' ? customerForm() : supplierForm());
  $('#btn-csv').onclick = exportCsv;
  await load();
  icons();
})();
