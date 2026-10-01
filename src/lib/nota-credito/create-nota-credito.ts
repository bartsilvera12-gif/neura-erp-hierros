import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  buildSifenCancelacionPreview,
  normalizePlazoCancelacionHoras,
} from "@/lib/sifen/sifen-cancelacion-rules";
import { validarXmlFirmadoFacturaOrigenParaNc } from "@/lib/sifen/validar-factura-origen-xml-para-nc";
import type { NotaCreditoEventoTipo } from "./types";

function trimMotivo(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type CreateNotaCreditoParams = {
  supabase: AppSupabaseClient;
  empresaId: string;
  facturaId: string;
  authUserId: string;
  authEmail: string | null;
  authNombre: string | null;
  motivo: string;
  observacionInterna: string | null;
};

export type CreateNotaCreditoResult =
  | { ok: true; nota_credito_id: string }
  | { ok: false; status: number; error: string };

async function insertEvento(
  supabase: AppSupabaseClient,
  row: {
    empresa_id: string;
    nota_credito_id: string;
    actor_user_id: string;
    tipo_evento: NotaCreditoEventoTipo;
    detalle_json: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("nota_credito_evento").insert(row);
  if (error) throw new Error(error.message);
}

/**
 * Crea NC en borrador + fila electrónica en sin_envio + eventos de auditoría.
 * No modifica saldo de la factura (solo al aprobar NC en fases posteriores).
 */
export async function createNotaCreditoBorrador(p: CreateNotaCreditoParams): Promise<CreateNotaCreditoResult> {
  const motivo = trimMotivo(p.motivo);
  if (motivo == null || motivo.length < 5) {
    return { ok: false, status: 400, error: "El motivo es obligatorio (mínimo 5 caracteres)." };
  }
  if (motivo.length > 2000) {
    return { ok: false, status: 400, error: "El motivo no puede superar 2000 caracteres." };
  }

  const obs =
    p.observacionInterna == null || String(p.observacionInterna).trim() === ""
      ? null
      : String(p.observacionInterna).trim().slice(0, 4000);

  const { data: factura, error: errF } = await p.supabase
    .from("facturas")
    .select("id, empresa_id, cliente_id, monto, saldo, estado, moneda, numero_factura")
    .eq("id", p.facturaId)
    .eq("empresa_id", p.empresaId)
    .maybeSingle();

  if (errF) {
    return { ok: false, status: 400, error: errF.message };
  }
  if (!factura) {
    return { ok: false, status: 404, error: "Factura no encontrada." };
  }

  const estadoFactura = String((factura as { estado?: string }).estado ?? "");
  if (estadoFactura === "Anulado") {
    return { ok: false, status: 409, error: "La factura está anulada; no corresponde nota de crédito." };
  }

  const saldo = num((factura as { saldo?: unknown }).saldo);
  const montoFactura = num((factura as { monto?: unknown }).monto);
  // Saldo 0 permitido: NC total de anulación (monto = total de la factura). Ver `montoNc` abajo.
  if (montoFactura <= 0) {
    return { ok: false, status: 409, error: "La factura no tiene monto; no corresponde nota de crédito." };
  }

  const monedaRaw = String((factura as { moneda?: string }).moneda ?? "GS").toUpperCase();
  const monedaSnapshot = monedaRaw === "USD" ? "USD" : "GS";

  const { data: feRow, error: errFe } = await p.supabase
    .from("factura_electronica")
    .select("id, factura_id, estado_sifen, sifen_aprobado_at, sifen_cancelado_at, cdc, xml_firmado_path")
    .eq("factura_id", p.facturaId)
    .eq("empresa_id", p.empresaId)
    .maybeSingle();

  if (errFe) {
    return { ok: false, status: 400, error: errFe.message };
  }
  if (!feRow) {
    return { ok: false, status: 409, error: "No hay documento electrónico asociado a esta factura." };
  }

  const estadoSifen = String((feRow as { estado_sifen?: string }).estado_sifen ?? "");
  if (estadoSifen !== "aprobado") {
    return {
      ok: false,
      status: 409,
      error: "Solo se puede crear nota de crédito cuando el documento electrónico está aprobado por SET.",
    };
  }

  const [{ data: cfg }, pagosRes] = await Promise.all([
    p.supabase
      .from("empresa_sifen_config")
      .select("sifen_plazo_cancelacion_horas")
      .eq("empresa_id", p.empresaId)
      .maybeSingle(),
    p.supabase
      .from("pagos")
      .select("monto")
      .eq("factura_id", p.facturaId)
      .eq("empresa_id", p.empresaId),
  ]);

  if (pagosRes.error) {
    return { ok: false, status: 400, error: pagosRes.error.message };
  }

  const pagosRows = (pagosRes.data ?? []) as { monto?: unknown }[];
  const pagosCount = pagosRows.length;
  const sumaPagos = pagosRows.reduce((s, r) => s + num(r.monto), 0);

  const plazo = normalizePlazoCancelacionHoras(
    cfg != null ? (cfg as { sifen_plazo_cancelacion_horas?: unknown }).sifen_plazo_cancelacion_horas : 48
  );

  const preview = buildSifenCancelacionPreview({
    estadoSifen,
    sifenAprobadoAtIso:
      (feRow as { sifen_aprobado_at?: string | null }).sifen_aprobado_at == null
        ? null
        : String((feRow as { sifen_aprobado_at?: string | null }).sifen_aprobado_at),
    sifenCanceladoAtIso:
      (feRow as { sifen_cancelado_at?: string | null }).sifen_cancelado_at == null
        ? null
        : String((feRow as { sifen_cancelado_at?: string | null }).sifen_cancelado_at),
    plazoHoras: plazo,
    pagosCount,
    nowMs: Date.now(),
  });

  if (preview.puede_cancelar) {
    return {
      ok: false,
      status: 409,
      error:
        "Todavía podés cancelar el documento electrónico dentro del plazo. Usá «Cancelar factura (DE)» y emití una nueva factura; no corresponde crear nota de crédito.",
    };
  }

  // NC total de anulación cuando la factura no tiene saldo (p. ej. contado nunca cobrada):
  // el monto de la NC es el total de la factura. Si hay saldo pendiente, se acredita ese saldo.
  const montoNc = saldo > 0 ? saldo : montoFactura;
  // La coherencia saldo = monto − pagos solo aplica cuando hay saldo pendiente.
  if (saldo > 0) {
    const esperadoSaldo = Math.max(0, montoFactura - sumaPagos);
    if (Math.abs(saldo - esperadoSaldo) > 0.02) {
      return {
        ok: false,
        status: 409,
        error: `El saldo pendiente (${saldo}) no coincide con monto − pagos (${esperadoSaldo}). Revisá la factura antes de crear una nota de crédito.`,
      };
    }
  }

  const { data: existeAprobada } = await p.supabase
    .from("nota_credito")
    .select("id")
    .eq("factura_id", p.facturaId)
    .eq("empresa_id", p.empresaId)
    .eq("estado_erp", "aprobada")
    .maybeSingle();

  if (existeAprobada) {
    return {
      ok: false,
      status: 409,
      error: "Ya existe una nota de crédito aprobada para esta factura.",
    };
  }

  const feId = String((feRow as { id: string }).id);
  const cdcOrigen =
    (feRow as { cdc?: string | null }).cdc == null || String((feRow as { cdc?: string | null }).cdc).trim() === ""
      ? null
      : String((feRow as { cdc?: string | null }).cdc).trim();

  if (cdcOrigen == null || cdcOrigen.length !== 44) {
    return {
      ok: false,
      status: 409,
      error: "El documento electrónico no tiene CDC válido (44 dígitos); no se puede crear nota de crédito.",
    };
  }

  const vXml = await validarXmlFirmadoFacturaOrigenParaNc(
    p.supabase,
    p.empresaId,
    {
      id: feId,
      factura_id: String((feRow as { factura_id: string }).factura_id),
      cdc: cdcOrigen,
      xml_firmado_path:
        (feRow as { xml_firmado_path?: string | null }).xml_firmado_path == null
          ? null
          : String((feRow as { xml_firmado_path?: string | null }).xml_firmado_path).trim() || null,
    },
    {
      cdcEsperado: cdcOrigen,
      facturaIdEsperado: p.facturaId,
      numeroFacturaErp: String((factura as { numero_factura?: string }).numero_factura ?? ""),
    }
  );
  if (!vXml.ok) {
    return { ok: false, status: vXml.status, error: vXml.message };
  }

  const clienteId = String((factura as { cliente_id: string }).cliente_id);

  const insertNc = {
    empresa_id: p.empresaId,
    cliente_id: clienteId,
    factura_id: p.facturaId,
    monto: montoNc,
    motivo,
    observacion_interna: obs,
    estado_erp: "borrador" as const,
    created_by_user_id: p.authUserId,
    created_by_email_snapshot: p.authEmail,
    created_by_nombre_snapshot: p.authNombre,
    saldo_previo_snapshot: saldo,
    monto_factura_snapshot: montoFactura,
    suma_pagos_snapshot: sumaPagos,
    moneda_snapshot: monedaSnapshot,
    factura_electronica_origen_id: feId,
  };

  const { data: ncRow, error: errNc } = await p.supabase.from("nota_credito").insert(insertNc).select("id").single();

  if (errNc || !ncRow) {
    const msg = errNc?.message ?? "No se pudo crear la nota de crédito.";
    if (msg.includes("uq_nota_credito_factura_estado_activo") || msg.includes("duplicate key")) {
      return {
        ok: false,
        status: 409,
        error: "Ya existe una nota de crédito en curso para esta factura (borrador o pendiente).",
      };
    }
    return { ok: false, status: 500, error: msg };
  }

  const ncId = String((ncRow as { id: string }).id);

  try {
    const { error: errNe } = await p.supabase.from("nota_credito_electronica").insert({
      empresa_id: p.empresaId,
      nota_credito_id: ncId,
      estado_sifen: "sin_envio",
      cdc_factura_origen: cdcOrigen,
    });
    if (errNe) throw new Error(errNe.message);

    await insertEvento(p.supabase, {
      empresa_id: p.empresaId,
      nota_credito_id: ncId,
      actor_user_id: p.authUserId,
      tipo_evento: "creacion",
      detalle_json: {
        factura_id: p.facturaId,
        cliente_id: clienteId,
        monto: montoNc,
        motivo,
        observacion_interna: obs,
        saldo_previo_snapshot: saldo,
        monto_factura_snapshot: montoFactura,
        suma_pagos_snapshot: sumaPagos,
        moneda_snapshot: monedaSnapshot,
        factura_electronica_origen_id: feId,
        cdc_factura_origen: cdcOrigen,
        estado_erp_inicial: "borrador",
        estado_sifen_inicial: "sin_envio",
        cancelacion_preview: preview,
      },
    });

    await insertEvento(p.supabase, {
      empresa_id: p.empresaId,
      nota_credito_id: ncId,
      actor_user_id: p.authUserId,
      tipo_evento: "validacion",
      detalle_json: {
        resultado: "ok",
        reglas: {
          puede_cancelar_de: false,
          saldo_pendiente: saldo,
          suma_pagos: sumaPagos,
          monto_factura: montoFactura,
        },
      },
    });
  } catch (e) {
    await p.supabase.from("nota_credito").delete().eq("id", ncId).eq("empresa_id", p.empresaId);
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : "Error al registrar la nota de crédito.",
    };
  }

  return { ok: true, nota_credito_id: ncId };
}
