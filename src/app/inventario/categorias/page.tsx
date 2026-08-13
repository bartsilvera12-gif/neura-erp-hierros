"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Pencil, Power, Upload, X, ImageIcon, Plus, ArrowLeft, Package, Trash2 } from "lucide-react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { useIsAdmin } from "@/lib/auth/use-is-admin";

interface Categoria {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  imagen_url: string | null;
}

export default function CategoriasProductosPage() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form alta
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  // Modal de edicion unificado (nombre + codigo + padre + imagen)
  const [editing, setEditing] = useState<Categoria | null>(null);
  const [eNombre, setENombre] = useState("");
  const [eCodigo, setECodigo] = useState("");
  const [eParentId, setEParentId] = useState("");
  const [eImagenUrl, setEImagenUrl] = useState<string | null>(null);
  const [eImagenPendingFile, setEImagenPendingFile] = useState<File | null>(null);
  const [eImagenPendingPreview, setEImagenPendingPreview] = useState<string | null>(null);
  const [eSaving, setESaving] = useState(false);
  const [eUploading, setEUploading] = useState(false);
  const [eError, setEError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function openEdit(cat: Categoria) {
    setEditing(cat);
    setENombre(cat.nombre);
    setECodigo(cat.codigo ?? "");
    setEParentId(cat.parent_id ?? "");
    setEImagenUrl(cat.imagen_url);
    setEImagenPendingFile(null);
    setEImagenPendingPreview(null);
    setEError(null);
  }
  function closeEdit() {
    if (eSaving || eUploading) return;
    setEditing(null);
    if (eImagenPendingPreview) URL.revokeObjectURL(eImagenPendingPreview);
    setEImagenPendingPreview(null);
    setEImagenPendingFile(null);
    setEError(null);
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setEError("Formato no permitido. Usá JPG, PNG o WebP.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setEError("Archivo demasiado grande (máx. 10 MB).");
      return;
    }
    if (eImagenPendingPreview) URL.revokeObjectURL(eImagenPendingPreview);
    setEImagenPendingFile(f);
    setEImagenPendingPreview(URL.createObjectURL(f));
    setEError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setESaving(true);
    setEError(null);
    try {
      // 1) Si hay archivo nuevo, subirlo primero. El endpoint actualiza
      //    imagen_url en la fila por su cuenta.
      let newImagenUrl = eImagenUrl;
      if (eImagenPendingFile) {
        setEUploading(true);
        const fd = new FormData();
        fd.append("file", eImagenPendingFile);
        const up = await fetch(
          `/api/inventario/categorias/${editing.id}/imagen`,
          { method: "POST", body: fd, credentials: "include" }
        );
        const upJson = await up.json();
        if (!up.ok || !upJson?.success) {
          setEError(upJson?.error ?? "No se pudo subir la imagen.");
          setEUploading(false);
          setESaving(false);
          return;
        }
        newImagenUrl = upJson.data.imagen_url as string;
        setEUploading(false);
      }

      // 2) Patch de datos (nombre/codigo/padre). Si el usuario explicitamente
      //    quito la imagen via boton, mandamos imagen_url: null.
      const patch: Record<string, unknown> = {
        nombre: eNombre.trim(),
        codigo: eCodigo.trim() || null,
        parent_id: eParentId || null,
      };
      // imagen_url solo se manda si cambio el "quitar imagen" — el upload ya
      // setea la nueva. Si despues del upload el usuario quiere borrar, lo
      // detectamos por: tenia URL → ahora null y sin archivo nuevo.
      const userClearedImage =
        editing.imagen_url && !eImagenUrl && !eImagenPendingFile;
      if (userClearedImage) patch.imagen_url = null;

      const r = await fetch(`/api/inventario/categorias/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setEError(j?.error ?? "No se pudo actualizar la categoría.");
        return;
      }

      // Cerrar y recargar lista
      if (eImagenPendingPreview) URL.revokeObjectURL(eImagenPendingPreview);
      setEditing(null);
      setEImagenPendingPreview(null);
      setEImagenPendingFile(null);
      await load();
      // forzar override para que la imagen recargada use newImagenUrl
      void newImagenUrl;
    } catch (e) {
      setEError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setESaving(false);
      setEUploading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/categorias?todas=1", {
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j?.success)
        setItems(j.data.categorias as Categoria[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          parent_id: parentId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre("");
        setCodigo("");
        setParentId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActivo(cat: Categoria) {
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !cat.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  async function borrarCategoria(cat: Categoria) {
    if (!window.confirm(`¿Borrar la categoría "${cat.nombre}"? Esta acción no se puede deshacer.`)) return;
    const r = await fetch(`/api/inventario/categorias/${cat.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo borrar la categoría.");
  }

  // Imagen mostrada en el modal: pending preview > url actual > nada
  const modalCurrentImage = eImagenPendingPreview ?? eImagenUrl ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            Categorías de productos
          </h1>
          <p className="text-gray-600">
            Clasificá tus productos para reportes y búsqueda.
          </p>
          <div className="mt-3 max-w-2xl rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Estas categorías aparecen en el selector{" "}
            <strong>Categoría principal</strong> de Nuevo producto. Los{" "}
            <Link
              href="/proveedores/categorias"
              className="underline font-medium"
            >
              rubros de proveedor
            </Link>{" "}
            también se importan automáticamente acá, así no tenés que cargarlos
            dos veces.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportExcelButton url="/api/inventario/categorias/export" />
          <ImportExcelButton
            entidad="Categorías"
            previewUrl="/api/inventario/categorias/import/preview"
            commitUrl="/api/inventario/categorias/import/commit"
            templateUrl="/api/inventario/categorias/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link
            href="/inventario"
            className="group inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91] hover:shadow-[0_2px_8px_-2px_rgba(79,174,178,0.25)]"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Inventario</span>
            <span className="hidden sm:inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition-colors group-hover:bg-[#4FAEB2]/15 group-hover:text-[#3F8E91]">
              <Package className="h-3 w-3" />
            </span>
          </Link>
        </div>
      </div>

      {/* Alta */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nueva categoría
        </p>
        <form
          onSubmit={handleCrear}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
        >
          <div>
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: BEBIDAS"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Código (opcional)
            </label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: BEB"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Categoría padre (opcional)
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="inline-flex items-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {creating ? "Creando..." : "Crear categoría"}
            </button>
          </div>
        </form>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      {/* Lista */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">
            Todavía no cargaste categorías.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Imagen</th>
                <th className="text-left px-3 py-3 font-semibold">Nombre</th>
                <th className="text-left px-3 py-3 font-semibold">Código</th>
                <th className="text-left px-3 py-3 font-semibold">Padre</th>
                <th className="text-left px-3 py-3 font-semibold">Estado</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => {
                const parent = items.find((i) => i.id === c.parent_id);
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-5 py-3">
                      {c.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.imagen_url}
                          alt={c.nombre}
                          className="h-12 w-12 rounded-lg object-cover bg-slate-100 border border-slate-200 shadow-sm"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-slate-50 to-slate-100 border border-dashed border-slate-300 flex items-center justify-center">
                          <ImageIcon className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {c.nombre}
                    </td>
                    <td className="px-3 py-3 text-slate-500 font-mono text-xs">
                      {c.codigo ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {parent?.nombre ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      {c.activo ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-1 rounded-md font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 rounded-md font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar categoría"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-white hover:bg-sky-600 border border-sky-200 hover:border-sky-600 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Editar
                        </button>
                        <button
                          onClick={() => toggleActivo(c)}
                          title={
                            c.activo
                              ? "Desactivar categoría"
                              : "Activar categoría"
                          }
                          className={
                            c.activo
                              ? "inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-white hover:bg-slate-600 border border-slate-200 hover:border-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
                              : "inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-white hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          }
                        >
                          <Power className="w-3.5 h-3.5" />
                          {c.activo ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          onClick={() => borrarCategoria(c)}
                          title="Borrar categoría"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Borrar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal edicion unificado */}
      {editing && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Editar categoría
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editing.nombre}
                </p>
              </div>
              <button
                onClick={closeEdit}
                className="text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Imagen */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                  Imagen de categoría
                </label>
                <div className="flex items-start gap-4">
                  {/* Preview */}
                  <div className="flex-none">
                    {modalCurrentImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={modalCurrentImage}
                        alt="preview"
                        className="h-24 w-24 rounded-xl object-cover bg-slate-100 border border-slate-200 shadow-sm"
                      />
                    ) : (
                      <div className="h-24 w-24 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-dashed border-slate-300 flex items-center justify-center">
                        <ImageIcon className="w-7 h-7 text-slate-300" />
                      </div>
                    )}
                  </div>
                  {/* Acciones */}
                  <div className="flex-1 space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePickFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-sky-700 hover:text-white hover:bg-sky-600 border border-sky-200 hover:border-sky-600 px-3 py-2 rounded-lg transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      {modalCurrentImage ? "Cambiar imagen" : "Subir imagen"}
                    </button>
                    {modalCurrentImage && (
                      <button
                        type="button"
                        onClick={() => {
                          if (eImagenPendingPreview) {
                            URL.revokeObjectURL(eImagenPendingPreview);
                          }
                          setEImagenPendingFile(null);
                          setEImagenPendingPreview(null);
                          setEImagenUrl(null);
                        }}
                        className="w-full text-xs text-red-600 hover:text-red-700"
                      >
                        Quitar imagen
                      </button>
                    )}
                    <p className="text-[11px] text-slate-400 leading-tight">
                      JPG, PNG o WebP — máx. 10 MB. Se muestra en el home del
                      sitio público.
                    </p>
                  </div>
                </div>
              </div>

              {/* Nombre */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Nombre
                </label>
                <input
                  value={eNombre}
                  onChange={(e) => setENombre(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Codigo */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Código (opcional)
                </label>
                <input
                  value={eCodigo}
                  onChange={(e) => setECodigo(e.target.value)}
                  placeholder="Ej: HERR"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              {/* Padre */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Categoría padre (opcional)
                </label>
                <select
                  value={eParentId}
                  onChange={(e) => setEParentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                >
                  <option value="">— ninguna —</option>
                  {items
                    .filter((i) => i.activo && i.id !== editing.id)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nombre}
                      </option>
                    ))}
                </select>
              </div>

              {eError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {eError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-6 pt-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
              <button
                onClick={closeEdit}
                disabled={eSaving || eUploading}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={eSaving || eUploading || !eNombre.trim()}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                {eUploading
                  ? "Subiendo imagen..."
                  : eSaving
                  ? "Guardando..."
                  : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
