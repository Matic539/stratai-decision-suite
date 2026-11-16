/**
 * Limitador simple por IP (ventana fija) para proteger la cuota de la llave de IA.
 * Los modelos gratuitos de OpenRouter permiten 20 consultas por minuto y 50 por día.
 */
export function crearLimitador({ maximo, ventanaMs = 60_000, ahora = () => Date.now() }) {
  const registros = new Map();
  return function limitador(req, res, next) {
    const clave = req.ip ?? 'desconocido';
    const t = ahora();
    const previo = registros.get(clave);
    const actual = !previo || t - previo.inicio >= ventanaMs ? { inicio: t, cuenta: 0 } : previo;
    actual.cuenta += 1;
    registros.set(clave, actual);
    if (actual.cuenta > maximo) {
      const espera = Math.ceil((actual.inicio + ventanaMs - t) / 1000);
      res.set('Retry-After', String(espera));
      return res.status(429).json({ error: `Demasiadas consultas al Comité. Espera ${espera} s.` });
    }
    return next();
  };
}
