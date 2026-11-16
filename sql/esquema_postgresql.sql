SET client_encoding = 'UTF8';

-- ============================================================================
-- INSTANCIA 3: ESQUEMA RELACIONAL POSTGRESQL PARA DECISIONES ESTRATÉGICAS CON IA
-- Base de datos: stratai_db (PostgreSQL 14 o superior; probado en 16, 17 y en PGlite, basado en 18)
--
-- Adaptado de esquema_mysql.sql de la guía. Cambios principales:
--   * AUTO_INCREMENT -> GENERATED ALWAYS AS IDENTITY; TINYINT(1) -> BOOLEAN;
--     DATETIME -> TIMESTAMPTZ; JSON -> JSONB; ENUM -> CHECK.
--   * score_rice sigue siendo una columna GENERATED ALWAYS AS ... STORED, pero con NUMERIC:
--     en PostgreSQL "confidence_pct / 100" entre enteros da 0, y ROUND sobre NUMERIC
--     redondea mitad hacia arriba, igual que el navegador y MongoDB Atlas.
--   * Alcance, impacto y confianza ya no son valores fijos de la semilla: los calcula la
--     vista v_metricas_rice desde los comentarios (misma fórmula de las Instancias 1 y 2) y
--     los triggers los mantienen al día. Si cambia el valor mensual de un cliente
--     (desafío 11), cambian el ingreso en riesgo y el score sin tocar los comentarios.
--   * Tabla nueva niveles_riesgo: el peso de impacto depende solo del nivel de riesgo.
--     En el esquema MySQL se repetía en cada comentario (dependencia transitiva, no es 3FN).
--   * Los comentarios no van en este archivo: los carga "npm run cargar:postgres",
--     clasificados por el mismo motor de reglas de las otras instancias.
--   * Rol stratai_app con permisos mínimos (sin DDL, sin superusuario).
--
-- Cómo ejecutarlo (como administrador, por ejemplo el usuario postgres):
--   psql -U postgres -c "CREATE DATABASE stratai_db"
--   psql -U postgres -d stratai_db -f sql/esquema_postgresql.sql
--   psql -U postgres -d stratai_db        y dentro de psql: \password stratai_app
--
-- Se puede volver a ejecutar sin perder datos (IF NOT EXISTS, OR REPLACE, ON CONFLICT).
-- La primera línea (SET client_encoding) hace que los acentos se guarden bien aunque la
-- consola de Windows use otra página de códigos.
-- ============================================================================


-- 0. Niveles de riesgo (catálogo)
CREATE TABLE IF NOT EXISTS niveles_riesgo (
    id_riesgo     VARCHAR(20) PRIMARY KEY,
    etiqueta      VARCHAR(60) NOT NULL UNIQUE,
    peso_impacto  NUMERIC(3, 1) NOT NULL CHECK (peso_impacto > 0)
);

-- 1. Clientes: única fuente de verdad del valor mensual (MRR) de cada cuenta
CREATE TABLE IF NOT EXISTS clientes (
    id_cliente         VARCHAR(20) PRIMARY KEY,
    nombre_empresa     VARCHAR(120) NOT NULL,
    segmento           VARCHAR(20) NOT NULL
                       CONSTRAINT ck_clientes_segmento CHECK (segmento IN ('Enterprise', 'PyME', 'Startup')),
    valor_mensual_usd  NUMERIC(10, 2) NOT NULL CHECK (valor_mensual_usd >= 0),
    fecha_alta         DATE NOT NULL DEFAULT CURRENT_DATE,
    activo             BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Iniciativas estratégicas (matriz RICE)
CREATE TABLE IF NOT EXISTS iniciativas_rice (
    id_iniciativa       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_categoria    VARCHAR(50) NOT NULL UNIQUE,
    titulo              VARCHAR(150) NOT NULL,
    titulo_corto        VARCHAR(40) NOT NULL,
    esfuerzo_meses      NUMERIC(4, 1) NOT NULL CHECK (esfuerzo_meses > 0),
    costo_estimado_usd  NUMERIC(10, 2) NOT NULL CHECK (costo_estimado_usd >= 0),
    eficacia_relativa   NUMERIC(3, 1) NOT NULL DEFAULT 1.0,
    -- Métricas calculadas desde los comentarios (las actualiza actualizar_metricas_rice)
    reach_calculado     INTEGER NOT NULL DEFAULT 0 CHECK (reach_calculado >= 0),
    impact_promedio     NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (impact_promedio >= 0),
    confidence_pct      INTEGER NOT NULL DEFAULT 0 CHECK (confidence_pct BETWEEN 0 AND 100),
    -- Score RICE = alcance × impacto × confianza / esfuerzo, redondeado (mitad hacia arriba)
    score_rice          INTEGER GENERATED ALWAYS AS (
        ROUND(reach_calculado * impact_promedio * confidence_pct / (100 * esfuerzo_meses))
    ) STORED
);

-- 3. Comentarios de clientes: no guardan dinero, solo referencias (FOREIGN KEY)
CREATE TABLE IF NOT EXISTS feedback_clientes (
    id_feedback     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_cliente      VARCHAR(20) NOT NULL,
    id_iniciativa   INTEGER NULL,          -- NULL = sin clasificar (revisión manual)
    id_riesgo       VARCHAR(20) NOT NULL,
    canal           VARCHAR(50) NOT NULL,
    comentario      TEXT NOT NULL CHECK (char_length(comentario) BETWEEN 1 AND 2000),
    huella          CHAR(64) NOT NULL UNIQUE,  -- sha256(id_cliente + comentario): recargar sin duplicar
    origen          VARCHAR(120) NOT NULL DEFAULT 'carga',
    fecha_registro  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_feedback_cliente FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente) ON DELETE CASCADE,
    CONSTRAINT fk_feedback_iniciativa FOREIGN KEY (id_iniciativa) REFERENCES iniciativas_rice (id_iniciativa) ON DELETE SET NULL,
    CONSTRAINT fk_feedback_riesgo FOREIGN KEY (id_riesgo) REFERENCES niveles_riesgo (id_riesgo)
);
CREATE INDEX IF NOT EXISTS ix_feedback_iniciativa ON feedback_clientes (id_iniciativa);
CREATE INDEX IF NOT EXISTS ix_feedback_cliente ON feedback_clientes (id_cliente);

-- 4. Simulaciones financieras y dictámenes del Comité IA (auditoría)
CREATE TABLE IF NOT EXISTS simulaciones_estrategicas (
    id_simulacion            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_iniciativa_vinculada  INTEGER NULL,
    -- Rangos amplios: el simulador acepta hasta 1.000.000 de clientes y precios de USD 1.000.000
    clientes_base            NUMERIC(12, 1) NOT NULL CHECK (clientes_base >= 0),
    precio_base_usd          NUMERIC(14, 2) NOT NULL,
    precio_simulado_usd      NUMERIC(14, 2) NOT NULL,
    churn_base_pct           NUMERIC(5, 2) NOT NULL,
    churn_proyectado_pct     NUMERIC(5, 2) NOT NULL,
    presupuesto_usd          NUMERIC(14, 2) NOT NULL,
    pct_retencion            NUMERIC(5, 2) NOT NULL CHECK (pct_retencion BETWEEN 0 AND 100),
    ltv_cac_ratio            NUMERIC NULL,
    roi_12m_pct              NUMERIC NULL,          -- NULL si no hay inversión
    beneficio_neto_12m_usd   NUMERIC(20, 2) NOT NULL,
    proveedor_ia             VARCHAR(30) NOT NULL DEFAULT 'local',
    modelo_ia                VARCHAR(120) NULL,
    dictamen_ia_json         JSONB NOT NULL,
    detalle_json             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- matriz, verificación de cifras, etc.
    fecha_simulacion         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_sim_iniciativa FOREIGN KEY (id_iniciativa_vinculada) REFERENCES iniciativas_rice (id_iniciativa) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_simulaciones_fecha ON simulaciones_estrategicas (fecha_simulacion DESC);

-- ============================================================================
-- MÉTRICAS RICE CALCULADAS POR EL MOTOR RELACIONAL (JOIN + GROUP BY)
-- Misma fórmula que el navegador (public/js/core/rice.js) y el pipeline de MongoDB:
--   clientes   = clientes distintos que reclaman en la iniciativa
--   ingreso    = suma del valor mensual de esos clientes (Revenue at Risk)
--   impacto    = promedio por cliente del mayor peso de impacto, a 2 decimales
--   alcance    = ROUND(clientes × 12 + ingreso / 120)
--   confianza  = LEAST(95, 70 + 6 × clientes)
-- ============================================================================
CREATE OR REPLACE VIEW v_metricas_rice AS
WITH por_cliente AS (
    -- Etapa 1: un registro por iniciativa y cliente (un cliente que reclama varias veces cuenta una vez)
    SELECT f.id_iniciativa,
           f.id_cliente,
           MAX(c.valor_mensual_usd)                          AS valor_mensual_usd,
           MAX(r.peso_impacto)                               AS peso_impacto,
           COUNT(*)                                          AS menciones,
           COUNT(*) FILTER (WHERE f.id_riesgo = 'churn')     AS churn,
           COUNT(*) FILTER (WHERE f.id_riesgo = 'upsell')    AS upsell,
           COUNT(*) FILTER (WHERE f.id_riesgo = 'friccion')  AS friccion
    FROM feedback_clientes f
    JOIN clientes c       ON c.id_cliente = f.id_cliente
    JOIN niveles_riesgo r ON r.id_riesgo = f.id_riesgo
    WHERE f.id_iniciativa IS NOT NULL
    GROUP BY f.id_iniciativa, f.id_cliente
),
por_iniciativa AS (
    -- Etapa 2: por iniciativa, ingreso en riesgo e impacto promedio
    SELECT id_iniciativa,
           COUNT(*)::INTEGER                           AS clientes_afectados,
           SUM(menciones)::INTEGER                     AS total_menciones,
           ARRAY_AGG(id_cliente ORDER BY id_cliente)   AS ids_clientes,
           SUM(valor_mensual_usd)                      AS ingreso_en_riesgo_usd,
           ROUND(AVG(peso_impacto), 2)                 AS impacto_promedio,
           SUM(churn)::INTEGER                         AS churn,
           SUM(upsell)::INTEGER                        AS upsell,
           SUM(friccion)::INTEGER                      AS friccion
    FROM por_cliente
    GROUP BY id_iniciativa
)
-- Etapa 3: alcance y confianza (parámetros de PARAMETROS_RICE en catalogo.js)
SELECT p.*,
       ROUND(p.clientes_afectados * 12 + p.ingreso_en_riesgo_usd / 120.0)::INTEGER AS reach,
       LEAST(95, 70 + 6 * p.clientes_afectados)::INTEGER                           AS confidence_pct
FROM por_iniciativa p;

-- Copia las métricas a iniciativas_rice; la columna generada recalcula score_rice sola
CREATE OR REPLACE FUNCTION actualizar_metricas_rice() RETURNS void
LANGUAGE sql AS $$
    UPDATE iniciativas_rice i
    SET reach_calculado = COALESCE(m.reach, 0),
        impact_promedio = COALESCE(m.impacto_promedio, 0),
        confidence_pct  = COALESCE(m.confidence_pct, 0)
    FROM iniciativas_rice base
    LEFT JOIN v_metricas_rice m ON m.id_iniciativa = base.id_iniciativa
    WHERE i.id_iniciativa = base.id_iniciativa
      AND (i.reach_calculado, i.impact_promedio, i.confidence_pct)
          IS DISTINCT FROM (COALESCE(m.reach, 0), COALESCE(m.impacto_promedio, 0), COALESCE(m.confidence_pct, 0));
$$;

CREATE OR REPLACE FUNCTION tg_actualizar_metricas_rice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM actualizar_metricas_rice();
    RETURN NULL;
END;
$$;

-- Cualquier cambio en comentarios, en el valor mensual de un cliente o en los pesos de riesgo
-- actualiza las métricas RICE en la misma transacción.
CREATE OR REPLACE TRIGGER trg_feedback_metricas_rice
    AFTER INSERT OR UPDATE OR DELETE ON feedback_clientes
    FOR EACH STATEMENT EXECUTE FUNCTION tg_actualizar_metricas_rice();
CREATE OR REPLACE TRIGGER trg_feedback_truncate_metricas_rice
    AFTER TRUNCATE ON feedback_clientes
    FOR EACH STATEMENT EXECUTE FUNCTION tg_actualizar_metricas_rice();
CREATE OR REPLACE TRIGGER trg_clientes_metricas_rice
    AFTER UPDATE OF valor_mensual_usd ON clientes
    FOR EACH STATEMENT EXECUTE FUNCTION tg_actualizar_metricas_rice();
CREATE OR REPLACE TRIGGER trg_riesgos_metricas_rice
    AFTER UPDATE OF peso_impacto ON niveles_riesgo
    FOR EACH STATEMENT EXECUTE FUNCTION tg_actualizar_metricas_rice();

-- Matriz RICE que lee la aplicación (score desde la columna generada)
CREATE OR REPLACE VIEW v_matriz_rice AS
SELECT i.codigo_categoria       AS categoria_id,
       i.titulo,
       i.titulo_corto,
       m.clientes_afectados,
       m.total_menciones,
       m.ids_clientes,
       m.ingreso_en_riesgo_usd,
       i.impact_promedio        AS impacto_promedio,
       i.reach_calculado        AS reach,
       i.confidence_pct,
       i.esfuerzo_meses,
       i.costo_estimado_usd,
       i.eficacia_relativa,
       i.score_rice,
       m.churn,
       m.upsell,
       m.friccion
FROM iniciativas_rice i
JOIN v_metricas_rice m ON m.id_iniciativa = i.id_iniciativa;

-- ============================================================================
-- DATOS SEMILLA (catálogos). Deben coincidir con public/js/core/catalogo.js
-- (lo comprueba tests/postgresql.test.js).
-- ============================================================================
INSERT INTO niveles_riesgo (id_riesgo, etiqueta, peso_impacto) VALUES
    ('churn',    'Alto Riesgo de Fuga (Churn)',    3.0),
    ('upsell',   'Oportunidad Upsell / Expansión', 2.5),
    ('friccion', 'Fricción Operativa',             2.0)
ON CONFLICT (id_riesgo) DO UPDATE
    SET etiqueta = EXCLUDED.etiqueta, peso_impacto = EXCLUDED.peso_impacto;

INSERT INTO iniciativas_rice (codigo_categoria, titulo, titulo_corto, esfuerzo_meses, costo_estimado_usd, eficacia_relativa) VALUES
    ('integraciones_erp',    'Conector API e Integración ERP/Contable',              'Integración ERP',       2.0, 14000.00, 1.4),
    ('rendimiento_reportes', 'Optimización del Motor de Reportes y Velocidad',       'Reportes y velocidad',  1.5, 10500.00, 1.2),
    ('alertas_whatsapp',     'Módulo Premium de Alertas Automáticas por WhatsApp',   'Alertas WhatsApp',      1.2,  8500.00, 0.9),
    ('soporte_onboarding',   'Automatización de Onboarding y SLA de Soporte Rápido', 'Soporte y onboarding',  1.0,  6500.00, 0.8),
    ('packaging_precio',     'Reestructuración de Planes de Entrada y Precios',      'Planes y precios',      0.6,  4000.00, 0.7),
    -- Iniciativa propia (no está en la guía): esfuerzo, costo y eficacia son supuestos
    ('seguridad_auditoria',  'Control de Acceso por Roles y Auditoría de Usuarios',  'Seguridad y auditoría', 1.5, 11000.00, 1.3)
ON CONFLICT (codigo_categoria) DO UPDATE
    SET titulo = EXCLUDED.titulo,
        titulo_corto = EXCLUDED.titulo_corto,
        esfuerzo_meses = EXCLUDED.esfuerzo_meses,
        costo_estimado_usd = EXCLUDED.costo_estimado_usd,
        eficacia_relativa = EXCLUDED.eficacia_relativa;

-- Los 12 clientes de datos_ejemplo.csv. Los 5 primeros nombres y fechas vienen de la semilla
-- de la guía; el CSV no trae nombre ni fecha de alta, así que los otros 7 son ficticios.
-- ON CONFLICT DO NOTHING: volver a ejecutar el script no deshace el desafío 11.
INSERT INTO clientes (id_cliente, nombre_empresa, segmento, valor_mensual_usd, fecha_alta) VALUES
    ('C-101', 'Grupo Minero Andino',            'Enterprise', 1200.00, '2025-02-10'),
    ('C-102', 'Comercial del Sur',              'PyME',        250.00, '2025-05-14'),
    ('C-103', 'Holding Logístico Pacífico',     'Enterprise', 1500.00, '2024-11-01'),
    ('C-104', 'TechNova Studio',                'Startup',      90.00, '2026-01-20'),
    ('C-106', 'Corporación Industrial Norte',   'Enterprise', 1800.00, '2024-08-15'),
    ('C-105', 'Servicios Integrales Atacama',   'PyME',        300.00, '2025-03-03'),
    ('C-107', 'Distribuidora Valle Central',    'PyME',        280.00, '2025-06-18'),
    ('C-108', 'Nube Creativa Studio',           'Startup',      95.00, '2026-02-02'),
    ('C-109', 'Corporación Financiera Austral', 'Enterprise', 1400.00, '2024-10-07'),
    ('C-110', 'Ferretería Los Andes',           'PyME',        310.00, '2025-09-22'),
    ('C-111', 'Brote Digital',                  'Startup',      85.00, '2026-03-11'),
    ('C-112', 'Grupo Retail Cordillera',        'Enterprise', 2100.00, '2024-06-01')
ON CONFLICT (id_cliente) DO NOTHING;

DO $$ BEGIN PERFORM actualizar_metricas_rice(); END $$;

-- ============================================================================
-- ROL DE LA APLICACIÓN (mínimo privilegio): lee y escribe datos, no puede crear,
-- borrar ni modificar tablas. La contraseña se define aparte con \password stratai_app,
-- para que no quede escrita en este archivo.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stratai_app') THEN
        CREATE ROLE stratai_app LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO stratai_app;
GRANT SELECT ON niveles_riesgo TO stratai_app;
GRANT SELECT, INSERT ON clientes TO stratai_app;
GRANT UPDATE (segmento, valor_mensual_usd, activo) ON clientes TO stratai_app;
GRANT SELECT ON iniciativas_rice TO stratai_app;
GRANT UPDATE (reach_calculado, impact_promedio, confidence_pct) ON iniciativas_rice TO stratai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback_clientes TO stratai_app;
GRANT SELECT, INSERT ON simulaciones_estrategicas TO stratai_app;
GRANT SELECT ON v_metricas_rice, v_matriz_rice TO stratai_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO stratai_app;
