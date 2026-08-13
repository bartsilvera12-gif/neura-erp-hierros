import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4, membreteTicket } from "@/lib/documentos/membrete";

/**
 * GET /api/ventas/[id]/ticket?w=58|80&mode=comandas&auto=1
 *
 * HTML imprimible NO FISCAL. Soporta dos modos:
 *
 * - Default (sin `mode`): una sola copia tipo CLIENTE.
 * - `mode=comandas`: genera múltiples copias en una sola página HTML separadas por
 *   page-break-after, calculadas automáticamente según las categorías/SKUs de los
 *   productos de la venta:
 *     · Siempre: copia CLIENTE (con precios, total, método de pago, leyenda no fiscal).
 *     · Si hay pizzas/lompizzas: copia COMANDA PIZZERÍA (sin precios).
 *     · Si hay hamburguesas/lomitos/lomitos árabes/panchos/papas/especiales: copia COMANDA PLANCHA.
 *
 * No toca SIFEN, no genera XML, no usa timbrado.
 */

/**
 * Nombre del negocio en el ticket. Orden de preferencia:
 *   1) process.env.NEURA_CLIENT_NAME (instancia dedicada monocliente)
 *   2) empresas.nombre_empresa de la empresa de la venta
 *   3) fallback seguro
 * Nunca se hardcodea otra marca.
 */
const NEGOCIO_FALLBACK = "HIERROS VH";

function resolveNegocio(nombreEmpresa?: string | null): string {
  const env = (process.env.NEURA_CLIENT_NAME ?? "").trim();
  if (env) return env;
  const e = (nombreEmpresa ?? "").trim();
  if (e) return e;
  return NEGOCIO_FALLBACK;
}

// ── Clasificación PIZZERÍA / PLANCHA ───────────────────────────────────────
// Primary: categoría hija del producto. Fallback: prefijo de SKU.

const CAT_SLUGS_PIZZERIA = new Set(["pizzas", "lompizzas"]);
const CAT_SLUGS_PLANCHA = new Set([
  "hamburguesas",
  "lomitos",
  "lomitos_arabes",
  "panchos",
  "papas_fritas",
  "especiales",
]);
const CAT_NOMBRES_PIZZERIA = new Set(["PIZZAS", "LOMPIZZAS"]);
const CAT_NOMBRES_PLANCHA = new Set([
  "HAMBURGUESAS",
  "LOMITOS",
  "LOMITOS ARABES",
  "LOMITOS ÁRABES",
  "PANCHOS",
  "PAPAS FRITAS",
  "ESPECIALES",
]);

type Sector = "pizzeria" | "plancha" | null;

function classifyBySku(sku: string): Sector {
  const s = (sku || "").toUpperCase();
  if (s.startsWith("PIZ-")) return "pizzeria";
  if (s.startsWith("ESP-")) return "plancha";
  if (s.startsWith("HAM-") || s.startsWith("LOM-") || s.startsWith("PAN-") || s.startsWith("PAP-")) return "plancha";
  return null;
}

function classifyByCategoria(slug: string | null, nombre: string | null): Sector {
  const sl = (slug || "").toLowerCase();
  const nm = (nombre || "").toUpperCase();
  if (sl && CAT_SLUGS_PIZZERIA.has(sl)) return "pizzeria";
  if (sl && CAT_SLUGS_PLANCHA.has(sl)) return "plancha";
  if (nm && CAT_NOMBRES_PIZZERIA.has(nm)) return "pizzeria";
  if (nm && CAT_NOMBRES_PLANCHA.has(nm)) return "plancha";
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatGs(v: number): string {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string): string {
  try {
    // Paraguay es UTC-3 fijo desde 2024 (sin DST). No usamos `America/Asuncion`
    // porque el tzdata del server puede estar desactualizado y aplicar UTC-4.
    const d = new Date(iso);
    const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const dd = String(py.getUTCDate()).padStart(2, "0");
    const mm = String(py.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = py.getUTCFullYear();
    const hh = String(py.getUTCHours()).padStart(2, "0");
    const min = String(py.getUTCMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

function modalidadLabel(m: string | null | undefined): string {
  if (m === "local") return "Local";
  if (m === "delivery") return "Delivery";
  if (m === "carry_out") return "Retiro";
  return "";
}

function metodoPagoLabel(m: string | null | undefined): string {
  if (m === "tarjeta") return "Tarjeta";
  if (m === "transferencia") return "Transferencia";
  if (m === "efectivo") return "Efectivo";
  return "—";
}

// ── Types ──────────────────────────────────────────────────────────────────

interface VentaRow {
  id: string;
  numero_control: string;
  fecha: string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  observaciones: string | null;
  metodo_pago: string | null;
  cliente_id: string | null;
  genera_nota_remision: boolean | null;
  nota_remision_numero: string | null;
}

interface ItemRow {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta: number | string;
  total_linea: number | string;
  // Snapshot de la presentacion al momento de la venta (NULL en items
  // legacy o cuando la presentacion era 'Unidad' default).
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | string | null;
}

type EnrichedItem = ItemRow & { sector: Sector };

interface PedidoBrief {
  modalidad?: "local" | "delivery" | "carry_out";
  mesa?: string | null;
  cliente_nombre?: string | null;
  cliente_telefono?: string | null;
  direccion_entrega?: string | null;
  observacion?: string | null;
}

// ── Render de cada copia ───────────────────────────────────────────────────

function renderCopia(opts: {
  tipo: "cliente" | "pizzeria" | "plancha";
  venta: VentaRow;
  items: EnrichedItem[];
  brief: PedidoBrief | null;
  fontPx: number;
  isLast: boolean;
  negocio: string;
}): string {
  const { tipo, venta, items, brief, fontPx, isLast } = opts;
  const showPrices = tipo === "cliente";
  const sectorBadge = tipo === "pizzeria" ? "COMANDA PIZZERÍA" : tipo === "plancha" ? "COMANDA PLANCHA" : "";
  const modalidad = modalidadLabel(brief?.modalidad);

  // Filas de ítems: en cliente todas; en cocina todas también, pero las del propio sector destacadas.
  const itemsHtml = items
    .map((it) => {
      const cant = Number(it.cantidad);
      const punit = Number(it.precio_venta);
      const sub = Number(it.total_linea);
      const matchesSector =
        (tipo === "pizzeria" && it.sector === "pizzeria") ||
        (tipo === "plancha" && it.sector === "plancha");
      const cls = matchesSector ? "match" : tipo === "cliente" ? "" : "muted";

      // Presentacion (Caja, Paquete, etc): cantidad mostrada como "1 caja"
      // y equivalencia "= 1000 unidades" si cantidad_base != 1.
      const presNombre = (it.presentacion_nombre ?? "").trim();
      const cantBase = it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : 1;
      const showsPres = !!presNombre && presNombre.toLowerCase() !== "unidad";
      const cantStr = showsPres ? `${cant} ${escapeHtml(presNombre)}` : `${cant}`;
      const equiv = showsPres && cantBase > 1
        ? `<tr class="sub"><td></td><td colspan="2" style="opacity:.75;">= ${cant * cantBase} unidades</td></tr>`
        : "";

      const main = showPrices
        ? `<tr class="${cls}">
             <td class="qty"><strong>${cantStr}×</strong></td>
             <td class="name">${escapeHtml(it.producto_nombre)}</td>
             <td class="amt">${formatGs(sub)}</td>
           </tr>
           ${equiv}
           <tr class="sub"><td></td><td colspan="2">${cant} × ${formatGs(punit)}</td></tr>`
        : `<tr class="${cls}">
             <td class="qty"><strong>${cantStr}×</strong></td>
             <td class="name" colspan="2"><strong>${escapeHtml(it.producto_nombre)}</strong></td>
           </tr>
           ${equiv}`;
      return main;
    })
    .join("");

  const subtotal = Number(venta.subtotal);
  const ivaTotal = Number(venta.monto_iva);
  const total = Number(venta.total);

  const datosPedido: string[] = [];
  if (modalidad) {
    datosPedido.push(
      `<div><strong>${modalidad}</strong>${brief?.mesa ? ` · Mesa ${escapeHtml(brief.mesa)}` : ""}</div>`
    );
  }
  if (brief?.cliente_nombre) datosPedido.push(`<div>Cliente: ${escapeHtml(brief.cliente_nombre)}</div>`);
  if (brief?.cliente_telefono) datosPedido.push(`<div>Tel: ${escapeHtml(brief.cliente_telefono)}</div>`);
  if (brief?.direccion_entrega) datosPedido.push(`<div>Dir: ${escapeHtml(brief.direccion_entrega)}</div>`);
  const obs = brief?.observacion || venta.observaciones || "";

  const headerCocina = sectorBadge
    ? `<div class="sector-banner">${sectorBadge}</div>`
    : "";
  const totalesHtml = showPrices
    ? `<hr>
       <table class="totales">
         <tbody>
           <tr><td class="lbl">Subtotal</td><td class="val">${formatGs(subtotal)}</td></tr>
           ${ivaTotal > 0 ? `<tr><td class="lbl">IVA</td><td class="val">${formatGs(ivaTotal)}</td></tr>` : ""}
           <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${formatGs(total)}</td></tr>
           <tr><td class="lbl">Pago</td><td class="val">${metodoPagoLabel(venta.metodo_pago)}</td></tr>
         </tbody>
       </table>`
    : "";
  const footerHtml = showPrices
    ? `<hr>
       <div class="footer">
         ¡Gracias por tu compra!<br>
         Comprobante interno — no válido como factura legal.
       </div>`
    : `<div class="footer-cocina">${formatFecha(venta.fecha)}</div>`;

  return `<section class="paper ${isLast ? "last" : ""}">
    ${headerCocina || membreteTicket()}
    <div class="meta">
      ${escapeHtml(venta.numero_control)}<br>
      ${formatFecha(venta.fecha)}
    </div>
    ${datosPedido.length > 0 ? `<hr><div class="pedido">${datosPedido.join("")}</div>` : ""}
    <hr>
    <table>
      <tbody>${itemsHtml}</tbody>
    </table>
    ${totalesHtml}
    ${obs ? `<hr><div class="obs"><strong>Obs:</strong> ${escapeHtml(obs)}</div>` : ""}
    ${footerHtml}
  </section>`;
}

// ── Nota de remisión (documento NO fiscal) ─────────────────────────────────

interface ClienteRemision {
  nombre: string | null;
  ruc: string | null;
  documento: string | null;
  direccion: string | null;
  ciudad: string | null;
}

/** HTML imprimible de Nota de Remisión. Por defecto NO muestra precios (solo productos y cantidades). */
function renderNotaRemision(opts: {
  negocio: string;
  venta: VentaRow;
  items: Array<ItemRow & { unidad: string }>;
  cliente: ClienteRemision | null;
}): string {
  const { negocio, venta, items, cliente } = opts;
  const numeroNota = venta.nota_remision_numero || "—";
  const filas = items
    .map((it) => {
      const cant = Number(it.cantidad);
      const presNombre = (it.presentacion_nombre ?? "").trim();
      const cantBase = it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : 1;
      const showsPres = !!presNombre && presNombre.toLowerCase() !== "unidad";
      // Si la presentacion no es 'Unidad', usamos su nombre como unidad y
      // mostramos la equivalencia en linea debajo del nombre del producto.
      const unidadCell = showsPres ? escapeHtml(presNombre) : escapeHtml(it.unidad || "UNIDAD");
      const equivLinea =
        showsPres && cantBase > 1
          ? `<span class="sku" style="color:#555;">= ${cant * cantBase} ${escapeHtml(it.unidad || "unidades")}</span>`
          : "";
      return `<tr>
        <td class="cant">${cant}</td>
        <td class="uni">${unidadCell}</td>
        <td class="desc">${escapeHtml(it.producto_nombre)}<span class="sku">${escapeHtml(it.sku)}</span>${equivLinea}</td>
      </tr>`;
    })
    .join("");
  const cli = cliente
    ? [
        `<div><strong>${escapeHtml(cliente.nombre || "—")}</strong></div>`,
        cliente.ruc ? `<div>RUC: ${escapeHtml(cliente.ruc)}</div>` : "",
        !cliente.ruc && cliente.documento ? `<div>Documento: ${escapeHtml(cliente.documento)}</div>` : "",
        cliente.direccion ? `<div>Dirección: ${escapeHtml(cliente.direccion)}</div>` : "",
        cliente.ciudad ? `<div>Ciudad: ${escapeHtml(cliente.ciudad)}</div>` : "",
      ].filter(Boolean).join("")
    : `<div>—</div>`;
  const obs = venta.observaciones ? `<div class="obs"><strong>Observación:</strong> ${escapeHtml(venta.observaciones)}</div>` : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Nota de remisión ${escapeHtml(numeroNota)} — ${escapeHtml(negocio)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:24px; }
  .doc { background:#fff; max-width:720px; margin:0 auto; padding:28px 32px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  h1 { font-size:18px; text-align:center; letter-spacing:1px; margin:0 0 2px; }
  .titulo { text-align:center; font-weight:800; font-size:15px; border:2px solid #111; padding:6px; margin:12px 0 16px; letter-spacing:2px; }
  .row { display:flex; justify-content:space-between; gap:24px; font-size:13px; margin-bottom:14px; }
  .box { flex:1; border:1px solid #ddd; border-radius:8px; padding:10px 12px; }
  .box h3 { margin:0 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#666; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
  th,td { border:1px solid #ddd; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f6f6f6; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  td.cant, td.uni, th.cant, th.uni { text-align:center; width:64px; white-space:nowrap; }
  td.desc .sku { display:block; font-size:11px; color:#888; font-family:ui-monospace,monospace; }
  .obs { font-size:12px; margin-top:12px; }
  .legal { margin-top:18px; font-size:11px; color:#555; border-top:1px dashed #bbb; padding-top:10px; }
  .actions { max-width:720px; margin:0 auto 12px; text-align:right; }
  .actions button { background:#4FAEB2; color:#fff; border:none; border-radius:8px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.15); }
  .actions button:hover { background:#3F8E91; }
  .corte { display:none; }
  @page { size: A4 portrait; margin: 10mm; }
  @media print {
    html, body { background:#fff; padding:0; margin:0; }
    .doc { box-shadow:none; max-width:none; width:auto; padding:0; }
    .actions { display:none; }
    /* Marca visual de corte a la mitad: linea de tijera guia */
    .corte { display:flex; align-items:center; gap:8px; margin-top:14px; padding-top:8px;
             font-size:10px; color:#888; border-top:1px dashed #999; page-break-after:avoid; }
    .corte span { flex:1; text-align:center; letter-spacing:1px; text-transform:uppercase; }
    /* Fuerza al documento a NO exceder media hoja A4 (approx 130mm util con margen).
       Si el contenido es mas largo, el navegador expande normalmente y usa hoja entera. */
    .doc { min-height: 0; }
  }
</style></head>
<body>
<div class="actions"><button type="button" onclick="window.print()">🖨 Imprimir</button></div>
<div class="doc">
  ${membreteA4()}
  <div class="titulo">NOTA DE REMISIÓN</div>
  <div class="row">
    <div class="box"><h3>Documento</h3>
      <div><strong>N°:</strong> ${escapeHtml(numeroNota)}</div>
      <div><strong>Fecha:</strong> ${escapeHtml(formatFecha(venta.fecha))}</div>
      <div><strong>Venta:</strong> ${escapeHtml(venta.numero_control)}</div>
    </div>
    <div class="box"><h3>Cliente</h3>${cli}</div>
  </div>
  <table>
    <thead><tr><th class="cant">Cant.</th><th class="uni">Unidad</th><th>Descripción</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  ${obs}
  <div class="legal">Documento no fiscal. Emitido para acompañar la entrega de mercaderías.</div>
  <div class="corte"><span>✂ CORTAR AQUÍ ✂</span></div>
</div>
<script>try{ if (new URL(location.href).searchParams.get('auto')==='1') window.print(); }catch(e){}</script>
</body></html>`;
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const wParam = url.searchParams.get("w");
  const widthMm = wParam === "58" ? 58 : 80;
  const fontPx = widthMm === 58 ? 11 : 12;
  const modeComandas = url.searchParams.get("mode") === "comandas";
  const esRemision = url.searchParams.get("tipo") === "remision" || url.searchParams.get("mode") === "remision";

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;

  // Venta
  const vQ = await ctx.supabase
    .from("ventas")
    .select("id, numero_control, fecha, subtotal, monto_iva, total, observaciones, metodo_pago, cliente_id, genera_nota_remision, nota_remision_numero")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (vQ.error) return new NextResponse(`Error: ${vQ.error.message}`, { status: 500 });
  if (!vQ.data) return new NextResponse("Venta no encontrada", { status: 404 });
  const venta = vQ.data as unknown as VentaRow;

  // Nombre del negocio para el encabezado (env → empresa → fallback). Nunca hardcode.
  let nombreEmpresa: string | null = null;
  try {
    const eQ = await ctx.supabase
      .from("empresas")
      .select("nombre_empresa")
      .eq("id", empresaId)
      .maybeSingle();
    nombreEmpresa = (eQ.data as { nombre_empresa?: string | null } | null)?.nombre_empresa ?? null;
  } catch {
    nombreEmpresa = null;
  }
  const negocio = resolveNegocio(nombreEmpresa);

  // Items
  const iQ = await ctx.supabase
    .from("ventas_items")
    .select(
      "producto_id, producto_nombre, sku, cantidad, precio_venta, total_linea, presentacion_nombre, presentacion_cantidad_base"
    )
    .eq("venta_id", id)
    .eq("empresa_id", empresaId);
  if (iQ.error) return new NextResponse(`Error items: ${iQ.error.message}`, { status: 500 });
  const itemsRaw = (iQ.data ?? []) as unknown as ItemRow[];

  // ── Nota de remisión: documento separado (no fiscal). Solo productos + cantidades.
  if (esRemision) {
    // Unidades de medida por producto.
    const prodIds = [...new Set(itemsRaw.map((i) => i.producto_id))];
    const unidadByProd = new Map<string, string>();
    if (prodIds.length > 0) {
      const uQ = await ctx.supabase
        .from("productos")
        .select("id, unidad_medida")
        .eq("empresa_id", empresaId)
        .in("id", prodIds);
      for (const r of (uQ.data ?? []) as Array<{ id: string; unidad_medida: string | null }>) {
        unidadByProd.set(r.id, r.unidad_medida ?? "UNIDAD");
      }
    }
    // Cliente (si la venta tiene cliente_id).
    let clienteRem: ClienteRemision | null = null;
    if (venta.cliente_id) {
      const cQ = await ctx.supabase
        .from("clientes")
        .select("empresa, nombre, nombre_contacto, ruc, documento, direccion, ciudad")
        .eq("id", venta.cliente_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      const c = cQ.data as Record<string, string | null> | null;
      if (c) {
        const s = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
        clienteRem = {
          nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre),
          ruc: s(c.ruc),
          documento: s(c.documento),
          direccion: s(c.direccion),
          ciudad: s(c.ciudad),
        };
      }
    }
    const itemsRem = itemsRaw.map((it) => ({ ...it, unidad: unidadByProd.get(it.producto_id) ?? "UNIDAD" }));
    const htmlRem = renderNotaRemision({ negocio, venta, items: itemsRem, cliente: clienteRem });
    return new NextResponse(htmlRem, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Pedido cocina (opcional) — busca card de Pedidos vinculada a esta venta.
  let brief: PedidoBrief | null = null;
  try {
    const pQ = await ctx.supabase
      .from("proyectos")
      .select("brief_data")
      .eq("empresa_id", empresaId)
      .filter("metadata->>venta_id", "eq", id)
      .limit(1)
      .maybeSingle();
    if (!pQ.error && pQ.data) {
      brief = (pQ.data as { brief_data: PedidoBrief }).brief_data ?? null;
    }
  } catch {
    brief = null;
  }

  // Clasificación por categoría (primary) + SKU (fallback)
  const productoIds = [...new Set(itemsRaw.map((i) => i.producto_id))];
  const sectorByProd = new Map<string, Sector>();
  if (productoIds.length > 0) {
    try {
      // producto_categorias[principal] -> categorias_productos(slug, nombre)
      const pcQ = await ctx.supabase
        .from("producto_categorias")
        .select("producto_id, categoria_id, es_principal")
        .eq("empresa_id", empresaId)
        .in("producto_id", productoIds);
      const pcRows = (pcQ.data ?? []) as Array<{
        producto_id: string;
        categoria_id: string;
        es_principal: boolean | null;
      }>;
      const catIds = [...new Set(pcRows.map((r) => r.categoria_id))];
      const catMap = new Map<string, { slug: string | null; nombre: string | null }>();
      if (catIds.length > 0) {
        const cQ = await ctx.supabase
          .from("categorias_productos")
          .select("id, slug, nombre")
          .eq("empresa_id", empresaId)
          .in("id", catIds);
        for (const c of (cQ.data ?? []) as Array<{ id: string; slug: string | null; nombre: string | null }>) {
          catMap.set(c.id, { slug: c.slug ?? null, nombre: c.nombre ?? null });
        }
      }
      // Priorizamos la categoría es_principal=true; si no, la primera que matchee.
      for (const pid of productoIds) {
        const myCats = pcRows.filter((r) => r.producto_id === pid);
        const order = [...myCats].sort((a, b) => (a.es_principal ? -1 : 1) - (b.es_principal ? -1 : 1));
        let s: Sector = null;
        for (const r of order) {
          const meta = catMap.get(r.categoria_id);
          s = classifyByCategoria(meta?.slug ?? null, meta?.nombre ?? null);
          if (s) break;
        }
        sectorByProd.set(pid, s);
      }
    } catch {
      // ignoramos errores de categorías; cae al fallback por SKU.
    }
  }

  const items: EnrichedItem[] = itemsRaw.map((it) => {
    const fromCat = sectorByProd.get(it.producto_id) ?? null;
    const sector: Sector = fromCat ?? classifyBySku(it.sku);
    return { ...it, sector };
  });

  // Decidir qué copias imprimir
  const hayPizzeria = items.some((i) => i.sector === "pizzeria");
  const hayPlancha = items.some((i) => i.sector === "plancha");

  const copias: Array<"cliente" | "pizzeria" | "plancha"> = ["cliente"];
  if (modeComandas) {
    if (hayPizzeria) copias.push("pizzeria");
    if (hayPlancha) copias.push("plancha");
  }

  const seccionesHtml = copias
    .map((tipo, idx) =>
      renderCopia({ tipo, venta, items, brief, fontPx, isLast: idx === copias.length - 1, negocio })
    )
    .join("");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Ticket ${escapeHtml(venta.numero_control)} — ${escapeHtml(negocio)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: ${fontPx}px; color: #000; background: #f1f1f1; margin: 0; padding: 20px; }
  .paper { background: #fff; width: ${widthMm}mm; margin: 0 auto 12mm; padding: 6mm 4mm; box-shadow: 0 1px 4px rgba(0,0,0,0.1); page-break-after: always; break-after: page; }
  .paper.last { page-break-after: auto; break-after: auto; margin-bottom: 0; }
  h1 { font-size: ${fontPx + 4}px; text-align: center; margin: 0 0 2mm; letter-spacing: 1px; }
  .sector-banner { font-size: ${fontPx + 6}px; font-weight: 800; text-align: center; padding: 2mm; border: 2px solid #000; margin: 0 0 3mm; letter-spacing: 1px; }
  .meta { font-size: ${fontPx - 1}px; text-align: center; margin: 1mm 0 2mm; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .pedido { font-size: ${fontPx}px; margin: 1mm 0 2mm; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 0.5mm 0; }
  td.qty { width: 9mm; }
  td.amt { width: 22mm; text-align: right; white-space: nowrap; }
  tr.sub td { color: #555; font-size: ${fontPx - 2}px; padding-bottom: 1mm; }
  tr.muted td { color: #777; font-style: italic; }
  tr.match td { background: #fffbcc; }
  .totales td { padding: 0.7mm 0; }
  .totales .lbl { text-align: left; }
  .totales .val { text-align: right; white-space: nowrap; }
  .total-row { font-weight: bold; font-size: ${fontPx + 2}px; border-top: 1px solid #000; }
  .obs { font-size: ${fontPx - 1}px; margin: 2mm 0; }
  .footer { font-size: ${fontPx - 2}px; text-align: center; margin-top: 3mm; font-style: italic; }
  .footer-cocina { font-size: ${fontPx - 2}px; text-align: center; margin-top: 3mm; font-weight: bold; }
  .actions { max-width: ${widthMm}mm; margin: 8mm auto 0; text-align: center; }
  .actions button { padding: 8px 16px; font-size: 13px; cursor: pointer; border: 1px solid #333; background: #fff; border-radius: 6px; }
  .actions button:hover { background: #f5f5f5; }
  .actions a { margin-left: 12px; font-size: 13px; color: #444; }
  @media print {
    body { background: #fff; padding: 0; }
    .paper { width: ${widthMm}mm; box-shadow: none; padding: 2mm; margin: 0; }
    .actions { display: none; }
    @page { margin: 0; size: ${widthMm}mm auto; }
  }
</style>
</head>
<body>
  ${seccionesHtml}
  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a href="?${modeComandas ? "mode=comandas&" : ""}w=${widthMm === 80 ? 58 : 80}">Cambiar a ${widthMm === 80 ? 58 : 80}mm</a>
  </div>
  <script>
    try {
      var u = new URL(location.href);
      if (u.searchParams.get('auto') === '1') {
        setTimeout(function(){ window.print(); }, 250);
      }
    } catch (e) {}
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
