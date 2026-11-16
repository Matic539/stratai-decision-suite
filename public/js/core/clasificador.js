/**
 * Clasificador heurístico de comentarios de clientes (voz del cliente).
 *
 * Correcciones respecto de la app de referencia:
 *  1. Compara palabras completas o prefijos, no subcadenas ("api" ya no coincide en "rápido",
 *     "sap" en "WhatsApp" ni "carga" en "cargar").
 *  2. Si no hay coincidencias, el comentario queda "sin clasificar" en vez de caer por defecto en Reportes.
 *  3. Empates: gana la categoría que el cliente menciona primero; las demás quedan como secundarias.
 *  4. Nueva categoría de seguridad y auditoría.
 */
import { CATEGORIAS, SIN_CLASIFICAR, RIESGOS } from './catalogo.js';
import { normalizarTexto } from './utilidades.js';

const LETRA_O_NUMERO = '[\\p{L}\\p{N}]';

/** Convierte una palabra clave del catálogo en una expresión regular. */
export function compilarPalabraClave(clave) {
  const normalizada = normalizarTexto(clave);
  const esPrefijo = normalizada.endsWith('*');
  const base = (esPrefijo ? normalizada.slice(0, -1) : normalizada)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+');
  const fin = esPrefijo ? '' : `(?!${LETRA_O_NUMERO})`;
  return new RegExp(`(?<!${LETRA_O_NUMERO})${base}${fin}`, 'u');
}

const compilarLista = (claves) => claves.map((clave) => ({ clave, patron: compilarPalabraClave(clave) }));

const CATEGORIAS_COMPILADAS = CATEGORIAS.map((categoria) => ({
  categoria,
  patrones: compilarLista(categoria.palabrasClave),
}));

const RIESGOS_COMPILADOS = Object.values(RIESGOS).map((riesgo) => ({
  riesgo,
  senales: compilarLista(riesgo.senales),
  canales: compilarLista(riesgo.canales),
}));

function buscarCoincidencias(textoNormalizado, patrones) {
  const encontradas = [];
  let primeraPosicion = Infinity;
  for (const { clave, patron } of patrones) {
    const resultado = patron.exec(textoNormalizado);
    if (resultado) {
      encontradas.push(clave);
      primeraPosicion = Math.min(primeraPosicion, resultado.index);
    }
  }
  return { encontradas, primeraPosicion };
}

/** Devuelve las categorías con coincidencias, ordenadas de la más fuerte a la más débil. */
export function detectarCategorias(comentario) {
  const texto = normalizarTexto(comentario);
  return CATEGORIAS_COMPILADAS.map(({ categoria, patrones }) => ({
    categoria,
    ...buscarCoincidencias(texto, patrones),
  }))
    .filter((r) => r.encontradas.length > 0)
    .sort(
      (a, b) =>
        b.encontradas.length - a.encontradas.length || a.primeraPosicion - b.primeraPosicion
    );
}

/** Riesgo: primero fuga (churn), luego upsell; si no hay señales, fricción operativa. */
export function detectarRiesgo(comentario, canal = '') {
  const texto = normalizarTexto(comentario);
  const textoCanal = normalizarTexto(canal);
  for (const { riesgo, senales, canales } of RIESGOS_COMPILADOS) {
    const porTexto = buscarCoincidencias(texto, senales).encontradas;
    const porCanal = buscarCoincidencias(textoCanal, canales).encontradas;
    if (porTexto.length || porCanal.length) {
      return { riesgo, senales: [...porTexto, ...porCanal.map((c) => `canal:${c}`)] };
    }
  }
  return { riesgo: RIESGOS.friccion, senales: [] };
}

/**
 * Clasifica un registro de feedback validado. Los nombres de los campos agregados coinciden
 * con el documento "analisis_ia" de MongoDB y con las columnas de PostgreSQL.
 */
export function clasificarComentario(registro) {
  const categorias = detectarCategorias(registro.comentario);
  const principal = categorias[0]?.categoria ?? SIN_CLASIFICAR;
  const { riesgo, senales } = detectarRiesgo(registro.comentario, registro.canal);

  return {
    ...registro,
    categoria_id: principal.id,
    categoria_titulo: principal.titulo,
    categorias_secundarias: categorias.slice(1).map((c) => c.categoria.id),
    palabras_detectadas: categorias[0]?.encontradas ?? [],
    nivel_riesgo: riesgo.etiqueta,
    riesgo_id: riesgo.id,
    senales_riesgo: senales,
    peso_impacto: riesgo.pesoImpacto,
    esfuerzo_meses: principal.esfuerzoMeses,
    costo_iniciativa_usd: principal.costoUSD,
  };
}

export function clasificarLote(registros) {
  return registros.map(clasificarComentario);
}
