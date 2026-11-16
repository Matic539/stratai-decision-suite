/**
 * Elige la fuente de datos según DB_MODE. Todas exponen la misma interfaz:
 *   nombre, conectar(), cerrar(), leerFeedback(), obtenerMatriz(criterio) | null,
 *   guardarSimulacion(documento) | null, estado()
 */
import path from 'node:path';
import { crearFuenteCSV } from './fuente-csv.js';
import { crearFuenteMongo } from './modelo_mongodb.js';
import { crearFuentePostgres } from './modelo_postgresql.js';

export function crearFuente(config, raiz) {
  if (config.dbMode === 'mongodb') return crearFuenteMongo(config);
  if (config.dbMode === 'postgres') return crearFuentePostgres(config);
  if (config.dbMode === 'csv') return crearFuenteCSV({ ruta: path.join(raiz, 'data', 'datos_ejemplo.csv') });
  const error = new Error(`La instancia "${config.dbMode}" todavía no está implementada.`);
  error.status = 501;
  error.expose = true;
  throw error;
}
