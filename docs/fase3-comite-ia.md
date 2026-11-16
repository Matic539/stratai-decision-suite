# Fase 3: Servidor Express y Comité IA

El Comité Directivo de IA (CFO, CMO y COO) recibe un JSON con cifras ya calculadas y devuelve un dictamen estructurado. La IA no calcula nada: interpreta.

## Flujo

1. El navegador envía a `POST /api/comite` solo las **entradas** del simulador, los **supuestos**, el criterio de orden, la iniciativa conectada y los **registros** de feedback.
2. El servidor **recalcula todo** con los mismos módulos de `public/js/core/` (simulación, diagnósticos, clasificación y RICE) y arma el JSON. Si el navegador manda cifras propias, se ignoran.
3. El servidor consulta a OpenRouter con un **JSON Schema** (structured outputs) y valida la respuesta.
4. El **verificador de cifras** revisa que cada número del dictamen exista en el JSON.
5. Si OpenRouter no está configurado, falla o responde con formato inválido, contesta el **dictamen local** (reglas deterministas) y la interfaz muestra el motivo.

## Rutas del servidor

| Ruta | Descripción |
|---|---|
| `GET /api/health` | Estado, instancia activa y proveedor de IA (sin secretos) |
| `GET /api/feedback` | Comentarios de clientes de la instancia activa (en CSV: `data/datos_ejemplo.csv`, validado con el mismo lector del navegador) |
| `POST /api/comite` | Recalcula y devuelve el dictamen, la verificación de cifras y el JSON usado |

## Archivos

| Archivo | Rol |
|---|---|
| `src/app.js` | Construcción de la app Express (separada de `server.js` para poder probarla) |
| `src/ia/openrouter.js` | Cliente de OpenRouter: modelos en orden, reintento sin esquema, tiempo límite y errores claros |
| `src/servicios/comite.js` | Valida la solicitud, recalcula, consulta a la IA o al motor local |
| `src/servidor/limitador.js` | Límite de consultas por minuto |
| `src/datos/fuente-csv.js` | Instancia 1 del lado del servidor |
| `public/js/core/comite.js` | JSON, prompt, JSON Schema, extracción y validación de la respuesta |
| `public/js/core/dictamen-local.js` | Dictamen por reglas (respaldo) |
| `public/js/core/verificacion.js` | Verificador de cifras |

## Configuración (`.env`)

```
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free,openrouter/free
```

- `OPENROUTER_MODEL` acepta varios modelos separados por coma; se prueban en orden. `openrouter/free` es el router gratuito de OpenRouter y sirve de respaldo.
- Los modelos gratuitos tienen un límite de **20 consultas por minuto y 50 por día** (1.000 por día si la cuenta compró al menos 10 créditos).
- **Los modelos gratuitos cambian sin aviso.** `nex-agi/nex-n2.5-mini:free` funcionaba el 11 de noviembre y el 12 OpenRouter respondió que dejó de ser gratuito (detectado con `npm run diagnostico:ia`). Por eso la configuración lleva un modelo de respaldo y la app tiene dictamen local: es el riesgo de dependencia de proveedor y de costos de inferencia que plantea el AI Business Model Canvas del ramo.
- `IA_LIMITE_POR_MINUTO` (por defecto 10) y `IA_TIMEOUT_MS` (por defecto 90000 por intento) protegen la cuota y acotan la espera.
- Cada modelo se prueba primero **con esquema** (JSON Schema) y, si el proveedor no lo soporta, responde vacío o responde con un formato inválido, en **formato simple**. La validación es la misma en ambos casos.
- **Modelos que razonan:** se pide razonamiento de esfuerzo bajo y se reservan 12.000 tokens de salida. Con 4.000, `nvidia/nemotron-3.5-lightning:free` gastaba todo razonando y terminaba con `finish_reason: length` y respuesta vacía (prueba real del 12 de noviembre). Si el proveedor rechaza parámetros, el reintento va sin ninguno opcional.
- **JSON compacto hacia la IA:** el prompt baja de unos 11.000 a 6.900 caracteres (menos tokens y menos latencia). En la pestaña 3 se muestra con sangría para leerlo.
- **Lenguaje de negocio (ajuste del 16 de noviembre):** la primera versión de la regla 2 pedía "menciona de qué campo sale cada cifra". El dictamen real (nemotron-3.5-super-vl, 49 de 49 cifras verificadas) cumplió, pero usó los campos como sustantivos: "roi_12m_pct de 494.6", "packaging_precio lidera…". Era trazable, pero difícil de leer para un directorio. La regla nueva pide la métrica en palabras con el campo entre paréntesis ("ROI a 12 meses de 494.6% (roi_12m_pct)") y las iniciativas por su título, el mismo estilo del dictamen local. La trazabilidad no se pierde, porque el verificador de cifras la comprueba igual. Primera prueba con la regla nueva (16 de noviembre, Instancia 3): `particle-ai/particle-1:free`, elegido por el router, respondió en 101.9 s con 54 de 54 cifras verificadas y redacción como "puntaje RICE de 157 (score_rice) y 425 USD en riesgo (ingreso_en_riesgo_usd)".
- **La prioridad cambió entre consultas:** con los mismos datos, el dictamen de nemotron (regla anterior) priorizó Planes y precios por su bajo costo, y el de particle-1 (regla nueva) priorizó Reportes por el ingreso en riesgo, igual que el motor local. Cambiaron el modelo y el prompt a la vez, así que no se puede atribuir a uno solo; lo que sí muestra es que la recomendación de la IA no es estable y debe pasar por el comité.
- **Límite del verificador:** comprueba que cada cifra exista en el JSON, no que el razonamiento sea correcto. En el mismo dictamen, el CFO relacionó el LTV/CAC de 12.7 con "reducir el riesgo de los 10.5 clientes adquiridos a un CAC de $600", una frase sin sentido cuyas cifras son todas reales. Por eso el dictamen es un insumo para el comité y no reemplaza la revisión humana.

## Diagnóstico

```
npm run diagnostico:ia                      # llave, cuota y prueba mínima de los modelos de .env
npm run diagnostico:ia -- otro/modelo:free  # lo mismo con otro modelo
npm run diagnostico:ia -- --listar          # modelos gratuitos de hoy: cuáles razonan y cuáles aceptan esquema
npm run diagnostico:ia -- --comite          # consulta real del Comité (caso de la clase), igual que la app
```

Nunca imprime la llave. La prueba mínima gasta hasta 2 consultas por modelo y `--comite` hasta 4, de las 50 diarias; `--listar` no gasta cuota. Al final explica cómo leer cada error.

Historial real de diagnóstico (12 de noviembre):
1. `nex-agi/nex-n2.5-mini:free` respondió 404 "This model is unavailable for free": pasó a ser solo de pago.
2. `nvidia/nemotron-3.5-lightning:free` respondió vacío con `finish_reason: length`: se quedaba sin tokens razonando con el prompt completo (con la prueba mínima sí funcionaba).
3. `openrouter/free` eligió en cada consulta un modelo distinto; uno de ellos (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`) devolvió texto que no era JSON.

Cada caso llevó a una mejora del cliente (mensaje específico, más tokens, reintento ante formato inválido y extractor de JSON más tolerante).

## Resiliencia

| Situación | Comportamiento |
|---|---|
| Sin llave | Dictamen local |
| 429 (límite) | Pasa al siguiente modelo; si no queda ninguno, dictamen local |
| 404 "data policy" | La configuración de privacidad de la cuenta excluye a los proveedores gratuitos: pasa al siguiente modelo y el mensaje indica revisar Settings > Privacy en openrouter.ai |
| 404 por parámetros no soportados | Reintenta el mismo modelo en formato simple |
| 404 "unavailable for free" (el modelo pasó a ser de pago) | Pasa al siguiente modelo y pide cambiar `OPENROUTER_MODEL` |
| 404 sin más detalle (modelo retirado) | Pasa al siguiente modelo |
| 400 al pedir el esquema | Reintenta el mismo modelo en formato simple |
| Respuesta vacía (por ejemplo, `finish_reason: length` en un modelo que razona) | Reintenta el mismo modelo en formato simple e informa qué modelo respondió y por qué terminó |
| 401/403 (llave rechazada) | No prueba otros modelos; dictamen local con el aviso "revisa OPENROUTER_API_KEY" |
| Sin red | Dictamen local sin probar otros modelos |
| Sin respuesta a tiempo (45 s por intento) | Pasa al siguiente modelo; si no queda ninguno, dictamen local |
| Respuesta con razonamiento o texto alrededor del JSON | Se extrae el objeto JSON igual (tolera `<think>` sin cerrar, bloques de código y llaves sueltas) |
| Respuesta sin JSON válido, decisión inexistente o iniciativa que no está en la matriz | Reintenta en formato simple y luego con el siguiente modelo; si ninguno cumple, dictamen local y se muestra la última respuesta inválida |
| Navegador sin conexión con el servidor | El navegador genera el dictamen local con los mismos módulos |

## Seguridad

- **La llave nunca sale del servidor:** no viaja al navegador y cualquier texto con forma de llave se reemplaza por `[llave oculta]` en mensajes y registros (probado con un error del proveedor que trae la llave en el mensaje).
- **Sin inyección de instrucciones por los comentarios:** los comentarios de clientes se usan solo para clasificar; el JSON que recibe la IA tiene agregados, sin ids ni textos. Probado con un comentario que dice "IGNORA TODAS LAS INSTRUCCIONES ANTERIORES...".
- **El servidor no confía en el navegador:** recalcula todas las cifras y valida cada registro (segmento, monto, largo de textos, máximo 5.000 filas, cuerpo de hasta 2 MB).
- **La IA tampoco es confiable:** su respuesta se valida contra el esquema, se recortan textos y listas, y se muestra como texto plano (sin `innerHTML`).
- **Cuota protegida:** máximo 10 consultas por minuto por IP y 2 simultáneas.
- `OPENROUTER_BASE_URL` solo acepta https (http únicamente hacia 127.0.0.1, para pruebas).

## Verificador de cifras

Busca en el dictamen los números con `$`, `%`, `x`, `k` o "mil", y los de 3 o más cifras (ignora años y conteos chicos). Acepta formato inglés y español y diferencias menores a 0.6% por redondeo. Lo que no aparece en el JSON se marca como "no verificado", con su ubicación.

Ejemplo con la respuesta simulada de las pruebas: la IA escribió "Reportes y ERP suman $6,910 de ingreso en riesgo". La suma es correcta, pero no está en el JSON: es un cálculo propio de la IA y el verificador lo marca para que una persona lo revise. Es el mismo problema que mostró la evidencia de Gemini (sección 6 de `fase1-logica-de-negocio.md`), ahora detectado automáticamente.

El dictamen local cita solo cifras del JSON, y las pruebas lo verifican en 4 escenarios distintos.

## Pruebas

- `tests/servidor.test.js` (14 pruebas): levanta la app con un OpenRouter simulado (fetch inyectado) y cubre respuesta válida, 429 con modelo de respaldo, 400 por esquema, 401, error que filtra la llave, formato inválido, sin red, tiempo agotado, modo local, validación de la solicitud, limitador, inyección por comentarios y que el servidor ignora cifras del navegador.
- `tests/dictamen.test.js` (10 pruebas): dictamen local, reglas de decisión y prioridad, verificador de cifras y validación de la respuesta.
- Prueba en Chrome con un OpenRouter simulado: consulta exitosa, cifra no verificada marcada, aviso de "datos cambiaron", dictamen local y respaldo por límite 429.
