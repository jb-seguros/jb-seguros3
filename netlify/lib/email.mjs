// MÓDULO DE CORREO (Resend). Independiente de OpenAI: aquí se compone, registra y ENVÍA. Nada se marca "enviado" sin respuesta del proveedor.
// Variables del servidor: RESEND_API_KEY, EMAIL_FROM (remitente de un dominio verificado), APP_URL, y opcional RESEND_WEBHOOK_SECRET.
import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { store } from './store.mjs';
import { scrub } from './openai.mjs';
import { renderTemplate, getTemplate, esc } from './templates.mjs';

export const validEmail = e => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(e || '').trim());
export const emailStatus = () => {
  const e = process.env, f = e.EMAIL_FROM || '', m = f.match(/<([^>]+)>/), addr = (m ? m[1] : f).trim().toLowerCase();
  const faltan = ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_URL'].filter(k => !e[k]);
  return { configurado: !faltan.length, faltan, from: addr || null, dominio: addr.includes('@') ? addr.split('@')[1] : null, appUrl: (e.APP_URL || '').replace(/\/$/, ''), webhook: !!e.RESEND_WEBHOOK_SECRET };
};
const E = (msg, http = 400, kind = 'solicitud') => Object.assign(new Error(msg), { http, kind });

/* ---------- configuración editable ---------- */
const CFG = { nombre: 'JB SEGUROS', respondera: '', asesorNombre: 'Javier Barbosa', asesorTelefono: '+52 444 517 6003', horaEnvio: 9 };
export const getConfig = async () => ({ ...CFG, ...((await store().getJSON('email/config')) || {}) });
export async function saveConfig(d) {
  const s = (v, n = 120) => String(v ?? '').replace(/[\r\n<>"]/g, ' ').trim().slice(0, n), c = await getConfig();
  const nueva = { nombre: s(d.nombre ?? c.nombre) || 'JB SEGUROS', respondera: s(d.respondera ?? c.respondera, 200), asesorNombre: s(d.asesorNombre ?? c.asesorNombre), asesorTelefono: s(d.asesorTelefono ?? c.asesorTelefono, 40), horaEnvio: Math.min(23, Math.max(0, parseInt(d.horaEnvio ?? c.horaEnvio, 10) || 9)) };
  if (nueva.respondera && !validEmail(nueva.respondera)) throw E('La dirección de respuesta no es un correo válido.');
  await store().setJSON('email/config', nueva); return nueva;
}

/* ---------- bajas, quejas y rebotes ---------- */
export const getBajas = async () => (await store().getJSON('email/bajas')) || {};
export async function setBaja(email, tipo = 'baja', motivo = '') { const b = await getBajas(); b[String(email).trim().toLowerCase()] = { tipo, fecha: new Date().toISOString(), motivo: String(motivo).slice(0, 100) }; await store().setJSON('email/bajas', b); }
export async function quitarBaja(email) { const b = await getBajas(); delete b[String(email).trim().toLowerCase()]; await store().setJSON('email/bajas', b); }
/* servicio (pagos/renovaciones): solo se bloquea por rebote/queja/baja total; relación y comercial: también por baja. */
export const bloqueado = (b, categoria) => !b ? false : ['rebote', 'queja', 'todos'].includes(b.tipo) || (b.tipo === 'baja' && categoria !== 'servicio');
const unsubKey = () => createHmac('sha256', process.env.APP_TOKEN || '').update('unsub-v1').digest();
export const unsubToken = email => { const e = Buffer.from(String(email).trim().toLowerCase()).toString('base64url'); return e + '.' + createHmac('sha256', unsubKey()).update(e).digest('base64url').slice(0, 22); };
export function verifyUnsub(t) {
  const [e, sig] = String(t || '').split('.'); if (!e || !sig) return null;
  const ok = createHmac('sha256', unsubKey()).update(e).digest('base64url').slice(0, 22), a = Buffer.from(sig), b = Buffer.from(ok);
  return a.length === b.length && timingSafeEqual(a, b) ? Buffer.from(e, 'base64url').toString() : null;
}
export async function unsubscribe(token) { const email = verifyUnsub(token); if (!email) return false; await setBaja(email, 'baja', 'enlace del correo'); return email; }

/* ---------- historial ---------- */
export const idemHash = k => createHash('sha256').update(String(k)).digest('hex').slice(0, 40);
const nowIso = deps => (deps.now ? deps.now() : new Date()).toISOString();
export const logGet = async id => store().getJSON(`email/log/${id.slice(0, 7)}/${id}`);
export const logPut = async r => store().setJSON(`email/log/${r.id.slice(0, 7)}/${r.id}`, r);
export async function logUpdate(id, patch, deps = {}) { const r = await logGet(id); if (!r) return null; const n = { ...r, ...patch, actualizado: nowIso(deps) }; await logPut(n); return n; }
export async function logList({ desde, hasta, tipo, estado, q, archivados, limit = 300 } = {}) {
  const hoy = new Date().toISOString().slice(0, 10), h = hasta || hoy, d = desde || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), meses = [];
  let y = +h.slice(0, 4), m = +h.slice(5, 7); const dm = +d.slice(0, 4) * 12 + +d.slice(5, 7); // de los meses más recientes hacia atrás (máx. 24)
  while (y * 12 + m >= dm && meses.length < 24) { meses.push(`${y}-${String(m).padStart(2, '0')}`); if (--m < 1) { m = 12; y--; } }
  const keys = (await Promise.all(meses.map(m => store().list(`email/log/${m}/`)))).flat().slice(-1000);
  const rows = (await Promise.all(keys.map(k => store().getJSON(k)))).filter(Boolean)
    .filter(r => r.creado.slice(0, 10) >= d && r.creado.slice(0, 10) <= h && (!tipo || r.tipo === tipo) && (!estado || r.estado === estado) && (!!archivados === !!r.archivado) && (!q || (r.to + ' ' + r.asunto).toLowerCase().includes(String(q).toLowerCase())));
  return rows.sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, limit);
}
/* Archivar o eliminar SOLO del historial. Nunca borra clientes, pólizas ni documentos, ni la marca anti-duplicados. */
export async function logBulk(ids, accion) {
  let n = 0; for (const id of (Array.isArray(ids) ? ids : []).slice(0, 500)) { if (!/^\d{4}-\d{2}_[\w-]+$/.test(id)) continue; const r = await logGet(id); if (!r) continue;
    if (accion === 'eliminar') { await store().del(`email/log/${id.slice(0, 7)}/${id}`); await store().del('email/body/' + id); } else await logPut({ ...r, archivado: accion === 'archivar' }); n++; }
  return n;
}

/* ---------- composición ---------- */
export async function componer({ plantilla, override, vars = {}, to }) {
  const st = emailStatus(), cfg = await getConfig(), base = await getTemplate(plantilla);
  if (!base) throw E('Plantilla no encontrada.', 404, 'no_encontrado');
  const tpl = { ...base, ...(override || {}) };
  const unsubUrl = base.categoria === 'servicio' || !st.appUrl || !to ? '' : `${st.appUrl}/api/unsub?t=${unsubToken(to)}`;
  const baja = unsubUrl ? `<br><br>Si prefieres no recibir estos mensajes, <a href="${esc(unsubUrl)}" style="color:#0f5db8">date de baja aquí</a>.` : '';
  const r = renderTemplate(tpl, { nombre_asesor: cfg.asesorNombre, telefono_asesor: cfg.asesorTelefono, ...vars }, { appUrl: st.appUrl, telefono: cfg.asesorTelefono, baja });
  return { ...r, categoria: base.categoria, unsubUrl, plantilla: base.id };
}

/* ---------- Resend ---------- */
const resend = async (path, init, fetchFn, ms = 8000) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms); try { return await fetchFn('https://api.resend.com' + path, { ...init, signal: ac.signal }); } finally { clearTimeout(t); } };
/* Estados: enviando → aceptado (el proveedor lo aceptó) → entregado | rebotado | queja (por webhook). fallido (rechazo definitivo),
   reintentar (límite de frecuencia 429: seguro repetir), desconocido (no sabemos si salió: NUNCA se repite solo), omitido, cancelado. */
export async function sendEmail(o, deps = {}) {
  const fetchFn = deps.fetch || fetch, st = emailStatus();
  if (!st.configurado) return { ok: false, estado: 'no_configurado', error: `Faltan variables en el servidor: ${st.faltan.join(', ')}.` };
  const to = String(o.to || '').trim().toLowerCase(), id = `${nowIso(deps).slice(0, 7)}_${randomUUID().slice(0, 12)}`, ik = 'email/idem/' + idemHash(o.idemKey || id);
  const base = { id, to, asunto: o.subject, tipo: o.tipo || 'manual', categoria: o.categoria || 'manual', origen: o.origen || 'manual', plantilla: o.plantilla || null, ref: o.ref || null, cid: o.cid || null, campania: o.campania || null, autorizo: o.autorizo || null, creado: nowIso(deps), intentos: 1 };
  const prev = await store().getJSON(ik);
  if (prev && prev.estado !== 'reintentar') return { ok: false, estado: 'duplicado', logId: prev.logId };
  const fin = async (estado, extra = {}) => { const rec = { ...base, estado, actualizado: nowIso(deps), ...extra }; await logPut(rec); await store().setJSON(ik, { estado, logId: id, at: rec.actualizado, intentos: rec.intentos }); return { ok: estado === 'aceptado', estado, logId: id, ...extra }; };
  if (o.omitir) return fin('omitido', { error: o.omitir });
  if (!validEmail(to)) return fin('omitido', { error: 'Correo inválido o vacío.' });
  if (!o.prueba && bloqueado((await getBajas())[to], base.categoria)) return fin('omitido', { error: 'El contacto se dio de baja o su correo rebotó.' });
  if (prev?.intentos) base.intentos = prev.intentos + 1;
  await store().setJSON(ik, { estado: 'enviando', logId: id, at: nowIso(deps), intentos: base.intentos }); await logPut({ ...base, estado: 'enviando' });
  await store().setJSON('email/body/' + id, { subject: o.subject, html: o.html, text: o.text, unsubUrl: o.unsubUrl || '' });
  const cfg = await getConfig(), from = `${cfg.nombre.replace(/[<>"\r\n]/g, '')} <${st.from}>`;
  const payload = { from, to: [to], subject: o.subject, html: o.html, text: o.text, ...(cfg.respondera ? { reply_to: cfg.respondera } : {}), ...(o.unsubUrl ? { headers: { 'List-Unsubscribe': `<${o.unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}) };
  let r;
  try { r = await resend('/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idemHash(o.idemKey || id) }, body: JSON.stringify(payload) }, fetchFn); }
  catch { return fin('desconocido', { error: 'No se recibió respuesta del proveedor: no sabemos si el correo salió. No se reintentará solo; revísalo en el panel de Resend y reintenta manualmente si hace falta.' }); }
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.id) { await store().setJSON('email/byprov/' + j.id, { logId: id }); return fin('aceptado', { proveedorId: j.id }); }
  const msg = scrub(j.message || j.error || '');
  if (r.status === 429) return fin('reintentar', { error: 'El proveedor limitó la frecuencia de envío (429). Se reintentará más tarde.' });
  if (r.status >= 500) return fin('desconocido', { error: `El proveedor respondió ${r.status}: no sabemos si el correo salió. No se reintentará solo.` });
  const hint = r.status === 401 ? ' Revisa RESEND_API_KEY.' : r.status === 403 || r.status === 422 ? ' Revisa que el dominio de EMAIL_FROM esté verificado en Resend.' : '';
  return fin('fallido', { error: `El proveedor rechazó el correo (${r.status}): ${msg || 'sin detalle'}.${hint}` });
}
/* Reintento MANUAL de un correo (o automático solo si estaba en «reintentar»). */
export async function reintentar(id, { automatico = false, pagoPagado = null } = {}, deps = {}) {
  const r = await logGet(id); if (!r) throw E('Registro no encontrado.', 404, 'no_encontrado');
  if (automatico && r.estado !== 'reintentar') return { ok: false, estado: r.estado };
  if (!['reintentar', 'desconocido', 'fallido'].includes(r.estado)) throw E('Solo se pueden reintentar correos fallidos, de estado desconocido o en espera.');
  if (pagoPagado) { await logUpdate(id, { estado: 'cancelado', error: 'El pago ya fue registrado.' }, deps); return { ok: false, estado: 'cancelado' }; }
  const b = await store().getJSON('email/body/' + id); if (!b) throw E('No se conserva el contenido de este correo.', 410, 'sin_contenido');
  const key = `retry:${id}:${(r.intentos || 1) + 1}`; // clave nueva por intento manual; el antiguo queda registrado
  const res = await sendEmail({ to: r.to, subject: b.subject, html: b.html, text: b.text, unsubUrl: b.unsubUrl, tipo: r.tipo, categoria: r.categoria, origen: automatico ? 'automático' : 'manual', plantilla: r.plantilla, ref: r.ref, cid: r.cid, campania: r.campania, autorizo: r.autorizo, idemKey: key }, deps);
  if (res.logId) await logUpdate(id, { estado: 'reintentado', error: `Reintentado como ${res.logId}.` }, deps);
  return res;
}

/* ---------- prueba de conexión (no envía nada) ---------- */
export async function testConnection(fetchFn = fetch) {
  const st = emailStatus(); if (!st.configurado) return { ok: false, estado: 'no_configurado', faltan: st.faltan, mensaje: `Faltan variables en el servidor: ${st.faltan.join(', ')}.` };
  try {
    const r = await resend('/domains', { headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY } }, fetchFn), j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.name === 'restricted_api_key') return { ok: true, parcial: true, estado: 'solo_envio', mensaje: 'La clave es de solo envío: no puedo verificar el dominio desde aquí. Usa «Enviar correo de prueba» para confirmar.' };
    if (r.status === 401 || r.status === 403) return { ok: false, estado: 'clave_invalida', mensaje: 'Resend rechazó la clave (RESEND_API_KEY inválida o revocada).' };
    if (!r.ok) return { ok: false, estado: 'error', mensaje: `Resend respondió ${r.status}.` };
    const d = (j.data || []).find(x => String(x.name).toLowerCase() === st.dominio);
    if (!d) return { ok: false, estado: 'dominio_no_encontrado', mensaje: `El dominio ${st.dominio} no aparece en tu cuenta de Resend. Agrégalo y verifícalo (SPF y DKIM).` };
    return d.status === 'verified' ? { ok: true, estado: 'verificado', mensaje: `Dominio ${st.dominio} verificado.` } : { ok: false, estado: 'dominio_pendiente', mensaje: `El dominio ${st.dominio} está en estado «${d.status}». Completa los registros DNS en Resend.` };
  } catch { return { ok: false, estado: 'red', mensaje: 'No se pudo contactar a Resend.' }; }
}

/* ---------- webhook de Resend (firma Svix) ---------- */
export function verifyWebhook(headers, raw, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigs = headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs || Math.abs(nowSec - +ts) > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'), esperado = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return sigs.split(' ').some(s => { const [v, f] = s.split(','); const a = Buffer.from(f || ''), b = Buffer.from(esperado); return v === 'v1' && a.length === b.length && timingSafeEqual(a, b); });
}
const RANGO = { aceptado: 1, demorado: 2, entregado: 3, abierto: 3, rebotado: 5, queja: 5, fallido: 5 };
export async function applyWebhook(ev, deps = {}) {
  const map = { 'email.sent': 'aceptado', 'email.delivered': 'entregado', 'email.delivery_delayed': 'demorado', 'email.bounced': 'rebotado', 'email.complained': 'queja', 'email.failed': 'fallido' }, estado = map[ev?.type];
  const pid = ev?.data?.email_id; if (!estado || !pid) return { ignorado: true };
  const ix = await store().getJSON('email/byprov/' + pid); if (!ix) return { ignorado: true, motivo: 'correo desconocido' };
  const r = await logGet(ix.logId); if (!r) return { ignorado: true };
  const patch = (RANGO[estado] || 0) >= (RANGO[r.estado] || 0) || ['reintentado'].includes(r.estado) ? { estado } : {};
  if (estado === 'rebotado') { patch.error = 'El correo rebotó: ' + scrub(ev.data?.bounce?.message || 'dirección inexistente o buzón lleno') + '.'; await setBaja(r.to, 'rebote', 'rebote'); }
  if (estado === 'queja') { patch.error = 'El destinatario lo marcó como spam.'; await setBaja(r.to, 'queja', 'queja'); }
  if (estado === 'fallido') patch.error = 'El proveedor reportó un fallo de entrega.';
  await logUpdate(r.id, patch, deps); return { actualizado: r.id, estado: patch.estado || r.estado };
}
export const paginaBaja = (estado, token = '') => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JB SEGUROS</title></head><body style="font-family:Arial,sans-serif;background:#eef3f9;margin:0;padding:40px 16px"><div style="max-width:480px;margin:auto;background:#fff;border-radius:14px;padding:28px;border-top:5px solid #19b5c4"><h2 style="color:#0a2a5e;margin-top:0">JB SEGUROS</h2>${estado === 'ok' ? '<p>Listo: ya no recibirás nuestros correos promocionales y de seguimiento.</p>' : estado === 'invalido' ? '<p>El enlace no es válido o expiró. Escríbenos y con gusto te damos de baja.</p>' : `<p>¿Confirmas que deseas dejar de recibir correos promocionales y de seguimiento de JB SEGUROS?</p><form method="post" action="/api/unsub?t=${esc(token)}"><button style="background:#0a2a5e;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;cursor:pointer">Darme de baja</button></form>`}</div></body></html>`;
