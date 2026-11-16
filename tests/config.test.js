import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfig, resumenPublico } from '../src/config.js';

test('sin variables usa CSV, 127.0.0.1:3000 e IA local', () => {
  const c = cargarConfig({});
  assert.equal(c.dbMode, 'csv');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3000);
  assert.equal(c.ia.proveedor, 'local');
});

test('DB_MODE no distingue mayúsculas ni espacios', () => {
  assert.equal(cargarConfig({ DB_MODE: '  MongoDB ', MONGO_URI: 'mongodb+srv://u:p@c.mongodb.net/' }).dbMode, 'mongodb');
});

test('DB_MODE inválido lanza error', () => {
  assert.throws(() => cargarConfig({ DB_MODE: 'mysql' }), /DB_MODE inválido/);
});

test('mongodb exige MONGO_URI real (no el ejemplo con <password>)', () => {
  assert.throws(() => cargarConfig({ DB_MODE: 'mongodb' }), /MONGO_URI/);
  assert.throws(
    () => cargarConfig({ DB_MODE: 'mongodb', MONGO_URI: 'mongodb+srv://<usuario>:<password>@x.mongodb.net/' }),
    /MONGO_URI/
  );
});

test('postgres exige PGUSER', () => {
  assert.throws(() => cargarConfig({ DB_MODE: 'postgres' }), /PGUSER/);
  assert.equal(cargarConfig({ DB_MODE: 'postgres', PGUSER: 'stratai_app' }).postgres.port, 5432);
});

test('puerto inválido lanza error', () => {
  assert.throws(() => cargarConfig({ PORT: '99999' }), /PORT inválido/);
  assert.throws(() => cargarConfig({ PORT: 'abc' }), /PORT inválido/);
});

test('openrouter sin llave cae a modo local', () => {
  assert.equal(cargarConfig({ AI_PROVIDER: 'openrouter' }).ia.proveedor, 'local');
  assert.equal(cargarConfig({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-v1-abc' }).ia.proveedor, 'openrouter');
});

test('el resumen público no expone secretos', () => {
  const c = cargarConfig({
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-or-v1-secreta',
    DB_MODE: 'postgres',
    PGUSER: 'u',
    PGPASSWORD: 'clave-secreta',
  });
  const texto = JSON.stringify(resumenPublico(c));
  assert.ok(!texto.includes('secreta'));
});

test('OPENROUTER_MODEL admite varios modelos y tiene un respaldo por defecto', () => {
  assert.deepEqual(cargarConfig({ OPENROUTER_MODEL: 'nex-agi/nex-n2.5-mini:free, openrouter/free' }).ia.modelos, ['nex-agi/nex-n2.5-mini:free', 'openrouter/free']);
  assert.deepEqual(cargarConfig({}).ia.modelos, ['openrouter/free']);
  assert.throws(() => cargarConfig({ OPENROUTER_MODEL: 'modelo; rm -rf /' }), /OPENROUTER_MODEL/);
});

test('la URL de la IA debe ser https (http solo hacia el propio equipo)', () => {
  assert.equal(cargarConfig({}).ia.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(cargarConfig({ OPENROUTER_BASE_URL: 'http://127.0.0.1:9999/api/v1/' }).ia.baseUrl, 'http://127.0.0.1:9999/api/v1');
  assert.throws(() => cargarConfig({ OPENROUTER_BASE_URL: 'http://ejemplo.com/api' }), /https/);
});
