# Guía paso a paso: Fase 6 (evidencias, GitHub y entrega)

Esta guía completa las evidencias que faltan, publica el proyecto en GitHub y genera el .zip de entrega, comprobando que funcione en una carpeta limpia. Los comandos son para **PowerShell en Windows**.

Tiempo estimado: 40 a 60 minutos.

---

## Paso 0. Abrir la terminal en el proyecto

```powershell
cd "C:\Users\matia\OneDrive\Escritorio\Estudio\Semestre10\Aplicaciones de Inteligencia Artificial\Unidad-3\Tarea-1\stratai-suite"
npm test
```

Resultado esperado: `ℹ pass 135` y `ℹ fail 0`. Si el servidor está corriendo en otra terminal, detenlo con `Ctrl + C`.

---

## Paso 1. Comparar las 3 instancias

Con el servidor detenido:

```powershell
npm run comparar
```

Salida esperada:

```
Comparación de la matriz RICE entre instancias (datos_ejemplo.csv)

                                       Score RICE               Ingreso en riesgo
  Iniciativa               CSV  Atlas  PostgreSQL        CSV    Atlas  PostgreSQL
  Planes y precios         157    157         157       $425     $425        $425
  Reportes y velocidad     101    101         101     $5,100   $5,100      $5,100
  ...
  Instancia 2, MongoDB Atlas: misma matriz que el CSV, en valores y orden, con los 2 criterios: SÍ
  Instancia 3, PostgreSQL: misma matriz que el CSV, en valores y orden, con los 2 criterios: SÍ

Resultado: las 3 instancias calculan exactamente la misma matriz RICE.
```

📸 **Evidencia:** → `docs/evidencias/fase6-1-comparar.png`

---

## Paso 2. Capturas que faltan

En este orden se reinicia el servidor el menor número de veces.

**a) Terminal, con el servidor detenido**

```powershell
npm run cargar:mongodb -- --solo-verificar
```

📸 → `docs/evidencias/fase4-1-carga-atlas.png`

**b) En Atlas (cloud.mongodb.com → Data Explorer → `stratai_db`)**

- 📸 Documento de C-109 en `feedbacks` → `fase4-2-atlas-feedbacks.png`
- 📸 Documento en `simulaciones` → `fase4-6-atlas-simulaciones.png`

**c) Instancia 2:** en `.env` pon `DB_MODE=mongodb`, ejecuta `npm start` y abre http://127.0.0.1:3000

- 📸 Pestaña 2 con "Coincide con la matriz calculada por MongoDB Atlas" → `fase4-3-app-coincide-atlas.png`
- 📸 Pestaña 2 con **Ordenar por: Ingreso en riesgo** → `fase4-4-desafio10.png`

Detén el servidor con `Ctrl + C`.

**d) Instancia 3:** en `.env` pon `DB_MODE=postgres` y ejecuta `npm start`

- 📸 Pestaña 2 con "Coincide con la matriz calculada por PostgreSQL" → `fase5-3-app-coincide-postgres.png`

Para la captura del desafío 11 en la app, en una **segunda** terminal (en la carpeta del proyecto):

```powershell
psql -U stratai_app -d stratai_db -c "UPDATE clientes SET valor_mensual_usd = valor_mensual_usd * 2 WHERE id_cliente = 'C-103';"
```

Recarga el navegador (F5).

- 📸 Pestaña 2 con Integración ERP en el puesto 3, score 53 → `fase5-7-desafio11-app.png`

Deja todo como estaba, en la misma segunda terminal:

```powershell
npm run cargar:postgres
```

Debe decir `Clientes creados o actualizados desde el CSV: 1.` Detén el servidor con `Ctrl + C`.

**e) Instancia 1:** en `.env` pon `DB_MODE=csv` (así queda para la entrega) y ejecuta `npm start`

- 📸 Pestaña 3, **Consultar al Comité IA** (1 o 2 minutos) → `fase3-dictamen-ia.png`

Detén el servidor con `Ctrl + C`.

---

## Paso 3. Revisar antes de publicar

**Secretos.** Ya están excluidos por `.gitignore`: `.env`, `atlas-credentials.env` y cualquier archivo `*.env` o con "credentials" o "credenciales" en el nombre. Recomendación: pasa lo que tiene `atlas-credentials.env` a un gestor de contraseñas (por ejemplo, Bitwarden) y borra ese archivo; hoy está en texto plano dentro de OneDrive.

**¿Repositorio público o privado?** No hay secretos en el repositorio, pero hay datos personales menores:
- `docs/evidencias/fase1-prompt-gemini.png` muestra tu nombre y los títulos de tus chats de Gemini en la barra lateral;
- las capturas de la Fase 4 muestran el host de tu clúster de Atlas. Sin usuario, contraseña e IP permitida no sirve para entrar, pero tampoco hace falta publicarlo.

Si el repositorio será **público**, recorta esa barra lateral (con la Herramienta Recortes o Paint) o pídeme que la recorte. Si será **privado**, no hace falta.

---

## Paso 4. Crear el repositorio local con git

Comprueba que git está instalado:

```powershell
git --version
```

Si no lo está: `winget install --id Git.Git -e` y abre una terminal nueva.

Si nunca configuraste tu identidad en git (si ya lo hiciste, salta este bloque):

```powershell
git config --global user.name "Matías López"
git config --global user.email "TU_ID+TU_USUARIO@users.noreply.github.com"
```

El correo `noreply` lo encuentras en GitHub → **Settings → Emails**; así tu correo personal no queda en el historial.

Crea el repositorio y revisa qué se va a guardar:

```powershell
git init -b main
git add .
git status --short
git check-ignore -v .env atlas-credentials.env
```

- En `git status --short` **no** deben aparecer `.env`, `atlas-credentials.env` ni `node_modules`.
- `git check-ignore` debe mostrar la regla de `.gitignore` que excluye cada uno.

Si todo está bien:

```powershell
git commit -m "StratAI Decision Suite 1.0.0: simulador, matriz RICE, Comité IA y 3 instancias (CSV, MongoDB Atlas, PostgreSQL)"
```

---

## Paso 5. Publicar en GitHub

1. Entra a https://github.com/new
2. **Repository name:** `stratai-decision-suite`
3. Elige **Private** o **Public** (paso 3).
4. **No** marques "Add a README", ".gitignore" ni "license": el proyecto ya los trae.
5. **Create repository**.

Luego, en la terminal (cambia `TU_USUARIO`):

```powershell
git remote add origin https://github.com/TU_USUARIO/stratai-decision-suite.git
git push -u origin main
```

La primera vez se abre el navegador para iniciar sesión en GitHub.

Revisa en la página del repositorio que el README se vea con sus capturas y que **no** aparezcan `.env` ni `atlas-credentials.env`.

Si el repositorio es privado y tu profesor debe verlo: **Settings → Collaborators → Add people**, con su usuario de GitHub.

---

## Paso 6. Generar el .zip de entrega

```powershell
git archive --format=zip --output "..\stratai-suite-entrega.zip" HEAD
```

El archivo queda en la carpeta `Tarea-1`. `git archive` solo incluye lo que está en el repositorio, así que no lleva `.env`, credenciales ni `node_modules`. (GitHub ofrece lo mismo en **Code → Download ZIP**.)

## Paso 7. Probar el .zip como lo haría tu profesor

```powershell
$prueba = "$env:TEMP\prueba-entrega"
if (Test-Path $prueba) { Remove-Item $prueba -Recurse -Force }
Expand-Archive "..\stratai-suite-entrega.zip" $prueba
cd $prueba
npm install
npm test
copy .env.example .env
npm start
```

Abre http://127.0.0.1:3000: debe decir **Instancia 1 · CSV** e **IA: dictamen local**, y las 3 pestañas deben funcionar sin base de datos ni llave. Detén el servidor con `Ctrl + C` y vuelve a tu carpeta con el comando del paso 0.

📸 **Evidencia opcional:** `npm test` en la carpeta de prueba → `docs/evidencias/fase6-2-zip-limpio.png`. Si la agregas, haz `git add .`, `git commit -m "Evidencia del zip limpio"` y `git push`, y vuelve a generar el .zip.

---

## Lista de entrega

- [ ] Evidencias completas en `docs/evidencias/` (fase3, fase4-1 a fase4-6, fase5-1 a fase5-8 y fase6-1)
- [ ] `DB_MODE=csv` en tu `.env` local
- [ ] Repositorio en GitHub sin secretos
- [ ] `stratai-suite-entrega.zip` probado en una carpeta limpia
- [ ] Enlace al repositorio y .zip enviados según lo que pida el ramo
