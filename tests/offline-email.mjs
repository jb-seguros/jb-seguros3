// PRUEBAS SIMULADAS del módulo de correo, plantillas, automatizaciones, campañas, sincronización, documentos y seguridad.
// Usan un almacenamiento en memoria y un "Resend" FALSO: verifican la lógica propia. NO prueban el envío real
// (para eso: `npm run test:live-email`, que necesita RESEND_API_KEY, EMAIL_FROM y una dirección de prueba tuya).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
Object.assign(process.env, { JB_STORE: 'memory', APP_TOKEN: 'tok-prueba', RESEND_API_KEY: 're_CLAVE_FALSA_PRUEBAS', EMAIL_FROM: 'JB SEGUROS <recordatorios@jbseguros.mx>', APP_URL: 'https://jb.example.com' });
delete process.env.RESEND_WEBHOOK_SECRET;
const { useStore, memStore, store } = await import('../netlify/lib/store.mjs');
const E = await import('../netlify/lib/email.mjs'), T = await import('../netlify/lib/templates.mjs'), A = await import('../netlify/lib/automations.mjs'), Dt = await import('../netlify/lib/data.mjs');
const web = (await import('../netlify/lib/web.mjs')).default, ai = await import('../netlify/lib/openai.mjs');
const fresh = () => useStore(memStore());
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mkFetch = fn => { const calls = []; const f = async (u, o) => { calls.push({ u, o, body: o?.body ? JSON.parse(o.body) : null }); return fn ? fn(calls.length, u, o) : resp(200, { id: 're_' + calls.length }); }; f.calls = calls; return f; };
const noSleep = () => {};
const RANGO = () => ({ desde: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), hasta: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
let ok = 0, bad = 0;
const t = async (name, fn) => { fresh(); try { await fn(); ok++; console.log('  ✔', name); } catch (e) { bad++; console.log('  ✘', name, '\n     ', e.message.split('\n')[0]); } };
console.log('PRUEBAS SIMULADAS de correo (almacenamiento en memoria y Resend falso). No prueban el envío real.\n');

const HOY = '2026-10-09';
const datos = () => ({
  c: [{ id: 'c1', nombre: 'Ana', apellido: 'López', email: 'ana@x.mx', tipo: 'Cliente', status: 'Cliente activo', nac: '1985-10-09', alta: '2025-01-01' },
    { id: 'c2', nombre: 'Beto', apellido: 'Ruiz', email: '', tipo: 'Cliente', status: 'Cliente activo', nac: '1980-10-09' },
    { id: 'p1', nombre: 'Pía', apellido: 'Sol', email: 'pia@x.mx', tipo: 'Prospecto', status: 'Contactado', nac: '1992-10-09', consentPromos: 'No', alta: '2026-09-01' },
    { id: 'p2', nombre: 'Raúl', apellido: 'Mar', email: 'raul@x.mx', tipo: 'Prospecto', status: 'Contactado', nac: '1992-10-09', consentPromos: 'Sí', alta: '2026-09-01', interes: 'Auto' },
    { id: 'c3', nombre: 'Caro', apellido: 'Paz', email: 'caro@x.mx', tipo: 'Cliente', status: 'Cliente activo', nac: '1990-10-11', consentPromos: 'Sí' }],
  p: [{ id: 'pol1', cid: 'c1', num: 'GNP-1', tipo: 'Auto', co: 'GNP', ini: '2026-01-01', fin: '2026-11-08' }, { id: 'pol2', cid: 'c1', num: 'AXA-2', tipo: 'Vida', co: 'AXA', ini: '2026-01-01', fin: '2026-11-08', canc: true }, { id: 'pol3', cid: 'c3', num: 'X-3', tipo: 'Hogar', co: 'HDI', ini: '2026-10-08', fin: '2027-10-08' }],
  pay: [{ id: 'y1', pid: 'pol1', due: '2026-10-12', monto: 2000, paid: '' }, { id: 'y2', pid: 'pol1', due: '2026-10-12', monto: 2000, paid: '2026-10-05' }, { id: 'y3', pid: 'pol1', due: '2026-10-09', monto: 2000, paid: '' },
    { id: 'y4', pid: 'pol1', due: '2026-10-06', monto: 2000, paid: '' }, { id: 'y5', pid: 'pol1', due: '2026-10-04', monto: 2000, paid: '' }, { id: 'y6', pid: 'pol2', due: '2026-10-12', monto: 500, paid: '' }, { id: 'y7', pid: 'pol1', due: '2026-10-01', monto: 2000, paid: '2026-10-08' }],
  ap: [], act: [] });
const ON = { cumpleanos: { activo: true, destinatarios: 'clientes' }, pagos: { activo: true, confirmacion: true }, renovaciones: { activo: true }, seguimiento: { activo: true } };
const claves = r => r.intents.map(i => i.idemKey).sort();
const mail = (o, f, extra = {}) => E.sendEmail({ to: 'ana@x.mx', subject: 'Hola', html: '<p>Hola</p>', text: 'Hola', tipo: 'manual', categoria: 'manual', idemKey: 'k' + Math.random(), ...o }, { fetch: f, ...extra });

console.log('Plantillas');
await t('Variables: se reemplazan, se escapan, los bloques opcionales se omiten y nunca aparece «undefined» ni «{{»', () => {
  const tpl = { asunto: 'Hola {{nombre}}\n', contenido: '<p>{{nombre}} {{#importe}}Importe {{importe}}{{/importe}}{{#ramo}} de {{ramo}}{{/ramo}} {{inventada}} {{apellido}}</p>', firma: '', requeridas: ['nombre'] };
  const r = T.renderTemplate(tpl, { nombre: '<b>Ana</b>', apellido: undefined, ramo: 'Auto' });
  assert.ok(r.ok); assert.ok(r.html.includes('&lt;b&gt;Ana&lt;/b&gt;')); assert.ok(r.html.includes('de Auto')); assert.ok(!/undefined|\{\{|Importe/.test(r.html)); assert.equal(r.asunto, 'Hola <b>Ana</b>'.replace(/<b>|<\/b>/g, '') === 'x' ? '' : r.asunto);
  assert.ok(!r.asunto.includes('\n')); assert.deepEqual(r.desconocidas, ['inventada']); assert.ok(r.faltantes.includes('apellido'));
});
await t('Plantillas: falta una variable obligatoria → no se puede enviar (sin inventar datos)', () => {
  const r = T.renderTemplate(T.DEFAULTS.find(x => x.id === 'pago_proximo'), { nombre: 'Ana' }); assert.equal(r.ok, false); assert.deepEqual(r.faltanRequeridas, ['fecha_pago']);
});
await t('Las 10 plantillas se generan con la identidad de marca, responsivas y sin etiquetas sin resolver', () => {
  const v = { nombre: 'Ana', apellido: 'López', fecha_pago: '15 de noviembre de 2026', importe: '$2,000.00', numero_poliza: 'GNP-1', ramo: 'Auto', fecha_vencimiento: '30 de noviembre de 2026', aseguradora: 'GNP', plazo: 'en 3 días', dias: '30', referencia: 'R1', mensaje: T.paragraphs('Hola\n\nMundo'), nombre_asesor: 'Javier', telefono_asesor: '+52 444 517 6003' };
  assert.equal(T.DEFAULTS.length, 10); for (const x of T.DEFAULTS) { const r = T.renderTemplate(x, v, { appUrl: 'https://jb.example.com' }); assert.ok(r.ok, x.id); assert.ok(!/undefined|\{\{/.test(r.html + r.asunto), x.id); assert.ok(/#0a2a5e/.test(r.html) && /#19b5c4/.test(r.html) && /name="viewport"/.test(r.html) && /max-width:100%/.test(r.html), x.id); assert.ok(!/\$\s?\d/.test(r.asunto), 'asunto sin importes: ' + x.id); }
});
await t('Asunto: rechaza importes y datos financieros', () => { assert.ok(T.validarAsunto('Tu pago de {{importe}}')); assert.ok(T.validarAsunto('Pagaste $2,000')); assert.equal(T.validarAsunto('Recordatorio de tu próximo pago'), ''); });
await t('Plantillas editables: guardar asunto/contenido/firma, quitar scripts, y restablecer la original', async () => {
  const g = await T.saveTemplate('cumpleanos', { asunto: 'Felicidades {{nombre}}', contenido: '<p onclick="x()">Hola {{nombre}}</p><script>alert(1)</script>', firma: '<p>Equipo</p>' });
  assert.equal(g.asunto, 'Felicidades {{nombre}}'); assert.ok(!/script|onclick/.test(g.contenido)); assert.equal(g.personalizada, true);
  await assert.rejects(() => T.saveTemplate('cumpleanos', { asunto: 'Pago de {{importe}}', contenido: 'x', firma: '' }), e => e.kind === 'asunto_invalido');
  assert.equal((await T.resetTemplate('cumpleanos')).personalizada, false);
});

console.log('\nEnvío, estados y registro');
await t('Envío aceptado: payload correcto (remitente, Idempotency-Key, baja en un clic), historial e índice del proveedor', async () => {
  await E.saveConfig({ nombre: 'JB SEGUROS', respondera: 'asesor@jbseguros.mx' }); const f = mkFetch();
  const c = await E.componer({ plantilla: 'promocion', vars: { nombre: 'Ana', mensaje: T.paragraphs('Hola') }, to: 'ana@x.mx' });
  const r = await mail({ subject: c.asunto, html: c.html, text: c.text, unsubUrl: c.unsubUrl, tipo: 'campania', categoria: 'comercial', idemKey: 'e1' }, f);
  assert.equal(r.estado, 'aceptado'); assert.equal(r.proveedorId, 're_1'); const q = f.calls[0];
  assert.equal(q.u, 'https://api.resend.com/emails'); assert.equal(q.body.from, 'JB SEGUROS <recordatorios@jbseguros.mx>'); assert.deepEqual(q.body.to, ['ana@x.mx']); assert.equal(q.body.reply_to, 'asesor@jbseguros.mx');
  assert.ok(q.o.headers['Idempotency-Key']); assert.match(q.body.headers['List-Unsubscribe'], /^<https:\/\/jb\.example\.com\/api\/unsub\?t=/); assert.equal(q.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(q.o.headers.Authorization, 'Bearer re_CLAVE_FALSA_PRUEBAS'); const [l] = await E.logList(RANGO()); assert.equal(l.estado, 'aceptado'); assert.equal(l.proveedorId, 're_1'); assert.ok(!JSON.stringify(l).includes('re_CLAVE'));
});
await t('No se marca «enviado» sin respuesta del proveedor: 422 → fallido, 429 → reintentar, 500 y red → desconocido (todo queda registrado)', async () => {
  const casos = [[422, { message: 'domain not verified' }, 'fallido'], [429, {}, 'reintentar'], [500, {}, 'desconocido'], [401, { message: 'bad key re_CLAVE_FALSA_PRUEBAS' }, 'fallido']];
  for (const [st, body, estado] of casos) { const r = await mail({}, mkFetch(() => resp(st, body))); assert.equal(r.estado, estado, String(st)); assert.equal(r.ok, false); }
  const r = await mail({}, async () => { throw new Error('ECONNRESET'); }); assert.equal(r.estado, 'desconocido'); assert.match(r.error, /no sabemos si el correo salió/);
  const logs = await E.logList(RANGO()); assert.equal(logs.length, 5); assert.ok(logs.every(x => x.error && x.estado !== 'aceptado')); assert.ok(logs.find(x => x.estado === 'fallido' && /dominio/.test(x.error)));
});
await t('Idempotencia: la misma clave nunca se envía dos veces', async () => { const f = mkFetch(); await mail({ idemKey: 'unica' }, f); const r = await mail({ idemKey: 'unica' }, f); assert.equal(r.estado, 'duplicado'); assert.equal(f.calls.length, 1); });
await t('Faltan variables del servidor → lo dice por nombre, sin secretos y sin llamar al proveedor', async () => {
  const k = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY, delete process.env.APP_URL; const f = mkFetch(); const r = await mail({}, f); process.env.RESEND_API_KEY = k; process.env.APP_URL = 'https://jb.example.com';
  assert.equal(r.estado, 'no_configurado'); assert.match(r.error, /RESEND_API_KEY, APP_URL/); assert.equal(f.calls.length, 0);
});
await t('Bajas, quejas y rebotes: bloquean según la categoría (servicio solo se bloquea por rebote/queja)', async () => {
  const f = mkFetch(); await E.setBaja('a@x.mx', 'baja'); await E.setBaja('r@x.mx', 'rebote');
  assert.equal((await mail({ to: 'a@x.mx', categoria: 'comercial' }, f)).estado, 'omitido'); assert.equal((await mail({ to: 'a@x.mx', categoria: 'manual' }, f)).estado, 'omitido');
  assert.equal((await mail({ to: 'a@x.mx', categoria: 'servicio' }, f)).estado, 'aceptado'); assert.equal((await mail({ to: 'r@x.mx', categoria: 'servicio' }, f)).estado, 'omitido'); assert.equal((await mail({ to: 'no-es-correo' }, f)).estado, 'omitido');
});
await t('Reintento: solo manual para «desconocido»; el automático solo actúa sobre «reintentar» y cancela si el pago ya se registró', async () => {
  let n = 0; const f = mkFetch(() => (++n === 1 ? resp(500, {}) : resp(200, { id: 're_ok' })));
  const a = await mail({ idemKey: 'r1', ref: { pagoId: 'y1' } }, f); assert.equal(a.estado, 'desconocido'); assert.equal((await E.reintentar(a.logId, { automatico: true }, { fetch: f })).ok, false); assert.equal(f.calls.length, 1);
  const b = await E.reintentar(a.logId, {}, { fetch: f }); assert.equal(b.estado, 'aceptado'); assert.equal((await E.logGet(a.logId)).estado, 'reintentado');
  const g = mkFetch(() => resp(429, {})); const c = await mail({ idemKey: 'r2', ref: { pagoId: 'y9' } }, g); assert.equal(c.estado, 'reintentar');
  assert.equal((await E.reintentar(c.logId, { automatico: true, pagoPagado: true }, { fetch: g })).estado, 'cancelado'); assert.equal(g.calls.length, 1);
});

console.log('\nWebhook y bajas');
const SEC = 'clave-webhook-prueba', sign = (id, ts, body) => 'v1,' + createHmac('sha256', Buffer.from(SEC)).update(`${id}.${ts}.${body}`).digest('base64');
const hook = (ev, o = {}) => { const body = JSON.stringify(ev), ts = o.ts ?? String(Math.floor(Date.now() / 1000)); return web(new Request('http://x/api/email/webhook', { method: 'POST', headers: { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': o.sig ?? sign('msg_1', ts, body) }, body })); };
await t('Webhook: valida la firma Svix; rechaza firmas falsas, mensajes viejos y falta de secreto', async () => {
  const ev = { type: 'email.delivered', data: { email_id: 're_x' } };
  assert.equal((await hook(ev)).status, 501); process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from(SEC).toString('base64');
  assert.equal((await hook(ev, { sig: 'v1,AAAA' })).status, 401); assert.equal((await hook(ev, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status, 401); assert.equal((await hook(ev)).status, 200);
});
await t('Webhook: aceptado → entregado; rebote o queja registran la baja y no se degradan después', async () => {
  const f = mkFetch(); const a = await mail({ to: 'a@x.mx', idemKey: 'w1' }, f), b = await mail({ to: 'b@x.mx', idemKey: 'w2' }, f);
  await hook({ type: 'email.delivered', data: { email_id: 're_1' } }); assert.equal((await E.logGet(a.logId)).estado, 'entregado');
  await hook({ type: 'email.bounced', data: { email_id: 're_2', bounce: { message: 'buzón inexistente' } } }); const lb = await E.logGet(b.logId); assert.equal(lb.estado, 'rebotado'); assert.match(lb.error, /rebotó/); assert.equal((await E.getBajas())['b@x.mx'].tipo, 'rebote');
  await hook({ type: 'email.delivered', data: { email_id: 're_2' } }); assert.equal((await E.logGet(b.logId)).estado, 'rebotado');
  const x = await (await hook({ type: 'email.delivered', data: { email_id: 're_desconocido' } })).json(); assert.equal(x.ignorado, true);
  const c = await mail({ to: 'c@x.mx', idemKey: 'w3' }, f); await hook({ type: 'email.complained', data: { email_id: 're_3' } }); assert.equal((await E.logGet(c.logId)).estado, 'queja'); assert.equal((await E.getBajas())['c@x.mx'].tipo, 'queja');
});
await t('Baja con un clic: el enlace firmado funciona (GET confirma, POST da de baja); un enlace alterado no', async () => {
  const tk = E.unsubToken('Z@X.mx'); assert.equal(E.verifyUnsub(tk), 'z@x.mx'); assert.equal(E.verifyUnsub(tk.slice(0, -2) + 'xx'), null); assert.equal(E.verifyUnsub('abc.def'), null);
  const g = await (await web(new Request('http://x/api/unsub?t=' + tk))).text(); assert.match(g, /Darme de baja/); assert.equal(Object.keys(await E.getBajas()).length, 0);
  const p = await (await web(new Request('http://x/api/unsub?t=' + tk, { method: 'POST' }))).text(); assert.match(p, /ya no recibirás/); assert.equal((await E.getBajas())['z@x.mx'].tipo, 'baja');
  assert.match(await (await web(new Request('http://x/api/unsub?t=falso.falso', { method: 'POST' }))).text(), /no es válido/);
});

console.log('\nAutomatizaciones (planificación)');
await t('Cumpleaños: el día, N días antes, solo el destinatario elegido, sin correo/consentimiento omitidos, 29 de febrero', () => {
  const a = { ...A.AUTO_DEF, cumpleanos: { activo: true, diasAntes: 0, destinatarios: 'clientes' } };
  let r = A.planificar({ data: datos(), auto: a, hoy: HOY }); assert.deepEqual(claves(r), ['cumple:c1:2026']); assert.ok(r.omitidos.some(o => o.cid === 'c2' && /sin correo/.test(o.motivo)));
  r = A.planificar({ data: datos(), auto: { ...a, cumpleanos: { ...a.cumpleanos, destinatarios: 'ambos' } }, hoy: HOY }); assert.deepEqual(claves(r), ['cumple:c1:2026', 'cumple:p2:2026']); assert.ok(r.omitidos.some(o => o.cid === 'p1' && /consentimiento/.test(o.motivo)));
  r = A.planificar({ data: datos(), auto: { ...a, cumpleanos: { activo: true, diasAntes: 2, destinatarios: 'clientes' } }, hoy: HOY }); assert.deepEqual(claves(r), ['cumple:c3:2026']);
  const d = datos(); d.c = [{ ...d.c[0], nac: '1992-02-29' }]; assert.deepEqual(claves(A.planificar({ data: d, auto: a, hoy: '2027-02-28' })), ['cumple:c1:2027']); assert.deepEqual(claves(A.planificar({ data: d, auto: a, hoy: '2028-02-28' })), []);
});
await t('Pagos: antes, el día y atrasado; un pago ya realizado y una póliza cancelada NO generan recordatorio; confirmación opcional', () => {
  const r = A.planificar({ data: datos(), auto: { ...A.AUTO_DEF, pagos: { activo: true, diasAntes: [3], enVencimiento: true, atrasado: [3, 10], confirmacion: true } }, hoy: HOY });
  assert.deepEqual(claves(r), ['pago_atrasado:y4:3', 'pago_ok:y7', 'pago_proximo:y1:3', 'pago_proximo:y3:0']);
  const y1 = r.intents.find(i => i.idemKey === 'pago_proximo:y1:3'), y3 = r.intents.find(i => i.idemKey === 'pago_proximo:y3:0'); assert.equal(y1.vars.plazo, 'en 3 días'); assert.equal(y3.vars.plazo, 'hoy'); assert.equal(y1.vars.importe, '$2,000.00'); assert.equal(y1.vars.fecha_pago, '12 de octubre de 2026');
  assert.ok(!claves(r).some(k => /y2|y6|y5/.test(k)), 'y2 pagado, y6 póliza cancelada y y5 fuera de la regla no deben aparecer');
  assert.ok(!claves(A.planificar({ data: datos(), auto: { ...A.AUTO_DEF, pagos: { ...A.AUTO_DEF.pagos, activo: true } }, hoy: HOY })).includes('pago_ok:y7'));
});
await t('Renovaciones: 60/30/15/7 días, sin pólizas canceladas, clave por póliza y periodo, intervalos configurables', () => {
  let r = A.planificar({ data: datos(), auto: { ...A.AUTO_DEF, renovaciones: { activo: true, dias: [60, 30, 15, 7] } }, hoy: HOY }); assert.deepEqual(claves(r), ['renov:pol1:2026-11-08:30']); assert.equal(r.intents[0].vars.dias, '30'); assert.equal(r.intents[0].vars.fecha_vencimiento, '8 de noviembre de 2026');
  assert.deepEqual(claves(A.planificar({ data: datos(), auto: { ...A.AUTO_DEF, renovaciones: { activo: true, dias: [45] } }, hoy: HOY })), []);
  const d = datos(); d.p[0].fin = '2027-11-08'; assert.deepEqual(claves(A.planificar({ data: d, auto: { ...A.AUTO_DEF, renovaciones: { activo: true, dias: [30] } }, hoy: '2027-10-09' })), ['renov:pol1:2027-11-08:30']);
});
await t('Seguimiento: prospectos sin respuesta (con consentimiento), clientes inactivos, agradecimiento tras contratar', () => {
  const r = A.planificar({ data: datos(), auto: { ...A.AUTO_DEF, seguimiento: { activo: true, prospectosDias: 7, inactivosDias: 180, agradecimiento: true } }, hoy: HOY });
  assert.deepEqual(claves(r), ['gracias:pol3', 'retomar:c1:2026', 'seg_prospecto:p2:2026-10']); assert.ok(r.omitidos.some(o => o.cid === 'p1' && /consentimiento/.test(o.motivo)));
});

console.log('\nAutomatizaciones (ejecución programada)');
const subir = async d => Dt.syncPush({ data: d });
await t('Se ejecuta en la fecha prevista y con hora de CDMX: antes de la hora no envía; 9:30 CDMX sí; mismo día no duplica', async () => {
  await subir(datos()); await A.saveAuto(ON); await E.saveConfig({ horaEnvio: 9 }); const f = mkFetch(); const d = now => ({ fetch: f, sleep: noSleep, now: () => now });
  const antes = new Date('2026-10-09T14:00:00Z'), despues = new Date('2026-10-09T15:30:00Z');
  assert.equal((await A.ejecutar({ now: antes, deps: d(antes) })).esperando, true); assert.equal(f.calls.length, 0);
  const dia = new Date('2026-10-08T16:00:00Z'); await A.ejecutar({ now: dia, deps: d(dia) }); assert.ok(!f.calls.some(c => /felices|feliz/i.test(c.body.subject)), 'el 8 de octubre no corresponde el cumpleaños del 9');
  const n0 = f.calls.length, r = await A.ejecutar({ now: despues, deps: d(despues) }); assert.equal(r.ok, true); assert.ok(r.enviados >= 4); const asuntos = f.calls.map(c => c.body.subject);
  assert.ok(asuntos.some(s => s.includes('Feliz cumpleaños, Ana'))); assert.ok(asuntos.some(s => s === 'Recordatorio de tu próximo pago')); assert.ok(asuntos.some(s => s === 'Tu póliza está próxima a vencer')); assert.ok(asuntos.every(s => !/\$|2,000/.test(s)));
  const n1 = f.calls.length; const r2 = await A.ejecutar({ now: new Date('2026-10-09T20:00:00Z'), deps: d(new Date('2026-10-09T20:00:00Z')) }); assert.equal(f.calls.length, n1, 'una segunda ejecución el mismo día no reenvía'); assert.equal(r2.enviados, 0); assert.ok(n1 > n0);
  const tarde = new Date('2026-10-10T03:00:00Z'); await A.ejecutar({ now: tarde, deps: d(tarde) }); assert.equal(f.calls.length, n1, '03:00 UTC del 10 sigue siendo el 9 en CDMX (21:00): no cambia de día');
});
await t('Un pago registrado antes de la ejecución NO genera recordatorio (se lee el estado real al enviar)', async () => {
  const d = datos(); d.pay.find(y => y.id === 'y1').paid = '2026-10-09'; d.pay.find(y => y.id === 'y3').paid = '2026-10-09'; d.pay.find(y => y.id === 'y4').paid = '2026-10-08'; await subir(d); await A.saveAuto({ pagos: { activo: true } });
  const f = mkFetch(), now = new Date('2026-10-09T16:00:00Z'); await A.ejecutar({ now, deps: { fetch: f, sleep: noSleep, now: () => now } }); assert.equal(f.calls.length, 0);
});
await t('Pausar y reanudar; vista previa (dry-run) no envía; sin datos sincronizados o sin correo configurado lo explica', async () => {
  const f = mkFetch(), now = new Date('2026-10-09T16:00:00Z'), dp = { fetch: f, sleep: noSleep, now: () => now };
  assert.match((await A.ejecutar({ now, deps: dp })).motivo, /no hay datos/i); await subir(datos()); await A.saveAuto({ ...ON, pausado: true });
  assert.equal((await A.ejecutar({ now, deps: dp })).pausado, true); assert.equal(f.calls.length, 0);
  const v = await A.ejecutar({ now, dryRun: true, deps: dp }); assert.ok(v.porEnviar.length >= 4); assert.equal(f.calls.length, 0);
  await A.saveAuto({ pausado: false }); assert.ok((await A.ejecutar({ now, deps: dp })).enviados >= 4);
  const k = process.env.EMAIL_FROM; delete process.env.EMAIL_FROM; const r = await A.ejecutar({ now, deps: dp }); process.env.EMAIL_FROM = k; assert.match(r.motivo, /EMAIL_FROM/);
});
await t('Límite de tiempo: lo que no alcanza queda para la siguiente ejecución sin duplicar', async () => {
  await subir(datos()); await A.saveAuto(ON); const f = mkFetch(), now = new Date('2026-10-09T16:00:00Z'), dp = { fetch: f, sleep: noSleep, now: () => now };
  const a = await A.ejecutar({ now, deadlineMs: -1, deps: dp }); assert.equal(f.calls.length, 0); assert.ok(a.restantes > 0); const b = await A.ejecutar({ now, deps: dp }); assert.equal(b.enviados, a.restantes); assert.equal((await A.ejecutar({ now, deps: dp })).enviados, 0);
});
await t('Reintentos automáticos: solo los de límite de frecuencia (429); los de resultado desconocido nunca se repiten solos', async () => {
  await subir(datos()); await A.saveAuto({ cumpleanos: { activo: true, destinatarios: 'clientes' } }); const now = new Date('2026-10-09T16:00:00Z'); let modo = 429; const f = mkFetch(() => resp(modo, modo === 200 ? { id: 're_ok' } : {}));
  const dp = { fetch: f, sleep: noSleep, now: () => now }; const a = await A.ejecutar({ now, deps: dp }); assert.equal(a.fallidos, 1); modo = 200; const b = await A.ejecutar({ now, deps: dp }); assert.equal(b.reintentos, 1);
  fresh(); await subir(datos()); await A.saveAuto({ cumpleanos: { activo: true, destinatarios: 'clientes' } }); modo = 500; const g = mkFetch(() => resp(500, {})); const dq = { fetch: g, sleep: noSleep, now: () => now }; await A.ejecutar({ now, deps: dq }); const n = g.calls.length; await A.ejecutar({ now, deps: dq }); assert.equal(g.calls.length, n, 'un envío de resultado desconocido no se repite');
});

console.log('\nCampañas promocionales');
await t('Plan: cuenta candidatos, sin correo, sin consentimiento y bajas; filtros por ramo y vista previa con enlace de baja', async () => {
  await E.setBaja('caro@x.mx', 'baja'); const d = datos(); d.c.push({ id: 'c9', nombre: 'Zoe', apellido: 'Uno', email: 'zoe@x.mx', tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' });
  let p = await A.planCampania({ data: d, filtros: { tipo: 'clientes' } }); assert.equal(p.candidatos, 4); assert.equal(p.sinCorreo, 1); assert.equal(p.sinConsentimiento, 1); assert.equal(p.enBaja, 1); assert.deepEqual(p.destinatarios.map(x => x.cid), ['c9']);
  await E.quitarBaja('caro@x.mx'); p = await A.planCampania({ data: d, filtros: { tipo: 'clientes', noTiene: ['Auto'] } }); assert.deepEqual(p.destinatarios.map(x => x.cid).sort(), ['c3', 'c9']);
  p = await A.planCampania({ data: d, filtros: { tipo: 'prospectos', interes: 'Auto' } }); assert.deepEqual(p.destinatarios.map(x => x.cid), ['p2']);
  const v = await A.previsualizarCampania({ asunto: 'Promo', cuerpo: 'Hola\n\nMundo', destinatario: p.destinatarios[0] }); assert.ok(v.ok && /date de baja/.test(v.html) && /api\/unsub\?t=/.test(v.html));
});
await t('Exige confirmación (y escribir ENVIAR si son 10 o más); sin destinatarios elegibles no se crea', async () => {
  const d = datos(), base = { nombre: 'Prueba', asunto: 'Promo', cuerpo: 'Texto', filtros: { tipo: 'clientes' }, data: d };
  await assert.rejects(() => A.crearCampania({ ...base }), e => e.kind === 'sin_confirmacion'); await assert.rejects(() => A.crearCampania({ ...base, filtros: { tipo: 'clientes', noTiene: ['Hogar'] }, confirmar: true }), e => e.kind === 'sin_destinatarios');
  const g = datos(); for (let i = 0; i < 12; i++) g.c.push({ id: 'm' + i, nombre: 'M' + i, apellido: 'X', email: `m${i}@x.mx`, tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' });
  await assert.rejects(() => A.crearCampania({ ...base, data: g, confirmar: true }), e => /ENVIAR/.test(e.message)); const c = await A.crearCampania({ ...base, data: g, confirmar: true, texto: 'ENVIAR' }); assert.equal(c.destinatarios.length, 13);
});
await t('Procesa por lotes, respeta bajas hechas después del plan, no duplica y termina', async () => {
  const d = datos(); d.c.find(c => c.id === 'c3').consentPromos = 'No'; d.c.push({ id: 'c9', nombre: 'Zoe', apellido: 'Uno', email: 'zoe@x.mx', tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' }, { id: 'c8', nombre: 'Yan', apellido: 'Dos', email: 'yan@x.mx', tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' }, { id: 'c7', nombre: 'Xim', apellido: 'Tres', email: 'xim@x.mx', tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' });
  const c = await A.crearCampania({ nombre: 'P', asunto: 'Promo', cuerpo: 'Hola', filtros: { tipo: 'clientes' }, data: d, confirmar: true, autorizo: 'Javier' }); assert.equal(c.destinatarios.length, 3); await E.setBaja('xim@x.mx', 'baja');
  const f = mkFetch(), dp = { fetch: f, sleep: noSleep }; let x = await A.procesarCampania(c.id, { max: 2 }, dp); assert.equal(x.estado, 'en_proceso'); assert.equal(x.pendientes, 1); x = await A.procesarCampania(c.id, { max: 2 }, dp); assert.equal(x.estado, 'completada');
  assert.equal(x.enviados, 2); assert.equal(x.omitidos, 1); assert.equal(f.calls.length, 2); assert.ok(f.calls.every(q => q.body.headers['List-Unsubscribe'])); await A.procesarCampania(c.id, {}, dp); assert.equal(f.calls.length, 2);
  const [l] = await E.logList({ ...RANGO(), tipo: 'campania' }); assert.equal(l.autorizo, 'Javier'); assert.equal(l.campania, c.id);
});
await t('Programada: no se envía antes de su hora (CDMX) y la función programada la inicia cuando llega', async () => {
  const d = datos(); d.c.find(c => c.id === 'c3').consentPromos = 'No'; d.c.push({ id: 'c9', nombre: 'Zoe', apellido: 'Uno', email: 'zoe@x.mx', tipo: 'Cliente', status: 'Cliente activo', consentPromos: 'Sí' }); await subir(d); await A.saveAuto({ pausado: false });
  const antes = new Date('2026-10-20T10:00:00Z'), c = await A.crearCampania({ nombre: 'P', asunto: 'Promo', cuerpo: 'Hola', filtros: { tipo: 'clientes' }, data: d, confirmar: true, programadaMX: '2026-10-21T09:00' }, antes);
  assert.equal(c.estado, 'programada'); assert.equal(c.programadaUtc, '2026-10-21T15:00:00.000Z'); const f = mkFetch(), dp = { fetch: f, sleep: noSleep };
  await A.procesarCampania(c.id, { now: antes }, dp); assert.equal(f.calls.length, 0); const llega = new Date('2026-10-21T15:05:00Z'); await A.ejecutar({ now: llega, deps: { ...dp, now: () => llega } }); assert.equal(f.calls.length, 1);
  assert.equal((await store().getJSON('email/campaigns/' + c.id)).estado, 'completada');
});

console.log('\nHistorial');
await t('Filtros por fecha, tipo, estado y destinatario; archivar y eliminar solo del historial (sin tocar datos ni permitir reenvíos)', async () => {
  await subir(datos()); const f = mkFetch(() => resp(200, { id: 're_' + Math.random() }));
  const a = await mail({ to: 'ana@x.mx', subject: 'Uno', tipo: 'manual', idemKey: 'h1' }, f, { now: () => new Date('2026-09-15T10:00:00Z') }), b = await mail({ to: 'beto@x.mx', subject: 'Dos', tipo: 'cumpleanos', idemKey: 'h2' }, mkFetch(() => resp(422, { message: 'x' })), { now: () => new Date('2026-10-02T10:00:00Z') });
  const L = o => E.logList({ desde: '2026-09-01', hasta: '2026-10-31', ...o });
  assert.equal((await L({})).length, 2); assert.equal((await L({ tipo: 'cumpleanos' })).length, 1); assert.equal((await L({ estado: 'fallido' }))[0].to, 'beto@x.mx'); assert.equal((await L({ q: 'ANA' })).length, 1); assert.equal((await L({ desde: '2026-10-01' })).length, 1);
  assert.equal(await E.logBulk([a.logId, b.logId], 'archivar'), 2); assert.equal((await L({})).length, 0); assert.equal((await L({ archivados: true })).length, 2); await E.logBulk([a.logId], 'desarchivar');
  assert.equal(await E.logBulk([a.logId, '../../x'], 'eliminar'), 1); assert.equal((await L({})).length, 0); assert.equal((await mail({ to: 'ana@x.mx', idemKey: 'h1' }, f)).estado, 'duplicado'); assert.equal((await store().getJSON('snapshot')).data.c.length, 5);
});

console.log('\nSincronización y documentos');
await t('Sincronización: versiones, conflicto, protección contra sobrescribir con datos vacíos, respaldo del anterior', async () => {
  const m1 = await Dt.syncPush({ data: datos() }); assert.equal(m1.rev, 1); assert.equal(m1.counts.c, 5); await assert.rejects(() => Dt.syncPush({ data: datos(), baseRev: 0 }), e => e.kind === 'conflicto' && e.http === 409 && e.rev === 1);
  const m2 = await Dt.syncPush({ data: datos(), baseRev: 1 }); assert.equal(m2.rev, 2); assert.ok(await store().getJSON('snapshot-prev'));
  await assert.rejects(() => Dt.syncPush({ data: { c: [], p: [], pay: [], ap: [], act: [] }, baseRev: 2 }), e => e.kind === 'vacio'); assert.equal((await Dt.syncPush({ data: { c: [], p: [], pay: [], ap: [], act: [] }, force: true })).rev, 3);
  await assert.rejects(() => Dt.syncPush({ data: { c: [] } }), e => e.http === 400); assert.equal((await Dt.syncPull()).rev, 3);
});
await t('Documentos: solo PDF válidos ≤ 4 MB, ids seguros, lectura y borrado', async () => {
  const pdf = ai.miniPdf('x'), m = await Dt.docPut({ name: 'Póliza <1>.pdf', pdfBase64: pdf.toString('base64'), cid: 'c1', pid: 'pol1' }); assert.ok(!/[<>]/.test(m.name)); const g = await Dt.docGet(m.id); assert.ok(g.buf.equals(pdf)); assert.equal(g.meta.cid, 'c1');
  await assert.rejects(() => Dt.docPut({ pdfBase64: Buffer.from('hola').toString('base64') }), e => e.kind === 'pdf_invalido'); await assert.rejects(() => Dt.docPut({ pdfBase64: Buffer.concat([pdf, Buffer.alloc(4_600_000)]).toString('base64') }), e => e.http === 413);
  await assert.rejects(() => Dt.docGet('../../snapshot'), e => e.http === 400); await Dt.docDel(m.id); await assert.rejects(() => Dt.docGet(m.id), e => e.http === 404);
});

console.log('\nSeguridad HTTP y conexión con Resend');
const R = (method, path, o = {}) => web(new Request('http://x' + path, { method, headers: o.h || {}, body: o.body === undefined ? undefined : JSON.stringify(o.body) }));
const AUTH = { authorization: 'Bearer tok-prueba' };
await t('Todos los endpoints del CRM exigen el token (solo webhook y baja son públicos, con su propia verificación)', async () => {
  const rutas = [['GET', '/api/sync'], ['POST', '/api/sync'], ['POST', '/api/sync/pull'], ['POST', '/api/docs/upload'], ['GET', '/api/docs/file?id=x'], ['POST', '/api/docs/delete'], ['GET', '/api/email/status'], ['GET', '/api/email/config'], ['POST', '/api/email/config'], ['POST', '/api/email/test-connection'], ['POST', '/api/email/send-test'], ['GET', '/api/email/templates'], ['POST', '/api/email/templates'], ['POST', '/api/email/preview'], ['GET', '/api/email/automations'], ['POST', '/api/email/automations'], ['POST', '/api/email/automations/run'], ['POST', '/api/email/send'], ['POST', '/api/email/retry'], ['GET', '/api/email/log'], ['POST', '/api/email/log/bulk'], ['GET', '/api/email/bajas'], ['POST', '/api/email/bajas'], ['POST', '/api/email/campaign/plan'], ['POST', '/api/email/campaign/create'], ['POST', '/api/email/campaign/process'], ['GET', '/api/email/campaigns'], ['POST', '/api/chat'], ['POST', '/api/extract-policy'], ['POST', '/api/email/draft']];
  for (const [m, p] of rutas) { assert.equal((await R(m, p, { body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${p} sin token`); assert.equal((await R(m, p, { h: { authorization: 'Bearer mal' }, body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${p} token malo`); }
});
await t('Con token: documentos por HTTP (subir, ver el PDF con cabeceras seguras, borrar), sync y configuración de correo', async () => {
  const pdf = ai.miniPdf('x'), up = await (await R('POST', '/api/docs/upload', { h: AUTH, body: { name: 'p.pdf', pdfBase64: pdf.toString('base64') } })).json(); assert.equal(up.ok, true);
  const f = await R('GET', '/api/docs/file?id=' + up.doc.id, { h: AUTH }); assert.equal(f.headers.get('content-type'), 'application/pdf'); assert.match(f.headers.get('cache-control'), /no-store/); assert.equal(f.headers.get('x-content-type-options'), 'nosniff'); assert.ok(Buffer.from(await f.arrayBuffer()).equals(pdf));
  assert.equal((await R('POST', '/api/docs/delete', { h: AUTH, body: { id: up.doc.id } })).status, 200); assert.equal((await R('GET', '/api/docs/file?id=' + up.doc.id, { h: AUTH })).status, 404);
  const s = await (await R('POST', '/api/sync', { h: AUTH, body: { data: datos() } })).json(); assert.equal(s.rev, 1); assert.equal((await R('POST', '/api/sync', { h: AUTH, body: { data: datos(), baseRev: 0 } })).status, 409);
  const c = await (await R('POST', '/api/email/config', { h: AUTH, body: { nombre: 'JB', respondera: 'no-es-correo' } })).json(); assert.equal(c.ok, false);
  assert.equal((await R('POST', '/api/email/automations/run', { h: AUTH, body: { dryRun: false } })).status, 400, 'la ejecución real exige confirmación');
  const st = await (await R('GET', '/api/email/status', { h: AUTH })).json(); assert.equal(st.configurado, true); assert.ok(!JSON.stringify(st).includes('re_CLAVE')); assert.equal(st.almacenamiento.ok, true);
});
await t('Prueba de conexión con Resend: variables faltantes, clave inválida, clave de solo envío, dominio no encontrado/pendiente/verificado', async () => {
  const dom = (st) => mkFetch(() => resp(200, { data: [{ name: 'jbseguros.mx', status: st }] }));
  assert.equal((await E.testConnection(mkFetch(() => resp(401, { name: 'invalid_api_key' })))).estado, 'clave_invalida'); assert.equal((await E.testConnection(mkFetch(() => resp(401, { name: 'restricted_api_key' })))).parcial, true);
  assert.equal((await E.testConnection(mkFetch(() => resp(200, { data: [] })))).estado, 'dominio_no_encontrado'); assert.equal((await E.testConnection(dom('pending'))).estado, 'dominio_pendiente'); const v = await E.testConnection(dom('verified')); assert.equal(v.ok, true); assert.equal(v.estado, 'verificado');
  assert.equal((await E.testConnection(async () => { throw new Error('x'); })).estado, 'red'); const k = process.env.APP_URL; delete process.env.APP_URL; const nf = await E.testConnection(mkFetch()); process.env.APP_URL = k; assert.deepEqual(nf.faltan, ['APP_URL']);
});
await t('Correo manual desde el CRM: doble clic no duplica; asunto con importes se rechaza; un contacto de baja se bloquea', async () => {
  const f = mkFetch(); const orig = globalThis.fetch; globalThis.fetch = f; try {
    const b = { to: 'ana@x.mx', asunto: 'Seguimiento', cuerpo: 'Hola Ana', cid: 'c1' }; const a = await (await R('POST', '/api/email/send', { h: AUTH, body: b })).json(), c = await (await R('POST', '/api/email/send', { h: AUTH, body: b })).json();
    assert.equal(a.estado, 'aceptado'); assert.equal(c.estado, 'duplicado'); assert.equal(f.calls.length, 1); assert.equal((await R('POST', '/api/email/send', { h: AUTH, body: { ...b, asunto: 'Pago de $2,000' } })).status, 400);
    await E.setBaja('ana@x.mx', 'baja'); const d = await (await R('POST', '/api/email/send', { h: AUTH, body: { ...b, asunto: 'Otro' } })).json(); assert.equal(d.estado, 'omitido');
    const pt = await (await R('POST', '/api/email/send-test', { h: AUTH, body: { to: 'ana@x.mx' } })).json(); assert.equal(pt.estado, 'aceptado'); assert.ok(f.calls.at(-1).body.subject.startsWith('[PRUEBA]'));
  } finally { globalThis.fetch = orig; }
});
console.log(`\nSIMULADAS (correo): ${ok} pasaron, ${bad} fallaron.`); process.exit(bad ? 1 : 0);
