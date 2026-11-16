/**
 * Módulo 3: empaqueta los resultados deterministas en un JSON y arma el prompt del Comité IA.
 *
 * Principio del Manual Docente: la IA no calcula; interpreta cifras ya calculadas.
 * Privacidad: el JSON no incluye ids de clientes ni el texto de sus comentarios,
 * solo agregados. Es lo que sale hacia un proveedor externo de IA.
 */

export const VERSION_PAYLOAD = '1.0';

const ROLES = Object.freeze({
  vision_cfo: 'CFO (finanzas: rentabilidad, ROI, payback, riesgo financiero)',
  vision_cmo: 'CMO (marketing y crecimiento: adquisición, precio frente a la competencia, expansión)',
  vision_coo: 'COO (operaciones y producto: qué construir primero, capacidad y ejecución)',
});

export const DECISIONES = Object.freeze(['Avanzar', 'Pivotar', 'Descartar']);

function resumirCaminos(caminos) {
  return Object.fromEntries(
    Object.entries(caminos).map(([id, c]) => [
      id,
      {
        etiqueta: c.etiqueta,
        precio_usd: c.precio,
        churn_mensual_pct: c.churnMensualPct,
        clientes_mes_12: c.clientes[c.clientes.length - 1],
        utilidad_acumulada_12m_usd: c.utilidadAcumulada,
        beneficio_incremental_12m_usd: c.beneficioIncremental,
        roi_pct: c.roiPct,
        payback_meses: c.paybackMeses,
      },
    ])
  );
}

/**
 * @param {object} p
 * @param {ReturnType<import('./finanzas.js').simularEstrategia>} p.simulacion
 * @param {ReturnType<import('./rice.js').calcularMatrizRICE>} p.rice
 * @param {ReturnType<import('./diagnostico.js').diagnosticarEstrategia>} p.diagnosticos
 * @param {object|null} [p.iniciativa] fila RICE enviada al simulador con "Simular ROI"
 */
export function construirPayload({ simulacion, rice, diagnosticos, iniciativa = null, origenDatos = 'CSV', fecha = new Date() }) {
  const { entradas, supuestos, kpis, caminos, escenarios } = simulacion;
  return {
    version: VERSION_PAYLOAD,
    generado_en: fecha.toISOString(),
    origen_datos: origenDatos,
    nota: 'Todas las cifras fueron calculadas por el motor de reglas determinista. No deben recalcularse ni completarse con supuestos.',
    modulo_1_simulador: {
      entradas: {
        clientes_activos: entradas.clientes,
        precio_mensual_usd: entradas.precio,
        precio_competencia_usd: entradas.precioCompetencia,
        costo_variable_pct: entradas.costoVariablePct,
        costos_fijos_mes_usd: entradas.costosFijosMes,
        cac_usd: entradas.cac,
        churn_mensual_pct: entradas.churnMensualPct,
        ajuste_precio_pct: entradas.ajustePrecioPct,
        presupuesto_usd: entradas.presupuesto,
        pct_retencion: entradas.pctRetencion,
        pct_adquisicion: 100 - entradas.pctRetencion,
        nuevos_organicos_mes: entradas.nuevosOrganicosMes,
      },
      supuestos_del_modelo: {
        elasticidad_precio: supuestos.elasticidadPrecio,
        eficacia_producto: supuestos.eficaciaProducto,
        reduccion_max_churn_pct: supuestos.reduccionMaxChurn * 100,
        meses_adquisicion: supuestos.mesesAdquisicion,
        horizonte_meses: supuestos.horizonteMeses,
      },
      kpis_estrategia_hibrida: {
        precio_nuevo_usd: kpis.precioNuevo,
        margen_unitario_usd: kpis.margenUnitario,
        churn_base_pct: kpis.churnBasePct,
        churn_proyectado_pct: kpis.churnProyectadoPct,
        ltv_usd: kpis.ltv,
        cac_efectivo_usd: kpis.cacEfectivo,
        ratio_ltv_cac: kpis.ratioLtvCac,
        semaforo_ltv_cac: kpis.semaforo.etiqueta,
        inversion_retencion_usd: kpis.inversionRetencion,
        inversion_adquisicion_usd: kpis.inversionAdquisicion,
        clientes_adquiridos: kpis.clientesAdquiridos,
        clientes_mes_12: kpis.clientesMes12,
        mrr_base_usd: kpis.mrrBase,
        mrr_mes_12_usd: kpis.mrrMes12,
        beneficio_neto_incremental_12m_usd: kpis.beneficioNetoIncremental12m,
        roi_12m_pct: kpis.roi12mPct,
        payback_meses: kpis.paybackMeses,
        punto_equilibrio_clientes: kpis.puntoEquilibrioClientes,
      },
      caminos_comparados: resumirCaminos(caminos),
      escenarios_beneficio_incremental_usd: { ...escenarios },
      diagnosticos_motor_reglas: diagnosticos.map(({ id, nivel, titulo, detalle }) => ({ id, nivel, titulo, detalle })),
    },
    modulo_2_rice: {
      criterio_de_orden: rice.criterio,
      formula: 'score = reach × impacto × confianza / esfuerzo; reach = clientes × 12 + ingreso_en_riesgo / 120; confianza = mín(95%, 70% + 6% × clientes)',
      ingreso_total_en_riesgo_usd: rice.totales.ingreso_en_riesgo_usd,
      total_comentarios: rice.totales.comentarios,
      sin_clasificar: {
        comentarios: rice.sin_clasificar.total_menciones,
        ingreso_en_riesgo_usd: rice.sin_clasificar.ingreso_en_riesgo_usd,
      },
      iniciativas: rice.matriz.map((f) => ({
        posicion: f.posicion,
        categoria_id: f.categoria_id,
        titulo: f.titulo,
        clientes_afectados: f.clientes_afectados,
        ingreso_en_riesgo_usd: f.ingreso_en_riesgo_usd,
        impacto_promedio: f.impacto_promedio,
        reach: f.reach,
        confidence_pct: f.confidence_pct,
        esfuerzo_meses: f.esfuerzo_meses,
        costo_estimado_usd: f.costo_estimado_usd,
        score_rice: f.score_rice,
        comentarios_por_riesgo: { ...f.desglose_riesgo },
      })),
    },
    iniciativa_simulada: iniciativa
      ? {
          categoria_id: iniciativa.categoria_id,
          titulo: iniciativa.titulo,
          costo_estimado_usd: iniciativa.costo_estimado_usd,
          eficacia_relativa: iniciativa.eficacia_relativa,
        }
      : null,
  };
}

/** Estructura que debe devolver la IA (ejemplo legible que va dentro del prompt). */
export const ESQUEMA_RESPUESTA = Object.freeze({
  vision_cfo: { postura: 'texto', argumentos: ['texto con cifras del JSON'], riesgos: ['texto'] },
  vision_cmo: { postura: 'texto', argumentos: ['texto'], riesgos: ['texto'] },
  vision_coo: { postura: 'texto', argumentos: ['texto'], riesgos: ['texto'] },
  decision: DECISIONES.join(' | '),
  iniciativa_prioritaria: 'categoria_id de modulo_2_rice',
  justificacion: 'texto',
  plan_90_dias: [
    { mes: 1, acciones: ['texto'] },
    { mes: 2, acciones: ['texto'] },
    { mes: 3, acciones: ['texto'] },
  ],
  supuestos_a_validar: ['texto'],
});

export function construirPromptComite(payload) {
  const roles = Object.entries(ROLES).map(([clave, rol]) => `- ${clave}: ${rol}`).join('\n');
  const sistema = [
    'Actúas como el Comité Directivo de una empresa SaaS B2B. Hablan tres roles:',
    roles,
    '',
    'Reglas obligatorias:',
    '1. Usa SOLO las cifras del JSON recibido. No recalcules, no redondees distinto y no inventes números.',
    '2. Escribe en lenguaje de negocio para un directorio. Nombra cada métrica con palabras y, para indicar de qué campo sale, ponlo entre paréntesis después de la cifra: escribe "ROI a 12 meses de N% (roi_12m_pct)", no "roi_12m_pct de N". Nombra las iniciativas por su titulo; el categoria_id va solo en iniciativa_prioritaria.',
    '3. Si te falta un dato para opinar, dilo explícitamente en vez de suponerlo.',
    '4. Compara las dos lecturas de prioridad del roadmap: la posición 1 por score_rice y la iniciativa con mayor ingreso_en_riesgo_usd. Si no coinciden, explica cuál priorizas y por qué.',
    '5. Considera los diagnosticos_motor_reglas y los escenarios pesimista y optimista.',
    '6. Cada rol puede discrepar de los otros; la decisión final debe resolver la discrepancia.',
    '7. iniciativa_prioritaria debe ser exactamente uno de los categoria_id de modulo_2_rice.iniciativas.',
    '8. Responde directamente, sin mostrar tu razonamiento, sin bloques de código y sin texto fuera del JSON.',
    '9. Responde en español neutro y SOLO con un objeto JSON válido con esta estructura:',
    JSON.stringify(ESQUEMA_RESPUESTA, null, 2),
  ].join('\n');

  const encabezado = 'Datos calculados por el motor de reglas (JSON):';
  // A la IA se le envía el JSON compacto (menos tokens); en pantalla se muestra con sangría.
  const usuario = `${encabezado}\n${JSON.stringify(payload)}`;
  const completo = `${sistema}\n\n${encabezado}\n${JSON.stringify(payload, null, 2)}`;
  return { sistema, usuario, completo };
}

// ---------------------------------------------------------------------------
// Esquema formal y validación de la respuesta de la IA
// ---------------------------------------------------------------------------

const esquemaVision = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['postura', 'argumentos', 'riesgos'],
  properties: {
    postura: { type: 'string' },
    argumentos: { type: 'array', items: { type: 'string' } },
    riesgos: { type: 'array', items: { type: 'string' } },
  },
});

/** JSON Schema para "structured outputs" (response_format de OpenRouter). */
export const JSON_SCHEMA_DICTAMEN = Object.freeze({
  name: 'dictamen_comite',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['vision_cfo', 'vision_cmo', 'vision_coo', 'decision', 'iniciativa_prioritaria', 'justificacion', 'plan_90_dias', 'supuestos_a_validar'],
    properties: {
      vision_cfo: esquemaVision,
      vision_cmo: esquemaVision,
      vision_coo: esquemaVision,
      decision: { type: 'string', enum: [...DECISIONES] },
      iniciativa_prioritaria: { type: 'string' },
      justificacion: { type: 'string' },
      plan_90_dias: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['mes', 'acciones'],
          properties: { mes: { type: 'integer' }, acciones: { type: 'array', items: { type: 'string' } } },
        },
      },
      supuestos_a_validar: { type: 'array', items: { type: 'string' } },
    },
  },
});

export const LIMITES_DICTAMEN = Object.freeze({ maxTexto: 800, maxItems: 8, maxMeses: 6 });

/**
 * Extrae el objeto JSON de la respuesta de un modelo: tolera bloques ```json,
 * etiquetas de razonamiento <think>...</think> y texto antes o después del JSON.
 */
export function extraerJSON(texto) {
  if (typeof texto !== 'string') return null;
  const limpio = texto
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');

  const objetos = [];
  const intentar = (fragmento) => {
    try {
      const o = JSON.parse(fragmento);
      if (o && typeof o === 'object' && !Array.isArray(o)) objetos.push(o);
    } catch {
      // no es JSON válido
    }
  };
  // 1) Objetos de primer nivel con llaves balanceadas (respetando el contenido de las cadenas)
  objetosBalanceados(limpio).forEach(intentar);
  // 2) Respaldo: desde cada "{" hasta la última "}" (por si hay llaves sueltas en el texto previo)
  if (objetos.length === 0) {
    const fin = limpio.lastIndexOf('}');
    let inicio = limpio.indexOf('{');
    for (let n = 0; inicio !== -1 && inicio < fin && n < 50; n++) {
      intentar(limpio.slice(inicio, fin + 1));
      if (objetos.length) break;
      inicio = limpio.indexOf('{', inicio + 1);
    }
  }
  if (objetos.length === 0) return null;
  // Se prefiere el objeto que parece un dictamen; si no, el más grande
  return objetos.find((o) => 'vision_cfo' in o || 'decision' in o)
    ?? objetos.reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a));
}

function objetosBalanceados(texto) {
  const resultado = [];
  let profundidad = 0;
  let inicio = -1;
  let enCadena = false;
  let escape = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"' && profundidad > 0) enCadena = true;
    else if (c === '{') {
      if (profundidad === 0) inicio = i;
      profundidad += 1;
    } else if (c === '}' && profundidad > 0) {
      profundidad -= 1;
      if (profundidad === 0) resultado.push(texto.slice(inicio, i + 1));
    }
  }
  return resultado;
}

// Quita caracteres de control y recorta textos largos.
const limpiarTexto = (v, max = LIMITES_DICTAMEN.maxTexto) =>
  String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

function listaDeTextos(valor, ruta, errores, { minimo = 0 } = {}) {
  if (!Array.isArray(valor)) {
    errores.push(`${ruta} debe ser una lista`);
    return [];
  }
  const items = valor.filter((x) => typeof x === 'string' && x.trim()).slice(0, LIMITES_DICTAMEN.maxItems).map((x) => limpiarTexto(x));
  if (items.length < minimo) errores.push(`${ruta} debe tener al menos ${minimo} elemento(s)`);
  return items;
}

/**
 * Valida y normaliza el dictamen. No confía en la IA: revisa tipos, la decisión,
 * que la iniciativa exista en la matriz y recorta textos y listas.
 */
export function validarDictamen(objeto, payload) {
  const errores = [];
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) {
    return { ok: false, errores: ['la respuesta no es un objeto JSON'], dictamen: null };
  }
  const dictamen = {};

  for (const rol of Object.keys(ROLES)) {
    const v = objeto[rol];
    if (!v || typeof v !== 'object') {
      errores.push(`falta ${rol}`);
      continue;
    }
    if (typeof v.postura !== 'string' || !v.postura.trim()) errores.push(`${rol}.postura vacía`);
    dictamen[rol] = {
      postura: limpiarTexto(v.postura ?? ''),
      argumentos: listaDeTextos(v.argumentos, `${rol}.argumentos`, errores, { minimo: 1 }),
      riesgos: listaDeTextos(v.riesgos ?? [], `${rol}.riesgos`, errores),
    };
  }

  const decision = DECISIONES.find((d) => d.toLowerCase() === String(objeto.decision ?? '').trim().toLowerCase());
  if (!decision) errores.push(`decision debe ser una de: ${DECISIONES.join(', ')}`);
  dictamen.decision = decision ?? null;

  const ids = payload.modulo_2_rice.iniciativas.map((i) => i.categoria_id);
  const prioritaria = String(objeto.iniciativa_prioritaria ?? '').trim();
  if (!ids.includes(prioritaria)) errores.push(`iniciativa_prioritaria "${limpiarTexto(prioritaria, 60)}" no está en la matriz RICE`);
  dictamen.iniciativa_prioritaria = ids.includes(prioritaria) ? prioritaria : null;

  if (typeof objeto.justificacion !== 'string' || !objeto.justificacion.trim()) errores.push('justificacion vacía');
  dictamen.justificacion = limpiarTexto(objeto.justificacion ?? '');

  if (!Array.isArray(objeto.plan_90_dias) || objeto.plan_90_dias.length === 0) {
    errores.push('plan_90_dias debe ser una lista con al menos un mes');
    dictamen.plan_90_dias = [];
  } else {
    dictamen.plan_90_dias = objeto.plan_90_dias.slice(0, LIMITES_DICTAMEN.maxMeses).map((p, i) => ({
      mes: Number.isInteger(Number(p?.mes)) ? Number(p.mes) : i + 1,
      acciones: listaDeTextos(p?.acciones, `plan_90_dias[${i}].acciones`, errores, { minimo: 1 }),
    }));
  }

  dictamen.supuestos_a_validar = listaDeTextos(objeto.supuestos_a_validar ?? [], 'supuestos_a_validar', errores);
  return { ok: errores.length === 0, errores, dictamen };
}
