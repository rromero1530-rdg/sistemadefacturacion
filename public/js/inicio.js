// Zoe Closet - Pantalla de inicio: estado del día y acceso a los módulos según el rol.
const MODULES = [
  { href: '/vender.html', icon: 'scan-barcode', title: 'Vender', desc: 'Punto de venta, cobro, caja y faltantes.', roles: ['admin', 'cajero'] },
  { href: '/productos.html', icon: 'package', title: 'Inventario', desc: 'Alta de productos, tallas, colores y cálculo de precio.', roles: ['admin'] },
  { href: '/usuarios.html', icon: 'users', title: 'Usuarios', desc: 'Cuentas de cajeros y administradores, bitácora de seguridad.', roles: ['admin'] },
  { href: '/cambiar-clave.html', icon: 'key-round', title: 'Mi contraseña', desc: 'Cambiar la contraseña de tu cuenta.', roles: ['admin', 'cajero'] },
];
// Módulos cuya API ya existe pero aún no tienen pantalla.
const SOON = [
  { icon: 'bar-chart-3', title: 'Reportes' },
  { icon: 'contact', title: 'Clientes y crédito' },
  { icon: 'truck', title: 'Proveedores' },
  { icon: 'settings', title: 'Configuración' },
];

const pill = (icon, text, tone) => `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${tone}">
  <i data-lucide="${icon}"></i>${text}</span>`;

function renderModules(role) {
  document.getElementById('modules').innerHTML = MODULES.filter((m) => m.roles.includes(role)).map((m, i) => `
    <a href="${m.href}" class="tile group bg-white rounded-2xl border border-slate-200 p-5 flex gap-4 items-start
        hover:border-brand-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition">
      <span class="shrink-0 w-12 h-12 rounded-xl grid place-items-center ${i === 0 ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}">
        <i data-lucide="${m.icon}"></i></span>
      <span class="min-w-0">
        <span class="block font-semibold text-slate-900 group-hover:text-brand-700">${m.title}</span>
        <span class="block text-sm text-slate-500 mt-0.5">${m.desc}</span>
      </span>
    </a>`).join('');

  if (role === 'admin') {
    document.getElementById('soon').innerHTML = SOON.map((m) => `
      <div class="rounded-xl border border-dashed border-slate-300 px-4 py-3 flex items-center gap-3 text-slate-400 text-sm">
        <i data-lucide="${m.icon}"></i>${m.title}</div>`).join('');
    document.getElementById('soon-section').classList.remove('hidden');
  }
}

async function renderStatus() {
  const box = document.getElementById('status');
  const [cash, fiscal, alerts] = await Promise.all([
    api.get('/cash/current').catch(() => undefined),
    api.get('/fiscal/status').catch(() => null),
    api.get('/alerts').catch(() => null),
  ]);
  const parts = [];
  if (cash) parts.push(pill('wallet', `Caja abierta · ${cash.sales.count} venta(s) · ${L(cash.sales.total)}`, 'border-emerald-200 bg-emerald-50 text-emerald-800'));
  else if (cash === null) parts.push(pill('wallet', 'Caja cerrada', 'border-red-200 bg-red-50 text-red-700'));
  if (fiscal) parts.push(fiscal.mode === 'formal'
    ? pill('file-check', 'Factura SAR', 'border-emerald-200 bg-emerald-50 text-emerald-700')
    : pill('file-text', 'Comprobante interno', 'border-amber-200 bg-amber-50 text-amber-800'));
  if (alerts) {
    const n = alerts.counts.lowStock + alerts.counts.overdue + alerts.counts.slowMoving + alerts.counts.fiscal;
    if (n) parts.push(pill('bell', `${n} alerta(s)`, 'border-amber-200 bg-amber-50 text-amber-800'));
  }
  box.innerHTML = parts.join('');
  icons();
}

(async () => {
  const status = await renderLayout();
  if (!status) return;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('greeting').textContent = `${saludo}, ${status.user.name.split(' ')[0]}`;
  document.getElementById('today').textContent = new Date().toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderModules(status.user.role);
  icons();
  renderStatus();
})();
