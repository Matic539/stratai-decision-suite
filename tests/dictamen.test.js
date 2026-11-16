import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirPayload, validarDictamen, extraerJSON } from '../public/js/core/comite.js';
import { generarDictamenLocal } from '../public/js/core/dictamen-local.js';
import { verificarCifras } from '../public/js/core/verificacion.js';
import { simularEstrategia, ENTRADAS_EJEMPLO } from '../public/js/core/finanzas.js';
import { diagnosticarEstrategia } from '../public/js/core/diagnostico.js';
import { calcularMatrizRICE } from '../public/js/core/rice.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { leerArchivo } from './_ayuda.js';

const rice = calcularMatrizRICE(clasificarLote(leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'))));
function armarPayload(cambios = {}) {
  const simulacion = simularEstrategia({ ...ENTRADAS_EJEMPLO, ...cambios });
  return construirPayload({ simulacion, rice, diagnosticos: diagnosticarEstrategia(simulacion), fecha: new Date('2026-11-12T12:00:00Z') });
}
const payload = armarPayload();

// --- Dictamen local ---------------------------------------------------------
test('el dictamen local cumple el formato y todas sus cifras están en el JSON', () => {
  for (const cambios of [{}, { churnMensualPct: 6, pctRetencion: 30 }, { ajustePrecioPct: -20, presupuesto: 0 }, { costosFijosMes: 60000 }]) {
    const p = armarPayload(cambios);
    const local = generarDictamenLocal(p);
    const v = validarDictamen(local, p);
    assert.ok(v.ok, `${JSON.stringify(cambios)}: ${v.errores.join('; ')}`);
    const verif = verificarCifras(v.dictamen, p);
    assert.deepEqual(verif.no_encontradas, [], JSON.stringify(cambios));
    assert.ok(verif.revisadas > 0);
  }
});

test('regla de decisión del dictamen local', () => {
  assert.equal(generarDictamenLocal(payload).decision, 'Avanzar');
  assert.equal(generarDictamenLocal(armarPayload({ churnMensualPct: 6, pctRetencion: 30 })).decision, 'Pivotar');
  assert.equal(generarDictamenLocal(armarPayload({ ajustePrecioPct: -20, presupuesto: 0 })).decision, 'Descartar');
});

test('prioridad: Reportes ($5,100) supera 3 veces a Precios ($425, #1 por RICE)', () => {
  const local = generarDictamenLocal(payload);
  assert.equal(local.iniciativa_prioritaria, 'rendimiento_reportes');
  assert.match(local.vision_coo.argumentos[0], /se prioriza el dinero en riesgo/);
});

// --- Verificador de cifras ----------------------------------------------------
const dictamenBase = () => JSON.parse(JSON.stringify(generarDictamenLocal(payload)));

test('detecta una cifra que no está en el JSON (por ejemplo, una suma hecha por la IA)', () => {
  const d = dictamenBase();
  d.vision_coo.argumentos.push('Reportes y ERP suman $6,910 en riesgo.');
  const verif = verificarCifras(d, payload);
  assert.deepEqual(verif.no_encontradas.map((x) => x.cifra), ['$6,910']);
  assert.equal(verif.no_encontradas[0].ubicacion, 'vision_coo.argumentos[3]');
});

test('acepta formatos en inglés y español y redondeos razonables', () => {
  const d = dictamenBase();
  d.justificacion = 'Beneficio de 89.019 USD, ROI de 495%, LTV/CAC 12,7x, unos $89k y churn de 2,96%.';
  const verif = verificarCifras(d, payload);
  assert.deepEqual(verif.no_encontradas, []);
});

test('ignora años, meses y conteos chicos', () => {
  const d = dictamenBase();
  d.justificacion = 'En 2026, durante 3 meses y 90 días, con 2 iniciativas.';
  assert.deepEqual(verificarCifras(d, payload).no_encontradas, []);
});

// --- Validación de la respuesta de la IA ----------------------------------------
test('extrae JSON con bloques de código, razonamiento o texto alrededor', () => {
  assert.deepEqual(extraerJSON('<think>pienso...</think>\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extraerJSON('Aquí va: {"a": {"b": 2}} fin'), { a: { b: 2 } });
  assert.equal(extraerJSON('sin json'), null);
  assert.equal(extraerJSON('{roto'), null);
});

test('rechaza decisiones e iniciativas que no existen', () => {
  const d = dictamenBase();
  d.decision = 'Invertir todo';
  d.iniciativa_prioritaria = 'blockchain';
  const v = validarDictamen(d, payload);
  assert.equal(v.ok, false);
  assert.ok(v.errores.some((e) => e.includes('decision')));
  assert.ok(v.errores.some((e) => e.includes('blockchain')));
});

test('normaliza mayúsculas de la decisión, recorta textos y limita listas', () => {
  const d = dictamenBase();
  d.decision = 'avanzar';
  d.justificacion = 'x'.repeat(5000);
  d.vision_cfo.argumentos = Array.from({ length: 20 }, (_, i) => `arg ${i}`);
  const v = validarDictamen(d, payload);
  assert.ok(v.ok);
  assert.equal(v.dictamen.decision, 'Avanzar');
  assert.equal(v.dictamen.justificacion.length, 800);
  assert.equal(v.dictamen.vision_cfo.argumentos.length, 8);
});

test('falta una visión o el plan', () => {
  const d = dictamenBase();
  delete d.vision_cmo;
  d.plan_90_dias = [];
  const v = validarDictamen(d, payload);
  assert.ok(v.errores.includes('falta vision_cmo'));
  assert.ok(v.errores.some((e) => e.includes('plan_90_dias')));
});
