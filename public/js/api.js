// Cliente HTTP mínimo + utilidades compartidas. Montos de la API en CENTAVOS.
window.api = {
  async request(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error || `Error ${res.status}`);
      err.status = res.status; err.details = data?.details;
      throw err;
    }
    return data;
  },
  get: (u) => api.request('GET', u),
  post: (u, b) => api.request('POST', u, b || {}),
  put: (u, b) => api.request('PUT', u, b || {}),
  patch: (u, b) => api.request('PATCH', u, b || {}),
};

const moneyFmt = new Intl.NumberFormat('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
window.L = (cents) => 'L ' + moneyFmt.format((cents || 0) / 100);
window.toCents = (v) => Math.round(Number(String(v).replace(/,/g, '')) * 100) || 0;
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.toast = (msg, type = 'ok') => {
  const el = document.createElement('div');
  const color = type === 'error' ? 'bg-red-600' : type === 'warn' ? 'bg-amber-500' : 'bg-emerald-600';
  el.className = `fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg text-white text-sm shadow-lg ${color}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
};
window.icons = () => window.lucide?.createIcons();
