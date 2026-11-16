/**
 * Gráficos con Chart.js (servido localmente en /vendor, sin CDN).
 * Los colores salen de las variables CSS, así respetan el modo claro y oscuro.
 * Reglas de visualización: un solo eje Y, líneas de 2px, etiquetas directas al final
 * de cada curva, leyenda siempre visible y una tabla con los mismos valores.
 */
import { formatoUSD, formatoNumero } from '../core/utilidades.js';
import { ETIQUETAS_CAMINOS } from '../core/finanzas.js';

const instancias = new Map();

export const chartDisponible = () => typeof window.Chart === 'function';

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (nombre) => cs.getPropertyValue(nombre).trim();
  return {
    serie1: v('--serie-1'),
    serie2: v('--serie-2'),
    serie3: v('--serie-3'),
    neutra: v('--serie-neutra'),
    texto: v('--texto-primario'),
    textoSec: v('--texto-secundario'),
    apagado: v('--texto-apagado'),
    grilla: v('--grilla'),
    base: v('--linea-base'),
    superficie: v('--superficie-1'),
    fuente: v('--fuente'),
  };
}

/** Color y orden fijos por camino: el color sigue a la entidad, nunca a su posición. */
const ESTILO_CAMINOS = {
  statusQuo: { color: 'neutra', corto: 'Status quo' },
  soloPrecio: { color: 'serie3', corto: 'Solo precio' },
  soloRetencion: { color: 'serie2', corto: '100% Retención' },
  hibrida: { color: 'serie1', corto: 'Híbrida' },
};

// --- Plugins propios ---------------------------------------------------------

/** Etiqueta directa al final de cada línea, separando las que se superponen. */
const pluginEtiquetasFinales = {
  id: 'etiquetasFinales',
  afterDatasetsDraw(chart, _args, opciones) {
    const { ctx, chartArea } = chart;
    const items = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (!chart.isDatasetVisible(i) || !meta.data.length) return;
      const punto = meta.data[meta.data.length - 1];
      items.push({ x: punto.x, y: punto.y, texto: ds.etiquetaCorta ?? ds.label, color: ds.borderColor });
    });
    items.sort((a, b) => a.y - b.y);
    const separacion = 15;
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < separacion) items[i].y = items[i - 1].y + separacion;
    }
    const exceso = items.length ? items[items.length - 1].y - chartArea.bottom : 0;
    if (exceso > 0) items.forEach((it) => { it.y -= exceso; });

    ctx.save();
    ctx.font = `12px ${opciones.fuente}`;
    ctx.textBaseline = 'middle';
    for (const it of items) {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(it.x + 6, it.y);
      ctx.lineTo(it.x + 16, it.y);
      ctx.stroke();
      ctx.fillStyle = opciones.color;
      ctx.fillText(it.texto, it.x + 20, it.y);
    }
    ctx.restore();
  },
};

/** Valor al extremo de cada barra (pocas barras: se rotulan todas). */
const pluginValoresBarras = {
  id: 'valoresBarras',
  afterDatasetsDraw(chart, _args, opciones) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const horizontal = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.font = `600 12px ${opciones.fuente}`;
    ctx.fillStyle = opciones.color;
    meta.data.forEach((barra, i) => {
      const valor = chart.data.datasets[0].data[i];
      const texto = opciones.formato(valor);
      if (horizontal) {
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(texto, barra.x + 6, barra.y);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = valor >= 0 ? 'bottom' : 'top';
        ctx.fillText(texto, barra.x, valor >= 0 ? barra.y - 6 : barra.y + 6);
      }
    });
    ctx.restore();
  },
};

// --- Configuración común -----------------------------------------------------

function escalas(t, formatoY, { horizontal = false } = {}) {
  const ejeValores = {
    grid: {
      color: (c) => (c.tick && c.tick.value === 0 ? t.base : t.grilla),
      lineWidth: 1,
      drawTicks: false,
    },
    border: { display: false },
    ticks: { color: t.apagado, callback: (v) => formatoY(v), padding: 8 },
  };
  const ejeCategorias = {
    grid: { display: false },
    border: { color: t.base },
    ticks: { color: t.apagado, padding: 6 },
  };
  return horizontal ? { x: ejeValores, y: ejeCategorias } : { x: ejeCategorias, y: ejeValores };
}

function tooltip(t, formato) {
  return {
    backgroundColor: t.superficie,
    titleColor: t.texto,
    bodyColor: t.texto,
    borderColor: t.base,
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true,
    callbacks: { label: (c) => ` ${c.dataset.label}: ${formato(c.parsed[c.chart.options.indexAxis === 'y' ? 'x' : 'y'])}` },
  };
}

function dibujar(canvas, configuracion) {
  if (!chartDisponible()) {
    const aviso = document.createElement('p');
    aviso.className = 'grafico-no-disponible';
    aviso.textContent = 'Gráfico no disponible (no se cargó Chart.js). Los valores están en la tabla.';
    canvas.replaceWith(aviso);
    return;
  }
  window.Chart.defaults.font.family = tokens().fuente;
  const previo = instancias.get(canvas.id);
  if (previo && previo.config.type === configuracion.type) {
    previo.data = configuracion.data;
    previo.options = configuracion.options;
    previo.update('none');
    return;
  }
  previo?.destroy();
  instancias.set(canvas.id, new window.Chart(canvas, configuracion));
}

/** Al cambiar el modo claro/oscuro se regeneran los gráficos con los colores nuevos. */
export function destruirGraficos() {
  for (const g of instancias.values()) g.destroy();
  instancias.clear();
}

// --- Gráficos de la suite ------------------------------------------------------

export function graficarProyeccion(canvas, caminos, metrica = 'utilidadMensual') {
  const t = tokens();
  const formato = metrica === 'clientes' ? (v) => formatoNumero(v, 0) : (v) => formatoUSD(v);
  const orden = ['statusQuo', 'soloPrecio', 'soloRetencion', 'hibrida'];
  const datasets = orden.map((id) => ({
    label: ETIQUETAS_CAMINOS[id],
    etiquetaCorta: ESTILO_CAMINOS[id].corto,
    data: caminos[id][metrica],
    borderColor: t[ESTILO_CAMINOS[id].color],
    backgroundColor: t[ESTILO_CAMINOS[id].color],
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: t.superficie,
    tension: 0.25,
  }));

  dibujar(canvas, {
    type: 'line',
    data: { labels: caminos.hibrida[metrica].map((_, i) => `Mes ${i + 1}`), datasets },
    plugins: [pluginEtiquetasFinales],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 118, top: 4 } },
      scales: escalas(t, formato),
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: t.textoSec, usePointStyle: true, pointStyle: 'line', boxWidth: 18, font: { family: t.fuente } } },
        tooltip: tooltip(t, formato),
        etiquetasFinales: { color: t.texto, fuente: t.fuente },
      },
    },
  });
}

export function graficarEscenarios(canvas, escenarios) {
  const t = tokens();
  const etiquetas = { pesimista: 'Pesimista', base: 'Base', optimista: 'Optimista' };
  const claves = ['pesimista', 'base', 'optimista'];
  dibujar(canvas, {
    type: 'bar',
    data: {
      labels: claves.map((k) => etiquetas[k]),
      datasets: [{
        label: 'Beneficio incremental 12 meses',
        data: claves.map((k) => escenarios[k]),
        backgroundColor: t.serie1,
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 64,
      }],
    },
    plugins: [pluginValoresBarras],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 22, bottom: 4 } },
      scales: escalas(t, formatoUSD),
      plugins: {
        legend: { display: false },
        tooltip: tooltip(t, formatoUSD),
        valoresBarras: { color: t.texto, fuente: t.fuente, formato: formatoUSD },
      },
    },
  });
}

export function graficarIngresoEnRiesgo(canvas, matriz) {
  const t = tokens();
  const filas = [...matriz].sort((a, b) => b.ingreso_en_riesgo_usd - a.ingreso_en_riesgo_usd);
  dibujar(canvas, {
    type: 'bar',
    data: {
      labels: filas.map((f) => f.titulo_corto),
      datasets: [{
        label: 'Ingreso mensual en riesgo',
        data: filas.map((f) => f.ingreso_en_riesgo_usd),
        backgroundColor: t.serie1,
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 28,
      }],
    },
    plugins: [pluginValoresBarras],
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { right: 70 } },
      scales: escalas(t, formatoUSD, { horizontal: true }),
      plugins: {
        legend: { display: false },
        tooltip: tooltip(t, formatoUSD),
        valoresBarras: { color: t.texto, fuente: t.fuente, formato: formatoUSD },
      },
    },
  });
}
