import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarComentario, clasificarLote, compilarPalabraClave } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { leerArchivo } from './_ayuda.js';

const ESPERADO = {
  'C-101': ['rendimiento_reportes', 'friccion'],
  'C-102': ['packaging_precio', 'friccion'],
  'C-103': ['integraciones_erp', 'churn'],
  'C-104': ['packaging_precio', 'churn'],
  'C-105': ['soporte_onboarding', 'friccion'],
  'C-106': ['rendimiento_reportes', 'friccion'],
  'C-107': ['alertas_whatsapp', 'upsell'],
  'C-108': ['soporte_onboarding', 'friccion'],
  'C-109': ['seguridad_auditoria', 'churn'],
  'C-110': ['integraciones_erp', 'friccion'],
  'C-111': ['packaging_precio', 'churn'],
  'C-112': ['rendimiento_reportes', 'upsell'],
};

const clasificados = clasificarLote(leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv')));

test('clasificación de los 12 comentarios del dataset', () => {
  for (const c of clasificados) {
    assert.deepEqual([c.categoria_id, c.riesgo_id], ESPERADO[c.id_cliente], c.id_cliente);
  }
});

test('C-109 (permisos y auditoría) ya no cae por defecto en Reportes', () => {
  const c109 = clasificados.find((c) => c.id_cliente === 'C-109');
  assert.equal(c109.categoria_id, 'seguridad_auditoria');
  assert.equal(c109.peso_impacto, 3.0);
});

test('compara palabras completas, no subcadenas', () => {
  assert.equal(compilarPalabraClave('api').test('soporte rapido'), false);
  assert.equal(compilarPalabraClave('api').test('conector api con el erp'), true);
  assert.equal(compilarPalabraClave('sap').test('alertas por whatsapp'), false);
  assert.equal(compilarPalabraClave('sap').test('erp sap'), true);
  assert.equal(compilarPalabraClave('rol').test('control de inventario'), false);
  assert.equal(compilarPalabraClave('reporte*').test('los reportes grandes'), true);
  assert.equal(compilarPalabraClave('plan basico').test('el plan   basico'), true);
});

test('ignora tildes y mayúsculas', () => {
  const r = clasificarComentario({ id_cliente: 'X', comentario: 'Necesitamos INTEGRACIÓN con SAP', canal: 'Email' });
  assert.equal(r.categoria_id, 'integraciones_erp');
});

test('sin coincidencias queda sin clasificar', () => {
  const r = clasificarComentario({ id_cliente: 'X', comentario: 'Todo bien por ahora, gracias.', canal: 'Email' });
  assert.equal(r.categoria_id, 'sin_clasificar');
  assert.equal(r.esfuerzo_meses, null);
  assert.equal(r.riesgo_id, 'friccion');
});

test('empate: gana la categoría mencionada primero y la otra queda como secundaria', () => {
  const c112 = clasificados.find((c) => c.id_cliente === 'C-112');
  assert.equal(c112.categoria_id, 'rendimiento_reportes');
  assert.deepEqual(c112.categorias_secundarias, ['alertas_whatsapp']);
  const invertido = clasificarComentario({ id_cliente: 'X', comentario: 'Agreguen alertas por WhatsApp y mejoren la velocidad de los reportes', canal: 'Email' });
  assert.equal(invertido.categoria_id, 'alertas_whatsapp');
});

test('riesgo de fuga detectado solo por el canal de cancelación', () => {
  const r = clasificarComentario({ id_cliente: 'X', comentario: 'El soporte es lento', canal: 'Formulario Cancelación' });
  assert.equal(r.riesgo_id, 'churn');
  assert.deepEqual(r.senales_riesgo, ['canal:cancel*']);
});

test('fuga tiene prioridad sobre upsell', () => {
  const r = clasificarComentario({ id_cliente: 'X', comentario: 'Pagaríamos más, pero si no hay ERP no podremos renovar', canal: 'Email' });
  assert.equal(r.riesgo_id, 'churn');
});
