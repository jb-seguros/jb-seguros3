// PRUEBA REAL con Resend. Envía UN correo de prueba a una dirección tuya y consulta su estado al proveedor.
// Requiere en el entorno (.env): RESEND_API_KEY, EMAIL_FROM (dominio verificado), APP_URL, APP_TOKEN y TEST_EMAIL_TO (tu dirección). NO envía a clientes.
// Si falta algo NO simula nada: termina con código 2.
const falta = ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_URL', 'APP_TOKEN', 'TEST_EMAIL_TO'].filter(k => !process.env[k]);
if (falta.length) { console.log('NO EJECUTADO: faltan', falta.join(', '), '— no se envió ni se probó nada.'); process.exit(2); }
process.env.JB_STORE = 'memory';
const E = await import('../netlify/lib/email.mjs'); let ok = 0, bad = 0;
const check = (n, c, x = '') => { c ? ok++ : bad++; console.log(c ? '  ✔' : '  ✘', n, x); };
console.log('PRUEBA REAL de correo →', process.env.TEST_EMAIL_TO, '\n');
const conn = await E.testConnection(); check('Conexión con Resend y dominio: ' + conn.mensaje, conn.ok || conn.parcial);
const c = await E.componer({ plantilla: 'cumpleanos', vars: { nombre: 'Prueba' }, to: process.env.TEST_EMAIL_TO });
const r = await E.sendEmail({ to: process.env.TEST_EMAIL_TO, subject: '[PRUEBA] ' + c.asunto, html: c.html, text: c.text, tipo: 'prueba', categoria: 'servicio', origen: 'prueba', prueba: true, idemKey: 'live:' + Date.now() });
check('Resend aceptó el correo (estado «aceptado» + id del proveedor)', r.estado === 'aceptado' && !!r.proveedorId, r.error || r.proveedorId);
if (r.proveedorId) {
  const d = await E.sendEmail({ to: process.env.TEST_EMAIL_TO, subject: 'x', html: 'x', text: 'x', idemKey: 'live:dup' }), d2 = await E.sendEmail({ to: process.env.TEST_EMAIL_TO, subject: 'x', html: 'x', text: 'x', idemKey: 'live:dup' }); check('La misma clave no se reenvía', d2.estado === 'duplicado');
  let last = ''; for (let i = 0; i < 10 && last !== 'delivered'; i++) { await new Promise(s => setTimeout(s, 3000)); const q = await fetch('https://api.resend.com/emails/' + r.proveedorId, { headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY } }); last = (await q.json().catch(() => ({}))).last_event || ''; }
  check('Estado de entrega consultado al proveedor: ' + (last || 'sin dato'), last === 'delivered', '(revisa también tu bandeja de entrada y spam)');
}
console.log(`\nREAL (correo): ${ok} pasaron, ${bad} fallaron.`); process.exit(bad ? 1 : 0);
