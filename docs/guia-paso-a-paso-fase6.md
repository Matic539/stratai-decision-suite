# Guía paso a paso: Fase 6 (evidencias, GitHub y entrega)

Esta guía completa las evidencias que faltan. La publicación en GitHub y el .zip de entrega ya están hechos (paso 3). Los comandos son para **PowerShell en Windows**.

Tiempo estimado: 30 a 40 minutos.

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

## Paso 3. Publicación y .zip (ya hechos)

El 16 de noviembre quedaron listos:

- **Repositorio público:** https://github.com/Matic539/stratai-decision-suite (rama `main`). Contiene 81 archivos y no incluye `.env`, `atlas-credentials.env` ni `node_modules`. La captura `fase1-prompt-gemini.png` se recortó para quitar tu nombre y el historial de Gemini; el original quedó en la carpeta `Tarea-1`, fuera del proyecto.
- **App de Claude en GitHub:** instalada en tu cuenta con acceso **solo** a este repositorio, para poder subir los cambios. Se puede quitar en GitHub → **Settings → Applications → Installed GitHub Apps → Claude**.
- **`Tarea-1\stratai-suite-entrega.zip`:** generado con `git archive` desde el mismo commit. Se probó descomprimido en una carpeta limpia: `npm ci` sin vulnerabilidades, 135 de 135 pruebas y el servidor en modo CSV con el dictamen local.

Cuando termines las capturas de los pasos 1 y 2, avisa: se suben al repositorio y se vuelve a generar el .zip.

Recomendación de seguridad: pasa lo que tiene `atlas-credentials.env` a un gestor de contraseñas (por ejemplo, Bitwarden) y borra ese archivo; hoy está en texto plano dentro de OneDrive.

---

## Lista de entrega

- [x] Evidencias en `docs/evidencias/` (índice en el README)
- [ ] `DB_MODE=csv` en tu `.env` local
- [x] Repositorio en GitHub sin secretos
- [x] `stratai-suite-entrega.zip` probado en una carpeta limpia (se regenera al agregar las capturas)
- [ ] Enlace al repositorio y .zip enviados según lo que pida el ramo
