/**
 * Ayudas para construir la interfaz SIN innerHTML.
 * Todo texto (incluidos los comentarios de clientes que vienen del CSV) se inserta
 * como nodo de texto, así un comentario con "<script>" se muestra tal cual y no se ejecuta.
 */

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

/**
 * el('td', { class: 'num' }, 'texto') crea un elemento.
 * Propiedades especiales: class, dataset, vars (variables CSS), on<Evento> (funciones).
 */
export function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave === 'vars') for (const [nombre, v] of Object.entries(valor)) nodo.style.setProperty(nombre, v);
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    else nodo.setAttribute(clave, valor === true ? '' : String(valor));
  }
  agregarHijos(nodo, hijos);
  return nodo;
}

function agregarHijos(nodo, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

export function vaciar(nodo, ...hijos) {
  nodo.replaceChildren();
  agregarHijos(nodo, hijos);
}

/**
 * Llena una <table> a partir de columnas declarativas.
 * columnas: [{ titulo, num?: boolean, valor: (fila) => Node|string }]
 */
export function llenarTabla(tabla, columnas, filas, { claseFila } = {}) {
  const thead = el('thead', {}, el('tr', {}, columnas.map((c) => el('th', { class: c.num ? 'num' : null, scope: 'col' }, c.titulo))));
  const tbody = el(
    'tbody',
    {},
    filas.map((fila, i) =>
      el('tr', { class: claseFila?.(fila, i) || null }, columnas.map((c) => el('td', { class: [c.num ? 'num' : '', c.clase ?? ''].join(' ').trim() || null }, c.valor(fila, i))))
    )
  );
  tabla.replaceChildren(thead, tbody);
}

/** Etiqueta de estado con punto de color + texto (el color nunca va solo). */
export const estado = (nivel, texto) => el('span', { class: 'estado', dataset: { nivel } }, texto);

let temporizadorAviso = null;
export function mostrarAviso(texto, ms = 2800) {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, ms);
}

export function mostrarError(nodo, mensaje) {
  if (!mensaje) {
    nodo.hidden = true;
    nodo.textContent = '';
    return;
  }
  nodo.textContent = mensaje;
  nodo.hidden = false;
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
