/**
 * Dictamen local ("modo experto"): reglas deterministas que producen un dictamen con la
 * misma estructura que el de la IA. Se usa cuando no hay llave, cuando OpenRouter falla
 * o cuando la respuesta de la IA no cumple el formato.
 *
 * Todas las cifras salen del JSON y se citan con el nombre de su campo, así que el
 * verificador de cifras siempre las encuentra (está cubierto por las pruebas).
 */
import { formatoUSD, formatoPct, formatoNumero } from './utilidades.js';

/** Si la iniciativa con más dinero en riesgo supera en esta proporción a la #1 por RICE, se prioriza el dinero. */
export const FACTOR_PRIORIDAD_INGRESO = 3;

function elegirPrioritaria(iniciativas) {
  if (iniciativas.length === 0) return { prioritaria: null, razon: 'No hay iniciativas en la matriz RICE.' };
  const porScore = [...iniciativas].sort((a, b) => b.score_rice - a.score_rice)[0];
  const porIngreso = [...iniciativas].sort((a, b) => b.ingreso_en_riesgo_usd - a.ingreso_en_riesgo_usd)[0];
  if (porIngreso.categoria_id !== porScore.categoria_id
      && porIngreso.ingreso_en_riesgo_usd >= FACTOR_PRIORIDAD_INGRESO * porScore.ingreso_en_riesgo_usd) {
    return {
      prioritaria: porIngreso,
      segunda: porScore,
      razon: `La #1 por score_rice es "${porScore.titulo}" (score ${porScore.score_rice}, ${formatoUSD(porScore.ingreso_en_riesgo_usd)} en riesgo), pero "${porIngreso.titulo}" protege ${formatoUSD(porIngreso.ingreso_en_riesgo_usd)} (ingreso_en_riesgo_usd), al menos ${FACTOR_PRIORIDAD_INGRESO} veces más: se prioriza el dinero en riesgo.`,
    };
  }
  const segunda = iniciativas.find((i) => i.categoria_id !== porScore.categoria_id) ?? null;
  return {
    prioritaria: porScore,
    segunda,
    razon: `"${porScore.titulo}" lidera por score_rice (${porScore.score_rice}) y la diferencia de ingreso en riesgo no justifica cambiar el orden.`,
  };
}

export function generarDictamenLocal(payload) {
  const m1 = payload.modulo_1_simulador;
  const e = m1.entradas;
  const k = m1.kpis_estrategia_hibrida;
  const esc = m1.escenarios_beneficio_incremental_usd;
  const diagnosticos = m1.diagnosticos_motor_reglas;
  const criticos = diagnosticos.filter((d) => d.nivel === 'critico');
  const advertencias = diagnosticos.filter((d) => d.nivel === 'advertencia');
  const rice = payload.modulo_2_rice;
  const { prioritaria, segunda, razon } = elegirPrioritaria(rice.iniciativas);

  const decision = k.beneficio_neto_incremental_12m_usd < 0 ? 'Descartar' : criticos.length ? 'Pivotar' : 'Avanzar';
  const payback = k.payback_meses === null ? 'no se recupera dentro de 12 meses' : `se recupera en ${formatoNumero(k.payback_meses)} meses (payback_meses)`;
  const brechaPct = ((k.precio_nuevo_usd - e.precio_competencia_usd) / e.precio_competencia_usd) * 100;
  const totalUpsell = rice.iniciativas.reduce((acc, i) => acc + (i.comentarios_por_riesgo.upsell ?? 0), 0);
  const totalFuga = rice.iniciativas.reduce((acc, i) => acc + (i.comentarios_por_riesgo.churn ?? 0), 0);

  const vision_cfo = {
    postura: decision === 'Avanzar'
      ? (esc.pesimista >= 0
        ? 'Respaldo la estrategia: el retorno es positivo incluso en el escenario pesimista.'
        : 'Respaldo la estrategia con cautela: en el escenario pesimista pierde dinero.')
      : decision === 'Pivotar'
        ? 'La estrategia deja beneficio, pero hay alertas críticas que corregir antes de invertir.'
        : 'No recomiendo invertir: la estrategia rinde menos que no hacer nada.',
    argumentos: [
      `Beneficio neto incremental a 12 meses de ${formatoUSD(k.beneficio_neto_incremental_12m_usd)} (beneficio_neto_incremental_12m_usd) y ROI de ${k.roi_12m_pct === null ? 'N/A' : formatoPct(k.roi_12m_pct)} (roi_12m_pct).`,
      `La inversión de ${formatoUSD(e.presupuesto_usd)} (presupuesto_usd) ${payback}.`,
      `LTV/CAC de ${formatoNumero(k.ratio_ltv_cac)}x (ratio_ltv_cac): ${k.semaforo_ltv_cac}.`,
    ],
    riesgos: [
      `En el escenario pesimista el beneficio es ${formatoUSD(esc.pesimista)} (escenarios_beneficio_incremental_usd.pesimista).`,
      ...criticos.map((d) => `${d.titulo}: ${d.detalle}`),
    ],
  };

  const vision_cmo = {
    postura: brechaPct > 0
      ? 'El precio queda sobre la competencia: hay que acompañarlo con valor visible antes de captar más clientes.'
      : 'El precio sigue competitivo; el foco es retener antes de comprar crecimiento.',
    argumentos: [
      `Precio nuevo de ${formatoUSD(k.precio_nuevo_usd)} (precio_nuevo_usd) frente a ${formatoUSD(e.precio_competencia_usd)} de la competencia (precio_competencia_usd).`,
      `Con ${formatoUSD(k.inversion_adquisicion_usd)} en adquisición (inversion_adquisicion_usd) se suman ${formatoNumero(k.clientes_adquiridos)} clientes (clientes_adquiridos).`,
      totalUpsell > 0
        ? `Hay ${totalUpsell} comentario(s) de clientes dispuestos a pagar más: oportunidad de expansión.`
        : 'No hay señales de upsell en los comentarios: la expansión no es prioridad.',
    ],
    riesgos: [
      `Churn base de ${formatoPct(e.churn_mensual_pct)} (churn_mensual_pct): cada cliente adquirido corre el mismo riesgo de irse.`,
      ...advertencias.map((d) => `${d.titulo}: ${d.detalle}`),
    ],
  };

  const vision_coo = prioritaria
    ? {
        postura: `Construir primero "${prioritaria.titulo}".`,
        argumentos: [
          razon,
          `Requiere ${formatoNumero(prioritaria.esfuerzo_meses)} meses de esfuerzo (esfuerzo_meses) y ${formatoUSD(prioritaria.costo_estimado_usd)} (costo_estimado_usd).`,
          `Afecta a ${prioritaria.clientes_afectados} cliente(s) con ${prioritaria.comentarios_por_riesgo.churn ?? 0} en riesgo de fuga.`,
        ],
        riesgos: [
          ...(prioritaria.costo_estimado_usd > e.presupuesto_usd
            ? [`El costo (${formatoUSD(prioritaria.costo_estimado_usd)}) supera el presupuesto (${formatoUSD(e.presupuesto_usd)}).`]
            : []),
          ...(rice.sin_clasificar.comentarios > 0 ? [`${rice.sin_clasificar.comentarios} comentario(s) sin clasificar quedan fuera del análisis.`] : []),
          `Hay ${totalFuga} comentario(s) con riesgo de fuga en total: la ejecución no puede atrasarse.`,
        ],
      }
    : { postura: 'Sin iniciativas para priorizar.', argumentos: ['La matriz RICE está vacía.'], riesgos: [] };

  const plan_90_dias = [
    {
      mes: 1,
      acciones: prioritaria
        ? [`Iniciar "${prioritaria.titulo}" (${formatoNumero(prioritaria.esfuerzo_meses)} meses, ${formatoUSD(prioritaria.costo_estimado_usd)}).`, 'Contactar a los clientes con riesgo de fuga de esa iniciativa para contener la cancelación.']
        : ['Cargar comentarios de clientes para construir la matriz RICE.'],
    },
    {
      mes: 2,
      acciones: [
        segunda ? `Planificar "${segunda.titulo}" como siguiente iniciativa (score ${segunda.score_rice}).` : 'Consolidar la iniciativa prioritaria.',
        `Medir el churn mensual contra la meta de ${formatoPct(k.churn_proyectado_pct, 2)} (churn_proyectado_pct).`,
      ],
    },
    {
      mes: 3,
      acciones: [
        `Comparar el MRR real con la proyección de ${formatoUSD(k.mrr_mes_12_usd)} al mes 12 (mrr_mes_12_usd).`,
        'Recalibrar los supuestos del modelo con los datos reales y repetir la simulación.',
      ],
    },
  ];

  const supuestos = m1.supuestos_del_modelo;
  const supuestos_a_validar = [
    `Elasticidad precio de ${formatoNumero(supuestos.elasticidad_precio)} (elasticidad_precio).`,
    `Eficacia de la inversión en producto de ${formatoNumero(supuestos.eficacia_producto)}x (eficacia_producto).`,
    'Que la reducción del churn se logre desde el primer mes de la inversión.',
  ];

  const justificacion = decision === 'Avanzar'
    ? `Se avanza: el beneficio es positivo en el escenario base y no hay alertas críticas${esc.pesimista < 0 ? ', aunque el escenario pesimista pierde dinero' : ''}. ${prioritaria ? `Prioridad: ${prioritaria.titulo}.` : ''}`.trim()
    : decision === 'Pivotar'
      ? `Se pivota: hay ${criticos.length} alerta(s) crítica(s) del motor de reglas que corregir antes de comprometer el presupuesto.`
      : 'Se descarta: la estrategia simulada deja menos dinero que no hacer nada.';

  return {
    vision_cfo,
    vision_cmo,
    vision_coo,
    decision,
    iniciativa_prioritaria: prioritaria?.categoria_id ?? null,
    justificacion,
    plan_90_dias,
    supuestos_a_validar,
  };
}
