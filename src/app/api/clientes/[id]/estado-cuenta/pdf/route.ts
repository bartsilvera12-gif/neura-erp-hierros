import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/clientes/[id]/estado-cuenta/pdf?auto=1
 * Documento A4 imprimible del estado de cuenta del cliente (CxC + cobros). NO fiscal.
 */
const NEGOCIO_FALLBACK = "HIERROS VH";
function resolveNegocio(nombreEmpresa?: string | null): string {
  const env = (process.env.NEURA_CLIENT_NAME ?? "").trim();
  if (env) return env;
  const e = (nombreEmpresa ?? "").trim();
  return e || NEGOCIO_FALLBACK;
}
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtGs(n: unknown) {
  return "Gs. " + (Math.round(Number(n) || 0)).toLocaleString("es-PY");
}
function fmtFecha(iso: unknown): string {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}
const ESTADO_LBL: Record<string, string> = { pendiente: "Pendiente", parcial: "Parcial", pagado: "Pagado", vencido: "Vencido", anulado: "Anulado" };
const METODO_LBL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro" };

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const auto = new URL(request.url).searchParams.get("auto") === "1";
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const hoy = new Date().toISOString().slice(0, 10);

  const cq = await ctx.supabase
    .from("clientes")
    .select("id, empresa, nombre_contacto, nombre, ruc, documento, telefono, direccion")
    .eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (cq.error || !cq.data) return new NextResponse("Cliente no encontrado", { status: 404 });
  const c = cq.data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const cliente = {
    nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "Cliente",
    ruc: s(c.ruc) || s(c.documento) || null,
    telefono: s(c.telefono) || null,
    direccion: s(c.direccion) || null,
  };

  const vq = await ctx.supabase.from("ventas").select("total").eq("empresa_id", empresaId).eq("cliente_id", id).neq("estado", "anulada");
  const totalVendido = ((vq.data ?? []) as Record<string, unknown>[]).reduce((a, r) => a + (Number(r.total) || 0), 0);

  const cxcQ = await ctx.supabase
    .from("cuentas_por_cobrar")
    .select("numero_venta, fecha_emision, fecha_vencimiento, total, saldo, estado")
    .eq("empresa_id", empresaId).eq("cliente_id", id).order("fecha_emision", { ascending: false });
  let saldoPendiente = 0, vencido = 0;
  const movs = ((cxcQ.data ?? []) as Record<string, unknown>[]).map((r) => {
    const total = Number(r.total) || 0, saldo = Number(r.saldo) || 0;
    const venc = r.fecha_vencimiento ? String(r.fecha_vencimiento).slice(0, 10) : null;
    const vig = r.estado === "pendiente" || r.estado === "parcial";
    if (r.estado !== "anulado") saldoPendiente += saldo;
    const vencida = vig && venc != null && venc < hoy;
    if (vencida) vencido += saldo;
    return { numero: r.numero_venta, emision: r.fecha_emision, venc, total, cobrado: total - saldo, saldo, estado: r.estado, vencida };
  });

  const cobQ = await ctx.supabase
    .from("cobros_clientes")
    .select("fecha_pago, monto, metodo_pago, referencia, usuario_nombre")
    .eq("empresa_id", empresaId).eq("cliente_id", id).order("fecha_pago", { ascending: false }).limit(500);
  const cobros = (cobQ.data ?? []) as Record<string, unknown>[];

  let nombreEmpresa: string | null = null;
  try {
    const eq = await ctx.supabase.from("empresas").select("nombre_empresa").eq("id", empresaId).maybeSingle();
    nombreEmpresa = (eq.data as { nombre_empresa?: string } | null)?.nombre_empresa ?? null;
  } catch { /* fallback */ }
  const negocio = resolveNegocio(nombreEmpresa);

  const filasMov = movs.map((m) => `
    <tr>
      <td>${esc(m.numero ?? "—")}</td>
      <td>${fmtFecha(m.emision)}</td>
      <td class="${m.vencida ? "venc" : ""}">${fmtFecha(m.venc)}</td>
      <td class="r">${fmtGs(m.total)}</td>
      <td class="r">${fmtGs(m.cobrado)}</td>
      <td class="r">${fmtGs(m.saldo)}</td>
      <td>${esc(m.vencida && m.estado !== "pagado" ? "Vencido" : (ESTADO_LBL[String(m.estado)] ?? m.estado))}</td>
    </tr>`).join("");
  const filasCob = cobros.map((r) => `
    <tr>
      <td>${fmtFecha(r.fecha_pago)}</td>
      <td>${esc(METODO_LBL[String(r.metodo_pago)] ?? r.metodo_pago)}</td>
      <td>${esc(r.referencia ?? "—")}</td>
      <td>${esc(r.usuario_nombre ?? "—")}</td>
      <td class="r">${fmtGs(r.monto)}</td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estado de cuenta — ${esc(cliente.nombre)}</title>
<style>
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2937;background:#f3f4f6}
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:16mm 14mm}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4FAEB2;padding-bottom:12px}
  .negocio{font-size:21px;font-weight:800} .tag{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
  .meta{text-align:right;font-size:12px}
  .box{margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
  .box h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
  .cards{display:flex;gap:10px;margin-top:14px}
  .card{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px}
  .card .l{font-size:10px;text-transform:uppercase;color:#6b7280} .card .v{font-size:15px;font-weight:800;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
  thead th{background:#4FAEB2;color:#fff;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase}
  thead th.r{text-align:right} tbody td{padding:6px 8px;border-bottom:1px solid #eef2f4} td.r{text-align:right} td.venc{color:#dc2626;font-weight:600}
  h2.sec{font-size:13px;margin:18px 0 0}
  .tot{margin-top:10px;text-align:right;font-size:14px;font-weight:800}
  .legal{margin-top:22px;padding-top:10px;border-top:1px dashed #d1d5db;font-size:10px;color:#6b7280;text-align:center}
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
    <div><div class="negocio">ESTADO DE CUENTA</div><div class="tag">${esc(negocio)}</div></div>
    <div class="meta">Emitido: ${fmtFecha(hoy)}</div>
  </div>
  <div class="box">
    <h3>Cliente</h3>
    <p style="margin:2px 0;font-weight:600">${esc(cliente.nombre)}</p>
    ${cliente.ruc ? `<p style="margin:2px 0;font-size:12px">RUC/CI: ${esc(cliente.ruc)}</p>` : ""}
    ${cliente.telefono ? `<p style="margin:2px 0;font-size:12px">Tel: ${esc(cliente.telefono)}</p>` : ""}
    ${cliente.direccion ? `<p style="margin:2px 0;font-size:12px">${esc(cliente.direccion)}</p>` : ""}
  </div>
  <div class="cards">
    <div class="card"><div class="l">Total vendido</div><div class="v">${fmtGs(totalVendido)}</div></div>
    <div class="card"><div class="l">Cobrado</div><div class="v" style="color:#047857">${fmtGs(totalVendido - saldoPendiente)}</div></div>
    <div class="card"><div class="l">Saldo pendiente</div><div class="v" style="color:#b45309">${fmtGs(saldoPendiente)}</div></div>
    <div class="card"><div class="l">Vencido</div><div class="v" style="color:#dc2626">${fmtGs(vencido)}</div></div>
  </div>

  <h2 class="sec">Cuentas a crédito</h2>
  <table>
    <thead><tr><th>Venta</th><th>Emisión</th><th>Vencimiento</th><th class="r">Total</th><th class="r">Cobrado</th><th class="r">Saldo</th><th>Estado</th></tr></thead>
    <tbody>${filasMov || `<tr><td colspan="7" style="text-align:center">Sin cuentas a crédito</td></tr>`}</tbody>
  </table>

  <h2 class="sec">Cobros registrados</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th>Registrado por</th><th class="r">Monto</th></tr></thead>
    <tbody>${filasCob || `<tr><td colspan="5" style="text-align:center">Sin cobros registrados</td></tr>`}</tbody>
  </table>

  <p class="tot">Saldo pendiente total: ${fmtGs(saldoPendiente)}</p>
  <div class="legal">Estado de cuenta emitido para control interno/comercial. Documento no fiscal.</div>
  <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
</div>
<script>try{ if (${auto ? "true" : "false"}) window.print(); }catch(e){}</script>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
