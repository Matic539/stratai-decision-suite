/**
 * StratAI Decision Suite: punto de entrada del servidor.
 * Carga la configuración, conecta la fuente de datos de la instancia activa
 * (CSV, MongoDB Atlas o PostgreSQL) y arma la aplicación de src/app.js.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarConfig } from './src/config.js';
import { crearApp } from './src/app.js';
import { crearFuente } from './src/datos/fuentes.js';

dotenv.config({ quiet: true });
const RAIZ = path.dirname(fileURLToPath(import.meta.url));

let config;
let fuente;
try {
  config = cargarConfig();
  fuente = crearFuente(config, RAIZ);
  await fuente.conectar();
} catch (error) {
  console.error(`[inicio] ${error.message}`);
  process.exit(1);
}

const app = crearApp({ config, fuente });

const server = app.listen(config.port, config.host, (error) => {
  if (error) {
    console.error(`[servidor] No se pudo iniciar en ${config.host}:${config.port}: ${error.message}`);
    process.exit(1);
  }
  const ia = config.ia.proveedor === 'openrouter' ? `OpenRouter (${config.ia.modelos.join(' > ')})` : 'dictamen local';
  console.log(`StratAI Decision Suite en http://${config.host}:${config.port}  [datos: ${fuente.nombre} | IA: ${ia}]`);
});

async function apagar(senal) {
  console.log(`\n[${senal}] Cerrando servidor...`);
  server.closeAllConnections?.();
  server.close(async () => {
    await fuente.cerrar().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
