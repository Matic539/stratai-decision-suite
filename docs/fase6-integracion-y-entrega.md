# Fase 6: Integración, revisión de seguridad y entrega

Cierre del proyecto: las 3 instancias funcionando con la misma interfaz, comparación entre ellas, revisión de seguridad antes de publicar y empaquetado. Los pasos con PowerShell están en [`guia-paso-a-paso-fase6.md`](guia-paso-a-paso-fase6.md).

## Integración de las 3 instancias

- **Misma interfaz:** `src/datos/fuentes.js` elige la fuente según `DB_MODE`, y las tres exponen las mismas funciones (`conectar`, `cerrar`, `leerFeedback`, `obtenerMatriz`, `guardarSimulacion`, `estado`). El frontend y el Comité IA no saben de dónde vienen los datos.
- **Mismos resultados:** `npm run comparar` calcula la matriz RICE con el CSV, la pide a Atlas y a PostgreSQL, y compara valores y orden con los 2 criterios. Con los datos de la clase, las tres coinciden.
- **Verificación en la interfaz:** en las Instancias 2 y 3, la pestaña 2 compara la matriz del navegador con la de la base y lo indica en pantalla.

## Revisión de seguridad (16 de noviembre)

| Revisión | Resultado |
|---|---|
| Búsqueda de secretos en todos los archivos de texto que se publican (llaves de OpenRouter y Google, cadenas de MongoDB con credenciales, `PGPASSWORD` con valor, tokens de GitHub, claves privadas) | Sin secretos. Las coincidencias son ejemplos (`TU_CONTRASEÑA`) o valores falsos de las pruebas |
| `.gitignore` probado en un repositorio de prueba | Excluye `.env`, `.env.*`, `atlas-credentials.env`, cualquier `*.env`, archivos con "credentials" o "credenciales" en el nombre, `*.pem`, `*.key` y `*.zip`; incluye `.env.example` |
| Capturas de evidencias | Sin llaves ni contraseñas. `fase1-prompt-gemini.png` muestra el nombre y el historial de chats de Gemini, y las capturas de la Fase 4 muestran el host del clúster; ver la nota sobre repositorio público en la guía |
| `npm audit` (dependencias de producción y de desarrollo) | 0 vulnerabilidades |
| Instalación limpia (`npm ci` en una copia sin `node_modules`) | 135 de 135 pruebas pasan |
| Cabeceras HTTP | `Content-Security-Policy` sin scripts en línea ni orígenes externos, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| Errores hacia el cliente | Mensajes genéricos (`Ruta no encontrada`, `JSON mal formado`); los detalles quedan en la consola del servidor |
| Interfaz en modo CSV y PostgreSQL, tema claro y oscuro, y móvil (390 px) | Sin errores en la consola y sin desborde horizontal |
| Usuario de PostgreSQL de la app | No puede crear ni borrar tablas, cambiar el catálogo, cambiar nombres de clientes ni borrar simulaciones (probado en el servidor real y en las pruebas) |

Recomendación: guardar las credenciales de Atlas en un gestor de contraseñas en vez de un archivo de texto dentro de la carpeta del proyecto, que además se sincroniza con OneDrive.

## Entrega

- **Repositorio en GitHub** con todo lo versionado (sin `node_modules`, `.env` ni archivos de credenciales).
- **Archivo .zip** generado con `git archive`, que solo incluye lo que está en el repositorio. Se prueba descomprimiéndolo en otra carpeta: `npm install`, `npm test` y `npm start` en modo CSV deben funcionar sin base de datos ni llave de IA.
- Versión `1.0.0` en `package.json`.
