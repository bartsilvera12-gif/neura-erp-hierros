import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/gastos
 * Gastos operativos del tenant (service role).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const { data, error } = await supabase
      .from("gastos")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .order("fecha", { ascending: false });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data ?? []));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/gastos — crea un gasto operativo.
 * Body: { categoria, descripcion, monto, tipo: 'fijo'|'variable', recurrente,
 *         frecuencia?, fecha (YYYY-MM-DD) }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(errorResponse("El monto debe ser mayor a 0."), { status: 400 });
    }
    const tipo = body.tipo === "fijo" ? "fijo" : "variable";
    const fecha = typeof body.fecha === "string" && body.fecha.match(/^\d{4}-\d{2}-\d{2}/)
      ? body.fecha.slice(0, 10)
      : null;
    if (!fecha) {
      return NextResponse.json(errorResponse("Fecha inválida."), { status: 400 });
    }
    const categoria = body.categoria != null ? String(body.categoria).trim() : "";
    const descripcion = body.descripcion != null ? String(body.descripcion).trim() : "";
    const recurrente = body.recurrente === true;
    const frecuencia = body.frecuencia != null ? String(body.frecuencia).trim() : "";
    const descuentaCaja = body.descuenta_caja === true;

    // Si el gasto descuenta de caja, buscamos una caja abierta AHORA
    // (no permite descontar de cajas cerradas — mantiene arqueos historicos limpios).
    let cajaMovimientoId: string | null = null;
    if (descuentaCaja) {
      const cajaQ = await ctx.supabase
        .from("cajas")
        .select("id")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("estado", "abierta")
        .order("fecha_apertura", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cajaQ.error) return NextResponse.json(errorResponse(cajaQ.error.message), { status: 500 });
      if (!cajaQ.data) {
        return NextResponse.json(
          errorResponse("No hay caja abierta para descontar este gasto. Abrí una caja o desactivá 'Descontar de caja'."),
          { status: 400 }
        );
      }
      const concepto = `Gasto: ${descripcion || categoria || "sin descripción"}`.slice(0, 200);
      const insMov = await ctx.supabase
        .from("caja_movimientos")
        .insert({
          empresa_id: ctx.auth.empresa_id,
          caja_id: cajaQ.data.id,
          tipo: "egreso",
          concepto,
          monto,
          medio_pago: "efectivo",
          usuario_id: ctx.auth.usuarioCatalogId ?? null,
          usuario_email: ctx.auth.user?.email ?? null,
        })
        .select("id")
        .single();
      if (insMov.error) return NextResponse.json(errorResponse(insMov.error.message), { status: 500 });
      cajaMovimientoId = String(insMov.data.id);
    }

    const { data, error } = await ctx.supabase
      .from("gastos")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        categoria: categoria || null,
        descripcion: descripcion || null,
        monto,
        tipo,
        recurrente,
        frecuencia: frecuencia || null,
        fecha,
        descuenta_caja: descuentaCaja,
        caja_movimiento_id: cajaMovimientoId,
      })
      .select()
      .single();

    if (error) {
      // Rollback best-effort del movimiento de caja si el gasto no se pudo guardar.
      if (cajaMovimientoId) {
        try {
          await ctx.supabase.from("caja_movimientos").delete().eq("id", cajaMovimientoId);
        } catch { /* rollback best-effort */ }
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/gastos — edita un gasto operativo.
 * Body: { id, categoria?, descripcion?, monto?, tipo?, recurrente?, frecuencia?, fecha? }
 * Server-side (service role) para resolver el schema del tenant correctamente:
 * el cliente del browser no conoce el schema y apuntaría al equivocado.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json(errorResponse("Falta el id del gasto."), { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (body.categoria !== undefined) update.categoria = String(body.categoria ?? "").trim() || null;
    if (body.descripcion !== undefined) update.descripcion = String(body.descripcion ?? "").trim() || null;
    if (body.monto !== undefined) {
      const monto = Number(body.monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        return NextResponse.json(errorResponse("El monto debe ser mayor a 0."), { status: 400 });
      }
      update.monto = monto;
    }
    if (body.tipo !== undefined) update.tipo = body.tipo === "fijo" ? "fijo" : "variable";
    if (body.recurrente !== undefined) update.recurrente = body.recurrente === true;
    if (body.frecuencia !== undefined) update.frecuencia = String(body.frecuencia ?? "").trim() || null;
    if (body.fecha !== undefined) {
      const fecha = typeof body.fecha === "string" && body.fecha.match(/^\d{4}-\d{2}-\d{2}/)
        ? body.fecha.slice(0, 10)
        : null;
      if (!fecha) {
        return NextResponse.json(errorResponse("Fecha inválida."), { status: 400 });
      }
      update.fecha = fecha;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar."), { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("gastos")
      .update(update)
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Gasto no encontrado."), { status: 404 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/gastos?id=<uuid> — elimina un gasto operativo (service role, schema del tenant).
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json(errorResponse("Falta el id del gasto."), { status: 400 });
    }
    const { error } = await ctx.supabase
      .from("gastos")
      .delete()
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
