// Función PROGRAMADA de Netlify: se ejecuta cada hora (en UTC). Calcula todo con la hora de America/Mexico_City y solo envía a partir de la hora configurada.
// Es seguro ejecutarla varias veces al día: cada evento tiene clave de idempotencia. Solo corre en el despliegue de producción.
import { ejecutar } from '../lib/automations.mjs';
export default async () => {
  const r = await ejecutar({ manual: false });
  console.log('automatizaciones:', JSON.stringify({ ok: r.ok, enviados: r.enviados, fallidos: r.fallidos, desconocidos: r.desconocidos, restantes: r.restantes, motivo: r.motivo }));
};
export const config = { schedule: '@hourly' };
