/**
 * Instancia 2: carga el CSV en MongoDB Atlas y verifica la matriz RICE calculada en la nube.
 *
 *   npm run cargar:mongodb                     carga data/datos_ejemplo.csv (sin duplicar) y verifica
 *   npm run cargar:mongodb -- --reiniciar      borra antes los documentos cargados desde ese archivo
 *   npm run cargar:mongodb -- --solo-verificar no carga nada, solo compara
 *   npm run cargar:mongodb -- otro.csv         carga otro archivo
 *
 * Usa MONGO_URI de .env (no hace falta DB_MODE=mongodb). Nunca muestra usuario ni contraseña.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { calcularMatrizRICE, compararMatrices } from '../public/js/core/rice.js';
import { formatoUSD } from '../public/js/core/utilidades.js';
import {
  connectToMongoDB, disconnectFromMongoDB, prepararColecciones, insertarFeedbackEnAtlas,
  eliminarFeedbackPorOrigen, leerFeedbackDesdeAtlas, obtenerMatrizRICEDesdeAtlas, ocultarCredenciales,
} from '../src/datos/modelo_mongodb.js';

dotenv.config({ quiet: true });
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentos = process.argv.slice(2);
const opciones = new Set(argumentos.filter((a) => a.startsWith('--')));
const archivo = argumentos.find((a) => !a.startsWith('--')) ?? path.join(RAIZ, 'data', 'datos_ejemplo.csv');
const origen = path.basename(archivo);
const uri = (process.env.MONGO_URI ?? '').trim();
const nombreBase = (process.env.MONGO_DB ?? '').trim() || 'stratai_db';
const linea = (t = '') => console.log(t);

function tabla(matriz) {
  for (const f of matriz) {
    linea(`  ${String(f.posicion).padStart(2)}. ${f.titulo_corto.padEnd(24)} clientes ${String(f.clientes_afectados).padStart(2)} · ingreso ${formatoUSD(f.ingreso_en_riesgo_usd).padStart(7)} · reach ${String(f.reach).padStart(3)} · score ${String(f.score_rice).padStart(3)}`);
  }
}

async function main() {
  if (!uri || /<[^>]+>/.test(uri)) {
    linea('Falta MONGO_URI en .env (o todavía tiene <usuario>/<password> del ejemplo).');
    process.exit(1);
  }
  const host = ocultarCredenciales(uri).replace(/\?.*$/, '');
  linea(`Conectando a ${host} (base: ${nombreBase})...`);
  await connectToMongoDB({ uri, nombreBase });
  linea('  Conectado.');

  if (!opciones.has('--solo-verificar')) {
    await prepararColecciones();
    if (opciones.has('--reiniciar')) linea(`  Documentos borrados de "${origen}": ${await eliminarFeedbackPorOrigen(origen)}`);
    const registros = leerFeedbackCSV(await readFile(archivo, 'utf8'));
    const r = await insertarFeedbackEnAtlas(registros, { origen });
    linea(`  ${registros.length} comentarios de ${origen}: ${r.insertados} nuevos, ${r.actualizados} actualizados (los repetidos no se duplican).`);
  }

  // Verificación: la matriz del pipeline en Atlas debe ser idéntica a la del navegador con los mismos datos
  const datosAtlas = await leerFeedbackDesdeAtlas();
  let todoBien = true;
  for (const criterio of ['score_rice', 'ingreso_en_riesgo_usd']) {
    const atlas = await obtenerMatrizRICEDesdeAtlas({ criterio });
    const navegador = calcularMatrizRICE(clasificarLote(datosAtlas), { criterio });
    const diferencias = compararMatrices(atlas.matriz, navegador.matriz);
    linea(`\nMatriz RICE calculada en Atlas, orden por ${criterio === 'score_rice' ? 'Score RICE' : 'ingreso en riesgo (desafío 10)'}:`);
    tabla(atlas.matriz);
    linea(`  Total: ${atlas.totales.comentarios} comentarios · ${formatoUSD(atlas.totales.ingreso_en_riesgo_usd)} en riesgo · sin clasificar: ${atlas.sin_clasificar.total_menciones}`);
    if (diferencias.length === 0) {
      linea('  Coincide con la matriz del navegador: SÍ');
    } else {
      todoBien = false;
      linea('  Coincide con la matriz del navegador: NO');
      diferencias.slice(0, 10).forEach((d) => linea(`   - ${d}`));
    }
  }

  linea(todoBien
    ? '\nListo. Para usar esta instancia, pon DB_MODE=mongodb en .env y reinicia con npm start.'
    : '\nHay diferencias entre Atlas y el navegador: revisa el detalle anterior.');
  process.exitCode = todoBien ? 0 : 2;
}

main()
  .catch((error) => {
    linea(`\nError: ${ocultarCredenciales(error.message)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromMongoDB());
