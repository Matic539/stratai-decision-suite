import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMatrizRICE } from '../public/js/core/rice.js';
import { clasificarLote, clasificarComentario } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { redondear } from '../public/js/core/utilidades.js';
import { leerArchivo } from './_ayuda.js';

const registros = leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'));
const clasificados = clasificarLote(registros);

// Matriz esperada para el dataset de la clase. Debe salir igual en CSV, MongoDB Atlas y PostgreSQL.
const MATRIZ_ESPERADA = [
  // categoria_id,          clientes, ingreso, impacto, reach, conf, score
  ['packaging_precio',       3,  425, 2.67, 40, 88, 157],
  ['rendimiento_reportes',   3, 5100, 2.17, 79, 88, 101],
  ['soporte_onboarding',     2,  395, 2.0,  27, 82,  44],
  ['integraciones_erp',      2, 1810, 2.5,  39, 82,  40],
  ['seguridad_auditoria',    1, 1400, 3.0,  24, 76,  36],
  ['alertas_whatsapp',       1,  280, 2.5,  14, 76,  22],
];

test('matriz RICE del dataset (orden y valores)', () => {
  const { matriz, sin_clasificar, totales } = calcularMatrizRICE(clasificados);
  assert.deepEqual(
    matriz.map((f) => [f.categoria_id, f.clientes_afectados, f.ingreso_en_riesgo_usd, f.impacto_promedio, f.reach, f.confidence_pct, f.score_rice]),
    MATRIZ_ESPERADA
  );
  assert.equal(sin_clasificar.total_menciones, 0);
  assert.equal(totales.ingreso_en_riesgo_usd, 9410);
});

test('desafío 10: ordenar por ingreso en riesgo cambia la prioridad', () => {
  const { matriz } = calcularMatrizRICE(clasificados, { criterio: 'ingreso_en_riesgo_usd' });
  assert.deepEqual(matriz.map((f) => f.categoria_id), [
    'rendimiento_reportes', 'integraciones_erp', 'seguridad_auditoria', 'packaging_precio', 'soporte_onboarding', 'alertas_whatsapp',
  ]);
});

test('desafío 9: 3 clientes Enterprise de 2.500 USD con quejas de seguridad pasan al puesto 1', () => {
  const nuevos = ['E-201', 'E-202', 'E-203'].map((id) =>
    clasificarComentario({ id_cliente: id, segmento: 'Enterprise', valor_mensual_usd: 2500, comentario: 'Necesitamos auditoría de seguridad y control de accesos por normativa interna.', canal: 'Reunion Comercial' })
  );
  const { matriz } = calcularMatrizRICE([...clasificados, ...nuevos]);
  const primero = matriz[0];
  assert.equal(primero.categoria_id, 'seguridad_auditoria');
  assert.equal(primero.clientes_afectados, 4);
  assert.equal(primero.ingreso_en_riesgo_usd, 8900);
  assert.equal(primero.impacto_promedio, 2.25);
  assert.equal(primero.reach, 122);
  assert.equal(primero.confidence_pct, 94);
  assert.equal(primero.score_rice, 172);
});

test('un cliente que reclama varias veces cuenta una sola vez', () => {
  const extra = clasificarComentario({ ...registros.find((r) => r.id_cliente === 'C-110'), comentario: 'Otra vez: falta la integracion con el ERP.' });
  const erp = calcularMatrizRICE([...clasificados, extra]).matriz.find((f) => f.categoria_id === 'integraciones_erp');
  assert.equal(erp.clientes_afectados, 2);
  assert.equal(erp.total_menciones, 3);
  assert.equal(erp.ingreso_en_riesgo_usd, 1810);
});

test('la confianza tiene tope de 95%', () => {
  const muchos = Array.from({ length: 6 }, (_, i) =>
    clasificarComentario({ id_cliente: `S-${i}`, segmento: 'PyME', valor_mensual_usd: 100, comentario: 'El soporte no responde', canal: 'Email' })
  );
  const fila = calcularMatrizRICE(muchos).matriz[0];
  assert.equal(fila.confidence_pct, 95);
});

test('los comentarios sin clasificar se informan aparte y no entran a la matriz', () => {
  const raro = clasificarComentario({ id_cliente: 'Z-1', segmento: 'PyME', valor_mensual_usd: 500, comentario: 'Hola, saludos.', canal: 'Email' });
  const r = calcularMatrizRICE([...clasificados, raro]);
  assert.equal(r.matriz.length, 6);
  assert.deepEqual(r.sin_clasificar.ids_clientes, ['Z-1']);
  assert.equal(r.sin_clasificar.ingreso_en_riesgo_usd, 500);
});

test('redondeo mitad hacia arriba (como Excel y PostgreSQL NUMERIC)', () => {
  assert.equal(redondear(78.5), 79); // reach de Reportes: 3 × 12 + 5100 / 120
  assert.equal(redondear(2.5), 3);
  assert.equal(redondear(-2.5), -3);
  assert.equal(redondear(1.005, 2), 1.01);
  assert.equal(redondear(2.1666666, 2), 2.17);
});
