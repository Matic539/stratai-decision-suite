/**
 * StratAI Decision Suite: orquestador del frontend (Instancia 1: CSV en el navegador).
 *
 * Flujo: datos -> motor de reglas (js/core) -> interfaz (js/ui) -> JSON para el Comité IA.
 * Este archivo solo guarda el estado y conecta los módulos; no contiene fórmulas.
 */
import { ENTRADAS_EJEMPLO, SUPUESTOS_POR_DEFECTO, simularEstrategia, parametrosDesdeIniciativa } from './js/core/finanzas.js';
import { diagnosticarEstrategia } from './js/core/diagnostico.js';
import { leerFeedbackCSV, validarFeedback } from './js/core/csv.js';
import { clasificarLote, clasificarComentario } from './js/core/clasificador.js';
import { calcularMatrizRICE, compararMatrices } from './js/core/rice.js';
import { construirPayload, construirPromptComite } from './js/core/comite.js';
import { generarDictamenLocal } from './js/core/dictamen-local.js';
import { verificarCifras } from './js/core/verificacion.js';
import { $, $$, mostrarAviso } from './js/ui/dom.js';
import { destruirGraficos } from './js/ui/graficos.js';
import * as simulador from './js/ui/simulador.js';
import * as analizador from './js/ui/analizador.js';
import * as inspector from './js/ui/inspector.js';

const SUPUESTOS_EDITABLES = Object.freeze({
  elasticidadPrecio: SUPUESTOS_POR_DEFECTO.elasticidadPrecio,
  eficaciaProducto: SUPUESTOS_POR_DEFECTO.eficaciaProducto,
  mesesAdquisicion: SUPUESTOS_POR_DEFECTO.mesesAdquisicion,
});

/** Desafío 9 del Manual Docente: 3 clientes Enterprise de 2.500 USD con quejas de seguridad. */
const DESAFIO_9 = Object.freeze(['E-201', 'E-202', 'E-203'].map((id) => Object.freeze({
  id_cliente: id,
  segmento: 'Enterprise',
  valor_mensual_usd: 2500,
  comentario: 'Necesitamos auditoría de seguridad y control de accesos por normativa interna.',
  canal: 'Reunion Comercial',
})));

const NOMBRES_MODO = { csv: 'Instancia 1 · CSV', mongodb: 'Instancia 2 · MongoDB Atlas', postgres: 'Instancia 3 · PostgreSQL' };
const METODO_SERVIDOR = { mongodb: 'pipeline de agregación', postgres: 'consulta SQL' };

const estado = {
  entradas: { ...ENTRADAS_EJEMPLO },
  supuestos: { ...SUPUESTOS_EDITABLES },
  iniciativa: null,
  respaldoAntesDeIniciativa: null,
  metrica: 'utilidadMensual',
  registros: [],
  agregados: [],
  origen: 'sin datos',
  modo: null, // instancia activa en el servidor (csv, mongodb o postgres)
  matrizServidor: null, // matriz RICE calculada por la base de datos (Instancias 2 y 3)
  criterio: 'score_rice',
  simulacion: null,
  diagnosticos: [],
  clasificados: [],
  rice: null,
  version: 0, // aumenta con cada recálculo; sirve para saber si el dictamen quedó desactualizado
  versionDictamen: null,
};

// ---------------------------------------------------------------------------
// Recalcular (todo determinista, en el navegador)
// ---------------------------------------------------------------------------
function recalcularSimulacion() {
  try {
    estado.simulacion = simularEstrategia(estado.entradas, estado.supuestos);
    simulador.marcarError(null);
  } catch (error) {
    simulador.marcarError(error);
    return false;
  }
  estado.diagnosticos = diagnosticarEstrategia(estado.simulacion);
  estado.version += 1;
  simulador.render(estado);
  return true;
}

function recalcularRice() {
  estado.clasificados = clasificarLote([...estado.registros, ...estado.agregados]);
  estado.rice = calcularMatrizRICE(estado.clasificados, { criterio: estado.criterio });
  estado.version += 1;
  analizador.render({ ...estado, servidor: comparacionConServidor() });
}

/** Instancias 2 y 3: ¿la matriz del navegador coincide con la que calculó la base de datos? */
function comparacionConServidor() {
  const m = estado.matrizServidor;
  if (!m || !estado.rice) return null;
  const mismoCriterio = m.criterio === estado.criterio;
  return {
    origen: m.origen ?? NOMBRES_MODO[estado.modo],
    metodo: METODO_SERVIDOR[estado.modo] ?? 'servidor',
    agregados: estado.agregados.length,
    mismoCriterio,
    diferencias: compararMatrices(estado.rice.matriz, m.matriz, { compararOrden: mismoCriterio }),
  };
}

function actualizarInspector() {
  if (!estado.simulacion || !estado.rice) return;
  const payload = construirPayload({
    simulacion: estado.simulacion,
    rice: estado.rice,
    diagnosticos: estado.diagnosticos,
    iniciativa: estado.iniciativa,
    origenDatos: estado.origen,
  });
  inspector.render({ payload, prompt: construirPromptComite(payload) });
  if (estado.versionDictamen !== null) inspector.marcarDesactualizado(estado.version !== estado.versionDictamen);
}

// ---------------------------------------------------------------------------
// Módulo 3: Comité IA (el servidor recalcula todo y consulta a OpenRouter)
// ---------------------------------------------------------------------------
async function consultarComite(modo) {
  if (!estado.simulacion || !estado.rice) return;
  inspector.mostrarCargando(modo);
  const version = estado.version;
  const cuerpo = {
    entradas: estado.simulacion.entradas,
    supuestos: estado.supuestos,
    criterio: estado.criterio,
    iniciativa_id: estado.iniciativa?.categoria_id ?? null,
    // Instancia 1: todos los datos vienen del navegador. Instancias 2 y 3: la base ya los tiene,
    // solo se envían los comentarios agregados en esta sesión.
    registros: estado.modo === 'csv' || !estado.modo ? [...estado.registros, ...estado.agregados] : estado.agregados,
    modo,
  };
  let respuesta;
  try {
    respuesta = await fetch('/api/comite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    // Sin servidor: el navegador genera el dictamen local con los mismos módulos
    const payload = construirPayload({ simulacion: estado.simulacion, rice: estado.rice, diagnosticos: estado.diagnosticos, iniciativa: estado.iniciativa, origenDatos: estado.origen });
    const dictamen = generarDictamenLocal(payload);
    estado.versionDictamen = version;
    inspector.renderDictamen({
      fuente: 'local', modelo: null, motivo_respaldo: 'No hay conexión con el servidor; se generó en el navegador.',
      dictamen, verificacion: verificarCifras(dictamen, payload), generado_en: payload.generado_en,
    }, payload);
    return;
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    inspector.mostrarErrorDictamen(datos.error ?? `HTTP ${respuesta.status}`);
    return;
  }
  estado.versionDictamen = version;
  inspector.renderDictamen(datos);
  if (estado.version !== version) inspector.marcarDesactualizado(true);
  mostrarAviso(datos.fuente === 'openrouter' ? `Dictamen de ${datos.modelo}` : 'Dictamen del motor local');
}

// ---------------------------------------------------------------------------
// Módulo 1: simulador
// ---------------------------------------------------------------------------
function alCambiarFormulario({ entradas, supuestos }) {
  estado.entradas = entradas;
  estado.supuestos = supuestos;
  simulador.actualizarSalidas(entradas);
  if (recalcularSimulacion()) actualizarInspector();
}

function restablecer() {
  estado.entradas = { ...ENTRADAS_EJEMPLO };
  estado.supuestos = { ...SUPUESTOS_EDITABLES };
  estado.iniciativa = null;
  estado.respaldoAntesDeIniciativa = null;
  simulador.escribirFormulario(estado.entradas, estado.supuestos);
  recalcularSimulacion();
  actualizarInspector();
  mostrarAviso('Caso de la clase restablecido');
}

/** Botón "Simular ROI" de la matriz RICE: lleva la iniciativa al Módulo 1. */
function simularIniciativa(fila) {
  if (!estado.iniciativa) {
    estado.respaldoAntesDeIniciativa = { entradas: { ...estado.entradas }, supuestos: { ...estado.supuestos } };
  }
  const p = parametrosDesdeIniciativa(fila);
  estado.iniciativa = fila;
  estado.entradas = { ...estado.entradas, ...p.entradas };
  estado.supuestos = { ...estado.supuestos, ...p.supuestos };
  simulador.escribirFormulario(estado.entradas, estado.supuestos);
  recalcularSimulacion();
  actualizarInspector();
  activarPestana('simulador');
  window.scrollTo({ top: 0 });
  mostrarAviso(`Simulando: ${fila.titulo_corto}`);
}

function quitarIniciativa() {
  const respaldo = estado.respaldoAntesDeIniciativa;
  if (respaldo) {
    estado.entradas = respaldo.entradas;
    estado.supuestos = respaldo.supuestos;
  }
  estado.iniciativa = null;
  estado.respaldoAntesDeIniciativa = null;
  simulador.escribirFormulario(estado.entradas, estado.supuestos);
  recalcularSimulacion();
  actualizarInspector();
}

// ---------------------------------------------------------------------------
// Módulo 2: voz del cliente
// ---------------------------------------------------------------------------
function cargarCSV(texto, nombre) {
  try {
    estado.registros = leerFeedbackCSV(texto);
  } catch (error) {
    analizador.mostrarErrorCSV(`No se cargó "${nombre}": ${error.message}`);
    return;
  }
  analizador.mostrarErrorCSV(null);
  estado.agregados = [];
  estado.origen = `CSV: ${nombre}`;
  estado.matrizServidor = null;
  recalcularRice();
  actualizarInspector();
  mostrarAviso(`${estado.registros.length} comentarios cargados desde ${nombre}`);
}

/** Datos de la instancia activa en el servidor (CSV, y en las Fases 4 y 5, MongoDB o PostgreSQL). */
async function usarDatosServidor() {
  let datos;
  try {
    const respuesta = await fetch(`/api/feedback?criterio=${encodeURIComponent(estado.criterio)}`, { cache: 'no-store' });
    datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error ?? `HTTP ${respuesta.status}`);
    estado.registros = datos.datos.map((r, i) => validarFeedback(r, i + 1));
  } catch (error) {
    analizador.mostrarErrorCSV(`No se pudieron obtener los datos del servidor (${error.message}). Usa "Cargar CSV".`);
    return;
  }
  analizador.mostrarErrorCSV(null);
  estado.agregados = [];
  estado.origen = datos.origen;
  estado.matrizServidor = datos.matriz_servidor ?? null;
  recalcularRice();
  actualizarInspector();
}

function agregarDesafio9() {
  const ids = new Set(estado.agregados.map((r) => r.id_cliente));
  if (DESAFIO_9.every((r) => ids.has(r.id_cliente))) {
    mostrarAviso('El desafío 9 ya está agregado');
    return;
  }
  estado.agregados.push(...DESAFIO_9.filter((r) => !ids.has(r.id_cliente)).map((r) => ({ ...r })));
  recalcularRice();
  actualizarInspector();
  const fila = estado.rice.matriz.find((f) => f.categoria_id === 'seguridad_auditoria');
  mostrarAviso(`Desafío 9: Seguridad y auditoría queda en el puesto ${fila?.posicion ?? 'N/D'} (score ${fila?.score_rice ?? 'N/D'})`, 4500);
}

function agregarComentario(datos) {
  let registro;
  try {
    registro = validarFeedback(datos);
  } catch (error) {
    return error.message.replace(/^Registro:\s*/, '');
  }
  estado.agregados.push(registro);
  recalcularRice();
  actualizarInspector();
  const c = clasificarComentario(registro);
  mostrarAviso(`Clasificado como "${c.categoria_titulo}" · ${c.nivel_riesgo}`, 4000);
  return null;
}

function quitarAgregado(indice) {
  estado.agregados.splice(indice, 1);
  recalcularRice();
  actualizarInspector();
}

function cambiarCriterio(criterio) {
  estado.criterio = criterio;
  recalcularRice();
  actualizarInspector();
}

// ---------------------------------------------------------------------------
// Pestañas (patrón ARIA: flechas, Inicio y Fin)
// ---------------------------------------------------------------------------
function activarPestana(nombre) {
  for (const pestana of $$('[role="tab"]')) {
    const activa = pestana.id === `pestana-${nombre}`;
    pestana.setAttribute('aria-selected', String(activa));
    pestana.tabIndex = activa ? 0 : -1;
    $(`#${pestana.getAttribute('aria-controls')}`).hidden = !activa;
  }
}

function iniciarPestanas() {
  const pestanas = $$('[role="tab"]');
  pestanas.forEach((pestana, i) => {
    pestana.addEventListener('click', () => activarPestana(pestana.id.replace('pestana-', '')));
    pestana.addEventListener('keydown', (ev) => {
      const destino = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: pestanas.length - 1 }[ev.key];
      if (destino === undefined) return;
      ev.preventDefault();
      const siguiente = pestanas[(destino + pestanas.length) % pestanas.length];
      activarPestana(siguiente.id.replace('pestana-', ''));
      siguiente.focus();
    });
  });
}

async function consultarServidor() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const datos = await r.json();
    estado.modo = datos.modo;
    analizador.configurarModo(datos.modo);
    const bdConError = typeof datos.bd === 'string' && datos.bd.startsWith('error');
    $('#insignia-modo').textContent = `${NOMBRES_MODO[datos.modo] ?? `Instancia: ${datos.modo}`}${bdConError ? ' (sin conexión)' : ''}`;
    if (bdConError) analizador.mostrarErrorCSV(`La base de datos no responde: ${datos.bd.replace(/^error:\s*/, '')}`);
    $('#insignia-ia').textContent = datos.ia === 'openrouter' ? 'IA: OpenRouter' : 'IA: dictamen local';
  } catch {
    $('#insignia-modo').textContent = 'Instancia 1 · CSV (sin servidor)';
    $('#insignia-ia').textContent = 'IA: no disponible';
  }
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
function iniciar() {
  iniciarPestanas();
  inspector.iniciar({ alConsultar: consultarComite });
  simulador.iniciar({
    alCambiar: alCambiarFormulario,
    alRestablecer: restablecer,
    alQuitarIniciativa: quitarIniciativa,
    alCambiarMetrica: (metrica) => {
      estado.metrica = metrica;
      simulador.render(estado);
    },
  });
  analizador.iniciar({
    alCargarCSV: cargarCSV,
    alUsarEjemplo: usarDatosServidor,
    alAgregarDesafio9: agregarDesafio9,
    alAgregarComentario: agregarComentario,
    alQuitarAgregado: quitarAgregado,
    alCambiarCriterio: cambiarCriterio,
    alSimularIniciativa: simularIniciativa,
  });

  // Al cambiar el modo claro/oscuro del sistema se redibujan los gráficos con sus colores
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    destruirGraficos();
    simulador.render(estado);
    analizador.render({ ...estado, servidor: comparacionConServidor() });
  });

  simulador.escribirFormulario(estado.entradas, estado.supuestos);
  recalcularSimulacion();
  // Primero se consulta la instancia activa y luego se piden los datos
  consultarServidor().then(usarDatosServidor);
}

iniciar();
