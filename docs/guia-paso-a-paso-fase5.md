# Guía paso a paso: Fase 5 (PostgreSQL)

Esta guía lleva la app a la Instancia 3 (PostgreSQL 17 en tu equipo), con las evidencias que conviene guardar en cada paso. Los comandos son para **PowerShell en Windows**; algunos pasos se escriben dentro de `psql`, y se indica cuándo.

Tiempo estimado: 30 a 40 minutos.

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

Resultado esperado: `ℹ pass 135` y `ℹ fail 0`. `npm install` agrega PGlite, que las pruebas usan para ejecutar el esquema sin tocar tu servidor.

## Paso 2. Comprobar que PostgreSQL está corriendo

```powershell
Get-Service postgresql*
psql --version
```

Debe aparecer `postgresql-x64-17` con estado **Running** y `psql (PostgreSQL) 17.x`.

- Si dice **Stopped**: abre PowerShell como administrador y ejecuta `Start-Service postgresql-x64-17`.
- Opcional, para ver bien los acentos dentro de psql: ejecuta `chcp 1252` una vez en esta terminal.

---

## Paso 3. Crear la base y el esquema (como administrador `postgres`)

Cada comando pide la contraseña del usuario `postgres`: es la que definiste al instalar PostgreSQL.

```powershell
psql -U postgres -c "CREATE DATABASE stratai_db"
```

Debe responder `CREATE DATABASE`. Si dice `database "stratai_db" already exists`, la base ya estaba: sigue igual.

```powershell
psql -U postgres -d stratai_db -f sql/esquema_postgresql.sql
```

Salida esperada (resumida):

```
SET
CREATE TABLE
CREATE TABLE
...
CREATE VIEW
CREATE FUNCTION
CREATE FUNCTION
CREATE TRIGGER
...
INSERT 0 3
INSERT 0 6
INSERT 0 12
DO
DO
GRANT
...
GRANT
```

- `INSERT 0 3`, `0 6` y `0 12` son los niveles de riesgo, las iniciativas y los clientes.
- El script se puede volver a ejecutar: la segunda vez muestra avisos `NOTICE: ... already exists, skipping`, que son normales.
- Si aparece `WARNING: Console code page (850) differs from Windows code page (1252)`, es solo un aviso de la consola; los datos se guardan bien.

📸 **Evidencia:** el final de esa salida → `docs/evidencias/fase5-1-esquema.png`

## Paso 4. Definir la contraseña del usuario de la app

El script creó el usuario `stratai_app` sin contraseña, para que no quede escrita en ningún archivo. Primero genera una contraseña de 24 letras y números:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
```

Cópiala (no la pegues en el chat). Luego entra a psql como administrador:

```powershell
psql -U postgres -d stratai_db
```

Ahora estás dentro de psql (el indicador cambia a `stratai_db=#`). Escribe:

```
\password stratai_app
```

Pega la contraseña dos veces (no se ve mientras la escribes) y sal con:

```
\q
```

## Paso 5. Configurar `.env`

```powershell
notepad .env
```

Deja estas líneas así (el resto no se toca):

```
DB_MODE=csv
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=stratai_app
PGPASSWORD=LA_CONTRASEÑA_DEL_PASO_4
PGDATABASE=stratai_db
```

`DB_MODE` sigue en `csv` por ahora: el script del paso 6 funciona en cualquier modo. Guarda y cierra.

---

## Paso 6. Cargar los comentarios y verificar

```powershell
npm run cargar:postgres
```

Salida esperada:

```
Conectando a PostgreSQL en 127.0.0.1:5432 (base: stratai_db, usuario: stratai_app)...
  Conectado. El esquema está creado.
  12 comentarios de datos_ejemplo.csv: 12 nuevos, 0 actualizados (los repetidos no se duplican).
  Clientes creados o actualizados desde el CSV: 0.

Matriz RICE calculada por PostgreSQL, orden por Score RICE:
   1. Planes y precios         clientes  3 · ingreso    $425 · reach  40 · score 157
   2. Reportes y velocidad     clientes  3 · ingreso  $5,100 · reach  79 · score 101
   3. Soporte y onboarding     clientes  2 · ingreso    $395 · reach  27 · score  44
   4. Integración ERP          clientes  2 · ingreso  $1,810 · reach  39 · score  40
   5. Seguridad y auditoría    clientes  1 · ingreso  $1,400 · reach  24 · score  36
   6. Alertas WhatsApp         clientes  1 · ingreso    $280 · reach  14 · score  22
  Total: 12 comentarios · $9,410 en riesgo · sin clasificar: 0
  Coincide con la matriz del navegador: SÍ

Matriz RICE calculada por PostgreSQL, orden por ingreso en riesgo (desafío 10):
   1. Reportes y velocidad     ...
  Coincide con la matriz del navegador: SÍ

Listo. Para usar esta instancia, pon DB_MODE=postgres en .env y reinicia con npm start.
```

Es la misma matriz que dio Atlas en la Fase 4. Si lo ejecutas de nuevo, dice `0 nuevos, 0 actualizados`: la huella evita los duplicados.

📸 **Evidencia:** → `docs/evidencias/fase5-2-carga-postgres.png`

---

## Paso 7. Usar la app con PostgreSQL

1. En `.env` cambia `DB_MODE=csv` por `DB_MODE=postgres`.
2. Inicia el servidor:
   ```powershell
   npm start
   ```
   Debe decir: `StratAI Decision Suite en http://127.0.0.1:3000  [datos: PostgreSQL | IA: OpenRouter (...)]`
3. Abre http://127.0.0.1:3000 y revisa:

| Dónde | Qué debe aparecer |
|---|---|
| Arriba a la derecha | **Instancia 3 · PostgreSQL** |
| Pestaña 2, bajo la matriz | ✓ **Coincide con la matriz calculada por PostgreSQL (consulta SQL): mismos valores y mismo orden.** |
| Pestaña 2, botón "Cargar CSV" | Desactivado |

📸 **Evidencia:** pestaña 2 con el mensaje "Coincide…" → `docs/evidencias/fase5-3-app-coincide-postgres.png`

4. En la pestaña 3 pulsa **Consultar al Comité IA** y espera 1 o 2 minutos. Debe aparecer **Guardado en PostgreSQL (id …)**.

📸 **Evidencia:** → `docs/evidencias/fase5-4-dictamen-guardado.png`

5. Deja el servidor corriendo y abre **otra** ventana de PowerShell en la carpeta del proyecto (paso 0). Revisa la simulación guardada (pide la contraseña de `stratai_app`):

```powershell
psql -U stratai_app -d stratai_db -c "SELECT id_simulacion, proveedor_ia, modelo_ia, roi_12m_pct, dictamen_ia_json->>'decision' AS decision, fecha_simulacion FROM simulaciones_estrategicas ORDER BY id_simulacion DESC LIMIT 5;"
```

📸 **Evidencia:** → `docs/evidencias/fase5-5-simulaciones-psql.png`

---

## Paso 8. Desafío 11: duplicar el valor mensual de C-103

Con el servidor todavía corriendo, en la segunda ventana:

```powershell
psql -U stratai_app -d stratai_db
```

Dentro de psql, escribe una línea a la vez:

```
\i sql/consulta_ingreso_en_riesgo.sql
UPDATE clientes SET valor_mensual_usd = valor_mensual_usd * 2 WHERE id_cliente = 'C-103';
\i sql/consulta_ingreso_en_riesgo.sql
```

Resultado esperado: la primera tabla muestra Integración ERP en el puesto 4 con score 40 y $1,810. El `UPDATE` responde `UPDATE 1` y la segunda tabla muestra:

```
      iniciativa       | score_rice | reach | total_menciones | ingreso_mensual_en_juego_usd
-----------------------+------------+-------+-----------------+------------------------------
 Planes y precios      |        157 |    40 |               3 |                       425.00
 Reportes y velocidad  |        101 |    79 |               3 |                      5100.00
 Integración ERP       |         53 |    52 |               2 |                      3310.00
 Soporte y onboarding  |         44 |    27 |               2 |                       395.00
 Seguridad y auditoría |         36 |    24 |               1 |                      1400.00
 Alertas WhatsApp      |         22 |    14 |               1 |                       280.00
```

Solo se modificó una fila de `clientes`: ERP subió al puesto 3 sin tocar `feedback_clientes`.

📸 **Evidencia:** las dos tablas → `docs/evidencias/fase5-6-desafio11-psql.png`

Sal de psql con `\q`, vuelve al navegador y recarga la página (F5). En la pestaña 2, Integración ERP aparece en el puesto 3 con score 53, y sigue el mensaje "Coincide…".

📸 **Evidencia:** → `docs/evidencias/fase5-7-desafio11-app.png`

**Deja todo como estaba:** en la segunda ventana ejecuta

```powershell
npm run cargar:postgres
```

Debe decir `Clientes creados o actualizados desde el CSV: 1.`: C-103 volvió a $1,500. Recarga el navegador y ERP vuelve al puesto 4.

Opcional, la versión automática del desafío (lo hace dentro de una transacción y al final la deshace):

```powershell
npm run cargar:postgres -- --desafio-11
```

📸 **Evidencia opcional:** → `docs/evidencias/fase5-8-desafio11-script.png`

---

## Paso 9. Volver a la Instancia 1 cuando lo necesites

En `.env` pon `DB_MODE=csv` y reinicia con `npm start`. Las 3 instancias usan la misma interfaz: solo cambia `DB_MODE`.

---

## Solución de problemas

| Mensaje | Causa probable | Qué hacer |
|---|---|---|
| `psql : El término 'psql' no se reconoce...` | La carpeta de PostgreSQL no está en el PATH de esta terminal | Usa la ruta completa: `& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres ...` |
| `la autentificación password falló para el usuario «postgres»` | Contraseña de la instalación incorrecta | Es la que definiste al instalar PostgreSQL. Si no la recuerdas, avísame |
| `PostgreSQL rechazó el usuario o la contraseña: revisa PGUSER y PGPASSWORD en .env.` | `PGPASSWORD` no coincide con la del paso 4 | Repite el paso 4 y copia la misma contraseña en `.env` |
| `No existe la base "stratai_db"...` | No se ejecutó el paso 3 | Paso 3 |
| `La base "stratai_db" no tiene el esquema de StratAI...` | Falta el script del esquema | Segundo comando del paso 3 |
| `El usuario "stratai_app" no tiene permisos...` | Se ejecutó el esquema con otro usuario o se cambiaron los permisos | Vuelve a ejecutar el segundo comando del paso 3 como `postgres` |
| `No se pudo conectar a PostgreSQL en 127.0.0.1:5432...` | El servicio está detenido, o PostgreSQL usa otro puerto | Paso 2. Si tienes más de una versión instalada, el puerto puede ser 5433: revisa la línea `port` de `C:\Program Files\PostgreSQL\17\data\postgresql.conf` y ajusta `PGPORT` |
| `Coincide con la matriz del navegador: NO` | Diferencia entre PostgreSQL y el navegador | No sigas: copia la salida completa y envíamela |
| Acentos raros en psql (`IntegraciÃ³n`) | Página de códigos de la consola | Es solo visual: ejecuta `chcp 1252` antes de abrir psql |
| `npm start` termina con `[inicio] ...` | El servidor no pudo conectarse al iniciar | El mensaje después de `[inicio]` es uno de los de esta tabla |

---

## Seguridad

- La app se conecta con `stratai_app`, que puede leer y escribir datos, pero no crear ni borrar tablas, ni borrar simulaciones. `postgres` se usa solo para crear la base y el esquema.
- La contraseña de `stratai_app` vive solo en `.env`, que no se sube a GitHub.
- No cambies `pg_hba.conf` ni `listen_addresses` para abrir PostgreSQL a la red: la app y la base están en el mismo equipo.

## Lista de evidencias de la Fase 5

- [ ] `fase5-1-esquema.png`: salida del script del esquema
- [ ] `fase5-2-carga-postgres.png`: terminal con "Coincide con la matriz del navegador: SÍ"
- [ ] `fase5-3-app-coincide-postgres.png`: pestaña 2 con "Coincide con la matriz calculada por PostgreSQL"
- [ ] `fase5-4-dictamen-guardado.png`: dictamen con "Guardado en PostgreSQL"
- [ ] `fase5-5-simulaciones-psql.png`: consulta de `simulaciones_estrategicas`
- [ ] `fase5-6-desafio11-psql.png`: tablas antes y después del `UPDATE`
- [ ] `fase5-7-desafio11-app.png`: app con Integración ERP en el puesto 3
- [ ] `fase5-8-desafio11-script.png` (opcional): `npm run cargar:postgres -- --desafio-11`
