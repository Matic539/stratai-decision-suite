/**
 * Pestaña 3: Inspector del JSON y del prompt, y dictamen del Comité IA (Módulo 3).
 * Todo lo que viene de la IA se inserta como texto (sin innerHTML).
 */
import { $, $$, el, vaciar, estado as etiquetaEstado, mostrarAviso, copiarTexto } from './dom.js';

const ROLES = [
  ['vision_cfo', 'CFO · Finanzas'],
  ['vision_cmo', 'CMO · Marketing y crecimiento'],
  ['vision_coo', 'COO · Operaciones y producto'],
];
const NIVEL_DECISION = { Avanzar: 'ok', Pivotar: 'advertencia', Descartar: 'critico' };
const SENTIDO_DECISION = { Avanzar: 'Invertir según lo simulado', Pivotar: 'Corregir antes de invertir', Descartar: 'No invertir' };

let manejadores = {};

export function render({ payload, prompt }) {
  $('#codigo-payload').textContent = JSON.stringify(payload, null, 2);
  $('#codigo-prompt').textContent = prompt.completo;
}

export function marcarDesactualizado(desactualizado) {
  $('#aviso-desactualizado').hidden = !desactualizado;
}

export function mostrarCargando(modo) {
  $$('#seccion-dictamen .acciones .boton').forEach((b) => { b.disabled = true; });
  $('#seccion-dictamen').setAttribute('aria-busy', 'true');
  $('#estado-dictamen').textContent = modo === 'local'
    ? 'Generando el dictamen local...'
    : 'Consultando al Comité IA. Los modelos gratuitos que razonan pueden tardar 1 o 2 minutos...';
}

function terminarCarga() {
  $$('#seccion-dictamen .acciones .boton').forEach((b) => { b.disabled = false; });
  $('#seccion-dictamen').removeAttribute('aria-busy');
}

export function mostrarErrorDictamen(mensaje) {
  terminarCarga();
  $('#estado-dictamen').textContent = `No se pudo obtener el dictamen: ${mensaje}`;
}

const lista = (items, vacio = 'Sin elementos.') =>
  items.length ? el('ul', {}, items.map((t) => el('li', {}, t))) : el('p', { class: 'nota' }, vacio);

function bloqueMeta(r) {
  const hora = new Date(r.generado_en).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  const fuente = r.fuente === 'openrouter'
    ? etiquetaEstado('info', `OpenRouter · ${r.modelo}${r.variante === 'simple' ? ' · formato simple' : ''}`)
    : etiquetaEstado('advertencia', 'Motor local (reglas)');
  return el('div', { class: 'dictamen-meta' },
    fuente,
    r.latencia_ms ? el('span', { class: 'nota' }, `${(r.latencia_ms / 1000).toFixed(1)} s`) : null,
    el('span', { class: 'nota' }, `Generado a las ${hora}`),
    r.guardado?.id ? etiquetaEstado('ok', `Guardado en ${r.guardado.destino} (id ${r.guardado.id})`) : null,
    r.guardado?.error ? el('p', { class: 'mensaje-error' }, `No se guardó en ${r.guardado.destino}: ${r.guardado.error}`) : null,
    r.motivo_respaldo ? el('p', { class: 'mensaje-error' }, `Se usó el dictamen local: ${r.motivo_respaldo}`) : null);
}

function bloqueVerificacion(v) {
  if (v.revisadas === 0) {
    return el('div', { class: 'verificacion' }, etiquetaEstado('info', 'El dictamen no cita cifras.'));
  }
  if (v.no_encontradas.length === 0) {
    return el('div', { class: 'verificacion' },
      etiquetaEstado('ok', `Cifras verificadas: las ${v.revisadas} cifras citadas están en el JSON del motor de reglas.`));
  }
  return el('div', { class: 'verificacion' },
    etiquetaEstado('advertencia', `${v.no_encontradas.length} cifra(s) no están en el JSON (${v.verificadas} de ${v.revisadas} verificadas). Pueden ser cálculos propios de la IA o invenciones:`),
    el('ul', {}, v.no_encontradas.map((n) => el('li', {}, el('strong', {}, n.cifra), ` en ${n.ubicacion}`))));
}

export function renderDictamen(r, payload) {
  terminarCarga();
  const d = r.dictamen;
  const iniciativas = (payload ?? r.payload).modulo_2_rice.iniciativas;
  const prioritaria = iniciativas.find((i) => i.categoria_id === d.iniciativa_prioritaria);

  $('#estado-dictamen').textContent = r.fuente === 'openrouter'
    ? 'Dictamen generado por la IA a partir del JSON calculado por el servidor.'
    : 'Dictamen generado por el motor de reglas local (sin IA).';

  const contenedor = $('#dictamen');
  vaciar(contenedor,
    bloqueMeta(r),
    bloqueVerificacion(r.verificacion),
    el('div', { class: 'decision' },
      el('div', {},
        el('span', { class: 'etiqueta' }, 'Decisión'),
        el('span', { class: 'valor' }, d.decision ?? 'N/D'),
        etiquetaEstado(NIVEL_DECISION[d.decision] ?? 'info', SENTIDO_DECISION[d.decision] ?? 'Sin decisión')),
      el('div', {},
        el('span', { class: 'etiqueta' }, 'Iniciativa prioritaria'),
        el('span', { class: 'valor chico' }, prioritaria?.titulo ?? 'N/D')),
      el('p', { class: 'justificacion' }, d.justificacion)),
    el('div', { class: 'visiones' }, ROLES.map(([clave, titulo]) => {
      const v = d[clave];
      return el('article', { class: 'vision' },
        el('h3', {}, titulo),
        el('p', { class: 'postura' }, v.postura),
        el('h4', {}, 'Argumentos'), lista(v.argumentos),
        el('h4', {}, 'Riesgos'), lista(v.riesgos, 'Sin riesgos señalados.'));
    })),
    el('h3', { class: 'subtitulo-seccion' }, 'Plan de acción a 90 días'),
    el('div', { class: 'plan' }, d.plan_90_dias.map((p) =>
      el('article', { class: 'mes' }, el('h4', {}, `Mes ${p.mes}`), lista(p.acciones)))),
    el('h3', { class: 'subtitulo-seccion' }, 'Supuestos a validar'),
    lista(d.supuestos_a_validar),
    r.respuesta_ia_original
      ? el('details', {}, el('summary', {}, 'Última respuesta de la IA que no cumplió el formato'), el('pre', { class: 'codigo' }, r.respuesta_ia_original))
      : null,
    r.intentos?.length
      ? el('details', {}, el('summary', {}, `Intentos fallidos con OpenRouter (${r.intentos.length})`),
        lista(r.intentos.map((i) => `Intento ${i.variante === 'esquema' ? 'con esquema JSON' : 'simple'}: ${i.mensaje}`)))
      : null);
  contenedor.hidden = false;
  marcarDesactualizado(false);
}

export function iniciar(h = {}) {
  manejadores = h;
  $$('[data-copiar]').forEach((boton) =>
    boton.addEventListener('click', async () => {
      const texto = $(`#${boton.dataset.copiar}`).textContent;
      const ok = await copiarTexto(texto);
      mostrarAviso(ok ? 'Copiado al portapapeles' : 'No se pudo copiar: selecciona el texto manualmente');
    }));
  $('#btn-consultar-ia').addEventListener('click', () => manejadores.alConsultar?.('auto'));
  $('#btn-dictamen-local').addEventListener('click', () => manejadores.alConsultar?.('local'));
}
