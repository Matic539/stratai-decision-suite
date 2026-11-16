# Guía paso a paso: Fase 4 (MongoDB Atlas)

Esta guía lleva la app de la Instancia 1 (CSV) a la Instancia 2 (MongoDB Atlas), con las evidencias que conviene guardar en cada paso. Todos los comandos son para **PowerShell en Windows**.

Tiempo estimado: 30 a 45 minutos.

---

## Paso 0. Abrir la terminal en el proyecto

```powershell
cd "C:\Users\matia\OneDrive\Escritorio\Estudio\Semestre10\Aplicaciones de Inteligencia Artificial\Unidad-3\Tarea-1\stratai-suite"
```

Si el servidor está corriendo en otra terminal, detenlo con `Ctrl + C`.

## Paso 1. Actualizar dependencias y comprobar que todo pasa

```powershell
npm install
npm test
```

Resultado esperado: `ℹ pass 117` y `ℹ fail 0`.

---

## Paso 2. Configurar MongoDB Atlas

Entra a https://cloud.mongodb.com con tu cuenta.

### 2.1 Clúster

- Si ya tienes un clúster en tu proyecto, úsalo.
- Si no, crea uno con el plan gratuito (**M0 / Free**). Elige un proveedor y región cercanos (por ejemplo, São Paulo) y espera unos minutos a que termine de crearse.

### 2.2 Usuario de la base de datos (mínimo privilegio)

1. En el menú del proyecto, abre **Database & Network Access**. En versiones anteriores de Atlas, está en **Security > Database Access**.
2. Pulsa **Add New Database User**.
3. Método de autenticación: **Password**.
4. Usuario: `stratai_app`.
5. Contraseña: pulsa **Autogenerate Secure Password** y **cópiala en un lugar seguro**. La autogenerada no trae símbolos raros, así que no necesita codificarse.
6. Privilegios: **no** elijas "Read and write to any database". Abre la sección **Specific Privileges** y agrega:
   - Privilegio: `readWrite`
   - Base de datos: `stratai_db`
   - Colección: en blanco
7. Pulsa **Add User**.

> Por qué: si la contraseña se filtra, el usuario solo puede tocar `stratai_db` y no el resto del clúster.

### 2.3 Acceso de red (solo tu IP)

1. En **Database & Network Access**, abre la pestaña **IP Access List** (en versiones anteriores, **Security > Network Access**).
2. Pulsa **Add IP Address** y luego **Add Current IP Address**.
3. En el comentario escribe algo como `Notebook Matias`.
4. Pulsa **Confirm** y espera a que el estado diga **Active** (1 o 2 minutos).

> **No uses `0.0.0.0/0` ("Allow access from anywhere")**, aunque lo sugiera el manual del ramo: deja la base abierta a todo internet y solo la protege la contraseña.
>
> Si cambias de red (casa, INACAP, datos del celular), tu IP cambia y tendrás que agregar la nueva.

### 2.4 Copiar la cadena de conexión

1. Ve a la vista de clústeres (**Clusters** o **Database**) y pulsa **Connect** en tu clúster.
2. Elige **Drivers**.
3. Driver: **Node.js**, versión más reciente.
4. Copia la cadena que aparece. Tiene esta forma:
   ```
   mongodb+srv://stratai_app:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
5. Reemplaza `<db_password>` (incluidos los signos `<` y `>`) por la contraseña del paso 2.2.

> **No pegues esta cadena en ningún chat, documento ni captura:** contiene la contraseña.

---

## Paso 3. Configurar `.env`

Abre el archivo:

```powershell
notepad .env
```

Deja estas líneas así (el resto, como la llave de OpenRouter, no se toca):

```
DB_MODE=csv
MONGO_URI=mongodb+srv://stratai_app:TU_CONTRASEÑA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGO_DB=stratai_db
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free
```

- `DB_MODE` sigue en `csv` por ahora: el script del paso 4 funciona en cualquier modo.
- `OPENROUTER_MODEL` deja 3 modelos en orden, para que el Comité tenga respaldo si uno está saturado.

Guarda y cierra el Bloc de notas.

---

## Paso 4. Cargar los datos en Atlas y verificar

```powershell
npm run cargar:mongodb
```

El script hace 4 cosas:
1. Se conecta a Atlas, mostrando el clúster sin usuario ni contraseña.
2. Crea los índices.
3. Carga los 12 comentarios de `data/datos_ejemplo.csv`, ya clasificados.
4. Calcula la matriz RICE **en Atlas** con el pipeline de agregación y la compara con la que calcula el navegador.

Resultado esperado:

```
Conectando a mongodb+srv://***@cluster0.xxxxx.mongodb.net/ (base: stratai_db)...
  Conectado.
  12 comentarios de datos_ejemplo.csv: 12 nuevos, 0 actualizados (los repetidos no se duplican).

Matriz RICE calculada en Atlas, orden por Score RICE:
   1. Planes y precios         clientes  3 · ingreso    $425 · reach  40 · score 157
   2. Reportes y velocidad     clientes  3 · ingreso  $5,100 · reach  79 · score 101
   3. Soporte y onboarding     clientes  2 · ingreso    $395 · reach  27 · score  44
   4. Integración ERP          clientes  2 · ingreso  $1,810 · reach  39 · score  40
   5. Seguridad y auditoría    clientes  1 · ingreso  $1,400 · reach  24 · score  36
   6. Alertas WhatsApp         clientes  1 · ingreso    $280 · reach  14 · score  22
  Total: 12 comentarios · $9,410 en riesgo · sin clasificar: 0
  Coincide con la matriz del navegador: SÍ

Matriz RICE calculada en Atlas, orden por ingreso en riesgo (desafío 10):
   1. Reportes y velocidad     clientes  3 · ingreso  $5,100 · reach  79 · score 101
   2. Integración ERP          clientes  2 · ingreso  $1,810 · reach  39 · score  40
   3. Seguridad y auditoría    clientes  1 · ingreso  $1,400 · reach  24 · score  36
   4. Planes y precios         clientes  3 · ingreso    $425 · reach  40 · score 157
   5. Soporte y onboarding     clientes  2 · ingreso    $395 · reach  27 · score  44
   6. Alertas WhatsApp         clientes  1 · ingreso    $280 · reach  14 · score  22
  Total: 12 comentarios · $9,410 en riesgo · sin clasificar: 0
  Coincide con la matriz del navegador: SÍ

Listo. Para usar esta instancia, pon DB_MODE=mongodb en .env y reinicia con npm start.
```

Lo importante: las dos líneas **"Coincide con la matriz del navegador: SÍ"**, y que Reportes tenga **reach 79** (con `$round` de MongoDB habría quedado en 78).

📸 **Evidencia:** captura de la terminal → `docs/evidencias/fase4-1-carga-atlas.png`

Opciones del script:

| Comando | Para qué |
|---|---|
| `npm run cargar:mongodb` | Cargar otra vez: no duplica, solo actualiza |
| `npm run cargar:mongodb -- --reiniciar` | Borrar lo cargado desde ese archivo y volver a cargarlo (por ejemplo, si cambias el catálogo de categorías) |
| `npm run cargar:mongodb -- --solo-verificar` | Solo comparar Atlas con el navegador, sin cargar nada |

---

## Paso 5. Ver los datos en Atlas

1. En Atlas, abre **Data Explorer** (o **Browse Collections** en tu clúster).
2. Entra a la base `stratai_db` y luego a la colección `feedbacks`.
3. Abre el documento de **C-109** y verifica que `analisis_ia.categoria_id` sea `seguridad_auditoria` y `analisis_ia.nivel_riesgo` sea `Alto Riesgo de Fuga (Churn)`.

📸 **Evidencia:** captura del documento → `docs/evidencias/fase4-2-atlas-feedbacks.png`

---

## Paso 6. Usar la app con MongoDB Atlas

1. En `.env` cambia `DB_MODE=csv` por:
   ```
   DB_MODE=mongodb
   ```
2. Inicia el servidor:
   ```powershell
   npm start
   ```
   Debe decir: `StratAI Decision Suite en http://127.0.0.1:3000  [datos: MongoDB Atlas | IA: OpenRouter (...)]`
3. Abre http://127.0.0.1:3000 y revisa:

| Dónde | Qué debe aparecer |
|---|---|
| Arriba a la derecha | **Instancia 2 · MongoDB Atlas** |
| Pestaña 2, bajo la matriz | ✓ **Coincide con la matriz calculada por MongoDB Atlas (pipeline de agregación): mismos valores y mismo orden.** |
| Pestaña 2, botón "Cargar CSV" | Desactivado: en esta instancia los datos vienen de la base |
| Pestaña 2, "Ordenar por" → Ingreso en riesgo | Reportes pasa al puesto 1 (desafío 10) |

📸 **Evidencias:**
- Pestaña 2 con el mensaje "Coincide…" → `docs/evidencias/fase4-3-app-coincide-atlas.png`
- Pestaña 2 ordenada por ingreso en riesgo → `docs/evidencias/fase4-4-desafio10.png`

4. Ve a la pestaña 3 y pulsa **Consultar al Comité IA**. Puede tardar 1 o 2 minutos, porque los modelos gratuitos razonan antes de responder. Al terminar debe aparecer:
   - **OpenRouter · (modelo)**, o el motivo si respondió el motor local;
   - **Guardado en MongoDB Atlas (id …)**;
   - "Cifras verificadas…".

📸 **Evidencia:** dictamen completo → `docs/evidencias/fase4-5-dictamen-guardado.png`

5. En Atlas, en **Data Explorer**, abre `stratai_db` → `simulaciones`. Debe estar el documento de la consulta, con `dictamen_ia`, `kpis`, `matriz_rice` y `verificacion_cifras`.

📸 **Evidencia:** → `docs/evidencias/fase4-6-atlas-simulaciones.png`

6. Opcional, para mostrar los comentarios agregados en la sesión: en la pestaña 2 pulsa **Agregar desafío 9**. La tabla muestra Seguridad en el puesto 1, y bajo la matriz aparece el aviso de que Atlas no incluye esos 3 comentarios, porque solo existen en la sesión. Si luego consultas al Comité, el dictamen sí los considera.

Para detener el servidor: `Ctrl + C`.

---

## Paso 7. Volver a la Instancia 1 cuando lo necesites

En `.env`:

```
DB_MODE=csv
```

Y de nuevo `npm start`. Las 3 instancias usan la misma interfaz: solo cambia `DB_MODE`.

---

## Paso 8 (pendiente de la Fase 3). Captura del dictamen de la IA en modo CSV

Con `DB_MODE=csv`, abre la pestaña 3 y pulsa **Consultar al Comité IA**.

📸 **Evidencia:** → `docs/evidencias/fase3-dictamen-ia.png`

La captura anterior del respaldo local ya quedó renombrada como `docs/evidencias/fase3-respaldo-local.png`.

---

## Solución de problemas

| Mensaje | Causa probable | Qué hacer |
|---|---|---|
| `Falta MONGO_URI en .env (o todavía tiene <usuario>/<password> del ejemplo).` | La línea no está o tiene los marcadores del ejemplo | Paso 3 |
| `No se pudo conectar a Atlas: revisa en Network Access que tu IP actual esté permitida.` | Tu IP no está en la lista, cambiaste de red o la entrada aún no está activa | Paso 2.3; espera 1 o 2 minutos y reintenta |
| `Atlas rechazó el usuario o la contraseña de MONGO_URI.` | Contraseña mal copiada, no se reemplazó `<db_password>` o tiene símbolos sin codificar | Revisa el paso 2.4. Si la contraseña tiene símbolos, genera otra (en el usuario: **Edit** → **Edit Password** → **Autogenerate**) o codifícalos: `@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`, `?`→`%3F`, `%`→`%25` |
| `No se encontró el clúster: revisa el host de MONGO_URI.` | Host mal copiado, o tu red bloquea las consultas DNS de tipo SRV (`querySrv`) | Copia de nuevo la cadena. Si el host está bien, en **Connect → Drivers** elige una versión antigua del driver para obtener la cadena "standard" (`mongodb://...`, sin `+srv`), o cambia el DNS de Windows a 1.1.1.1 o 8.8.8.8 |
| `El usuario de Atlas no tiene permisos sobre la base (necesita readWrite en stratai_db).` | El privilegio específico quedó mal o la base tiene otro nombre | Paso 2.2: `readWrite` sobre `stratai_db`, exactamente así; revisa también `MONGO_DB` en `.env` |
| `Coincide con la matriz del navegador: NO` | Diferencia entre Atlas y el navegador | No sigas: copia la salida completa y envíamela |
| `npm start` termina con `[inicio] ...` | El servidor no pudo conectarse a Atlas al iniciar | El mensaje después de `[inicio]` es uno de los de esta tabla |
| `EADDRINUSE` al iniciar | Ya hay otro servidor usando el puerto 3000 | Cierra la otra terminal o cambia `PORT=3001` en `.env` |

---

## Seguridad

- `.env` nunca se comparte ni se sube a GitHub: `.gitignore` ya lo excluye.
- Si alguna vez pegas `MONGO_URI` en un lugar público, cambia la contraseña en Atlas (usuario → **Edit** → **Edit Password**) y actualiza `.env`.
- Al terminar el semestre, puedes borrar tu IP de la lista de acceso y el usuario `stratai_app`.

## Lista de evidencias de la Fase 4

- [ ] `fase4-1-carga-atlas.png`: terminal con "Coincide con la matriz del navegador: SÍ"
- [ ] `fase4-2-atlas-feedbacks.png`: documento C-109 en `feedbacks`
- [ ] `fase4-3-app-coincide-atlas.png`: pestaña 2 con "Coincide con la matriz calculada por MongoDB Atlas"
- [ ] `fase4-4-desafio10.png`: matriz ordenada por ingreso en riesgo
- [ ] `fase4-5-dictamen-guardado.png`: dictamen con "Guardado en MongoDB Atlas"
- [ ] `fase4-6-atlas-simulaciones.png`: documento en `simulaciones`
- [ ] `fase3-dictamen-ia.png`: dictamen de la IA en modo CSV (pendiente de la Fase 3)
