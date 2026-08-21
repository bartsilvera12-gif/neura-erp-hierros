import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Venta, LineaVenta, TipoIvaVenta, TipoPrecioVenta } from "@/lib/ventas/types";

interface VentaRow {
  id: string;
  empresa_id: string;
  numero_control: string;
  moneda: string;
  tipo_cambio: number | string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  tipo_venta: string;
  plazo_dias: number | null;
  fecha: string;
  usuario_nombre?: string | null;
  factura_id?: string | null;
}

interface VentaItemRow {
  venta_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta_original: number | string;
  precio_venta: number | string;
  tipo_iva: string;
  tipo_precio?: string;
  subtotal: number | string;
  monto_iva: number | string;
  total_linea: number | string;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function mapItems(rows: VentaItemRow[]): LineaVenta[] {
  return rows.map((r) => ({
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    sku: r.sku,
    cantidad: num(r.cantidad),
    precio_venta_original: num(r.precio_venta_original),
    precio_venta: num(r.precio_venta),
    tipo_iva: r.tipo_iva as TipoIvaVenta,
    tipo_precio: (r.tipo_precio === "mayorista" || r.tipo_precio === "distribuidor" || r.tipo_precio === "costo" ? r.tipo_precio : "minorista") as TipoPrecioVenta,
    subtotal: num(r.subtotal),
    monto_iva: num(r.monto_iva),
    total_linea: num(r.total_linea),
  }));
}

/** GET /api/ventas — listado vía PostgREST (compatible Hostinger sin pool). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const ventasQ = await ctx.supabase
      .from("ventas")
      .select(
        "id, empresa_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, fecha, genera_nota_remision, nota_remision_numero, usuario_nombre, estado, anulada_at, anulada_motivo, factura_id"
      )
      .eq("empresa_id", empresaId)
      .order("fecha", { ascending: false })
      .limit(500);
    if (ventasQ.error) throw new Error(ventasQ.error.message);

    // Puente venta→factura: para las ventas que ya tienen factura ERP, cargar en
    // batch el numero_factura (tabla facturas) y el estado SIFEN (factura_electronica).
    // Best-effort: si estas consultas fallan, el listado sigue sirviendo sin esos datos.
    const facturaIds = [
      ...new Set(
        ((ventasQ.data ?? []) as VentaRow[])
          .map((v) => v.factura_id)
          .filter((x): x is string => !!x)
      ),
    ];
    const numeroFacturaByIdMap = new Map<string, string>();
    const estadoSifenByFacturaMap = new Map<string, string>();
    if (facturaIds.length > 0) {
      const facQ = await ctx.supabase
        .from("facturas")
        .select("id, numero_factura")
        .eq("empresa_id", empresaId)
        .in("id", facturaIds);
      if (!facQ.error) {
        for (const row of (facQ.data ?? []) as Array<{ id: string; numero_factura?: string | null }>) {
          if (row.numero_factura) numeroFacturaByIdMap.set(row.id, row.numero_factura);
        }
      }
      const feQ = await ctx.supabase
        .from("factura_electronica")
        .select("factura_id, estado_sifen")
        .eq("empresa_id", empresaId)
        .in("factura_id", facturaIds);
      if (!feQ.error) {
        for (const row of (feQ.data ?? []) as Array<{ factura_id: string; estado_sifen?: string | null }>) {
          if (row.estado_sifen) estadoSifenByFacturaMap.set(row.factura_id, row.estado_sifen);
        }
      }
    }

    const itemsQ = await ctx.supabase
      .from("ventas_items")
      .select(
        "venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original, precio_venta, tipo_iva, tipo_precio, subtotal, monto_iva, total_linea"
      )
      .eq("empresa_id", empresaId);
    if (itemsQ.error) throw new Error(itemsQ.error.message);

    const ventasRows = (ventasQ.data ?? []) as VentaRow[];
    const itemsRows = (itemsQ.data ?? []) as VentaItemRow[];

    const byVenta = new Map<string, VentaItemRow[]>();
    for (const row of itemsRows) {
      const list = byVenta.get(row.venta_id) ?? [];
      list.push(row);
      byVenta.set(row.venta_id, list);
    }

    const ventas: Venta[] = ventasRows.map((r) => {
      const lineRows = byVenta.get(r.id) ?? [];
      return {
        id: r.id,
        numero_control: r.numero_control,
        items: mapItems(lineRows),
        moneda: r.moneda === "USD" ? "USD" : "GS",
        tipo_cambio: num(r.tipo_cambio),
        subtotal: num(r.subtotal),
        monto_iva: num(r.monto_iva),
        total: num(r.total),
        tipo_venta: r.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        plazo_dias: r.plazo_dias ?? undefined,
        metodo_pago: (r as unknown as { metodo_pago?: string }).metodo_pago === "tarjeta"
          ? "tarjeta"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "transferencia"
          ? "transferencia"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "efectivo"
          ? "efectivo"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "mixto"
          ? "mixto"
          : undefined,
        genera_nota_remision: (r as unknown as { genera_nota_remision?: boolean }).genera_nota_remision === true,
        nota_remision_numero: (r as unknown as { nota_remision_numero?: string | null }).nota_remision_numero ?? null,
        fecha: r.fecha,
        usuario_nombre: r.usuario_nombre ?? null,
        factura_id: r.factura_id ?? null,
        numero_factura: r.factura_id ? numeroFacturaByIdMap.get(r.factura_id) ?? null : null,
        factura_estado_sifen: r.factura_id ? estadoSifenByFacturaMap.get(r.factura_id) ?? null : null,
        estado: ((): "activa" | "anulada" | "parcialmente_devuelta" | "devuelta_total" => {
          const e = (r as unknown as { estado?: string }).estado;
          if (e === "anulada") return "anulada";
          if (e === "devuelta_total") return "devuelta_total";
          if (e === "parcialmente_devuelta") return "parcialmente_devuelta";
          return "activa";
        })(),
        anulada_at: (r as unknown as { anulada_at?: string | null }).anulada_at ?? null,
        anulada_motivo: (r as unknown as { anulada_motivo?: string | null }).anulada_motivo ?? null,
      };
    });

    return NextResponse.json(successResponse({ ventas }));
  } catch (err) {
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
