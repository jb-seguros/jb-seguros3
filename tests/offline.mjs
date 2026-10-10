// PRUEBAS SIMULADAS: usan un cliente de OpenAI FALSO para verificar la lógica propia (forma de las solicitudes a la API Responses,
// bucle de herramientas, clasificación de errores, ocultamiento de credenciales, autenticación, correo y recordatorios).
// NO prueban la conexión real con OpenAI ni la calidad de la lectura de PDF: para eso existe `npm run test:live`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.JB_STORE = 'memory'; process.env.OPENAI_API_KEY = 'sk-proj-CLAVE-FALSA-SOLO-PARA-PRUEBAS'; process.env.APP_TOKEN = 'tok-prueba'; delete process.env.OPENAI_MODEL; delete process.env.OPENAI_MODEL_PDF;
const ai = await import('../netlify/lib/openai.mjs'), svc = await import('../netlify/lib/service.mjs');
const web = (await import('../netlify/lib/web.mjs')).default;
const DATA = JSON.parse(readFileSync(new URL('./fixtures/datos-demo.json', import.meta.url)));
const calls = [];
const fake = (create, retrieve = async m => ({ id: m })) => { calls.length = 0; ai.useClient({ responses: { create: async b => { calls.push(b); return create(b, calls.length); } }, models: { retrieve } }); };
const apiErr = (status, code, message = 'x') => Object.assign(new Error(message), { status, code, name: 'APIError' });
const PDF64 = ai.miniPdf('JB-4821').toString('base64');
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log('  ✔', name); } catch (e) { bad++; console.log('  ✘', name, '\n     ', e.message.split('\n')[0]); } };
console.log('PRUEBAS SIMULADAS (cliente de OpenAI falso). No prueban la conexión real: usa `npm run test:live` para eso.\n');

await t('Extracción de PDF: usa Responses con input_file, json_schema estricto, store:false y el modelo configurado', async () => {
  fake(async () => ({ output_text: JSON.stringify({ aseguradora: 'GNP', no_poliza: 'X-1', contratante: null, rfc: null, asegurado: null, vigencia_inicio: '2026-01-15', vigencia_fin: '2027-01-15', prima_total: 100, forma_pago: null, ramo: 'Auto', suma_asegurada: null, deducible: null, coaseguro: null, beneficiarios: [], coberturas: [], vehiculo: null, dudas: ['rfc'] }) }));
  const r = await svc.handle('/api/extract-policy', { pdfBase64: PDF64, fileName: 'mi póliza (1).pdf' }), b = calls[0];
  assert.equal(r.success, true); assert.equal(r.poliza.no_poliza, 'X-1');
  assert.equal(b.model, 'gpt-4o-mini'); assert.equal(b.store, false); assert.equal(b.text.format.type, 'json_schema'); assert.equal(b.text.format.strict, true);
  assert.deepEqual(Object.keys(ai.POLIZA_SCHEMA.properties).sort(), [...ai.POLIZA_SCHEMA.required].sort(), 'strict exige que todas las propiedades sean requeridas');
  const f = b.input[0].content[1]; assert.equal(f.type, 'input_file'); assert.ok(f.file_data.startsWith('data:application/pdf;base64,JVBER')); assert.ok(!/[()]/.test(f.filename));
  assert.ok(!('chat' in b) && !('messages' in b), 'no usa Chat Completions');
});
await t('Extracción: rechaza archivos que no son PDF sin llamar a OpenAI', async () => {
  fake(async () => { throw new Error('no debía llamarse'); });
  await assert.rejects(() => svc.handle('/api/extract-policy', { pdfBase64: Buffer.from('hola').toString('base64') }), e => e.kind === 'pdf_invalido' && e.http === 400); assert.equal(calls.length, 0);
});
await t('Extracción: respuesta no JSON → error claro', async () => { fake(async () => ({ output_text: 'no es json' })); await assert.rejects(() => svc.handle('/api/extract-policy', { pdfBase64: PDF64 }), e => e.kind === 'respuesta_invalida'); });
await t('Modelo del PDF configurable por separado (OPENAI_MODEL_PDF)', async () => { process.env.OPENAI_MODEL_PDF = 'otro-modelo'; fake(async () => ({ output_text: '{}' })); await svc.handle('/api/extract-policy', { pdfBase64: PDF64 }).catch(() => {}); delete process.env.OPENAI_MODEL_PDF; assert.equal(calls[0].model, 'otro-modelo'); });
await t('Asistente: bucle de herramientas (function_call → function_call_output) sin ids y con datos reales del CRM', async () => {
  fake(async (b, n) => n === 1 ? { output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'cobranza', arguments: '{"estado":"por_cobrar"}' }] } : { output_text: 'Listo', output: [] });
  const r = await svc.handle('/api/chat', { messages: [{ role: 'user', content: '¿cuánto tengo pendiente?' }], data: DATA });
  assert.equal(r.text, 'Listo'); assert.deepEqual(r.tools, ['cobranza']); assert.ok(calls[0].tools.every(x => x.type === 'function' && x.name && !x.function));
  const items = calls[1].input, fc = items.find(i => i.type === 'function_call'), out = items.find(i => i.type === 'function_call_output');
  assert.ok(!('id' in fc)); assert.equal(out.call_id, 'call_9'); assert.ok(JSON.parse(out.output).total_importe > 0); assert.match(calls[0].instructions, /nunca envías/);
});
await t('Asistente: herramienta con argumentos inválidos no rompe la conversación', async () => {
  fake(async (b, n) => n === 1 ? { output: [{ type: 'function_call', call_id: 'c', name: 'no_existe', arguments: '{' }] } : { output_text: 'ok', output: [] });
  assert.equal((await svc.handle('/api/chat', { messages: [{ role: 'user', content: 'x' }], data: DATA })).text, 'ok');
});
await t('Mensajes y resúmenes: no envían RFC/CURP/nacimiento a OpenAI', async () => {
  fake(async () => ({ output_text: 'Hola Juan' }));
  const r = await svc.handle('/api/message', { clienteId: 'c0', instruccion: 'recordar renovación', data: DATA }); assert.equal(r.text, 'Hola Juan');
  const sent = JSON.stringify(calls[0].input); assert.ok(!/"rfc"|"curp"|"nac"/.test(sent)); assert.match(sent, /Juan/);
  await svc.handle('/api/summary', { clienteId: 'c0', data: DATA }); assert.ok(!/"rfc"|"curp"/.test(JSON.stringify(calls[1].input)));
  await assert.rejects(() => svc.handle('/api/summary', { clienteId: 'zzz', data: DATA }), e => e.http === 404);
});
await t('Análisis de cartera: calcula cifras en el servidor y las envía a OpenAI', async () => {
  fake(async () => ({ output_text: 'Análisis' })); const r = await svc.handle('/api/portfolio', { data: DATA });
  assert.equal(r.text, 'Análisis'); assert.equal(r.datos.cobertura_por_ramo.length, 8); assert.ok(r.datos.clientes_activos > 0); assert.ok(!r.datos.prospectos || r.datos.clientes_activos + r.datos.prospectos <= DATA.c.length);
  assert.match(calls[0].input, /oportunidades/);
});
await t('Diagnóstico: todo correcto → clave, modelo, respuesta (y PDF si se pide)', async () => {
  fake(async b => ({ output_text: JSON.stringify(b.input).includes('JB-4821') || JSON.stringify(b.input).includes('input_file') ? 'JB-4821' : 'OK' }));
  const d = await ai.diagnose({ pdf: true }); assert.equal(d.ok, true); assert.deepEqual(d.stages.map(s => s.stage), ['clave', 'modelo', 'respuesta', 'pdf']);
});
const casos = [['clave inválida (401)', apiErr(401, 'invalid_api_key', 'Incorrect API key provided: sk-proj-ABC123SECRETO'), 'retrieve', 'clave', 'clave_invalida'],
  ['modelo sin acceso (404)', apiErr(404, 'model_not_found'), 'retrieve', 'modelo', 'modelo_no_disponible'],
  ['sin crédito (429 insufficient_quota)', apiErr(429, 'insufficient_quota'), 'create', 'respuesta', 'sin_credito'],
  ['límite de frecuencia (429)', apiErr(429, 'rate_limit_exceeded'), 'create', 'respuesta', 'limite_de_uso'],
  ['solicitud inválida (400)', apiErr(400, 'x', 'Unsupported parameter sk-proj-ZZZ999'), 'create', 'respuesta', 'solicitud_invalida'],
  ['sin red', Object.assign(new Error('fetch failed'), { name: 'APIConnectionError' }), 'retrieve', 'clave', 'red'],
  ['tiempo agotado', Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }), 'create', 'respuesta', 'timeout']];
for (const [n, e, where, stage, kind] of casos) await t(`Diagnóstico: ${n} → etapa «${stage}», tipo ${kind}, sin exponer la clave`, async () => {
  fake(async () => { if (where === 'create') throw e; return { output_text: 'OK' }; }, async () => { if (where === 'retrieve') throw e; return {}; });
  const d = await ai.diagnose(), s = d.stages.find(x => !x.ok); assert.equal(d.ok, false); assert.equal(s.stage, stage); assert.equal(s.kind, kind);
  assert.ok(!JSON.stringify(d).includes('sk-proj'), 'la respuesta no debe contener la clave');
});
await t('Diagnóstico: sin OPENAI_API_KEY → lo dice y no llama a OpenAI', async () => {
  const k = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY; ai.useClient(null); const d = await ai.diagnose(); process.env.OPENAI_API_KEY = k;
  assert.equal(d.stages[0].kind, 'sin_clave'); assert.match(d.stages[0].message, /OPENAI_API_KEY/);
});
await t('scrub: oculta claves y tokens en cualquier mensaje', () => { const s = ai.scrub('Incorrect key sk-proj-AbC_123-xyz y Bearer abc.def'); assert.ok(!/sk-proj|abc\.def/.test(s)); });
await t('Miniatura PDF de prueba: estructura válida (offsets de xref correctos)', () => {
  const s = ai.miniPdf('JB-4821').toString('latin1'); assert.ok(s.startsWith('%PDF-1.4'));
  const xr = s.slice(s.indexOf('xref')).split('\n').filter(l => /^\d{10} 00000 n/.test(l)); assert.equal(xr.length, 5);
  xr.forEach((l, i) => assert.ok(s.slice(+l.slice(0, 10)).startsWith(`${i + 1} 0 obj`)));
});
await t('HTTP: sin APP_TOKEN en el servidor → 500 indicando qué falta', async () => { const k = process.env.APP_TOKEN; delete process.env.APP_TOKEN; const r = await web(new Request('http://x/api/health')); process.env.APP_TOKEN = k; assert.equal(r.status, 500); assert.deepEqual((await r.json()).falta, ['APP_TOKEN']); });
await t('HTTP: token ausente o incorrecto → 401; health expone modelo pero no secretos', async () => {
  for (const h of [{}, { authorization: 'Bearer mal' }]) assert.equal((await web(new Request('http://x/api/chat', { method: 'POST', headers: h, body: '{}' }))).status, 401);
  const r = await (await web(new Request('http://x/api/health', { headers: { authorization: 'Bearer tok-prueba' } }))).json(); assert.equal(r.auth, true); assert.equal(r.model, 'gpt-4o-mini'); assert.ok(!JSON.stringify(r).includes('sk-'));
});
await t('HTTP: errores de OpenAI llegan al navegador con tipo y mensaje, sin credenciales', async () => {
  fake(async () => { throw apiErr(401, 'invalid_api_key', 'Incorrect API key provided: sk-proj-ABC123SECRETO'); });
  const r = await web(new Request('http://x/api/portfolio', { method: 'POST', headers: { authorization: 'Bearer tok-prueba' }, body: JSON.stringify({ data: DATA }) })), b = await r.json();
  assert.equal(r.status, 502); assert.equal(b.error.kind, 'clave_invalida'); assert.ok(!JSON.stringify(b).includes('ABC123SECRETO'));
});
await t('HTTP: /api/health?deep=1 devuelve las etapas del diagnóstico y el estado del correo', async () => {
  fake(async () => ({ output_text: 'OK' })); const b = await (await web(new Request('http://x/api/health?deep=1', { headers: { authorization: 'Bearer tok-prueba' } }))).json();
  assert.equal(b.ia.ok, true); assert.equal(typeof b.correo.configurado, 'boolean');
});
await t('Borrador de correo con OpenAI: pide JSON {asunto, cuerpo}, sin RFC/CURP, y no envía nada', async () => {
  fake(async () => ({ output_text: '{"asunto":"Tu renovación","cuerpo":"Hola"}' }));
  const r = await svc.handle('/api/email/draft', { clienteId: 'c0', instruccion: 'renovación', data: DATA });
  assert.deepEqual(r, { asunto: 'Tu renovación', cuerpo: 'Hola' }); assert.equal(calls[0].text.format.name, 'correo'); assert.ok(!/"rfc"|"curp"/.test(JSON.stringify(calls[0].input))); assert.match(calls[0].instructions, /importes ni datos financieros/);
});
await t('Borrador de campaña con OpenAI: no inventa promociones', async () => {
  fake(async () => ({ output_text: '{"asunto":"Protege tu auto","cuerpo":"Texto"}' })); await svc.handle('/api/email/campaign/draft', { objetivo: 'ofrecer seguro de auto' }); assert.match(calls[0].instructions, /No inventes precios/);
});
await t('Herramientas nuevas del asistente: cumpleaños (sin año) y prospectos por atender', async () => {
  const tools = await import('../netlify/lib/tools.mjs'); tools.setData({ c: [{ id: 'a', nombre: 'Ana', apellido: 'Paz', nac: '1990-10-12', tipo: 'Cliente', status: 'Cliente activo' }, { id: 'b', nombre: 'Beto', apellido: 'Luna', nac: '1985-11-01', tipo: 'Cliente', status: 'Cliente activo' }, { id: 'p', nombre: 'Pía', apellido: 'Sol', tipo: 'Prospecto', status: 'Contactado', interes: 'Auto' }], p: [], pay: [], ap: [], act: [] });
  const c = tools.runTool('cumpleanos', { mes: 10 }); assert.equal(c.total, 1); assert.equal(c.personas[0].dia, 12); assert.ok(!JSON.stringify(c).includes('1990'));
  const s = tools.runTool('prospectos_seguimiento', {}); assert.equal(s.total, 1); assert.equal(s.prospectos[0].interes, 'Auto');
});
await t('Sin rastro de Groq ni de Chat Completions en el código del servidor', async () => {
  const { execSync } = await import('node:child_process'); const o = execSync('grep -rniE "groq|chat/completions|pdf-parse|GROQ_" netlify server.js package.json || true', { cwd: new URL('..', import.meta.url).pathname }).toString().trim();
  assert.equal(o, '', o);
});
console.log(`\nSIMULADAS: ${ok} pasaron, ${bad} fallaron.`); process.exit(bad ? 1 : 0);
