# Fase 4: Instancia 2, MongoDB Atlas

Los comentarios de clientes pasan del archivo CSV a un clúster de MongoDB Atlas, y la matriz RICE se calcula en la nube con un **Pipeline de Agregación**. Las simulaciones y los dictámenes del Comité IA quedan guardados.

## Archivos

| Archivo | Rol |
|---|---|
| `src/datos/modelo_mongodb.js` | Estructura de la guía: `MongoClient`, `connectToMongoDB`, `disconnectFromMongoDB`, inserción de documentos, pipeline RICE y simulaciones |
| `src/datos/fuentes.js` | Elige la fuente según `DB_MODE` (misma interfaz para CSV, MongoDB y PostgreSQL) |
| `scripts/cargar-mongodb.js` | Carga el CSV en Atlas y verifica la matriz contra la del navegador |
| `tests/mongodb.test.js` | Pruebas del pipeline y del servidor en modo `mongodb` |

## Puesta en marcha

1. En Atlas:
   - crear un usuario `stratai_app` con `readWrite` **solo** sobre `stratai_db`;
   - permitir **solo tu IP** en Network Access.
2. En `.env`: `MONGO_URI=mongodb+srv://stratai_app:<contraseña>@<clúster>.mongodb.net/?retryWrites=true&w=majority`.
3. `npm run cargar:mongodb`: carga los comentarios y muestra la matriz calculada en Atlas junto con la comparación.
4. En `.env`: `DB_MODE=mongodb`, y luego `npm start`.

Opciones del script: `-- --reiniciar` (borra lo cargado desde ese archivo y lo vuelve a cargar), `-- --solo-verificar` y `-- otro.csv`.

La guía con cada paso en Atlas, los comandos de PowerShell, la salida esperada, las evidencias y la solución de problemas está en [`guia-paso-a-paso-fase4.md`](guia-paso-a-paso-fase4.md).

## Colecciones

**`feedbacks`**: un documento por comentario, con la estructura de la guía (datos del cliente + `analisis_ia`):

```json
{
  "huella": "sha256(id_cliente + comentario)",
  "id_cliente": "C-109", "segmento": "Enterprise", "valor_mensual_usd": 1400,
  "comentario": "Urgente: necesitamos permisos por rol...", "canal": "Reunion Comercial",
  "analisis_ia": {
    "categoria_id": "seguridad_auditoria", "categoria_titulo": "Control de Acceso por Roles y Auditoría de Usuarios",
    "nivel_riesgo": "Alto Riesgo de Fuga (Churn)", "riesgo_id": "churn", "peso_impacto": 3,
    "esfuerzo_meses": 1.5, "costo_iniciativa_usd": 11000, "eficacia_relativa": 1.3, "...": "..."
  },
  "origen": "datos_ejemplo.csv", "fecha_creacion": "2026-11-16T..."
}
```

Índices: `huella` (único), `analisis_ia.categoria_id`, `id_cliente`. La huella hace que volver a cargar el mismo CSV **no duplique** documentos.

**`simulaciones`**: cada consulta al Comité guarda las entradas, los supuestos, los KPIs, los escenarios, los diagnósticos, la matriz RICE usada, el proveedor y el modelo de IA, el dictamen y la verificación de cifras. Es la auditoría de qué recomendó la IA y con qué datos.

## Pipeline de Agregación (matriz RICE en la nube)

| Etapa | Operador | Qué hace |
|---|---|---|
| 0 | `$match` | Excluye los comentarios sin clasificar |
| 1 | `$group` | Un registro por **cliente y categoría** (máximo MRR y peso; cuenta menciones y riesgos) |
| 2 | `$group` | Por iniciativa: clientes, ingreso en riesgo (`$sum`), impacto promedio (`$avg`) |
| 3 | `$addFields` | Impacto a 2 decimales, reach y confianza (`$min` con tope de 95%) |
| 4 | `$addFields` | Score RICE = reach × impacto × confianza / esfuerzo |
| 5 | `$sort` | Por score RICE o por ingreso en riesgo (desafío 10) |
| 6 | `$project` | Mismo formato que la matriz del navegador |

**Diferencias con el pipeline de la guía, y por qué:**
- **Redondeo con `$floor(x + 0.5)` en vez de `$round`:** `$round` de MongoDB redondea al par, así que el reach de Reportes (78.5) quedaría en 78 y su score bajaría. Con `$floor(x + 0.5)` da 79, igual que el navegador y PostgreSQL.
- **Primero se agrupa por cliente:** la guía suma cada comentario, así que un cliente que reclama varias veces inflaría el alcance y el dinero en riesgo. Es el mismo problema de normalización que el Manual Docente plantea para la Instancia 3.
- **Se guarda la categoría completa en `analisis_ia`** (título, esfuerzo, costo y eficacia), como en la guía, para que la base pueda calcular sola.

## Verificación entre instancias

- **Pruebas sin conexión** (`tests/mongodb.test.js`): el pipeline real de `modelo_mongodb.js` se ejecuta con `mingo` (una implementación en JavaScript del lenguaje de agregación de MongoDB). La matriz resultante es idéntica a la del navegador en el dataset de la clase, con los 2 criterios de orden, el desafío 9, un cliente repetido y un comentario sin clasificar.
- **Contra el clúster real** (`npm run cargar:mongodb`): compara la matriz calculada por Atlas con la que calcula el navegador sobre los mismos documentos y muestra "Coincide: SÍ/NO".
- **En la interfaz:** en modo `mongodb`, la pestaña 2 muestra si la matriz del navegador coincide con la calculada por Atlas.

## Comportamiento de la app en modo `mongodb`

- `/api/feedback` entrega los comentarios de Atlas y la matriz calculada por el pipeline.
- Los comentarios agregados en la interfaz (formulario o desafío 9) quedan solo en la sesión. El Comité los recibe sumados a los de Atlas, y la pestaña 2 avisa que la matriz de Atlas no los incluye.
- La carga de CSV desde el navegador se desactiva: en esta instancia los datos se cargan con `npm run cargar:mongodb`.
- Cada consulta al Comité se guarda en `simulaciones`; si no se puede guardar, el dictamen se entrega igual y se avisa.

## Seguridad

- **Sin credenciales en el código:** `MONGO_URI` vive en `.env`. La guía traía la cadena con el usuario del profesor escrita en el código.
- **Mínimo privilegio:** el usuario `stratai_app` solo tiene `readWrite` sobre `stratai_db`.
- **Red:** solo tu IP en Network Access. El manual sugiere `0.0.0.0/0`, que deja la base expuesta a todo internet.
- **Credenciales ocultas:** cualquier mensaje o registro reemplaza usuario y contraseña de la cadena por `***`, y los errores del driver se traducen a mensajes accionables (IP no permitida, usuario o contraseña incorrectos, clúster inexistente, permisos insuficientes).
- **Datos de la base validados:** lo que se lee de Atlas pasa por la misma validación que el CSV antes de usarse.
- **Inserciones seguras:** se usan objetos y `$set`/`$setOnInsert`, nunca texto interpolado en las consultas.
