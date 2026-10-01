-- Nota de crédito de ANULACIÓN TOTAL sobre facturas sin saldo (p. ej. contado nunca cobrada).
-- Relaja el límite de `nota_credito_aplicar_aprobacion_set`: la NC puede llegar hasta el TOTAL
-- de la factura (no solo el saldo), permitiendo dejar sin efecto una factura con saldo 0.
-- Retrocompatible: para NC normales (monto = saldo ≤ total) el comportamiento no cambia.
-- La factura pasa a estado 'Corregida NC' cuando el saldo resultante llega a 0 (lógica ya existente).
--
-- NOTA multi-tenant: en instancias dedicadas la función se invoca en el schema del tenant
-- (NEURA_CLIENT_SCHEMA). El schema `hierros` fue parcheado en vivo con esta misma lógica.

CREATE OR REPLACE FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(
  p_data_schema text,
  p_nota_credito_id uuid,
  p_factura_id uuid,
  p_empresa_id uuid,
  p_monto numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $function$
DECLARE
  s text := btrim(p_data_schema);
  fq text := quote_ident(btrim(p_data_schema));
  saldo_act numeric;
  monto_act numeric;
  otra uuid;
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'nota_credito_aplicar_aprobacion_set: schema vacío';
  END IF;

  EXECUTE format(
    'SELECT id FROM %s.nota_credito
     WHERE factura_id = $1 AND empresa_id = $2 AND estado_erp = ''aprobada'' AND id <> $3
     LIMIT 1',
    fq
  ) INTO otra USING p_factura_id, p_empresa_id, p_nota_credito_id;
  IF otra IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe otra nota de crédito aprobada para esta factura';
  END IF;

  EXECUTE format(
    'SELECT saldo, monto FROM %s.facturas WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
    fq
  ) INTO saldo_act, monto_act USING p_factura_id, p_empresa_id;

  IF saldo_act IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  -- La NC no puede superar el TOTAL de la factura. Permite anulación total aunque el
  -- saldo sea 0 (contado nunca cobrada que se deja sin efecto por NC).
  IF p_monto > GREATEST(saldo_act, monto_act) + 0.02 THEN
    RAISE EXCEPTION 'El monto de la NC (%) supera el total de la factura (%)', p_monto, monto_act;
  END IF;

  EXECUTE format(
    'UPDATE %s.facturas SET
       saldo = GREATEST(0::numeric, saldo - $1),
       estado = CASE
         WHEN estado = ''Anulado'' THEN ''Anulado''
         WHEN GREATEST(0::numeric, saldo - $1) <= 0.0001 THEN ''Corregida NC''
         ELSE estado
       END,
       updated_at = now()
     WHERE id = $2 AND empresa_id = $3',
    fq
  ) USING p_monto, p_factura_id, p_empresa_id;

  EXECUTE format(
    'UPDATE %s.nota_credito SET estado_erp = ''aprobada'', updated_at = now()
     WHERE id = $1 AND empresa_id = $2 AND estado_erp <> ''anulada_borrador''',
    fq
  ) USING p_nota_credito_id, p_empresa_id;
END;
$function$;

REVOKE ALL ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) TO service_role;
