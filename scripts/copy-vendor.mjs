// Copia pdf.js (visor de PDF) desde node_modules a public/vendor/pdfjs para servirlo desde el propio sitio (sin CDN ni problemas de CORS).
// Si falla, NO rompe el despliegue: el CRM mostrará un aviso claro en lugar del visor.
import { cp, mkdir } from 'node:fs/promises';
const src = 'node_modules/pdfjs-dist/build', dst = 'public/vendor/pdfjs';
try { await mkdir(dst, { recursive: true }); for (const f of ['pdf.min.js', 'pdf.worker.min.js']) await cp(`${src}/${f}`, `${dst}/${f}`); console.log('pdf.js copiado a', dst); }
catch (e) { console.warn('Aviso: no se pudo copiar pdf.js (el visor mostrará un aviso):', e.message); }
