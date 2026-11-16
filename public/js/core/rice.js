/**
 * Matriz RICE e Ingreso en Riesgo (Revenue at Risk).
 *
 * Fórmula canónica (pipeline de MongoDB de la guía), aplicada igual en las 3 instancias:
 *   clientes  = clientes distintos que reclaman en la categoría
 *   reach     = redondear(clientes × 12 + ingreso_en_riesgo / 120)
 *   confianza = mín(95%, 70% + 6% × clientes)
 *   impacto   = promedio del peso de impacto por cliente, redondeado a 2 decimales
 *   score     = redondear(reach × impacto × confianza / esfuerzo)
 *
 * Un cliente que reclama varias veces en la misma categoría cuenta una sola vez
 * (se toma su mayor peso de impacto), para no inflar el alcance ni el dinero en riesgo.
 * Redondeo: mitad hacia arriba (en MongoDB se implementa con $floor(x + 0.5), no con $round).
 */
import { CATEGORIAS, SIN_CLASIFICAR, PARAMETROS_RICE, RIESGOS } from './catalogo.js';
import { redondear, sumar, promedio } from './utilidades.js';

/** Agrupa los comentarios de una categoría por cliente. */
function agruparPorCliente(items) {
  const clientes = new Map();
  for (const item of items) {
    const previo = clientes.get(item.id_cliente);
    if (!previo) {
      clientes.set(item.id_cliente, {
        id_cliente: item.id_cliente,
        valor_mensual_usd: item.valor_mensual_usd,
        peso_impacto: item.peso_impacto,
        menciones: 1,
      });
    } else {
      previo.valor_mensual_usd = Math.max(previo.valor_mensual_usd, item.valor_mensual_usd);
      previo.peso_impacto = Math.max(previo.peso_impacto, item.peso_impacto);
      previo.menciones += 1;
    }
  }
  return [...clientes.values()];
}

export function calcularFilaRICE(categoria, items, p = PARAMETROS_RICE) {
  const clientes = agruparPorCliente(items);
  const n = clientes.length;
  const ingreso = sumar(clientes.map((c) => c.valor_mensual_usd));
  const impacto = redondear(promedio(clientes.map((c) => c.peso_impacto)), p.decimalesImpacto);
  const reach = n === 0 ? 0 : redondear(n * p.reachPorCliente + ingreso / p.divisorIngreso);
  const confianzaPct = Math.min(p.confianzaMaxPct, p.confianzaBasePct + p.confianzaPorClientePct * n);
  const score = n === 0 ? 0 : redondear((reach * impacto * confianzaPct) / (100 * categoria.esfuerzoMeses));

  const desgloseRiesgo = Object.fromEntries(Object.keys(RIESGOS).map((id) => [id, 0]));
  for (const item of items) desgloseRiesgo[item.riesgo_id] = (desgloseRiesgo[item.riesgo_id] ?? 0) + 1;

  return {
    categoria_id: categoria.id,
    titulo: categoria.titulo,
    titulo_corto: categoria.tituloCorto,
    clientes_afectados: n,
    total_menciones: items.length,
    ids_clientes: clientes.map((c) => c.id_cliente),
    ingreso_en_riesgo_usd: ingreso,
    impacto_promedio: impacto,
    reach,
    confidence_pct: confianzaPct,
    esfuerzo_meses: categoria.esfuerzoMeses,
    costo_estimado_usd: categoria.costoUSD,
    eficacia_relativa: categoria.eficaciaRelativa,
    score_rice: score,
    desglose_riesgo: desgloseRiesgo,
  };
}

/** Desempate estable: score, luego ingreso en riesgo, luego id. */
export function ordenarMatriz(filas, criterio = 'score_rice') {
  return [...filas].sort(
    (a, b) =>
      b[criterio] - a[criterio] ||
      b.score_rice - a.score_rice ||
      b.ingreso_en_riesgo_usd - a.ingreso_en_riesgo_usd ||
      a.categoria_id.localeCompare(b.categoria_id)
  );
}

/**
 * @param {Array} clasificados  salida de clasificarLote()
 * @param {{criterio?: 'score_rice'|'ingreso_en_riesgo_usd', incluirVacias?: boolean}} opciones
 */
export function calcularMatrizRICE(clasificados, { criterio = 'score_rice', incluirVacias = false } = {}) {
  const grupos = new Map(CATEGORIAS.map((c) => [c.id, []]));
  const sinClasificar = [];
  for (const item of clasificados) {
    (grupos.get(item.categoria_id) ?? sinClasificar).push(item);
  }

  const filas = CATEGORIAS.map((c) => calcularFilaRICE(c, grupos.get(c.id))).filter(
    (f) => incluirVacias || f.clientes_afectados > 0
  );
  const matriz = ordenarMatriz(filas, criterio).map((f, i) => ({ posicion: i + 1, ...f }));

  return {
    criterio,
    matriz,
    sin_clasificar: {
      categoria_id: SIN_CLASIFICAR.id,
      total_menciones: sinClasificar.length,
      ids_clientes: [...new Set(sinClasificar.map((i) => i.id_cliente))],
      ingreso_en_riesgo_usd: sumar(agruparPorCliente(sinClasificar).map((c) => c.valor_mensual_usd)),
    },
    totales: {
      comentarios: clasificados.length,
      ingreso_en_riesgo_usd: sumar(matriz.map((f) => f.ingreso_en_riesgo_usd)),
    },
  };
}

/** Campos que deben coincidir entre instancias (CSV, MongoDB Atlas y PostgreSQL). */
export const CAMPOS_COMPARABLES = Object.freeze([
  'clientes_afectados', 'total_menciones', 'ingreso_en_riesgo_usd', 'impacto_promedio',
  'reach', 'confidence_pct', 'esfuerzo_meses', 'costo_estimado_usd', 'score_rice',
]);

/**
 * Compara dos matrices RICE (por ejemplo, la del navegador y la calculada por la base de datos).
 * @returns {string[]} diferencias legibles; lista vacía si coinciden
 */
export function compararMatrices(a, b, { compararOrden = true } = {}) {
  const diferencias = [];
  const porId = (m) => new Map(m.map((f) => [f.categoria_id, f]));
  const mapaA = porId(a);
  const mapaB = porId(b);
  for (const id of new Set([...mapaA.keys(), ...mapaB.keys()])) {
    const fa = mapaA.get(id);
    const fb = mapaB.get(id);
    if (!fa || !fb) {
      diferencias.push(`${id}: solo aparece en ${fa ? 'la primera' : 'la segunda'} matriz`);
      continue;
    }
    for (const campo of CAMPOS_COMPARABLES) {
      if (Number(fa[campo]) !== Number(fb[campo])) diferencias.push(`${id}.${campo}: ${fa[campo]} vs ${fb[campo]}`);
    }
    for (const riesgo of ['churn', 'upsell', 'friccion']) {
      if ((fa.desglose_riesgo?.[riesgo] ?? 0) !== (fb.desglose_riesgo?.[riesgo] ?? 0)) diferencias.push(`${id}.desglose_riesgo.${riesgo} distinto`);
    }
    const idsA = [...(fa.ids_clientes ?? [])].sort().join(',');
    const idsB = [...(fb.ids_clientes ?? [])].sort().join(',');
    if (idsA !== idsB) diferencias.push(`${id}.ids_clientes distintos`);
  }
  if (compararOrden && diferencias.length === 0) {
    const ordenA = a.map((f) => f.categoria_id).join(' > ');
    const ordenB = b.map((f) => f.categoria_id).join(' > ');
    if (ordenA !== ordenB) diferencias.push(`orden distinto: ${ordenA} vs ${ordenB}`);
  }
  return diferencias;
}
