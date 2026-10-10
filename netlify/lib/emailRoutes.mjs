// Rutas autenticadas de sincronización, documentos y correo. (La IA y el diagnóstico viven en service.mjs / openai.mjs.)
import { store, storeStatus } from './store.mjs';
import * as E from './email.mjs';
import * as T from './templates.mjs';
import * as A from './automations.mjs';
import * as Dt from './data.mjs';
import { createHash } from 'node:crypto';
const bad = (m, http = 400, kind = 'solicitud') => Object.assign(new Error(m), { http, kind });
const validData = d => d && ['c', 'p', 'pay', 'ap', 'act'].every(k => Array.isArray(d[k]));
const datos = async d => { if (validData(d.data)) return d.data; const s = await store().getJSON('snapshot'); if (!s) throw bad('No hay datos del CRM: sincroniza o envía los datos con la solicitud.', 409, 'sin_datos'); return s.data; };
const MUESTRA = { nombre: 'Ana', apellido: 'López', fecha_pago: '15 de noviembre de 2026', importe: '$2,000.00', numero_poliza: 'GNP-123456789', ramo: 'Gastos Médicos Mayores', fecha_vencimiento: '30 de noviembre de 2026', aseguradora: 'GNP', plazo: 'en 3 días', dias: '30', referencia: 'REF-0001', mensaje: T.paragraphs('Este es un mensaje de ejemplo para la vista previa.\n\nSegundo párrafo de ejemplo.') };

export async function emailHandle(path, d = {}, ctx = {}) {
  const q = ctx.q || new URLSearchParams();
  switch (`${ctx.method || 'POST'} ${path}`) {
    case 'GET /api/sync': return await Dt.syncMeta();
    case 'POST /api/sync': return await Dt.syncPush(d);
    case 'POST /api/sync/pull': return await Dt.syncPull();
    case 'POST /api/docs/upload': return { doc: await Dt.docPut(d) };
    case 'POST /api/docs/delete': await Dt.docDel(d.id); return { eliminado: true };
    case 'GET /api/email/status': return { ...E.emailStatus(), almacenamiento: await storeStatus() };
    case 'GET /api/email/config': return { config: await E.getConfig() };
    case 'POST /api/email/config': return { config: await E.saveConfig(d) };
    case 'POST /api/email/test-connection': return await E.testConnection();
    case 'POST /api/email/send-test': {
      if (!E.validEmail(d.to)) throw bad('Escribe una dirección de correo válida para la prueba.');
      const c = await E.componer({ plantilla: d.plantilla || 'cumpleanos', override: d.override, vars: MUESTRA, to: d.to });
      return await E.sendEmail({ to: d.to, subject: '[PRUEBA] ' + c.asunto, html: c.html, text: c.text, tipo: 'prueba', categoria: 'servicio', origen: 'prueba', plantilla: c.plantilla, autorizo: 'Usuario del CRM', prueba: true, idemKey: `prueba:${Date.now()}:${Math.random()}` });
    }
    case 'GET /api/email/templates': return { templates: await T.getTemplates(), variables: T.VARS };
    case 'POST /api/email/templates': return { template: await T.saveTemplate(d.id, d) };
    case 'POST /api/email/templates/reset': return { template: await T.resetTemplate(d.id) };
    case 'POST /api/email/preview': { const c = await E.componer({ plantilla: d.plantilla, override: d.override, vars: { ...MUESTRA, ...(d.vars || {}) }, to: 'vista-previa@ejemplo.com' }); return { asunto: c.asunto, html: c.html, faltantes: c.faltantes, desconocidas: c.desconocidas, faltanRequeridas: c.faltanRequeridas }; }
    case 'GET /api/email/automations': return { auto: await A.getAuto(), ultima: await store().getJSON('email/run/last'), config: await E.getConfig(), datos: await Dt.syncMeta() };
    case 'POST /api/email/automations': return { auto: await A.saveAuto(d.auto || d) };
    case 'POST /api/email/automations/run': { const real = d.dryRun === false; if (real && d.confirmar !== true) throw bad('Confirma la ejecución real para enviar correos ahora.', 400, 'sin_confirmacion'); return await A.ejecutar({ manual: true, dryRun: !real }); }
    case 'POST /api/email/send': {
      if (!E.validEmail(d.to)) throw bad('El destinatario no es un correo válido.'); if (!String(d.asunto || '').trim() || !String(d.cuerpo || '').trim() || String(d.cuerpo).length > 5000) throw bad('Asunto y mensaje son obligatorios (mensaje máx. 5,000 caracteres).');
      const err = T.validarAsunto(d.asunto); if (err) throw bad(err, 400, 'asunto_invalido');
      const c = await E.componer({ plantilla: 'promocion', override: { asunto: d.asunto, contenido: '{{mensaje}}' }, vars: { nombre: 'Cliente', mensaje: T.paragraphs(d.cuerpo) }, to: d.to });
      const h = createHash('sha256').update(d.to + '|' + d.asunto + '|' + d.cuerpo).digest('hex').slice(0, 16);
      return await E.sendEmail({ to: d.to, subject: c.asunto, html: c.html, text: c.text, unsubUrl: c.unsubUrl, tipo: 'manual', categoria: 'manual', origen: 'manual', cid: d.cid, autorizo: String(d.autorizo || 'Usuario del CRM').slice(0, 80), idemKey: `manual:${h}:${Math.floor(Date.now() / 6e5)}` });
    }
    case 'POST /api/email/retry': return await E.reintentar(String(d.id || ''));
    case 'GET /api/email/log': return { log: await E.logList({ desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, tipo: q.get('tipo') || undefined, estado: q.get('estado') || undefined, q: q.get('q') || undefined, archivados: q.get('archivados') === '1' }) };
    case 'POST /api/email/log/bulk': { if (!['archivar', 'desarchivar', 'eliminar'].includes(d.accion)) throw bad('Acción no válida.'); return { afectados: await E.logBulk(d.ids, d.accion) }; }
    case 'GET /api/email/bajas': return { bajas: await E.getBajas() };
    case 'POST /api/email/bajas': { if (!E.validEmail(d.email)) throw bad('Correo no válido.'); if (d.accion === 'quitar') await E.quitarBaja(d.email); else await E.setBaja(d.email, 'baja', 'registrada por el asesor'); return { bajas: await E.getBajas() }; }
    case 'POST /api/email/campaign/plan': { const data = await datos(d), p = await A.planCampania({ data, filtros: d.filtros }); const pv = p.destinatarios[0] ? await A.previsualizarCampania({ asunto: d.asunto || 'Asunto', cuerpo: d.cuerpo || '', destinatario: p.destinatarios[0] }) : null; return { ...p, muestra: p.destinatarios.slice(0, 15).map(x => ({ cid: x.cid, nombre: x.nombre, apellido: x.apellido })), destinatarios: undefined, total: p.destinatarios.length, previsualizacion: pv }; }
    case 'POST /api/email/campaign/create': { const c = await A.crearCampania({ ...d, data: await datos(d) }); return { campania: { ...c, destinatarios: c.destinatarios.length } }; }
    case 'POST /api/email/campaign/process': { const c = await A.procesarCampania(String(d.id || '')); return { campania: { ...c, destinatarios: c.destinatarios.length } }; }
    case 'POST /api/email/campaign/cancel': { const c = await A.cancelarCampania(String(d.id || '')); return { campania: { ...c, destinatarios: c.destinatarios.length } }; }
    case 'GET /api/email/campaigns': return { campanias: (await A.listaCampanias()).map(c => ({ ...c, destinatarios: c.destinatarios.length })) };
  }
  return undefined;
}
