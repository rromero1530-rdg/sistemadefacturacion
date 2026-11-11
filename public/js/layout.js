// Encabezado común: logo, navegación según rol, usuario y cierre de sesión.
window.session = { user: null };

window.renderLayout = async function renderLayout() {
  const header = document.getElementById('app-header');
  const page = header.dataset.page;
  const status = await api.get('/auth/status');
  if (!status.user) { location.href = '/login.html'; return null; }
  session.user = status.user;
  markTestMode(status);
  const isAdmin = status.user.role === 'admin';

  // En Vender el encabezado tiene además caja, faltantes y ventas: el menú queda solo con íconos salvo en pantallas anchas.
  const compact = page === 'pos';
  const link = (href, icon, label, ...keys) => `<a href="${href}" title="${label}" class="${compact ? 'px-2 2xl:px-3' : 'px-3'} py-1.5 rounded-md flex items-center gap-1.5 whitespace-nowrap ${keys.includes(page)
    ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-slate-100'}"><i data-lucide="${icon}"></i><span class="${compact ? 'hidden 2xl:inline' : ''}">${label}</span></a>`;

  const actions = header.innerHTML;
  header.className = 'bg-white border-b border-slate-200 px-5 h-14 flex items-center gap-3 shrink-0';
  header.innerHTML = `
    <a href="/" class="flex items-center gap-1 mr-4" title="${esc(status.business || 'Zoe Closet')}">
      <img src="/img/icon.png" alt="" class="h-11 w-11 -my-1">
      <span class="leading-none">
        <span class="block text-[19px] tracking-wide text-slate-900" style="font-family: Georgia, 'Times New Roman', serif">ZOE</span>
        <span class="block text-[15px] -mt-0.5 ml-3 text-slate-700" style="font-family: 'Segoe Script', 'Brush Script MT', cursive">Closet</span>
      </span></a>
    <nav class="flex gap-1 text-sm overflow-x-auto">
      ${link('/', 'layout-grid', 'Inicio', 'inicio')}
      ${link('/vender.html', 'scan-barcode', 'Vender', 'pos')}
      ${isAdmin ? link('/inventario.html', 'package', 'Inventario', 'inventario', 'productos') : ''}
      ${link('/clientes.html', 'contact', 'Clientes', 'clientes')}
      ${isAdmin ? link('/reportes.html', 'bar-chart-3', 'Reportes', 'reportes') : ''}
      ${isAdmin ? link('/usuarios.html', 'users', 'Usuarios', 'usuarios') : ''}
    </nav>
    <div class="ml-auto flex items-center gap-2">
      ${actions}
      <div class="relative">
        <button id="user-btn" class="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-md hover:bg-slate-100 text-sm">
          <span class="w-7 h-7 rounded-full bg-sage-100 text-sage-700 grid place-items-center font-semibold">${esc(status.user.name[0] || '?')}</span>
          <span class="text-left leading-tight whitespace-nowrap"><span class="block">${esc(status.user.name)}</span>
            <span class="block text-[11px] text-slate-500">${isAdmin ? 'Administrador' : 'Cajero'}</span></span>
          <i data-lucide="chevron-down"></i>
        </button>
        <div id="user-menu" class="hidden absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 text-sm">
          <a href="/cambiar-clave.html" class="flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><i data-lucide="key-round"></i>Cambiar contraseña</a>
          <button id="logout-btn" class="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-red-700"><i data-lucide="log-out"></i>Cerrar sesión</button>
        </div>
      </div>
    </div>`;
  document.getElementById('user-btn').onclick = (e) => { e.stopPropagation(); document.getElementById('user-menu').classList.toggle('hidden'); };
  document.addEventListener('click', () => document.getElementById('user-menu')?.classList.add('hidden'));
  document.getElementById('logout-btn').onclick = async () => { await api.post('/auth/logout'); location.href = '/login.html'; };
  icons();
  return status;
};
