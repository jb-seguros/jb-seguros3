// PRUEBAS REALES contra la API de OpenAI. Usan tu OPENAI_API_KEY (variable de entorno / archivo .env) y consumen unos centavos de crédito.
// Ejecuta:  npm install && npm run test:live      (necesita Node 20+ y un .env con OPENAI_API_KEY)
// Si falta la clave NO se simula nada: termina con código 2 indicando que no se ejecutó ninguna prueba.
import { readFileSync } from 'node:fs';
const fx = n => new URL('./fixtures/' + n, import.meta.url);
if (!process.env.OPENAI_API_KEY) { console.log('NO EJECUTADO: falta OPENAI_API_KEY. No se corrió ninguna prueba real.'); process.exit(2); }
const ai = await import('../netlify/lib/openai.mjs'), svc = await import('../netlify/lib/service.mjs');
const DATA = JSON.parse(readFileSync(fx('datos-demo.json'))), EXP = JSON.parse(readFileSync(fx('esperado.json')));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log(cond ? '  ✔' : '  ✘', name, extra); };
console.log(`PRUEBAS REALES — modelo: ${ai.cfg().model} | modelo PDF: ${ai.cfg().modelPdf}\n`);

console.log('1) Conexión (clave, acceso al modelo, respuesta de la API, lectura de PDF)');
const d = await ai.diagnose({ pdf: true });
d.stages.forEach(s => check(`${s.stage}: ${s.message}`, s.ok));
if (!d.ok) { console.log('\nDiagnóstico fallido: se detienen las demás pruebas.'); process.exit(1); }

console.log('\n2) Análisis de PDF → datos estructurados');
for (const [file, label] of [['poliza-texto.pdf', 'PDF con texto'], ['poliza-escaneada.pdf', 'PDF escaneado (solo imagen)']]) {
  console.log(' ·', label);
  try {
    const { poliza: p } = await svc.handle('/api/extract-policy', { pdfBase64: readFileSync(fx(file)).toString('base64'), fileName: file });
    console.log('   leído:', JSON.stringify({ aseguradora: p.aseguradora, no_poliza: p.no_poliza, contratante: p.contratante, vigencia: [p.vigencia_inicio, p.vigencia_fin], prima: p.prima_total, pago: p.forma_pago, ramo: p.ramo, suma: p.suma_asegurada, dudas: p.dudas }));
    check('aseguradora', norm(p.aseguradora).includes(norm(EXP.aseguradora)));
    check('número de póliza', norm(p.no_poliza).replace(/\s/g, '') === norm(EXP.no_poliza));
    check('contratante', norm(p.contratante).includes('lopez') && norm(p.contratante).includes('maria'));
    check('vigencia inicio', p.vigencia_inicio === EXP.vigencia_inicio); check('vigencia fin', p.vigencia_fin === EXP.vigencia_fin);
    check('prima total', p.prima_total === EXP.prima_total); check('forma de pago', norm(p.forma_pago).includes(EXP.forma_pago));
    check('ramo', norm(p.ramo).includes(EXP.ramo)); check('suma asegurada', p.suma_asegurada === EXP.suma_asegurada);
  } catch (e) { check('análisis', false, `[${e.kind || 'error'}] ${e.message}`); }
}

console.log('\n3) Generación de mensajes');
try {
  const w = (await svc.handle('/api/message', { clienteId: 'c0', instruccion: 'recordarle que su póliza está próxima a vencer y proponer revisar la renovación', data: DATA })).text;
  console.log('   WhatsApp:', w.replace(/\n/g, ' ').slice(0, 220));
  check('WhatsApp: no vacío y razonable', w.length > 40 && w.length < 900); check('WhatsApp: menciona al cliente', /juan/i.test(w)); check('WhatsApp: sin marcadores sin llenar', !/[{}\[\]]|undefined|null/.test(w));
  const m = await svc.handle('/api/mail/draft', { clienteId: 'c0', instruccion: 'recordatorio de renovación', data: DATA });
  console.log('   Correo:', m.asunto, '|', m.cuerpo.replace(/\n/g, ' ').slice(0, 160));
  check('Correo: asunto y cuerpo', m.asunto.length > 5 && m.asunto.length < 200 && m.cuerpo.length > 60); check('Correo: sin marcadores sin llenar', !/[{}]|undefined|null/.test(m.asunto + m.cuerpo));
  const s = (await svc.handle('/api/summary', { clienteId: 'c0', data: DATA })).text; console.log('   Resumen:', s.replace(/\n/g, ' ').slice(0, 200));
  check('Resumen: no vacío', s.length > 40);
} catch (e) { check('mensajes', false, `[${e.kind || 'error'}] ${e.message}`); }

console.log('\n4) Asistente con herramientas (consulta real de datos)');
try { const r = await svc.handle('/api/chat', { messages: [{ role: 'user', content: '¿Cuánto tengo pendiente de cobrar en total?' }], data: DATA }); console.log('   respuesta:', r.text.replace(/\n/g, ' ').slice(0, 200), '| herramientas:', r.tools.join(','));
  check('usó la herramienta de cobranza', r.tools.includes('cobranza')); } catch (e) { check('asistente', false, `[${e.kind || 'error'}] ${e.message}`); }

console.log(`\nREALES: ${ok} pasaron, ${bad} fallaron.`); process.exit(bad ? 1 : 0);
