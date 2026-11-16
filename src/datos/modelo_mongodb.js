/**
 * INSTANCIA 2: MongoDB Atlas (mongodb.com)
 *
 * Sigue la estructura base de la guía (MongoClient, connectToMongoDB, disconnectFromMongoDB,
 * inserción de documentos y Pipeline de Agregación $group / $addFields / $sort para la
 * matriz RICE en la nube), con tres cambios:
 *  1. La cadena de conexión se lee de MONGO_URI (.env); la guía la traía escrita en el código
 *     con el usuario del profesor.
 *  2. El redondeo es "mitad hacia arriba" con $floor(x + 0.5): $round de MongoDB redondea al
 *     par (78.5 -> 78) y la matriz no coincidiría con las otras instancias.
 *  3. Primero se agrupa por cliente y categoría: un cliente que reclama varias veces cuenta una vez.
 */
import { MongoClient } from 'mongodb';
import { huella } from './huella.js';
import { armarResumen } from './resumen.js';
import { clasificarComentario } from '../../public/js/core/clasificador.js';
import { buscarCategoria, PARAMETROS_RICE, SIN_CLASIFICAR } from '../../public/js/core/catalogo.js';
import { validarFeedback, MAX_FILAS_CSV } from '../../public/js/core/csv.js';

export const COLECCION_FEEDBACK = 'feedbacks';
export const COLECCION_SIMULACIONES = 'simulaciones';

let client = null;
let nombreBaseActual = 'stratai_db';

// ---------------------------------------------------------------------------
// Errores y credenciales
// ---------------------------------------------------------------------------

/** Oculta usuario y contraseña de una cadena de conexión antes de mostrarla o registrarla. */
export const ocultarCredenciales = (texto) =>
  String(texto ?? '').replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1***@');

/** Convierte errores del driver en mensajes accionables (sin exponer la cadena de conexión). */
export function traducirErrorMongo(error) {
  const mensaje = ocultarCredenciales(error?.message ?? error);
  let texto;
  if (/bad auth|authentication failed/i.test(mensaje)) {
    texto = 'Atlas rechazó el usuario o la contraseña de MONGO_URI.';
  } else if (/not authorized|unauthorized/i.test(mensaje)) {
    texto = 'El usuario de Atlas no tiene permisos sobre la base (necesita readWrite en stratai_db).';
  } else if (/querySrv|ENOTFOUND|getaddrinfo/i.test(mensaje)) {
    texto = 'No se encontró el clúster: revisa el host de MONGO_URI.';
  } else if (error?.name === 'MongoServerSelectionError' || /timed out|ECONNREFUSED|ETIMEDOUT|Server selection/i.test(mensaje)) {
    texto = 'No se pudo conectar a Atlas: revisa en Network Access que tu IP actual esté permitida.';
  } else {
    texto = `Error de MongoDB: ${mensaje.slice(0, 200)}`;
  }
  const traducido = new Error(texto);
  traducido.status = 503;
  traducido.expose = true;
  return traducido;
}

async function conTraduccion(operacion) {
  try {
    return await operacion();
  } catch (error) {
    throw error?.expose ? error : traducirErrorMongo(error);
  }
}

// ---------------------------------------------------------------------------
// Conexión (estructura de la guía)
// ---------------------------------------------------------------------------

export async function connectToMongoDB({ uri = process.env.MONGO_URI, nombreBase = process.env.MONGO_DB || 'stratai_db' } = {}) {
  if (client) return client;
  const nuevo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: 'stratai-decision-suite' });
  try {
    await nuevo.connect();
    await nuevo.db(nombreBase).command({ ping: 1 });
  } catch (error) {
    await nuevo.close().catch(() => {});
    throw traducirErrorMongo(error);
  }
  client = nuevo;
  nombreBaseActual = nombreBase;
  return client;
}

// Se llama solo cuando la aplicación termina
export async function disconnectFromMongoDB() {
  if (!client) return;
  await client.close();
  client = null;
}

const db = () => {
  if (!client) throw Object.assign(new Error('MongoDB Atlas no está conectado.'), { status: 503, expose: true });
  return client.db(nombreBaseActual);
};

// ---------------------------------------------------------------------------
// Documentos e inserción
// ---------------------------------------------------------------------------

/** Huella del comentario: permite volver a cargar el CSV sin duplicar documentos. */
export { huella };

/** Documento de la colección "feedbacks": datos del cliente + análisis del motor de reglas. */
export function aDocumento(registro, { origen = 'carga', fecha = new Date() } = {}) {
  const r = validarFeedback(registro);
  const c = clasificarComentario(r);
  const categoria = buscarCategoria(c.categoria_id);
  return {
    huella: huella(r),
    id_cliente: r.id_cliente,
    segmento: r.segmento,
    valor_mensual_usd: r.valor_mensual_usd,
    comentario: r.comentario,
    canal: r.canal,
    analisis_ia: {
      categoria_id: c.categoria_id,
      categoria_titulo: c.categoria_titulo,
      categoria_titulo_corto: categoria?.tituloCorto ?? SIN_CLASIFICAR.tituloCorto,
      categorias_secundarias: c.categorias_secundarias,
      palabras_detectadas: c.palabras_detectadas,
      nivel_riesgo: c.nivel_riesgo,
      riesgo_id: c.riesgo_id,
      senales_riesgo: c.senales_riesgo,
      peso_impacto: c.peso_impacto,
      esfuerzo_meses: c.esfuerzo_meses,
      costo_iniciativa_usd: c.costo_iniciativa_usd,
      eficacia_relativa: categoria?.eficaciaRelativa ?? 0,
    },
    origen,
    fecha_creacion: fecha,
  };
}

export async function prepararColecciones() {
  return conTraduccion(async () => {
    const feedbacks = db().collection(COLECCION_FEEDBACK);
    await feedbacks.createIndex({ huella: 1 }, { unique: true });
    await feedbacks.createIndex({ 'analisis_ia.categoria_id': 1 });
    await feedbacks.createIndex({ id_cliente: 1 });
    await db().collection(COLECCION_SIMULACIONES).createIndex({ fecha: -1 });
  });
}

/** Inserta o actualiza (por huella) los comentarios clasificados. */
export async function insertarFeedbackEnAtlas(registros, { origen = 'carga' } = {}) {
  const documentos = registros.map((r) => aDocumento(r, { origen }));
  if (documentos.length === 0) return { insertados: 0, actualizados: 0 };
  return conTraduccion(async () => {
    const r = await db().collection(COLECCION_FEEDBACK).bulkWrite(
      documentos.map(({ fecha_creacion: fecha, ...doc }) => ({
        updateOne: { filter: { huella: doc.huella }, update: { $set: doc, $setOnInsert: { fecha_creacion: fecha } }, upsert: true },
      })),
      { ordered: false }
    );
    return { insertados: r.upsertedCount, actualizados: r.modifiedCount };
  });
}

export async function eliminarFeedbackPorOrigen(origen) {
  return conTraduccion(async () => (await db().collection(COLECCION_FEEDBACK).deleteMany({ origen })).deletedCount);
}

export async function leerFeedbackDesdeAtlas() {
  return conTraduccion(async () => {
    const documentos = await db().collection(COLECCION_FEEDBACK)
      .find({}, { projection: { _id: 0, id_cliente: 1, segmento: 1, valor_mensual_usd: 1, comentario: 1, canal: 1 } })
      .sort({ fecha_creacion: 1, id_cliente: 1 })
      .limit(MAX_FILAS_CSV)
      .toArray();
    // Se valida también lo que viene de la base: no se confía en datos modificados por fuera de la app
    return documentos.map((d, i) => validarFeedback(d, i + 1));
  });
}

// ---------------------------------------------------------------------------
// Pipeline de Agregación: matriz RICE calculada en la nube
// ---------------------------------------------------------------------------

/** Redondeo mitad hacia arriba (valores positivos), igual que en el navegador y en PostgreSQL. */
const redondear = (expresion, decimales = 0) => {
  if (decimales === 0) return { $floor: { $add: [expresion, 0.5] } };
  const factor = 10 ** decimales;
  return { $divide: [{ $floor: { $add: [{ $multiply: [expresion, factor] }, 0.5] } }, factor] };
};

const contarRiesgo = (id) => ({ $sum: { $cond: [{ $eq: ['$analisis_ia.riesgo_id', id] }, 1, 0] } });

export function pipelineMatrizRICE({ criterio = 'score_rice', p = PARAMETROS_RICE } = {}) {
  const orden = criterio === 'ingreso_en_riesgo_usd'
    ? { ingreso_en_riesgo_usd: -1, score_rice: -1, _id: 1 }
    : { score_rice: -1, ingreso_en_riesgo_usd: -1, _id: 1 };
  return [
    { $match: { 'analisis_ia.categoria_id': { $ne: SIN_CLASIFICAR.id } } },
    // Etapa 1 ($group): un registro por cliente y categoría
    {
      $group: {
        _id: { categoria: '$analisis_ia.categoria_id', cliente: '$id_cliente' },
        titulo: { $first: '$analisis_ia.categoria_titulo' },
        titulo_corto: { $first: '$analisis_ia.categoria_titulo_corto' },
        esfuerzo_meses: { $first: '$analisis_ia.esfuerzo_meses' },
        costo_estimado_usd: { $first: '$analisis_ia.costo_iniciativa_usd' },
        eficacia_relativa: { $first: '$analisis_ia.eficacia_relativa' },
        valor: { $max: '$valor_mensual_usd' },
        peso: { $max: '$analisis_ia.peso_impacto' },
        menciones: { $sum: 1 },
        churn: contarRiesgo('churn'),
        upsell: contarRiesgo('upsell'),
        friccion: contarRiesgo('friccion'),
      },
    },
    // Etapa 2 ($group): por iniciativa, suma el ingreso en riesgo (Revenue at Risk)
    {
      $group: {
        _id: '$_id.categoria',
        titulo: { $first: '$titulo' },
        titulo_corto: { $first: '$titulo_corto' },
        esfuerzo_meses: { $first: '$esfuerzo_meses' },
        costo_estimado_usd: { $first: '$costo_estimado_usd' },
        eficacia_relativa: { $first: '$eficacia_relativa' },
        clientes_afectados: { $sum: 1 },
        total_menciones: { $sum: '$menciones' },
        ids_clientes: { $push: '$_id.cliente' },
        ingreso_en_riesgo_usd: { $sum: '$valor' },
        impacto_bruto: { $avg: '$peso' },
        churn: { $sum: '$churn' },
        upsell: { $sum: '$upsell' },
        friccion: { $sum: '$friccion' },
      },
    },
    // Etapa 3 ($addFields): reach, confianza e impacto
    {
      $addFields: {
        impacto_promedio: redondear('$impacto_bruto', p.decimalesImpacto),
        reach: redondear({ $add: [{ $multiply: ['$clientes_afectados', p.reachPorCliente] }, { $divide: ['$ingreso_en_riesgo_usd', p.divisorIngreso] }] }),
        confidence_pct: { $min: [p.confianzaMaxPct, { $add: [p.confianzaBasePct, { $multiply: [p.confianzaPorClientePct, '$clientes_afectados'] }] }] },
      },
    },
    // Etapa 4 ($addFields): score = reach × impacto × confianza / esfuerzo
    {
      $addFields: {
        score_rice: redondear({ $divide: [{ $multiply: ['$reach', '$impacto_promedio', '$confidence_pct'] }, { $multiply: [100, '$esfuerzo_meses'] }] }),
      },
    },
    // Etapa 5 ($sort): por score RICE o por ingreso en riesgo (desafío 10)
    { $sort: orden },
    {
      $project: {
        _id: 0,
        categoria_id: '$_id',
        titulo: 1,
        titulo_corto: 1,
        clientes_afectados: 1,
        total_menciones: 1,
        ids_clientes: 1,
        ingreso_en_riesgo_usd: 1,
        impacto_promedio: 1,
        reach: 1,
        confidence_pct: 1,
        esfuerzo_meses: 1,
        costo_estimado_usd: 1,
        eficacia_relativa: 1,
        score_rice: 1,
        desglose_riesgo: { churn: '$churn', upsell: '$upsell', friccion: '$friccion' },
      },
    },
  ];
}

export function pipelineSinClasificar() {
  return [
    { $match: { 'analisis_ia.categoria_id': SIN_CLASIFICAR.id } },
    { $group: { _id: '$id_cliente', valor: { $max: '$valor_mensual_usd' }, menciones: { $sum: 1 } } },
    { $group: { _id: null, total_menciones: { $sum: '$menciones' }, ids_clientes: { $push: '$_id' }, ingreso_en_riesgo_usd: { $sum: '$valor' } } },
  ];
}

/** Mismo formato que calcularMatrizRICE() del navegador (src/datos/resumen.js). */
export { armarResumen };

export async function obtenerMatrizRICEDesdeAtlas({ criterio = 'score_rice' } = {}) {
  return conTraduccion(async () => {
    const coleccion = db().collection(COLECCION_FEEDBACK);
    const [matriz, sinClasificar, totalComentarios] = await Promise.all([
      coleccion.aggregate(pipelineMatrizRICE({ criterio })).toArray(),
      coleccion.aggregate(pipelineSinClasificar()).toArray(),
      coleccion.countDocuments(),
    ]);
    return armarResumen({ criterio, matriz, sinClasificar: sinClasificar[0], totalComentarios });
  });
}

// ---------------------------------------------------------------------------
// Simulaciones y dictámenes del Comité IA
// ---------------------------------------------------------------------------

export async function guardarSimulacionEnAtlas(documento) {
  return conTraduccion(async () => {
    const r = await db().collection(COLECCION_SIMULACIONES).insertOne({ ...documento, fecha: new Date() });
    return { id: String(r.insertedId) };
  });
}

/** Fuente de datos para el servidor: misma interfaz que el CSV y PostgreSQL. */
export function crearFuenteMongo(config) {
  return {
    nombre: 'MongoDB Atlas',
    conectar: () => connectToMongoDB({ uri: config.mongo.uri, nombreBase: config.mongo.dbName }),
    cerrar: disconnectFromMongoDB,
    leerFeedback: leerFeedbackDesdeAtlas,
    obtenerMatriz: (criterio) => obtenerMatrizRICEDesdeAtlas({ criterio }),
    guardarSimulacion: guardarSimulacionEnAtlas,
    estado: () => conTraduccion(async () => {
      await db().command({ ping: 1 });
      return 'conectada';
    }),
  };
}
