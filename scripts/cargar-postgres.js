/**
 * Instancia 3: carga el CSV en PostgreSQL y verifica la matriz RICE calculada por el motor relacional.
 *
 *   npm run cargar:postgres                      carga data/datos_ejemplo.csv (sin duplicar) y verifica
 *   npm run cargar:postgres -- --reiniciar       borra antes los comentarios cargados desde ese archivo
 *   npm run cargar:postgres -- --solo-verificar  no carga nada, solo compara
 *   npm run cargar:postgres -- --desafio-11      duplica el valor mensual de C-103 dentro de una
 *                                                transacción, muestra el antes y el después, y la deshace
 *   npm run cargar:postgres -- otro.csv          carga otro archivo
 *
 * Usa PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE de .env (no hace falta DB_MODE=postgres).
 * Antes hay que crear la base y ejecutar sql/esquema_postgresql.sql (ver docs/guia-paso-a-paso-fase5.md).
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
import {
  conectarPostgreSQL, insertarFeedbackEnPostgres, eliminarFeedbackPorOrigen,
  leerFeedbackDesdePostgres, obtenerMatrizRICEDesdePostgres, traducirErrorPostgres,
} from '../src/datos/modelo_postgresql.js';

dotenv.config({ quiet: true });
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentos = process.argv.slice(2);
const opciones = new Set(argumentos.filter((a) => a.startsWith('--')));
const archivo = argumentos.find((a) => !a.startsWith('--')) ?? path.join(RAIZ, 'data', 'datos_ejemplo.csv');
const origen = path.basename(archivo);
const CLIENTE_DESAFIO_11 = 'C-103';
const linea = (t = '') => console.log(t);

function tabla(matriz) {
  for (const f of matriz) {
    linea(`  ${String(f.posicion).padStart(2)}. ${f.titulo_corto.padEnd(24)} clientes ${String(f.clientes_afectados).padStart(2)} · ingreso ${formatoUSD(f.ingreso_en_riesgo_usd).padStart(7)} · reach ${String(f.reach).padStart(3)} · score ${String(f.score_rice).padStart(3)}`);
  }
}

/** Muestra la matriz de la base y la compara con la que calcula el navegador con los mismos datos. */
async function verificar(db, criterio, titulo, cfg) {
  const datos = await leerFeedbackDesdePostgres(db, { cfg });
  const sql = await obtenerMatrizRICEDesdePostgres(db, { criterio, cfg });
  const navegador = calcularMatrizRICE(clasificarLote(datos), { criterio });
  const diferencias = compararMatrices(sql.matriz, navegador.matriz);
  linea(`\n${titulo}:`);
  tabla(sql.matriz);
  linea(`  Total: ${sql.totales.comentarios} comentarios · ${formatoUSD(sql.totales.ingreso_en_riesgo_usd)} en riesgo · sin clasificar: ${sql.sin_clasificar.total_menciones}`);
  linea(`  Coincide con la matriz del navegador: ${diferencias.length === 0 ? 'SÍ' : 'NO'}`);
  diferencias.slice(0, 10).forEach((d) => linea(`   - ${d}`));
  return diferencias.length === 0;
}

/**
 * Desafío 11 (Manual Docente): duplicar el valor mensual de C-103 en "clientes" y ver que el
 * ingreso en riesgo y el score cambian sin tocar "feedback_clientes". Se hace dentro de una
 * transacción que al final se deshace (ROLLBACK), para que la base siga igual al CSV.
 */
async function desafio11(pool, cfg) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const contar = async () => (await cliente.query(
      'SELECT COUNT(*)::int AS n, MAX(fecha_registro) AS ultima FROM feedback_clientes WHERE id_cliente = $1', [CLIENTE_DESAFIO_11]
    )).rows[0];
    const valor = async () => Number((await cliente.query(
      'SELECT valor_mensual_usd FROM clientes WHERE id_cliente = $1', [CLIENTE_DESAFIO_11]
    )).rows[0]?.valor_mensual_usd);

    const antes = await valor();
    if (!Number.isFinite(antes)) throw new Error(`No existe el cliente ${CLIENTE_DESAFIO_11} en la tabla clientes.`);
    const comentariosAntes = await contar();
    let ok = await verificar(cliente, 'score_rice', `Desafío 11, ANTES: ${CLIENTE_DESAFIO_11} paga ${formatoUSD(antes)} al mes`, cfg);

    const { rowCount } = await cliente.query(
      'UPDATE clientes SET valor_mensual_usd = valor_mensual_usd * 2 WHERE id_cliente = $1', [CLIENTE_DESAFIO_11]
    );
    linea(`\n  UPDATE clientes SET valor_mensual_usd = valor_mensual_usd * 2 WHERE id_cliente = '${CLIENTE_DESAFIO_11}';  -> ${rowCount} fila`);

    const despues = await valor();
    const comentariosDespues = await contar();
    ok = (await verificar(cliente, 'score_rice', `Desafío 11, DESPUÉS: ${CLIENTE_DESAFIO_11} paga ${formatoUSD(despues)} al mes`, cfg)) && ok;
    const intactos = comentariosAntes.n === comentariosDespues.n && String(comentariosAntes.ultima) === String(comentariosDespues.ultima);
    linea(`  Comentarios de ${CLIENTE_DESAFIO_11} en feedback_clientes: ${comentariosDespues.n}, sin cambios: ${intactos ? 'SÍ' : 'NO'}`);
    linea('  (los triggers recalcularon alcance y score; la columna generada score_rice se actualizó sola)');
    return ok && intactos;
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
    linea(`\n  ROLLBACK: ${CLIENTE_DESAFIO_11} vuelve a su valor original; la base queda igual que antes.`);
  }
}

async function main() {
  let cfg;
  try {
    cfg = cargarConfig({ ...process.env, DB_MODE: 'postgres' }).postgres;
  } catch (error) {
    linea(`Revisa .env: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  linea(`Conectando a PostgreSQL en ${cfg.host}:${cfg.port} (base: ${cfg.database}, usuario: ${cfg.user})...`);
  const pool = await conectarPostgreSQL(cfg);
  linea('  Conectado. El esquema está creado.');

  try {
    if (!opciones.has('--solo-verificar') && !opciones.has('--desafio-11')) {
      if (opciones.has('--reiniciar')) linea(`  Comentarios borrados de "${origen}": ${await eliminarFeedbackPorOrigen(pool, origen, { cfg })}`);
      const registros = leerFeedbackCSV(await readFile(archivo, 'utf8'));
      const r = await insertarFeedbackEnPostgres(pool, registros, { origen, cfg });
      linea(`  ${registros.length} comentarios de ${origen}: ${r.insertados} nuevos, ${r.actualizados} actualizados (los repetidos no se duplican).`);
      linea(`  Clientes creados o actualizados desde el CSV: ${r.clientes_actualizados}.`);
    }

    let todoBien;
    if (opciones.has('--desafio-11')) {
      todoBien = await desafio11(pool, cfg);
    } else {
      todoBien = await verificar(pool, 'score_rice', 'Matriz RICE calculada por PostgreSQL, orden por Score RICE', cfg);
      todoBien = (await verificar(pool, 'ingreso_en_riesgo_usd', 'Matriz RICE calculada por PostgreSQL, orden por ingreso en riesgo (desafío 10)', cfg)) && todoBien;
      linea(todoBien
        ? '\nListo. Para usar esta instancia, pon DB_MODE=postgres en .env y reinicia con npm start.'
        : '\nHay diferencias entre PostgreSQL y el navegador: revisa el detalle anterior.');
    }
    process.exitCode = todoBien ? 0 : 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const mensaje = error?.expose || error instanceof RangeError || error instanceof SyntaxError
    ? error.message
    : traducirErrorPostgres(error, cargarConfigSegura()).message;
  linea(`\nError: ${mensaje}`);
  process.exitCode = 1;
});

function cargarConfigSegura() {
  try {
    return cargarConfig({ ...process.env, DB_MODE: 'postgres' }).postgres;
  } catch {
    return {};
  }
}
