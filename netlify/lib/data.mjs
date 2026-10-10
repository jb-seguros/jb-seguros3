// Copia de los datos del CRM en el servidor (para automatizaciones) y almacén de documentos PDF originales.
// Los datos del CRM siguen existiendo en el navegador: aquí solo se guarda una copia versionada. Nunca se borra nada local.
import { randomUUID } from 'node:crypto';
import { store } from './store.mjs';
const E = (m, http = 400, kind = 'solicitud', extra = {}) => Object.assign(new Error(m), { http, kind, ...extra });
const KEYS = ['c', 'p', 'pay', 'ap', 'act'];
export const syncMeta = async () => (await store().getJSON('snapshot/meta')) || { rev: 0, savedAt: null, counts: null };
export async function syncPush({ data, baseRev = 0, force = false } = {}) {
  if (!data || !KEYS.every(k => Array.isArray(data[k]))) throw E('Datos inválidos: faltan listas del CRM.');
  const clean = Object.fromEntries(KEYS.map(k => [k, data[k]])), size = JSON.stringify(clean).length;
  if (size > 4_500_000) throw E('Los datos exceden el tamaño permitido para sincronizar (4.5 MB).', 413, 'demasiado_grande');
  const cur = await syncMeta();
  if (!force && cur.rev && +baseRev !== cur.rev) throw E('El servidor tiene una versión más reciente de los datos (¿otro dispositivo?). Descárgala o sobrescribe de forma explícita.', 409, 'conflicto', { rev: cur.rev });
  if (!force && !clean.c.length && cur.counts?.c > 0) throw E('Los datos locales están vacíos y el servidor tiene clientes: no se sobrescribe sin confirmación explícita.', 409, 'vacio', { rev: cur.rev });
  const prev = await store().getJSON('snapshot'); if (prev) await store().setJSON('snapshot-prev', prev); // respaldo de la versión anterior
  const meta = { rev: cur.rev + 1, savedAt: new Date().toISOString(), counts: Object.fromEntries(KEYS.map(k => [k, clean[k].length])) };
  await store().setJSON('snapshot', { rev: meta.rev, savedAt: meta.savedAt, data: clean }); await store().setJSON('snapshot/meta', meta); return meta;
}
export async function syncPull() { const s = await store().getJSON('snapshot'); if (!s) throw E('No hay datos en el servidor.', 404, 'no_encontrado'); return { rev: s.rev, savedAt: s.savedAt, data: s.data }; }

/* ---------- documentos (PDF originales): almacenamiento privado, acceso solo con token ---------- */
export async function docPut({ name, pdfBase64, cid, pid } = {}) {
  const b64 = String(pdfBase64 || ''); if (!b64.startsWith('JVBER')) throw E('El archivo no es un PDF válido.', 400, 'pdf_invalido');
  const buf = Buffer.from(b64, 'base64'); if (buf.length > 4_500_000) throw E('El PDF supera 4 MB.', 413, 'archivo_grande');
  const id = randomUUID(), meta = { id, name: String(name || 'documento.pdf').replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120), size: buf.length, cid: cid ? String(cid).slice(0, 40) : null, pid: pid ? String(pid).slice(0, 40) : null, creado: new Date().toISOString() };
  await store().setBin('docs/' + id, buf); await store().setJSON('docs/meta/' + id, meta); return meta;
}
const okId = id => /^[0-9a-f-]{36}$/.test(String(id || ''));
export async function docGet(id) { if (!okId(id)) throw E('Documento no válido.', 400, 'solicitud'); const meta = await store().getJSON('docs/meta/' + id), buf = meta && (await store().getBin('docs/' + id)); if (!buf) throw E('Documento no encontrado.', 404, 'no_encontrado'); return { meta, buf }; }
export async function docDel(id) { if (!okId(id)) throw E('Documento no válido.', 400, 'solicitud'); await store().del('docs/' + id); await store().del('docs/meta/' + id); }
