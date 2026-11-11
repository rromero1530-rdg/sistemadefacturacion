// Zoe Closet - Alta de productos con cálculo automático de precio
const f = document.getElementById('pform');
const vbox = document.getElementById('variants');
const pct = (v) => (v === '' || v == null ? null : Number(v));

function addVariant(v = {}) {
  vbox.insertAdjacentHTML('beforeend', `<div class="grid grid-cols-[1fr_1fr_80px_1fr_32px] gap-2 vrow">
    <input placeholder="Talla" value="${esc(v.size || '')}" class="border rounded-md px-2 py-1.5" data-k="size">
    <input placeholder="Color" value="${esc(v.color || '')}" class="border rounded-md px-2 py-1.5" data-k="color">
    <input placeholder="Stock" inputmode="numeric" class="border rounded-md px-2 py-1.5" data-k="stock">
    <input placeholder="Código de barras" class="border rounded-md px-2 py-1.5" data-k="barcode">
    <button type="button" class="vdel text-slate-400 hover:text-red-600">✕</button></div>`);
  vbox.lastElementChild.querySelector('.vdel').onclick = (e) => e.currentTarget.parentElement.remove();
}

function payload() {
  return {
    name: f.name.value, code: f.code.value || null, brand: f.brand.value || null,
    category_id: Number(f.category_id.value), tax_rate_id: Number(f.tax_rate_id.value) || null,
    cost: toCents(f.cost.value || 0), extra_cost_pct: Number(f.extra_cost_pct.value || 0),
    margin_pct: pct(f.margin_pct.value),
  };
}

let t;
async function preview() {
  clearTimeout(t);
  t = setTimeout(async () => {
    if (!f.category_id.value) return;
    try {
      const p = await api.post('/pricing/preview', payload());
      const row = (a, b) => `<div class="flex justify-between"><dt>${a}</dt><dd class="text-slate-900">${b}</dd></div>`;
      document.getElementById('preview').innerHTML =
        row('Costo bruto', L(p.cost)) + row('Costo puesto en tienda', L(p.landedCost)) +
        row(`Margen aplicado (${p.mode === 'margin' ? 'sobre precio' : 'sobre costo'})`, p.marginPct + ' %') +
        row('Precio sin ISV', L(p.netPrice)) + row(p.taxRate.name, L(p.tax)) +
        row('Utilidad por unidad', `<b class="text-emerald-700">${L(p.profit)}</b>`) +
        row('Margen real s/ precio', p.marginOnPricePct + ' %');
      document.getElementById('pv-price').textContent = L(p.price);
    } catch (e) { toast(e.message, 'error'); }
  }, 200);
}

f.addEventListener('input', preview);
document.getElementById('add-variant').onclick = () => addVariant();

f.onsubmit = async (e) => {
  e.preventDefault();
  const variants = [...vbox.querySelectorAll('.vrow')].map((r) => {
    const o = {}; r.querySelectorAll('input').forEach((i) => (o[i.dataset.k] = i.value.trim() || null));
    o.stock = Number(o.stock) || 0; return o;
  }).filter((v) => v.size || v.color || v.stock || v.barcode);
  const ov = document.getElementById('price-override').value;
  try {
    const res = await api.post('/products', { ...payload(), variants, price: ov ? toCents(ov) : undefined });
    toast(`Guardado: ${res.variants.length} variante(s) a ${L(res.product.price)}`);
    f.reset(); vbox.innerHTML = ''; addVariant(); preview();
  } catch (err) { toast(err.message, 'error'); }
};

async function loadCategories(selectId) {
  const cats = await api.get('/categories');
  f.category_id.innerHTML = cats.length
    ? cats.map((c) => `<option value="${c.id}">${esc(c.name)} (margen ${c.margin_pct ?? 'global'} %)</option>`).join('')
    : '<option value="">Primero crea una categoría →</option>';
  if (selectId) f.category_id.value = String(selectId);
  preview();
}

// ---------------- Nueva categoría ----------------
const dlg = document.getElementById('cat-dialog');
const cf = document.getElementById('cat-form');
const catError = document.getElementById('cat-error');
let defaultTaxId = '';
document.getElementById('new-cat').onclick = () => {
  cf.reset(); cf.tax_rate_id.value = defaultTaxId; catError.classList.add('hidden'); dlg.showModal(); cf.name.focus();
};
document.getElementById('cat-cancel').onclick = () => dlg.close();
cf.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const cat = await api.post('/categories', {
      name: cf.name.value, margin_pct: cf.margin_pct.value.trim(), min_stock: cf.min_stock.value.trim(),
      tax_rate_id: cf.tax_rate_id.value,
    });
    dlg.close();
    await loadCategories(cat.id);
    toast(`Categoría "${cat.name}" creada`);
  } catch (err) {
    catError.textContent = err.message; catError.classList.remove('hidden');
  }
};

(async () => {
  if (!(await renderLayout())) return;
  const taxes = await api.get('/tax-rates');
  const taxOpts = taxes.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  f.tax_rate_id.insertAdjacentHTML('beforeend', taxOpts);
  cf.tax_rate_id.innerHTML = taxOpts;
  const isv15 = taxes.find((t) => t.code === 'ISV15');
  if (isv15) defaultTaxId = String(isv15.id);
  await loadCategories();
  addVariant(); icons();
})();
