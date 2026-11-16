/**
 * Diagnóstico de la conexión con OpenRouter:
 *   npm run diagnostico:ia                      llave, cuota y prueba mínima de los modelos de .env
 *   npm run diagnostico:ia -- modelo1 modelo2   lo mismo con otros modelos
 *   npm run diagnostico:ia -- --listar          modelos gratuitos de hoy: cuáles razonan y cuáles aceptan esquema
 *   npm run diagnostico:ia -- --comite          consulta real del Comité (caso de la clase), igual que la app
 *
 * 1. Revisa la llave y la cuota diaria de modelos gratuitos (no consume cuota).
 * 2. Lista los proveedores disponibles de cada modelo (no consume cuota).
 * 3. Hace una consulta mínima por modelo en formato simple y con esquema JSON
 *    (consume hasta 2 consultas por modelo de las 50 diarias gratuitas).
 *
 * Nunca imprime la llave.
 */
import dotenv from 'dotenv';
import { cargarConfig, MODELO_POR_DEFECTO } from '../src/config.js';
import { readFile } from 'node:fs/promises';
import { ocultarSecretos, consultarOpenRouter, ErrorIA } from '../src/ia/openrouter.js';
import { simularEstrategia, ENTRADAS_EJEMPLO } from '../public/js/core/finanzas.js';
import { diagnosticarEstrategia } from '../public/js/core/diagnostico.js';
import { leerFeedbackCSV } from '../public/js/core/csv.js';
import { clasificarLote } from '../public/js/core/clasificador.js';
import { calcularMatrizRICE } from '../public/js/core/rice.js';
import { construirPayload, construirPromptComite, extraerJSON, validarDictamen } from '../public/js/core/comite.js';
import { verificarCifras } from '../public/js/core/verificacion.js';

dotenv.config({ quiet: true });

const config = cargarConfig();
const { ia } = config;
const argumentos = process.argv.slice(2);
const opciones = new Set(argumentos.filter((a) => a.startsWith('--')));
const elegidos = argumentos.filter((a) => !a.startsWith('--'));
const modelos = elegidos.length ? elegidos : [...new Set([...ia.modelos, MODELO_POR_DEFECTO])];
const cabeceras = { Authorization: `Bearer ${ia.openrouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'StratAI Decision Suite (diagnostico)' };

const linea = (texto = '') => console.log(texto);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, opciones = {}) {
  const inicio = Date.now();
  const controlador = new AbortController();
  const t = setTimeout(() => controlador.abort(), ia.timeoutMs);
  try {
    const r = await fetch(url, { ...opciones, signal: controlador.signal });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no JSON */ }
    return { status: r.status, json, texto, ms: Date.now() - inicio };
  } catch (error) {
    return { status: 0, error: error.name === 'AbortError' ? `sin respuesta en ${ia.timeoutMs / 1000} s` : ocultarSecretos(error.cause?.code ?? error.message), ms: Date.now() - inicio };
  } finally {
    clearTimeout(t);
  }
}

const ESQUEMA_MINIMO = {
  name: 'prueba',
  strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['ok', 'modelo'], properties: { ok: { type: 'boolean' }, modelo: { type: 'string' } } },
};

async function probarModelo(modelo, conEsquema) {
  const cuerpo = {
    model: modelo,
    messages: [
      { role: 'system', content: 'Responde solo con un objeto JSON válido, sin texto adicional.' },
      { role: 'user', content: 'Devuelve {"ok": true, "modelo": "<tu nombre>"}.' },
    ],
    temperature: 0,
    max_tokens: 800,
  };
  if (conEsquema) {
    cuerpo.response_format = { type: 'json_schema', json_schema: ESQUEMA_MINIMO };
    cuerpo.reasoning = { effort: 'low', exclude: true };
  }
  const r = await pedir(`${ia.baseUrl}/chat/completions`, { method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo) });
  const variante = conEsquema ? 'con esquema' : 'simple     ';
  if (r.status === 0) return linea(`  ${variante} -> sin conexión: ${r.error}`);
  if (r.status !== 200 || r.json?.error) {
    return linea(`  ${variante} -> HTTP ${r.status} (${r.ms} ms): ${ocultarSecretos(r.json?.error?.message ?? r.texto, 400)}`);
  }
  const eleccion = r.json?.choices?.[0] ?? {};
  const c = eleccion.message?.content;
  const contenido = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '';
  let jsonValido = false;
  try { JSON.parse(contenido.replace(/```(?:json)?/g, '').trim()); jsonValido = true; } catch { /* no */ }
  linea(`  ${variante} -> HTTP 200 (${r.ms} ms) respondió ${r.json.model ?? '?'} · finish_reason: ${eleccion.finish_reason ?? '?'} · ${contenido.trim() ? `JSON ${jsonValido ? 'válido' : 'NO válido'}: ${ocultarSecretos(contenido, 120)}` : 'CONTENIDO VACÍO'}`);
}

async function listarGratuitos() {
  linea('\nModelos gratuitos disponibles hoy');
  const r = await pedir(`${ia.baseUrl}/models`, { headers: cabeceras });
  if (r.status !== 200) return linea(`  HTTP ${r.status}: ${ocultarSecretos(r.json?.error?.message ?? r.error ?? '')}`);
  const gratuitos = (r.json?.data ?? [])
    .filter((m) => String(m.id).endsWith(':free'))
    .map((m) => {
      const p = m.supported_parameters ?? [];
      return { id: m.id, contexto: m.context_length, razona: p.includes('reasoning') || p.includes('include_reasoning'), esquema: p.includes('structured_outputs') || p.includes('response_format') };
    })
    // Primero los que aceptan esquema y no razonan (más rápidos y predecibles para JSON)
    .sort((a, b) => Number(b.esquema) - Number(a.esquema) || Number(a.razona) - Number(b.razona) || a.id.localeCompare(b.id));
  for (const m of gratuitos) {
    linea(`  ${m.id.padEnd(55)} esquema: ${m.esquema ? 'sí' : 'no'} · razona: ${m.razona ? 'sí' : 'no'} · contexto: ${m.contexto ?? '?'}`);
  }
  linea(`  Total: ${gratuitos.length}. Para el Comité conviene uno con "esquema: sí" y, si es posible, "razona: no".`);
}

async function probarComite() {
  linea('\nConsulta real del Comité (caso de la clase)');
  const texto = await readFile(new URL('../data/datos_ejemplo.csv', import.meta.url), 'utf8');
  const simulacion = simularEstrategia(ENTRADAS_EJEMPLO);
  const payload = construirPayload({ simulacion, rice: calcularMatrizRICE(clasificarLote(leerFeedbackCSV(texto))), diagnosticos: diagnosticarEstrategia(simulacion) });
  const prompt = construirPromptComite(payload);
  linea(`  Tamaño del prompt: ${prompt.sistema.length + prompt.usuario.length} caracteres · modelos: ${modelos.join(' > ')}`);
  try {
    const r = await consultarOpenRouter({
      sistema: prompt.sistema, usuario: prompt.usuario, ia: { ...ia, modelos }, fetchImpl: fetch,
      validar: (c) => validarDictamen(extraerJSON(c), payload),
    });
    r.intentos.forEach((i) => linea(`  intento fallido (${i.variante}): ${i.mensaje}`));
    const v = verificarCifras(r.validacion.dictamen, payload);
    linea(`  OK: respondió ${r.modelo} (${r.variante}) en ${(r.latenciaMs / 1000).toFixed(1)} s · decisión: ${r.validacion.dictamen.decision} · prioridad: ${r.validacion.dictamen.iniciativa_prioritaria}`);
    linea(`  Cifras: ${v.verificadas} de ${v.revisadas} verificadas${v.no_encontradas.length ? ` · no encontradas: ${v.no_encontradas.map((n) => n.cifra).join(', ')}` : ''}`);
  } catch (error) {
    if (!(error instanceof ErrorIA)) throw error;
    (error.intentos ?? []).forEach((i) => linea(`  intento fallido (${i.variante}): ${i.mensaje}`));
    linea('  Ningún modelo entregó un dictamen válido: la app usaría el dictamen local.');
  }
}

async function main() {
  linea('Diagnóstico de OpenRouter para StratAI Decision Suite');
  linea(`  URL base: ${ia.baseUrl}`);
  linea(`  Proveedor configurado: ${ia.proveedor}`);
  linea(`  Llave cargada: ${ia.openrouterKey ? 'sí (no se muestra)' : 'NO'}`);
  linea(`  Modelos a probar: ${modelos.join(', ')}`);
  if (!ia.openrouterKey) {
    linea('\nFalta OPENROUTER_API_KEY en .env. El Comité usará el dictamen local.');
    process.exit(1);
  }

  linea('\n1) Llave y cuota');
  const llave = await pedir(`${ia.baseUrl}/key`, { headers: cabeceras });
  if (llave.status === 200) {
    const d = llave.json?.data ?? {};
    const diario = d.free_model_daily_requests;
    linea(`  Llave válida · nivel gratuito: ${d.is_free_tier ?? '?'} · uso: ${d.usage ?? '?'} · límite: ${d.limit ?? 'sin límite'}`);
    if (diario) linea(`  Consultas gratuitas hoy: ${diario.used ?? '?'} usadas de ${diario.limit ?? '?'} (quedan ${diario.remaining ?? '?'})`);
  } else {
    linea(`  HTTP ${llave.status}: ${ocultarSecretos(llave.json?.error?.message ?? llave.error ?? llave.texto)}`);
    if (llave.status === 401) {
      linea('  La llave es inválida o fue revocada: genera otra en https://openrouter.ai/keys');
      process.exit(1);
    }
  }

  if (opciones.has('--listar')) await listarGratuitos();
  if (opciones.has('--comite')) await probarComite();
  if (opciones.has('--listar') || opciones.has('--comite')) return;

  for (const modelo of modelos) {
    linea(`\n2) Modelo ${modelo}`);
    const esRouter = modelo.startsWith('openrouter/');
    const ep = esRouter ? null : await pedir(`${ia.baseUrl}/models/${modelo}/endpoints`, { headers: cabeceras });
    if (esRouter) {
      linea('  Router de OpenRouter: elige un modelo gratuito distinto en cada consulta (no tiene proveedores propios).');
    } else if (ep.status === 200) {
      const lista = ep.json?.data?.endpoints ?? [];
      linea(`  Proveedores disponibles: ${lista.length}`);
      for (const e of lista.slice(0, 5)) {
        const params = e.supported_parameters ?? [];
        linea(`   - ${e.provider_name ?? e.name ?? '?'} · estado: ${e.status ?? '?'} · response_format: ${params.includes('response_format') ? 'sí' : 'no'} · structured_outputs: ${params.includes('structured_outputs') ? 'sí' : 'no'}`);
      }
    } else {
      linea(`  Lista de proveedores: HTTP ${ep.status} (${ocultarSecretos(ep.json?.error?.message ?? ep.error ?? '', 160)})`);
    }
    await probarModelo(modelo, false);
    await esperar(1500);
    await probarModelo(modelo, true);
    await esperar(1500);
  }

  linea('\nCómo leer el resultado:');
  linea('  - "data policy" o "privacy": habilita los proveedores de modelos gratuitos en https://openrouter.ai/settings/privacy');
  linea('  - "unavailable for free" o "paid version": el modelo dejó de ser gratuito; cambia OPENROUTER_MODEL');
  linea('  - "No endpoints found" sin más detalle: el modelo fue retirado; cambia OPENROUTER_MODEL');
  linea('  - 429 con "Provider returned error": el proveedor del modelo está saturado; prueba otro o más tarde');
  linea('  - 429 sin ese detalle: se agotó tu cuota de modelos gratuitos (20 por minuto, 50 por día)');
  linea('  - CONTENIDO VACÍO o JSON NO válido solo "con esquema": el modelo funciona en formato simple (la app lo reintenta sola)');
}

main();
