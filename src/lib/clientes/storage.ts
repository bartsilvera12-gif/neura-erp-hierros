import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser } from "@/lib/auth";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import type { Cliente, EstadoCliente, NotaCliente, PerfilTributarioCliente } from "./types";

// ─── Tipo de fila Supabase ────────────────────────────────────────────────────
// RLS maneja empresa_id automáticamente; no filtrar manualmente en SELECT
interface SupabaseRow {
  id:                      string;
  empresa_id:              string | null;
  tipo_cliente:            string | null;
  tipo_servicio_cliente:   string | null;
  created_by_user_id:      string | null;
  created_by_nombre:       string | null;
  deleted_at:              string | null;
  deleted_by_user_id:      string | null;
  deletion_reason:         string | null;
  baja_operativa_at:         string | null;
  baja_operativa_by_user_id: string | null;
  baja_operativa_by_nombre:  string | null;
  baja_operativa_motivo:     string | null;
  baja_operativa_anulo_factura: boolean | null;
  empresa:            string | null;
  nombre:             string | null;
  nombre_contacto:    string | null;
  ruc:                string | null;
  documento:          string | null;
  nombre_facturacion?: string | null;
  nivel_precio?:      string | null;
  es_contribuyente?:  boolean | null;
  telefono:           string | null;
  telefono_secundario: string | null;
  email:              string | null;
  email_secundario:   string | null;
  direccion:          string | null;
  ciudad:             string | null;
  pais:               string | null;
  usa_nota_remision?: boolean | null;
  sifen_receptor_extranjero?: boolean | null;
  sifen_codigo_pais?: string | null;
  sifen_tipo_doc_receptor?: number | string | null;
  sifen_receptor_manual?: boolean | null;
  sifen_receptor_naturaleza?: string | null;
  sifen_ti_ope?: number | string | null;
  sifen_num_id_de?: string | null;
  sifen_direccion_de?: string | null;
  sifen_num_casa_de?: number | string | null;
  sifen_descripcion_tipo_doc?: string | null;
  sitio_web:          string | null;
  instagram:          string | null;
  linkedin:           string | null;
  valor_cliente:      number | null;
  condicion_pago:     string | null;
  moneda_preferida:   string | null;
  vendedor_asignado:  string | null;
  vendedor_usuario_id?: string | null;
  vendedor_usuario_nombre?: string | null;
  vendedor_usuario_email?: string | null;
  origen:             string | null;
  prospecto_id:       number | null;
  estado:             string | null;
  notas:              unknown;
  created_at:         string | null;
  updated_at:         string | null;
  perfil_tributario_activo?: boolean;
  perfil_tributario?: PerfilTributarioCliente | null;
}

// ─── Mapping fila → Cliente ───────────────────────────────────────────────────

function parseNotas(notas: unknown): NotaCliente[] {
  if (!Array.isArray(notas)) return [];
  return notas
    .filter((n): n is { id?: number; texto?: string; fecha?: string } => n && typeof n === "object")
    .map((n) => ({
      id:    typeof n.id === "number" ? n.id : Date.now(),
      texto: typeof n.texto === "string" ? n.texto : "",
      fecha: typeof n.fecha === "string" ? n.fecha : new Date().toISOString(),
    }));
}

function rowToCliente(row: SupabaseRow): Cliente {
  const nombreContacto = row.nombre_contacto ?? row.nombre ?? "";
  const now = new Date().toISOString();
  const idRow = typeof row.id === "string" && row.id ? row.id : "";
  const c: Cliente = {
    id:                  idRow,
    codigo_cliente:      idRow ? `CL-${idRow.slice(0, 8).toUpperCase()}` : "CL-????????",
    tipo_cliente:        (row.tipo_cliente === "persona" ? "persona" : "empresa") as Cliente["tipo_cliente"],
    empresa:             row.empresa ?? undefined,
    nombre_contacto:     nombreContacto,
    ruc:                 row.ruc ?? undefined,
    documento:           row.documento ?? undefined,
    nombre_facturacion:  row.nombre_facturacion ?? undefined,
    nivel_precio:        (row.nivel_precio === "mayorista" || row.nivel_precio === "distribuidor"
                            ? row.nivel_precio
                            : "minorista") as Cliente["nivel_precio"],
    es_contribuyente:    row.es_contribuyente === true,
    telefono:            row.telefono ?? undefined,
    telefono_secundario: row.telefono_secundario ?? undefined,
    email:               row.email ?? undefined,
    email_secundario:    row.email_secundario ?? undefined,
    direccion:           row.direccion ?? undefined,
    ciudad:              row.ciudad ?? undefined,
    pais:                row.pais ?? undefined,
    usa_nota_remision:   row.usa_nota_remision === true,
    sitio_web:           row.sitio_web ?? undefined,
    instagram:           row.instagram ?? undefined,
    linkedin:            row.linkedin ?? undefined,
    valor_cliente:       row.valor_cliente ?? undefined,
    condicion_pago:      row.condicion_pago ?? undefined,
    moneda_preferida:    (row.moneda_preferida === "USD" ? "USD" : "GS") as "GS" | "USD",
    vendedor_asignado:   row.vendedor_asignado ?? undefined,
    vendedor_usuario_id: row.vendedor_usuario_id ?? undefined,
    vendedor_usuario_nombre: row.vendedor_usuario_nombre ?? undefined,
    vendedor_usuario_email:  row.vendedor_usuario_email ?? undefined,
    origen:              (row.origen as Cliente["origen"]) ?? "MANUAL",
    prospecto_id:        row.prospecto_id ?? undefined,
    estado:              (row.estado === "inactivo" ? "inactivo" : "activo") as EstadoCliente,
    notas:               parseNotas(row.notas),
    tipo_servicio_cliente: (row.tipo_servicio_cliente as Cliente["tipo_servicio_cliente"]) ?? undefined,
    created_by_user_id:  row.created_by_user_id ?? undefined,
    created_by_nombre:   row.created_by_nombre ?? undefined,
    deleted_at:          row.deleted_at ?? undefined,
    deleted_by_user_id:  row.deleted_by_user_id ?? undefined,
    deletion_reason:     row.deletion_reason ?? undefined,
    baja_operativa_at:         row.baja_operativa_at ?? undefined,
    baja_operativa_by_user_id: row.baja_operativa_by_user_id ?? undefined,
    baja_operativa_by_nombre:  row.baja_operativa_by_nombre ?? undefined,
    baja_operativa_motivo:     row.baja_operativa_motivo ?? undefined,
    baja_operativa_anulo_factura: row.baja_operativa_anulo_factura ?? undefined,
    created_at:          row.created_at ?? now,
    updated_at:          row.updated_at ?? row.created_at ?? now,
  };
  if (row.sifen_receptor_extranjero === true) c.sifen_receptor_extranjero = true;
  if (row.sifen_receptor_extranjero === false) c.sifen_receptor_extranjero = false;
  if (row.sifen_codigo_pais != null && String(row.sifen_codigo_pais).trim() !== "") {
    c.sifen_codigo_pais = String(row.sifen_codigo_pais).trim();
  }
  if (row.sifen_tipo_doc_receptor != null && row.sifen_tipo_doc_receptor !== "") {
    const n = typeof row.sifen_tipo_doc_receptor === "number" ? row.sifen_tipo_doc_receptor : parseInt(String(row.sifen_tipo_doc_receptor), 10);
    if (Number.isFinite(n)) c.sifen_tipo_doc_receptor = n;
  }
  if (row.sifen_receptor_manual === true) c.sifen_receptor_manual = true;
  if (row.sifen_receptor_manual === false) c.sifen_receptor_manual = false;
  const nat = row.sifen_receptor_naturaleza == null ? "" : String(row.sifen_receptor_naturaleza).trim();
  if (nat === "contribuyente_paraguayo" || nat === "no_contribuyente" || nat === "extranjero") {
    c.sifen_receptor_naturaleza = nat as Cliente["sifen_receptor_naturaleza"];
  }
  if (row.sifen_ti_ope != null && row.sifen_ti_ope !== "") {
    const t = typeof row.sifen_ti_ope === "number" ? row.sifen_ti_ope : parseInt(String(row.sifen_ti_ope), 10);
    if (Number.isFinite(t) && t >= 1 && t <= 4) c.sifen_ti_ope = t;
  }
  if (row.sifen_num_id_de != null && String(row.sifen_num_id_de).trim() !== "") {
    c.sifen_num_id_de = String(row.sifen_num_id_de).trim();
  }
  if (row.sifen_direccion_de != null && String(row.sifen_direccion_de).trim() !== "") {
    c.sifen_direccion_de = String(row.sifen_direccion_de).trim();
  }
  if (row.sifen_num_casa_de != null && row.sifen_num_casa_de !== "") {
    const nc = typeof row.sifen_num_casa_de === "number" ? row.sifen_num_casa_de : parseInt(String(row.sifen_num_casa_de), 10);
    if (Number.isFinite(nc) && nc >= 0) c.sifen_num_casa_de = Math.floor(nc);
  }
  if (row.sifen_descripcion_tipo_doc != null && String(row.sifen_descripcion_tipo_doc).trim() !== "") {
    c.sifen_descripcion_tipo_doc = String(row.sifen_descripcion_tipo_doc).trim();
  }
  if (row.perfil_tributario_activo === true) c.perfil_tributario_activo = true;
  if (row.perfil_tributario != null) c.perfil_tributario = row.perfil_tributario;
  return c;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/** Lista clientes vía API (tenant + service role); evita depender del schema/RLS del cliente browser. */
export async function getClientes(opts?: { incluirEliminados?: boolean; incluirPlanActivo?: boolean }): Promise<Cliente[]> {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const params = new URLSearchParams();
    if (opts?.incluirPlanActivo) params.set("plan_activo", "1");
    if (opts?.incluirEliminados) params.set("incluir_eliminados", "1");
    const qs = params.toString();
    const res = await fetchWithSupabaseSession(`/api/clientes${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[clientes] getClientes API:", res.status, text);
      return [];
    }
    const json = (await res.json()) as { success: boolean; data?: unknown };
    if (!json.success || !Array.isArray(json.data)) return [];

    return (json.data as (SupabaseRow & { plan_activo?: string })[]).map((row) => {
      const c = rowToCliente(row);
      if (row.plan_activo) c.plan_activo = row.plan_activo;
      return c;
    });
  } catch (e) {
    console.error("[clientes] getClientes:", e);
    return [];
  }
}

/** Obtiene un cliente por ID vía API tenant. Por defecto excluye eliminados. */
export async function getCliente(id: string, opts?: { incluirEliminados?: boolean }): Promise<Cliente | null> {
  if (typeof window === "undefined") {
    return null;
  }
  if (opts?.incluirEliminados) {
    const supabase = await getBrowserSupabaseForEmpresaData();
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", id)
      .single();
    if (error) {
      console.error("[clientes] getCliente (eliminados):", error.message);
      return null;
    }
    return rowToCliente(data as SupabaseRow);
  }

  try {
    const qs = opts?.incluirEliminados ? "?incluir_eliminados=1" : "";
    const res = await fetchWithSupabaseSession(`/api/clientes/${encodeURIComponent(id)}${qs}`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      console.warn("[clientes] getCliente 404", { id });
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[clientes] getCliente API:", res.status, { id, body: text.slice(0, 500) });
      return null;
    }
    const json = (await res.json()) as { success: boolean; data?: unknown };
    if (!json.success || !json.data || typeof json.data !== "object") {
      console.warn("[clientes] getCliente respuesta inválida", { id, success: json.success, dataType: typeof json.data });
      return null;
    }
    const row = json.data as SupabaseRow;
    if (typeof row.id !== "string" || !row.id) {
      console.error("[clientes] getCliente fila sin id", { id });
      return null;
    }
    return rowToCliente(row);
  } catch (e) {
    console.error("[clientes] getCliente:", e);
    return null;
  }
}

export async function getClienteByProspectoId(
  _prospectoId: number
): Promise<Cliente | null> {
  return null; // Sin columna prospecto_id en Supabase por ahora
}

export type NuevoClienteData = Omit<
  Cliente,
  "id" | "codigo_cliente" | "notas" | "created_at" | "updated_at"
>;

/** Crea cliente. empresa_id y created_by se obtienen del usuario; RLS valida acceso. */
export async function saveCliente(datos: NuevoClienteData): Promise<Cliente | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  const { data: { user } } = await supabase.auth.getUser();
  const insert: Record<string, unknown> = {
    empresa_id:           usuario.empresa_id,
    tipo_cliente:         datos.tipo_cliente ?? "empresa",
    tipo_servicio_cliente: datos.tipo_servicio_cliente ?? null,
    created_by_user_id:   user?.id ?? null,
    created_by_nombre:    (usuario as { nombre?: string })?.nombre ?? null,
    empresa:            datos.empresa ?? null,
    nombre:             datos.nombre_contacto ?? null,
    nombre_contacto:    datos.nombre_contacto ?? null,
    ruc:                datos.ruc ?? null,
    documento:          datos.documento ?? null,
    telefono:           datos.telefono ?? null,
    telefono_secundario: datos.telefono_secundario ?? null,
    email:              datos.email ?? null,
    email_secundario:   datos.email_secundario ?? null,
    direccion:          datos.direccion ?? null,
    ciudad:             datos.ciudad ?? null,
    pais:               datos.pais ?? null,
    sitio_web:          datos.sitio_web ?? null,
    instagram:          datos.instagram ?? null,
    linkedin:           datos.linkedin ?? null,
    valor_cliente:      datos.valor_cliente ?? null,
    condicion_pago:     datos.condicion_pago ?? null,
    moneda_preferida:   datos.moneda_preferida ?? "GS",
    vendedor_asignado:  datos.vendedor_asignado ?? null,
    vendedor_usuario_id: datos.vendedor_usuario_id ?? null,
    origen:             datos.origen ?? "MANUAL",
    prospecto_id:       datos.prospecto_id ?? null,
    estado:             datos.estado ?? "activo",
  };
  if (datos.nombre_facturacion !== undefined) {
    insert.nombre_facturacion =
      datos.nombre_facturacion == null || String(datos.nombre_facturacion).trim() === ""
        ? null
        : String(datos.nombre_facturacion).trim().toUpperCase();
  }
  if (datos.nivel_precio !== undefined) {
    const nv = String(datos.nivel_precio);
    insert.nivel_precio = ["minorista", "mayorista", "distribuidor"].includes(nv) ? nv : "minorista";
  }
  if (datos.es_contribuyente !== undefined) insert.es_contribuyente = datos.es_contribuyente === true;
  if (datos.sifen_receptor_extranjero === true) insert.sifen_receptor_extranjero = true;
  if (datos.sifen_receptor_extranjero === false) insert.sifen_receptor_extranjero = false;
  if (datos.sifen_codigo_pais !== undefined) {
    insert.sifen_codigo_pais = datos.sifen_codigo_pais == null ? null : String(datos.sifen_codigo_pais).trim() || null;
  }
  if (datos.sifen_tipo_doc_receptor !== undefined) {
    insert.sifen_tipo_doc_receptor =
      datos.sifen_tipo_doc_receptor == null ? null : Number(datos.sifen_tipo_doc_receptor);
  }
  if (datos.sifen_receptor_manual === true) {
    insert.sifen_receptor_manual = true;
    if (datos.sifen_receptor_naturaleza != null && String(datos.sifen_receptor_naturaleza).trim() !== "") {
      insert.sifen_receptor_naturaleza = String(datos.sifen_receptor_naturaleza).trim();
    }
    if (datos.sifen_ti_ope != null && Number.isFinite(Number(datos.sifen_ti_ope))) {
      insert.sifen_ti_ope = Math.floor(Number(datos.sifen_ti_ope));
    }
    if (datos.sifen_num_id_de != null && String(datos.sifen_num_id_de).trim() !== "") {
      insert.sifen_num_id_de = String(datos.sifen_num_id_de).trim().slice(0, 20);
    }
    if (datos.sifen_direccion_de != null && String(datos.sifen_direccion_de).trim() !== "") {
      insert.sifen_direccion_de = String(datos.sifen_direccion_de).trim();
    }
    if (datos.sifen_num_casa_de != null && Number.isFinite(Number(datos.sifen_num_casa_de))) {
      insert.sifen_num_casa_de = Math.max(0, Math.floor(Number(datos.sifen_num_casa_de)));
    }
    if (datos.sifen_descripcion_tipo_doc != null && String(datos.sifen_descripcion_tipo_doc).trim() !== "") {
      insert.sifen_descripcion_tipo_doc = String(datos.sifen_descripcion_tipo_doc).trim().slice(0, 41);
    }
  }

  const { data, error } = await supabase
    .from("clientes")
    .insert([insert])
    .select()
    .single();

  if (error) {
    console.error("[clientes] saveCliente:", error.message);
    return null;
  }
  return rowToCliente(data as SupabaseRow);
}

export type ActualizarClienteInput = Omit<
  Partial<Omit<Cliente, "id" | "codigo_cliente" | "created_at">>,
  "tipo_servicio_cliente"
> & {
  /** null quita el tipo. */
  tipo_servicio_cliente?: string | null;
};

/** Misma lógica que aplica el PATCH de API; centralizada para no desviar campos. */
export function construirPatchActualizacionCliente(datos: ActualizarClienteInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (datos.tipo_cliente !== undefined) patch.tipo_cliente = datos.tipo_cliente;
  if (datos.empresa !== undefined) patch.empresa = datos.empresa ?? null;
  if (datos.nombre_contacto !== undefined) {
    patch.nombre = datos.nombre_contacto ?? null;
    patch.nombre_contacto = datos.nombre_contacto ?? null;
  }
  if (datos.ruc !== undefined) patch.ruc = datos.ruc ?? null;
  if (datos.documento !== undefined) patch.documento = datos.documento ?? null;
  if (datos.nombre_facturacion !== undefined) {
    patch.nombre_facturacion =
      datos.nombre_facturacion == null || String(datos.nombre_facturacion).trim() === ""
        ? null
        : String(datos.nombre_facturacion).trim().toUpperCase();
  }
  if (datos.nivel_precio !== undefined) {
    const nv = String(datos.nivel_precio);
    patch.nivel_precio = ["minorista", "mayorista", "distribuidor"].includes(nv) ? nv : "minorista";
  }
  if (datos.es_contribuyente !== undefined) patch.es_contribuyente = datos.es_contribuyente === true;
  if (datos.telefono !== undefined) patch.telefono = datos.telefono ?? null;
  if (datos.telefono_secundario !== undefined) patch.telefono_secundario = datos.telefono_secundario ?? null;
  if (datos.email !== undefined) patch.email = datos.email ?? null;
  if (datos.email_secundario !== undefined) patch.email_secundario = datos.email_secundario ?? null;
  if (datos.direccion !== undefined) patch.direccion = datos.direccion ?? null;
  if (datos.ciudad !== undefined) patch.ciudad = datos.ciudad ?? null;
  if (datos.pais !== undefined) patch.pais = datos.pais ?? null;
  if (datos.usa_nota_remision !== undefined) patch.usa_nota_remision = datos.usa_nota_remision === true;
  if (datos.sifen_receptor_extranjero !== undefined) {
    patch.sifen_receptor_extranjero = Boolean(datos.sifen_receptor_extranjero);
  }
  if (datos.sifen_codigo_pais !== undefined) {
    patch.sifen_codigo_pais =
      datos.sifen_codigo_pais == null || String(datos.sifen_codigo_pais).trim() === ""
        ? null
        : String(datos.sifen_codigo_pais).trim().toUpperCase();
  }
  if (datos.sifen_tipo_doc_receptor !== undefined) {
    if (datos.sifen_tipo_doc_receptor == null) {
      patch.sifen_tipo_doc_receptor = null;
    } else {
      const n = Number(datos.sifen_tipo_doc_receptor);
      patch.sifen_tipo_doc_receptor = Number.isFinite(n) ? n : null;
    }
  }
  if (datos.sifen_receptor_manual === false) {
    patch.sifen_receptor_manual = false;
    patch.sifen_receptor_naturaleza = null;
    patch.sifen_ti_ope = null;
    patch.sifen_num_id_de = null;
    patch.sifen_direccion_de = null;
    patch.sifen_num_casa_de = null;
    patch.sifen_descripcion_tipo_doc = null;
  } else if (datos.sifen_receptor_manual === true) {
    patch.sifen_receptor_manual = true;
  }
  if (datos.sifen_receptor_manual === true) {
    if (datos.sifen_receptor_naturaleza !== undefined) {
      const v = datos.sifen_receptor_naturaleza == null ? "" : String(datos.sifen_receptor_naturaleza).trim();
      patch.sifen_receptor_naturaleza =
        v === "contribuyente_paraguayo" || v === "no_contribuyente" || v === "extranjero" ? v : null;
    }
    if (datos.sifen_ti_ope !== undefined) {
      if (datos.sifen_ti_ope == null) patch.sifen_ti_ope = null;
      else {
        const t = Number(datos.sifen_ti_ope);
        patch.sifen_ti_ope = Number.isFinite(t) && t >= 1 && t <= 4 ? t : null;
      }
    }
    if (datos.sifen_num_id_de !== undefined) {
      patch.sifen_num_id_de =
        datos.sifen_num_id_de == null || String(datos.sifen_num_id_de).trim() === ""
          ? null
          : String(datos.sifen_num_id_de).trim().slice(0, 20);
    }
    if (datos.sifen_direccion_de !== undefined) {
      patch.sifen_direccion_de =
        datos.sifen_direccion_de == null || String(datos.sifen_direccion_de).trim() === ""
          ? null
          : String(datos.sifen_direccion_de).trim();
    }
    if (datos.sifen_num_casa_de !== undefined) {
      if (datos.sifen_num_casa_de == null) patch.sifen_num_casa_de = null;
      else {
        const n = Number(datos.sifen_num_casa_de);
        patch.sifen_num_casa_de = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      }
    }
    if (datos.sifen_descripcion_tipo_doc !== undefined) {
      patch.sifen_descripcion_tipo_doc =
        datos.sifen_descripcion_tipo_doc == null || String(datos.sifen_descripcion_tipo_doc).trim() === ""
          ? null
          : String(datos.sifen_descripcion_tipo_doc).trim().slice(0, 41);
    }
  }
  if (datos.sitio_web !== undefined) patch.sitio_web = datos.sitio_web ?? null;
  if (datos.instagram !== undefined) patch.instagram = datos.instagram ?? null;
  if (datos.linkedin !== undefined) patch.linkedin = datos.linkedin ?? null;
  if (datos.valor_cliente !== undefined) patch.valor_cliente = datos.valor_cliente ?? null;
  if (datos.condicion_pago !== undefined) patch.condicion_pago = datos.condicion_pago ?? null;
  if (datos.moneda_preferida !== undefined) patch.moneda_preferida = datos.moneda_preferida ?? null;
  if (datos.vendedor_asignado !== undefined) patch.vendedor_asignado = datos.vendedor_asignado ?? null;
  if (datos.vendedor_usuario_id !== undefined) {
    patch.vendedor_usuario_id =
      datos.vendedor_usuario_id === null || datos.vendedor_usuario_id === ""
        ? null
        : datos.vendedor_usuario_id;
  }
  if (datos.estado !== undefined) patch.estado = datos.estado ?? null;
  if (datos.tipo_servicio_cliente !== undefined) patch.tipo_servicio_cliente = datos.tipo_servicio_cliente ?? null;
  patch.updated_at = new Date().toISOString();
  return patch;
}

/**
 * Actualiza cliente vía **PATCH** tenant (rol servicio, mismo criterio que GET /api/clientes/:id).
 * Evita «permission denied for table clientes» con PostgREST en el navegador en esquemas `erp_*` sin GRANT a `authenticated`.
 */
export async function updateCliente(id: string, datos: ActualizarClienteInput): Promise<Cliente> {
  const res = await fetchWithSupabaseSession(`/api/clientes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos),
  });
  let json: { success?: boolean; data?: unknown; error?: string };
  try {
    json = (await res.json()) as { success?: boolean; data?: unknown; error?: string };
  } catch {
    throw new Error("Respuesta inválida del servidor al actualizar el cliente.");
  }
  if (!res.ok) {
    throw new Error(json?.error ?? `Error ${res.status}`);
  }
  if (json?.success !== true || json.data == null || typeof json.data !== "object") {
    throw new Error(json?.error ?? "Respuesta inválida al actualizar el cliente.");
  }
  return rowToCliente(json.data as SupabaseRow);
}

/**
 * Eliminación lógica (soft delete) de cliente.
 * Solo debe llamarse tras validar: 1) usuario admin, 2) sin relaciones bloqueantes, 3) motivo obligatorio.
 * Para uso desde API; el cliente no debe llamar deleteCliente directamente.
 */
export async function softDeleteCliente(
  id: string,
  userId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { error } = await supabase
    .from("clientes")
    .update({
      deleted_at:         new Date().toISOString(),
      deleted_by_user_id: userId,
      deletion_reason:    reason.trim() || null,
      updated_at:        new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    console.error("[clientes] softDeleteCliente:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * @deprecated No usar: la eliminación debe hacerse vía API con validación admin.
 * Mantenido para compatibilidad; en producción usar DELETE /api/clientes/[id].
 */
export async function deleteCliente(id: string): Promise<void> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) console.error("[clientes] deleteCliente:", error.message);
}

// ─── Notas (persistidas en Supabase, columna notas jsonb) ────────────────────

/** Obtiene notas del cliente desde Supabase. Fallback a [] si no hay datos. */
export async function getNotasCliente(clienteId: string): Promise<NotaCliente[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("clientes")
    .select("notas")
    .eq("id", clienteId)
    .single();

  if (error || !data) return [];
  return parseNotas((data as { notas: unknown }).notas);
}

/** Añade una nota al cliente y persiste en Supabase. */
export async function addNotaCliente(clienteId: string, texto: string): Promise<NotaCliente> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const notas = await getNotasCliente(clienteId);
  const nota: NotaCliente = {
    id:    Date.now(),
    texto: texto.trim(),
    fecha: new Date().toISOString(),
  };
  const nuevas = [...notas, nota];

  const { error } = await supabase
    .from("clientes")
    .update({ notas: nuevas, updated_at: new Date().toISOString() })
    .eq("id", clienteId);

  if (error) console.error("[clientes] addNotaCliente:", error.message);
  return nota;
}

export async function toggleEstado(id: string, estado: EstadoCliente): Promise<void> {
  await updateCliente(id, { estado });
}

/** Nombre de display según tipo de cliente. */
export function clienteNombre(c: Cliente): string {
  return c.tipo_cliente === "empresa" && c.empresa ? c.empresa : c.nombre_contacto;
}
