-- ============================================================================
-- Consulta analítica de la guía (JOIN + GROUP BY): ingreso en riesgo por iniciativa.
-- El dinero sale de la tabla clientes en el momento de la consulta; por eso, si cambia
-- el valor mensual de un cliente (desafío 11), cambia aquí sin tocar feedback_clientes.
--
-- Uso, desde la carpeta del proyecto:
--   psql -U stratai_app -d stratai_db
--   \i sql/consulta_ingreso_en_riesgo.sql
-- ============================================================================
SELECT i.titulo_corto                         AS iniciativa,
       i.score_rice,
       i.reach_calculado                      AS reach,
       COUNT(f.id_feedback)                   AS total_menciones,
       COALESCE(SUM(c.valor_mensual_usd), 0)  AS ingreso_mensual_en_juego_usd
FROM iniciativas_rice i
LEFT JOIN feedback_clientes f ON i.id_iniciativa = f.id_iniciativa
LEFT JOIN clientes c          ON f.id_cliente = c.id_cliente
GROUP BY i.id_iniciativa, i.titulo_corto, i.score_rice, i.reach_calculado
ORDER BY i.score_rice DESC, ingreso_mensual_en_juego_usd DESC;
