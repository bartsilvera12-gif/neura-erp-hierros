-- ============================================================================
-- Campos de FACTURACION en clientes (Ferrecolor). ADITIVA E IDEMPOTENTE.
-- Solo schema ferrecolor (mono-sucursal).
--
-- Que agrega (replicado de la UX de darocha, adaptado al backend ferrecolor):
--   * nombre_facturacion -> nombre alternativo para emitir la factura (opcional).
--     Si queda NULL, la emision usa empresa/razon social o nombre de contacto.
--   * nivel_precio        -> precio por defecto al cargar productos en
--     presupuestos/pedidos/ventas (minorista|mayorista|distribuidor).
--   * es_contribuyente    -> marca de persona contribuyente inscripta en la SET.
--     Semantica de negocio: con es_contribuyente + RUC, el submit tambien setea
--     sifen_receptor_manual=true y sifen_receptor_naturaleza='contribuyente_paraguayo'
--     (el receptor SIFEN B2B se arma desde esas columnas, no desde es_contribuyente).
--
-- Todo ADD COLUMN IF NOT EXISTS: aditivo, no borra ni cambia columnas existentes.
-- ============================================================================

ALTER TABLE ferrecolor.clientes
  ADD COLUMN IF NOT EXISTS nombre_facturacion text;

ALTER TABLE ferrecolor.clientes
  ADD COLUMN IF NOT EXISTS nivel_precio text NOT NULL DEFAULT 'minorista'
  CHECK (nivel_precio IN ('minorista','mayorista','distribuidor'));

ALTER TABLE ferrecolor.clientes
  ADD COLUMN IF NOT EXISTS es_contribuyente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ferrecolor.clientes.nombre_facturacion IS
  'Nombre alternativo para emitir la factura (opcional). NULL -> se usa razon social o nombre de contacto.';
COMMENT ON COLUMN ferrecolor.clientes.nivel_precio IS
  'Nivel de precio por defecto al cargar productos (minorista|mayorista|distribuidor).';
COMMENT ON COLUMN ferrecolor.clientes.es_contribuyente IS
  'Persona contribuyente inscripta en la SET. Con RUC cargado, la factura sale B2B (evita rechazo 0301).';
