"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getProveedores } from "@/lib/proveedores/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Proveedor } from "@/lib/proveedores/types";

export default function ProveedoresPage() {
  const { isAdmin } = useIsAdmin();
  const [lista, setLista] = useState<Proveedor[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getProveedores().then((rows) => {
      if (!cancel) {
        setLista(rows);
        setCargando(false);
      }
    });
    return () => {
      cancel = true;
    };
  }, [refreshKey]);

  async function borrarProveedor(p: Proveedor) {
    if (!window.confirm(`¿Borrar el proveedor "${p.nombre}"? Esta acción no se puede deshacer.`)) return;
    const r = await fetch(`/api/proveedores/${p.id}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success) setRefreshKey((k) => k + 1);
    else alert(j?.error ?? "No se pudo borrar el proveedor.");
  }

  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return lista;
    return lista.filter((p) => {
      const cats = (p.categorias ?? []).map((c) => c.nombre).join(" ");
      return productoMatchesQuery(busqueda, p.nombre, p.ruc, p.email, cats);
    });
  }, [lista, busqueda]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Proveedores</h1>
          <p className="text-gray-600">
            Maestro de abastecimiento: categorías, condiciones de pago y vínculo futuro con compras.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportExcelButton url="/api/proveedores/export" />
          <ImportExcelButton
            entidad="Proveedores"
            previewUrl="/api/proveedores/import/preview"
            commitUrl="/api/proveedores/import/commit"
            templateUrl="/api/proveedores/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={() => setRefreshKey((k) => k + 1)}
          />
          <Link
            href="/proveedores/categorias"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Categorías
          </Link>
          <Link
            href="/proveedores/nuevo"
            className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0284C7]"
          >
            + Nuevo proveedor
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Buscar por nombre, RUC, email o categoría…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9]"
          />
          <span className="text-sm text-slate-400">
            {filtradas.length} de {lista.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600">
                <th className="py-3 pr-4 font-semibold">Proveedor</th>
                <th className="py-3 pr-4 font-semibold">RUC</th>
                <th className="py-3 pr-4 font-semibold">Contacto</th>
                <th className="py-3 pr-4 font-semibold">Categorías</th>
                <th className="py-3 pr-4 font-semibold">Estado</th>
                <th className="py-3 font-semibold w-24" />
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    {lista.length === 0 ? "No hay proveedores cargados." : "Sin resultados."}
                  </td>
                </tr>
              ) : (
                filtradas.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-[#4FAEB2]/[0.04] transition-colors">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-800">{p.nombre}</div>
                      {p.nombre_comercial && (
                        <div className="text-xs text-slate-500">{p.nombre_comercial}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-600">{p.ruc ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      <div>{p.contacto ?? "—"}</div>
                      <div className="text-xs text-slate-400">{p.telefono ?? ""}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {(p.categorias ?? []).length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          p.categorias!.map((c) => (
                            <span
                              key={c.id}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                            >
                              {c.nombre}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.estado === "activo"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {p.estado === "activo" ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          href={`/proveedores/${p.id}/editar`}
                          className="text-sm font-medium text-sky-600 hover:underline"
                        >
                          Editar
                        </Link>
                        <button
                          onClick={() => borrarProveedor(p)}
                          className="text-sm font-medium text-red-600 hover:underline"
                        >
                          Borrar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
