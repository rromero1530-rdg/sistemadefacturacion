// Zoe Closet - Administración de usuarios y bitácora
const ACTIONS = {
  login: 'Inicio de sesión', logout: 'Cierre de sesión', login_failed: 'Intento fallido', login_locked: 'Intento con cuenta bloqueada',
  account_locked: 'Cuenta bloqueada', setup_admin: 'Configuración inicial', password_changed: 'Cambio de contraseña',
  password_change_failed: 'Cambio de contraseña fallido', password_reset: 'Restablecer contraseña', user_created: 'Usuario creado',
  user_updated: 'Usuario modificado', settings_updated: 'Configuración modificada', cai_added: 'C.A.I. registrado',
  cash_open: 'Apertura de caja', cash_close: 'Cierre de caja',
};

function showTemp(user, pass) {
  const el = document.getElementById('temp');
  el.innerHTML = `<div class="font-semibold mb-1">Contraseña temporal de ${esc(user)}</div>
    <div class="font-mono text-lg bg-white rounded-md px-3 py-2 select-all">${esc(pass)}</div>
    <p class="text-xs text-slate-600 mt-2">Entrégala en persona. No se volverá a mostrar; el usuario deberá cambiarla al entrar.</p>`;
  el.classList.remove('hidden');
}

async function load() {
  const [users, audit] = await Promise.all([api.get('/users'), api.get('/audit?limit=200')]);
  const now = Date.now();
  document.getElementById('users').innerHTML = users.map((u) => {
    const locked = u.locked_until && u.locked_until > now;
    const state = !u.active ? '<span class="text-slate-400">Inactivo</span>'
      : locked ? '<span class="text-red-700">Bloqueado</span>'
      : u.must_change_password ? '<span class="text-amber-700">Clave temporal</span>' : '<span class="text-emerald-700">Activo</span>';
    const me = u.id === session.user.id;
    return `<tr data-id="${u.id}" data-username="${esc(u.username)}">
      <td class="px-5 py-2.5">${esc(u.name)}${me ? ' <span class="text-xs text-slate-400">(tú)</span>' : ''}</td>
      <td class="px-3 py-2.5 font-mono text-xs">${esc(u.username)}</td>
      <td class="px-3 py-2.5"><select data-act="role" class="border rounded px-1 py-0.5 text-xs" ${me ? 'disabled' : ''}>
        <option value="cajero" ${u.role === 'cajero' ? 'selected' : ''}>Cajero</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></td>
      <td class="px-3 py-2.5">${state}</td>
      <td class="px-3 py-2.5 text-xs text-slate-500">${esc(u.last_login_at || '—')}</td>
      <td class="px-3 py-2.5 text-right whitespace-nowrap space-x-1 text-xs">
        ${locked ? '<button data-act="unlock" class="px-2 py-1 rounded border hover:bg-slate-50">Desbloquear</button>' : ''}
        <button data-act="reset" class="px-2 py-1 rounded border hover:bg-slate-50">Restablecer clave</button>
        ${me ? '' : `<button data-act="toggle" class="px-2 py-1 rounded border hover:bg-slate-50">${u.active ? 'Desactivar' : 'Activar'}</button>`}
      </td></tr>`;
  }).join('');

  document.getElementById('audit').innerHTML = audit.map((a) => `<tr>
    <td class="px-5 py-2 text-xs text-slate-500 whitespace-nowrap">${esc(a.created_at)}</td>
    <td class="px-3 py-2">${esc(a.username || '—')}</td>
    <td class="px-3 py-2 ${/fail|lock/.test(a.action) ? 'text-red-700' : ''}">${esc(ACTIONS[a.action] || a.action)}</td>
    <td class="px-3 py-2 text-xs text-slate-400 truncate max-w-xs">${esc(a.detail || '')}</td></tr>`).join('');

  document.querySelectorAll('#users [data-act]').forEach((el) => {
    const row = el.closest('tr');
    const id = Number(row.dataset.id);
    const run = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'error'); } };
    if (el.dataset.act === 'role') el.onchange = () => run(() => api.patch(`/users/${id}`, { role: el.value }));
    else el.onclick = () => run(async () => {
      if (el.dataset.act === 'unlock') await api.patch(`/users/${id}`, { unlock: true });
      if (el.dataset.act === 'toggle') await api.patch(`/users/${id}`, { active: el.textContent.trim() === 'Activar' });
      if (el.dataset.act === 'reset') {
        if (!confirm('Se generará una contraseña temporal y se cerrarán sus sesiones. ¿Continuar?')) return;
        const res = await api.post(`/users/${id}/reset-password`);
        showTemp(row.dataset.username, res.temporaryPassword);
      }
    });
  });
}

const form = document.getElementById('new-user');
form.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const res = await api.post('/users', { name: form.name.value, username: form.username.value, role: form.role.value });
    showTemp(res.user.username, res.temporaryPassword);
    form.reset();
    load();
  } catch (err) { toast(err.message, 'error'); }
};

(async () => { if (await renderLayout()) { await load(); icons(); } })();
