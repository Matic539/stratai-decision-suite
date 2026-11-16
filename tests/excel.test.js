/**
 * Oráculo: Excel del ramo recalculado con LibreOffice (tests/fixtures/excel_oraculo.json).
 * Si la réplica coincide con un motor de cálculo independiente, los bloques del simulador son correctos.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simularDilemaExcel } from '../public/js/core/dilema-excel.js';
import { simularEstrategia } from '../public/js/core/finanzas.js';
import { leerJSON } from './_ayuda.js';

const oraculo = leerJSON('./fixtures/excel_oraculo.json');
const CAMPOS = ['precio', 'gananciaPorCliente', 'clientesExtra', 'ltv', 'ratioLtvCac', 'clientesPorMes', 'gananciaOperativa', 'gananciaNeta', 'diferenciaVsActual'];

for (const [nombre, caso] of Object.entries(oraculo.casos)) {
  describe(`Excel, caso ${nombre}`, () => {
    const resultado = simularDilemaExcel(caso.entradas);
    for (const opcion of ['actual', 'A', 'B', 'C']) {
      test(`opción ${opcion} coincide con el Excel`, () => {
        for (const campo of CAMPOS) {
          assert.deepEqual(resultado.opciones[opcion][campo], caso.opciones[opcion][campo], `${opcion}.${campo}`);
        }
      });
    }
    test('el veredicto coincide con el Excel', () => {
      assert.equal(resultado.ganadorVeredicto, caso.ganadorVeredicto);
    });
  });
}

test('caso base: ROI de B = 213% y de C = 223%; C gana por 1.800 USD', () => {
  const { opciones } = simularDilemaExcel();
  assert.equal(Math.round(opciones.B.roi * 100), 213);
  assert.equal(Math.round(opciones.C.roi * 100), 223);
  assert.equal(opciones.C.gananciaNeta - opciones.B.gananciaNeta, 1800);
});

test('calibración: "100% Retención" del simulador reproduce la Opción C del Excel (±1%)', () => {
  const s = simularEstrategia({
    clientes: 180, precio: 250, precioCompetencia: 250, costoVariablePct: 20, costosFijosMes: 0,
    cac: 600, churnMensualPct: 4.5, ajustePrecioPct: 0, presupuesto: 18000, pctRetencion: 100, nuevosOrganicosMes: 8,
  });
  const excel = simularDilemaExcel().opciones;
  assert.equal(s.caminos.soloRetencion.churnMensualPct, 2.25);
  const dif = Math.abs(s.caminos.soloRetencion.beneficioIncremental - excel.C.diferenciaVsActual) / excel.C.diferenciaVsActual;
  assert.ok(dif < 0.01, `diferencia ${(dif * 100).toFixed(2)}%`);
  const difBase = Math.abs(s.caminos.statusQuo.utilidadAcumulada - excel.actual.gananciaNeta) / excel.actual.gananciaNeta;
  assert.ok(difBase < 0.01, `status quo difiere ${(difBase * 100).toFixed(2)}%`);
});
