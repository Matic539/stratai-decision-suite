import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simularEstrategia, ENTRADAS_EJEMPLO, factorReduccionChurn, churnTrasPrecio,
  semaforoLtvCac, calcularPayback, margenUnitario, calcularLTV,
} from '../public/js/core/finanzas.js';

const simular = (cambios = {}, supuestos = {}) => simularEstrategia({ ...ENTRADAS_EJEMPLO, ...cambios }, supuestos);

test('caso de la clase: KPIs de la estrategia híbrida (regresión)', () => {
  const { kpis } = simular();
  assert.equal(kpis.precioNuevo, 275);
  assert.equal(kpis.margenUnitario, 225);
  assert.equal(kpis.churnProyectadoPct, 2.96);
  assert.equal(kpis.ltv, 7592);
  assert.equal(kpis.ratioLtvCac, 12.7);
  assert.equal(kpis.semaforo.nivel, 'optimo');
  assert.equal(kpis.inversionRetencion, 11700);
  assert.equal(kpis.inversionAdquisicion, 6300);
  assert.equal(kpis.clientesAdquiridos, 10.5);
  assert.equal(kpis.beneficioNetoIncremental12m, 89019);
  assert.equal(kpis.roi12mPct, 494.6);
  assert.equal(kpis.paybackMeses, 2.9);
  assert.equal(kpis.puntoEquilibrioClientes, 107);
});

test('se generan las 4 curvas a 12 meses', () => {
  const { caminos } = simular();
  assert.deepEqual(Object.keys(caminos), ['statusQuo', 'soloPrecio', 'soloRetencion', 'hibrida']);
  for (const c of Object.values(caminos)) {
    assert.equal(c.clientes.length, 12);
    assert.equal(c.utilidadMensual.length, 12);
  }
});

test('sin cambio de precio ni presupuesto, todos los caminos son iguales al status quo', () => {
  const { caminos, kpis } = simular({ ajustePrecioPct: 0, presupuesto: 0 });
  for (const c of Object.values(caminos)) {
    assert.equal(c.beneficioIncremental, 0);
    assert.equal(c.roiPct, null);
    assert.equal(c.paybackMeses, null);
  }
  assert.equal(kpis.churnProyectadoPct, 4.5);
});

test('margen unitario y LTV (fórmulas de la guía)', () => {
  assert.equal(margenUnitario(275, 250, 0.2), 225);
  assert.equal(calcularLTV(200, 0.05), 4000);
  assert.equal(calcularLTV(200, 0.025), 8000); // ejemplo del Manual Docente
  assert.throws(() => calcularLTV(200, 0), /churn/);
});

test('reducción de churn: calibrada con el Excel, rendimientos decrecientes y tope', () => {
  assert.equal(factorReduccionChurn(0), 0);
  assert.ok(Math.abs(factorReduccionChurn(18000) - 0.5) < 1e-12);
  const mitad = factorReduccionChurn(9000);
  assert.ok(mitad > 0.25 && mitad < 0.5, 'la mitad del dinero logra más de la mitad del efecto');
  assert.equal(factorReduccionChurn(1e6), 0.6);
});

test('elasticidad: subir el precio aumenta el churn y bajarlo lo reduce', () => {
  const base = 0.045;
  assert.ok(churnTrasPrecio(base, 0.1, 250, 275, 0.8) > base);
  assert.ok(churnTrasPrecio(base, -0.1, 250, 275, 0.8) < base);
  // Superar a la competencia agrega penalización por brecha
  const sinBrecha = churnTrasPrecio(base, 0.1, 250, 275, 0.8);
  const conBrecha = churnTrasPrecio(base, 0.1, 250, 250, 0.8);
  assert.ok(conBrecha > sinBrecha);
  // El churn base ya refleja la brecha actual: sin cambio de precio no hay penalización
  assert.equal(churnTrasPrecio(base, 0, 300, 250, 0.8), base);
});

test('semáforo LTV/CAC', () => {
  assert.equal(semaforoLtvCac(3.0).nivel, 'optimo');
  assert.equal(semaforoLtvCac(2.99).nivel, 'ajustado');
  assert.equal(semaforoLtvCac(1.8).nivel, 'ajustado');
  assert.equal(semaforoLtvCac(1.79).nivel, 'riesgo');
});

test('payback interpolado dentro del mes', () => {
  assert.equal(calcularPayback([500, 500, 500], 1000), 2);
  assert.equal(calcularPayback([500, 500, 500], 1250), 2.5);
  assert.equal(calcularPayback([100, 100], 1000), null);
  assert.equal(calcularPayback([100], 0), null);
});

test('escenarios: pesimista ≤ base ≤ optimista', () => {
  for (const cambios of [{}, { ajustePrecioPct: -20 }, { ajustePrecioPct: 35, pctRetencion: 20 }, { churnMensualPct: 8, presupuesto: 40000 }]) {
    const { escenarios } = simular(cambios);
    assert.ok(escenarios.pesimista <= escenarios.base && escenarios.base <= escenarios.optimista, JSON.stringify({ cambios, escenarios }));
  }
});

test('captación orgánica por defecto mantiene estable la base', () => {
  const { entradas } = simularEstrategia({ ...ENTRADAS_EJEMPLO, nuevosOrganicosMes: undefined });
  assert.equal(entradas.nuevosOrganicosMes, 8);
});

test('validación de entradas', () => {
  assert.throws(() => simular({ churnMensualPct: 0 }), /churnMensualPct/);
  assert.throws(() => simular({ ajustePrecioPct: 50 }), /ajustePrecioPct/);
  assert.throws(() => simular({ pctRetencion: 120 }), /pctRetencion/);
  assert.throws(() => simular({ precio: 'abc' }), /precio/);
  assert.equal(simular({ precio: '250' }).entradas.precio, 250);
});

test('validación de supuestos editables', () => {
  assert.throws(() => simular({}, { elasticidadPrecio: 5 }), /elasticidadPrecio/);
  assert.throws(() => simular({}, { mesesAdquisicion: 0 }), /mesesAdquisicion/);
  assert.equal(simular({}, { mesesAdquisicion: '3' }).supuestos.mesesAdquisicion, 3);
});
