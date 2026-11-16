# Fase 1: Lógica de negocio

Este documento fija las reglas que la aplicación calcula **antes** de llamar a la IA. Todo está implementado en `public/js/core/` y cubierto por pruebas en `tests/`.

| Archivo | Contenido |
|---|---|
| `catalogo.js` | Categorías, niveles de riesgo, umbrales y parámetros RICE (fuente única para las 3 instancias) |
| `clasificador.js` | Clasificador de comentarios corregido |
| `rice.js` | Matriz RICE e ingreso en riesgo |
| `finanzas.js` | Simulador del Módulo 1 |
| `dilema-excel.js` | Réplica del Excel del ramo (oráculo de pruebas) |
| `csv.js` | Lector de CSV y validación de feedback |
| `utilidades.js` | Redondeo, normalización de texto y validaciones |

Los módulos no usan APIs de Node ni del navegador, así que los mismos archivos sirven para el frontend y para los scripts del servidor (carga en MongoDB y PostgreSQL).

## 1. El Excel como oráculo

El Excel `Ejercicio_Sencillo_Decisiones_IA.xlsx` se recalculó con LibreOffice Calc (un motor de cálculo independiente) en 3 casos. `dilema-excel.js` reproduce exactamente los 3 casos, celda por celda (`tests/excel.test.js`).

**Caso base (hoja 1, 12 meses):**

| Opción | Precio | Churn | LTV | LTV/CAC | Clientes mes 12 | Ganancia neta | vs. no hacer nada | ROI |
|---|---|---|---|---|---|---|---|---|
| Situación actual | $250 | 4.5% | $4,444 | 7.4x | 180 | $432,000 | | |
| A: subir precio +10% | $275 | 6.5% | $3,462 | 5.8x | 149 | $435,375 | +$3,375 | |
| B: marketing | $250 | 4.5% | $4,444 | 7.4x | 198 | $470,400 | +$38,400 | 213% |
| C: mejorar producto | $250 | 2.25% | $8,889 | 14.8x | 222 | $472,200 | +$40,200 | 223% |

**Otros casos verificados:**

| Caso | Cambios en celdas amarillas | Ganador | Diferencia C vs B |
|---|---|---|---|
| Churn 6%, presupuesto $25,000, CAC $800 | B9, B12, B13 | C | $20,000 |
| 300 clientes, precio $180, costo $40, 12 orgánicos | B5, B6, B7, B11 | C | $28,560 |

**Lectura crítica para el informe:**
- En el caso base, C gana por solo **$1,800**. Su ventaja real está en los clientes que quedan al mes 12 (222 contra 198), que siguen generando margen después del horizonte.
- El Excel supone que invertir $18,000 en producto baja el churn **a la mitad desde el mes 1**, y que subir el precio sube el churn **2 puntos**. Son supuestos fijos, no calculados.
- El veredicto automático solo compara B contra C (`=SI(E41>D41; C; B)`); nunca considera A.

**Hoja 2 (RICE didáctico del Excel):** ERP 83, Reportes 75, WhatsApp 68, Soporte 13. Usa otra fórmula (`(clientes × 10 + MRR / 100) × impacto × confianza / esfuerzo`) y otros datos de clientes. La app usa la fórmula del pipeline de MongoDB de la guía (sección 4), para que las 3 instancias den lo mismo.

## 2. Catálogo de categorías

| Id | Iniciativa | Esfuerzo (meses) | Costo (USD) | Eficacia relativa |
|---|---|---|---|---|
| `integraciones_erp` | Conector API e Integración ERP/Contable | 2.0 | 14,000 | 1.4 |
| `rendimiento_reportes` | Optimización del Motor de Reportes y Velocidad | 1.5 | 10,500 | 1.2 |
| `alertas_whatsapp` | Módulo Premium de Alertas Automáticas por WhatsApp | 1.2 | 8,500 | 0.9 |
| `soporte_onboarding` | Automatización de Onboarding y SLA de Soporte Rápido | 1.0 | 6,500 | 0.8 |
| `packaging_precio` | Reestructuración de Planes de Entrada y Precios | 0.6 | 4,000 | 0.7 |
| `seguridad_auditoria` | Control de Acceso por Roles y Auditoría de Usuarios | 1.5 | 11,000 | 1.3 |

Las 5 primeras vienen de la guía (esfuerzo y costo de la semilla SQL). **`seguridad_auditoria` es nueva**: su esfuerzo, costo y eficacia son supuestos propios, ajustables en `catalogo.js`.

## 3. Reglas del clasificador

1. El texto se normaliza: minúsculas, sin tildes, espacios simples.
2. Cada palabra clave se compara como **palabra completa** (`erp`, `api`, `sap`), **prefijo** (`reporte*`) o **frase** (`plan basico`). Así se corrigen los falsos positivos de la referencia: `api` en "rápido", `sap` en "WhatsApp", `carga` en "cargar".
3. Gana la categoría con más palabras clave detectadas. **Empate:** gana la que el cliente menciona primero; la otra queda en `categorias_secundarias` (visible en la interfaz, sin sumar dinero dos veces).
4. **Sin coincidencias:** el comentario queda `sin_clasificar` y se informa aparte. Ya no cae por defecto en Reportes.
5. **Riesgo** (en este orden):
   - *Alto Riesgo de Fuga (Churn)*, peso 3.0: "no podremos renovar", "alternativas", "cancelar", "dar de baja", "urgente", o canal de cancelación.
   - *Oportunidad Upsell / Expansión*, peso 2.5: "pagaríamos", "pagaremos", "ampliar", "más licencias", "contrataríamos".
   - *Fricción Operativa*, peso 2.0: el resto.

**Resultado con el dataset de la clase:**

| Cliente | Segmento | MRR | Categoría | Riesgo | Nota |
|---|---|---|---|---|---|
| C-101 | Enterprise | 1,200 | Reportes | Fricción | |
| C-102 | PyME | 250 | Precios | Fricción | ERP como secundaria |
| C-103 | Enterprise | 1,500 | ERP | Fuga | |
| C-104 | Startup | 90 | Precios | Fuga | |
| C-105 | PyME | 300 | Soporte | Fricción | |
| C-106 | Enterprise | 1,800 | Reportes | Fricción | |
| C-107 | PyME | 280 | WhatsApp | Upsell | |
| C-108 | Startup | 95 | Soporte | Fricción | |
| C-109 | Enterprise | 1,400 | **Seguridad** | Fuga | En la referencia caía en Reportes |
| C-110 | PyME | 310 | ERP | Fricción | |
| C-111 | Startup | 85 | Precios | Fuga | Empate con Soporte |
| C-112 | Enterprise | 2,100 | Reportes | Upsell | Empate con WhatsApp |

## 4. Fórmula RICE canónica

Es la del pipeline de MongoDB de la guía, con tres precisiones para que CSV, Atlas y PostgreSQL den exactamente lo mismo:

```
clientes  = clientes DISTINTOS que reclaman en la categoría
ingreso   = suma del MRR de esos clientes (Revenue at Risk)
impacto   = promedio del peso de impacto por cliente, redondeado a 2 decimales
reach     = redondear(clientes × 12 + ingreso / 120)
confianza = mín(95%, 70% + 6% × clientes)
score     = redondear(reach × impacto × confianza / esfuerzo)
```

- **Clientes distintos:** si un cliente reclama varias veces en la misma categoría, cuenta una vez (con su mayor peso). La guía suma cada comentario, lo que infla el alcance y el dinero en riesgo; es el mismo problema de normalización que el Manual Docente plantea para MySQL.
- **Redondeo mitad hacia arriba** (como Excel y `ROUND` de PostgreSQL sobre NUMERIC). En el dataset hay un caso exacto: el reach de Reportes es 78.5 y da 79.
  - MongoDB: `$round` redondea al par (78.5 da 78), así que se usa `$floor: { $add: [x, 0.5] }`.
  - PostgreSQL: usar NUMERIC, nunca `double precision`.
  - PostgreSQL: `confidence_pct / 100` con enteros da 0. Usar `confidence_pct / 100.0`.

**Matriz esperada (debe salir igual en las 3 instancias):**

| # | Iniciativa | Clientes | Ingreso en riesgo | Impacto | Reach | Confianza | Esfuerzo | Score RICE |
|---|---|---|---|---|---|---|---|---|
| 1 | Precios | 3 | $425 | 2.67 | 40 | 88% | 0.6 | **157** |
| 2 | Reportes | 3 | $5,100 | 2.17 | 79 | 88% | 1.5 | **101** |
| 3 | Soporte | 2 | $395 | 2.00 | 27 | 82% | 1.0 | **44** |
| 4 | ERP | 2 | $1,810 | 2.50 | 39 | 82% | 2.0 | **40** |
| 5 | Seguridad | 1 | $1,400 | 3.00 | 24 | 76% | 1.5 | **36** |
| 6 | WhatsApp | 1 | $280 | 2.50 | 14 | 76% | 1.2 | **22** |

Verificada con una segunda implementación independiente en Python con aritmética decimal exacta.

**Lectura crítica:** Precios queda primero con solo $425 en riesgo, porque la fórmula pesa mucho la cantidad de clientes (×12) y Precios tiene el menor esfuerzo (0.6 meses). Ordenado por ingreso en riesgo (desafío 10), el orden es Reportes, ERP, Seguridad, Precios, Soporte, WhatsApp. Esa tensión es justo lo que debe resolver el Comité IA.

**Desafío 9 verificado:** al agregar 3 clientes Enterprise de $2,500 con quejas de seguridad, Seguridad pasa al puesto 1 (4 clientes, $8,900, score 172).

## 5. Modelo del simulador (Módulo 1)

### Fórmulas

| Concepto | Fórmula |
|---|---|
| Precio nuevo | precio × (1 + ajuste) |
| Margen unitario (guía) | precio nuevo − precio base × costo variable % |
| Churn tras el precio | churn base × (1 + elasticidad × ajuste) × (1 + aumento de la brecha sobre la competencia) |
| Captación orgánica tras el precio | orgánicos × (1 − elasticidad × ajuste) |
| Reducción de churn por producto | mín(60%, eficacia × K × ln(1 + inversión / 6.000)) |
| Churn híbrido | churn tras el precio × (1 − reducción) |
| CAC efectivo | CAC × (1 + aumento de la brecha) |
| Clientes por marketing | inversión en adquisición / CAC efectivo, repartidos en 6 meses |
| Clientes mes m | clientes(m−1) × (1 − churn) + orgánicos + adquiridos(m) |
| Utilidad mes m | clientes(m) × margen − costos fijos |
| LTV (guía) | margen unitario / churn |
| Semáforo LTV/CAC (guía) | ≥ 3.0x óptimo; 1.8x a 2.9x ajustado; < 1.8x riesgo |
| Beneficio incremental | Σ (utilidad del camino − utilidad status quo) − inversión |
| ROI | beneficio incremental / inversión |
| Payback | mes en que el beneficio acumulado cubre la inversión (interpolado) |

**K está calibrada con el Excel:** invertir $18,000 en producto reduce el churn exactamente a la mitad. Con esa calibración, el camino "100% Retención" reproduce la Opción C del Excel con 0.15% de diferencia (`tests/excel.test.js`). Con la mitad del dinero ($9,000) se logra 33% de reducción: rendimientos decrecientes.

**Solo se penaliza el aumento de la brecha** frente a la competencia: el churn actual ya refleja el precio actual.

### Las 4 curvas

| Camino | Precio | Inversión |
|---|---|---|
| Status Quo | base | ninguna |
| Solo cambio de precio | nuevo | ninguna |
| 100% Retención/Producto | base | todo el presupuesto en producto |
| Estrategia híbrida | nuevo | presupuesto repartido entre retención y adquisición |

### Escenarios

No son multiplicadores del resultado (como en la referencia): se vuelve a simular con supuestos distintos.

| Escenario | Eficacia del producto | Elasticidad | CAC |
|---|---|---|---|
| Pesimista | ×0.6 | más dañina (×1.5 si se sube el precio, ×0.6 si se baja) | ×1.25 |
| Base | ×1 | ×1 | ×1 |
| Optimista | ×1.25 | más favorable | ×0.85 |

### Supuestos (ajustables en `SUPUESTOS_POR_DEFECTO`)

| Supuesto | Valor | Origen |
|---|---|---|
| Elasticidad precio | 0.8 | Preset SaaS de la referencia |
| Tope de reducción de churn | 60% | Propio |
| Escala de rendimientos decrecientes | $6,000 | Propio |
| Calibración: $18,000 bajan el churn a la mitad | 50% | Excel |
| Meses de adquisición | 6 | Referencia |
| Churn mínimo y máximo | 0.3% y 50% | Propio |

### Resultado con el caso de la clase

Entradas: 180 clientes, precio $250, competencia $275, costo variable 20%, costos fijos $24,000, CAC $600, churn 4.5%, ajuste +10%, presupuesto $18,000 (65% retención), 8 orgánicos.

| Camino | Churn | Clientes mes 12 | Beneficio incremental | ROI | Payback |
|---|---|---|---|---|---|
| Status Quo | 4.50% | 179.1 | | | |
| Solo cambio de precio | 4.86% | 167.1 | $34,827 | | |
| 100% Retención | 2.25% | 222.0 | $40,140 | 223% | 6.3 meses |
| Híbrida | 2.96% | 208.8 | $89,019 | 495% | 2.9 meses |

LTV $7,592, LTV/CAC 12.7x (óptimo), escenarios: pesimista $53,934, base $89,019, optimista $113,658.

**Diferencia con el Excel:** en el Excel, subir el precio aumenta el churn 2 puntos fijos. Aquí lo aumenta solo de 4.5% a 4.86%, porque el precio nuevo ($275) iguala al de la competencia. Si la competencia cobrara menos, la penalización por brecha haría que subir el precio fuera mucho peor. Conviene mostrar esa sensibilidad en la presentación.

## 6. Evidencia: prompt de la hoja 3 en Gemini

Archivos: `docs/evidencias/fase1-prompt-gemini.png` y `docs/evidencias/fase1-veredicto-gemini.txt`.

**Qué hizo bien la IA:** copió correctamente las cifras que recibió (ganancias netas de A, B y C, ROI de 213% y 223%, RICE de ERP 83 y Reportes 75) y armó un plan de 90 días coherente con ellas.

**Qué salió mal, y no por culpa de la IA:**
- La respuesta habla de un **churn actual del 5%**, pero el dato real es 4.5%. El error viene del Excel: la fórmula del prompt usa `TEXTO(B9;"0.0%")`, y en un Excel configurado en español el punto del formato se interpreta como separador de miles, así que el 4.5% llega redondeado a "5%". En la captura también se ve que los montos llegan como "$470400,0".
- La IA no cuestionó que C gana por solo $1,800, ni el supuesto de que el churn baja a la mitad desde el mes 1: los tomó como hechos.
- La IA no vio la tensión entre RICE e ingreso en riesgo porque el Excel solo le entregó las 2 primeras iniciativas.

**Conclusión para el informe:** la calidad del dictamen depende de que las cifras lleguen exactas y completas. Por eso la app arma el JSON por código (`comite.js`), con números sin formato regional, la matriz RICE completa, los escenarios y los diagnósticos del motor de reglas, y le exige a la IA citar el campo de cada cifra que use.
