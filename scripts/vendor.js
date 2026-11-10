'use strict';
/**
 * Descarga Tailwind (Play CDN) y Lucide a public/vendor para que el POS funcione SIN internet.
 * Ejecutar una vez con conexión: npm run vendor
 */
const fs = require('node:fs');
const path = require('node:path');

const FILES = {
  'tailwind.js': 'https://cdn.tailwindcss.com/3.4.16',
  'lucide.min.js': 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js',
};
const dir = path.join(__dirname, '..', 'public', 'vendor');

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(FILES)) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
    console.log('✔', name);
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
