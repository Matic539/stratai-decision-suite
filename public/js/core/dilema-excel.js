/**
 * Réplica exacta de la hoja "1_Dilema_del_Gerente" del Excel del ramo.
 * Sirve como oráculo: las pruebas comparan este cálculo con el Excel recalculado en LibreOffice.
 * Usa los mismos bloques del simulador (proyectarClientes, redondear) para validarlos.
 */
import { redondear, sumar } from './utilidades.js';
import { proyectarClientes } from './finanzas.js';

export const DILEMA_EXCEL = Object.freeze({
  clientes: 180,
  precio: 250,
  costoOperativo: 50,
  churn: 0.045,
  organicosMes: 8,
  presupuesto: 18000,
  cac: 600,
  factorPrecio: 1.1, // Opción A: +10%
  alzaChurnPorPrecio: 0.02, // Opción A: +2 puntos de churn
  factorChurnProducto: 0.5, // Opción C: churn a la mitad
  meses: 12,
});

export function simularDilemaExcel(parametros = {}) {
  const p = { ...DILEMA_EXCEL, ...parametros };
  const definiciones = {
    actual: { etiqueta: 'Situación actual', precio: p.precio, extra: 0, churn: p.churn, inversion: 0 },
    A: { etiqueta: 'Subir precio +10%', precio: redondear(p.precio * p.factorPrecio), extra: 0, churn: p.churn + p.alzaChurnPorPrecio, inversion: 0 },
    B: { etiqueta: 'Marketing', precio: p.precio, extra: redondear(p.presupuesto / p.cac), churn: p.churn, inversion: p.presupuesto },
    C: { etiqueta: 'Mejorar el producto', precio: p.precio, extra: 0, churn: p.churn * p.factorChurnProducto, inversion: p.presupuesto },
  };

  const opciones = {};
  for (const [id, d] of Object.entries(definiciones)) {
    const ganancia = d.precio - p.costoOperativo;
    const ltv = redondear(ganancia / d.churn);
    const clientesPorMes = proyectarClientes({
      inicial: p.clientes,
      extraInicial: d.extra,
      churn: d.churn,
      organicos: p.organicosMes,
      meses: p.meses,
      redondearMensual: true,
    });
    const gananciaOperativa = sumar(clientesPorMes) * ganancia;
    opciones[id] = {
      etiqueta: d.etiqueta,
      precio: d.precio,
      gananciaPorCliente: ganancia,
      clientesExtra: d.extra,
      churn: d.churn,
      ltv,
      ratioLtvCac: redondear(ltv / p.cac, 1),
      clientesPorMes,
      gananciaOperativa,
      inversion: d.inversion,
      gananciaNeta: gananciaOperativa - d.inversion,
    };
  }
  for (const o of Object.values(opciones)) {
    o.diferenciaVsActual = o.gananciaNeta - opciones.actual.gananciaNeta;
    o.roi = o.inversion > 0 ? o.diferenciaVsActual / o.inversion : null;
  }

  // El veredicto del Excel solo compara B contra C (=SI(E41>D41; C; B)).
  const ganadorVeredicto = opciones.C.gananciaNeta > opciones.B.gananciaNeta ? 'C' : 'B';
  const ganadorGeneral = Object.entries(opciones).sort((a, b) => b[1].gananciaNeta - a[1].gananciaNeta)[0][0];
  return { parametros: p, opciones, ganadorVeredicto, ganadorGeneral };
}
