/**
 * INSTANCIA 3: PostgreSQL (modelo relacional en 3FN)
 *
 * Equivale a esquema_mysql.sql de la guía, adaptado a PostgreSQL (sql/esquema_postgresql.sql):
 *  - El valor mensual vive solo en "clientes"; los comentarios guardan referencias (FOREIGN KEY).
 *  - La matriz RICE la calcula el motor relacional: la vista v_metricas_rice (JOIN + GROUP BY)
 *    y la columna generada score_rice. Este módulo solo la lee.
 *  - Todas las consultas son parametrizadas ($1, $2...): ningún dato del CSV ni del usuario
 *    se concatena en el SQL. El único texto variable (el ORDER BY) sale de una lista blanca.
 *
 * Las funciones reciben un "ejecutor" con query(texto, parametros) -> { rows }: un Pool de
 * "pg" en la aplicación, o PGlite (PostgreSQL en WebAssembly) en las pruebas.
 */
import pg from 'pg';
import { huella } from './huella.js';
import { armarResumen } from './resumen.js';
import { clasificarComentario } from '../../public/js/core/clasificador.js';
import { SIN_CLASIFICAR } from '../../public/js/core/catalogo.js';
import { validarFeedback, MAX_FILAS_CSV } from '../../public/js/core/csv.js';

export const ORIGEN_POSTGRES = 'PostgreSQL';
export const ARCHIVO_ESQUEMA = 'sql/esquema_postgresql.sql';
const MAX_VALOR_MENSUAL = 99_999_999.99; // NUMERIC(10, 2) de clientes.valor_mensual_usd

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

function errorExpuesto(texto, status = 503) {
  return Object.assign(new Error(texto), { status, expose: true });
}

/** Convierte errores del driver en mensajes accionables, sin mostrar la contraseña. */
export function traducirErrorPostgres(error, cfg = {}) {
  let mensaje = String(error?.message ?? error);
  if (cfg.password && cfg.password.length >= 4) mensaje = mensaje.split(cfg.password).join('***');
  const codigo = error?.code;
  const base = cfg.database || 'stratai_db';
  const usuario = cfg.user || 'stratai_app';
  const servidor = `${cfg.host || '127.0.0.1'}:${cfg.port || 5432}`;

  if (codigo === '28P01' || /password authentication failed/i.test(mensaje)) {
    return errorExpuesto('PostgreSQL rechazó el usuario o la contraseña: revisa PGUSER y PGPASSWORD en .env.');
  }
  if (/client password must be a string/i.test(mensaje)) {
    return errorExpuesto('PostgreSQL pide contraseña y PGPASSWORD está vacía en .env.');
  }
  if (codigo === '28000' && /role .* does not exist/i.test(mensaje)) {
    return errorExpuesto(`El usuario "${usuario}" no existe en PostgreSQL: ejecuta ${ARCHIVO_ESQUEMA} (crea stratai_app) y define su contraseña con \\password.`);
  }
  if (codigo === '28000') {
    return errorExpuesto(`PostgreSQL no acepta la conexión de "${usuario}" (revisa pg_hba.conf).`);
  }
  if (codigo === '3D000') {
    return errorExpuesto(`No existe la base "${base}": créala con psql -U postgres -c "CREATE DATABASE ${base}" y ejecuta ${ARCHIVO_ESQUEMA}.`);
  }
  if (codigo === '42P01' || codigo === '42883') {
    return errorExpuesto(`Falta el esquema en la base "${base}": ejecuta psql -U postgres -d ${base} -f ${ARCHIVO_ESQUEMA}.`);
  }
  if (codigo === '42501') {
    return errorExpuesto(`El usuario "${usuario}" no tiene permisos para esta operación: vuelve a ejecutar ${ARCHIVO_ESQUEMA} como postgres (incluye los GRANT).`);
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(codigo)
      || /timeout exceeded when trying to connect|Connection terminated/i.test(mensaje)) {
    return errorExpuesto(`No se pudo conectar a PostgreSQL en ${servidor}: revisa que el servicio esté iniciado (Get-Service postgresql*).`);
  }
  if (codigo === '22003') return errorExpuesto('Un valor supera el rango que admite la base de datos.', 422);
  if (codigo === '23514') return errorExpuesto(`Un dato no cumple una regla de la base (${error.constraint ?? 'CHECK'}).`, 422);
  return errorExpuesto(`Error de PostgreSQL: ${mensaje.slice(0, 200)}`, 500);
}

async function conTraduccion(cfg, operacion) {
  try {
    return await operacion();
  } catch (error) {
    throw error?.expose ? error : traducirErrorPostgres(error, cfg);
  }
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

/** Comprueba que la base tenga las tablas y vistas de sql/esquema_postgresql.sql. */
export async function verificarEsquema(db, cfg = {}) {
  const { rows } = await db.query(
    `SELECT to_regclass('public.v_matriz_rice') IS NOT NULL AS matriz,
            to_regclass('public.simulaciones_estrategicas') IS NOT NULL AS simulaciones`
  );
  if (!rows[0]?.matriz || !rows[0]?.simulaciones) {
    const base = cfg.database || 'stratai_db';
    throw errorExpuesto(`La base "${base}" no tiene el esquema de StratAI: ejecuta psql -U postgres -d ${base} -f ${ARCHIVO_ESQUEMA}.`);
  }
}

/** Crea el pool de conexiones (credenciales desde .env, vía cargarConfig) y verifica el esquema. */
export async function conectarPostgreSQL(cfg) {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'stratai-decision-suite',
  });
  // Un error en una conexión inactiva (por ejemplo, si se reinicia el servicio) no debe botar el servidor
  pool.on('error', (error) => console.error(`[postgres] ${traducirErrorPostgres(error, cfg).message}`));
  try {
    await verificarEsquema(pool, cfg);
    return pool;
  } catch (error) {
    await pool.end().catch(() => {});
    throw error?.expose ? error : traducirErrorPostgres(error, cfg);
  }
}

/** Ejecuta fn dentro de una transacción (BEGIN/COMMIT con pg.Pool; transaction() con PGlite). */
async function enTransaccion(db, fn) {
  if (typeof db.connect === 'function') {
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      cliente.release();
    }
  }
  if (typeof db.transaction === 'function') return db.transaction(fn);
  return fn(db);
}

// ---------------------------------------------------------------------------
// Carga de comentarios (CSV -> clientes + feedback_clientes)
// ---------------------------------------------------------------------------

/**
 * Valida, normaliza y clasifica los registros antes de tocar la base.
 * En 3FN el segmento y el valor mensual son datos del cliente: si el mismo cliente aparece
 * con valores distintos en el archivo, se rechaza la carga en vez de elegir uno a ciegas.
 */
export function prepararCarga(registros, { origen = 'carga' } = {}) {
  const clientes = new Map();
  const comentarios = new Map();
  registros.forEach((registro, i) => {
    const r = validarFeedback(registro, i + 1);
    if (r.valor_mensual_usd > MAX_VALOR_MENSUAL || Number(r.valor_mensual_usd.toFixed(2)) !== r.valor_mensual_usd) {
      throw new RangeError(`${r.id_cliente}: valor_mensual_usd admite hasta 2 decimales y un máximo de ${MAX_VALOR_MENSUAL}.`);
    }
    const previo = clientes.get(r.id_cliente);
    if (previo && (previo.segmento !== r.segmento || previo.valor_mensual_usd !== r.valor_mensual_usd)) {
      throw new RangeError(
        `${r.id_cliente} aparece con datos distintos (${previo.segmento} $${previo.valor_mensual_usd} y ${r.segmento} $${r.valor_mensual_usd}). ` +
        'En el modelo relacional el segmento y el valor mensual viven en una sola fila de "clientes": corrige el archivo.'
      );
    }
    clientes.set(r.id_cliente, {
      id_cliente: r.id_cliente,
      nombre_empresa: `Cliente ${r.id_cliente} (sin nombre en el CSV)`,
      segmento: r.segmento,
      valor_mensual_usd: r.valor_mensual_usd,
    });
    const c = clasificarComentario(r);
    const h = huella(r);
    comentarios.set(h, {
      id_cliente: r.id_cliente,
      codigo_categoria: c.categoria_id === SIN_CLASIFICAR.id ? null : c.categoria_id,
      id_riesgo: c.riesgo_id,
      canal: r.canal,
      comentario: r.comentario,
      huella: h,
      origen,
    });
  });
  return { clientes: [...clientes.values()], comentarios: [...comentarios.values()] };
}

// Los nombres de la semilla no se pisan: solo se actualizan segmento y valor mensual.
const SQL_UPSERT_CLIENTES = `
  INSERT INTO clientes (id_cliente, nombre_empresa, segmento, valor_mensual_usd)
  SELECT d.id_cliente, d.nombre_empresa, d.segmento, d.valor_mensual_usd
  FROM jsonb_to_recordset($1::jsonb)
       AS d(id_cliente varchar, nombre_empresa varchar, segmento varchar, valor_mensual_usd numeric)
  ON CONFLICT (id_cliente) DO UPDATE
     SET segmento = EXCLUDED.segmento, valor_mensual_usd = EXCLUDED.valor_mensual_usd
   WHERE (clientes.segmento, clientes.valor_mensual_usd)
         IS DISTINCT FROM (EXCLUDED.segmento, EXCLUDED.valor_mensual_usd)
  RETURNING id_cliente`;

// xmax = 0 identifica las filas recién insertadas (las actualizadas por ON CONFLICT tienen xmax)
const SQL_UPSERT_FEEDBACK = `
  INSERT INTO feedback_clientes (id_cliente, id_iniciativa, id_riesgo, canal, comentario, huella, origen)
  SELECT d.id_cliente, i.id_iniciativa, d.id_riesgo, d.canal, d.comentario, d.huella, d.origen
  FROM jsonb_to_recordset($1::jsonb)
       AS d(id_cliente varchar, codigo_categoria varchar, id_riesgo varchar, canal varchar,
            comentario text, huella char(64), origen varchar)
  LEFT JOIN iniciativas_rice i ON i.codigo_categoria = d.codigo_categoria
  ON CONFLICT (huella) DO UPDATE
     SET id_iniciativa = EXCLUDED.id_iniciativa, id_riesgo = EXCLUDED.id_riesgo,
         canal = EXCLUDED.canal, origen = EXCLUDED.origen
   WHERE (feedback_clientes.id_iniciativa, feedback_clientes.id_riesgo, feedback_clientes.canal, feedback_clientes.origen)
         IS DISTINCT FROM (EXCLUDED.id_iniciativa, EXCLUDED.id_riesgo, EXCLUDED.canal, EXCLUDED.origen)
  RETURNING (xmax = 0) AS insertado`;

/** Inserta o actualiza (por huella) los comentarios clasificados, en una sola transacción. */
export async function insertarFeedbackEnPostgres(db, registros, { origen = 'carga', cfg = {} } = {}) {
  const { clientes, comentarios } = prepararCarga(registros, { origen });
  if (comentarios.length === 0) return { insertados: 0, actualizados: 0, clientes_actualizados: 0 };
  return conTraduccion(cfg, () => enTransaccion(db, async (tx) => {
    const { rows: catalogo } = await tx.query('SELECT codigo_categoria FROM iniciativas_rice');
    const existentes = new Set(catalogo.map((f) => f.codigo_categoria));
    const faltantes = [...new Set(comentarios.map((c) => c.codigo_categoria).filter((c) => c && !existentes.has(c)))];
    if (faltantes.length) {
      throw errorExpuesto(`Faltan iniciativas en iniciativas_rice (${faltantes.join(', ')}): vuelve a ejecutar ${ARCHIVO_ESQUEMA}.`, 500);
    }
    const { rows: cambiados } = await tx.query(SQL_UPSERT_CLIENTES, [JSON.stringify(clientes)]);
    const { rows } = await tx.query(SQL_UPSERT_FEEDBACK, [JSON.stringify(comentarios)]);
    return {
      insertados: rows.filter((f) => f.insertado).length,
      actualizados: rows.filter((f) => !f.insertado).length,
      clientes_actualizados: cambiados.length,
    };
  }));
}

export async function eliminarFeedbackPorOrigen(db, origen, { cfg = {} } = {}) {
  return conTraduccion(cfg, async () => {
    const { rows } = await db.query('DELETE FROM feedback_clientes WHERE origen = $1 RETURNING id_feedback', [origen]);
    return rows.length;
  });
}

/** Comentarios con los datos del cliente (JOIN): mismo formato que el CSV. */
export async function leerFeedbackDesdePostgres(db, { cfg = {} } = {}) {
  return conTraduccion(cfg, async () => {
    const { rows } = await db.query(
      `SELECT f.id_cliente, c.segmento, c.valor_mensual_usd, f.comentario, f.canal
       FROM feedback_clientes f
       JOIN clientes c ON c.id_cliente = f.id_cliente
       ORDER BY f.id_feedback
       LIMIT $1`,
      [MAX_FILAS_CSV]
    );
    // Se valida también lo que viene de la base: no se confía en datos modificados por fuera de la app
    return rows.map((f, i) => validarFeedback({ ...f, valor_mensual_usd: Number(f.valor_mensual_usd) }, i + 1));
  });
}

// ---------------------------------------------------------------------------
// Matriz RICE calculada por el motor relacional
// ---------------------------------------------------------------------------

/** Lista blanca del ORDER BY (desafío 10): el criterio nunca se concatena tal cual. */
const ORDEN_MATRIZ = Object.freeze({
  score_rice: 'score_rice DESC, ingreso_en_riesgo_usd DESC, categoria_id COLLATE "C"',
  ingreso_en_riesgo_usd: 'ingreso_en_riesgo_usd DESC, score_rice DESC, categoria_id COLLATE "C"',
});

export const normalizarCriterio = (criterio) => (criterio === 'ingreso_en_riesgo_usd' ? criterio : 'score_rice');

export function consultaMatrizRICE(criterio = 'score_rice') {
  return `SELECT * FROM v_matriz_rice ORDER BY ${ORDEN_MATRIZ[normalizarCriterio(criterio)]}`;
}

const SQL_SIN_CLASIFICAR = `
  WITH por_cliente AS (
    SELECT f.id_cliente, MAX(c.valor_mensual_usd) AS valor, COUNT(*) AS menciones
    FROM feedback_clientes f
    JOIN clientes c ON c.id_cliente = f.id_cliente
    WHERE f.id_iniciativa IS NULL
    GROUP BY f.id_cliente
  )
  SELECT COALESCE(SUM(menciones), 0)::int                    AS total_menciones,
         COALESCE(ARRAY_AGG(id_cliente ORDER BY id_cliente), '{}') AS ids_clientes,
         COALESCE(SUM(valor), 0)                             AS ingreso_en_riesgo_usd
  FROM por_cliente`;

/** Algunos drivers devuelven los arreglos de texto como '{C-101,C-106}'. */
function aArreglo(valor) {
  if (Array.isArray(valor)) return valor;
  const texto = String(valor ?? '').replace(/^\{|\}$/g, '');
  return texto ? texto.split(',').map((v) => v.replace(/^"|"$/g, '')) : [];
}

/** NUMERIC y COUNT llegan como texto desde "pg": se convierten a número. */
export function aFilaMatriz(f) {
  return {
    categoria_id: f.categoria_id,
    titulo: f.titulo,
    titulo_corto: f.titulo_corto,
    clientes_afectados: Number(f.clientes_afectados),
    total_menciones: Number(f.total_menciones),
    ids_clientes: aArreglo(f.ids_clientes),
    ingreso_en_riesgo_usd: Number(f.ingreso_en_riesgo_usd),
    impacto_promedio: Number(f.impacto_promedio),
    reach: Number(f.reach),
    confidence_pct: Number(f.confidence_pct),
    esfuerzo_meses: Number(f.esfuerzo_meses),
    costo_estimado_usd: Number(f.costo_estimado_usd),
    eficacia_relativa: Number(f.eficacia_relativa),
    score_rice: Number(f.score_rice),
    desglose_riesgo: { churn: Number(f.churn), upsell: Number(f.upsell), friccion: Number(f.friccion) },
  };
}

export async function obtenerMatrizRICEDesdePostgres(db, { criterio = 'score_rice', cfg = {} } = {}) {
  return conTraduccion(cfg, async () => {
    const { rows: matriz } = await db.query(consultaMatrizRICE(criterio));
    const { rows: [sin] } = await db.query(SQL_SIN_CLASIFICAR);
    const { rows: [total] } = await db.query('SELECT COUNT(*)::int AS comentarios FROM feedback_clientes');
    return armarResumen({
      criterio: normalizarCriterio(criterio),
      origen: ORIGEN_POSTGRES,
      matriz: matriz.map(aFilaMatriz),
      sinClasificar: {
        total_menciones: Number(sin.total_menciones),
        ids_clientes: aArreglo(sin.ids_clientes),
        ingreso_en_riesgo_usd: Number(sin.ingreso_en_riesgo_usd),
      },
      totalComentarios: Number(total.comentarios),
    });
  });
}

// ---------------------------------------------------------------------------
// Simulaciones y dictámenes del Comité IA
// ---------------------------------------------------------------------------

const numeroONulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reparte el documento de la simulación entre columnas (para consultar con SQL) y JSONB. */
export function filaSimulacion(documento) {
  const { entradas = {}, kpis = {}, dictamen_ia: dictamen, ...resto } = documento;
  return {
    codigo_iniciativa: documento.iniciativa_simulada?.categoria_id ?? null,
    clientes_base: entradas.clientes_activos,
    precio_base_usd: entradas.precio_mensual_usd,
    precio_simulado_usd: kpis.precio_nuevo_usd,
    churn_base_pct: entradas.churn_mensual_pct,
    churn_proyectado_pct: kpis.churn_proyectado_pct,
    presupuesto_usd: entradas.presupuesto_usd,
    pct_retencion: entradas.pct_retencion,
    ltv_cac_ratio: numeroONulo(kpis.ratio_ltv_cac),
    roi_12m_pct: numeroONulo(kpis.roi_12m_pct),
    beneficio_neto_12m_usd: kpis.beneficio_neto_incremental_12m_usd,
    proveedor_ia: documento.proveedor_ia ?? 'local',
    modelo_ia: documento.modelo_ia ?? null,
    dictamen_ia_json: dictamen ?? {},
    detalle_json: { entradas, kpis, ...resto },
  };
}

export async function guardarSimulacionEnPostgres(db, documento, { cfg = {} } = {}) {
  const f = filaSimulacion(documento);
  return conTraduccion(cfg, async () => {
    const { rows } = await db.query(
      `INSERT INTO simulaciones_estrategicas (
         id_iniciativa_vinculada, clientes_base, precio_base_usd, precio_simulado_usd,
         churn_base_pct, churn_proyectado_pct, presupuesto_usd, pct_retencion,
         ltv_cac_ratio, roi_12m_pct, beneficio_neto_12m_usd, proveedor_ia, modelo_ia,
         dictamen_ia_json, detalle_json)
       VALUES (
         (SELECT id_iniciativa FROM iniciativas_rice WHERE codigo_categoria = $1),
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
       RETURNING id_simulacion`,
      [
        f.codigo_iniciativa, f.clientes_base, f.precio_base_usd, f.precio_simulado_usd,
        f.churn_base_pct, f.churn_proyectado_pct, f.presupuesto_usd, f.pct_retencion,
        f.ltv_cac_ratio, f.roi_12m_pct, f.beneficio_neto_12m_usd, f.proveedor_ia, f.modelo_ia,
        JSON.stringify(f.dictamen_ia_json), JSON.stringify(f.detalle_json),
      ]
    );
    return { id: String(rows[0].id_simulacion) };
  });
}

// ---------------------------------------------------------------------------
// Fuente de datos para el servidor (misma interfaz que el CSV y MongoDB Atlas)
// ---------------------------------------------------------------------------

/**
 * @param {object} config  resultado de cargarConfig()
 * @param {{ejecutor?: object}} [opciones]  ejecutor ya creado (las pruebas usan PGlite)
 */
export function crearFuentePostgres(config, { ejecutor = null } = {}) {
  const cfg = config.postgres ?? {};
  let db = ejecutor;
  const propio = !ejecutor; // solo se cierra el pool que creó esta fuente
  const usar = () => {
    if (!db) throw errorExpuesto('PostgreSQL no está conectado.');
    return db;
  };
  return {
    nombre: ORIGEN_POSTGRES,
    conectar: async () => {
      if (db) return conTraduccion(cfg, () => verificarEsquema(db, cfg));
      db = await conectarPostgreSQL(cfg);
    },
    cerrar: async () => {
      if (propio && db) await db.end();
      db = null;
    },
    leerFeedback: () => leerFeedbackDesdePostgres(usar(), { cfg }),
    obtenerMatriz: (criterio) => obtenerMatrizRICEDesdePostgres(usar(), { criterio, cfg }),
    guardarSimulacion: (documento) => guardarSimulacionEnPostgres(usar(), documento, { cfg }),
    estado: () => conTraduccion(cfg, async () => {
      await usar().query('SELECT 1');
      return 'conectada';
    }),
  };
}
