import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { Proveedor, ProveedorCategoria } from "@/lib/proveedores/types";
import {
  getProveedorById,
  updateProveedor,
  listRelacionesDeProveedor,
  replaceRelacionesProveedor,
  findProveedorByRuc,
  listCategoriasMin,
  type ProveedorRow,
  type InsertProveedorInput,
} from "@/lib/proveedores/server/proveedores-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

function mapProveedorRow(r: ProveedorRow): Proveedor {
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    nombre: r.nombre ?? "",
    nombre_comercial: r.nombre_comercial ?? null,
    razon_social: r.razon_social ?? null,
    ruc: r.ruc ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    direccion: r.direccion ?? null,
    contacto: r.contacto ?? null,
    estado: r.estado === "inactivo" ? "inactivo" : "activo",
    condicion_pago:
      r.condicion_pago === "contado" || r.condicion_pago === "credito" || r.condicion_pago === "mixto"
        ? r.condicion_pago
        : null,
    plazo_pago_dias: r.plazo_pago_dias != null ? Number(r.plazo_pago_dias) : null,
    moneda_preferida: r.moneda_preferida === "USD" ? "USD" : r.moneda_preferida === "GS" ? "GS" : null,
    observaciones: r.observaciones ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function attachCategoriasInfo(
  schema: string,
  empresaId: string,
  proveedorId: string
): Promise<Pick<ProveedorCategoria, "id" | "nombre" | "activo">[]> {
  const ids = await listRelacionesDeProveedor(schema, empresaId, proveedorId);
  if (ids.length === 0) return [];
  const cats = await listCategoriasMin(schema, empresaId);
  const byId = new Map(cats.map((c) => [c.id, c]));
  return ids
    .map((cid) => byId.get(cid))
    .filter((c): c is { id: string; nombre: string; activo: boolean } => !!c)
    .map((c) => ({ id: c.id, nombre: c.nombre, activo: c.activo }));
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(tenant.auth.empresa_id);
    const empresaId = tenant.auth.empresa_id;
    const { id } = await ctx.params;

    const row = await getProveedorById(schema, empresaId, id);
    if (!row) return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });

    const prov = mapProveedorRow(row);
    prov.categorias = await attachCategoriasInfo(schema, empresaId, id);
    return NextResponse.json(successResponse({ proveedor: prov }));
  } catch (err) {
    console.error("[/api/proveedores/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el proveedor."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(tenant.auth.empresa_id);
    const empresaId = tenant.auth.empresa_id;
    const { id } = await ctx.params;

    const existing = await getProveedorById(schema, empresaId, id);
    if (!existing) return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Partial<InsertProveedorInput> = {};
    if (body.nombre !== undefined) {
      const n = normalizeUpperText(body.nombre);
      if (!n) return NextResponse.json(errorResponse("El nombre no puede quedar vacío."), { status: 400 });
      patch.nombre = n;
    }
    if (body.nombre_comercial !== undefined) patch.nombre_comercial = normalizeUpperNullable(body.nombre_comercial);
    if (body.razon_social !== undefined) patch.razon_social = normalizeUpperNullable(body.razon_social);
    if (body.ruc !== undefined) patch.ruc = normalizeUpperNullable(body.ruc);
    if (body.telefono !== undefined) patch.telefono = body.telefono == null ? null : String(body.telefono).trim() || null;
    if (body.email !== undefined) patch.email = body.email == null ? null : String(body.email).trim().toLowerCase() || null;
    if (body.direccion !== undefined) patch.direccion = normalizeUpperNullable(body.direccion);
    if (body.contacto !== undefined) patch.contacto = normalizeUpperNullable(body.contacto);
    if (body.estado !== undefined) patch.estado = body.estado === "inactivo" ? "inactivo" : "activo";
    if (body.condicion_pago !== undefined) {
      patch.condicion_pago =
        body.condicion_pago === "contado" || body.condicion_pago === "credito" || body.condicion_pago === "mixto"
          ? (body.condicion_pago as "contado" | "credito" | "mixto")
          : null;
    }
    if (body.plazo_pago_dias !== undefined) {
      patch.plazo_pago_dias =
        body.plazo_pago_dias != null && String(body.plazo_pago_dias).trim() !== ""
          ? parseInt(String(body.plazo_pago_dias), 10) || null
          : null;
    }
    if (body.moneda_preferida !== undefined) {
      patch.moneda_preferida = body.moneda_preferida === "USD" || body.moneda_preferida === "GS"
        ? (body.moneda_preferida as "USD" | "GS")
        : null;
    }
    if (body.observaciones !== undefined) patch.observaciones = normalizeUpperNullable(body.observaciones);

    // RUC duplicado (excluyendo el propio)
    if (patch.ruc) {
      try {
        const dup = await findProveedorByRuc(schema, empresaId, patch.ruc);
        if (dup && dup.id !== id) {
          return NextResponse.json(
            errorResponse(`Ya existe otro proveedor con el mismo RUC ("${dup.nombre}").`),
            { status: 409 }
          );
        }
      } catch { /* silenciado, se reintenta en el UPDATE */ }
    }

    try {
      if (Object.keys(patch).length > 0) {
        await updateProveedor(schema, empresaId, id, patch);
      }

      if (Array.isArray(body.categoria_ids)) {
        const categoriaIds = (body.categoria_ids as unknown[]).map((x) => String(x)).filter(Boolean);
        await replaceRelacionesProveedor(schema, empresaId, id, categoriaIds);
      }

      const row = await getProveedorById(schema, empresaId, id);
      if (!row) return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });
      const prov = mapProveedorRow(row);
      prov.categorias = await attachCategoriasInfo(schema, empresaId, id);
      return NextResponse.json(successResponse({ proveedor: prov }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      if (code === "23505" || /unique|duplicate/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe otro proveedor con datos únicos en conflicto."),
          { status: 409 }
        );
      }
      console.error("[/api/proveedores/[id] PATCH]", { schema, id, msg, code });
      return NextResponse.json(
        errorResponse("No se pudo actualizar el proveedor. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/proveedores/[id] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar el proveedor."), { status: 500 });
  }
}

/** DELETE /api/proveedores/[id] — borra el proveedor (si no tiene compras/órdenes asociadas). */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await getTenantSupabaseFromAuth(request);
    if (!tenant) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await ctx.params;
    const empresaId = tenant.auth.empresa_id;

    // Borrar primero los vínculos de categorías (si existen) para no chocar con FKs.
    await tenant.supabase
      .from("proveedor_categoria_links")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("proveedor_id", id);

    const del = await tenant.supabase
      .from("proveedores")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (del.error) {
      const msg = del.error.message ?? "";
      if (/foreign key|violates|23503/i.test(msg)) {
        return NextResponse.json(
          errorResponse("No se puede borrar: el proveedor tiene compras u órdenes asociadas. Desactivalo en su lugar."),
          { status: 409 }
        );
      }
      console.error("[/api/proveedores/[id] DELETE]", msg);
      return NextResponse.json(errorResponse("No se pudo borrar el proveedor."), { status: 500 });
    }
    if (!del.data) return NextResponse.json(errorResponse("Proveedor no encontrado."), { status: 404 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error("[/api/proveedores/[id] DELETE] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el proveedor."), { status: 500 });
  }
}
