/**
 * Verificador de cifras: revisa que cada número que cita el dictamen exista en el JSON
 * calculado por el motor de reglas. Lo que no aparece se marca como "no verificado":
 * puede ser un cálculo propio de la IA (por ejemplo, una suma) o una invención.
 *
 * Es una heurística deliberadamente simple y explicable:
 *  - Se revisan los números con $, %, x, k o "mil", y los que tienen 3 o más cifras.
 *  - Se ignoran años (2020 a 2035) escritos sin símbolo.
 *  - Cada número se interpreta en formato inglés (1,234.5) y español (1.234,5).
 *  - Coincide si la diferencia es menor a 0.6% (o a 0.05 en números chicos), para aceptar redondeos.
 */

const PATRON_NUMERO = /(-?\$?\s?\d[\d.,]*)\s?(%|x\b|k\b|mil\b|usd\b)?/gi;

function valoresDelPayload(nodo, acumulado = []) {
  if (typeof nodo === 'number' && Number.isFinite(nodo)) acumulado.push(nodo);
  else if (Array.isArray(nodo)) nodo.forEach((v) => valoresDelPayload(v, acumulado));
  else if (nodo && typeof nodo === 'object') Object.values(nodo).forEach((v) => valoresDelPayload(v, acumulado));
  return acumulado;
}

function interpretaciones(token) {
  const limpio = token.replace(/[$\s]/g, '').replace(/[.,]$/, '');
  const candidatos = new Set();
  // Formato inglés: comas de miles, punto decimal
  const en = Number(limpio.replace(/,/g, ''));
  if (Number.isFinite(en)) candidatos.add(en);
  // Formato español: puntos de miles, coma decimal
  const es = Number(limpio.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(es)) candidatos.add(es);
  return [...candidatos];
}

function textosDelDictamen(dictamen) {
  const textos = [];
  for (const rol of ['vision_cfo', 'vision_cmo', 'vision_coo']) {
    const v = dictamen[rol];
    if (!v) continue;
    textos.push([`${rol}.postura`, v.postura]);
    v.argumentos.forEach((t, i) => textos.push([`${rol}.argumentos[${i}]`, t]));
    v.riesgos.forEach((t, i) => textos.push([`${rol}.riesgos[${i}]`, t]));
  }
  textos.push(['justificacion', dictamen.justificacion]);
  dictamen.plan_90_dias.forEach((p, i) => p.acciones.forEach((t, j) => textos.push([`plan_90_dias[${i}].acciones[${j}]`, t])));
  dictamen.supuestos_a_validar.forEach((t, i) => textos.push([`supuestos_a_validar[${i}]`, t]));
  return textos.filter(([, t]) => typeof t === 'string' && t);
}

export function coincideConPayload(valor, valoresPayload) {
  return valoresPayload.some((v) => Math.abs(v - valor) <= Math.max(0.05, Math.abs(v) * 0.006));
}

/**
 * @returns {{ revisadas: number, verificadas: number, no_encontradas: {cifra: string, ubicacion: string}[] }}
 */
export function verificarCifras(dictamen, payload) {
  const valores = valoresDelPayload(payload);
  let revisadas = 0;
  let verificadas = 0;
  const noEncontradas = [];
  const vistas = new Set();

  for (const [ubicacion, texto] of textosDelDictamen(dictamen)) {
    for (const coincidencia of texto.matchAll(PATRON_NUMERO)) {
      const token = coincidencia[1].trim();
      const sufijo = (coincidencia[2] ?? '').toLowerCase();
      const conSimbolo = token.includes('$') || sufijo !== '';
      const multiplicador = sufijo === 'k' || sufijo === 'mil' ? 1000 : 1;
      const candidatos = interpretaciones(token).map((n) => n * multiplicador);
      if (candidatos.length === 0) continue;
      const magnitud = Math.max(...candidatos.map(Math.abs));
      const esAnio = !conSimbolo && candidatos.some((n) => Number.isInteger(n) && n >= 2020 && n <= 2035);
      if (esAnio || (!conSimbolo && magnitud < 100)) continue;

      revisadas += 1;
      if (candidatos.some((n) => coincideConPayload(n, valores))) {
        verificadas += 1;
      } else {
        const cifra = `${token}${coincidencia[2] ?? ''}`.trim();
        if (!vistas.has(cifra)) {
          vistas.add(cifra);
          noEncontradas.push({ cifra, ubicacion });
        }
      }
    }
  }
  return { revisadas, verificadas, no_encontradas: noEncontradas };
}
