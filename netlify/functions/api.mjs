// Función de Netlify para /api/*. OPENAI_API_KEY y APP_TOKEN se definen en el panel de Netlify (Environment variables), nunca en el código.
import web from '../lib/web.mjs';
export default (req) => web(req);
export const config = { path: '/api/*' };
