// Manejador HTTP único (Web Request/Response). Lo usan la función de Netlify y server.js.
// Todo endpoint exige el token de la app (APP_TOKEN), salvo dos públicos que se protegen por sí mismos:
//   POST /api/email/webhook  → firma Svix de Resend (RESEND_WEBHOOK_SECRET)      GET|POST /api/unsub → token firmado del destinatario
import { timingSafeEqual } from 'node:crypto';
import { handle, diagnose, cfg } from './service.mjs';
import { scrub } from './openai.mjs';
import { emailStatus, verifyWebhook, applyWebhook, unsubscribe, verifyUnsub, paginaBaja } from './email.mjs';
import { docGet } from './data.mjs';
import { store, storeStatus } from './store.mjs';

const j = (code, o) => new Response(JSON.stringify(o), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const page = h => new Response(h, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
const okTok = h => { const v = h || '', t = process.env.APP_TOKEN || '', a = Buffer.from(v.slice(7)), b = Buffer.from(t); return !!t && v.startsWith('Bearer ') && a.length === b.length && timingSafeEqual(a, b); };
const fail = (code, kind, message) => j(code, { ok: false, error: { kind, message } });

export default async function web(req) {
  const url = new URL(req.url), path = url.pathname, method = req.method;
  if (path === '/api/email/webhook' && method === 'POST') {
    const raw = await req.text(), secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return fail(501, 'no_configurado', 'Falta RESEND_WEBHOOK_SECRET en el servidor.');
    if (!verifyWebhook(req.headers, raw, secret)) return fail(401, 'firma_invalida', 'Firma del webhook inválida.');
    let ev; try { ev = JSON.parse(raw); } catch { return fail(400, 'solicitud', 'JSON inválido.'); }
    try { return j(200, { ok: true, ...(await applyWebhook(ev)) }); } catch (e) { console.error('webhook:', scrub(e?.message)); return fail(500, 'interno', 'No se pudo procesar el evento.'); }
  }
  if (path === '/api/unsub' && ['GET', 'POST'].includes(method)) {
    const t = url.searchParams.get('t') || '';
    try { return page(method === 'POST' ? paginaBaja((await unsubscribe(t)) ? 'ok' : 'invalido') : paginaBaja(verifyUnsub(t) ? 'confirmar' : 'invalido', t)); } catch { return page(paginaBaja('invalido')); }
  }
  if (!process.env.APP_TOKEN) return j(500, { ok: false, falta: ['APP_TOKEN'] });
  const auth = okTok(req.headers.get('authorization'));
  if (method === 'GET' && path === '/api/health') {
    const c = cfg(), out = { ok: true, auth, model: c.model, modelPdf: c.modelPdf, clave: c.hasKey };
    if (auth) { if (url.searchParams.get('deep')) { out.ia = await diagnose({ pdf: url.searchParams.get('pdf') === '1' }); out.correo = emailStatus(); out.almacenamiento = await storeStatus(); try { await store().setJSON('diag/last', { at: new Date().toISOString(), ok: out.ia.ok, stages: out.ia.stages }); } catch {} } else { try { out.ultima = await store().getJSON('diag/last'); } catch {} } }
    return j(200, out);
  }
  if (!auth) return fail(401, 'no_autorizado', 'No autorizado: el token no coincide con APP_TOKEN.');
  try {
    if (method === 'GET' && path === '/api/docs/file') { const { meta, buf } = await docGet(url.searchParams.get('id')); return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
    let d = {}; if (method === 'POST') { try { d = await req.json(); } catch { return fail(400, 'solicitud', 'El cuerpo de la solicitud no es JSON válido.'); } }
    return j(200, { ok: true, ...(await handle(path, d, { method, q: url.searchParams })) });
  } catch (e) {
    if (e?.kind) return j(e.http || 502, { ok: false, error: { kind: e.kind, message: scrub(e.message), ...(e.rev ? { rev: e.rev } : {}) } });
    console.error('error:', scrub(e?.message)); return fail(500, 'interno', 'Error interno del servidor.');
  }
}
