/**
 * Construcción de la aplicación Express (separada de server.js para poder probarla).
 *
 * Rutas:
 *   GET  /api/health    estado, instancia activa, base de datos y proveedor de IA (sin secretos)
 *   GET  /api/feedback  comentarios de clientes de la instancia activa y, en las Instancias 2 y 3,
 *                       la matriz RICE calculada por la base de datos (?criterio=...)
 *   POST /api/comite    recalcula todo, pide el dictamen al Comité IA (o al motor local) y,
 *                       en las Instancias 2 y 3, guarda la simulación y el dictamen
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumenPublico } from './config.js';
import { crearFuenteCSV } from './datos/fuente-csv.js';
import { generarDictamen } from './servicios/comite.js';
import { crearLimitador } from './servidor/limitador.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * CSP: solo scripts, estilos y conexiones propias. Si alguien logra meter HTML en un
 * comentario de cliente, el navegador no ejecuta scripts inyectados.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function cabecerasSeguridad(_req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
}

const CRITERIOS = ['score_rice', 'ingreso_en_riesgo_usd'];

/** Lo que se guarda de cada consulta al Comité (Instancias 2 y 3). */
function documentoSimulacion(resultado, adicionales) {
  const m1 = resultado.payload.modulo_1_simulador;
  return {
    entradas: m1.entradas,
    supuestos: m1.supuestos_del_modelo,
    kpis: m1.kpis_estrategia_hibrida,
    escenarios: m1.escenarios_beneficio_incremental_usd,
    diagnosticos: m1.diagnosticos_motor_reglas.map((d) => d.id),
    matriz_rice: resultado.payload.modulo_2_rice.iniciativas,
    iniciativa_simulada: resultado.payload.iniciativa_simulada,
    comentarios_agregados_en_sesion: adicionales,
    proveedor_ia: resultado.fuente,
    modelo_ia: resultado.modelo,
    motivo_respaldo: resultado.motivo_respaldo,
    dictamen_ia: resultado.dictamen,
    verificacion_cifras: resultado.verificacion,
  };
}

/**
 * @param {object} opciones
 * @param {object} opciones.config      resultado de cargarConfig()
 * @param {object} [opciones.fuente]    fuente de datos (src/datos/fuentes.js); por defecto, el CSV
 * @param {Function} [opciones.fetchImpl] fetch inyectable (las pruebas usan un OpenRouter simulado)
 */
export function crearApp({ config, fetchImpl = globalThis.fetch, raiz = RAIZ, fuente = null }) {
  const datos = fuente ?? crearFuenteCSV({ ruta: path.join(raiz, 'data', 'datos_ejemplo.csv') });
  const rutaChart = path.join(raiz, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js');
  const enNavegador = config.dbMode === 'csv';

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(cabecerasSeguridad);
  app.use(express.static(path.join(raiz, 'public')));
  app.get('/vendor/chart.umd.min.js', (_req, res) => res.sendFile(rutaChart));

  app.get('/api/health', async (_req, res) => {
    let bd;
    try {
      bd = await datos.estado();
    } catch (error) {
      bd = `error: ${error.expose ? error.message : 'sin conexión'}`;
    }
    res.json({ estado: 'ok', ...resumenPublico(config), fuente: datos.nombre, bd });
  });

  app.get('/api/feedback', async (req, res, next) => {
    try {
      const criterio = CRITERIOS.includes(req.query.criterio) ? req.query.criterio : 'score_rice';
      const registros = await datos.leerFeedback();
      const matrizServidor = datos.obtenerMatriz ? await datos.obtenerMatriz(criterio) : null;
      res.json({ origen: datos.nombre, total: registros.length, datos: registros, matriz_servidor: matrizServidor });
    } catch (error) {
      next(error);
    }
  });

  // Comité IA: límite por minuto y como máximo 2 consultas simultáneas
  let consultasEnCurso = 0;
  app.post(
    '/api/comite',
    crearLimitador({ maximo: config.ia.limitePorMinuto }),
    express.json({ limit: '2mb' }),
    async (req, res, next) => {
      if (consultasEnCurso >= 2) return res.status(429).json({ error: 'Ya hay consultas al Comité en curso. Intenta en unos segundos.' });
      consultasEnCurso += 1;
      try {
        // En CSV los datos vienen del navegador (puede haber un CSV propio o comentarios agregados).
        // En las Instancias 2 y 3 vienen de la base; el navegador solo envía los agregados en la sesión.
        const resultado = await generarDictamen({
          cuerpo: req.body,
          config,
          registrosServidor: enNavegador ? null : await datos.leerFeedback(),
          origenDatos: enNavegador ? 'CSV (navegador)' : datos.nombre,
          fetchImpl,
        });
        if (datos.guardarSimulacion) {
          try {
            const adicionales = Array.isArray(req.body?.registros) ? req.body.registros.length : 0;
            const { id } = await datos.guardarSimulacion(documentoSimulacion(resultado, adicionales));
            resultado.guardado = { destino: datos.nombre, id };
          } catch (error) {
            // El dictamen se entrega igual aunque no se haya podido guardar
            resultado.guardado = { destino: datos.nombre, error: error.expose ? error.message : 'No se pudo guardar.' };
          }
        }
        console.log(`[comite] fuente=${resultado.fuente} modelo=${resultado.modelo ?? '-'} cifras=${resultado.verificacion.verificadas}/${resultado.verificacion.revisadas}${resultado.motivo_respaldo ? ` respaldo="${resultado.motivo_respaldo}"` : ''}`);
        return res.json(resultado);
      } catch (error) {
        return next(error);
      } finally {
        consultasEnCurso -= 1;
      }
    }
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // Manejo central de errores: el detalle queda en consola, el cliente recibe un mensaje acotado
  app.use((error, req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500 && !error.expose) {
      console.error('[error]', error);
      return res.status(status).json({ error: 'Error interno del servidor' });
    }
    console.warn(`[${status}] ${req.method} ${req.originalUrl}: ${error.type || error.message}`);
    const mensajes = { 'entity.parse.failed': 'JSON mal formado', 'entity.too.large': 'La solicitud es demasiado grande' };
    return res.status(status).json({ error: mensajes[error.type] ?? error.message });
  });

  return app;
}
