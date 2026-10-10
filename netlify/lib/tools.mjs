// Datos del CRM y herramientas de CONSULTA (solo lectura) que el asistente puede usar. No contiene nada de OpenAI.
// Las herramientas no devuelven RFC, CURP ni fecha de nacimiento.
const { TZ_APP = 'America/Mexico_City' } = process.env;
let D = { c: [], p: [], pay: [], ap: [], act: [] };
export const setData = d => { D = d; };
export const getD = () => D;

// ---------- utilidades de datos (solo lectura) ----------
const norm = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ_APP });
const diff = s => Math.round((Date.parse(s) - Date.parse(hoy())) / 864e5);
const addD = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const RAMOS = ['Auto', 'Vida', 'Gastos Médicos Mayores', 'Hogar', 'Educación', 'Accidentes Personales', 'Empresarial', 'Otros'];
const ramoOf = p => (RAMOS.includes(p.tipo) && p.tipo !== 'Otros' ? p.tipo : 'Otros');
const ramoIn = x => { const n = norm(x); return /gmm|gastos/.test(n) ? RAMOS[2] : /auto/.test(n) ? 'Auto' : /vida/.test(n) ? 'Vida' : /hogar|casa/.test(n) ? 'Hogar' : /educ/.test(n) ? 'Educación' : /accid/.test(n) ? 'Accidentes Personales' : /empres/.test(n) ? 'Empresarial' : 'Otros'; };
const estP = p => (p.canc ? 'cancelada' : diff(p.fin) < 0 ? 'vencida' : diff(p.fin) <= 60 ? 'por_renovar' : 'vigente');
const estY = y => (y.paid ? 'pagado' : diff(y.due) < 0 ? 'vencido' : diff(y.due) <= 7 ? 'proximo' : 'pendiente');
const cli = id => D.c.find(c => c.id === id) || { nombre: '(eliminado)', apellido: '' };
const nom = c => `${c.nombre} ${c.apellido}`.trim();
const ramosDe = id => [...new Set(D.p.filter(p => p.cid === id && !p.canc).map(ramoOf))];
const ultimo = id => D.act.filter(a => a.cid === id).map(a => a.fecha).sort().pop() || null;
const lim = a => Math.min(+a.limite || 20, 40);
const polRow = p => ({ cliente: nom(cli(p.cid)), ramo: ramoOf(p), aseguradora: p.co, numero: p.num, vence: p.fin, dias: diff(p.fin), prima_anual: p.anual, estatus: estP(p) });
const S = { type: 'string' }, I = { type: 'integer' };

// Herramientas que la IA puede usar. TODAS son de solo lectura y no devuelven RFC, CURP ni fecha de nacimiento.
const TOOLS = {
  buscar_clientes: { d: 'Busca clientes por nombre, teléfono o correo, o filtra por estatus (Prospecto, Cliente activo, Inactivo, Pendiente, VIP).', p: { texto: S, estatus: S, limite: I },
    run: a => { const q = norm(a.texto); const r = D.c.filter(c => (!q || norm(nom(c) + c.tel + c.email).includes(q)) && (!a.estatus || norm(c.status) === norm(a.estatus))); return { total: r.length, clientes: r.slice(0, lim(a)).map(c => ({ id: c.id, nombre: nom(c), estatus: c.status, telefono: c.tel, ramos: ramosDe(c.id), ultimo_contacto: ultimo(c.id) })) }; } },
  polizas: { d: 'Lista pólizas filtrando por ramo, estatus (vigente, por_renovar, vencida, cancelada) o nombre de cliente. Incluye el total.', p: { ramo: S, estatus: S, cliente: S, limite: I },
    run: a => { const q = norm(a.cliente), r = a.ramo ? ramoIn(a.ramo) : null; const rows = D.p.filter(p => (!r || ramoOf(p) === r) && (!a.estatus || estP(p) === a.estatus) && (!q || norm(nom(cli(p.cid))).includes(q))); return { total: rows.length, polizas: rows.slice(0, lim(a)).map(polRow) }; } },
  renovaciones: { d: 'Pólizas que vencen en los próximos N días (por defecto 30), ordenadas por cercanía. Con incluir_vencidas=false excluye las ya vencidas.', p: { dias: I, incluir_vencidas: { type: 'boolean' }, limite: I },
    run: a => { const n = +a.dias || 30; const r = D.p.filter(p => !p.canc && diff(p.fin) <= n && (a.incluir_vencidas !== false || diff(p.fin) >= 0)).sort((x, y) => x.fin.localeCompare(y.fin)); return { total: r.length, renovaciones: r.slice(0, lim(a)).map(polRow) }; } },
  clientes_por_ramo: { d: 'Clientes no inactivos que TIENEN todos los ramos de "tiene" y NO tienen ninguno de "no_tiene". Ramos: Auto, Vida, GMM, Hogar, Educación, Accidentes, Empresarial, Otros.', p: { tiene: { type: 'array', items: S }, no_tiene: { type: 'array', items: S } },
    run: a => { const t = (a.tiene || []).map(ramoIn), n = (a.no_tiene || []).map(ramoIn); const r = D.c.filter(c => c.status !== 'Inactivo' && c.tipo !== 'Prospecto' && t.every(x => ramosDe(c.id).includes(x)) && !n.some(x => ramosDe(c.id).includes(x))); return { total: r.length, clientes: r.slice(0, 50).map(c => ({ id: c.id, nombre: nom(c) })) }; } },
  cobranza: { d: 'Pagos. estado: pendiente, proximo (vence en 7 días), vencido, pagado o por_cobrar (todo lo no pagado). Devuelve total en pesos y detalle.', p: { estado: S, cliente: S, limite: I },
    run: a => { const q = norm(a.cliente); const r = D.pay.filter(y => (!a.estado || (a.estado === 'por_cobrar' ? !y.paid : estY(y) === a.estado)) && (!q || norm(nom(cli((D.p.find(p => p.id === y.pid) || {}).cid))).includes(q))).sort((x, y) => x.due.localeCompare(y.due)); return { total_importe: r.reduce((t, y) => t + y.monto, 0), total: r.length, pagos: r.slice(0, lim(a)).map(y => { const p = D.p.find(p => p.id === y.pid) || {}; return { cliente: nom(cli(p.cid)), poliza: p.num, vence: y.due, importe: y.monto, estado: estY(y) }; }) }; } },
  agenda: { d: 'Citas entre dos fechas (YYYY-MM-DD). Por defecto hoy y los siguientes 7 días. Para "mañana" usa desde=hasta=fecha de mañana.', p: { desde: S, hasta: S, cliente: S },
    run: a => { const d = a.desde || hoy(), h = a.hasta || addD(d, 7), q = norm(a.cliente); const r = D.ap.filter(x => x.fecha >= d && x.fecha <= h && (!q || norm(nom(cli(x.cid))).includes(q))).sort((x, y) => (x.fecha + x.hora).localeCompare(y.fecha + y.hora)); return { total: r.length, citas: r.slice(0, 40).map(x => ({ cliente: nom(cli(x.cid)), fecha: x.fecha, hora: x.hora, tipo: x.tipo, estado: x.est })) }; } },
  clientes_sin_contacto: { d: 'Clientes no inactivos sin actividad registrada en los últimos N días (por defecto 180).', p: { dias: I },
    run: a => { const n = +a.dias || 180; const r = D.c.filter(c => c.status !== 'Inactivo' && c.tipo !== 'Prospecto' && (!ultimo(c.id) || diff(ultimo(c.id)) < -n)); return { total: r.length, clientes: r.slice(0, 40).map(c => ({ id: c.id, nombre: nom(c), ultimo_contacto: ultimo(c.id) })) }; } },
  resumen_cliente: { d: 'Datos completos de un cliente (por id o nombre): pólizas, ramos con y sin cobertura, pagos pendientes, citas y actividad reciente.', p: { id: S, nombre: S },
    run: a => { const c = D.c.find(x => x.id === a.id) || (a.nombre && D.c.find(x => norm(nom(x)).includes(norm(a.nombre)))); if (!c) return { error: 'Cliente no encontrado' };
      const ps = D.p.filter(p => p.cid === c.id), ys = D.pay.filter(y => !y.paid && ps.some(p => p.id === y.pid)), u = ultimo(c.id);
      return { id: c.id, nombre: nom(c), estatus: c.status, ciudad: c.ciudad, notas: c.notas || '', ramos_con: ramosDe(c.id), ramos_sin: RAMOS.filter(r => !ramosDe(c.id).includes(r)),
        polizas: ps.map(polRow), pagos_pendientes: ys.map(y => ({ vence: y.due, importe: y.monto, estado: estY(y) })), total_pendiente: ys.reduce((t, y) => t + y.monto, 0),
        proximas_citas: D.ap.filter(x => x.cid === c.id && x.fecha >= hoy()).slice(0, 3).map(x => ({ fecha: x.fecha, hora: x.hora, tipo: x.tipo })),
        ultimo_contacto: u, dias_sin_contacto: u ? -diff(u) : null, actividad: D.act.filter(x => x.cid === c.id).sort((x, y) => y.fecha.localeCompare(x.fecha)).slice(0, 8).map(x => ({ fecha: x.fecha, texto: x.txt })) }; } }
};



TOOLS.cumpleanos = { d: 'Clientes y prospectos que cumplen años en un mes (1-12; por defecto el mes actual). Solo día y mes, nunca el año de nacimiento.', p: { mes: I, tipo: { type: 'string', description: 'clientes, prospectos o ambos' } },
  run: a => { const m = +a.mes || +hoy().slice(5, 7); const r = D.c.filter(c => c.nac && +c.nac.slice(5, 7) === m && c.status !== 'Inactivo' && (!a.tipo || a.tipo === 'ambos' || (a.tipo === 'prospectos') === (c.tipo === 'Prospecto'))).sort((x, y) => x.nac.slice(8).localeCompare(y.nac.slice(8))); return { mes: m, total: r.length, personas: r.slice(0, 40).map(c => ({ id: c.id, nombre: nom(c), tipo: c.tipo === 'Prospecto' ? 'prospecto' : 'cliente', dia: +c.nac.slice(8) })) }; } };
TOOLS.prospectos_seguimiento = { d: 'Prospectos que requieren seguimiento: estatus Nuevo, Por contactar, Contactado o Interesado, sin contacto en los últimos N días (por defecto 7).', p: { dias: I, limite: I },
  run: a => { const n = +a.dias || 7; const r = D.c.filter(c => c.tipo === 'Prospecto' && ['Nuevo', 'Por contactar', 'Contactado', 'Interesado'].includes(c.status) && (!ultimo(c.id) || diff(ultimo(c.id)) < -n)); return { total: r.length, prospectos: r.slice(0, lim(a)).map(c => ({ id: c.id, nombre: nom(c), estatus: c.status, interes: c.interes || null, ultimo_contacto: ultimo(c.id) })) }; } };
export const toolDefs = Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', name, description: t.d, parameters: { type: 'object', properties: t.p }, strict: false }));
export const runTool = (name, args) => { const t = TOOLS[name]; if (!t) throw new Error('herramienta desconocida'); return t.run(args); };
export { TOOLS, RAMOS, hoy, diff, nom, cli, ramosDe, ultimo, norm, ramoOf };
