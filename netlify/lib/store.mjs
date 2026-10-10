// Almacenamiento persistente del SERVIDOR. En Netlify usa Netlify Blobs (persistente y privado al sitio; no depende del disco temporal de las funciones).
// Fuera de Netlify: archivos (DATA_DIR) para un servidor Node propio, o memoria (solo pruebas, JB_STORE=memory).
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const memStore = () => { const m = new Map(); return {
  tipo: 'memoria',
  async getJSON(k) { const v = m.get(k); return v === undefined || Buffer.isBuffer(v) ? null : JSON.parse(v); },
  async setJSON(k, o) { m.set(k, JSON.stringify(o)); },
  async getBin(k) { const v = m.get(k); return Buffer.isBuffer(v) ? v : null; },
  async setBin(k, b) { m.set(k, Buffer.from(b)); },
  async del(k) { m.delete(k); },
  async list(p = '') { return [...m.keys()].filter(k => k.startsWith(p)).sort(); } }; };

const fileStore = dir => { const p = k => path.join(dir, ...k.split('/').map(encodeURIComponent)); return {
  tipo: 'archivos',
  async getJSON(k) { try { return JSON.parse(await readFile(p(k), 'utf8')); } catch { return null; } },
  async setJSON(k, o) { const f = p(k); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(o)); },
  async getBin(k) { try { return await readFile(p(k)); } catch { return null; } },
  async setBin(k, b) { const f = p(k); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, b); },
  async del(k) { await rm(p(k), { force: true }); },
  async list(prefix = '') { const out = []; const walk = async (d, rel) => { let es; try { es = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const r = (rel ? rel + '/' : '') + decodeURIComponent(e.name); e.isDirectory() ? await walk(path.join(d, e.name), r) : out.push(r); } }; await walk(dir, ''); return out.filter(k => k.startsWith(prefix)).sort(); } }; };

const blobs = () => { let st; const s = async () => (st ??= (await import('@netlify/blobs')).getStore({ name: 'jb-seguros', consistency: 'strong' })); return {
  tipo: 'Netlify Blobs',
  async getJSON(k) { return (await s()).get(k, { type: 'json' }); },
  async setJSON(k, o) { await (await s()).setJSON(k, o); },
  async getBin(k) { const b = await (await s()).get(k, { type: 'arrayBuffer' }); return b ? Buffer.from(b) : null; },
  async setBin(k, b) { await (await s()).set(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); },
  async del(k) { await (await s()).delete(k); },
  async list(prefix = '') { const { blobs: bs } = await (await s()).list({ prefix }); return bs.map(b => b.key); } }; };

let inj = null;
export const useStore = s => { inj = s; };
export const store = () => inj ?? (inj = process.env.DATA_DIR ? fileStore(process.env.DATA_DIR) : process.env.JB_STORE === 'memory' ? memStore() : blobs());
/* Comprueba de verdad que se puede escribir y leer (no basta con "estar configurado"). */
export async function storeStatus() {
  try { const s = store(), v = String(Date.now()); await s.setJSON('health/ping', { v }); const r = await s.getJSON('health/ping'); return r?.v === v ? { ok: true, tipo: s.tipo } : { ok: false, tipo: s.tipo, mensaje: 'El almacenamiento no devolvió lo escrito.' }; }
  catch (e) { return { ok: false, tipo: inj?.tipo || 'Netlify Blobs', mensaje: 'No se pudo usar el almacenamiento del servidor: ' + String(e.message).slice(0, 150) + (/blobs|environment|siteID|token/i.test(e.message) ? ' (Netlify Blobs solo funciona dentro de Netlify: despliega desde GitHub).' : '') }; }
}
