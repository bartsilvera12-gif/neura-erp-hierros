import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/presupuestos/[id]/pdf?auto=1
 *
 * Hoja de presupuesto A4 imprimible (HTML) — formato PRN (HIERROS VH).
 * El navegador imprime / guarda como PDF. NO fiscal, NO toca SIFEN, NO stock.
 */

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Número con separador de miles es-PY. `dec` decimales (0 para Gs, 2 para kilos). */
function fmtNum(n: unknown, dec = 0): string {
  const v = Number(n) || 0;
  return v.toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtFecha(iso: unknown): string {
  if (!iso) return "—";
  try {
    return new Date(String(iso)).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(iso);
  }
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const auto = new URL(request.url).searchParams.get("auto") === "1";

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const pq = await ctx.supabase
    .from("presupuestos")
    .select("*")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (pq.error || !pq.data) {
    return new NextResponse("Presupuesto no encontrado", { status: 404 });
  }
  const p = pq.data as Record<string, unknown>;

  const itq = await ctx.supabase
    .from("presupuesto_items")
    .select("producto_nombre, sku, codigo, articulo, cantidad, kilos, precio_unitario, total, precio_total")
    .eq("empresa_id", ctx.auth.empresa_id)
    .eq("presupuesto_id", id)
    .order("created_at", { ascending: true });
  const items = (itq.data ?? []) as Record<string, unknown>[];

  const moneda = String(p.moneda ?? "GS");
  const simb = moneda === "USD" ? "USD" : "GS";

  // Total de kilos (suma de la columna kilos de cada línea).
  const totalKilos = items.reduce((acc, it) => acc + (Number(it.kilos) || 0), 0);

  const filas = items
    .map((it, i) => {
      const codigo = String(it.codigo ?? it.sku ?? "");
      const articulo = String(it.articulo ?? it.producto_nombre ?? "");
      const totalLinea = Number(it.precio_total) > 0 ? it.precio_total : it.total;
      return `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(codigo)}</td>
        <td>${esc(articulo)}</td>
        <td class="r">${fmtNum(it.cantidad, 2)}</td>
        <td class="r">${fmtNum(it.kilos, 2)}</td>
        <td class="r">${fmtNum(it.precio_unitario, 0)}</td>
        <td class="r">${fmtNum(totalLinea, 0)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.numero_control)} — Presupuesto HIERROS VH</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; background: #f3f4f6; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 16mm 16mm; }
  /* Encabezado PRN: cliente a la izquierda, N°/Sucursal/Tel a la derecha */
  .prn-head { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8px; }
  .prn-cliente { font-size: 13px; line-height: 1.5; }
  .prn-cliente .senores { font-weight: 700; }
  .prn-cliente .nombre { font-weight: 700; text-decoration: underline; margin-top: 6px; }
  .prn-cliente .datos { color: #374151; margin-top: 2px; }
  .prn-meta { text-align: right; font-size: 13px; line-height: 1.6; }
  .prn-meta .num { font-size: 16px; font-weight: 800; }
  .cotiz { margin: 18px 0 6px; font-weight: 700; font-size: 13px; }
  table.items { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.items thead th { border-bottom: 2px solid #111827; text-align: left; padding: 6px 8px; font-weight: 700; }
  table.items thead th.r { text-align: right; }
  table.items thead th.c { text-align: center; }
  table.items tbody td { padding: 5px 8px; border-bottom: 1px solid #eef2f4; }
  table.items tbody td.r { text-align: right; font-variant-numeric: tabular-nums; }
  table.items tbody td.c { text-align: center; }
  .totales { margin-top: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 14px; }
  .totales .tot { font-weight: 800; }
  .totales .num { display: inline-block; min-width: 160px; text-align: right; font-variant-numeric: tabular-nums; }
  .obs { margin-top: 18px; font-size: 12px; white-space: pre-wrap; }
  .legal { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #d1d5db; font-size: 11px; color: #6b7280; text-align: center; }
  .toolbar { position: sticky; top: 0; background: #111827; color: #fff; padding: 10px 16px; display: flex; gap: 10px; justify-content: center; }
  .toolbar button { background: #2563eb; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page { width: auto; min-height: auto; margin: 0; padding: 10mm; }
    @page { size: A4 portrait; margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <div class="page">
    ${membreteA4()}

    <div class="prn-head">
      <div class="prn-cliente">
        <div class="senores">SEÑORES</div>
        <div class="nombre">${esc(p.cliente_nombre)}</div>
        ${p.cliente_ruc ? `<div class="datos">RUC/CI: ${esc(p.cliente_ruc)}</div>` : ""}
        ${p.cliente_telefono ? `<div class="datos">Tel: ${esc(p.cliente_telefono)}</div>` : ""}
        ${p.cliente_direccion ? `<div class="datos">${esc(p.cliente_direccion)}</div>` : ""}
        <div style="margin-top:6px;font-weight:700;">PRESENTE:</div>
      </div>
      <div class="prn-meta">
        <div class="num">N°: ${esc(p.numero_control)}</div>
        ${p.sucursal ? `<div>Sucursal: ${esc(p.sucursal)}</div>` : ""}
        ${p.vendedor ? `<div>Vendedor: ${esc(p.vendedor)}</div>` : ""}
        <div>Fecha: ${fmtFecha(p.fecha)}</div>
        ${p.fecha_vencimiento ? `<div>Válido hasta: ${fmtFecha(p.fecha_vencimiento)}</div>` : ""}
      </div>
    </div>

    <div class="cotiz">COTIZACIÓN DE LO SOLICITADO:</div>

    <table class="items">
      <thead>
        <tr>
          <th class="c">Ítem</th>
          <th>Código</th>
          <th>Artículo</th>
          <th class="r">Cantidad</th>
          <th class="r">Kilos</th>
          <th class="r">Precio Unitario</th>
          <th class="r">Precio Total</th>
        </tr>
      </thead>
      <tbody>
        ${filas || `<tr><td colspan="7" class="c">Sin ítems</td></tr>`}
      </tbody>
    </table>

    <div class="totales">
      <div class="tot">TOTAL PRESUPUESTO: ${simb} <span class="num">${fmtNum(p.total, 0)}</span></div>
      <div>TOTAL KILOS: <span class="num">${fmtNum(totalKilos, 2)}</span></div>
    </div>

    ${p.observaciones ? `<div class="obs"><strong>Observaciones:</strong>\n${esc(p.observaciones)}</div>` : ""}

    <div class="legal">
      Presupuesto sujeto a disponibilidad de stock y validez indicada.<br>
      Documento no fiscal — no válido como factura.
    </div>
  </div>
  <script>try{ if (${auto ? "true" : "false"}) window.print(); }catch(e){}</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
