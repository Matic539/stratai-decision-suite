/**
 * Lector de CSV (RFC 4180) para la Instancia 1.
 * Soporta comillas, comas y saltos de línea dentro de comillas, comillas escapadas (""),
 * finales de línea Windows (CRLF) y la marca BOM que agrega Excel.
 */
import { SEGMENTOS } from './catalogo.js';

export const MAX_FILAS_CSV = 5000;
export const COLUMNAS_FEEDBACK = Object.freeze(['id_cliente', 'segmento', 'valor_mensual_usd', 'comentario', 'canal']);

export function parsearCSV(texto, { separador = ',' } = {}) {
  if (typeof texto !== 'string') throw new TypeError('El contenido CSV debe ser texto.');
  const fuente = texto.replace(/^﻿/, '');
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < fuente.length; i++) {
    const caracter = fuente[i];
    if (enComillas) {
      if (caracter === '"') {
        if (fuente[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += caracter;
      }
    } else if (caracter === '"') {
      enComillas = true;
    } else if (caracter === separador) {
      fila.push(campo);
      campo = '';
    } else if (caracter === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (caracter !== '\r') {
      campo += caracter;
    }
  }
  if (enComillas) throw new SyntaxError('CSV mal formado: hay comillas sin cerrar.');
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  const utiles = filas.filter((f) => f.some((c) => c.trim() !== ''));
  if (utiles.length === 0) return [];

  const encabezados = utiles[0].map((h) => h.trim());
  if (encabezados.some((h) => h === '')) throw new SyntaxError('CSV mal formado: hay un encabezado vacío.');
  if (new Set(encabezados).size !== encabezados.length) {
    throw new SyntaxError('CSV mal formado: hay encabezados repetidos.');
  }

  return utiles.slice(1).map((f, indice) => {
    if (f.length !== encabezados.length) {
      throw new SyntaxError(
        `Fila ${indice + 2}: se esperaban ${encabezados.length} columnas y hay ${f.length}.`
      );
    }
    return Object.fromEntries(encabezados.map((h, j) => [h, f[j].trim()]));
  });
}

/** Convierte las filas del CSV en registros de feedback validados (mismos nombres que las columnas). */
export function leerFeedbackCSV(texto) {
  const filas = parsearCSV(texto);
  if (filas.length === 0) throw new RangeError('El CSV no tiene filas de datos.');
  if (filas.length > MAX_FILAS_CSV) {
    throw new RangeError(`El CSV supera el máximo de ${MAX_FILAS_CSV} filas.`);
  }
  const faltantes = COLUMNAS_FEEDBACK.filter((c) => !(c in filas[0]));
  if (faltantes.length) throw new SyntaxError(`Faltan columnas en el CSV: ${faltantes.join(', ')}.`);

  return filas.map((f, i) => validarFeedback(f, i + 2));
}

export function validarFeedback(registro, numeroFila = null) {
  const donde = numeroFila ? `Fila ${numeroFila}` : 'Registro';
  const id = String(registro.id_cliente ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) {
    throw new RangeError(`${donde}: id_cliente inválido ("${id}"). Usa hasta 20 letras, números, - o _.`);
  }
  const segmento = String(registro.segmento ?? '').trim();
  if (!SEGMENTOS.includes(segmento)) {
    throw new RangeError(`${donde}: segmento "${segmento}" no válido. Usa: ${SEGMENTOS.join(', ')}.`);
  }
  const valor = Number(String(registro.valor_mensual_usd ?? '').trim());
  if (!Number.isFinite(valor) || valor < 0) {
    throw new RangeError(`${donde}: valor_mensual_usd debe ser un número mayor o igual a 0.`);
  }
  const comentario = String(registro.comentario ?? '').trim();
  if (comentario.length === 0 || comentario.length > 2000) {
    throw new RangeError(`${donde}: el comentario debe tener entre 1 y 2000 caracteres.`);
  }
  const canal = String(registro.canal ?? '').trim();
  if (canal.length === 0 || canal.length > 50) {
    throw new RangeError(`${donde}: el canal debe tener entre 1 y 50 caracteres.`);
  }
  return { id_cliente: id, segmento, valor_mensual_usd: valor, comentario, canal };
}
