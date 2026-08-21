/**
 * Cliente API para crear registros vía endpoints REST.
 * Envía JWT de Supabase (localStorage) en Authorization.
 */

import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

async function apiPost<T>(path: string, data: Record<string, unknown>): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const res = await fetchWithSupabaseSession(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { success: false, error: res.ok ? "Respuesta inválida del servidor" : `Error ${res.status}` };
  }
  const body = json as { success?: boolean; data?: T; error?: string };
  if (!res.ok) {
    return { success: false, error: body?.error ?? `Error ${res.status}` };
  }
  if (body?.success !== true || body.data === undefined || body.data === null) {
    return { success: false, error: body?.error ?? "Respuesta inválida del servidor" };
  }
  return { success: true, data: body.data };
}

async function apiPatch<T>(path: string, data: Record<string, unknown>): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const res = await fetchWithSupabaseSession(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { success: false, error: res.ok ? "Respuesta inválida del servidor" : `Error ${res.status}` };
  }
  const body = json as { success?: boolean; data?: T; error?: string };
  if (!res.ok) {
    return { success: false, error: body?.error ?? `Error ${res.status}` };
  }
  if (body?.success !== true || body.data === undefined || body.data === null) {
    return { success: false, error: body?.error ?? "Respuesta inválida del servidor" };
  }
  return { success: true, data: body.data };
}

async function apiPut<T>(path: string, data: Record<string, unknown>): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const res = await fetchWithSupabaseSession(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { success: false, error: res.ok ? "Respuesta inválida del servidor" : `Error ${res.status}` };
  }
  const body = json as { success?: boolean; data?: T; error?: string };
  if (!res.ok) {
    return { success: false, error: body?.error ?? `Error ${res.status}` };
  }
  if (body?.success !== true || body.data === undefined || body.data === null) {
    return { success: false, error: body?.error ?? "Respuesta inválida del servidor" };
  }
  return { success: true, data: body.data };
}

export async function apiCreateCliente(data: {
  tipo_cliente?: string;
  tipo_servicio_cliente?: string;
  empresa?: string;
  nombre_contacto: string;
  ruc?: string;
  documento?: string;
  nombre_facturacion?: string | null;
  nivel_precio?: "minorista" | "mayorista" | "distribuidor";
  es_contribuyente?: boolean;
  telefono?: string;
  email?: string;
  direccion?: string;
  ciudad?: string;
  pais?: string;
  condicion_pago?: string;
  moneda_preferida?: string;
  estado?: string;
  usa_nota_remision?: boolean;
  plan_comercial_id?: string | null;
  vendedor_asignado?: string;
  vendedor_usuario_id?: string | null;
  sifen_receptor_extranjero?: boolean;
  sifen_codigo_pais?: string | null;
  sifen_tipo_doc_receptor?: number | null;
  sifen_receptor_manual?: boolean;
  sifen_receptor_naturaleza?: string | null;
  sifen_ti_ope?: number | null;
  sifen_num_id_de?: string | null;
  sifen_direccion_de?: string | null;
  sifen_num_casa_de?: number | null;
  sifen_descripcion_tipo_doc?: string | null;
}): Promise<
  | { ok: true; data: { id: string; [key: string]: unknown } }
  | { ok: false; error: string }
> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/clientes", data);
  if (!result.success) {
    return { ok: false, error: result.error };
  }
  return { ok: true, data: result.data };
}

export type BajaOperativaPreview = {
  suscripciones_activas: number;
  facturas_pendientes_count?: number;
  factura_pendiente_mes: { id: string; numero_factura: string; monto: number } | null;
  suscripciones: { id: string; precio: number; moneda: string }[];
};

/** Obtiene datos previos para dar de baja (suscripciones, facturas con saldo). */
export async function apiGetBajaOperativaPreview(clienteId: string): Promise<BajaOperativaPreview | null> {
  const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/baja-operativa`);
  const json = await res.json();
  if (!res.ok) return null;
  return json?.data ?? null;
}

/** Dar de baja operativa al cliente. Solo admin. Motivo obligatorio. */
export async function apiBajaOperativaCliente(
  clienteId: string,
  motivo: string,
  anularFacturaPendiente: boolean,
  cancelarSuscripciones = true
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/baja-operativa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      motivo: motivo.trim(),
      anular_factura_pendiente: anularFacturaPendiente,
      cancelar_suscripciones: cancelarSuscripciones,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json?.error ?? `Error ${res.status}` };
  }
  return { ok: true };
}

/**
 * Bandera `zentra_erp.empresas.gestion_tributaria_clientes`.
 * Ante error HTTP o columna/permiso, **lanza** (no devuelve false) para que la UI muestre el error y no se confunda con “función apagada”.
 */
export async function apiGetGestionTributariaClientes(): Promise<boolean> {
  const res = await fetchWithSupabaseSession("/api/empresas/gestion-tributaria-clientes", { cache: "no-store" });
  let json: { success?: boolean; data?: { gestion_tributaria_clientes?: boolean }; error?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error("Respuesta inválida del servidor al leer gestión tributaria.");
  }
  if (!res.ok) {
    throw new Error(json?.error ?? `Error ${res.status} al leer gestión tributaria de clientes.`);
  }
  if (json.success !== true || json.data == null) {
    throw new Error(json?.error ?? "Respuesta inválida al leer gestión tributaria de clientes.");
  }
  return Boolean(json.data.gestion_tributaria_clientes);
}

export async function apiPatchGestionTributariaClientes(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPatch<{ gestion_tributaria_clientes: boolean }>(
    "/api/empresas/gestion-tributaria-clientes",
    { gestion_tributaria_clientes: on }
  );
  if (!r.success) return { ok: false, error: r.error };
  return { ok: true };
}

export type ObligacionCatalogoApi = {
  id: string;
  slug: string;
  nombre: string;
  requiere_detalle_otro: boolean;
};

export async function apiGetObligacionesTributariasCatalogo(): Promise<ObligacionCatalogoApi[]> {
  const res = await fetchWithSupabaseSession("/api/clientes/obligaciones-tributarias-catalogo", { cache: "no-store" });
  const json = (await res.json()) as { success?: boolean; data?: { items?: ObligacionCatalogoApi[] } };
  if (!res.ok || json.success !== true || !json.data?.items) return [];
  return json.data.items;
}

/** Actualiza perfil tributario del cliente (PUT). Omitir `clave_tributaria` para conservar la actual; `null` limpia. */
export async function apiPutClientePerfilTributario(
  clienteId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const r = await apiPut<{ perfil: unknown }>(
    `/api/clientes/${encodeURIComponent(clienteId)}/perfil-tributario`,
    payload
  );
  if (!r.success) return { ok: false, error: r.error };
  return { ok: true };
}

export type EliminarClientePreview = {
  suscripciones_activas: number;
  /** Todas las suscripciones del cliente (cualquier estado). */
  suscripciones_total: number;
  suscripciones: { id: string; precio: number; moneda: string }[];
  facturas_pendientes_count: number;
  /** Facturas con estado Pagado. */
  facturas_pagadas_count: number;
  /** Facturas no anuladas (emitidas / vigentes en el libro). */
  facturas_emitidas_count: number;
  /** Pagos registrados contra facturas del cliente. */
  pagos_registrados_count: number;
  factura_ejemplo: { id: string; numero_factura: string; monto: number } | null;
  puede_eliminar: boolean;
  bloqueos: string[];
};

/** Vista previa antes de eliminar (suscripciones activas, facturas con saldo, bloqueos). Solo admin. */
export async function apiGetEliminarClientePreview(clienteId: string): Promise<EliminarClientePreview | null> {
  const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/eliminar-preview`);
  const json = await res.json();
  if (!res.ok) return null;
  return json?.data ?? null;
}

/** Eliminación lógica del cliente. Solo admin. Requiere motivo y flags si aplica (ver eliminar-preview). */
export async function apiDeleteCliente(
  id: string,
  deletionReason: string,
  opts?: { cancelar_suscripciones?: boolean; anular_facturas_pendientes?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchWithSupabaseSession(`/api/clientes/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deletion_reason: deletionReason,
      cancelar_suscripciones: opts?.cancelar_suscripciones ?? false,
      anular_facturas_pendientes: opts?.anular_facturas_pendientes ?? false,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json?.error ?? `Error ${res.status}` };
  }
  return { ok: true };
}


export async function apiCreateFactura(data: {
  cliente_id: string;
  /** Deprecated: el servidor reserva correlativo real por empresa/schema. */
  numero_factura?: string;
  fecha: string;
  fecha_vencimiento: string;
  monto: number;
  tipo: "contado" | "credito" | "suscripcion";
  moneda?: string;
  /** Línea única de detalle (inserta factura_items en el servidor; evita Supabase browser). */
  descripcion_linea?: string;
  /** Solo si `tipo` = suscripcion y no enviás fecha_vencimiento explícita. */
  dia_vencimiento?: number;
  /** IVA puntual por factura (default `iva_10` para preservar comportamiento). */
  iva_tipo?: "exenta" | "iva_5" | "iva_10";
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/facturas", data);
  return result.success ? result.data : null;
}

/**
 * Variante con error expuesto. Útil para UI que necesita mostrar el mensaje cuando POST `/api/facturas`
 * falla (p. ej. tenants `erp_*` con PG shim, validaciones de monto/tipo, errores de FK, etc.).
 * El callsite original `apiCreateFactura` se mantiene para preservar todos los demás usos.
 */
export async function apiCreateFacturaWithError(data: Parameters<typeof apiCreateFactura>[0]): Promise<
  | { ok: true; data: { id: string; [key: string]: unknown } }
  | { ok: false; error: string }
> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/facturas", data);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

export async function apiCreatePago(data: {
  factura_id: string;
  monto: number;
  fecha_pago: string;
  metodo_pago?: string;
  referencia?: string;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/pagos", data);
  return result.success ? result.data : null;
}

export async function apiCreateSuscripcion(data: {
  cliente_id: string;
  plan_id?: string | null;
  precio: number;
  moneda?: string;
  fecha_inicio: string;
  duracion_meses?: number;
  dia_facturacion?: number;
  dia_vencimiento?: number;
  generar_factura_este_mes?: boolean;
}): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await apiPost<{ id: string; [key: string]: unknown }>("/api/suscripciones", data);
  return result.success ? result.data : null;
}
