/**
 * Servicio del Comité IA.
 *
 * El servidor NO confía en cifras calculadas por el navegador: recibe solo las entradas
 * del simulador y los registros de feedback, y recalcula todo con los mismos módulos de
 * js/core. Así la IA solo ve números producidos por el motor de reglas.
 *
 * Los comentarios de clientes se usan para clasificar, pero nunca viajan a la IA
 * (el JSON solo lleva agregados): un comentario con instrucciones maliciosas no puede
 * manipular al modelo.
 */
import { simularEstrategia, RANGOS_ENTRADAS, RANGOS_SUPUESTOS } from '../../public/js/core/finanzas.js';
import { diagnosticarEstrategia } from '../../public/js/core/diagnostico.js';
import { clasificarLote } from '../../public/js/core/clasificador.js';
import { calcularMatrizRICE } from '../../public/js/core/rice.js';
import { validarFeedback, MAX_FILAS_CSV } from '../../public/js/core/csv.js';
import { construirPayload, construirPromptComite, extraerJSON, validarDictamen } from '../../public/js/core/comite.js';
import { generarDictamenLocal } from '../../public/js/core/dictamen-local.js';
import { verificarCifras } from '../../public/js/core/verificacion.js';
import { consultarOpenRouter, ErrorIA } from '../ia/openrouter.js';

export class ErrorSolicitud extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorSolicitud';
    this.status = 400;
    this.expose = true;
  }
}

const CRITERIOS = ['score_rice', 'ingreso_en_riesgo_usd'];
const MODOS = ['auto', 'local'];

// El texto completo de respuestas inválidas no se repite en cada intento (se muestra una sola vez)
const sinRespuesta = ({ respuesta, ...intento }) => intento;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const elegir = (origen, claves) => Object.fromEntries(claves.filter((k) => origen[k] !== undefined).map((k) => [k, origen[k]]));

/** Valida la forma del cuerpo; los rangos numéricos los valida el simulador. */
export function validarSolicitud(cuerpo, { requiereRegistros = true } = {}) {
  if (!esObjeto(cuerpo)) throw new ErrorSolicitud('El cuerpo debe ser un objeto JSON.');
  if (!esObjeto(cuerpo.entradas)) throw new ErrorSolicitud('Falta "entradas" del simulador.');
  if (cuerpo.supuestos !== undefined && !esObjeto(cuerpo.supuestos)) throw new ErrorSolicitud('"supuestos" debe ser un objeto.');

  const criterio = cuerpo.criterio ?? 'score_rice';
  if (!CRITERIOS.includes(criterio)) throw new ErrorSolicitud(`"criterio" debe ser uno de: ${CRITERIOS.join(', ')}.`);
  const modo = cuerpo.modo ?? 'auto';
  if (!MODOS.includes(modo)) throw new ErrorSolicitud(`"modo" debe ser uno de: ${MODOS.join(', ')}.`);
  const iniciativaId = cuerpo.iniciativa_id ?? null;
  if (iniciativaId !== null && !/^[a-z_]{1,40}$/.test(String(iniciativaId))) throw new ErrorSolicitud('"iniciativa_id" inválido.');

  // CSV: los registros del navegador son obligatorios. Instancias 2 y 3: son opcionales
  // (comentarios agregados en la sesión, que se suman a los de la base).
  const lista = cuerpo.registros ?? [];
  if (!Array.isArray(lista)) throw new ErrorSolicitud('"registros" debe ser una lista.');
  if (requiereRegistros && lista.length === 0) throw new ErrorSolicitud('Faltan "registros" de feedback.');
  if (lista.length > MAX_FILAS_CSV) throw new ErrorSolicitud(`Máximo ${MAX_FILAS_CSV} registros.`);
  let registros;
  try {
    registros = lista.map((r, i) => validarFeedback(esObjeto(r) ? r : {}, i + 1));
  } catch (error) {
    throw new ErrorSolicitud(error.message.replace(/^Fila/, 'Registro'));
  }

  return {
    entradas: elegir(cuerpo.entradas, Object.keys(RANGOS_ENTRADAS)),
    supuestos: elegir(cuerpo.supuestos ?? {}, Object.keys(RANGOS_SUPUESTOS)),
    criterio,
    modo,
    iniciativaId,
    registros,
  };
}

/**
 * @param {object} p
 * @param {object} p.cuerpo        cuerpo de la petición
 * @param {object} p.config        configuración (src/config.js)
 * @param {Array|null} p.registrosServidor  feedback de la base de datos (Instancias 2 y 3), al que se suman los
 *   registros agregados en la sesión; null = usar solo los del navegador (Instancia 1)
 * @param {string} p.origenDatos
 */
export async function generarDictamen({ cuerpo, config, registrosServidor = null, origenDatos = 'CSV (navegador)', fetchImpl }) {
  const solicitud = validarSolicitud(cuerpo, { requiereRegistros: registrosServidor === null });
  const registros = registrosServidor ? [...registrosServidor, ...solicitud.registros] : solicitud.registros;

  let simulacion;
  try {
    simulacion = simularEstrategia(solicitud.entradas, solicitud.supuestos);
  } catch (error) {
    throw new ErrorSolicitud(error.message);
  }
  const diagnosticos = diagnosticarEstrategia(simulacion);
  const rice = calcularMatrizRICE(clasificarLote(registros), { criterio: solicitud.criterio });
  const iniciativa = solicitud.iniciativaId ? rice.matriz.find((f) => f.categoria_id === solicitud.iniciativaId) ?? null : null;
  const payload = construirPayload({ simulacion, rice, diagnosticos, iniciativa, origenDatos });
  const prompt = construirPromptComite(payload);

  const respaldoLocal = (motivo, extra = {}) => ({ fuente: 'local', modelo: null, motivo_respaldo: motivo, dictamen: generarDictamenLocal(payload), ...extra });

  let resultado;
  if (solicitud.modo === 'local') {
    resultado = respaldoLocal(null);
  } else if (config.ia.proveedor !== 'openrouter') {
    resultado = respaldoLocal('No hay llave de OpenRouter configurada en el servidor.');
  } else {
    try {
      const r = await consultarOpenRouter({
        sistema: prompt.sistema,
        usuario: prompt.usuario,
        ia: config.ia,
        fetchImpl,
        validar: (contenido) => validarDictamen(extraerJSON(contenido), payload),
      });
      resultado = {
        fuente: 'openrouter',
        modelo: r.modelo,
        variante: r.variante,
        motivo_respaldo: null,
        dictamen: r.validacion.dictamen,
        latencia_ms: r.latenciaMs,
        intentos: r.intentos.map(sinRespuesta),
      };
    } catch (error) {
      if (!(error instanceof ErrorIA)) throw error;
      const conRespuesta = [...(error.intentos ?? [])].reverse().find((i) => i.respuesta);
      resultado = respaldoLocal(error.message, {
        intentos: (error.intentos ?? []).map(sinRespuesta),
        ...(conRespuesta ? { respuesta_ia_original: conRespuesta.respuesta } : {}),
      });
    }
  }

  return {
    ...resultado,
    verificacion: verificarCifras(resultado.dictamen, payload),
    generado_en: payload.generado_en,
    payload,
  };
}
