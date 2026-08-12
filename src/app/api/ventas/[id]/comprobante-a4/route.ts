/**
 * Comprobante A4 imprimible (formato "hoja tradicional" para Ferrecolor).
 * Reemplaza el ticket termico (el cliente no tiene ticketera).
 *
 * Layout:
 *   - Ciudad + fecha en letras al tope
 *   - Razon social / direccion / contacto del cliente a la izquierda
 *   - Condicion de venta / RUC / Nota de remision a la derecha
 *   - Tabla: CANTIDAD | DESCRIPCION | P.UNITARIO | EXENTA | IVA 5% | IVA 10%
 *   - Sub totales, totales, "SON GUARANIES" en letras, liquidacion del IVA
 *
 * GET /api/ventas/[id]/comprobante-a4
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtGs(v: number): string {
  return Math.round(v).toLocaleString("es-PY");
}

/** Fecha larga tipo "HERNANDARIAS, 20 DE JULIO DEL 2026". Forzada a UTC-3 (Paraguay). */
function fechaLarga(iso: string, ciudad = "HERNANDARIAS"): string {
  try {
    const d = new Date(iso);
    const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const dia = py.getUTCDate();
    const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    const mes = meses[py.getUTCMonth()];
    const anio = py.getUTCFullYear();
    return `${ciudad}, ${dia} DE ${mes} DEL ${anio}`;
  } catch {
    return ciudad;
  }
}

/** Numero entero a letras (guaranies). Soporta hasta miles de millones. */
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
    if (resto < 10) {
      out += unidades[resto];
    } else if (resto < 20) {
      out += especiales[resto - 10];
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (d === 2 && u > 0) {
        out += "VEINTI" + unidades[u].toLowerCase();
      } else if (u === 0) {
        out += decenas[d];
      } else {
        out += decenas[d] + " Y " + unidades[u];
      }
    }
    return out.trim().toUpperCase();
  }

  function grupo(n: number, singular: string, plural: string): string {
    if (n === 0) return "";
    if (n === 1) return singular;
    const t = menores1000(n);
    return `${t} ${plural}`;
  }

  const millones = Math.floor(num / 1_000_000);
  const restoMillones = num % 1_000_000;
  const miles = Math.floor(restoMillones / 1000);
  const unidadesFinal = restoMillones % 1000;

  const partes: string[] = [];
  if (millones > 0) partes.push(grupo(millones, "UN MILLON", "MILLONES"));
  if (miles > 0) partes.push(miles === 1 ? "MIL" : `${menores1000(miles)} MIL`);
  if (unidadesFinal > 0) partes.push(menores1000(unidadesFinal));

  return partes.join(" ").replace(/\s+/g, " ").trim();
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
    const sb = ctx.supabase;
    const empresaId = ctx.auth.empresa_id;

    // 1) Venta
    const { data: venta } = await sb
      .from("ventas")
      .select("id, numero_control, fecha, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, cliente_id, nota_remision_numero, genera_nota_remision, observaciones, estado")
      .eq("id", ventaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!venta) return new NextResponse("Venta no encontrada", { status: 404 });

    // 2) Items
    const { data: items } = await sb
      .from("ventas_items")
      .select("producto_nombre, sku, cantidad, precio_venta, tipo_iva, subtotal, monto_iva, total_linea")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId);

    // 2b) Pagos (para mostrar desglose si fue mixto)
    const { data: pagosRows } = await sb
      .from("ventas_pagos_detalle")
      .select("metodo_pago, monto, entidad_nombre_snapshot, referencia")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId);
    const pagos = (pagosRows ?? []) as Array<{
      metodo_pago: string;
      monto: number | string;
      entidad_nombre_snapshot: string | null;
      referencia: string | null;
    }>;

    // 3) Cliente (opcional)
    let cliente: { nombre?: string; ruc?: string; direccion?: string; telefono?: string } | null = null;
    if ((venta as { cliente_id?: string | null }).cliente_id) {
      const { data: c } = await sb
        .from("clientes")
        .select("empresa, nombre_contacto, nombre, ruc, documento, direccion, telefono")
        .eq("empresa_id", empresaId)
        .eq("id", (venta as { cliente_id: string }).cliente_id)
        .maybeSingle();
      if (c) {
        const cc = c as Record<string, string | null>;
        cliente = {
          nombre: cc.empresa || cc.nombre_contacto || cc.nombre || "",
          ruc: cc.ruc || cc.documento || "",
          direccion: cc.direccion || "",
          telefono: cc.telefono || "",
        };
      }
    }

    // 4) Empresa (para ciudad si la tuvieramos; hoy solo hardcoded HERNANDARIAS)
    // Podria leerse de ferrecolor.empresas si se completa el campo 'ciudad'.

    const filas = (items ?? []).map((it: Record<string, unknown>) => {
      const cant = Number(it.cantidad ?? 0);
      const pu = Number(it.precio_venta ?? 0);
      const total = Number(it.total_linea ?? 0);
      const ivaTipo = String(it.tipo_iva ?? "10%");
      const exenta = ivaTipo === "EXENTA" ? total : 0;
      const iva5 = ivaTipo === "5%" ? total : 0;
      const iva10 = ivaTipo === "10%" ? total : 0;
      return {
        cant,
        nombre: String(it.producto_nombre ?? ""),
        pu,
        exenta,
        iva5,
        iva10,
      };
    });

    const totExenta = filas.reduce((s, f) => s + f.exenta, 0);
    const totIva5 = filas.reduce((s, f) => s + f.iva5, 0);
    const totIva10 = filas.reduce((s, f) => s + f.iva10, 0);
    const total = totExenta + totIva5 + totIva10;
    // Liquidacion del IVA: monto de IVA incluido en la parte 5% y 10%
    const iva5Liq = Math.round((totIva5 / 1.05) * 0.05);
    const iva10Liq = Math.round((totIva10 / 1.1) * 0.1);
    const ivaTotal = iva5Liq + iva10Liq;

    const v = venta as Record<string, unknown>;
    const numeroControl = String(v.numero_control ?? "");
    const notaRem = v.genera_nota_remision === true && v.nota_remision_numero
      ? String(v.nota_remision_numero)
      : "";
    const condicion = v.tipo_venta === "CREDITO"
      ? `CREDITO${v.plazo_dias ? ` ${v.plazo_dias}d` : ""}`
      : "CONTADO";

    const filasHtml = filas
      .map(
        (f) => `<tr>
          <td class="c cant">${f.cant}</td>
          <td class="c desc">${escapeHtml(f.nombre)}</td>
          <td class="c num">${fmtGs(f.pu)}</td>
          <td class="c num">${f.exenta > 0 ? fmtGs(f.exenta) : "0"}</td>
          <td class="c num">${f.iva5 > 0 ? fmtGs(f.iva5) : "0"}</td>
          <td class="c num">${f.iva10 > 0 ? fmtGs(f.iva10) : "0"}</td>
        </tr>`
      )
      .join("");

    // Filas vacias minimas para dar espacio visual (min 2 para look homogeneo).
    // Antes eran 12 y hacian que un solo producto ocupe la hoja entera.
    const MIN_FILAS = 2;
    const vacias = Math.max(0, MIN_FILAS - filas.length);
    const filasVaciasHtml = Array.from({ length: vacias })
      .map(
        () => `<tr class="empty">
          <td class="c cant">&nbsp;</td>
          <td class="c desc">&nbsp;</td>
          <td class="c num">&nbsp;</td>
          <td class="c num">&nbsp;</td>
          <td class="c num">&nbsp;</td>
          <td class="c num">&nbsp;</td>
        </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Comprobante ${escapeHtml(numeroControl)} — Ferrecolor</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #f1f1f1; color: #111; font-family: 'Courier New', ui-monospace, monospace; font-size: 11.5px; }
  .hoja {
    background: #fff;
    width: 210mm; min-height: 0; margin: 20px auto;
    padding: 8mm 10mm; box-shadow: 0 1px 6px rgba(0,0,0,.12);
  }
  .corte { display:none; }

  /* Cabecera: logo + datos empresa a la izquierda + fecha a la derecha */
  .header-top {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .header-top .brand { display: flex; align-items: center; gap: 12px; }
  .header-top .logo { max-height: 60px; width: auto; }
  .header-top .empresa-datos { font-size: 11.5px; line-height: 1.4; }
  .header-top .empresa-datos .razon { font-weight: 700; letter-spacing: 0.5px; }
  .fecha-top { font-size: 12px; font-weight: 700; text-align: right; }

  /* Dos columnas para datos del cliente / condicion */
  .info {
    display: grid; grid-template-columns: 1fr 1fr; gap: 30px;
    margin-bottom: 10px;
  }
  .info .linea {
    display: flex; align-items: flex-end;
    border-bottom: 1px dotted #333;
    padding: 4px 0 2px;
    font-size: 12px; gap: 4px;
  }
  .info .linea .lbl { font-weight: 700; white-space: nowrap; }
  .info .linea .val { flex: 1; }

  /* Tabla de items: SIN bordes visibles arriba, solo lineas punteadas */
  table.items {
    width: 100%; border-collapse: collapse; margin-top: 6px;
    font-size: 11.5px;
  }
  table.items thead th {
    border: none;
    border-bottom: 1px dotted #111;
    font-weight: 700; padding: 4px 6px; text-align: left;
    font-size: 11px; letter-spacing: 0.5px;
  }
  table.items tbody td {
    border: none;
    border-bottom: 1px dotted #999;
    padding: 5px 6px; vertical-align: top;
  }
  /* Separadores verticales entre columnas con "|" en el texto no; usamos borders */
  table.items thead th + th, table.items tbody td + td { border-left: 1px dotted #ccc; }
  /* Columnas alineadas */
  .cant { width: 70px; text-align: center; }
  .desc { text-align: left; }
  .num  { width: 100px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.empty td { color: transparent; }

  /* Filas de subtotales dentro de la tabla */
  tr.subtot td {
    font-weight: 700;
    border-top: 1px solid #111 !important;
    border-bottom: 1px dotted #333 !important;
    background: transparent;
  }
  tr.tot td {
    font-weight: 700;
    border-bottom: 1px solid #111 !important;
  }

  /* Pie: dos "lineas" de texto con puntos abajo */
  .pie { margin-top: 8px; font-size: 12px; }
  .pie .linea {
    border-bottom: 1px dotted #333;
    padding: 4px 0 2px;
    display: flex; gap: 6px;
  }
  .pie .lbl { font-weight: 700; }
  .pie .val { flex: 1; }
  .pie .total-final {
    text-align: right; font-weight: 700; padding-top: 6px; font-size: 13px;
  }

  .print-btn {
    position: fixed; top: 12px; right: 12px; background: #4FAEB2; color: #fff;
    border: 0; padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 13px;
    font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  .print-btn:hover { background: #3F8E91; }
  @media print {
    html, body { background: #fff; font-size: 10.5px; }
    .hoja { box-shadow: none; margin: 0; width: auto; min-height: 0; padding: 4mm 6mm; }
    .print-btn { display: none; }
    .header-top { margin-bottom: 6px; }
    .header-top .logo { max-height: 42px; }
    .fecha-top { font-size: 11px; }
    .info { gap: 20px; margin-bottom: 6px; }
    .info .linea { font-size: 10.5px; padding: 2px 0 1px; }
    table.items { font-size: 10px; margin-top: 4px; }
    table.items thead th { padding: 2px 4px; font-size: 9.5px; }
    table.items tbody td { padding: 2px 4px; }
    .pie { margin-top: 4px; font-size: 10px; }
    .pie .linea { padding: 2px 0 1px; }
    .pie .total-final { font-size: 12px; padding-top: 3px; }
    .corte { display:flex; align-items:center; gap:8px; margin-top:8px; padding-top:4px;
             font-size:9px; color:#888; border-top:1px dashed #999; }
    .corte span { flex:1; text-align:center; letter-spacing:1px; text-transform:uppercase; }
  }
</style></head>
<body>
  <button class="print-btn" onclick="window.print()">Imprimir</button>
  <div class="hoja">
    <div class="header-top">
      <div class="brand">
        <img src="/brand/hierros-logo.png" alt="HIERROS VH" class="logo" onerror="this.style.display='none'" />
        <div class="empresa-datos">
          <div class="razon">GRUPO FERRE E.A.S.</div>
          <div>R.U.C.: 80173997-7</div>
        </div>
      </div>
      <div class="fecha-top">${escapeHtml(fechaLarga(String(v.fecha ?? "")))}</div>
    </div>

    <div class="info">
      <div>
        <div class="linea"><span class="lbl">RAZON SOCIAL:</span> <span class="val">${escapeHtml(cliente?.nombre ?? "")}</span></div>
        <div class="linea"><span class="lbl">DIRECCION:</span> <span class="val">${escapeHtml(cliente?.direccion ?? "")}</span></div>
        <div class="linea"><span class="lbl">CONTACTO:</span> <span class="val">${escapeHtml(cliente?.telefono ?? "")}</span></div>
      </div>
      <div>
        <div class="linea"><span class="lbl">CONDICION DE VENTA:</span> <span class="val">${escapeHtml(condicion)}</span></div>
        <div class="linea"><span class="lbl">R.U.C./C.I.:</span> <span class="val">${escapeHtml(cliente?.ruc ?? "")}</span></div>
        <div class="linea"><span class="lbl">NOTA DE REMISION:</span> <span class="val">${escapeHtml(notaRem)}</span></div>
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
          <td class="cant"></td>
          <td class="desc">SUB TOTALES</td>
          <td class="num"></td>
          <td class="num">${fmtGs(totExenta)}</td>
          <td class="num">${fmtGs(totIva5)}</td>
          <td class="num">${fmtGs(totIva10)}</td>
        </tr>
        <tr class="tot">
          <td class="cant"></td>
          <td class="desc">TOTALES</td>
          <td class="num"></td>
          <td class="num">${fmtGs(totExenta)}</td>
          <td class="num">${fmtGs(totIva5)}</td>
          <td class="num">${fmtGs(totIva10)}</td>
        </tr>
      </tbody>
    </table>

    <div class="pie">
      <div class="linea"><span class="lbl">SON GUARANIES:</span> <span class="val">${escapeHtml(numeroALetras(total))}</span></div>
      <div class="linea">
        <span class="lbl">LIQUIDACION DEL IVA</span>
        <span class="val">&nbsp;&nbsp;(5%): ${fmtGs(iva5Liq)}&nbsp;&nbsp;&nbsp;&nbsp;(10%): ${fmtGs(iva10Liq)}&nbsp;&nbsp;&nbsp;&nbsp;TOTAL IVA: ${fmtGs(ivaTotal)}</span>
      </div>
      ${
        pagos.length > 1
          ? `<div class="linea">
              <span class="lbl">FORMA DE PAGO:</span>
              <span class="val">${pagos
                .map((p) => {
                  const mLabel = p.metodo_pago === "efectivo"
                    ? "Efectivo"
                    : p.metodo_pago === "transferencia"
                    ? "Transferencia"
                    : p.metodo_pago === "tarjeta"
                    ? "Tarjeta"
                    : escapeHtml(p.metodo_pago);
                  const ent = p.entidad_nombre_snapshot ? ` (${escapeHtml(p.entidad_nombre_snapshot)})` : "";
                  return `${mLabel}${ent}: ${fmtGs(Number(p.monto) || 0)}`;
                })
                .join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</span>
            </div>`
          : ""
      }
      <div class="total-final">TOTAL: Gs. ${fmtGs(total)}</div>
    </div>
    <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
  </div>
</body></html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error(
      "[/api/ventas/[id]/comprobante-a4]",
      err instanceof Error ? err.message : err
    );
    return new NextResponse("Error interno", { status: 500 });
  }
}
