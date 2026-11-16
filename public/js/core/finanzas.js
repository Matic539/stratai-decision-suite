/**
 * Módulo 1: simulador financiero de pricing e inversión (lógica determinista).
 *
 * Todo se calcula aquí, antes de invocar a la IA. Los parámetros del modelo están
 * nombrados en SUPUESTOS_POR_DEFECTO para poder explicarlos y ajustarlos.
 */
import { redondear, sumar, exigirNumero } from './utilidades.js';
import { UMBRALES_LTV_CAC } from './catalogo.js';

// --------------------------------------------------------------------------
// Supuestos del modelo
// --------------------------------------------------------------------------
export const SUPUESTOS_POR_DEFECTO = Object.freeze({
  /** Sensibilidad del churn y de la captación orgánica ante cambios de precio. */
  elasticidadPrecio: 0.8,
  /** Tope: la inversión en producto no elimina más del 60% del churn. */
  reduccionMaxChurn: 0.6,
  /** Escala de los rendimientos decrecientes de la inversión en producto (USD). */
  escalaInversionUSD: 6000,
  /** Calibración con el Excel: invertir 18.000 USD en producto reduce el churn a la mitad. */
  inversionCalibracionUSD: 18000,
  reduccionCalibracion: 0.5,
  /** Multiplicador de eficacia (1 = promedio; las iniciativas RICE traen su eficacia relativa). */
  eficaciaProducto: 1.0,
  /** Meses en que se reparten los clientes comprados con marketing. */
  mesesAdquisicion: 6,
  churnMinimoPct: 0.3,
  churnMaximoPct: 50,
  horizonteMeses: 12,
});

/** Escenarios: se vuelve a simular con supuestos más duros o más favorables (no son multiplicadores del resultado). */
export const ESCENARIOS = Object.freeze({
  pesimista: Object.freeze({ eficacia: 0.6, elasticidadAlza: 1.5, elasticidadBaja: 0.6, cac: 1.25 }),
  base: Object.freeze({ eficacia: 1, elasticidadAlza: 1, elasticidadBaja: 1, cac: 1 }),
  optimista: Object.freeze({ eficacia: 1.25, elasticidadAlza: 0.6, elasticidadBaja: 1.25, cac: 0.85 }),
});

/** Caso de la clase (mismos números del Excel, más los datos que pide la guía). */
export const ENTRADAS_EJEMPLO = Object.freeze({
  clientes: 180,
  precio: 250,
  precioCompetencia: 275,
  costoVariablePct: 20, // 50 USD de 250: mismo margen que el Excel
  costosFijosMes: 24000,
  cac: 600,
  churnMensualPct: 4.5,
  ajustePrecioPct: 10,
  presupuesto: 18000,
  pctRetencion: 65,
  nuevosOrganicosMes: 8,
});

export const ETIQUETAS_CAMINOS = Object.freeze({
  statusQuo: 'Status Quo',
  soloPrecio: 'Solo cambio de precio',
  soloRetencion: '100% Retención/Producto',
  hibrida: 'Estrategia híbrida simulada',
});

// --------------------------------------------------------------------------
// Bloques básicos (también los usa la réplica del Excel)
// --------------------------------------------------------------------------

/** Margen Unitario = Precio Nuevo - (Precio Base × Costo Variable %). El costo no cambia al cambiar el precio. */
export const margenUnitario = (precioNuevo, precioBase, costoVariableFraccion) =>
  precioNuevo - precioBase * costoVariableFraccion;

/** LTV = Margen Unitario / Churn mensual. */
export function calcularLTV(margen, churnFraccion) {
  if (!(churnFraccion > 0)) throw new RangeError('El churn debe ser mayor que 0 para calcular el LTV.');
  return margen / churnFraccion;
}

export function semaforoLtvCac(ratio) {
  if (ratio >= UMBRALES_LTV_CAC.optimo) return { nivel: 'optimo', etiqueta: 'Óptimo (≥ 3.0x)', color: 'verde' };
  if (ratio >= UMBRALES_LTV_CAC.ajustado) return { nivel: 'ajustado', etiqueta: 'Ajustado (1.8x a 2.9x)', color: 'amarillo' };
  return { nivel: 'riesgo', etiqueta: 'Riesgo (< 1.8x)', color: 'rojo' };
}

/**
 * Clientes activos mes a mes: clientes(m) = clientes(m-1) × (1 - churn) + orgánicos + extra(m).
 * extraInicial se suma antes del primer mes (como el Excel); extraPorMes(m) se suma en cada mes.
 */
export function proyectarClientes({
  inicial,
  churn,
  organicos,
  meses,
  extraInicial = 0,
  extraPorMes = () => 0,
  redondearMensual = false,
}) {
  const serie = [];
  let clientes = inicial + extraInicial;
  for (let m = 1; m <= meses; m++) {
    clientes = clientes * (1 - churn) + organicos + extraPorMes(m);
    if (redondearMensual) clientes = redondear(clientes);
    serie.push(clientes);
  }
  return serie;
}

/**
 * Reducción del churn por inversión en producto, con rendimientos decrecientes:
 *   factor = mín(tope, eficacia × K × ln(1 + inversión / escala))
 * K se calibra para que la inversión de calibración logre la reducción de calibración.
 */
export function factorReduccionChurn(inversionUSD, supuestos = SUPUESTOS_POR_DEFECTO, eficacia = supuestos.eficaciaProducto) {
  if (!(inversionUSD > 0)) return 0;
  const s = supuestos;
  const k = s.reduccionCalibracion / Math.log1p(s.inversionCalibracionUSD / s.escalaInversionUSD);
  return Math.min(s.reduccionMaxChurn, eficacia * k * Math.log1p(inversionUSD / s.escalaInversionUSD));
}

/** Brecha positiva frente a la competencia (0 si somos más baratos). */
export const brechaCompetencia = (precio, precioCompetencia) =>
  Math.max(0, (precio - precioCompetencia) / precioCompetencia);

/**
 * Churn después de cambiar el precio:
 *   efecto directo:         × (1 + elasticidad × ajuste)
 *   penalización por brecha: × (1 + aumento de la brecha sobre la competencia)
 * Solo se penaliza el aumento de la brecha: el churn base ya refleja la brecha actual.
 */
export function churnTrasPrecio(churnBase, ajusteFraccion, precioBase, precioCompetencia, elasticidad) {
  const precioNuevo = precioBase * (1 + ajusteFraccion);
  const efectoDirecto = Math.max(0, 1 + elasticidad * ajusteFraccion);
  const aumentoBrecha = Math.max(
    0,
    brechaCompetencia(precioNuevo, precioCompetencia) - brechaCompetencia(precioBase, precioCompetencia)
  );
  return churnBase * efectoDirecto * (1 + aumentoBrecha);
}

/** Meses para recuperar la inversión (interpolado dentro del mes). null si no se recupera en el horizonte. */
export function calcularPayback(beneficiosIncrementalesMensuales, inversion) {
  if (!(inversion > 0)) return null;
  let acumulado = -inversion;
  for (let i = 0; i < beneficiosIncrementalesMensuales.length; i++) {
    const delta = beneficiosIncrementalesMensuales[i];
    const previo = acumulado;
    acumulado += delta;
    if (acumulado >= 0 && delta > 0) return redondear(i + -previo / delta, 1);
  }
  return null;
}

/** Porcentaje del costo de una iniciativa que se asigna a retención al usar "Simular ROI" (como la referencia). */
export const PCT_RETENCION_INICIATIVA = 80;

/**
 * "Simular ROI" desde la matriz RICE: el costo de la iniciativa pasa a ser el presupuesto
 * y su eficacia relativa ajusta cuánto reduce el churn.
 */
export function parametrosDesdeIniciativa(filaRice) {
  return {
    entradas: { presupuesto: filaRice.costo_estimado_usd, pctRetencion: PCT_RETENCION_INICIATIVA },
    supuestos: { eficaciaProducto: filaRice.eficacia_relativa },
  };
}

// --------------------------------------------------------------------------
// Validación de entradas
// --------------------------------------------------------------------------
export const RANGOS_ENTRADAS = Object.freeze({
  clientes: { min: 1, max: 1_000_000 },
  precio: { min: 1, max: 1_000_000 },
  precioCompetencia: { min: 1, max: 1_000_000 },
  costoVariablePct: { min: 0, max: 95 },
  costosFijosMes: { min: 0, max: 100_000_000 },
  cac: { min: 1, max: 1_000_000 },
  churnMensualPct: { min: 0.5, max: 50 },
  ajustePrecioPct: { min: -25, max: 40 },
  presupuesto: { min: 0, max: 100_000_000 },
  pctRetencion: { min: 0, max: 100 },
  nuevosOrganicosMes: { min: 0, max: 1_000_000 },
});

export function validarEntradas(entradas) {
  const resultado = {};
  for (const [campo, rango] of Object.entries(RANGOS_ENTRADAS)) {
    if (campo === 'nuevosOrganicosMes' && (entradas[campo] === undefined || entradas[campo] === '')) continue;
    resultado[campo] = exigirNumero(entradas[campo], campo, rango);
  }
  // Si no se indica, se asume captación orgánica que mantiene estable la base actual.
  resultado.nuevosOrganicosMes ??= redondear((resultado.clientes * resultado.churnMensualPct) / 100);
  return resultado;
}

// --------------------------------------------------------------------------
// Simulación de los 4 caminos estratégicos
// --------------------------------------------------------------------------
function proyectarCamino(e, s, camino) {
  const clientes = proyectarClientes({
    inicial: e.clientes,
    churn: camino.churn,
    organicos: camino.organicos,
    meses: s.horizonteMeses,
    extraPorMes: (m) => (m <= s.mesesAdquisicion ? camino.adquiridos / s.mesesAdquisicion : 0),
  });
  const utilidadMensual = clientes.map((c) => c * camino.margen - e.costosFijosMes);
  return { ...camino, clientes, utilidadMensual };
}

function calcularCaminos(e, s, escenario) {
  const churnBase = e.churnMensualPct / 100;
  const costoVariable = e.costoVariablePct / 100;
  const ajuste = e.ajustePrecioPct / 100;
  const elasticidad = s.elasticidadPrecio * (ajuste >= 0 ? escenario.elasticidadAlza : escenario.elasticidadBaja);
  const eficacia = s.eficaciaProducto * escenario.eficacia;
  const limitar = (c) => Math.min(s.churnMaximoPct / 100, Math.max(s.churnMinimoPct / 100, c));

  const precioNuevo = e.precio * (1 + ajuste);
  const margenBase = margenUnitario(e.precio, e.precio, costoVariable);
  const margenNuevo = margenUnitario(precioNuevo, e.precio, costoVariable);
  const churnPrecio = limitar(churnTrasPrecio(churnBase, ajuste, e.precio, e.precioCompetencia, elasticidad));
  const organicosPrecio = e.nuevosOrganicosMes * Math.max(0, 1 - elasticidad * ajuste);

  const inversionRetencion = (e.presupuesto * e.pctRetencion) / 100;
  const inversionAdquisicion = e.presupuesto - inversionRetencion;
  const aumentoBrecha = Math.max(
    0,
    brechaCompetencia(precioNuevo, e.precioCompetencia) - brechaCompetencia(e.precio, e.precioCompetencia)
  );
  const cacEfectivo = e.cac * escenario.cac * (1 + aumentoBrecha);
  const factorHibrida = factorReduccionChurn(inversionRetencion, s, eficacia);
  const factorTotal = factorReduccionChurn(e.presupuesto, s, eficacia);

  const caminos = {
    statusQuo: { precio: e.precio, margen: margenBase, churn: limitar(churnBase), organicos: e.nuevosOrganicosMes, inversion: 0, adquiridos: 0 },
    soloPrecio: { precio: precioNuevo, margen: margenNuevo, churn: churnPrecio, organicos: organicosPrecio, inversion: 0, adquiridos: 0 },
    soloRetencion: { precio: e.precio, margen: margenBase, churn: limitar(churnBase * (1 - factorTotal)), organicos: e.nuevosOrganicosMes, inversion: e.presupuesto, adquiridos: 0 },
    hibrida: { precio: precioNuevo, margen: margenNuevo, churn: limitar(churnPrecio * (1 - factorHibrida)), organicos: organicosPrecio, inversion: e.presupuesto, adquiridos: inversionAdquisicion / cacEfectivo },
  };

  const proyectados = Object.fromEntries(Object.entries(caminos).map(([id, c]) => [id, proyectarCamino(e, s, c)]));
  const base = proyectados.statusQuo.utilidadMensual;
  for (const camino of Object.values(proyectados)) {
    const deltas = camino.utilidadMensual.map((u, i) => u - base[i]);
    camino.utilidadAcumulada = sumar(camino.utilidadMensual);
    camino.beneficioIncremental = sumar(deltas) - camino.inversion;
    camino.roi = camino.inversion > 0 ? camino.beneficioIncremental / camino.inversion : null;
    camino.paybackMeses = calcularPayback(deltas, camino.inversion);
  }
  return { proyectados, precioNuevo, margenNuevo, cacEfectivo, inversionRetencion, inversionAdquisicion, factorHibrida };
}

/**
 * Simula la estrategia y devuelve todo lo que necesitan la interfaz y el Comité IA.
 * Los montos se entregan redondeados; las series conservan 1 decimal (clientes) o enteros (USD).
 */
/** Supuestos que el usuario puede editar desde la interfaz. */
export const RANGOS_SUPUESTOS = Object.freeze({
  elasticidadPrecio: { min: 0, max: 3 },
  eficaciaProducto: { min: 0, max: 3 },
  mesesAdquisicion: { min: 1, max: 12 },
});

export function validarSupuestos(supuestos = {}) {
  const resultado = { ...supuestos };
  for (const [campo, rango] of Object.entries(RANGOS_SUPUESTOS)) {
    if (supuestos[campo] === undefined) continue;
    resultado[campo] = exigirNumero(supuestos[campo], campo, rango);
  }
  if (resultado.mesesAdquisicion !== undefined) resultado.mesesAdquisicion = Math.round(resultado.mesesAdquisicion);
  return resultado;
}

export function simularEstrategia(entradas, supuestos = {}) {
  const e = validarEntradas(entradas);
  const s = Object.freeze({ ...SUPUESTOS_POR_DEFECTO, ...validarSupuestos(supuestos) });
  const r = calcularCaminos(e, s, ESCENARIOS.base);
  const h = r.proyectados.hibrida;

  const ltv = calcularLTV(r.margenNuevo, h.churn);
  const ratio = ltv / r.cacEfectivo;
  const clientesMes12 = h.clientes[h.clientes.length - 1];

  const caminos = Object.fromEntries(
    Object.entries(r.proyectados).map(([id, c]) => [
      id,
      {
        etiqueta: ETIQUETAS_CAMINOS[id],
        precio: redondear(c.precio, 2),
        margenUnitario: redondear(c.margen, 2),
        churnMensualPct: redondear(c.churn * 100, 2),
        inversion: redondear(c.inversion),
        clientesAdquiridos: redondear(c.adquiridos, 1),
        clientes: c.clientes.map((x) => redondear(x, 1)),
        utilidadMensual: c.utilidadMensual.map((x) => redondear(x)),
        utilidadAcumulada: redondear(c.utilidadAcumulada),
        beneficioIncremental: redondear(c.beneficioIncremental),
        roiPct: c.roi === null ? null : redondear(c.roi * 100, 1),
        paybackMeses: c.paybackMeses,
      },
    ])
  );

  const escenarios = Object.fromEntries(
    Object.entries(ESCENARIOS).map(([id, esc]) => {
      const res = id === 'base' ? r : calcularCaminos(e, s, esc);
      return [id, redondear(res.proyectados.hibrida.beneficioIncremental)];
    })
  );

  return {
    entradas: e,
    supuestos: s,
    caminos,
    kpis: {
      precioNuevo: redondear(r.precioNuevo, 2),
      margenUnitario: redondear(r.margenNuevo, 2),
      churnBasePct: e.churnMensualPct,
      churnProyectadoPct: redondear(h.churn * 100, 2),
      reduccionChurnPorProductoPct: redondear(r.factorHibrida * 100, 1),
      ltv: redondear(ltv),
      cacEfectivo: redondear(r.cacEfectivo, 2),
      ratioLtvCac: redondear(ratio, 1),
      semaforo: semaforoLtvCac(ratio),
      inversionRetencion: redondear(r.inversionRetencion),
      inversionAdquisicion: redondear(r.inversionAdquisicion),
      clientesAdquiridos: redondear(h.adquiridos, 1),
      clientesMes12: redondear(clientesMes12, 1),
      mrrBase: redondear(e.clientes * e.precio),
      mrrMes12: redondear(clientesMes12 * r.precioNuevo),
      beneficioNetoIncremental12m: redondear(h.beneficioIncremental),
      roi12mPct: h.roi === null ? null : redondear(h.roi * 100, 1),
      paybackMeses: h.paybackMeses,
      puntoEquilibrioClientes: r.margenNuevo > 0 ? Math.ceil(e.costosFijosMes / r.margenNuevo) : null,
    },
    escenarios,
  };
}
