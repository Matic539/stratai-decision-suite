import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCSV, leerFeedbackCSV } from '../public/js/core/csv.js';
import { leerArchivo } from './_ayuda.js';

test('lee el dataset de la clase: 12 filas con comas dentro de los comentarios', () => {
  const filas = leerFeedbackCSV(leerArchivo('../data/datos_ejemplo.csv'));
  assert.equal(filas.length, 12);
  assert.equal(filas[0].id_cliente, 'C-101');
  assert.equal(filas[0].valor_mensual_usd, 1200);
  assert.match(filas[0].comentario, /fin de mes, nuestro equipo/);
  assert.equal(filas[11].canal, 'Reunion Comercial');
});

test('soporta BOM, CRLF, comillas escapadas y saltos de línea entre comillas', () => {
  const texto = '﻿a,b\r\n"dijo ""hola""","linea 1\nlinea 2"\r\n';
  assert.deepEqual(parsearCSV(texto), [{ a: 'dijo "hola"', b: 'linea 1\nlinea 2' }]);
});

test('ignora líneas vacías', () => {
  assert.equal(parsearCSV('a,b\n1,2\n\n3,4\n\n').length, 2);
});

test('errores de formato', () => {
  assert.throws(() => parsearCSV('a,b\n"sin cerrar,2'), /comillas sin cerrar/);
  assert.throws(() => parsearCSV('a,b\n1,2,3'), /se esperaban 2 columnas/);
  assert.throws(() => parsearCSV('a,a\n1,2'), /repetidos/);
});

test('validación de feedback', () => {
  const cab = 'id_cliente,segmento,valor_mensual_usd,comentario,canal\n';
  assert.throws(() => leerFeedbackCSV('id_cliente,segmento\nC-1,PyME'), /Faltan columnas/);
  assert.throws(() => leerFeedbackCSV(cab + 'C-1,Gobierno,100,hola,Email'), /segmento/);
  assert.throws(() => leerFeedbackCSV(cab + 'C-1,PyME,-5,hola,Email'), /valor_mensual_usd/);
  assert.throws(() => leerFeedbackCSV(cab + 'C-1,PyME,abc,hola,Email'), /valor_mensual_usd/);
  assert.throws(() => leerFeedbackCSV(cab + 'C 1;DROP,PyME,10,hola,Email'), /id_cliente/);
  assert.throws(() => leerFeedbackCSV(cab + 'C-1,PyME,10,,Email'), /comentario/);
  assert.throws(() => leerFeedbackCSV(cab), /no tiene filas/);
});
