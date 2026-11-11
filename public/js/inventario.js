// Zoe Closet - Inventario en tabla: filtros, totales, entrada de mercancía y ajustes por conteo.
const $ = (s) => document.querySelector(s);
const st = { data: null, status: 'all', sort: { key: 'product_name', dir: 1 }, suppliers: [] };

const STATUS_TABS = [
  ['all', 'Todo'], ['in_stock', 'Con existencia'], ['low', 'Stock bajo'], ['out', 'Agotados'], ['slow', 'Sin movimiento'],
];
const REASONS = { conteo: 'Conteo físico', danado: 'Dañado', perdida: 'Pérdida / robo', muestra: 'Regalo / muestra', otro: 'Otro' };

async function load() {
  const params = new URLSearchParams({ status: st.status });
  if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
  if ($('#cat').value) params.set('category_id', $('#cat').value);
  st.data = await api.get('/inventory?' + params);
  render();
}

function render() {
  const { rows, totals, counts, slowDays } = st.data;
  const kpi = (label, value, icon) => `<div class="bg-white rounded-xl border border-slate-200 p-4">
      <div class="text-xs text-slate-500 flex items-center gap-1.5"><i data-lucide="${icon}"></i>${label}</div>
      <div class="text-xl font-semibold mt-1">${value}</div></div>`;
  $('#kpis').innerHTML =
    kpi('Artículos (talla/color)', totals.variants.toLocaleString('es-HN'), 'tags') +
    kpi('Unidades en tienda', totals.units.toLocaleString('es-HN'), 'package') +
    kpi('Valor al costo', L(totals.costValue), 'wallet') +
    kpi('Valor a precio de venta', L(totals.retailValue), 'badge-dollar-sign');

  $('#status').innerHTML = STATUS_TABS.map(([k, label]) => {
    const on = st.status === k;
    const tone = k === 'out' ? 'text-red-700' : k === 'low' ? 'text-amber-700' : '';
    return `<button data-st="${k}" class="px-3 py-1.5 rounded-full border ${on ? 'bg-brand-600 border-brand-600 text-white'
      : 'bg-white border-slate-200 hover:border-brand-500 ' + tone}">${label}${k === 'slow' ? ` (${slowDays}+ días)` : ''}
      <span class="ml-1 text-xs ${on ? 'text-white/80' : 'text-slate-400'}">${counts[k]}</span></button>`;
  }).join('');
  $('#status').querySelectorAll('button').forEach((b) => (b.onclick = () => { st.status = b.dataset.st; load(); }));

  const { key, dir } = st.sort;
  const sorted = [...rows].sort((a, b) => {
    const x = a[key] ?? '', y = b[key] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * dir;
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.querySelector('.arrow')?.remove();
    if (th.dataset.sort === key) th.insertAdjacentHTML('beforeend', `<span class="arrow"> ${dir > 0 ? '▲' : '▼'}</span>`);
  });

  if (!sorted.length) {
    $('#rows').innerHTML = '<tr><td colspan="11" class="px-3 py-12 text-center text-slate-400">No hay productos con ese filtro.</td></tr>';
    return;
  }
  $('#rows').innerHTML = sorted.map((v) => {
    const stockCls = v.state === 'out' ? 'bg-red-100 text-red-700' : v.state === 'low' ? 'bg-amber-100 text-amber-800' : 'text-slate-900';
    const idleCls = v.stock > 0 && v.idle_days >= 60 ? 'text-red-700 font-medium'
      : v.stock > 0 && v.idle_days >= 30 ? 'text-amber-700 font-medium' : v.slow ? 'text-amber-600' : 'text-slate-500';
    return `<tr class="hover:bg-slate-50">
      <td class="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">${esc(v.product_code || '')}</td>
      <td class="px-3 py-2"><div class="font-medium">${esc(v.product_name)}</div>
        <div class="text-[11px] text-slate-400 font-mono">${esc(v.barcode || v.sku)}</div></td>
      <td class="px-3 py-2 text-slate-600">${esc(v.category_name)}</td>
      <td class="px-3 py-2">${esc(v.size || '—')}</td>
      <td class="px-3 py-2">${esc(v.color || '—')}</td>
      <td class="px-3 py-2 text-right"><span class="inline-block min-w-[2.5rem] text-center px-2 py-0.5 rounded font-semibold ${stockCls}">${v.stock}</span></td>
      <td class="px-3 py-2 text-right text-slate-500">${v.min_stock}</td>
      <td class="px-3 py-2 text-right text-slate-600 whitespace-nowrap">${L(v.cost)}</td>
      <td class="px-3 py-2 text-right font-medium whitespace-nowrap">${L(v.price)}</td>
      <td class="px-3 py-2 text-right ${idleCls}">${v.idle_days}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-in="${v.id}" class="px-2 py-1 rounded-md text-emerald-700 hover:bg-emerald-50" title="Entrada de mercancía"><i data-lucide="package-plus"></i></button>
        <button data-adj="${v.id}" class="px-2 py-1 rounded-md text-slate-600 hover:bg-slate-100" title="Ajustar existencia (conteo)"><i data-lucide="clipboard-check"></i></button>
      </td></tr>`;
  }).join('');
  $('#rows').querySelectorAll('[data-in]').forEach((b) => (b.onclick = () => openReceive(Number(b.dataset.in))));
  $('#rows').querySelectorAll('[data-adj]').forEach((b) => (b.onclick = () => openAdjust(Number(b.dataset.adj))));
  icons();
}

const variantLabel = (v) => `${v.product_name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'Única'}`;
const find = (id) => st.data.rows.find((v) => v.id === id);

function openReceive(id) {
  const v = find(id);
  const sup = st.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const body = modal.open('Entrada de mercancía', `
    <form class="space-y-3 text-sm">
      <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="font-medium">${esc(variantLabel(v))}</div>
        <div class="text-xs text-slate-500">Existencia actual: ${v.stock} · Costo promedio: ${L(v.cost)}</div></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-slate-600 mb-1">Cantidad que entra *</label>
          <input name="qty" required inputmode="numeric" class="w-full border rounded-md px-3 py-2 text-lg" /></div>
        <div><label class="block text-slate-600 mb-1">Costo por unidad (L) *</label>
          <input name="unit_cost" required inputmode="decimal" value="${(v.cost / 100).toFixed(2)}" class="w-full border rounded-md px-3 py-2" /></div>
        <div><label class="block text-slate-600 mb-1">Flete/aduana total (L)</label>
          <input name="extra_cost" inputmode="decimal" class="w-full border rounded-md px-3 py-2" placeholder="0.00" /></div>
        <div><label class="block text-slate-600 mb-1"># factura del proveedor</label>
          <input name="document_number" class="w-full border rounded-md px-3 py-2" /></div>
      </div>
      <div><label class="block text-slate-600 mb-1">Proveedor</label>
        <select name="supplier_id" class="w-full border rounded-md px-2 py-2"><option value="">— Sin proveedor —</option>${sup}</select>
        ${st.suppliers.length ? '' : '<p class="text-xs text-slate-400 mt-1">Registra proveedores en el módulo Clientes y proveedores.</p>'}</div>
      <p class="text-xs text-slate-500">El flete se reparte entre las unidades y el costo se promedia con la existencia actual.</p>
      <p class="err hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
      <button class="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium">Registrar entrada</button>
    </form>`);
  const form = body.querySelector('form');
  form.qty.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/inventory/receive', {
        supplier_id: form.supplier_id.value || null, document_number: form.document_number.value.trim() || null,
        extra_cost: toCents(form.extra_cost.value || 0),
        items: [{ variant_id: v.id, qty: Number(form.qty.value), unit_cost: toCents(form.unit_cost.value) }],
      });
      modal.close(); toast(`Entrada registrada: +${form.qty.value} ${v.product_name}`); load();
    } catch (err) { showErr(form, err); }
  };
}

function openAdjust(id) {
  const v = find(id);
  const body = modal.open('Ajustar existencia', `
    <form class="space-y-3 text-sm">
      <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="font-medium">${esc(variantLabel(v))}</div>
        <div class="text-xs text-slate-500">El sistema dice: <b>${v.stock}</b> unidades</div></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-slate-600 mb-1">Cantidad real contada *</label>
          <input name="counted" required inputmode="numeric" class="w-full border rounded-md px-3 py-2 text-lg" /></div>
        <div><label class="block text-slate-600 mb-1">Motivo</label>
          <select name="reason" class="w-full border rounded-md px-2 py-2">${Object.entries(REASONS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      </div>
      <div><label class="block text-slate-600 mb-1">Nota</label><input name="note" class="w-full border rounded-md px-3 py-2" placeholder="Opcional (obligatoria si el motivo es Otro)" /></div>
      <div class="diff text-sm"></div>
      <p class="err hidden text-red-700 bg-red-50 rounded-md px-3 py-2"></p>
      <button class="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">Guardar ajuste</button>
    </form>`);
  const form = body.querySelector('form');
  form.counted.focus();
  form.counted.oninput = () => {
    const d = Number(form.counted.value) - v.stock;
    body.querySelector('.diff').innerHTML = form.counted.value === '' || Number.isNaN(d) ? ''
      : d === 0 ? '<span class="text-emerald-700">Coincide con el sistema ✔</span>'
        : `<span class="${d > 0 ? 'text-emerald-700' : 'text-red-700'}">Diferencia: ${d > 0 ? '+' : ''}${d} unidades</span>`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/inventory/${v.id}/adjust`, { counted: Number(form.counted.value), reason: form.reason.value, note: form.note.value });
      modal.close(); toast(res.delta ? `Ajuste guardado (${res.delta > 0 ? '+' : ''}${res.delta})` : 'Sin cambios: coincide con el sistema'); load();
    } catch (err) { showErr(form, err); }
  };
}

function showErr(form, err) {
  const el = form.querySelector('.err');
  el.textContent = err.message; el.classList.remove('hidden');
}

function exportCsv() {
  const rows = st.data.rows.map((v) => [v.product_code, v.product_name, v.category_name, v.size, v.color, v.barcode || v.sku,
    v.stock, v.min_stock, csvMoney(v.cost), csvMoney(v.price), csvMoney(Math.max(v.stock, 0) * v.cost), v.idle_days]);
  downloadCsv(`inventario-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Código', 'Producto', 'Categoría', 'Talla', 'Color', 'Código de barras', 'Existencia', 'Mínimo', 'Costo', 'Precio',
     'Valor al costo', 'Días sin vender'], rows);
}

(async () => {
  if (!(await renderLayout())) return;
  const [cats, suppliers] = await Promise.all([api.get('/categories'), api.get('/suppliers')]);
  st.suppliers = suppliers;
  $('#cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''));
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
  $('#cat').onchange = load;
  $('#btn-csv').onclick = exportCsv;
  document.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => {
    const key = th.dataset.sort;
    st.sort = { key, dir: st.sort.key === key ? -st.sort.dir : 1 };
    render();
  }));
  await load();
  icons();
})();
