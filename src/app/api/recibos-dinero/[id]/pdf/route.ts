import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/recibos-dinero/[id]/pdf?auto=1
 * Recibo de dinero A4 imprimible (HTML). Documento interno NO fiscal.
 */
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtMonto(n: unknown, moneda: string): string {
  const v = Number(n) || 0;
  return (moneda === "USD" ? "USD " : "Gs. ") + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}
function fmtFecha(iso: unknown): string {
  if (!iso) return "—";
  try {
    return new Date(String(iso)).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(iso);
  }
}
const METODO_LBL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cheque: "Cheque", otro: "Otro" };

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const auto = new URL(request.url).searchParams.get("auto") === "1";
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });

  const rq = await ctx.supabase
    .from("recibos_dinero")
    .select("*")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (rq.error || !rq.data) return new NextResponse("Recibo no encontrado", { status: 404 });
  const r = rq.data as Record<string, unknown>;

  // Número de factura vinculada (por la venta de origen). Documento interno; el FAC es solo referencia.
  let numeroFactura: string | null = null;
  const ventaId = r.venta_id ? String(r.venta_id) : null;
  if (ventaId) {
    const fq = await ctx.supabase
      .from("facturas")
      .select("numero_factura")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("origen_venta_id", ventaId)
      .maybeSingle();
    if (!fq.error && fq.data) {
      const nf = (fq.data as { numero_factura?: string }).numero_factura;
      numeroFactura = typeof nf === "string" && nf.trim() ? nf.trim() : null;
    }
  }

  // Saldo pendiente al momento del cobro (snapshot histórico e inmutable):
  // total de la cuenta − suma de cobros de esa cuenta hasta e incluyendo este cobro (por fecha).
  // Solo aplica a cobros de cuenta por cobrar (crédito); para venta contado no se muestra.
  let saldoPendiente: number | null = null;
  const cuentaId = r.cuenta_por_cobrar_id ? String(r.cuenta_por_cobrar_id) : null;
  const cobroId = r.cobro_cliente_id ? String(r.cobro_cliente_id) : null;
  if (cuentaId && cobroId) {
    const [ctaQ, cobQ] = await Promise.all([
      ctx.supabase
        .from("cuentas_por_cobrar")
        .select("total")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", cuentaId)
        .maybeSingle(),
      ctx.supabase
        .from("cobros_clientes")
        .select("created_at")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", cobroId)
        .maybeSingle(),
    ]);
    const total = Number((ctaQ.data as { total?: number | string } | null)?.total);
    const cobroCreatedAt = (cobQ.data as { created_at?: string } | null)?.created_at ?? null;
    if (Number.isFinite(total) && cobroCreatedAt) {
      const cobrosQ = await ctx.supabase
        .from("cobros_clientes")
        .select("monto, created_at")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("cuenta_por_cobrar_id", cuentaId);
      if (!cobrosQ.error && Array.isArray(cobrosQ.data)) {
        const pagadoHasta = (cobrosQ.data as { monto?: number | string; created_at?: string }[])
          .filter((c) => typeof c.created_at === "string" && c.created_at <= cobroCreatedAt)
          .reduce((acc, c) => acc + (Number(c.monto) || 0), 0);
        const s = total - pagadoHasta;
        saldoPendiente = s < 0 ? 0 : Math.round((s + Number.EPSILON) * 100) / 100;
      }
    }
  }

  const moneda = String(r.moneda ?? "PYG");
  const metodo = METODO_LBL[String(r.metodo_pago ?? "")] ?? (r.metodo_pago ?? "—");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.numero_recibo)} — Recibo de dinero</title>
<style>
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2937;background:#f3f4f6}
  .page{width:210mm;min-height:148mm;margin:0 auto;background:#fff;padding:16mm 16mm}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4FAEB2;padding-bottom:12px}
  .negocio{font-size:20px;font-weight:800}
  .tag{display:inline-block;margin-top:4px;background:#4FAEB2;color:#fff;font-size:13px;font-weight:700;letter-spacing:.06em;padding:4px 12px;border-radius:6px}
  .meta{text-align:right;font-size:13px}
  .meta .num{font-size:18px;font-weight:800;color:#4FAEB2}
  .row{display:flex;gap:24px;margin-top:16px;font-size:13px}
  .row .l{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .montobox{margin-top:18px;border:2px solid #4FAEB2;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
  .montobox .lbl{font-size:12px;text-transform:uppercase;color:#6b7280}
  .montobox .val{font-size:26px;font-weight:800;color:#1f2937}
  .det{margin-top:16px;font-size:13px;line-height:1.7}
  .det b{color:#374151}
  .firma{margin-top:46px;display:flex;justify-content:flex-end}
  .firma .linea{width:240px;border-top:1px solid #9ca3af;text-align:center;padding-top:6px;font-size:12px;color:#6b7280}
  .legal{margin-top:26px;padding-top:12px;border-top:1px dashed #d1d5db;font-size:11px;color:#6b7280;text-align:center}
  .toolbar{position:sticky;top:0;background:#111827;padding:10px;text-align:center}
  .toolbar button{background:#4FAEB2;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-size:14px;cursor:pointer}
  .corte{display:none}
  @media print{
    body{background:#fff}.toolbar{display:none}
    .page{width:auto;min-height:auto;margin:0;padding:10mm}
    @page{size:A4 portrait;margin:10mm}
    .corte{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:6px;font-size:10px;color:#888;border-top:1px dashed #999}
    .corte span{flex:1;text-align:center;letter-spacing:1px;text-transform:uppercase}
  }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
<div class="page">
  ${membreteA4()}
  <div class="head">
    <div><div class="tag">RECIBO DE DINERO</div></div>
    <div class="meta">
      <div class="num">${esc(r.numero_recibo)}</div>
      <div>Fecha: ${fmtFecha(r.fecha)}</div>
      ${numeroFactura ? `<div>Factura: ${esc(numeroFactura)}</div>` : ""}
    </div>
  </div>

  <div class="row">
    <div style="flex:1"><div class="l">Recibí de</div><div><strong>${esc(r.cliente_nombre)}</strong>${r.cliente_documento ? ` · ${esc(r.cliente_documento)}` : ""}</div></div>
  </div>

  <div class="montobox">
    <div class="lbl">Monto recibido</div>
    <div class="val">${fmtMonto(r.monto, moneda)}</div>
  </div>

  <div class="det">
    ${numeroFactura ? `<div><b>Factura:</b> ${esc(numeroFactura)}</div>` : ""}
    ${r.concepto ? `<div><b>Concepto:</b> ${esc(r.concepto)}</div>` : ""}
    <div><b>Método de pago:</b> ${esc(metodo)}</div>
    ${r.referencia ? `<div><b>Referencia:</b> ${esc(r.referencia)}</div>` : ""}
    ${saldoPendiente !== null ? `<div><b>Saldo pendiente:</b> ${fmtMonto(saldoPendiente, moneda)}${saldoPendiente <= 0.001 ? " (cuenta cancelada)" : ""}</div>` : ""}
    ${r.observaciones ? `<div><b>Observaciones:</b> ${esc(r.observaciones)}</div>` : ""}
  </div>

  <div class="firma"><div class="linea">Recibido por${r.usuario_nombre ? `: ${esc(r.usuario_nombre)}` : ""}</div></div>

  <div class="legal">Documento interno no fiscal. No reemplaza factura legal.</div>
  <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
</div>
<script>try{ if (${auto ? "true" : "false"}) window.print(); }catch(e){}</script>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
