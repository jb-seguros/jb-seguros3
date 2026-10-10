// AUTOMATIZACIONES Y CAMPAÑAS DE CORREO. Leen la copia de datos del CRM guardada en el servidor (no dependen de que el CRM esté abierto).
// Todo se calcula con la fecha/hora de America/Mexico_City (las funciones programadas de Netlify corren en UTC).
// Cada evento tiene una clave única (idempotencia): la misma felicitación/recordatorio/campaña no se envía dos veces.
import { randomUUID } from 'node:crypto';
import { store } from './store.mjs';
import { ramoOf } from './tools.mjs';
import { sendEmail, componer, getConfig, getBajas, bloqueado, emailStatus, idemHash, logList, reintentar, validEmail } from './email.mjs';
import { fecha, pesos, paragraphs } from './templates.mjs';

const TZ = 'America/Mexico_City';
export const hoyMX = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
export const horaMX = (d = new Date()) => +d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }) % 24;
const dd = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5), add = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10), leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const E = (m, http = 400, kind = 'solicitud') => Object.assign(new Error(m), { http, kind });

export const AUTO_DEF = {
  pausado: false,
  cumpleanos: { activo: false, diasAntes: 0, destinatarios: 'clientes' },
  pagos: { activo: false, diasAntes: [3], enVencimiento: true, atrasado: [3, 10], confirmacion: false },
  renovaciones: { activo: false, dias: [60, 30, 15, 7] },
  seguimiento: { activo: false, prospectosDias: 7, inactivosDias: 180, agradecimiento: true },
};
export async function getAuto() { const s = (await store().getJSON('email/auto')) || {}; return { pausado: !!s.pausado, ...Object.fromEntries(['cumpleanos', 'pagos', 'renovaciones', 'seguimiento'].map(k => [k, { ...AUTO_DEF[k], ...(s[k] || {}) }])) }; }
const nums = a => [...new Set((Array.isArray(a) ? a : String(a ?? '').split(',')).map(x => parseInt(x, 10)).filter(n => n >= 0 && n <= 365))].sort((x, y) => y - x);
export async function saveAuto(d) {
  const c = await getAuto(), b = v => v === true || v === 'true', n = (v, def, max = 3650) => Math.min(max, Math.max(0, parseInt(v, 10) || def));
  const x = { pausado: d.pausado === undefined ? c.pausado : b(d.pausado),
    cumpleanos: { activo: b(d.cumpleanos?.activo ?? c.cumpleanos.activo), diasAntes: n(d.cumpleanos?.diasAntes ?? c.cumpleanos.diasAntes, 0, 30), destinatarios: ['clientes', 'prospectos', 'ambos'].includes(d.cumpleanos?.destinatarios) ? d.cumpleanos.destinatarios : c.cumpleanos.destinatarios },
    pagos: { activo: b(d.pagos?.activo ?? c.pagos.activo), diasAntes: nums(d.pagos?.diasAntes ?? c.pagos.diasAntes), enVencimiento: b(d.pagos?.enVencimiento ?? c.pagos.enVencimiento), atrasado: nums(d.pagos?.atrasado ?? c.pagos.atrasado).filter(x => x > 0), confirmacion: b(d.pagos?.confirmacion ?? c.pagos.confirmacion) },
    renovaciones: { activo: b(d.renovaciones?.activo ?? c.renovaciones.activo), dias: nums(d.renovaciones?.dias ?? c.renovaciones.dias) },
    seguimiento: { activo: b(d.seguimiento?.activo ?? c.seguimiento.activo), prospectosDias: n(d.seguimiento?.prospectosDias ?? c.seguimiento.prospectosDias, 7), inactivosDias: n(d.seguimiento?.inactivosDias ?? c.seguimiento.inactivosDias, 180), agradecimiento: b(d.seguimiento?.agradecimiento ?? c.seguimiento.agradecimiento) } };
  await store().setJSON('email/auto', x); return x;
}

/* ---------- planificación (función pura: datos + reglas + fecha → qué corresponde enviar hoy) ---------- */
export function planificar({ data, auto, hoy }) {
  const intents = [], omitidos = [], pols = new Map(data.p.map(p => [p.id, p])), cls = new Map(data.c.map(c => [c.id, c]));
  const ult = new Map(); data.act.forEach(a => { if (!ult.get(a.cid) || a.fecha > ult.get(a.cid)) ult.set(a.cid, a.fecha); });
  const pro = c => c.tipo === 'Prospecto', consent = c => c.consentPromos === 'Sí';
  const emit = (c, tipo, plantilla, categoria, idemKey, vars, ref) => {
    if (!validEmail(c.email)) return omitidos.push({ tipo, cid: c.id, motivo: 'sin correo válido' });
    if (categoria === 'comercial' && !consent(c)) return omitidos.push({ tipo, cid: c.id, motivo: 'sin consentimiento para comunicaciones promocionales' });
    if (pro(c) && categoria !== 'servicio' && !consent(c)) return omitidos.push({ tipo, cid: c.id, motivo: 'prospecto sin consentimiento' });
    intents.push({ tipo, plantilla, categoria, idemKey, cid: c.id, to: c.email.trim().toLowerCase(), vars: { nombre: c.nombre, apellido: c.apellido, ...vars }, ref });
  };
  const A = auto.cumpleanos;
  if (A.activo) { const t = add(hoy, A.diasAntes || 0), md = t.slice(5), año = +t.slice(0, 4);
    for (const c of data.c) { if (!c.nac || c.status === 'Inactivo') continue; let m = c.nac.slice(5); if (m === '02-29' && !leap(año)) m = '02-28'; if (m !== md) continue;
      if ((A.destinatarios === 'clientes' && pro(c)) || (A.destinatarios === 'prospectos' && !pro(c))) continue;
      emit(c, 'cumpleanos', 'cumpleanos', 'relacion', `cumple:${c.id}:${año}`, {}, null); } }
  const P = auto.pagos;
  if (P.activo) for (const y of data.pay) { const p = pols.get(y.pid), c = p && cls.get(p.cid); if (!p || p.canc || !c || pro(c)) continue;
    const v = { fecha_pago: fecha(y.due), importe: pesos(y.monto), numero_poliza: p.num, ramo: ramoOf(p), referencia: y.ref || '' };
    if (!y.paid) { const d = dd(y.due, hoy);
      if (P.diasAntes.includes(d) || (P.enVencimiento && d === 0)) emit(c, 'pago_proximo', 'pago_proximo', 'servicio', `pago_proximo:${y.id}:${d}`, { ...v, plazo: d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días` }, { pagoId: y.id });
      else if (d < 0 && P.atrasado.includes(-d)) emit(c, 'pago_vencido', 'pago_vencido', 'servicio', `pago_atrasado:${y.id}:${-d}`, v, { pagoId: y.id });
    } else if (P.confirmacion && dd(y.paid, hoy) >= -2 && dd(y.paid, hoy) <= 0) emit(c, 'pago_confirmado', 'pago_confirmado', 'servicio', `pago_ok:${y.id}`, { ...v, fecha_pago: fecha(y.paid) }, { pagoId: y.id }); }
  const R = auto.renovaciones;
  if (R.activo) for (const p of data.p) { if (p.canc) continue; const c = cls.get(p.cid), d = dd(p.fin, hoy); if (!c || pro(c) || !R.dias.includes(d)) continue;
    emit(c, 'renovacion_proxima', 'renovacion_proxima', 'servicio', `renov:${p.id}:${p.fin}:${d}`, { numero_poliza: p.num, ramo: ramoOf(p), aseguradora: p.co, fecha_vencimiento: fecha(p.fin), dias: String(d) }, { polizaId: p.id }); }
  const S = auto.seguimiento;
  if (S.activo) {
    for (const c of data.c) { const u = ult.get(c.id) || c.alta || hoy;
      if (pro(c) && ['Contactado', 'Interesado'].includes(c.status) && dd(hoy, u) >= S.prospectosDias) emit(c, 'seguimiento_prospecto', 'seguimiento_prospecto', 'comercial', `seg_prospecto:${c.id}:${hoy.slice(0, 7)}`, {}, null);
      if (!pro(c) && c.status !== 'Inactivo' && dd(hoy, u) >= S.inactivosDias) emit(c, 'retomar_contacto', 'retomar_contacto', 'relacion', `retomar:${c.id}:${hoy.slice(0, 4)}`, {}, null); }
    if (S.agradecimiento) for (const p of data.p) { const c = cls.get(p.cid); if (p.canc || !c || pro(c) || !p.ini || dd(hoy, p.ini) < 0 || dd(hoy, p.ini) > 3) continue;
      emit(c, 'agradecimiento', 'agradecimiento', 'relacion', `gracias:${p.id}`, { numero_poliza: p.num, ramo: ramoOf(p) }, { polizaId: p.id }); } }
  return { intents, omitidos };
}

const resumen = i => ({ tipo: i.tipo, cid: i.cid, to: i.to, clave: i.idemKey });
async function enviarIntent(i, deps) {
  const c = await componer({ plantilla: i.plantilla, vars: i.vars, to: i.to });
  const base = { to: i.to, tipo: i.tipo, categoria: c.categoria, origen: 'automático', plantilla: i.plantilla, ref: i.ref, cid: i.cid, idemKey: i.idemKey, autorizo: 'Automatización', unsubUrl: c.unsubUrl };
  if (!c.ok) return sendEmail({ ...base, subject: c.asunto || i.tipo, omitir: `Falta el dato obligatorio: ${c.faltanRequeridas.join(', ')}.` }, deps);
  return sendEmail({ ...base, subject: c.asunto, html: c.html, text: c.text }, deps);
}

/* ---------- ejecución (la usa la función programada y el botón «Ejecutar ahora») ---------- */
export async function ejecutar({ manual = false, dryRun = false, now = new Date(), deadlineMs = 25000, deps = {} } = {}) {
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms))), t0 = Date.now(), st = emailStatus();
  if (!st.configurado) return { ok: false, motivo: `Correo sin configurar: faltan ${st.faltan.join(', ')}.` };
  const auto = await getAuto(), cfg = await getConfig(), hoy = hoyMX(now), hora = horaMX(now);
  if (auto.pausado && !dryRun) return { ok: true, pausado: true, enviados: 0, motivo: 'Las automatizaciones están en pausa.' };
  if (!manual && !dryRun && hora < cfg.horaEnvio) return { ok: true, esperando: true, enviados: 0, motivo: `Se envía a partir de las ${cfg.horaEnvio}:00 (hora de CDMX).` };
  const snap = await store().getJSON('snapshot'); if (!snap) return { ok: false, motivo: 'Aún no hay datos del CRM sincronizados con el servidor.' };
  const { intents, omitidos } = planificar({ data: snap.data, auto, hoy }), pend = [], ya = [];
  for (const i of intents) { const r = await store().getJSON('email/idem/' + idemHash(i.idemKey)); (r && r.estado !== 'reintentar' ? ya : pend).push(i); }
  if (dryRun) return { ok: true, dryRun: true, hoy, datosDe: snap.savedAt, porEnviar: pend.map(resumen), yaProcesados: ya.length, omitidos };
  const cont = { enviados: 0, fallidos: 0, desconocidos: 0, omitidos: 0, reintentos: 0, restantes: 0 }; const cuenta = r => { if (r.estado === 'aceptado') cont.enviados++; else if (r.estado === 'omitido') cont.omitidos++; else if (r.estado === 'desconocido') cont.desconocidos++; else if (r.estado !== 'duplicado') cont.fallidos++; };
  for (const i of pend) { if (Date.now() - t0 > deadlineMs) { cont.restantes++; continue; } cuenta(await enviarIntent(i, deps)); await sleep(550); }
  // reintentos: SOLO los que quedaron en «reintentar» (429). Los de estado desconocido nunca se repiten solos.
  for (const r of await logList({ estado: 'reintentar', desde: add(hoy, -7), hasta: hoy })) { if (Date.now() - t0 > deadlineMs || (r.intentos || 1) >= 3) continue;
    let pagado = false; if (r.ref?.pagoId) { const y = snap.data.pay.find(x => x.id === r.ref.pagoId); pagado = !!(y && y.paid) && r.tipo !== 'pago_confirmado'; }
    const x = await reintentar(r.id, { automatico: true, pagoPagado: pagado }, deps); if (x.estado === 'aceptado') cont.reintentos++; await sleep(550); }
  for (const c of await listaCampanias()) { if (Date.now() - t0 > deadlineMs) break;
    if (c.estado === 'programada' && c.programadaUtc <= now.toISOString()) await store().setJSON('email/campaigns/' + c.id, { ...c, estado: 'en_proceso' });
    if (['programada', 'en_proceso'].includes(c.estado) && c.programadaUtc <= now.toISOString()) await procesarCampania(c.id, { max: 20, deadline: t0 + deadlineMs, now }, deps); }
  const r = { ok: true, hoy, ...cont, planificados: intents.length, yaProcesados: ya.length, at: now.toISOString() }; await store().setJSON('email/run/last', r); return r;
}

/* ---------- campañas promocionales ---------- */
export async function planCampania({ data, filtros = {} }) {
  const tipo = ['clientes', 'prospectos', 'ambos'].includes(filtros.tipo) ? filtros.tipo : 'clientes', bajas = await getBajas();
  const tiene = (filtros.tiene || []).map(String), noTiene = (filtros.noTiene || []).map(String), pols = new Map();
  data.p.filter(p => !p.canc).forEach(p => { if (!pols.has(p.cid)) pols.set(p.cid, []); pols.get(p.cid).push(p); });
  const ram = id => new Set((pols.get(id) || []).map(ramoOf)), hoy = hoyMX();
  let cand = data.c.filter(c => c.status !== 'Inactivo' && (tipo === 'ambos' || (tipo === 'prospectos') === (c.tipo === 'Prospecto')));
  cand = cand.filter(c => c.tipo === 'Prospecto' ? (!filtros.interes || c.interes === filtros.interes) : tiene.every(r => ram(c.id).has(r)) && !noTiene.some(r => ram(c.id).has(r)) && (!filtros.soloVigentes || (pols.get(c.id) || []).some(p => p.fin >= hoy)));
  const sinCorreo = [], sinConsentimiento = [], enBaja = [], dest = [];
  for (const c of cand) { if (!validEmail(c.email)) sinCorreo.push(c.id); else if (c.consentPromos !== 'Sí') sinConsentimiento.push(c.id); else if (bloqueado(bajas[c.email.trim().toLowerCase()], 'comercial')) enBaja.push(c.id); else dest.push({ cid: c.id, email: c.email.trim().toLowerCase(), nombre: c.nombre, apellido: c.apellido }); }
  return { candidatos: cand.length, sinCorreo: sinCorreo.length, sinConsentimiento: sinConsentimiento.length, enBaja: enBaja.length, destinatarios: dest };
}
export async function previsualizarCampania({ asunto, cuerpo, destinatario }) {
  const c = await componer({ plantilla: 'promocion', override: { asunto }, vars: { nombre: destinatario?.nombre || 'Cliente', mensaje: paragraphs(cuerpo) }, to: destinatario?.email || 'correo@ejemplo.com' });
  return { asunto: c.asunto, html: c.html, ok: c.ok };
}
export const listaCampanias = async () => (await Promise.all((await store().list('email/campaigns/')).map(k => store().getJSON(k)))).filter(Boolean).sort((a, b) => b.creada.localeCompare(a.creada));
export async function crearCampania({ nombre, asunto, cuerpo, filtros, programadaMX, confirmar, texto, autorizo, data }, now = new Date()) {
  if (confirmar !== true) throw E('Debes confirmar el envío de la campaña.', 400, 'sin_confirmacion');
  const plan = await planCampania({ data, filtros }), n = plan.destinatarios.length;
  if (!n) throw E('La campaña no tiene destinatarios elegibles (con correo válido, consentimiento y sin baja).', 400, 'sin_destinatarios');
  if (n >= 10 && texto !== 'ENVIAR') throw E(`Para enviar a ${n} destinatarios escribe ENVIAR como confirmación.`, 400, 'sin_confirmacion');
  if (!String(asunto || '').trim() || !String(cuerpo || '').trim() || String(cuerpo).length > 5000) throw E('El asunto y el mensaje son obligatorios (mensaje máx. 5,000 caracteres).');
  let programadaUtc = now.toISOString(); if (programadaMX) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(programadaMX)) throw E('La fecha programada no es válida.'); programadaUtc = new Date(programadaMX + ':00-06:00').toISOString(); } // CDMX = UTC-6 (sin horario de verano desde 2022)
  const c = { id: randomUUID().slice(0, 12), nombre: String(nombre || 'Campaña').slice(0, 100), asunto: String(asunto).slice(0, 150), cuerpo: String(cuerpo), filtros: filtros || {}, destinatarios: plan.destinatarios, estado: programadaMX && programadaUtc > now.toISOString() ? 'programada' : 'en_proceso', programadaUtc, creada: now.toISOString(), autorizo: String(autorizo || 'Usuario del CRM').slice(0, 80), enviados: 0, fallidos: 0, omitidos: 0 };
  await store().setJSON('email/campaigns/' + c.id, c); return c;
}
export async function procesarCampania(id, { max = 8, deadline = Date.now() + 8000, now = new Date() } = {}, deps = {}) {
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms))), c = await store().getJSON('email/campaigns/' + id); if (!c) throw E('Campaña no encontrada.', 404, 'no_encontrado');
  if (!['en_proceso', 'programada'].includes(c.estado)) return c; if (c.estado === 'programada' && c.programadaUtc > now.toISOString()) return c;
  let hechos = 0; c.estado = 'en_proceso';
  for (const d of c.destinatarios) { if (hechos >= max || Date.now() > deadline) break;
    const k = `campania:${c.id}:${d.cid}`; if (await store().getJSON('email/idem/' + idemHash(k))) continue;
    const m = await componer({ plantilla: 'promocion', override: { asunto: c.asunto }, vars: { nombre: d.nombre, apellido: d.apellido, mensaje: paragraphs(c.cuerpo) }, to: d.email });
    const r = await sendEmail({ to: d.email, subject: m.asunto, html: m.html, text: m.text, unsubUrl: m.unsubUrl, tipo: 'campania', categoria: 'comercial', origen: 'manual', plantilla: 'promocion', cid: d.cid, campania: c.id, autorizo: c.autorizo, idemKey: k }, deps);
    r.estado === 'aceptado' ? c.enviados++ : r.estado === 'omitido' ? c.omitidos++ : r.estado !== 'duplicado' && c.fallidos++; hechos++; await sleep(550); }
  let pendientes = 0; for (const d of c.destinatarios) if (!(await store().getJSON('email/idem/' + idemHash(`campania:${c.id}:${d.cid}`)))) pendientes++;
  c.pendientes = pendientes; if (!pendientes) { c.estado = 'completada'; c.terminada = now.toISOString(); }
  await store().setJSON('email/campaigns/' + c.id, c); return c;
}
export async function cancelarCampania(id) { const c = await store().getJSON('email/campaigns/' + id); if (!c) throw E('Campaña no encontrada.', 404, 'no_encontrado'); if (c.estado === 'completada') return c; c.estado = 'cancelada'; await store().setJSON('email/campaigns/' + id, c); return c; }
