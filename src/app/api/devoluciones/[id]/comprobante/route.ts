/**
 * Comprobante A4 landscape de la devolucion, mismo look que el comprobante de venta de Ferrecolor.
 * GET /api/devoluciones/[id]/comprobante?auto=1
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { getDevolucion } from "@/lib/devoluciones/server/devoluciones-pg";

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtGs(v: number): string { return Math.round(v || 0).toLocaleString("es-PY"); }

function fechaLarga(iso: string, ciudad = "VILLA HAYES"): string {
  try {
    const d = new Date(iso);
    const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const dia = py.getUTCDate();
    const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    return `${ciudad}, ${dia} DE ${meses[py.getUTCMonth()]} DEL ${py.getUTCFullYear()}`;
  } catch { return ciudad; }
}

function numeroALetras(n: number): string {
  const num = Math.round(Math.max(0, Number.isFinite(n) ? n : 0));
  if (num === 0) return "CERO";
  const unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const decenas = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
  function menores1000(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    let out = "";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    if (c > 0) out += centenas[c] + " ";
    if (resto < 10) out += unidades[resto];
    else if (resto < 20) out += especiales[resto - 10];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (d === 2 && u > 0) out += "VEINTI" + unidades[u].toLowerCase();
      else if (u === 0) out += decenas[d];
      else out += decenas[d] + " Y " + unidades[u];
    }
    return out.trim().toUpperCase();
  }
  function grupo(n: number, s: string, p: string) { if (n === 0) return ""; if (n === 1) return s; return `${menores1000(n)} ${p}`; }
  const millones = Math.floor(num / 1_000_000);
  const resto = num % 1_000_000;
  const miles = Math.floor(resto / 1000);
  const uf = resto % 1000;
  const partes: string[] = [];
  if (millones > 0) partes.push(grupo(millones, "UN MILLON", "MILLONES"));
  if (miles > 0) partes.push(miles === 1 ? "MIL" : `${menores1000(miles)} MIL`);
  if (uf > 0) partes.push(menores1000(uf));
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  if (!devolucionesEnabled()) return new NextResponse("No encontrado", { status: 404 });
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const autoPrint = url.searchParams.get("auto") === "1";

  const auth = await getUserAndEmpresa(request);
  if (!auth?.empresa_id) return new NextResponse("No autorizado", { status: 401 });
  const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
  const d = await getDevolucion(schema, auth.empresa_id, id);
  if (!d) return new NextResponse("Devolución no encontrada", { status: 404 });

  // Filas con la misma logica del comprobante de venta (exenta/5%/10%)
  type Fila = { cant: number; nombre: string; pu: number; exenta: number; iva5: number; iva10: number };
  const filas: Fila[] = (d.items ?? []).map((it) => {
    const total = Number(it.total_devuelto || 0);
    const iva = String(it.tipo_iva || "10%").toUpperCase();
    return {
      cant: Number(it.cantidad_devuelta || 0),
      nombre: it.producto_nombre,
      pu: Number(it.precio_unitario || 0),
      exenta: iva === "EXENTA" ? total : 0,
      iva5:   iva === "5%" ? total : 0,
      iva10:  iva === "10%" ? total : 0,
    };
  });
  const totExenta = filas.reduce((s, f) => s + f.exenta, 0);
  const totIva5   = filas.reduce((s, f) => s + f.iva5, 0);
  const totIva10  = filas.reduce((s, f) => s + f.iva10, 0);
  const total = totExenta + totIva5 + totIva10;
  const iva5Liq  = Math.round((totIva5 / 1.05) * 0.05);
  const iva10Liq = Math.round((totIva10 / 1.1) * 0.1);
  const ivaTotal = iva5Liq + iva10Liq;

  const filasHtml = filas.map((f) => `<tr>
    <td class="c cant">${f.cant}</td>
    <td class="c desc">${escapeHtml(f.nombre)}</td>
    <td class="c num">${fmtGs(f.pu)}</td>
    <td class="c num">${f.exenta > 0 ? fmtGs(f.exenta) : "0"}</td>
    <td class="c num">${f.iva5 > 0 ? fmtGs(f.iva5) : "0"}</td>
    <td class="c num">${f.iva10 > 0 ? fmtGs(f.iva10) : "0"}</td>
  </tr>`).join("");
  const MIN_FILAS = 12;
  const vacias = Math.max(0, MIN_FILAS - filas.length);
  const filasVaciasHtml = Array.from({ length: vacias }).map(() => `<tr class="empty">
    <td class="c cant">&nbsp;</td><td class="c desc">&nbsp;</td><td class="c num">&nbsp;</td>
    <td class="c num">&nbsp;</td><td class="c num">&nbsp;</td><td class="c num">&nbsp;</td>
  </tr>`).join("");

  const dif = d.diferencia;
  const difTxt = dif > 0 ? "DIFERENCIA A COBRAR" : dif < 0 ? "REEMBOLSO AL CLIENTE" : "SIN MOVIMIENTO DE CAJA";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>${escapeHtml(d.numero_devolucion)} — Devolución</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #f1f1f1; color: #111; font-family: 'Courier New', ui-monospace, monospace; font-size: 11.5px; }
  .hoja { background: #fff; width: 210mm; min-height: 148mm; margin: 20px auto; padding: 10mm 12mm; box-shadow: 0 1px 6px rgba(0,0,0,.12); }
  .corte { display:none; }
  @media print {
    html, body { background:#fff; }
    .hoja { box-shadow:none; margin:0; padding:8mm 10mm; min-height:0; }
    .corte { display:flex; align-items:center; gap:8px; margin-top:12px; padding-top:6px;
             font-size:10px; color:#888; border-top:1px dashed #999; }
    .corte span { flex:1; text-align:center; letter-spacing:1px; text-transform:uppercase; }
  }
  .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .header-top .brand { display: flex; align-items: center; gap: 12px; }
  .header-top .logo { max-height: 60px; width: auto; }
  .header-top .empresa-datos { font-size: 11.5px; line-height: 1.4; }
  .header-top .empresa-datos .razon { font-weight: 700; letter-spacing: 0.5px; }
  .fecha-top { font-size: 12px; font-weight: 700; text-align: right; }
  .doc-banner { text-align:center; font-weight:800; letter-spacing:2px; font-size:16px; margin:2px 0 8px; border-top:1px dashed #333; border-bottom:1px dashed #333; padding:4px 0; }
  .anulada-banner { text-align:center; font-weight:800; color:#b91c1c; font-size:14px; margin-bottom:6px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 10px; }
  .info .linea { display: flex; align-items: flex-end; border-bottom: 1px dotted #333; padding: 4px 0 2px; font-size: 12px; gap: 4px; }
  .info .linea .lbl { font-weight: 700; white-space: nowrap; }
  .info .linea .val { flex: 1; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11.5px; }
  table.items thead th { border: none; border-bottom: 1px dotted #111; font-weight: 700; padding: 4px 6px; text-align: left; font-size: 11px; letter-spacing: 0.5px; }
  table.items tbody td { border: none; border-bottom: 1px dotted #999; padding: 5px 6px; vertical-align: top; }
  table.items thead th + th, table.items tbody td + td { border-left: 1px dotted #ccc; }
  .cant { width: 70px; text-align: center; }
  .desc { text-align: left; }
  .num  { width: 100px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.empty td { color: transparent; }
  tr.subtot td { font-weight: 700; border-top: 1px solid #111 !important; border-bottom: 1px dotted #333 !important; }
  tr.tot td { font-weight: 700; border-bottom: 1px solid #111 !important; }
  .pie { margin-top: 8px; font-size: 12px; }
  .pie .linea { border-bottom: 1px dotted #333; padding: 4px 0 2px; display: flex; gap: 6px; }
  .pie .lbl { font-weight: 700; }
  .pie .val { flex: 1; }
  .pie .total-final { text-align: right; font-weight: 700; padding-top: 6px; font-size: 13px; }
  .disclaimer { margin-top: 6px; font-style: italic; font-size: 10.5px; text-align: center; color: #555; }
  .print-btn { position: fixed; top: 12px; right: 12px; background: #4FAEB2; color: #fff; border: 0; padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .print-btn:hover { background: #3F8E91; }
  @media print { body { background: #fff; } .hoja { box-shadow: none; margin: 0; width: auto; min-height: auto; padding: 6mm 10mm; } .print-btn { display: none; } }
</style></head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>
  <div class="hoja">
    <div class="header-top">
      <div class="brand">
        <img src="/brand/hierros-logo-new.png" alt="HIERROS VH" class="logo" onerror="this.style.display='none'" />
        <div class="empresa-datos">
          <div class="razon">HIERROS VH E.A.S. UNIPERSONAL</div>
          <div>R.U.C.: 80175853-0</div>
        </div>
      </div>
      <div class="fecha-top">${escapeHtml(fechaLarga(String(d.created_at ?? "")))}</div>
    </div>

    <div class="doc-banner">COMPROBANTE DE DEVOLUCION · ${escapeHtml(d.numero_devolucion)}</div>
    ${d.estado === "anulada" ? `<div class="anulada-banner">*** DEVOLUCION ANULADA ***</div>` : ""}

    <div class="info">
      <div>
        <div class="linea"><span class="lbl">CLIENTE:</span> <span class="val">${escapeHtml(d.cliente_nombre ?? "—")}</span></div>
        <div class="linea"><span class="lbl">VENTA ORIGINAL:</span> <span class="val">${escapeHtml(d.venta_numero_control ?? "—")}</span></div>
        <div class="linea"><span class="lbl">USUARIO:</span> <span class="val">${escapeHtml(d.usuario_nombre ?? "—")}</span></div>
      </div>
      <div>
        <div class="linea"><span class="lbl">TIPO:</span> <span class="val">${d.tipo === "total" ? "TOTAL" : "PARCIAL"}</span></div>
        <div class="linea"><span class="lbl">RESOLUCION:</span> <span class="val">${d.resolucion === "cambio" ? "CAMBIO POR OTRO PRODUCTO" : "REEMBOLSO EN " + escapeHtml((d.metodo_reembolso ?? "").toUpperCase())}</span></div>
        <div class="linea"><span class="lbl">MOTIVO:</span> <span class="val">${escapeHtml(d.motivo ?? "")}</span></div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="cant">CANTIDAD</th>
          <th class="desc">DESCRIPCION</th>
          <th class="num">P.UNITARIO</th>
          <th class="num">EXENTA</th>
          <th class="num">IVA 5%</th>
          <th class="num">IVA 10%</th>
        </tr>
      </thead>
      <tbody>
        ${filasHtml}
        ${filasVaciasHtml}
        <tr class="subtot">
          <td class="cant"></td><td class="desc">SUB TOTALES</td><td class="num"></td>
          <td class="num">${fmtGs(totExenta)}</td><td class="num">${fmtGs(totIva5)}</td><td class="num">${fmtGs(totIva10)}</td>
        </tr>
        <tr class="tot">
          <td class="cant"></td><td class="desc">TOTAL DEVUELTO</td><td class="num"></td>
          <td class="num">${fmtGs(totExenta)}</td><td class="num">${fmtGs(totIva5)}</td><td class="num">${fmtGs(totIva10)}</td>
        </tr>
      </tbody>
    </table>

    <div class="pie">
      <div class="linea"><span class="lbl">SON GUARANIES:</span> <span class="val">${escapeHtml(numeroALetras(total))}</span></div>
      <div class="linea">
        <span class="lbl">LIQUIDACION DEL IVA</span>
        <span class="val">&nbsp;&nbsp;(5%): ${fmtGs(iva5Liq)}&nbsp;&nbsp;&nbsp;&nbsp;(10%): ${fmtGs(iva10Liq)}&nbsp;&nbsp;&nbsp;&nbsp;TOTAL IVA: ${fmtGs(ivaTotal)}</span>
      </div>
      ${d.resolucion === "cambio" && (d.cambios?.length ?? 0) > 0 ? `<div class="linea">
        <span class="lbl">PRODUCTOS ENTREGADOS:</span>
        <span class="val">${(d.cambios ?? []).map((c) => `${c.cantidad}× ${escapeHtml(c.producto_nombre)} — ${fmtGs(c.total)}`).join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</span>
      </div>` : ""}
      <div class="total-final">${difTxt}: Gs. ${fmtGs(Math.abs(dif))}</div>
    </div>

    <div class="disclaimer">Comprobante interno de devolucion — no valido como documento fiscal.${d.requiere_nota_credito ? " Esta devolucion puede requerir emitir una Nota de Credito fiscal." : ""}</div>
    <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
  </div>
  <script>try{ if(${autoPrint ? "true" : "false"}){ setTimeout(function(){window.print();},250); } }catch(e){}</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
