import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getEmpresaId } from "@/lib/db/empresa";
import { ymdInicioFinMesLocal } from "@/lib/fechas/calendario";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

export type Gasto = {
  id: string;
  empresa_id: string;
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  descuenta_caja: boolean;
  caja_movimiento_id: string | null;
  created_at: string;
};

export type GastoInput = {
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  descuenta_caja?: boolean;
};

function mapRow(r: Record<string, unknown>): Gasto {
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string,
    categoria: (r.categoria as string) ?? "",
    descripcion: (r.descripcion as string) ?? "",
    monto: Number(r.monto) ?? 0,
    tipo: (r.tipo as "fijo" | "variable") ?? "variable",
    recurrente: Boolean(r.recurrente),
    frecuencia: r.frecuencia as string | undefined,
    fecha: (r.fecha as string) ?? "",
    descuenta_caja: Boolean(r.descuenta_caja),
    caja_movimiento_id: (r.caja_movimiento_id as string | null) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

/** Obtiene todos los gastos de la empresa, ordenados por fecha desc. */
export async function getGastos(): Promise<Gasto[]> {
  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession("/api/gastos", { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `Error ${res.status}`);
    }
    const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>[] };
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data.map(mapRow);
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Obtiene los gastos del mes actual (para Dashboard). RLS filtra por empresa. */
export async function getGastosMesActual(): Promise<Gasto[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const hoy = new Date();
  const { inicioYmd: inicioMes, finYmd: finMes } = ymdInicioFinMesLocal(hoy);

  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .gte("fecha", inicioMes)
    .lte("fecha", finMes)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function createGasto(input: GastoInput): Promise<Gasto> {
  if (input.monto <= 0) throw new Error("El monto debe ser mayor a 0");

  if (typeof window !== "undefined") {
    // Browser: usar API server-side (resuelve schema y empresa via auth cookie).
    const res = await fetchWithSupabaseSession("/api/gastos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: Record<string, unknown>;
      error?: string;
    };
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `Error ${res.status}`);
    }
    return mapRow(json.data);
  }

  // Server-side (SSR/server actions): DB directo
  const supabase = await getBrowserSupabaseForEmpresaData();
  const empresa_id = await getEmpresaId();
  const { data, error } = await supabase
    .from("gastos")
    .insert({
      empresa_id,
      categoria: input.categoria.trim() || null,
      descripcion: input.descripcion.trim() || null,
      monto: input.monto,
      tipo: input.tipo,
      recurrente: input.recurrente,
      frecuencia: input.frecuencia?.trim() || null,
      fecha: input.fecha,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function updateGasto(id: string, input: Partial<GastoInput>): Promise<Gasto> {
  if (input.monto !== undefined && input.monto <= 0) throw new Error("El monto debe ser mayor a 0");

  if (typeof window !== "undefined") {
    // Browser: usar API server-side. El cliente del browser no conoce el schema
    // del tenant (NEURA_CLIENT_SCHEMA no llega al bundle) y apuntaría al equivocado.
    const res = await fetchWithSupabaseSession("/api/gastos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...input }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: Record<string, unknown>;
      error?: string;
    };
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `Error ${res.status}`);
    }
    return mapRow(json.data);
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const update: Record<string, unknown> = {};
  if (input.categoria !== undefined) update.categoria = input.categoria.trim() || null;
  if (input.descripcion !== undefined) update.descripcion = input.descripcion.trim() || null;
  if (input.monto !== undefined) update.monto = input.monto;
  if (input.tipo !== undefined) update.tipo = input.tipo;
  if (input.recurrente !== undefined) update.recurrente = input.recurrente;
  if (input.frecuencia !== undefined) update.frecuencia = input.frecuencia?.trim() || null;
  if (input.fecha !== undefined) update.fecha = input.fecha;

  const { data, error } = await supabase
    .from("gastos")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deleteGasto(id: string): Promise<void> {
  if (typeof window !== "undefined") {
    // Browser: usar API server-side (mismo motivo que updateGasto).
    const res = await fetchWithSupabaseSession(`/api/gastos?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Error ${res.status}`);
    }
    return;
  }

  const supabase = await getBrowserSupabaseForEmpresaData();
  const { error } = await supabase.from("gastos").delete().eq("id", id);

  if (error) throw new Error(error.message);
}
