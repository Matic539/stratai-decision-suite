/**
 * Instancia 1 en el servidor: lee el CSV con el mismo lector y las mismas validaciones del navegador.
 * En esta instancia la matriz RICE se calcula en el navegador y las simulaciones no se guardan.
 */
import { readFile } from 'node:fs/promises';
import { leerFeedbackCSV } from '../../public/js/core/csv.js';

export async function leerFeedbackDesdeCSV(ruta) {
  const texto = await readFile(ruta, 'utf8');
  return leerFeedbackCSV(texto);
}

export function crearFuenteCSV({ ruta }) {
  return {
    nombre: 'CSV (servidor)',
    conectar: async () => {},
    cerrar: async () => {},
    leerFeedback: () => leerFeedbackDesdeCSV(ruta),
    obtenerMatriz: null,
    guardarSimulacion: null,
    estado: async () => 'archivo',
  };
}
