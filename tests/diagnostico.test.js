import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticarEstrategia } from '../public/js/core/diagnostico.js';
import { simularEstrategia, ENTRADAS_EJEMPLO } from '../public/js/core/finanzas.js';

const ids = (cambios) => diagnosticarEstrategia(simularEstrategia({ ...ENTRADAS_EJEMPLO, ...cambios })).map((r) => r.id);

test('caso de la clase: estrategia equilibrada, sin alertas', () => {
  assert.deepEqual(ids({}), ['equilibrio']);
});

test('balde roto: churn alto y poca inversión en retención', () => {
  assert.ok(ids({ churnMensualPct: 6, pctRetencion: 30 }).includes('balde_roto'));
  assert.ok(!ids({ churnMensualPct: 6, pctRetencion: 70 }).includes('balde_roto'));
});

test('precio muy sobre la competencia con poca retención', () => {
  assert.ok(ids({ precioCompetencia: 250, ajustePrecioPct: 40, pctRetencion: 20 }).includes('precio_sobre_competencia'));
});

test('margen negativo y LTV/CAC en riesgo', () => {
  const r = ids({ costoVariablePct: 95, ajustePrecioPct: -25 });
  assert.ok(r.includes('margen_negativo'));
  assert.ok(r.includes('ltv_cac_riesgo'));
});

test('bajo el punto de equilibrio', () => {
  assert.ok(ids({ costosFijosMes: 60000 }).includes('bajo_equilibrio'));
});

test('invertir todo en marketing rinde menos que todo en producto (como en el Excel)', () => {
  assert.ok(ids({ ajustePrecioPct: 0, pctRetencion: 0 }).includes('mejor_retencion'));
});

test('bajar el precio sin presupuesto pierde contra el status quo', () => {
  assert.ok(ids({ ajustePrecioPct: -20, presupuesto: 0 }).includes('destruye_valor'));
});

test('los críticos van primero', () => {
  const r = diagnosticarEstrategia(simularEstrategia({ ...ENTRADAS_EJEMPLO, churnMensualPct: 6, pctRetencion: 0, ajustePrecioPct: 0 }));
  const niveles = r.map((x) => x.nivel);
  assert.deepEqual(niveles, [...niveles].sort((a, b) => ['critico', 'advertencia', 'info', 'ok'].indexOf(a) - ['critico', 'advertencia', 'info', 'ok'].indexOf(b)));
});
