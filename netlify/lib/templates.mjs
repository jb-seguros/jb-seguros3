// Plantillas de correo (HTML responsivo con la identidad de JB SEGUROS) y motor de variables.
// Sintaxis: {{variable}} y bloques opcionales {{#variable}}…{{/variable}} (solo se muestran si la variable tiene valor).
// Nunca se muestra «undefined» ni etiquetas sin resolver: lo que falta se omite, y las plantillas declaran qué variables son obligatorias.
import { store } from './store.mjs';

export const VARS = ['nombre', 'apellido', 'fecha_pago', 'importe', 'numero_poliza', 'ramo', 'fecha_vencimiento', 'nombre_asesor', 'telefono_asesor', 'aseguradora', 'plazo', 'dias', 'referencia', 'mensaje'];
const RAW = new Set(['mensaje']); // HTML ya escapado por paragraphs()
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const paragraphs = t => String(t || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fecha = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${+s.slice(8)} de ${MES[+s.slice(5, 7) - 1]} de ${s.slice(0, 4)}` : '';
export const pesos = n => Number.isFinite(+n) && +n > 0 ? (+n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '';

const FIRMA = '<p style="margin:0">{{nombre_asesor}}<br><b>JB SEGUROS</b><br>{{telefono_asesor}}</p>';
const P = (s, id, nombre, categoria, asunto, requeridas, contenido) => ({ id, nombre, categoria, asunto, requeridas, contenido, firma: FIRMA });
export const DEFAULTS = [
  P(0, 'cumpleanos', 'Feliz cumpleaños', 'relacion', '¡Feliz cumpleaños, {{nombre}}!', ['nombre'],
    '<p>Hola {{nombre}},</p><p>Todo el equipo de JB SEGUROS te desea un día lleno de alegría y buenos momentos junto a quienes más quieres.</p><p>Gracias por permitirnos acompañarte y proteger lo que más importa.</p>'),
  P(0, 'pago_proximo', 'Próximo pago', 'servicio', 'Recordatorio de tu próximo pago', ['nombre', 'fecha_pago'],
    '<p>Hola {{nombre}},</p><p>Te recordamos que el pago de tu póliza{{#numero_poliza}} {{numero_poliza}}{{/numero_poliza}}{{#ramo}} ({{ramo}}){{/ramo}} vence {{plazo}}{{#fecha_pago}}, el {{fecha_pago}}{{/fecha_pago}}.</p>{{#importe}}<p>Importe: <b>{{importe}}</b>.</p>{{/importe}}{{#referencia}}<p>Referencia: {{referencia}}.</p>{{/referencia}}<p>Si ya realizaste tu pago, ignora este mensaje. Si tienes dudas, con gusto te ayudamos.</p>'),
  P(0, 'pago_vencido', 'Pago vencido', 'servicio', 'Aviso sobre un pago pendiente', ['nombre', 'fecha_pago'],
    '<p>Hola {{nombre}},</p><p>Notamos que el pago de tu póliza{{#numero_poliza}} {{numero_poliza}}{{/numero_poliza}} con fecha {{fecha_pago}} aparece como pendiente.</p>{{#importe}}<p>Importe: <b>{{importe}}</b>.</p>{{/importe}}<p>Para mantener tu protección vigente, te invitamos a regularizarlo lo antes posible. Si ya pagaste, avísanos para actualizar tu registro.</p>'),
  P(0, 'pago_confirmado', 'Confirmación de pago', 'servicio', 'Confirmación de tu pago', ['nombre', 'fecha_pago'],
    '<p>Hola {{nombre}},</p><p>Registramos tu pago del {{fecha_pago}}{{#numero_poliza}} correspondiente a tu póliza {{numero_poliza}}{{/numero_poliza}}. ¡Gracias!</p>{{#importe}}<p>Importe registrado: <b>{{importe}}</b>.</p>{{/importe}}'),
  P(0, 'renovacion_proxima', 'Próxima renovación', 'servicio', 'Tu póliza está próxima a vencer', ['nombre', 'fecha_vencimiento'],
    '<p>Hola {{nombre}},</p><p>Tu póliza{{#numero_poliza}} {{numero_poliza}}{{/numero_poliza}}{{#ramo}} de {{ramo}}{{/ramo}}{{#aseguradora}} con {{aseguradora}}{{/aseguradora}} vence el <b>{{fecha_vencimiento}}</b>{{#dias}} (en {{dias}} días){{/dias}}.</p><p>Con gusto revisamos tu renovación y las opciones disponibles para que sigas protegido. Contáctanos y lo vemos juntos.</p>'),
  P(0, 'renovacion_realizada', 'Renovación de póliza', 'servicio', 'Tu póliza fue renovada', ['nombre', 'numero_poliza'],
    '<p>Hola {{nombre}},</p><p>Tu póliza {{numero_poliza}}{{#ramo}} de {{ramo}}{{/ramo}} quedó renovada{{#fecha_vencimiento}} y estará vigente hasta el {{fecha_vencimiento}}{{/fecha_vencimiento}}.</p><p>Gracias por seguir confiando en nosotros.</p>'),
  P(0, 'promocion', 'Promoción comercial', 'comercial', 'Una propuesta de JB SEGUROS para ti', ['nombre', 'mensaje'],
    '<p>Hola {{nombre}},</p>{{mensaje}}'),
  P(0, 'seguimiento_prospecto', 'Seguimiento a prospecto', 'comercial', 'Seguimos a tus órdenes, {{nombre}}', ['nombre'],
    '<p>Hola {{nombre}},</p><p>Hace unos días platicamos sobre tus opciones de protección y quería saber si te surgió alguna duda.</p><p>Con gusto preparamos una propuesta a tu medida, sin compromiso.</p>'),
  P(0, 'agradecimiento', 'Agradecimiento por contratación', 'relacion', 'Gracias por confiar en JB SEGUROS', ['nombre'],
    '<p>Hola {{nombre}},</p><p>Gracias por contratar{{#ramo}} tu seguro de {{ramo}}{{/ramo}} con JB SEGUROS{{#numero_poliza}} (póliza {{numero_poliza}}){{/numero_poliza}}. Es un gusto acompañarte.</p><p>Cualquier duda sobre tu cobertura, estamos a tus órdenes.</p>'),
  P(0, 'retomar_contacto', 'Retomar contacto', 'relacion', 'Queremos saber cómo estás, {{nombre}}', ['nombre'],
    '<p>Hola {{nombre}},</p><p>Hace tiempo que no platicamos y queremos saber cómo estás y si tus seguros siguen cubriendo lo que necesitas.</p><p>Con gusto revisamos tu protección sin compromiso.</p>'),
];

/* ---------- seguridad del contenido ---------- */
export const limpiarHtml = h => String(h || '').replace(/<\s*(script|iframe|object|embed|style|link|meta|form)[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
export function validarAsunto(a) {
  const s = String(a || '').trim();
  if (!s || s.length > 150) return 'El asunto es obligatorio y debe tener máximo 150 caracteres.';
  if (/\{\{\s*(importe|referencia)\s*\}\}/i.test(s) || /\$\s?\d/.test(s)) return 'El asunto no debe incluir importes ni datos financieros.';
  return '';
}

/* ---------- plantillas guardadas (con las originales como base) ---------- */
export async function getTemplates() {
  const o = (await store().getJSON('email/templates')) || {};
  return DEFAULTS.map(t => ({ ...t, ...(o[t.id] || {}), id: t.id, nombre: t.nombre, categoria: t.categoria, requeridas: t.requeridas, personalizada: !!o[t.id] }));
}
export const getTemplate = async id => (await getTemplates()).find(t => t.id === id) || null;
export async function saveTemplate(id, { asunto, contenido, firma }) {
  if (!DEFAULTS.some(t => t.id === id)) throw Object.assign(new Error('Plantilla desconocida.'), { http: 404, kind: 'no_encontrado' });
  const err = validarAsunto(asunto); if (err) throw Object.assign(new Error(err), { http: 400, kind: 'asunto_invalido' });
  contenido = limpiarHtml(contenido); firma = limpiarHtml(firma);
  if (!contenido.trim() || contenido.length > 20000 || firma.length > 3000) throw Object.assign(new Error('El contenido es obligatorio (máx. 20,000 caracteres) y la firma máx. 3,000.'), { http: 400, kind: 'contenido_invalido' });
  const o = (await store().getJSON('email/templates')) || {}; o[id] = { asunto: String(asunto).trim(), contenido, firma }; await store().setJSON('email/templates', o);
  return getTemplate(id);
}
export async function resetTemplate(id) { const o = (await store().getJSON('email/templates')) || {}; delete o[id]; await store().setJSON('email/templates', o); return getTemplate(id); }

/* ---------- diseño HTML con la identidad de JB SEGUROS ---------- */
export function layout({ contenido, firma, preheader = '', baja = '', appUrl = '', telefono = '' }) {
  const logo = appUrl ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#f8f8f8;border-radius:10px;padding:4px"><img src="${esc(appUrl)}/logo-jb.jpg" width="150" alt="JB SEGUROS" style="display:block;border:0"></td></tr></table>` : '<span style="font:700 20px Arial,sans-serif;color:#fff;letter-spacing:2px">JB SEGUROS</span>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>JB SEGUROS</title><style>@media(max-width:620px){.w{width:100%!important}.p{padding:22px 18px!important}}</style></head><body style="margin:0;background:#eef3f9;font-family:Arial,Helvetica,sans-serif;color:#2c3a4f"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="w" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden"><tr><td style="background:#0a2a5e;background-image:linear-gradient(135deg,#0a2a5e,#0f5db8);padding:22px 28px">${logo}</td></tr><tr><td style="height:4px;background:#19b5c4;font-size:0;line-height:0">&nbsp;</td></tr><tr><td class="p" style="padding:30px 32px;font-size:16px;line-height:1.6;color:#2c3a4f">${contenido}<div style="margin-top:24px;color:#44546a;font-size:15px">${firma}</div></td></tr><tr><td style="background:#f5f8fc;padding:16px 32px;font-size:12px;line-height:1.5;color:#6b7a90">JB SEGUROS${telefono ? ' · ' + esc(telefono) : ''}${baja}</td></tr></table></td></tr></table></body></html>`;
}
const toText = h => h.replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

export function renderTemplate(tpl, vars, { appUrl = '', telefono = '', baja = '' } = {}) {
  const has = k => vars[k] !== undefined && vars[k] !== null && String(vars[k]).trim() !== '';
  const missing = new Set(), unknown = new Set();
  const sub = (str, escapar) => String(str)
    .replace(/\{\{#\s*([a-z_]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/gi, (_, k, inner) => has(k.toLowerCase()) ? inner : '')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => { k = k.toLowerCase(); if (!VARS.includes(k)) { unknown.add(k); return ''; } if (!has(k)) { missing.add(k); return ''; } return escapar && !RAW.has(k) ? esc(vars[k]) : String(vars[k]); });
  const asunto = sub(tpl.asunto, false).replace(/[\r\n]+/g, ' ').trim();
  const contenido = sub(tpl.contenido, true), firma = sub(tpl.firma || '', true);
  const faltanRequeridas = (tpl.requeridas || []).filter(k => !has(k));
  return { ok: !faltanRequeridas.length, asunto, html: layout({ contenido, firma, preheader: toText(contenido).slice(0, 110), baja, appUrl, telefono }), text: toText(contenido) + '\n\n' + toText(firma), faltantes: [...missing], desconocidas: [...unknown], faltanRequeridas };
}
