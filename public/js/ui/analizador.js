/**
 * Pestaña 2: Voz del cliente a matriz RICE (Módulo 2), Instancia 1 con CSV.
 * El archivo se lee en el navegador con FileReader; la clasificación y la matriz
 * vienen de js/core/clasificador.js y js/core/rice.js.
 */
import { $, el, vaciar, llenarTabla, estado as etiquetaEstado, mostrarError } from './dom.js';
import { formatoUSD, formatoPct, formatoNumero } from '../core/utilidades.js';
import { buscarCategoria } from '../core/catalogo.js';
import { graficarIngresoEnRiesgo } from './graficos.js';

const MAX_BYTES_CSV = 2 * 1024 * 1024;
let manejadores = {};

const tituloCorto = (id) => buscarCategoria(id)?.tituloCorto ?? 'Sin clasificar';

function tarjetaKpi(etiqueta, valor, detalle) {
  return el('div', { class: 'tarjeta kpi' },
    el('span', { class: 'etiqueta' }, etiqueta),
    el('span', { class: 'valor' }, valor),
    el('span', { class: 'detalle' }, detalle));
}

function renderResumen({ rice, clasificados, origen }) {
  const primero = rice.matriz[0];
  const clientes = new Set(clasificados.map((c) => c.id_cliente)).size;
  const criterio = rice.criterio === 'score_rice' ? 'Score RICE' : 'ingreso en riesgo';
  vaciar($('#resumen-voc'),
    tarjetaKpi('Comentarios analizados', formatoNumero(clasificados.length, 0), `${clientes} clientes · ${origen}`),
    tarjetaKpi('Ingreso mensual en riesgo', formatoUSD(rice.totales.ingreso_en_riesgo_usd), 'Suma del MRR de los clientes que reclaman'),
    tarjetaKpi(`Prioridad 1 por ${criterio}`, primero ? primero.titulo_corto : 'N/D',
      primero ? `Score ${primero.score_rice} · ${formatoUSD(primero.ingreso_en_riesgo_usd)} en riesgo` : 'Sin datos'),
    tarjetaKpi('Sin clasificar', formatoNumero(rice.sin_clasificar.total_menciones, 0), 'Requieren revisión manual'));
}

function desgloseRiesgo(d) {
  const partes = [];
  if (d.churn) partes.push(`${d.churn} fuga`);
  if (d.upsell) partes.push(`${d.upsell} upsell`);
  if (d.friccion) partes.push(`${d.friccion} fricción`);
  return partes.join(' · ');
}

function renderMatriz(rice) {
  const maximo = Math.max(1, ...rice.matriz.map((f) => f.score_rice));
  llenarTabla($('#tabla-rice'), [
    { titulo: '#', num: true, valor: (f) => String(f.posicion) },
    { titulo: 'Iniciativa', valor: (f) => [f.titulo, el('span', { class: 'secundario' }, desgloseRiesgo(f.desglose_riesgo))] },
    { titulo: 'Clientes', num: true, valor: (f) => String(f.clientes_afectados) },
    { titulo: 'Ingreso en riesgo', num: true, valor: (f) => formatoUSD(f.ingreso_en_riesgo_usd) },
    { titulo: 'Impacto', num: true, valor: (f) => formatoNumero(f.impacto_promedio, 2) },
    { titulo: 'Reach', num: true, valor: (f) => String(f.reach) },
    { titulo: 'Confianza', num: true, valor: (f) => formatoPct(f.confidence_pct, 0) },
    { titulo: 'Esfuerzo', num: true, valor: (f) => `${formatoNumero(f.esfuerzo_meses)} m` },
    { titulo: 'Costo', num: true, valor: (f) => formatoUSD(f.costo_estimado_usd) },
    {
      titulo: 'Score RICE', num: true,
      valor: (f) => el('span', { class: 'barra-score' },
        el('span', { class: 'pista', 'aria-hidden': 'true' }, el('span', { class: 'relleno', vars: { '--ancho': `${(f.score_rice / maximo) * 100}%` } })),
        el('strong', {}, String(f.score_rice))),
    },
    {
      titulo: 'Acción',
      valor: (f) => el('button', { type: 'button', class: 'boton mini', onClick: () => manejadores.alSimularIniciativa(f), 'aria-label': `Simular ROI de ${f.titulo}` }, 'Simular ROI →'),
    },
  ], rice.matriz, { claseFila: (f) => (f.posicion === 1 ? 'destacada' : '') });

  const sin = rice.sin_clasificar;
  const aviso = $('#aviso-sin-clasificar');
  aviso.hidden = sin.total_menciones === 0;
  aviso.textContent = sin.total_menciones
    ? `${sin.total_menciones} comentario(s) sin clasificar (${formatoUSD(sin.ingreso_en_riesgo_usd)} en riesgo) quedan fuera de la matriz: revísalos o agrega palabras clave al catálogo.`
    : '';
}

function renderFeedback(clasificados, inicioAgregados) {
  llenarTabla($('#tabla-feedback'), [
    { titulo: 'Cliente', valor: (c) => [c.id_cliente, el('span', { class: 'secundario' }, c.segmento)] },
    { titulo: 'MRR', num: true, valor: (c) => formatoUSD(c.valor_mensual_usd) },
    { titulo: 'Canal', valor: (c) => c.canal },
    { titulo: 'Comentario', clase: 'comentario', valor: (c) => c.comentario },
    {
      titulo: 'Iniciativa',
      valor: (c) => [tituloCorto(c.categoria_id),
        c.categorias_secundarias.length ? el('span', { class: 'secundario' }, `también: ${c.categorias_secundarias.map(tituloCorto).join(', ')}`) : null],
    },
    { titulo: 'Riesgo', valor: (c) => etiquetaEstado(c.riesgo_id, c.nivel_riesgo) },
    { titulo: 'Palabras detectadas', valor: (c) => el('span', { class: 'palabras' }, [...c.palabras_detectadas, ...c.senales_riesgo].map((p) => el('span', {}, p))) },
    {
      titulo: '',
      valor: (c, i) => (i >= inicioAgregados
        ? el('button', { type: 'button', class: 'boton fantasma mini', onClick: () => manejadores.alQuitarAgregado(i - inicioAgregados), 'aria-label': `Quitar comentario de ${c.id_cliente}` }, 'Quitar')
        : ''),
    },
  ], clasificados, { claseFila: (_c, i) => (i >= inicioAgregados ? 'agregado' : '') });
}

/** Instancias 2 y 3: compara la matriz del navegador con la calculada por la base de datos. */
function renderVerificacionServidor(servidor) {
  const caja = $('#verificacion-servidor');
  caja.hidden = !servidor;
  if (!servidor) return;
  if (servidor.agregados > 0) {
    vaciar(caja, etiquetaEstado('info', `La matriz calculada por ${servidor.origen} no incluye los ${servidor.agregados} comentario(s) agregados en esta sesión; la tabla de arriba sí.`));
  } else if (servidor.diferencias.length === 0) {
    vaciar(caja, etiquetaEstado('ok', `Coincide con la matriz calculada por ${servidor.origen} (${servidor.metodo}): mismos valores${servidor.mismoCriterio ? ' y mismo orden' : ''}.`));
  } else {
    vaciar(caja,
      etiquetaEstado('advertencia', `La matriz calculada por ${servidor.origen} no coincide con la del navegador:`),
      el('ul', {}, servidor.diferencias.slice(0, 5).map((d) => el('li', {}, d))));
  }
}

/** En las Instancias 2 y 3 los datos vienen de la base: el CSV se carga con el script del servidor. */
export function configurarModo(modo) {
  const enBase = modo === 'mongodb' || modo === 'postgres';
  $('#archivo-csv').disabled = enBase;
  const etiqueta = $('#etiqueta-archivo-csv');
  etiqueta.classList.toggle('desactivado', enBase);
  etiqueta.title = enBase ? `En esta instancia los datos vienen de la base. Para cargar un CSV usa: npm run cargar:${modo}` : '';
}

export function render({ rice, clasificados, origen, registros, criterio, servidor = null }) {
  if (!rice) return;
  renderVerificacionServidor(servidor);
  $('#origen-datos').textContent = origen;
  $('#criterio-rice').value = criterio;
  renderResumen({ rice, clasificados, origen });
  renderMatriz(rice);
  graficarIngresoEnRiesgo($('#grafico-ingreso'), rice.matriz);
  renderFeedback(clasificados, registros.length);
}

export function mostrarErrorCSV(mensaje) {
  mostrarError($('#error-csv'), mensaje);
}

export function iniciar(h) {
  manejadores = h;

  $('#archivo-csv').addEventListener('change', (ev) => {
    const archivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!archivo) return;
    if (archivo.size > MAX_BYTES_CSV) return mostrarErrorCSV('El archivo supera 2 MB.');
    const lector = new FileReader();
    lector.onload = () => h.alCargarCSV(String(lector.result), archivo.name);
    lector.onerror = () => mostrarErrorCSV('No se pudo leer el archivo.');
    lector.readAsText(archivo, 'utf-8');
  });

  $('#btn-dataset').addEventListener('click', h.alUsarEjemplo);
  $('#btn-desafio9').addEventListener('click', h.alAgregarDesafio9);
  $('#criterio-rice').addEventListener('change', (ev) => h.alCambiarCriterio(ev.target.value));

  $('#form-comentario').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const datos = Object.fromEntries(new FormData(ev.target));
    const error = h.alAgregarComentario(datos);
    mostrarError($('#error-comentario'), error);
    if (!error) ev.target.reset();
  });
}
