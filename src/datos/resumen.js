/**
 * Resumen de la matriz RICE calculada por una base de datos (MongoDB Atlas o PostgreSQL),
 * con el mismo formato que calcularMatrizRICE() del navegador para poder compararlas.
 */
import { SIN_CLASIFICAR } from '../../public/js/core/catalogo.js';
import { sumar } from '../../public/js/core/utilidades.js';

export function armarResumen({ criterio, matriz, sinClasificar, totalComentarios, origen = 'MongoDB Atlas' }) {
  const filas = matriz.map((f, i) => ({ posicion: i + 1, ...f }));
  return {
    criterio,
    origen,
    matriz: filas,
    sin_clasificar: {
      categoria_id: SIN_CLASIFICAR.id,
      total_menciones: sinClasificar?.total_menciones ?? 0,
      ids_clientes: sinClasificar?.ids_clientes ?? [],
      ingreso_en_riesgo_usd: sinClasificar?.ingreso_en_riesgo_usd ?? 0,
    },
    totales: { comentarios: totalComentarios, ingreso_en_riesgo_usd: sumar(filas.map((f) => f.ingreso_en_riesgo_usd)) },
  };
}
