/**
 * Instancia 2 (MongoDB Atlas) sin conexión: el pipeline de agregación se ejecuta con "mingo",
 * una implementación en JavaScript del lenguaje de agregación de MongoDB. La verificación contra
 * el clúster real la hace "npm run cargar:mongodb".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from 'mingo';
import {
  aDocumento, huella, pipelineMatrizRICE, pipelineSinClasificar, armarResumen,
  ocultarCredenciales, traducirErrorMongo,
} from '../src/datos/modelo_mongodb.js';
import { calcularMatrizRICE, compararMatrices } from '../public/js/core/rice.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { ENTRADAS_EJEMPLO } from '../public/js/core/finanzas.js';
import { cargarConfig } from '../src/config.js';
import { crearApp } from '../src/app.js';
import { leerArchivo } from './_ayuda.js';

const REGISTROS = leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'));
const DESAFIO_9 = ['E-201', 'E-202', 'E-203'].map((id) => ({
  id_cliente: id, segmento: 'Enterprise', valor_mensual_usd: 2500,
  comentario: 'Necesitamos auditoría de seguridad y control de accesos por normativa interna.', canal: 'Reunion Comercial',
}));

/** Lo que haría obtenerMatrizRICEDesdeAtlas(), pero sobre documentos en memoria. */
function matrizConPipeline(registros, criterio = 'score_rice') {
  const documentos = registros.map((r) => aDocumento(r, { origen: 'prueba' }));
  return armarResumen({
    criterio,
    matriz: aggregate(documentos, pipelineMatrizRICE({ criterio })),
    sinClasificar: aggregate(documentos, pipelineSinClasificar())[0],
    totalComentarios: documentos.length,
  });
}

const matrizNavegador = (registros, criterio = 'score_rice') => calcularMatrizRICE(clasificarLote(registros), { criterio });

describe('pipeline de agregación RICE', () => {
  test('da exactamente la misma matriz que el navegador (dataset de la clase, ambos criterios)', () => {
    for (const criterio of ['score_rice', 'ingreso_en_riesgo_usd']) {
      const atlas = matrizConPipeline(REGISTROS, criterio);
      const navegador = matrizNavegador(REGISTROS, criterio);
      assert.deepEqual(compararMatrices(atlas.matriz, navegador.matriz), [], criterio);
      assert.equal(atlas.totales.ingreso_en_riesgo_usd, 9410);
    }
  });

  test('valores de referencia: Precios 157 · Reportes 101 (reach 78.5 redondeado a 79, no a 78 como haría $round)', () => {
    const { matriz } = matrizConPipeline(REGISTROS);
    assert.deepEqual(matriz.slice(0, 2).map((f) => [f.categoria_id, f.score_rice, f.reach]), [
      ['packaging_precio', 157, 40],
      ['rendimiento_reportes', 101, 79],
    ]);
  });

  test('desafío 9, cliente repetido y comentario sin clasificar: sigue coincidiendo', () => {
    const extra = [
      ...DESAFIO_9,
      { ...REGISTROS.find((r) => r.id_cliente === 'C-110'), comentario: 'Otra vez: falta la integracion con el ERP.' },
      { id_cliente: 'Z-1', segmento: 'PyME', valor_mensual_usd: 500, comentario: 'Hola, saludos.', canal: 'Email' },
    ];
    const atlas = matrizConPipeline([...REGISTROS, ...extra]);
    const navegador = matrizNavegador([...REGISTROS, ...extra]);
    assert.deepEqual(compararMatrices(atlas.matriz, navegador.matriz), []);
    assert.equal(atlas.matriz[0].categoria_id, 'seguridad_auditoria');
    assert.equal(atlas.matriz[0].score_rice, 172);
    assert.deepEqual(atlas.sin_clasificar.ids_clientes, ['Z-1']);
    assert.equal(atlas.sin_clasificar.ingreso_en_riesgo_usd, 500);
  });

  test('compararMatrices detecta diferencias de valores y de orden', () => {
    const a = matrizNavegador(REGISTROS).matriz;
    const b = structuredClone(a);
    b[0].score_rice += 1;
    assert.match(compararMatrices(a, b)[0], /packaging_precio.score_rice: 157 vs 158/);
    assert.match(compararMatrices(a, [...a].reverse())[0], /orden distinto/);
    assert.deepEqual(compararMatrices(a, [...a].reverse(), { compararOrden: false }), []);
  });
});

describe('documentos de la colección feedbacks', () => {
  test('estructura de la guía: datos del cliente + analisis_ia', () => {
    const d = aDocumento(REGISTROS[8], { origen: 'datos_ejemplo.csv' });
    assert.equal(d.id_cliente, 'C-109');
    assert.equal(d.analisis_ia.categoria_id, 'seguridad_auditoria');
    assert.equal(d.analisis_ia.nivel_riesgo, 'Alto Riesgo de Fuga (Churn)');
    assert.equal(d.analisis_ia.peso_impacto, 3);
    assert.equal(d.analisis_ia.esfuerzo_meses, 1.5);
    assert.equal(d.analisis_ia.costo_iniciativa_usd, 11000);
    assert.equal(d.origen, 'datos_ejemplo.csv');
  });

  test('la huella permite recargar el CSV sin duplicar', () => {
    assert.equal(huella(REGISTROS[0]), huella({ ...REGISTROS[0] }));
    assert.notEqual(huella(REGISTROS[0]), huella({ ...REGISTROS[0], comentario: 'otro' }));
  });

  test('valida antes de insertar', () => {
    assert.throws(() => aDocumento({ ...REGISTROS[0], segmento: 'Gobierno' }), /segmento/);
  });
});

describe('seguridad de la conexión', () => {
  test('nunca muestra usuario ni contraseña de MONGO_URI', () => {
    const uri = 'mongodb+srv://stratai_app:Sup3rS3creta@cluster0.abc12.mongodb.net/?retryWrites=true';
    assert.equal(ocultarCredenciales(`fallo al conectar a ${uri}`), 'fallo al conectar a mongodb+srv://***@cluster0.abc12.mongodb.net/?retryWrites=true');
    const e = traducirErrorMongo(new Error(`bad auth : authentication failed for ${uri}`));
    assert.match(e.message, /usuario o la contraseña/);
    assert.ok(!e.message.includes('Sup3rS3creta'));
  });

  test('mensajes accionables para los errores típicos de Atlas', () => {
    assert.match(traducirErrorMongo(Object.assign(new Error('Server selection timed out after 10000 ms'), { name: 'MongoServerSelectionError' })).message, /Network Access/);
    assert.match(traducirErrorMongo(new Error('querySrv ENOTFOUND _mongodb._tcp.x.mongodb.net')).message, /host/);
    assert.match(traducirErrorMongo(new Error('user is not authorized on stratai_db')).message, /readWrite/);
    assert.equal(traducirErrorMongo(new Error('x')).status, 503);
  });
});

describe('servidor en modo mongodb (fuente simulada con el pipeline real)', () => {
  function fuenteEnMemoria() {
    const documentos = REGISTROS.map((r) => aDocumento(r, { origen: 'prueba' }));
    const guardadas = [];
    return {
      guardadas,
      nombre: 'MongoDB Atlas',
      conectar: async () => {},
      cerrar: async () => {},
      leerFeedback: async () => documentos.map(({ id_cliente, segmento, valor_mensual_usd, comentario, canal }) => ({ id_cliente, segmento, valor_mensual_usd, comentario, canal })),
      obtenerMatriz: async (criterio) => armarResumen({ criterio, matriz: aggregate(documentos, pipelineMatrizRICE({ criterio })), sinClasificar: aggregate(documentos, pipelineSinClasificar())[0], totalComentarios: documentos.length }),
      guardarSimulacion: async (doc) => { guardadas.push(doc); return { id: `sim-${guardadas.length}` }; },
      estado: async () => 'conectada',
    };
  }

  async function levantar(fuente) {
    const config = cargarConfig({ DB_MODE: 'mongodb', MONGO_URI: 'mongodb+srv://u:p@cluster0.x.mongodb.net/' });
    const servidor = await new Promise((r) => { const s = crearApp({ config, fuente }).listen(0, '127.0.0.1', () => r(s)); });
    return { url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((r) => servidor.close(r)) };
  }

  test('/api/health y /api/feedback entregan los datos y la matriz calculada en la base', async () => {
    const s = await levantar(fuenteEnMemoria());
    try {
      const salud = await (await fetch(`${s.url}/api/health`)).json();
      assert.equal(salud.modo, 'mongodb');
      assert.equal(salud.bd, 'conectada');
      const fb = await (await fetch(`${s.url}/api/feedback?criterio=ingreso_en_riesgo_usd`)).json();
      assert.equal(fb.origen, 'MongoDB Atlas');
      assert.equal(fb.total, 12);
      assert.equal(fb.matriz_servidor.criterio, 'ingreso_en_riesgo_usd');
      assert.equal(fb.matriz_servidor.matriz[0].categoria_id, 'rendimiento_reportes');
      assert.deepEqual(compararMatrices(fb.matriz_servidor.matriz, matrizNavegador(fb.datos, 'ingreso_en_riesgo_usd').matriz), []);
    } finally {
      await s.cerrar();
    }
  });

  test('/api/comite usa los datos de la base, suma los agregados en la sesión y guarda la simulación', async () => {
    const fuente = fuenteEnMemoria();
    const s = await levantar(fuente);
    try {
      const r = await fetch(`${s.url}/api/comite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entradas: ENTRADAS_EJEMPLO, registros: DESAFIO_9, modo: 'local' }),
      });
      const json = await r.json();
      assert.equal(r.status, 200, JSON.stringify(json));
      assert.equal(json.payload.origen_datos, 'MongoDB Atlas');
      assert.equal(json.payload.modulo_2_rice.total_comentarios, 15);
      assert.equal(json.payload.modulo_2_rice.iniciativas[0].categoria_id, 'seguridad_auditoria');
      assert.deepEqual(json.guardado, { destino: 'MongoDB Atlas', id: 'sim-1' });
      const guardada = fuente.guardadas[0];
      assert.equal(guardada.comentarios_agregados_en_sesion, 3);
      assert.equal(guardada.proveedor_ia, 'local');
      assert.equal(guardada.kpis.roi_12m_pct, 494.6);
      assert.ok(guardada.dictamen_ia.decision);
    } finally {
      await s.cerrar();
    }
  });

  test('si no se puede guardar, el dictamen se entrega igual', async () => {
    const fuente = { ...fuenteEnMemoria(), guardarSimulacion: async () => { throw Object.assign(new Error('No se pudo conectar a Atlas'), { expose: true }); } };
    const s = await levantar(fuente);
    try {
      const json = await (await fetch(`${s.url}/api/comite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entradas: ENTRADAS_EJEMPLO, modo: 'local' }) })).json();
      assert.ok(json.dictamen);
      assert.equal(json.guardado.error, 'No se pudo conectar a Atlas');
    } finally {
      await s.cerrar();
    }
  });

  test('base caída: /api/feedback responde 503 con un mensaje claro', async () => {
    const fuente = { ...fuenteEnMemoria(), leerFeedback: async () => { throw traducirErrorMongo(new Error('Server selection timed out')); } };
    const s = await levantar(fuente);
    try {
      const r = await fetch(`${s.url}/api/feedback`);
      assert.equal(r.status, 503);
      assert.match((await r.json()).error, /Network Access/);
    } finally {
      await s.cerrar();
    }
  });
});
