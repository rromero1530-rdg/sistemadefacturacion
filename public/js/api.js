// Cliente HTTP + utilidades compartidas. Montos de la API en CENTAVOS.
window.api = {
  async request(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'ZoeCloset', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !url.startsWith('/auth/')) { location.href = '/login.html'; throw new Error('Sesión expirada'); }
    if (res.status === 403 && data?.details?.code === 'MUST_CHANGE_PASSWORD') { location.href = '/cambiar-clave.html'; throw new Error(data.error); }
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
  setTimeout(() => el.remove(), 3500);
};
window.icons = () => window.lucide?.createIcons();

// Ventana emergente reutilizable (<dialog> nativo). modal.open(título, html) devuelve el cuerpo.
window.modal = {
  el: null,
  open(title, html, { wide = false } = {}) {
    if (!this.el) {
      this.el = document.createElement('dialog');
      this.el.className = 'rounded-2xl p-0 backdrop:bg-slate-900/40 shadow-xl';
      this.el.innerHTML = `<div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 class="m-title font-semibold"></h2>
          <button type="button" class="m-close p-1 rounded hover:bg-slate-100" aria-label="Cerrar"><i data-lucide="x"></i></button></div>
        <div class="m-body p-5 max-h-[75vh] overflow-y-auto"></div>`;
      document.body.appendChild(this.el);
      this.el.querySelector('.m-close').onclick = () => this.close();
      this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    }
    this.el.style.width = wide ? 'min(96vw, 860px)' : 'min(94vw, 480px)';
    this.el.querySelector('.m-title').textContent = title;
    const body = this.el.querySelector('.m-body');
    body.innerHTML = html;
    if (!this.el.open) this.el.showModal();
    icons();
    return body;
  },
  close() { if (this.el?.open) this.el.close(); },
};

/** Descarga filas como CSV (abre bien en Excel: separador ; y BOM UTF-8). */
window.downloadCsv = (filename, headers, rows) => {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
/** Monto para CSV: 1250.50 (sin "L" ni separador de miles, para que Excel lo tome como número). */
window.csvMoney = (cents) => ((cents || 0) / 100).toFixed(2);

// Franja fija para que nunca se confunda el ambiente de prueba con el sistema real.
window.markTestMode = (status) => {
  if (!status?.testMode || document.getElementById('test-banner')) return;
  document.title = '[PRUEBA] ' + document.title;
  const el = document.createElement('div');
  el.id = 'test-banner';
  el.className = 'shrink-0 w-full bg-amber-400 text-amber-950 text-center text-sm font-semibold py-1.5 tracking-wide';
  el.textContent = 'AMBIENTE DE PRUEBA · Los datos de aquí no son reales y no afectan a la tienda';
  if (getComputedStyle(document.body).display === 'grid') el.classList.add('fixed', 'top-0', 'inset-x-0', 'z-[90]');
  document.body.prepend(el);
};
