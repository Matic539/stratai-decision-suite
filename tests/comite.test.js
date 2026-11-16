import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirPayload, construirPromptComite } from '../public/js/core/comite.js';
import { simularEstrategia, ENTRADAS_EJEMPLO, parametrosDesdeIniciativa } from '../public/js/core/finanzas.js';
import { diagnosticarEstrategia } from '../public/js/core/diagnostico.js';
import { calcularMatrizRICE } from '../public/js/core/rice.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { leerArchivo } from './_ayuda.js';

const registros = leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'));
const rice = calcularMatrizRICE(clasificarLote(registros));
const simulacion = simularEstrategia(ENTRADAS_EJEMPLO);
const diagnosticos = diagnosticarEstrategia(simulacion);
const fecha = new Date('2026-11-12T12:00:00Z');
const payload = construirPayload({ simulacion, rice, diagnosticos, fecha });

test('el payload lleva las cifras calculadas, sin recalcular', () => {
  const k = payload.modulo_1_simulador.kpis_estrategia_hibrida;
  assert.equal(k.beneficio_neto_incremental_12m_usd, simulacion.kpis.beneficioNetoIncremental12m);
  assert.equal(k.ratio_ltv_cac, 12.7);
  assert.equal(payload.modulo_2_rice.iniciativas.length, 6);
  assert.equal(payload.modulo_2_rice.iniciativas[0].categoria_id, 'packaging_precio');
  assert.equal(payload.modulo_2_rice.ingreso_total_en_riesgo_usd, 9410);
  assert.equal(payload.generado_en, '2026-11-12T12:00:00.000Z');
});

test('privacidad: no salen ids de clientes ni textos de comentarios hacia la IA', () => {
  const texto = JSON.stringify(payload);
  for (const r of registros) {
    assert.ok(!texto.includes(r.id_cliente), `se filtró ${r.id_cliente}`);
    assert.ok(!texto.includes(r.comentario.slice(0, 25)), 'se filtró un comentario');
  }
});

test('el prompt incluye las reglas y un JSON válido con los datos', () => {
  const { sistema, usuario, completo } = construirPromptComite(payload);
  assert.match(sistema, /SOLO las cifras del JSON/);
  assert.match(sistema, /score_rice/);
  // Lenguaje de negocio: el campo va entre paréntesis después de la cifra, no como sustantivo
  assert.match(sistema, /lenguaje de negocio/);
  assert.match(sistema, /\(roi_12m_pct\)/);
  assert.match(sistema, /por su titulo/);
  const json = JSON.parse(usuario.slice(usuario.indexOf('{')));
  assert.deepEqual(json, JSON.parse(JSON.stringify(payload)));
  assert.ok(completo.startsWith(sistema));
});

test('"Simular ROI" de una iniciativa carga su costo y eficacia en el simulador', () => {
  const erp = rice.matriz.find((f) => f.categoria_id === 'integraciones_erp');
  const p = parametrosDesdeIniciativa(erp);
  assert.deepEqual(p, { entradas: { presupuesto: 14000, pctRetencion: 80 }, supuestos: { eficaciaProducto: 1.4 } });
  const s = simularEstrategia({ ...ENTRADAS_EJEMPLO, ...p.entradas }, p.supuestos);
  assert.equal(s.kpis.inversionRetencion, 11200);
  assert.ok(s.kpis.churnProyectadoPct < ENTRADAS_EJEMPLO.churnMensualPct);
  const conIniciativa = construirPayload({ simulacion: s, rice, diagnosticos: diagnosticarEstrategia(s), iniciativa: erp, fecha });
  assert.equal(conIniciativa.iniciativa_simulada.categoria_id, 'integraciones_erp');
});
