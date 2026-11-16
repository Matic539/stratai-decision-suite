/**
 * Catálogo de reglas de negocio: categorías (iniciativas del roadmap), niveles de riesgo
 * y umbrales. Es la única fuente de verdad para las 3 instancias (CSV, MongoDB y PostgreSQL).
 *
 * Palabras clave (se comparan sin tildes y en minúsculas):
 *   'erp'          palabra completa (no coincide dentro de otra palabra)
 *   'reporte*'     palabra que empieza así (reporte, reportes)
 *   'plan basico'  frase completa
 */

export const SEGMENTOS = Object.freeze(['Enterprise', 'PyME', 'Startup']);

export const CATEGORIAS = Object.freeze([
  Object.freeze({
    id: 'integraciones_erp',
    titulo: 'Conector API e Integración ERP/Contable',
    tituloCorto: 'Integración ERP',
    palabrasClave: Object.freeze(['erp', 'integracion*', 'integrar*', 'api', 'apis', 'contable*', 'contabilidad', 'sap', 'oracle', 'sincroniz*', 'facturacion automatica']),
    esfuerzoMeses: 2.0,
    costoUSD: 14000,
    eficaciaRelativa: 1.4,
  }),
  Object.freeze({
    id: 'rendimiento_reportes',
    titulo: 'Optimización del Motor de Reportes y Velocidad',
    tituloCorto: 'Reportes y velocidad',
    palabrasClave: Object.freeze(['lent*', 'velocidad', 'exportar', 'exportacion*', 'reporte*', 'falla*', 'horas esperando', 'demora*']),
    esfuerzoMeses: 1.5,
    costoUSD: 10500,
    eficaciaRelativa: 1.2,
  }),
  Object.freeze({
    id: 'alertas_whatsapp',
    titulo: 'Módulo Premium de Alertas Automáticas por WhatsApp',
    tituloCorto: 'Alertas WhatsApp',
    palabrasClave: Object.freeze(['whatsapp', 'alerta*', 'notificacion*', 'tiempo real']),
    esfuerzoMeses: 1.2,
    costoUSD: 8500,
    eficaciaRelativa: 0.9,
  }),
  Object.freeze({
    id: 'soporte_onboarding',
    titulo: 'Automatización de Onboarding y SLA de Soporte Rápido',
    tituloCorto: 'Soporte y onboarding',
    palabrasClave: Object.freeze(['soporte', '24 horas', '12 horas', 'confus*', 'onboarding', 'plantilla*', 'configuracion inicial', 'capacitacion']),
    esfuerzoMeses: 1.0,
    costoUSD: 6500,
    eficaciaRelativa: 0.8,
  }),
  Object.freeze({
    id: 'packaging_precio',
    titulo: 'Reestructuración de Planes de Entrada y Precios',
    tituloCorto: 'Planes y precios',
    palabrasClave: Object.freeze(['precio*', 'caro*', 'costoso*', 'competencia', 'economic*', 'plan basico', 'plan inicial']),
    esfuerzoMeses: 0.6,
    costoUSD: 4000,
    eficaciaRelativa: 0.7,
  }),
  Object.freeze({
    // Categoría nueva (no existe en la app de referencia). Esfuerzo, costo y eficacia son supuestos propios.
    id: 'seguridad_auditoria',
    titulo: 'Control de Acceso por Roles y Auditoría de Usuarios',
    tituloCorto: 'Seguridad y auditoría',
    palabrasClave: Object.freeze(['seguridad', 'permiso*', 'rol', 'roles', 'auditoria*', 'normativa*', 'cumplimiento', 'trazabilidad', 'privacidad', 'acceso*']),
    esfuerzoMeses: 1.5,
    costoUSD: 11000,
    eficaciaRelativa: 1.3,
    supuestoPropio: true,
  }),
]);

/** Comentarios sin coincidencias: no se fuerzan a una categoría, quedan para revisión manual. */
export const SIN_CLASIFICAR = Object.freeze({
  id: 'sin_clasificar',
  titulo: 'Sin clasificar (revisión manual)',
  tituloCorto: 'Sin clasificar',
  esfuerzoMeses: null,
  costoUSD: null,
  eficaciaRelativa: 0,
});

export const RIESGOS = Object.freeze({
  churn: Object.freeze({
    id: 'churn',
    etiqueta: 'Alto Riesgo de Fuga (Churn)',
    pesoImpacto: 3.0,
    senales: Object.freeze(['no podremos renovar', 'no renovar*', 'alternativa*', 'cancelar*', 'dar de baja', 'urgente']),
    canales: Object.freeze(['cancel*']),
  }),
  upsell: Object.freeze({
    id: 'upsell',
    etiqueta: 'Oportunidad Upsell / Expansión',
    pesoImpacto: 2.5,
    senales: Object.freeze(['pagariamos', 'pagaremos', 'ampliar*', 'mas licencias', 'contratariamos']),
    canales: Object.freeze([]),
  }),
  friccion: Object.freeze({
    id: 'friccion',
    etiqueta: 'Fricción Operativa',
    pesoImpacto: 2.0,
    senales: Object.freeze([]),
    canales: Object.freeze([]),
  }),
});

/** Semáforo de salud unitaria LTV/CAC (Manual Docente). */
export const UMBRALES_LTV_CAC = Object.freeze({ optimo: 3.0, ajustado: 1.8 });

/** Parámetros de la fórmula RICE canónica (pipeline de MongoDB de la guía). */
export const PARAMETROS_RICE = Object.freeze({
  reachPorCliente: 12,
  divisorIngreso: 120,
  confianzaBasePct: 70,
  confianzaPorClientePct: 6,
  confianzaMaxPct: 95,
  decimalesImpacto: 2,
});

export function buscarCategoria(id) {
  return CATEGORIAS.find((c) => c.id === id) ?? null;
}
