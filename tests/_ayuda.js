import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const leerArchivo = (rutaRelativa) =>
  fs.readFileSync(fileURLToPath(new URL(rutaRelativa, import.meta.url)), 'utf8');

export const leerJSON = (rutaRelativa) => JSON.parse(leerArchivo(rutaRelativa));
