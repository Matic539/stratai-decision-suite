/**
 * Instancia 3 (PostgreSQL) sin servidor: se usa PGlite, PostgreSQL compilado a WebAssembly,
 * que ejecuta el mismo sql/esquema_postgresql.sql (tablas, columna generada, vista, triggers,
 * semilla y permisos). La verificación contra el servidor real la hace "npm run cargar:postgres".
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  crearFuentePostgres, insertarFeedbackEnPostgres, eliminarFeedbackPorOrigen, leerFeedbackDesdePostgres,
  obtenerMatrizRICEDesdePostgres, guardarSimulacionEnPostgres, consultaMatrizRICE, prepararCarga,
  filaSimulacion, traducirErrorPostgres,
} from '../src/datos/modelo_postgresql.js';
import { calcularMatrizRICE, compararMatrices } from '../public/js/core/rice.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { CATEGORIAS, RIESGOS } from '../public/js/core/catalogo.js';
import { ENTRADAS_EJEMPLO } from '../public/js/core/finanzas.js';
import { cargarConfig } from '../src/config.js';
import { crearApp } from '../src/app.js';
import { leerArchivo } from './_ayuda.js';

const ESQUEMA = leerArchivo('../sql/esquema_postgresql.sql');
const REGISTROS = leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'));
const DESAFIO_9 = ['E-201', 'E-202', 'E-203'].map((id) => ({
  id_cliente: id, segmento: 'Enterprise', valor_mensual_usd: 2500,
  comentario: 'Necesitamos auditoría de seguridad y control de accesos por normativa interna.', canal: 'Reunion Comercial',
}));
const ORIGEN = 'datos_ejemplo.csv';

const matrizNavegador = (registros, criterio = 'score_rice') => calcularMatrizRICE(clasificarLote(registros), { criterio });
const porId = (matriz, id) => matriz.find((f) => f.categoria_id === id);

let db;

before(async () => {
  db = new PGlite();
  await db.exec(ESQUEMA);
});
after(async () => db?.close());

/** Cada prueba parte de la base recién creada: sin comentarios y con los clientes del CSV. */
beforeEach(async () => {
  await db.exec(`
    DELETE FROM simulaciones_estrategicas;
    DELETE FROM feedback_clientes;
    DELETE FROM clientes WHERE id_cliente NOT LIKE 'C-1%';
  `);
  await db.exec(ESQUEMA); // la semilla es idempotente
  await insertarFeedbackEnPostgres(db, REGISTROS, { origen: ORIGEN });
  await db.query("UPDATE clientes SET valor_mensual_usd = 1500 WHERE id_cliente = 'C-103'");
});

describe('esquema y semilla', () => {
  test('el catálogo de iniciativas y los niveles de riesgo coinciden con catalogo.js', async () => {
    const { rows } = await db.query('SELECT * FROM iniciativas_rice ORDER BY id_iniciativa');
    assert.deepEqual(rows.map((f) => f.codigo_categoria), CATEGORIAS.map((c) => c.id));
    for (const c of CATEGORIAS) {
      const f = rows.find((r) => r.codigo_categoria === c.id);
      assert.equal(f.titulo, c.titulo);
      assert.equal(f.titulo_corto, c.tituloCorto);
      assert.equal(Number(f.esfuerzo_meses), c.esfuerzoMeses);
      assert.equal(Number(f.costo_estimado_usd), c.costoUSD);
      assert.equal(Number(f.eficacia_relativa), c.eficaciaRelativa);
    }
    const { rows: riesgos } = await db.query('SELECT * FROM niveles_riesgo');
    for (const r of Object.values(RIESGOS)) {
      const f = riesgos.find((x) => x.id_riesgo === r.id);
      assert.equal(f.etiqueta, r.etiqueta);
      assert.equal(Number(f.peso_impacto), r.pesoImpacto);
    }
  });

  test('los 12 clientes de la semilla tienen el segmento y el valor del CSV', async () => {
    const { rows } = await db.query('SELECT id_cliente, segmento, valor_mensual_usd FROM clientes');
    for (const r of REGISTROS) {
      const f = rows.find((c) => c.id_cliente === r.id_cliente);
      assert.ok(f, r.id_cliente);
      assert.equal(f.segmento, r.segmento);
      assert.equal(Number(f.valor_mensual_usd), r.valor_mensual_usd);
    }
  });

  test('score_rice es una columna generada: cambia sola si cambia el esfuerzo', async () => {
    await db.query("UPDATE iniciativas_rice SET esfuerzo_meses = 1.2 WHERE codigo_categoria = 'packaging_precio'");
    const { rows: [f] } = await db.query("SELECT score_rice FROM iniciativas_rice WHERE codigo_categoria = 'packaging_precio'");
    assert.equal(f.score_rice, Math.round((40 * 2.67 * 88) / (100 * 1.2))); // la mitad del esfuerzo original
    await assert.rejects(db.query('UPDATE iniciativas_rice SET score_rice = 1'), /only be updated to DEFAULT|generated/i);
  });

  test('el rol stratai_app puede leer y escribir datos, pero no cambiar la estructura', async () => {
    await db.exec('SET ROLE stratai_app');
    try {
      await insertarFeedbackEnPostgres(db, REGISTROS, { origen: ORIGEN });
      await db.query("UPDATE clientes SET valor_mensual_usd = 1500 WHERE id_cliente = 'C-103'");
      await assert.rejects(db.query('DROP TABLE clientes'), /owner|permission/i);
      await assert.rejects(db.query("UPDATE clientes SET nombre_empresa = 'x'"), /permission/i);
      await assert.rejects(db.query('UPDATE iniciativas_rice SET esfuerzo_meses = 9'), /permission/i);
      await assert.rejects(db.query('DELETE FROM simulaciones_estrategicas'), /permission/i);
    } finally {
      await db.exec('RESET ROLE');
    }
  });
});

describe('matriz RICE calculada por el motor relacional', () => {
  test('coincide con la del navegador en ambos criterios (valores y orden)', async () => {
    for (const criterio of ['score_rice', 'ingreso_en_riesgo_usd']) {
      const sql = await obtenerMatrizRICEDesdePostgres(db, { criterio });
      const datos = await leerFeedbackDesdePostgres(db);
      assert.deepEqual(compararMatrices(sql.matriz, matrizNavegador(datos, criterio).matriz), [], criterio);
      assert.equal(sql.origen, 'PostgreSQL');
      assert.equal(sql.totales.ingreso_en_riesgo_usd, 9410);
      assert.equal(sql.totales.comentarios, 12);
    }
  });

  test('resultados de referencia: Precios 157, Reportes 101 con reach 79', async () => {
    const { matriz } = await obtenerMatrizRICEDesdePostgres(db);
    assert.deepEqual(matriz.map((f) => [f.categoria_id, f.score_rice]), [
      ['packaging_precio', 157], ['rendimiento_reportes', 101], ['soporte_onboarding', 44],
      ['integraciones_erp', 40], ['seguridad_auditoria', 36], ['alertas_whatsapp', 22],
    ]);
    assert.equal(porId(matriz, 'rendimiento_reportes').reach, 79);
    assert.deepEqual(porId(matriz, 'rendimiento_reportes').ids_clientes, ['C-101', 'C-106', 'C-112']);
  });

  test('desafío 10: ordenar por ingreso en riesgo pone a Reportes primero', async () => {
    const { matriz, criterio } = await obtenerMatrizRICEDesdePostgres(db, { criterio: 'ingreso_en_riesgo_usd' });
    assert.equal(criterio, 'ingreso_en_riesgo_usd');
    assert.equal(matriz[0].categoria_id, 'rendimiento_reportes');
  });

  test('desafío 11: duplicar el valor de C-103 cambia ingreso y score sin tocar los comentarios', async () => {
    const comentariosAntes = (await db.query('SELECT * FROM feedback_clientes ORDER BY id_feedback')).rows;
    await db.query("UPDATE clientes SET valor_mensual_usd = valor_mensual_usd * 2 WHERE id_cliente = 'C-103'");
    const { matriz, totales } = await obtenerMatrizRICEDesdePostgres(db);
    const erp = porId(matriz, 'integraciones_erp');
    assert.equal(erp.ingreso_en_riesgo_usd, 3310);
    assert.equal(erp.reach, 52);
    assert.equal(erp.score_rice, 53);
    assert.equal(erp.posicion, 3);
    assert.equal(totales.ingreso_en_riesgo_usd, 10910);
    assert.deepEqual((await db.query('SELECT * FROM feedback_clientes ORDER BY id_feedback')).rows, comentariosAntes);
    assert.deepEqual(compararMatrices(matriz, matrizNavegador(await leerFeedbackDesdePostgres(db)).matriz), []);
    // Volver a cargar el CSV restaura el valor original
    await insertarFeedbackEnPostgres(db, REGISTROS, { origen: ORIGEN });
    assert.equal(porId((await obtenerMatrizRICEDesdePostgres(db)).matriz, 'integraciones_erp').score_rice, 40);
  });

  test('desafío 9: 3 clientes Enterprise con quejas de seguridad pasan al puesto 1 (score 172)', async () => {
    await insertarFeedbackEnPostgres(db, DESAFIO_9, { origen: 'desafio-9' });
    const { matriz } = await obtenerMatrizRICEDesdePostgres(db);
    assert.equal(matriz[0].categoria_id, 'seguridad_auditoria');
    assert.equal(matriz[0].score_rice, 172);
    assert.deepEqual(compararMatrices(matriz, matrizNavegador([...REGISTROS, ...DESAFIO_9]).matriz), []);
    assert.equal(await eliminarFeedbackPorOrigen(db, 'desafio-9'), 3);
    assert.equal((await obtenerMatrizRICEDesdePostgres(db)).matriz[0].categoria_id, 'packaging_precio');
  });

  test('un cliente que reclama dos veces cuenta una vez; lo sin clasificar queda fuera de la matriz', async () => {
    const extra = [
      { ...REGISTROS[0], comentario: 'Los reportes siguen lentos y la exportacion falla.' },
      { id_cliente: 'Z-900', segmento: 'PyME', valor_mensual_usd: 150, comentario: 'Gracias por todo.', canal: 'Correo' },
    ];
    await insertarFeedbackEnPostgres(db, extra, { origen: 'extra' });
    const resumen = await obtenerMatrizRICEDesdePostgres(db);
    const navegador = matrizNavegador([...REGISTROS, ...extra]);
    assert.deepEqual(compararMatrices(resumen.matriz, navegador.matriz), []);
    const reportes = porId(resumen.matriz, 'rendimiento_reportes');
    assert.equal(reportes.clientes_afectados, 3);
    assert.equal(reportes.total_menciones, 4);
    assert.deepEqual(resumen.sin_clasificar, { ...navegador.sin_clasificar });
    assert.equal(resumen.totales.comentarios, 14);
  });

  test('volver a cargar el mismo CSV no duplica comentarios', async () => {
    const r = await insertarFeedbackEnPostgres(db, REGISTROS, { origen: ORIGEN });
    assert.deepEqual(r, { insertados: 0, actualizados: 0, clientes_actualizados: 0 });
    const { rows: [n] } = await db.query('SELECT COUNT(*)::int AS n FROM feedback_clientes');
    assert.equal(n.n, 12);
  });
});

describe('seguridad y validación de datos', () => {
  test('un comentario con SQL se guarda como texto (consultas parametrizadas)', async () => {
    const malicioso = { id_cliente: 'X-1', segmento: 'PyME', valor_mensual_usd: 10, comentario: "'); DROP TABLE clientes; -- el precio es caro", canal: 'Web' };
    await insertarFeedbackEnPostgres(db, [malicioso], { origen: 'x' });
    const { rows } = await db.query('SELECT comentario FROM feedback_clientes WHERE id_cliente = $1', ['X-1']);
    assert.equal(rows[0].comentario, malicioso.comentario);
    assert.ok((await db.query('SELECT COUNT(*)::int AS n FROM clientes')).rows[0].n >= 12);
  });

  test('el criterio de orden sale de una lista blanca', () => {
    assert.match(consultaMatrizRICE('ingreso_en_riesgo_usd'), /ORDER BY ingreso_en_riesgo_usd DESC/);
    const sql = consultaMatrizRICE('score_rice; DROP TABLE clientes');
    assert.match(sql, /ORDER BY score_rice DESC/);
    assert.doesNotMatch(sql, /DROP/);
  });

  test('rechaza un cliente con segmento o valor distinto en el mismo archivo (3FN)', () => {
    assert.throws(
      () => prepararCarga([REGISTROS[0], { ...REGISTROS[0], comentario: 'Otro reclamo', valor_mensual_usd: 999 }]),
      /C-101 aparece con datos distintos/
    );
    assert.throws(() => prepararCarga([{ ...REGISTROS[0], valor_mensual_usd: 10.555 }]), /2 decimales/);
  });

  test('los errores del driver se traducen sin mostrar la contraseña', () => {
    const cfg = { host: '127.0.0.1', port: 5432, user: 'stratai_app', password: 'secreta123', database: 'stratai_db' };
    assert.match(traducirErrorPostgres({ code: '28P01', message: 'password authentication failed for user "stratai_app"' }, cfg).message, /PGUSER y PGPASSWORD/);
    assert.match(traducirErrorPostgres({ code: '3D000', message: 'database "stratai_db" does not exist' }, cfg).message, /CREATE DATABASE stratai_db/);
    assert.match(traducirErrorPostgres({ code: '42P01', message: 'relation "v_matriz_rice" does not exist' }, cfg).message, /esquema_postgresql\.sql/);
    assert.match(traducirErrorPostgres({ code: '42501', message: 'permission denied' }, cfg).message, /GRANT/);
    assert.match(traducirErrorPostgres({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' }, cfg).message, /servicio esté iniciado/);
    const otro = traducirErrorPostgres({ message: 'algo falló con secreta123' }, cfg);
    assert.doesNotMatch(otro.message, /secreta123/);
    assert.equal(otro.expose, true);
  });
});

describe('simulaciones y servidor en modo postgres', () => {
  const documento = {
    entradas: { clientes_activos: 180, precio_mensual_usd: 250, churn_mensual_pct: 4.5, presupuesto_usd: 18000, pct_retencion: 65 },
    kpis: { precio_nuevo_usd: 275, churn_proyectado_pct: 2.96, ratio_ltv_cac: 12.7, roi_12m_pct: null, beneficio_neto_incremental_12m_usd: 89019 },
    iniciativa_simulada: { categoria_id: 'packaging_precio' },
    proveedor_ia: 'openrouter',
    modelo_ia: 'modelo/prueba:free',
    dictamen_ia: { decision: 'Avanzar', iniciativa_prioritaria: 'packaging_precio' },
    verificacion_cifras: { revisadas: 10, verificadas: 10, no_encontradas: [] },
  };

  test('guarda la simulación en columnas y el dictamen en JSONB', async () => {
    const { id } = await guardarSimulacionEnPostgres(db, documento);
    const { rows: [f] } = await db.query(
      `SELECT s.*, i.codigo_categoria FROM simulaciones_estrategicas s
       LEFT JOIN iniciativas_rice i ON i.id_iniciativa = s.id_iniciativa_vinculada WHERE id_simulacion = $1`, [Number(id)]
    );
    assert.equal(f.codigo_categoria, 'packaging_precio');
    assert.equal(Number(f.churn_proyectado_pct), 2.96);
    assert.equal(f.roi_12m_pct, null);
    assert.equal(f.dictamen_ia_json.decision, 'Avanzar');
    assert.equal(f.detalle_json.verificacion_cifras.verificadas, 10);
    assert.equal(filaSimulacion(documento).ltv_cac_ratio, 12.7);
  });

  async function levantar() {
    const config = cargarConfig({ DB_MODE: 'postgres', PGUSER: 'stratai_app' });
    const fuente = crearFuentePostgres(config, { ejecutor: db });
    await fuente.conectar();
    const servidor = await new Promise((r) => { const s = crearApp({ config, fuente }).listen(0, '127.0.0.1', () => r(s)); });
    return { url: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((r) => servidor.close(r)) };
  }

  test('/api/feedback entrega los datos y la matriz calculada por PostgreSQL', async () => {
    const s = await levantar();
    try {
      const salud = await (await fetch(`${s.url}/api/health`)).json();
      assert.equal(salud.modo, 'postgres');
      assert.equal(salud.fuente, 'PostgreSQL');
      assert.equal(salud.bd, 'conectada');
      const fb = await (await fetch(`${s.url}/api/feedback?criterio=ingreso_en_riesgo_usd`)).json();
      assert.equal(fb.origen, 'PostgreSQL');
      assert.equal(fb.total, 12);
      assert.equal(fb.matriz_servidor.matriz[0].categoria_id, 'rendimiento_reportes');
      assert.deepEqual(compararMatrices(fb.matriz_servidor.matriz, matrizNavegador(fb.datos, 'ingreso_en_riesgo_usd').matriz), []);
    } finally {
      await s.cerrar();
    }
  });

  test('/api/comite suma los comentarios de la sesión y guarda la simulación en PostgreSQL', async () => {
    const s = await levantar();
    try {
      const r = await fetch(`${s.url}/api/comite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entradas: ENTRADAS_EJEMPLO, registros: DESAFIO_9, modo: 'local' }),
      });
      const json = await r.json();
      assert.equal(r.status, 200, JSON.stringify(json));
      assert.equal(json.payload.origen_datos, 'PostgreSQL');
      assert.equal(json.payload.modulo_2_rice.iniciativas[0].categoria_id, 'seguridad_auditoria');
      assert.equal(json.guardado.destino, 'PostgreSQL');
      const { rows: [f] } = await db.query('SELECT proveedor_ia, detalle_json FROM simulaciones_estrategicas WHERE id_simulacion = $1', [Number(json.guardado.id)]);
      assert.equal(f.proveedor_ia, 'local');
      assert.equal(f.detalle_json.comentarios_agregados_en_sesion, 3);
      // Los comentarios de la sesión no se guardan como feedback
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM feedback_clientes')).rows[0].n, 12);
    } finally {
      await s.cerrar();
    }
  });
});
