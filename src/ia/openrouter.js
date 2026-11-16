/**
 * Cliente de OpenRouter (API compatible con OpenAI) para el Comité IA.
 *
 * - La llave solo vive en el servidor y nunca aparece en mensajes de error ni en registros.
 * - Prueba los modelos de OPENROUTER_MODEL en orden; si uno falla (límite, caída, modelo
 *   retirado, política de datos) pasa al siguiente.
 * - Cada modelo se prueba primero con JSON Schema y razonamiento bajo ("esquema"); si el
 *   proveedor no acepta esos parámetros o responde vacío, se reintenta en formato "simple".
 */
import { JSON_SCHEMA_DICTAMEN } from '../../public/js/core/comite.js';

export class ErrorIA extends Error {
  constructor(codigo, mensaje, intentos = []) {
    super(mensaje);
    this.name = 'ErrorIA';
    this.codigo = codigo;
    this.intentos = intentos;
  }
}

/** Borra cualquier cosa con forma de llave antes de mostrar o registrar un mensaje. */
export const ocultarSecretos = (texto, max = 300) =>
  String(texto ?? '').replace(/sk-or-[\w-]+/gi, '[llave oculta]').replace(/\s+/g, ' ').trim().slice(0, max);

/** Variantes de solicitud: con JSON Schema y, si falla, en formato simple (solo el prompt). */
export const VARIANTES = Object.freeze([
  Object.freeze({ id: 'esquema', esquema: true }),
  Object.freeze({ id: 'simple', esquema: false }),
]);

/**
 * Tokens de salida. Los modelos que razonan gastan tokens pensando antes de responder:
 * con 4.000 se quedaban sin espacio para el JSON (finish_reason: length). En modelos gratuitos no tiene costo.
 */
export const MAX_TOKENS = 12000;

/** Errores que justifican reintentar el MISMO modelo en la variante simple. */
const REINTENTAR_SIMPLE = new Set(['esquema_no_soportado', 'parametros_no_soportados', 'respuesta_vacia', 'formato_invalido']);
/** Errores que hacen inútil probar otros modelos con la misma llave. */
const DETENER = new Set(['no_autorizado', 'sin_llave', 'sin_credito', 'red']);

/**
 * @param {boolean} minimo  sin parámetros opcionales (cuando el proveedor rechazó alguno de ellos)
 */
export function construirCuerpo({ modelo, variante, sistema, usuario, maxTokens = MAX_TOKENS, minimo = false }) {
  const cuerpo = {
    model: modelo,
    messages: [
      { role: 'system', content: sistema },
      { role: 'user', content: usuario },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  };
  // Modelos que razonan: esfuerzo bajo y sin devolver el razonamiento (los demás lo ignoran).
  if (!minimo) cuerpo.reasoning = { effort: 'low', exclude: true };
  if (variante.esquema) cuerpo.response_format = { type: 'json_schema', json_schema: JSON_SCHEMA_DICTAMEN };
  return cuerpo;
}

/** Algunos proveedores devuelven el contenido como lista de partes [{type:'text', text}]. */
function textoDelMensaje(mensaje) {
  const c = mensaje?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

/** Traduce un 404 de OpenRouter según su mensaje (no todos los 404 significan lo mismo). */
function clasificar404(modelo, detalle) {
  if (/unavailable for free|paid version/i.test(detalle)) {
    return new ErrorIA('ya_no_gratuito', `${modelo}: dejó de ser gratuito (${detalle}). Cambia OPENROUTER_MODEL en .env.`);
  }
  if (/data policy|privacy/i.test(detalle)) {
    return new ErrorIA('politica_datos',
      `${modelo}: tu configuración de privacidad de OpenRouter bloquea a sus proveedores gratuitos (${detalle}). ` +
      'Revisa Settings > Privacy en openrouter.ai: los modelos gratuitos suelen requerir permitir proveedores que pueden usar las solicitudes para entrenamiento.');
  }
  if (/parameter|support|response_format|structured|json_schema|reasoning/i.test(detalle)) {
    return new ErrorIA('parametros_no_soportados', `${modelo}: ningún proveedor acepta los parámetros pedidos (${detalle}).`);
  }
  if (/allowed providers|ignored providers/i.test(detalle)) {
    return new ErrorIA('proveedores_bloqueados', `${modelo}: tu configuración de proveedores en OpenRouter excluye a todos los que sirven este modelo (${detalle}).`);
  }
  return new ErrorIA('modelo_no_disponible', `${modelo}: no está disponible (${detalle || 'sin detalle'}).`);
}

async function llamarModelo({ modelo, variante, sistema, usuario, ia, fetchImpl, minimo }) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), ia.timeoutMs);
  let respuesta;
  try {
    respuesta = await fetchImpl(`${ia.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ia.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://127.0.0.1',
        'X-Title': 'StratAI Decision Suite',
      },
      body: JSON.stringify(construirCuerpo({ modelo, variante, sistema, usuario, minimo })),
      signal: controlador.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new ErrorIA('timeout', `${modelo}: sin respuesta en ${ia.timeoutMs / 1000} s.`);
    throw new ErrorIA('red', `No se pudo conectar con OpenRouter (${ocultarSecretos(error.cause?.code ?? error.message)}).`);
  } finally {
    clearTimeout(temporizador);
  }

  const texto = await respuesta.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // respuesta no JSON: se informa abajo
  }
  const detalle = ocultarSecretos(json?.error?.message ?? (json ? '' : texto));

  if (!respuesta.ok) {
    const s = respuesta.status;
    if (s === 401 || s === 403) throw new ErrorIA('no_autorizado', `OpenRouter rechazó la llave (${s}). Revisa OPENROUTER_API_KEY en .env.`);
    if (s === 402) throw new ErrorIA('sin_credito', 'La cuenta de OpenRouter no tiene saldo para este modelo.');
    if (s === 429) {
      // Puede ser la cuota de la cuenta (20/min, 50/día) o el proveedor del modelo saturado ("Provider returned error")
      const causa = /provider|upstream/i.test(detalle)
        ? 'el proveedor gratuito del modelo está saturado'
        : 'se alcanzó la cuota de modelos gratuitos (20 por minuto y 50 por día)';
      throw new ErrorIA('limite', `${modelo}: ${causa} (${detalle || '429'}).`);
    }
    if (s === 404) throw clasificar404(modelo, detalle);
    if (s === 400 && variante.esquema) throw new ErrorIA('esquema_no_soportado', `${modelo}: no aceptó el formato estructurado (${detalle}).`);
    throw new ErrorIA('http', `${modelo}: OpenRouter respondió ${s} (${detalle || 'sin detalle'}).`);
  }
  if (json?.error) throw new ErrorIA('proveedor', `${modelo}: el proveedor falló (${detalle}).`);

  const eleccion = json?.choices?.[0];
  if (eleccion?.error) throw new ErrorIA('proveedor', `${modelo}: el proveedor falló (${ocultarSecretos(eleccion.error.message ?? JSON.stringify(eleccion.error))}).`);
  const modeloUsado = typeof json?.model === 'string' ? json.model : modelo;
  const contenido = textoDelMensaje(eleccion?.message);
  if (!contenido.trim()) {
    const fin = eleccion?.finish_reason ?? eleccion?.native_finish_reason ?? 'desconocido';
    const pista = fin === 'length' ? ' Se quedó sin tokens (probablemente razonando).' : '';
    const quien = modeloUsado !== modelo ? `${modelo} → ${modeloUsado}` : modelo;
    throw new ErrorIA('respuesta_vacia', `${quien}: respondió vacío (finish_reason: ${fin}).${pista}`);
  }
  return { contenido, modeloUsado, finishReason: eleccion?.finish_reason ?? null };
}

/**
 * @param {Function} [validar] recibe el texto de la respuesta y devuelve { ok, errores }. Si la respuesta
 *   no es válida, se sigue probando (otra variante u otro modelo) en vez de rendirse.
 * @returns {Promise<{contenido: string, modelo: string, variante: string, latenciaMs: number, intentos: object[], validacion: object|null}>}
 */
export async function consultarOpenRouter({ sistema, usuario, ia, fetchImpl = globalThis.fetch, validar = null }) {
  if (!ia.openrouterKey) throw new ErrorIA('sin_llave', 'No hay OPENROUTER_API_KEY configurada.');
  const intentos = [];

  // Si el proveedor rechazó parámetros, el reintento simple va sin ninguno opcional
  const RECHAZO_PARAMETROS = new Set(['esquema_no_soportado', 'parametros_no_soportados']);

  for (const modelo of ia.modelos) {
    let codigoAnterior = null;
    for (const variante of VARIANTES) {
      const inicio = Date.now();
      try {
        const minimo = !variante.esquema && RECHAZO_PARAMETROS.has(codigoAnterior);
        const r = await llamarModelo({ modelo, variante, sistema, usuario, ia, fetchImpl, minimo });
        const validacion = validar ? validar(r.contenido) : null;
        if (validacion && !validacion.ok) {
          const quien = r.modeloUsado !== modelo ? `${modelo} → ${r.modeloUsado}` : modelo;
          const error = new ErrorIA('formato_invalido', `${quien}: la respuesta no cumplió el formato (${validacion.errores.slice(0, 3).join('; ')}).`);
          error.respuesta = r.contenido;
          throw error;
        }
        return { contenido: r.contenido, modelo: r.modeloUsado, variante: variante.id, latenciaMs: Date.now() - inicio, intentos, validacion };
      } catch (error) {
        if (!(error instanceof ErrorIA)) throw error;
        codigoAnterior = error.codigo;
        intentos.push({ modelo, variante: variante.id, codigo: error.codigo, mensaje: error.message, ms: Date.now() - inicio, ...(error.respuesta ? { respuesta: error.respuesta.slice(0, 4000) } : {}) });
        if (DETENER.has(error.codigo)) throw new ErrorIA(error.codigo, error.message, intentos);
        if (variante.esquema && REINTENTAR_SIMPLE.has(error.codigo)) continue; // mismo modelo, formato simple
        break; // siguiente modelo
      }
    }
  }
  const ultimo = intentos[intentos.length - 1];
  const resumen = intentos.length > 1 ? ` (${intentos.length} intentos; detalle en "Intentos fallidos")` : '';
  throw new ErrorIA(ultimo?.codigo ?? 'sin_respuesta', `${ultimo?.mensaje ?? 'Ningún modelo respondió.'}${resumen}`, intentos);
}
