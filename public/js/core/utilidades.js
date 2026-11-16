/**
 * Utilidades compartidas por el navegador y por Node.
 * Este archivo no usa APIs de Node ni del DOM: debe funcionar en ambos.
 */

/**
 * Redondeo "mitad hacia afuera" (como ROUND de Excel y de PostgreSQL NUMERIC).
 * Usa notación exponencial para evitar errores de representación (1.005 -> 1.01).
 */
export function redondear(valor, decimales = 0) {
  if (!Number.isFinite(valor)) return valor;
  const signo = valor < 0 ? -1 : 1;
  const absoluto = Math.abs(valor);
  if (absoluto >= 1e15) return signo * Math.round(absoluto);
  const escalado = Number(`${absoluto}e${decimales}`);
  return signo * Number(`${Math.round(escalado)}e-${decimales}`);
}

/** Minúsculas, sin tildes ni diéresis y con espacios simples. "Integración  ERP" -> "integracion erp". */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const FORMATO_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const FORMATO_NUMERO = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** 18000 -> "$18,000" (mismo formato que el material del ramo). */
export const formatoUSD = (valor) => (Number.isFinite(valor) ? FORMATO_USD.format(valor) : 'N/D');

/** 4.5 -> "4.5%". */
export const formatoPct = (valor, decimales = 1) =>
  Number.isFinite(valor) ? `${FORMATO_NUMERO.format(redondear(valor, decimales))}%` : 'N/D';

export const formatoNumero = (valor, decimales = 1) =>
  Number.isFinite(valor) ? FORMATO_NUMERO.format(redondear(valor, decimales)) : 'N/D';

export const sumar = (valores) => valores.reduce((acc, v) => acc + v, 0);

export function promedio(valores) {
  return valores.length ? sumar(valores) / valores.length : 0;
}

/** Valida que un valor sea un número finito dentro de un rango. Lanza RangeError con un mensaje claro. */
export function exigirNumero(valor, nombre, { min = -Infinity, max = Infinity } = {}) {
  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (typeof numero !== 'number' || !Number.isFinite(numero)) {
    throw new RangeError(`"${nombre}" debe ser un número (recibido: ${JSON.stringify(valor)}).`);
  }
  if (numero < min || numero > max) {
    throw new RangeError(`"${nombre}" debe estar entre ${min} y ${max} (recibido: ${numero}).`);
  }
  return numero;
}
