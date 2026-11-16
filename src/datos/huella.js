import { createHash } from 'node:crypto';

/**
 * Huella de un comentario (sha256 de id_cliente + comentario). MongoDB y PostgreSQL la
 * guardan con índice único para poder volver a cargar el CSV sin duplicar registros.
 */
export const huella = (registro) =>
  createHash('sha256').update(`${registro.id_cliente}\u0000${registro.comentario}`).digest('hex');
