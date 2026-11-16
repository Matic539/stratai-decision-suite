/**
 * Compara la matriz RICE de las 3 instancias con los mismos datos:
 *   Instancia 1: calculada en JavaScript desde data/datos_ejemplo.csv (igual que el navegador)
 *   Instancia 2: calculada por el pipeline de agregación en MongoDB Atlas (si MONGO_URI está en .env)
 *   Instancia 3: calculada por la vista SQL y la columna generada en PostgreSQL (si PGUSER está en .env)
 *
 *   npm run comparar
 *
 * Antes hay que cargar los datos en cada base (npm run cargar:mongodb y npm run cargar:postgres).
 * No modifica nada. Nunca muestra contraseñas ni cadenas de conexión.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cargarConfig } from '../src/config.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { calcularMatrizRICE, compararMatrices } from '../public/js/core/rice.js';
import { formatoUSD } from '../public/js/core/utilidades.js';
import { connectToMongoDB, disconnectFromMongoDB, obtenerMatrizRICEDesdeAtlas } from '../src/datos/modelo_mongodb.js';
import { conectarPostgreSQL, obtenerMatrizRICEDesdePostgres } from '../src/datos/modelo_postgresql.js';

dotenv.config({ quiet: true });
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO = path.join(RAIZ, 'data', 'datos_ejemplo.csv');
const CRITERIOS = [['score_rice', 'Score RICE'], ['ingreso_en_riesgo_usd', 'ingreso en riesgo (desafío 10)']];
const linea = (t = '') => console.log(t);

/** Cada instancia entrega sus matrices por criterio, o el motivo por el que no se pudo consultar. */
async function instanciaCSV() {
  const registros = clasificarLote(leerFeedbackCSV(await readFile(ARCHIVO, 'utf8')));
  return Object.fromEntries(CRITERIOS.map(([c]) => [c, calcularMatrizRICE(registros, { criterio: c })]));
}

async function instanciaAtlas(config) {
  const uri = config.mongo.uri;
  if (!uri || /<[^>]+>/.test(uri)) return { omitida: 'falta MONGO_URI en .env' };
  try {
    await connectToMongoDB({ uri, nombreBase: config.mongo.dbName });
    const r = {};
    for (const [c] of CRITERIOS) r[c] = await obtenerMatrizRICEDesdeAtlas({ criterio: c });
    return r;
  } catch (error) {
    return { error: error.message };
  } finally {
    await disconnectFromMongoDB().catch(() => {});
  }
}

async function instanciaPostgres(config) {
  const cfg = config.postgres;
  if (!cfg.user) return { omitida: 'falta PGUSER en .env' };
  let pool;
  try {
    pool = await conectarPostgreSQL(cfg);
    const r = {};
    for (const [c] of CRITERIOS) r[c] = await obtenerMatrizRICEDesdePostgres(pool, { criterio: c, cfg });
    return r;
  } catch (error) {
    return { error: error.message };
  } finally {
    await pool?.end().catch(() => {});
  }
}

const celda = (texto, ancho) => String(texto).padStart(ancho);

async function main() {
  const config = cargarConfig({ ...process.env, DB_MODE: 'csv' });
  const instancias = [
    { nombre: 'CSV', titulo: 'Instancia 1, CSV', datos: await instanciaCSV() },
    { nombre: 'Atlas', titulo: 'Instancia 2, MongoDB Atlas', datos: await instanciaAtlas(config) },
    { nombre: 'PostgreSQL', titulo: 'Instancia 3, PostgreSQL', datos: await instanciaPostgres(config) },
  ];
  const activas = instancias.filter((i) => !i.datos.omitida && !i.datos.error);
  const base = instancias[0].datos.score_rice;

  linea(`Comparación de la matriz RICE entre instancias (${path.basename(ARCHIVO)})\n`);
  // Anchos por columna: el nombre de la instancia y un margen
  const anchoScore = (i) => Math.max(i.nombre.length + 2, 6);
  const anchoIngreso = (i) => Math.max(i.nombre.length + 2, 9);
  const totalScore = activas.reduce((s, i) => s + anchoScore(i), 0);
  const totalIngreso = activas.reduce((s, i) => s + anchoIngreso(i), 0);
  linea(`  ${' '.repeat(22)}${celda('Score RICE', totalScore)}${celda('Ingreso en riesgo', totalIngreso + 2)}`);
  linea(`  ${'Iniciativa'.padEnd(22)}${activas.map((i) => celda(i.nombre, anchoScore(i))).join('')}  ${activas.map((i) => celda(i.nombre, anchoIngreso(i))).join('')}`);
  for (const fila of base.matriz) {
    const de = (i) => i.datos.score_rice.matriz.find((f) => f.categoria_id === fila.categoria_id);
    linea(`  ${fila.titulo_corto.padEnd(22)}` +
      activas.map((i) => celda(de(i)?.score_rice ?? '-', anchoScore(i))).join('') + '  ' +
      activas.map((i) => celda(de(i) ? formatoUSD(de(i).ingreso_en_riesgo_usd) : '-', anchoIngreso(i))).join(''));
  }
  linea(`  ${'Total en riesgo'.padEnd(22)}${' '.repeat(totalScore)}  ` +
    activas.map((i) => celda(formatoUSD(i.datos.score_rice.totales.ingreso_en_riesgo_usd), anchoIngreso(i))).join(''));

  linea();
  let hayDiferencias = false;
  let hayErrores = false;
  for (const i of instancias.slice(1)) {
    if (i.datos.omitida) {
      linea(`  ${i.titulo}: omitida (${i.datos.omitida}).`);
      continue;
    }
    if (i.datos.error) {
      hayErrores = true;
      linea(`  ${i.titulo}: no se pudo consultar. ${i.datos.error}`);
      continue;
    }
    const diferencias = CRITERIOS.flatMap(([c, nombre]) =>
      compararMatrices(instancias[0].datos[c].matriz, i.datos[c].matriz).map((d) => `${nombre}: ${d}`));
    hayDiferencias = hayDiferencias || diferencias.length > 0;
    linea(`  ${i.titulo}: misma matriz que el CSV, en valores y orden, con los 2 criterios: ${diferencias.length === 0 ? 'SÍ' : 'NO'}`);
    diferencias.slice(0, 8).forEach((d) => linea(`     - ${d}`));
  }

  linea();
  if (hayDiferencias) {
    linea('Resultado: hay diferencias. Revisa que cada base tenga cargado datos_ejemplo.csv (y nada más).');
  } else if (hayErrores) {
    linea('Resultado: no se pudo consultar alguna instancia; revisa el mensaje anterior.');
  } else if (activas.length === 3) {
    linea('Resultado: las 3 instancias calculan exactamente la misma matriz RICE.');
  } else {
    linea(`Resultado: coinciden las ${activas.length} instancias disponibles.`);
  }
  process.exitCode = hayDiferencias ? 2 : hayErrores ? 1 : 0;
}

main().catch((error) => {
  linea(`\nError: ${error.message}`);
  process.exitCode = 1;
});
