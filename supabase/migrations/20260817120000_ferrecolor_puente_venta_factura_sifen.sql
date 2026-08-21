-- ============================================================================
-- Puente Venta -> Factura electronica (SIFEN). ADITIVA E IDEMPOTENTE.
-- Solo schema ferrecolor (mono-sucursal). Convive con el camino TICKET actual.
--
-- Que hace:
--   * ventas.factura_id          -> linkea la venta con la factura ERP creada.
--   * facturas.origen_venta_id   -> trazabilidad inversa factura -> venta.
--   * facturas.cliente_razon_social / cliente_ruc -> snapshot denormalizado del
--     receptor al momento de facturar (para listados/impresion; la emision SIFEN
--     real sigue leyendo el cliente via cliente_id).
--   * factura_items.tipo_iva     -> tasa por item (EXENTA|5%|10%) denormalizada.
--     Nota: el builder SIFEN infiere la tasa desde (subtotal, iva); esta columna
--     es informativa/consistente con ventas_items, no altera la emision.
--
-- Todo ADD COLUMN IF NOT EXISTS: aditivo, no borra ni cambia columnas existentes.
-- ============================================================================

-- Link venta -> factura ERP.
ALTER TABLE ferrecolor.ventas
  ADD COLUMN IF NOT EXISTS factura_id uuid;
CREATE INDEX IF NOT EXISTS ventas_factura_id_idx
  ON ferrecolor.ventas (empresa_id, factura_id);

-- Trazabilidad inversa + snapshot del receptor en la factura.
ALTER TABLE ferrecolor.facturas
  ADD COLUMN IF NOT EXISTS origen_venta_id uuid;
ALTER TABLE ferrecolor.facturas
  ADD COLUMN IF NOT EXISTS cliente_razon_social text;
ALTER TABLE ferrecolor.facturas
  ADD COLUMN IF NOT EXISTS cliente_ruc text;
CREATE INDEX IF NOT EXISTS facturas_origen_venta_id_idx
  ON ferrecolor.facturas (empresa_id, origen_venta_id);

-- Tasa de IVA por linea (denormalizacion consistente con ventas_items.tipo_iva).
ALTER TABLE ferrecolor.factura_items
  ADD COLUMN IF NOT EXISTS tipo_iva text;

COMMENT ON COLUMN ferrecolor.ventas.factura_id IS
  'Factura ERP generada por el puente venta->factura (SIFEN). NULL si la venta fue solo ticket.';
COMMENT ON COLUMN ferrecolor.facturas.origen_venta_id IS
  'Venta que origino esta factura via el puente venta->factura. NULL para facturas manuales/suscripcion.';
COMMENT ON COLUMN ferrecolor.facturas.cliente_razon_social IS
  'Snapshot de razon social del receptor al facturar (denormalizado para listados/impresion).';
COMMENT ON COLUMN ferrecolor.facturas.cliente_ruc IS
  'Snapshot de RUC del receptor al facturar (denormalizado para listados/impresion).';
COMMENT ON COLUMN ferrecolor.factura_items.tipo_iva IS
  'Tasa de IVA de la linea (EXENTA|5%|10%). Informativa: SIFEN infiere la tasa desde subtotal/iva.';
