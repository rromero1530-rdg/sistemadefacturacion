// Zoe Closet - Login y asistente inicial
const show = (id) => document.getElementById(id).classList.remove('hidden');
const showError = (id, err) => {
  const el = document.getElementById(id);
  el.innerHTML = esc(err.message) + (Array.isArray(err.details) ? '<ul class="list-disc pl-5 mt-1">' + err.details.map((d) => `<li>${esc(d)}</li>`).join('') + '</ul>' : '');
  el.classList.remove('hidden');
};

document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => {
  const i = document.getElementById(b.dataset.toggle);
  i.type = i.type === 'password' ? 'text' : 'password';
}));
document.getElementById('l-pass').addEventListener('keyup', (e) =>
  document.getElementById('caps').classList.toggle('hidden', !e.getModifierState?.('CapsLock')));

const goHome = (user) => { location.href = user.must_change_password ? '/cambiar-clave.html' : '/'; };

(async () => {
  const st = await api.get('/auth/status');
  if (st.user) return goHome(st.user);
  if (st.needsSetup) show(st.setupAllowedHere ? 'setup-form' : 'setup-remote');
  else show('login-form');
  icons();
})();

const lf = document.getElementById('login-form');
lf.onsubmit = async (e) => {
  e.preventDefault();
  const btn = lf.querySelector('button:not([type])');
  btn.disabled = true;
  try {
    const { user } = await api.post('/auth/login', { username: lf.username.value, password: lf.password.value });
    goHome(user);
  } catch (err) {
    lf.password.value = '';
    showError('login-error', err);
  } finally { btn.disabled = false; }
};

const sf = document.getElementById('setup-form');
sf.onsubmit = async (e) => {
  e.preventDefault();
  if (sf.password.value !== sf.password2.value) return showError('setup-error', new Error('Las contraseñas no coinciden'));
  try {
    const { user } = await api.post('/auth/setup', { name: sf.name.value, username: sf.username.value, password: sf.password.value });
    goHome(user);
  } catch (err) { showError('setup-error', err); }
};
