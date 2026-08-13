import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ESTADOS_PRESUPUESTO, type EstadoPresupuesto } from "@/lib/presupuestos/types";

const PRESU_COLS =
  "id, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_direccion, " +
  "numero_control, estado, moneda, subtotal, monto_iva, descuento_total, total, validez_dias, " +
  "fecha, fecha_vencimiento, forma_pago, plazo_entrega, observaciones, " +
  "convertido_pedido_id, convertido_venta_id, created_at, updated_at";

const ITEM_COLS =
  "id, producto_id, producto_nombre, sku, cantidad, unidad_medida, precio_unitario, iva_tipo, subtotal, monto_iva, descuento, total";

/** GET /api/presupuestos/[id] — detalle + ítems. */
export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const pq = await ctx.supabase
      .from("presupuestos")
      .select(PRESU_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (pq.error) throw new Error(pq.error.message);
    if (!pq.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const itq = await ctx.supabase
      .from("presupuesto_items")
      .select(ITEM_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id)
      .order("created_at", { ascending: true });
    if (itq.error) throw new Error(itq.error.message);

    return NextResponse.json(successResponse({ presupuesto: pq.data, items: itq.data ?? [] }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el presupuesto."), { status: 500 });
  }
}

/**
 * PATCH /api/presupuestos/[id] — dos modos:
 *   1) Solo `estado` en el body → cambio de estado (creado|enviado|aprobado|rechazado).
 *   2) Body con `items` (y opcionalmente cliente_*, moneda, condiciones) → edicion
 *      completa: reemplaza header + items. Prohibido si estado === 'convertido'.
 * NO permite setear 'convertido' por acá (eso lo hace /convertir). NO toca stock.
 */
function asIva(v: unknown): "EXENTA" | "5%" | "10%" {
  return v === "EXENTA" || v === "5%" || v === "10%" ? v : "10%";
}
export async function PATCH(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    // Verificar estado actual (no editable si convertido).
    const cur = await ctx.supabase
      .from("presupuestos")
      .select("estado")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if ((cur.data as { estado: string }).estado === "convertido") {
      return NextResponse.json(errorResponse("El presupuesto ya fue convertido; no se puede editar."), { status: 409 });
    }

    // ═══════ MODO 2: edicion completa (body incluye items) ═══════
    if (Array.isArray(body.items)) {
      const rawItems = body.items as Record<string, unknown>[];
      if (rawItems.length === 0) {
        return NextResponse.json(errorResponse("El presupuesto debe tener al menos un item."), { status: 400 });
      }
      const clienteNombre = String(body.cliente_nombre ?? "").trim();
      if (!clienteNombre) {
        return NextResponse.json(errorResponse("El nombre del cliente es obligatorio."), { status: 400 });
      }

      // Calcular totales desde los items.
      let subtotal = 0, monto_iva = 0, descuento_total = 0, total = 0;
      const itemsToInsert: Record<string, unknown>[] = [];
      for (const it of rawItems) {
        const cantidad = Number(it.cantidad);
        const precio = Number(it.precio_unitario);
        const desc = Math.max(0, Number(it.descuento) || 0);
        const iva_tipo = asIva(it.iva_tipo);
        const nombre = String(it.producto_nombre ?? "").trim();
        if (!nombre || !(cantidad > 0) || !(precio >= 0)) {
          return NextResponse.json(errorResponse(`Item invalido: ${nombre || "sin nombre"}`), { status: 400 });
        }
        const bruto = cantidad * precio - desc;
        const factor = iva_tipo === "10%" ? 1.1 : iva_tipo === "5%" ? 1.05 : 1;
        const sub = iva_tipo === "EXENTA" ? bruto : bruto / factor;
        const iva = bruto - sub;
        subtotal += sub;
        monto_iva += iva;
        descuento_total += desc;
        total += bruto;
        itemsToInsert.push({
          empresa_id: ctx.auth.empresa_id,
          presupuesto_id: id,
          producto_id: it.producto_id ? String(it.producto_id) : null,
          producto_nombre: nombre,
          sku: it.sku ? String(it.sku) : null,
          cantidad,
          unidad_medida: it.unidad_medida ? String(it.unidad_medida) : null,
          precio_unitario: precio,
          iva_tipo,
          subtotal: Math.round(sub),
          monto_iva: Math.round(iva),
          descuento: desc,
          total: Math.round(bruto),
        });
      }

      // Delete items viejos + insertar nuevos.
      const delR = await ctx.supabase.from("presupuesto_items").delete()
        .eq("empresa_id", ctx.auth.empresa_id).eq("presupuesto_id", id);
      if (delR.error) throw new Error(delR.error.message);
      const insR = await ctx.supabase.from("presupuesto_items").insert(itemsToInsert);
      if (insR.error) throw new Error(insR.error.message);

      const validezRaw = body.validez_dias;
      const validez = validezRaw === null || validezRaw === undefined || String(validezRaw).trim() === ""
        ? null
        : Math.max(0, parseInt(String(validezRaw), 10) || 0) || null;

      const updHead = await ctx.supabase.from("presupuestos").update({
        cliente_id: body.cliente_id ? String(body.cliente_id) : null,
        cliente_nombre: clienteNombre,
        cliente_ruc: body.cliente_ruc ? String(body.cliente_ruc) : null,
        cliente_telefono: body.cliente_telefono ? String(body.cliente_telefono) : null,
        cliente_direccion: body.cliente_direccion ? String(body.cliente_direccion) : null,
        moneda: body.moneda === "USD" ? "USD" : "PYG",
        subtotal: Math.round(subtotal),
        monto_iva: Math.round(monto_iva),
        descuento_total: Math.round(descuento_total),
        total: Math.round(total),
        validez_dias: validez,
        forma_pago: body.forma_pago ? String(body.forma_pago) : null,
        plazo_entrega: body.plazo_entrega ? String(body.plazo_entrega) : null,
        observaciones: body.observaciones ? String(body.observaciones).slice(0, 4000) : null,
        updated_at: new Date().toISOString(),
      })
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .select(PRESU_COLS)
        .maybeSingle();
      if (updHead.error) throw new Error(updHead.error.message);
      return NextResponse.json(successResponse({ presupuesto: updHead.data }));
    }

    // ═══════ MODO 1: cambio de estado ═══════
    const nuevoEstado = body.estado as EstadoPresupuesto | undefined;
    if (!nuevoEstado || !ESTADOS_PRESUPUESTO.includes(nuevoEstado)) {
      return NextResponse.json(errorResponse("Estado inválido."), { status: 400 });
    }
    if (nuevoEstado === "convertido") {
      return NextResponse.json(
        errorResponse("Para convertir usá la acción 'Convertir en pedido'."),
        { status: 400 }
      );
    }

    const upd = await ctx.supabase
      .from("presupuestos")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select(PRESU_COLS)
      .maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    return NextResponse.json(successResponse({ presupuesto: upd.data }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el presupuesto."), { status: 500 });
  }
}

/** DELETE /api/presupuestos/[id] — borra el presupuesto y sus ítems (no si está convertido). */
export async function DELETE(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const cur = await ctx.supabase
      .from("presupuestos")
      .select("estado")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (cur.error) throw new Error(cur.error.message);
    if (!cur.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if ((cur.data as { estado: string }).estado === "convertido") {
      return NextResponse.json(errorResponse("El presupuesto ya fue convertido; no se puede borrar."), { status: 409 });
    }

    // Ítems primero (por si no hay ON DELETE CASCADE), luego la cabecera.
    await ctx.supabase
      .from("presupuesto_items")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("presupuesto_id", id);
    const del = await ctx.supabase
      .from("presupuestos")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id);
    if (del.error) throw new Error(del.error.message);

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/presupuestos/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el presupuesto."), { status: 500 });
  }
}
