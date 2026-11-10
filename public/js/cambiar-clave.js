// Zoe Closet - Cambio de contraseña (obligatorio en el primer ingreso con contraseña temporal)
const form = document.getElementById('pw-form');
const err = document.getElementById('pw-error');
const fail = (e) => {
  err.innerHTML = esc(e.message) + (Array.isArray(e.details) ? '<ul class="list-disc pl-5 mt-1">' + e.details.map((d) => `<li>${esc(d)}</li>`).join('') + '</ul>' : '');
  err.classList.remove('hidden');
};

(async () => {
  const st = await api.get('/auth/status');
  if (!st.user) { location.href = '/login.html'; return; }
  document.getElementById(st.user.must_change_password ? 'forced' : 'back').classList.remove('hidden');
})();

form.onsubmit = async (e) => {
  e.preventDefault();
  if (form.next.value !== form.next2.value) return fail(new Error('Las contraseñas nuevas no coinciden'));
  try {
    await api.post('/auth/change-password', { current_password: form.current.value, new_password: form.next.value });
    toast('Contraseña actualizada');
    setTimeout(() => (location.href = '/'), 600);
  } catch (e2) { fail(e2); }
};
