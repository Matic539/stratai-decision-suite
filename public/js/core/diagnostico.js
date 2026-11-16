/**
 * Motor de reglas de negocio (SI-ENTONCES) sobre el resultado del simulador.
 *
 * Cada regla mira cifras ya calculadas y devuelve un diagnóstico legible.
 * Estos diagnósticos se muestran en la interfaz y viajan en el JSON al Comité IA,
 * para que la IA interprete hechos verificados en vez de inventarlos.
 */
import { formatoUSD, formatoPct, formatoNumero } from './utilidades.js';

export const NIVELES_DIAGNOSTICO = Object.freeze(['critico', 'advertencia', 'info', 'ok']);

/** Umbrales de las reglas (nombrados para poder explicarlos en clase). */
export const UMBRALES_REGLAS = Object.freeze({
  churnBaldeRotoPct: 5, // churn mensual desde el cual "el balde pierde agua"
  retencionMinimaBaldeRotoPct: 50, // con churn alto, menos de esto en retención es riesgoso
  brechaPrecioAltaPct: 15, // precio sobre la competencia que dispara la alerta
  retencionMinimaBrechaPct: 40,
  paybackLentoMeses: 9,
});

/**
 * @param {ReturnType<import('./finanzas.js').simularEstrategia>} simulacion
 * @returns {{id: string, nivel: string, titulo: string, detalle: string}[]}
 */
export function diagnosticarEstrategia(simulacion, u = UMBRALES_REGLAS) {
  const { entradas: e, kpis: k, caminos: c, escenarios } = simulacion;
  const reglas = [];
  const agregar = (id, nivel, titulo, detalle) => reglas.push({ id, nivel, titulo, detalle });
  const hayInversion = e.presupuesto > 0;
  const hayCambio = hayInversion || e.ajustePrecioPct !== 0;

  // R1: SI el margen unitario es <= 0 ENTONCES cada cliente nuevo agranda la pérdida.
  if (k.margenUnitario <= 0) {
    agregar('margen_negativo', 'critico', 'Margen unitario negativo',
      `Con un precio de ${formatoUSD(k.precioNuevo)} el margen por cliente es ${formatoUSD(k.margenUnitario)}: crecer aumenta la pérdida.`);
  }

  // R2: semáforo LTV/CAC (Manual Docente).
  if (k.semaforo.nivel === 'riesgo') {
    agregar('ltv_cac_riesgo', 'critico', 'LTV/CAC en zona de riesgo',
      `El ratio es ${formatoNumero(k.ratioLtvCac)}x (< 1.8x): cada cliente adquirido deja menos de lo que cuesta conseguirlo.`);
  } else if (k.semaforo.nivel === 'ajustado') {
    agregar('ltv_cac_ajustado', 'advertencia', 'LTV/CAC ajustado',
      `El ratio es ${formatoNumero(k.ratioLtvCac)}x (entre 1.8x y 2.9x): conviene mejorar la retención antes de escalar marketing.`);
  }

  // R3: SI churn alto Y poca inversión en retención ENTONCES balde roto.
  if (e.churnMensualPct >= u.churnBaldeRotoPct && hayInversion && e.pctRetencion < u.retencionMinimaBaldeRotoPct) {
    agregar('balde_roto', 'critico', 'Balde roto (leaky bucket)',
      `El churn base es ${formatoPct(e.churnMensualPct)} y solo el ${e.pctRetencion}% del presupuesto va a retención: los clientes comprados con marketing se irán pronto.`);
  }

  // R4: SI el precio nuevo supera a la competencia por mucho Y se invierte poco en producto ENTONCES riesgo de fuga.
  const brechaPct = ((k.precioNuevo - e.precioCompetencia) / e.precioCompetencia) * 100;
  if (brechaPct > u.brechaPrecioAltaPct && e.pctRetencion < u.retencionMinimaBrechaPct) {
    agregar('precio_sobre_competencia', 'advertencia', 'Precio muy sobre la competencia',
      `El precio queda ${formatoPct(brechaPct, 0)} sobre la competencia con solo ${e.pctRetencion}% en retención: el valor percibido no acompaña al precio.`);
  }

  // R5: SI la estrategia rinde menos que no hacer nada ENTONCES destruye valor.
  if (hayCambio && k.beneficioNetoIncremental12m < 0) {
    agregar('destruye_valor', 'critico', 'La estrategia pierde contra el status quo',
      `A 12 meses deja ${formatoUSD(k.beneficioNetoIncremental12m)} frente a no hacer nada.`);
  } else if (hayInversion && k.paybackMeses !== null && k.paybackMeses > u.paybackLentoMeses) {
    agregar('payback_lento', 'advertencia', 'Recuperación lenta',
      `La inversión se recupera en ${formatoNumero(k.paybackMeses)} meses.`);
  }

  // R6: SI al mes 12 hay menos clientes que el punto de equilibrio ENTONCES opera con pérdida.
  if (k.puntoEquilibrioClientes !== null && k.clientesMes12 < k.puntoEquilibrioClientes) {
    agregar('bajo_equilibrio', 'critico', 'Bajo el punto de equilibrio',
      `Se proyectan ${formatoNumero(k.clientesMes12, 0)} clientes al mes 12 y se necesitan ${k.puntoEquilibrioClientes} para cubrir los costos fijos.`);
  }

  // R7: SI el escenario pesimista pierde dinero ENTONCES la apuesta es frágil.
  if (hayCambio && escenarios.pesimista < 0 && k.beneficioNetoIncremental12m >= 0) {
    agregar('fragil_pesimista', 'advertencia', 'Frágil en el escenario pesimista',
      `En el escenario base gana ${formatoUSD(escenarios.base)}, pero en el pesimista pierde ${formatoUSD(-escenarios.pesimista)}.`);
  }

  // R8: SI invertir todo en producto rinde más que la mezcla elegida ENTONCES sugerirlo.
  if (hayInversion && c.soloRetencion.beneficioIncremental > c.hibrida.beneficioIncremental) {
    agregar('mejor_retencion', 'info', 'Invertir todo en producto rinde más',
      `"100% Retención" deja ${formatoUSD(c.soloRetencion.beneficioIncremental)} contra ${formatoUSD(c.hibrida.beneficioIncremental)} de la mezcla actual.`);
  }

  if (!reglas.some((r) => r.nivel === 'critico' || r.nivel === 'advertencia')) {
    agregar('equilibrio', 'ok', 'Estrategia equilibrada',
      `Margen positivo, LTV/CAC de ${formatoNumero(k.ratioLtvCac)}x y ${formatoNumero(k.clientesMes12, 0)} clientes al mes 12 (equilibrio: ${k.puntoEquilibrioClientes ?? 'N/D'}).`);
  }

  return reglas.sort((a, b) => NIVELES_DIAGNOSTICO.indexOf(a.nivel) - NIVELES_DIAGNOSTICO.indexOf(b.nivel));
}
