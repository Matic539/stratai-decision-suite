/**
 * Pestaña 1: Simulador financiero (Módulo 1).
 * Lee el formulario, muestra KPIs, diagnósticos, gráficos y tablas.
 * No calcula nada propio: todo viene de js/core/finanzas.js y js/core/diagnostico.js.
 */
import { $, $$, el, vaciar, llenarTabla, estado as etiquetaEstado, mostrarError } from './dom.js';
import { formatoUSD, formatoPct, formatoNumero } from '../core/utilidades.js';
import { simularDilemaExcel } from '../core/dilema-excel.js';
import { graficarProyeccion, graficarEscenarios } from './graficos.js';

const ETIQUETA_NIVEL = { critico: 'Crítico', advertencia: 'Advertencia', info: 'Sugerencia', ok: 'OK' };

const form = () => $('#form-simulador');

function etiquetaDeCampo(nombre) {
  const input = form().querySelector(`[name="${nombre}"]`);
  return input?.closest('label')?.querySelector('span')?.firstChild?.textContent?.trim() ?? nombre;
}

export function leerFormulario() {
  const entradas = {};
  const supuestos = {};
  for (const input of $$('[data-entrada]', form())) entradas[input.name] = input.value === '' ? undefined : Number(input.value);
  for (const input of $$('[data-supuesto]', form())) if (input.value !== '') supuestos[input.name] = Number(input.value);
  return { entradas, supuestos };
}

export function escribirFormulario(entradas, supuestos) {
  for (const input of $$('[data-entrada]', form())) input.value = entradas[input.name] ?? '';
  for (const input of $$('[data-supuesto]', form())) input.value = supuestos[input.name] ?? '';
  actualizarSalidas(entradas);
}

export function actualizarSalidas(entradas) {
  const ajuste = Number(entradas.ajustePrecioPct) || 0;
  const precio = Number(entradas.precio) || 0;
  $('#salida-ajuste').textContent = `${ajuste > 0 ? '+' : ''}${ajuste}% (${formatoUSD(precio * (1 + ajuste / 100))})`;
  $('#salida-presupuesto').textContent = formatoUSD(Number(entradas.presupuesto) || 0);
  const ret = Number(entradas.pctRetencion) || 0;
  $('#salida-reparto').textContent = `${ret}% retención · ${100 - ret}% adquisición`;
}

/** Marca el campo inválido y atenúa los resultados (se mantiene el último cálculo válido). */
export function marcarError(error) {
  $$('[aria-invalid="true"]', form()).forEach((i) => i.removeAttribute('aria-invalid'));
  $('#resultados-simulador').classList.toggle('desactualizado', Boolean(error));
  if (!error) return mostrarError($('#error-simulador'), null);
  const campo = /"(\w+)"/.exec(error.message)?.[1];
  const input = campo ? form().querySelector(`[name="${campo}"]`) : null;
  input?.setAttribute('aria-invalid', 'true');
  const mensaje = campo ? `${etiquetaDeCampo(campo)}: ${error.message.replace(/^"\w+"\s*/, '')}` : error.message;
  mostrarError($('#error-simulador'), mensaje);
}

function tarjetaKpi(etiqueta, valor, detalle, extra = null) {
  return el('div', { class: 'tarjeta kpi' },
    el('span', { class: 'etiqueta' }, etiqueta),
    el('span', { class: 'valor' }, valor),
    extra,
    el('span', { class: 'detalle' }, detalle));
}

const conSigno = (v) => (v > 0 ? `+${formatoUSD(v)}` : formatoUSD(v));

function renderKpis({ entradas: e, kpis: k }) {
  const payback = k.paybackMeses === null
    ? (e.presupuesto > 0 ? 'No se recupera en 12 meses' : 'Sin inversión')
    : `Payback: ${formatoNumero(k.paybackMeses)} meses`;
  vaciar($('#kpis-simulador'),
    tarjetaKpi('MRR al mes 12 (híbrida)', formatoUSD(k.mrrMes12), `Hoy: ${formatoUSD(k.mrrBase)} · ${formatoNumero(k.clientesMes12, 0)} clientes`),
    tarjetaKpi('Salud unitaria LTV / CAC', `${formatoNumero(k.ratioLtvCac)}x`, `LTV ${formatoUSD(k.ltv)} · CAC ${formatoUSD(k.cacEfectivo)}`,
      etiquetaEstado(k.semaforo.nivel, k.semaforo.etiqueta)),
    tarjetaKpi('Beneficio neto incremental 12m', conSigno(k.beneficioNetoIncremental12m), 'Frente al status quo, ya descontada la inversión'),
    tarjetaKpi('ROI a 12 meses', k.roi12mPct === null ? 'N/A' : formatoPct(k.roi12mPct, 0), payback),
    tarjetaKpi('Churn mensual proyectado', formatoPct(k.churnProyectadoPct, 2),
      `Base ${formatoPct(k.churnBasePct)} · reducción por producto ${formatoPct(k.reduccionChurnPorProductoPct)}`));
}

function renderDiagnosticos(diagnosticos) {
  vaciar($('#lista-diagnosticos'), diagnosticos.map((d) =>
    el('li', {},
      etiquetaEstado(d.nivel, ETIQUETA_NIVEL[d.nivel]),
      el('span', { class: 'titulo' }, d.titulo),
      el('span', { class: 'detalle' }, d.detalle))));
}

function renderTablaCaminos(caminos) {
  const orden = ['hibrida', 'soloRetencion', 'soloPrecio', 'statusQuo'];
  llenarTabla($('#tabla-caminos'), [
    { titulo: 'Camino', valor: (c) => [el('span', { class: 'muestra', dataset: { camino: c.id } }), c.etiqueta] },
    { titulo: 'Precio', num: true, valor: (c) => formatoUSD(c.precio) },
    { titulo: 'Churn', num: true, valor: (c) => formatoPct(c.churnMensualPct, 2) },
    { titulo: 'Clientes mes 12', num: true, valor: (c) => formatoNumero(c.clientes[c.clientes.length - 1], 0) },
    { titulo: 'Utilidad 12m', num: true, valor: (c) => formatoUSD(c.utilidadAcumulada) },
    { titulo: 'Beneficio incremental', num: true, valor: (c) => (c.id === 'statusQuo' ? 'Referencia' : conSigno(c.beneficioIncremental)) },
    { titulo: 'ROI', num: true, valor: (c) => (c.roiPct === null ? 'N/A' : formatoPct(c.roiPct, 0)) },
    { titulo: 'Payback', num: true, valor: (c) => (c.paybackMeses === null ? 'N/A' : `${formatoNumero(c.paybackMeses)} m`) },
  ], orden.map((id) => ({ id, ...caminos[id] })), { claseFila: (c) => (c.id === 'hibrida' ? 'destacada' : '') });
}

function renderExcel(e) {
  const r = simularDilemaExcel({
    clientes: e.clientes,
    precio: e.precio,
    costoOperativo: (e.precio * e.costoVariablePct) / 100,
    churn: e.churnMensualPct / 100,
    organicosMes: e.nuevosOrganicosMes,
    presupuesto: e.presupuesto,
    cac: e.cac,
  });
  const nombres = { actual: 'Situación actual', A: 'A: subir precio +10%', B: 'B: marketing', C: 'C: mejorar producto' };
  llenarTabla($('#tabla-excel'), [
    { titulo: 'Opción', valor: (o) => nombres[o.id] },
    { titulo: 'Precio', num: true, valor: (o) => formatoUSD(o.precio) },
    { titulo: 'Churn', num: true, valor: (o) => formatoPct(o.churn * 100, 2) },
    { titulo: 'LTV', num: true, valor: (o) => formatoUSD(o.ltv) },
    { titulo: 'LTV/CAC', num: true, valor: (o) => `${formatoNumero(o.ratioLtvCac)}x` },
    { titulo: 'Clientes mes 12', num: true, valor: (o) => formatoNumero(o.clientesPorMes[o.clientesPorMes.length - 1], 0) },
    { titulo: 'Ganancia neta', num: true, valor: (o) => formatoUSD(o.gananciaNeta) },
    { titulo: 'vs. actual', num: true, valor: (o) => (o.id === 'actual' ? 'Referencia' : conSigno(o.diferenciaVsActual)) },
    { titulo: 'ROI', num: true, valor: (o) => (o.roi === null ? 'N/A' : formatoPct(o.roi * 100, 0)) },
  ], Object.entries(r.opciones).map(([id, o]) => ({ id, ...o })),
  { claseFila: (o) => (o.id === r.ganadorGeneral ? 'destacada' : '') });

  const diferencia = Math.abs(r.opciones.C.gananciaNeta - r.opciones.B.gananciaNeta);
  $('#veredicto-excel').textContent =
    `Veredicto del Excel: gana la Opción ${r.ganadorVeredicto} (solo compara B y C), por ${formatoUSD(diferencia)}. ` +
    `Supuestos fijos del Excel: subir el precio suma 2 puntos de churn y mejorar el producto lo reduce a la mitad.`;
}

function renderBanner(iniciativa) {
  $('#banner-iniciativa').hidden = !iniciativa;
  if (!iniciativa) return;
  $('#banner-titulo').textContent = iniciativa.titulo;
  $('#banner-costo').textContent = formatoUSD(iniciativa.costo_estimado_usd);
  $('#banner-eficacia').textContent = `${formatoNumero(iniciativa.eficacia_relativa)}x`;
}

export function render({ simulacion, diagnosticos, metrica, iniciativa }) {
  if (!simulacion) return;
  renderBanner(iniciativa);
  renderKpis(simulacion);
  renderDiagnosticos(diagnosticos);
  graficarProyeccion($('#grafico-proyeccion'), simulacion.caminos, metrica);
  graficarEscenarios($('#grafico-escenarios'), simulacion.escenarios);
  renderTablaCaminos(simulacion.caminos);
  renderExcel(simulacion.entradas);
  $$('.alternar').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metrica === metrica)));
}

export function iniciar({ alCambiar, alRestablecer, alQuitarIniciativa, alCambiarMetrica }) {
  form().addEventListener('input', () => alCambiar(leerFormulario()));
  form().addEventListener('submit', (ev) => ev.preventDefault());
  $('#btn-restablecer').addEventListener('click', alRestablecer);
  $('#btn-quitar-iniciativa').addEventListener('click', alQuitarIniciativa);
  $$('.alternar').forEach((b) => b.addEventListener('click', () => alCambiarMetrica(b.dataset.metrica)));
}
