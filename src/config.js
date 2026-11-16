/**
 * Configuración de la aplicación a partir de variables de entorno.
 *
 * cargarConfig() es una función pura: recibe el objeto env para poder
 * probarla sin depender de process.env ni de un archivo .env real.
 */

export const MODOS_PERSISTENCIA = Object.freeze(['csv', 'mongodb', 'postgres']);
export const PROVEEDORES_IA = Object.freeze(['openrouter', 'local']);

const limpiar = (valor) => (typeof valor === 'string' ? valor.trim() : '');

// Un valor vacío o con marcadores tipo <password> se considera "no configurado".
const esPlaceholder = (valor) => valor === '' || /<[^>]+>/.test(valor);

/** Router gratuito de OpenRouter: elige un modelo :free disponible. */
export const MODELO_POR_DEFECTO = 'openrouter/free';
const URL_IA_POR_DEFECTO = 'https://openrouter.ai/api/v1';

function leerEntero(valor, nombre, porDefecto, min, max) {
  const texto = limpiar(valor) || String(porDefecto);
  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw new Error(`${nombre} inválido: "${texto}". Debe ser un entero entre ${min} y ${max}.`);
  }
  return numero;
}

/** Solo HTTPS (o HTTP hacia el propio equipo, para pruebas con un servidor simulado). */
function leerUrlIA(valor) {
  const texto = limpiar(valor) || URL_IA_POR_DEFECTO;
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(`OPENROUTER_BASE_URL inválida: "${texto}".`);
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('OPENROUTER_BASE_URL debe usar https (http solo se permite hacia 127.0.0.1).');
  }
  return texto.replace(/\/+$/, '');
}

function leerPuerto(valor, nombre, porDefecto) {
  const texto = limpiar(valor) || String(porDefecto);
  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero < 1 || numero > 65535) {
    throw new Error(`${nombre} inválido: "${texto}". Debe ser un entero entre 1 y 65535.`);
  }
  return numero;
}

export function cargarConfig(env = process.env) {
  const dbMode = (limpiar(env.DB_MODE) || 'csv').toLowerCase();
  if (!MODOS_PERSISTENCIA.includes(dbMode)) {
    throw new Error(
      `DB_MODE inválido: "${dbMode}". Valores permitidos: ${MODOS_PERSISTENCIA.join(', ')}.`
    );
  }

  const mongo = {
    uri: limpiar(env.MONGO_URI),
    dbName: limpiar(env.MONGO_DB) || 'stratai_db',
  };

  const postgres = {
    host: limpiar(env.PGHOST) || '127.0.0.1',
    port: leerPuerto(env.PGPORT, 'PGPORT', 5432),
    user: limpiar(env.PGUSER),
    password: typeof env.PGPASSWORD === 'string' ? env.PGPASSWORD : '', // la contraseña no se recorta
    database: limpiar(env.PGDATABASE) || 'stratai_db',
  };

  if (dbMode === 'mongodb' && esPlaceholder(mongo.uri)) {
    throw new Error('DB_MODE=mongodb requiere MONGO_URI con la cadena de conexión de tu clúster en Atlas.');
  }
  if (dbMode === 'postgres' && !postgres.user) {
    throw new Error('DB_MODE=postgres requiere PGUSER (y PGPASSWORD si tu servidor lo exige).');
  }

  let proveedor = (limpiar(env.AI_PROVIDER) || 'local').toLowerCase();
  if (!PROVEEDORES_IA.includes(proveedor)) {
    throw new Error(
      `AI_PROVIDER inválido: "${proveedor}". Valores permitidos: ${PROVEEDORES_IA.join(', ')}.`
    );
  }
  const openrouterKey = limpiar(env.OPENROUTER_API_KEY);
  // Sin llave válida la app sigue funcionando con el dictamen local (modo experto).
  if (proveedor === 'openrouter' && esPlaceholder(openrouterKey)) {
    proveedor = 'local';
  }

  // OPENROUTER_MODEL admite varios modelos separados por coma: se prueban en orden.
  const modelos = limpiar(env.OPENROUTER_MODEL)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (modelos.some((m) => !/^[\w.\-/:]{3,120}$/.test(m))) {
    throw new Error('OPENROUTER_MODEL contiene un nombre de modelo inválido.');
  }
  if (modelos.length === 0) modelos.push(MODELO_POR_DEFECTO);

  const baseUrl = leerUrlIA(env.OPENROUTER_BASE_URL);
  const timeoutMs = leerEntero(env.IA_TIMEOUT_MS, 'IA_TIMEOUT_MS', 90000, 5000, 180000);
  const limitePorMinuto = leerEntero(env.IA_LIMITE_POR_MINUTO, 'IA_LIMITE_POR_MINUTO', 10, 1, 60);

  return Object.freeze({
    dbMode,
    host: limpiar(env.HOST) || '127.0.0.1',
    port: leerPuerto(env.PORT, 'PORT', 3000),
    mongo: Object.freeze(mongo),
    postgres: Object.freeze(postgres),
    ia: Object.freeze({
      proveedor,
      openrouterKey,
      modelos: Object.freeze(modelos),
      baseUrl,
      timeoutMs,
      limitePorMinuto,
    }),
  });
}

/** Datos de configuración que se pueden mostrar al cliente. Nunca incluye secretos. */
export function resumenPublico(config) {
  return {
    modo: config.dbMode,
    ia: config.ia.proveedor,
    modeloIA: config.ia.proveedor === 'openrouter' ? config.ia.modelos[0] : null,
  };
}
