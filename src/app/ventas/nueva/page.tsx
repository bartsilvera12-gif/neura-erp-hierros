"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Minus, Trash2, ImageIcon, ChevronDown } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import ProductPickerModal, { type ProductoPickerItem, type AgregarVentaPayload } from "@/components/inventario/ProductPickerModal";
import { saveVenta, type FaltanteStock } from "@/lib/ventas/storage";
import { getProductos } from "@/lib/inventario/storage";
import CrearClienteModal, { type ClienteCreado } from "@/components/clientes/CrearClienteModal";
import { generarYAbrirRecibo } from "@/lib/recibos/client";
import type { TipoIvaVenta, TipoVenta, MonedaVenta, LineaVenta, MetodoPago, TipoPrecioVenta } from "@/lib/ventas/types";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Producto, MetodoValuacion } from "@/lib/inventario/types";

/** Miniatura de producto con fallback a un placeholder si no hay imagen o falla. */
function ProductoThumb({ url, alt, size = "h-10 w-10" }: { url?: string | null; alt: string; size?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-md border border-slate-100 bg-slate-50 text-slate-300`}>
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className={`${size} shrink-0 rounded-md border border-slate-100 object-cover`} />;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

/**
 * IVA INCLUIDO: el precio de venta ya contiene el IVA. `total` es precio × cantidad
 * (= total de la línea). El IVA se desglosa desde adentro, NO se suma encima.
 *   EXENTA → 0 · 5% → total - total/1.05 · 10% → total - total/1.10
 */
function calcIva(tipo: TipoIvaVenta, total: number) {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%")     return total - total / 1.05;
  return total - total / 1.10;
}

/**
 * Precio unitario (Gs.) según el tipo elegido, con fallbacks:
 *  minorista → precio_venta;
 *  mayorista → precio_mayorista (>0) o fallback a precio_venta;
 *  costo     → costo_promedio.
 */
// HIERROS VH: niveles de precio calculados sobre el precio de lista.
//  A (minorista)    = precio de lista (precio_venta)
//  B (mayorista)    = lista + 5%
//  C (distribuidor) = lista + 10%
function precioPorTipo(p: Producto, tipo: TipoPrecioVenta): number {
  const lista = p.precio_venta;
  if (tipo === "mayorista") return Math.round(lista * 1.05);    // B
  if (tipo === "distribuidor") return Math.round(lista * 1.10); // C
  if (tipo === "costo") return p.costo_promedio ?? 0; // histórico: ya no se ofrece en la UI
  return lista; // A
}

/** Tipos de precio ofrecidos en la UI (sin 'costo', que queda solo como histórico). */
const TIPOS_PRECIO_UI: TipoPrecioVenta[] = ["minorista", "mayorista", "distribuidor"];

const tipoPrecioLabel: Record<TipoPrecioVenta, string> = {
  minorista: "A (Lista)",
  mayorista: "B (+5%)",
  distribuidor: "C (+10%)",
  costo: "Al costo",
};

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

// ── Sub-componentes ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-slate-200 rounded-lg overflow-hidden ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-[#0EA5E9] text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "5%",
  "10%":  "10%",
};

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaVentaPage() {
  const router = useRouter();

  // ── Estado global ──────────────────────────────────────────────────────────
  const [productos, setProductos]   = useState<Producto[]>([]);
  const [items, setItems]           = useState<LineaVenta[]>([]);
  const [errorLinea, setErrorLinea] = useState<string | null>(null);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);
  // Venta sin stock: faltantes devueltos por el backend + modal de confirmación.
  const [faltantes, setFaltantes] = useState<FaltanteStock[]>([]);
  const [confirmSinStockOpen, setConfirmSinStockOpen] = useState(false);
  // Panel post-venta: tras confirmar, ofrece abrir ticket y (si aplica) nota de remisión.
  const [postVenta, setPostVenta] = useState<{ id: string; numero: string; generaNota: boolean; credito: boolean } | null>(null);
  // Guard anti doble-submit: estado para UI (botón/spinner) + ref para bloqueo síncrono
  // inmediato (React puede tardar en aplicar el estado; el ref corta el segundo disparo ya).
  const [guardando, setGuardando] = useState(false);
  const isSubmittingRef = useRef(false);

  // Facturación de un pedido enviado a Caja (?pedido_id=...). Precarga items + cliente.
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  const [pedidoNumero, setPedidoNumero] = useState<string | null>(null);
  // Pedido del modulo Consulta (?pedido_caja_id=...). Flujo paralelo,
  // independiente del legacy proyectos.
  const [pedidoCajaId, setPedidoCajaId] = useState<string | null>(null);
  const [pedidoCajaTitulo, setPedidoCajaTitulo] = useState<string | null>(null);

  // ── Caja activa (múltiples cajas) ─────────────────────────────────────────
  // La venta se asocia a la caja abierta activa del cajero. Si hay varias, elige.
  const [cajasAbiertas, setCajasAbiertas] = useState<{ id: string; numero_caja: number }[]>([]);
  const [cajaActivaId, setCajaActivaId] = useState<string>("");

  // ── Condiciones de la venta ───────────────────────────────────────────────
  // Instancia dedicada: siempre Guaraníes.
  const moneda: MonedaVenta = "GS";

  // Contado / Crédito (campos ya existentes en `ventas`: tipo_venta + plazo_dias).
  const [tipoVenta, setTipoVenta] = useState<TipoVenta>("CONTADO");
  const [plazoDias, setPlazoDias] = useState("");

  // Cliente (opcional). Si se selecciona, se envía cliente_id al crear la venta.
  type ClienteLite = { id: string; label: string; ruc: string | null; telefono: string | null; usa_nota_remision: boolean };
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const clienteContainerRef = useRef<HTMLDivElement>(null);
  // Nota de remisión: activada si el cliente la usa; toggle manual solo con cliente.
  const [generaNotaRemision, setGeneraNotaRemision] = useState(false);

  // Modal de alta rápida de cliente (crea en el módulo Clientes + lo selecciona).
  const [showCrearCliente, setShowCrearCliente] = useState(false);

  function handleClienteCreado(c: ClienteCreado) {
    const lite: ClienteLite = { ...c, telefono: null };
    setClientes((prev) => [lite, ...prev.filter((x) => x.id !== c.id)]);
    setClienteId(c.id);
    setClienteQuery("");
    setGeneraNotaRemision(c.usa_nota_remision);
    setShowCrearCliente(false);
  }

  // ── Cobro (solo CONTADO, no se persiste — solo ayuda al cajero) ───────────
  const [montoRecibido, setMontoRecibido] = useState("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");

  // ── Pago mixto (contado con varios metodos) ───────────────────────────────
  type PagoMixtoLinea = {
    metodo: "efectivo" | "transferencia" | "tarjeta";
    monto: string;
    entidad_id: string;
    referencia: string;
    titular: string;
  };
  const [pagoMixto, setPagoMixto] = useState(false);
  const [pagosMixto, setPagosMixto] = useState<PagoMixtoLinea[]>([
    { metodo: "efectivo", monto: "", entidad_id: "", referencia: "", titular: "" },
    { metodo: "transferencia", monto: "", entidad_id: "", referencia: "", titular: "" },
  ]);

  // ── Detalle de cobro (conciliación bancaria) ──────────────────────────────
  const [entidades, setEntidades] = useState<{ id: string; codigo: string | null; nombre: string; tipo: string | null }[]>([]);
  const [pagoEntidadId, setPagoEntidadId] = useState("");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoTitular, setPagoTitular] = useState("");
  const [pagoObservacion] = useState("");
  // Modal de cobro (transferencia / tarjeta) + buscador de entidad.
  const [cobroModalOpen, setCobroModalOpen] = useState(false);
  const [entidadQuery, setEntidadQuery] = useState("");

  // ── Combobox de producto (búsqueda server-side por tokens sobre todo el catálogo) ──
  const [comboQuery,     setComboQuery]     = useState("");
  const [comboOpen,      setComboOpen]      = useState(false);
  const [comboHighlight, setComboHighlight] = useState(-1);
  const [comboHits,      setComboHits]      = useState<Producto[]>([]);
  const [comboBuscando,  setComboBuscando]  = useState(false);
  const [comboCategoriaId, setComboCategoriaId] = useState<string>("");
  const [categorias,     setCategorias]     = useState<{ id: string; nombre: string }[]>([]);
  const comboInputRef    = useRef<HTMLInputElement>(null);
  const comboContainerRef = useRef<HTMLDivElement>(null);
  const comboTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Modal buscador (F3) ────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);

  function pickerToProducto(p: ProductoPickerItem): Producto {
    return {
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      precio_venta: p.precio_venta,
      precio_mayorista: p.precio_mayorista ?? null,
      precio_distribuidor: p.precio_distribuidor ?? null,
      stock_actual: p.stock_actual,
      unidad_medida: p.unidad_medida,
      costo_promedio: p.costo_promedio ?? 0,
      stock_minimo: 0,
      metodo_valuacion: "CPP",
      codigo_barras: p.codigo_barras,
      codigo_barras_interno: p.codigo_barras_interno,
      imagen_path: null,
      imagen_url: p.imagen_url,
    };
  }

  /**
   * Agregado directo desde el modal: arma la LineaVenta usando la misma
   * logica que handleAgregarLinea pero con datos del modal, sin pasar
   * por el form inline. Mantiene el modal abierto si todo OK.
   */
  function handleAgregarDesdePicker(payload: AgregarVentaPayload): boolean {
    const {
      producto: p,
      cantidad,
      precio_input,
      iva,
      tipo_precio,
      presentacion_id,
      presentacion_nombre,
      presentacion_cantidad_base,
    } = payload;
    const precioPyg = precio_input;
    // Verificar stock vs lo ya cargado SOLO si el producto controla stock.
    // Venta sin stock (Fase 5): NO se bloquea por falta de stock al agregar; la
    // confirmación se pide al registrar la venta. El Menú (controla_stock=false) tampoco valida.
    // IVA incluido: el total de la línea es precio × cantidad; el IVA se desglosa
    // desde adentro y el subtotal (base imponible) = total − IVA.
    const totalLinea = cantidad * precioPyg;
    const montoIva = calcIva(iva, totalLinea);
    const subtotal = totalLinea - montoIva;

    // Asegurar que el producto este en el array local (para que stock_actual
    // se conozca en validaciones posteriores del form inline).
    const prodLocal = pickerToProducto(p);
    setProductos((prev) => (prev.find((x) => x.id === prodLocal.id) ? prev : [...prev, prodLocal]));

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad,
        precio_venta_original: precio_input,
        precio_venta: precioPyg,
        tipo_iva: iva,
        tipo_precio,
        subtotal,
        monto_iva: montoIva,
        total_linea: totalLinea,
        presentacion_id: presentacion_id ?? null,
        presentacion_nombre: presentacion_nombre ?? null,
        presentacion_cantidad_base: presentacion_cantidad_base ?? null,
      },
    ]);
    setErrorVenta(null);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    getProductos().then((data) => {
      if (!cancelled) setProductos(data);
    });
    return () => { cancelled = true; };
  }, []);

  // Presupuesto asociado (?presupuesto_id=...) — se marca convertido al confirmar la venta.
  const [presupuestoId, setPresupuestoId] = useState<string | null>(null);
  const [presupuestoNumero, setPresupuestoNumero] = useState<string | null>(null);

  // Precarga al cobrar un presupuesto aprobado (?presupuesto_id=...).
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try { pid = new URLSearchParams(window.location.search).get("presupuesto_id"); } catch { pid = null; }
    if (!pid) return;
    setPresupuestoId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/presupuestos/${pid}`, { credentials: "include", cache: "no-store" });
        const j = await res.json();
        const presu = j?.data?.presupuesto as Record<string, unknown> | undefined;
        const items = j?.data?.items as Record<string, unknown>[] | undefined;
        if (cancelled || !presu || !items) return;
        setPresupuestoNumero(typeof presu.numero_control === "string" ? presu.numero_control : null);
        const lineas: LineaVenta[] = items
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_unitario) || 0;
            const ivaRaw = String(it.iva_tipo ?? "10%");
            const iva: TipoIvaVenta = ivaRaw === "5%" ? "5%" : ivaRaw === "EXENTA" ? "EXENTA" : "10%";
            const totalLinea = cantidad * precio;
            const montoIva = calcIva(iva, totalLinea);
            const subtotal = totalLinea - montoIva;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "",
              sku: typeof it.sku === "string" ? it.sku : "",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: "minorista" as TipoPrecioVenta,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && presu.cliente_id) setClienteId(String(presu.cliente_id));
        // Nombre del cliente en el input (aunque el id no venga en la primer pagina de /api/clientes,
        // o aunque el presupuesto se haya guardado con nombre libre sin id).
        if (!cancelled && typeof presu.cliente_nombre === "string" && presu.cliente_nombre.trim()) {
          setClienteQuery(presu.cliente_nombre.trim());
        }
      } catch { /* silencioso */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Precarga al facturar un pedido (Caja): lee ?pedido_id=, trae el pedido y carga sus
  // items + cliente en el carrito. NO crea nada acá; la venta se genera al confirmar.
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try {
      pid = new URLSearchParams(window.location.search).get("pedido_id");
    } catch { pid = null; }
    if (!pid) return;
    setPedidoId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/proyectos/${pid}`, { credentials: "include", cache: "no-store" });
        const j = await res.json();
        if (cancelled || !j?.success || !j.data?.proyecto) return;
        const p = j.data.proyecto as { brief_data?: unknown; cliente_id?: string | null; metadata?: unknown };
        const brief = (p.brief_data && typeof p.brief_data === "object" && !Array.isArray(p.brief_data))
          ? (p.brief_data as Record<string, unknown>) : {};
        const meta = (p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata))
          ? (p.metadata as Record<string, unknown>) : {};
        setPedidoNumero(
          (typeof brief.numero_control === "string" && brief.numero_control) ||
          (typeof brief.numero_presupuesto === "string" && brief.numero_presupuesto) ||
          (typeof meta.numero_presupuesto === "string" && meta.numero_presupuesto) || null
        );
        const itemsRaw = Array.isArray(brief.items) ? (brief.items as Record<string, unknown>[]) : [];
        const lineas: LineaVenta[] = itemsRaw
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_venta) || 0;
            const iva: TipoIvaVenta = "10%";
            // IVA incluido: total de línea = precio × cantidad; IVA desglosado desde adentro.
            const totalLinea = cantidad * precio;
            const montoIva = calcIva(iva, totalLinea);
            const subtotal = totalLinea - montoIva;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "",
              sku: typeof it.sku === "string" ? it.sku : "",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: "minorista" as TipoPrecioVenta,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && p.cliente_id) setClienteId(String(p.cliente_id));
        const nombreLibre = typeof brief.cliente_nombre === "string" ? brief.cliente_nombre : "";
        if (!cancelled && nombreLibre.trim()) setClienteQuery(nombreLibre.trim());
      } catch { /* el aviso seguirá visible; el cajero puede cargar manualmente */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Precarga al cobrar un pedido del modulo Consulta (?pedido_caja_id=...):
  // trae el pedido y carga sus items + cliente en el carrito.
  useEffect(() => {
    let cancelled = false;
    let pid: string | null = null;
    try {
      pid = new URLSearchParams(window.location.search).get("pedido_caja_id");
    } catch { pid = null; }
    if (!pid) return;
    setPedidoCajaId(pid);
    (async () => {
      try {
        const res = await fetch(`/api/pedidos-caja/${pid}`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await res.json();
        if (cancelled || !j?.success || !j.data?.pedido) return;
        const p = j.data.pedido as {
          titulo: string;
          cliente_id?: string | null;
          cliente_nombre?: string | null;
          items: Array<{
            producto_id: string;
            producto_nombre: string;
            sku: string | null;
            cantidad: number;
            precio_venta: number;
            tipo_precio?: "minorista" | "mayorista" | "distribuidor";
            tipo_iva?: "EXENTA" | "5%" | "10%";
            presentacion_id?: string | null;
            presentacion_nombre?: string | null;
            presentacion_cantidad_base?: number | null;
          }>;
        };
        setPedidoCajaTitulo(p.titulo);
        const lineas: LineaVenta[] = (p.items ?? [])
          .filter((it) => it.producto_id && (Number(it.cantidad) || 0) > 0)
          .map((it) => {
            const cantidad = Number(it.cantidad) || 0;
            const precio = Number(it.precio_venta) || 0;
            // IVA del pedido si vino; default 10% para items legacy.
            const iva: TipoIvaVenta =
              it.tipo_iva === "EXENTA" || it.tipo_iva === "5%" || it.tipo_iva === "10%"
                ? it.tipo_iva
                : "10%";
            const totalLinea = cantidad * precio;
            const montoIva = calcIva(iva, totalLinea);
            const subtotal = totalLinea - montoIva;
            return {
              producto_id: String(it.producto_id),
              producto_nombre: it.producto_nombre,
              sku: it.sku ?? "",
              cantidad,
              precio_venta_original: precio,
              precio_venta: precio,
              tipo_iva: iva,
              tipo_precio: (it.tipo_precio ?? "minorista") as TipoPrecioVenta,
              subtotal,
              monto_iva: montoIva,
              total_linea: totalLinea,
              presentacion_id: it.presentacion_id ?? null,
              presentacion_nombre: it.presentacion_nombre ?? null,
              presentacion_cantidad_base: it.presentacion_cantidad_base ?? null,
            };
          });
        if (!cancelled && lineas.length) setItems(lineas);
        if (!cancelled && p.cliente_id) setClienteId(String(p.cliente_id));
        if (!cancelled && p.cliente_nombre && p.cliente_nombre.trim()) {
          setClienteQuery(p.cliente_nombre.trim());
        }
      } catch { /* fallback: el cajero carga manualmente */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cargar entidades bancarias (caja/banco/tarjeta/billetera) para el detalle de cobro.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entidades-bancarias", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.success) setEntidades(j.data?.entidades ?? []); })
      .catch(() => { /* no bloquea la venta si falla */ });
    return () => { cancelled = true; };
  }, []);

  // Cargar clientes (buscador opcional de cliente en la venta).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.success || !Array.isArray(j.data)) return;
        const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const lite: ClienteLite[] = (j.data as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          label: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
          ruc: s(r.ruc) || null,
          telefono: s(r.telefono) || null,
          usa_nota_remision: r.usa_nota_remision === true,
        }));
        setClientes(lite);
      })
      .catch(() => { /* el buscador de cliente es opcional, no bloquea la venta */ });
    return () => { cancelled = true; };
  }, []);

  // UX rápida: al entrar, enfocar el autocompletar para empezar a cargar de una
  // (sin abrir modales). El "Buscador avanzado" (picker) queda a un clic.
  useEffect(() => {
    const t = setTimeout(() => comboInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  // Cargar catálogo de categorías una vez (para el dropdown del buscador).
  useEffect(() => {
    let cancel = false;
    fetchWithSupabaseSession("/api/inventario/categorias", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        const rows = ((j?.data?.categorias ?? []) as Record<string, unknown>[]).map((c) => ({
          id: String(c.id),
          nombre: String(c.nombre ?? ""),
        }));
        setCategorias(rows);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  // Autocomplete: búsqueda server-side por tokens (todo el catálogo), con debounce.
  // Si hay categoría seleccionada, permite listado sin necesitar 2 chars.
  useEffect(() => {
    const q = comboQuery.trim();
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    const hayCategoria = !!comboCategoriaId;
    if (q.length < 2 && !hayCategoria) { setComboHits([]); setComboBuscando(false); return; }
    setComboBuscando(true);
    comboTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (hayCategoria) params.set("categoria_id", comboCategoriaId);
        params.set("limit", hayCategoria ? "200" : "20");
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?${params.toString()}`,
          { cache: "no-store" }
        );
        const j = await res.json();
        const items = ((j?.data?.items ?? []) as Record<string, unknown>[]).map((p): Producto => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          costo_promedio: Number(p.costo_promedio) || 0,
          precio_venta: Number(p.precio_venta) || 0,
          precio_mayorista: p.precio_mayorista != null ? Number(p.precio_mayorista) : null,
          precio_distribuidor: p.precio_distribuidor != null ? Number(p.precio_distribuidor) : null,
          stock_actual: Number(p.stock_actual) || 0,
          stock_minimo: Number(p.stock_minimo) || 0,
          unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
          metodo_valuacion: (typeof p.metodo_valuacion === "string" ? p.metodo_valuacion : "CPP") as MetodoValuacion,
          es_vendible: p.es_vendible !== false,
          controla_stock: p.controla_stock !== false,
          imagen_url: (p.imagen_url as string | null) ?? null,
          imagen_path: (p.imagen_path as string | null) ?? null,
        }));
        setComboHits(items);
        // Merge a `productos` para que los lookups (tipo de precio, stock) resuelvan.
        if (items.length > 0) {
          setProductos((prev) => {
            const byId = new Map(prev.map((x) => [x.id, x]));
            for (const it of items) byId.set(it.id, { ...byId.get(it.id), ...it });
            return [...byId.values()];
          });
        }
      } catch {
        setComboHits([]);
      } finally {
        setComboBuscando(false);
      }
    }, 220);
    return () => { if (comboTimerRef.current) clearTimeout(comboTimerRef.current); };
  }, [comboQuery, comboCategoriaId]);

  // Cargar cajas abiertas y resolver la caja activa del cajero.
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/caja/estado", { cache: "no-store" });
        const j = await res.json();
        const list = ((j?.data?.cajas ?? []) as Array<{ caja: { id: string; numero_caja: number; estado: string } }>)
          .map((r) => r.caja)
          .filter((c) => c.estado === "abierta")
          .map((c) => ({ id: String(c.id), numero_caja: Number(c.numero_caja) || 1 }));
        if (cancel) return;
        setCajasAbiertas(list);
        // Preferir la guardada; si no está entre las abiertas, tomar la única (si hay una).
        let activa = "";
        try { activa = localStorage.getItem("caja_activa_id") ?? ""; } catch { activa = ""; }
        if (!list.some((c) => c.id === activa)) activa = list.length === 1 ? list[0].id : "";
        setCajaActivaId(activa);
      } catch { /* la caja se valida igual en el server */ }
    })();
    return () => { cancel = true; };
  }, []);

  // Persistir la caja activa elegida (por navegador del cajero).
  useEffect(() => {
    try { if (cajaActivaId) localStorage.setItem("caja_activa_id", cajaActivaId); } catch { /* noop */ }
  }, [cajaActivaId]);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboContainerRef.current && !comboContainerRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
      if (clienteContainerRef.current && !clienteContainerRef.current.contains(e.target as Node)) {
        setClienteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll a la opción destacada en el dropdown
  useEffect(() => {
    if (comboHighlight >= 0) {
      document.getElementById(`combo-opt-${comboHighlight}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [comboHighlight]);

  // ── Cálculos ───────────────────────────────────────────────────────────────
  const tipoCambioNum = 1;

  const totalSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const totalIva      = items.reduce((s, i) => s + i.monto_iva, 0);
  const totalGeneral  = items.reduce((s, i) => s + i.total_linea, 0);

  // Condición de venta: si es Crédito, exigir plazo de al menos 1 día y un cliente.
  const plazoDiasNum = parseInt(plazoDias) || 0;
  const creditoValido = tipoVenta === "CONTADO" || (plazoDiasNum >= 1 && !!clienteId);
  // Pago mixto: la suma de los pagos DEBE ser exactamente el total (tolerancia 1 Gs.).
  const pagoMixtoValido =
    !pagoMixto ||
    tipoVenta !== "CONTADO" ||
    Math.abs(pagosMixto.reduce((s, p) => s + (Number(p.monto) || 0), 0) - totalGeneral) < 1;
  const ventaValida   = items.length > 0 && creditoValido && pagoMixtoValido;

  // Cliente (opcional) — selección + filtrado del buscador.
  const clienteSel = clientes.find((c) => c.id === clienteId) ?? null;
  const clientesFiltrados = (clienteQuery.trim() === ""
    ? clientes
    : clientes.filter((c) => productoMatchesQuery(clienteQuery, c.label, c.ruc))
  ).slice(0, 50);

  // Cobro: entidad seleccionada + filtrado por código/nombre (tokens).
  const entidadSel = entidades.find((e) => e.id === pagoEntidadId) ?? null;
  const entidadesFiltradas = (entidadQuery.trim() === ""
    ? entidades
    : entidades.filter((e) => productoMatchesQuery(entidadQuery, e.nombre, e.codigo))
  ).slice(0, 50);

  // Vuelto (solo informativo, no se persiste)
  const montoRecibidoNum = parseFloat(montoRecibido) || 0;
  const vuelto           = montoRecibidoNum - totalGeneral;

  // ── Productos filtrados para el combobox ──────────────────────────────────
  // Solo vendibles (Reventa + Menú). Excluye materia prima / insumos.
  // Resultados del autocomplete: vienen del endpoint de búsqueda server-side
  // (token search sobre TODO el catálogo, no un subconjunto en memoria).
  const comboResultados = comboHits;

  /** Selecciona método de cobro. Efectivo no pide datos; transferencia/tarjeta abren modal. */
  function handleSelectMetodo(m: MetodoPago) {
    setMetodoPago(m);
    if (m === "efectivo") {
      setCobroModalOpen(false);
      // "Caja efectivo" por defecto si existe una entidad tipo caja.
      const caja = entidades.find((e) => e.tipo === "caja");
      setPagoEntidadId(caja ? caja.id : "");
      setPagoTitular("");
    } else {
      setEntidadQuery("");
      setCobroModalOpen(true);
    }
  }

  function handleEliminarLinea(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Autocomplete rápido + edición inline ──────────────────────────────────
  // Recalcula subtotal/IVA/total de una línea (IVA incluido, igual que calcIva).
  function recomputeLinea(l: LineaVenta): LineaVenta {
    const total_linea = l.cantidad > 0 && l.precio_venta > 0 ? l.cantidad * l.precio_venta : 0;
    const monto_iva = calcIva(l.tipo_iva, total_linea);
    return { ...l, total_linea, monto_iva, subtotal: total_linea - monto_iva };
  }

  /** Agrega un producto directo desde el autocomplete: si ya está (sin presentación)
   *  suma +1; si no, crea la línea. Luego limpia el input y devuelve el foco. */
  function agregarProductoRapido(p: Producto) {
    const precio = precioPorTipo(p, "minorista");
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.producto_id === p.id && !it.presentacion_id);
      if (idx >= 0) {
        return prev.map((it, i) => (i === idx ? recomputeLinea({ ...it, cantidad: it.cantidad + 1 }) : it));
      }
      return [
        ...prev,
        recomputeLinea({
          producto_id: p.id,
          producto_nombre: p.nombre,
          sku: p.sku,
          cantidad: 1,
          precio_venta_original: precio,
          precio_venta: precio,
          tipo_iva: "10%",
          tipo_precio: "minorista",
          subtotal: 0,
          monto_iva: 0,
          total_linea: 0,
          presentacion_id: null,
          presentacion_nombre: null,
          presentacion_cantidad_base: null,
        }),
      ];
    });
    setComboQuery("");
    setComboOpen(false);
    setComboHighlight(-1);
    setErrorLinea(null);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  }

  function updateItemCampo(idx: number, patch: Partial<LineaVenta>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? recomputeLinea({ ...it, ...patch }) : it)));
  }
  function changeCantidadItem(idx: number, delta: number) {
    setItems((prev) => prev.map((it, i) => (i === idx ? recomputeLinea({ ...it, cantidad: Math.max(1, it.cantidad + delta) }) : it)));
  }
  function changeTipoPrecioItem(idx: number, tipo: TipoPrecioVenta) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const prod = productos.find((p) => p.id === it.producto_id);
        const precio = prod ? precioPorTipo(prod, tipo) : it.precio_venta;
        return recomputeLinea({ ...it, tipo_precio: tipo, precio_venta: precio, precio_venta_original: precio });
      })
    );
  }

  /** Teclado del autocomplete: ↑/↓ navega, Enter agrega el resaltado, Esc cierra. */
  function onComboKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboOpen(true);
      setComboHighlight((h) => Math.min(h + 1, comboResultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = comboResultados[comboHighlight] ?? comboResultados[0];
      if (sel) agregarProductoRapido(sel);
    } else if (e.key === "Escape") {
      setComboOpen(false);
      setComboHighlight(-1);
    }
  }

  const cajaActivaFinal = cajaActivaId || (cajasAbiertas.length === 1 ? cajasAbiertas[0].id : "");

  /** Envía la venta. Con `permitirSinStock=true` autoriza vender aunque falte stock. */
  async function enviarVenta(permitirSinStock: boolean) {
    // Multi-caja: exigir una caja abierta activa antes de registrar la venta.
    if (cajasAbiertas.length === 0) {
      setErrorVenta("Debe abrir una caja para registrar la venta. Abrí una caja en la pantalla de Caja.");
      return;
    }
    if (!cajaActivaFinal) {
      setErrorVenta("Hay varias cajas abiertas: seleccioná la caja activa antes de confirmar.");
      return;
    }
    // Guard duro contra doble submit: si ya hay una confirmación en vuelo, cortar
    // inmediatamente. El ref se evalúa de forma síncrona (no espera al re-render de React),
    // así que un segundo click/Enter casi simultáneo no puede disparar otra venta.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setGuardando(true);
    try {
      // El cliente se elige (o se crea con el modal "Crear cliente") antes de
      // confirmar. Si no hay ninguno, la venta se registra sin cliente.
      const clienteIdFinal = clienteId;

      // Pago mixto: si esta activo y hay >= 2 lineas con monto, mandamos
      // el array `pagos` al backend (que ademas marca la venta como 'mixto').
      const pagosArrayFinal = pagoMixto
        ? pagosMixto
            .filter((p) => Number(p.monto) > 0)
            .map((p) => ({
              metodo_pago: p.metodo,
              monto: Number(p.monto),
              entidad_bancaria_id: p.entidad_id || null,
              entidad_nombre_snapshot:
                entidades.find((e) => e.id === p.entidad_id)?.nombre ?? null,
              referencia: p.referencia.trim() || null,
              titular: p.metodo === "transferencia" ? p.titular.trim() || null : null,
            }))
        : null;

      const resultado = await saveVenta(
        {
          items,
          moneda,
          tipo_cambio:  tipoCambioNum,
          subtotal:     totalSubtotal,
          monto_iva:    totalIva,
          total:        totalGeneral,
          tipo_venta:   tipoVenta,
          plazo_dias:   tipoVenta === "CREDITO" ? plazoDiasNum : undefined,
          metodo_pago:  pagoMixto ? "efectivo" : metodoPago, // el backend lo marca 'mixto' si aplica
          cliente_id:   clienteIdFinal || null,
          genera_nota_remision: !!clienteIdFinal && generaNotaRemision,
        },
        undefined,
        {
          entidad_bancaria_id: pagoEntidadId || null,
          entidad_nombre_snapshot: entidades.find((e) => e.id === pagoEntidadId)?.nombre ?? null,
          referencia: pagoReferencia.trim() || null,
          titular: metodoPago === "transferencia" ? pagoTitular.trim() || null : null,
          observacion: pagoObservacion.trim() || null,
        },
        {
          permitirSinStock,
          pedidoId,
          pedidoCajaId,
          cajaId: cajaActivaFinal,
          pagos: pagosArrayFinal,
        }
      );

      if (!resultado.success) {
        // Falta stock sin autorizar → abrir modal de confirmación con el detalle.
        // (El guard se libera en el finally para permitir confirmar sin stock.)
        if (resultado.faltantes && resultado.faltantes.length > 0) {
          setFaltantes(resultado.faltantes);
          setConfirmSinStockOpen(true);
          return;
        }
        setErrorVenta(resultado.error);
        return;
      }
      // Documentos de la venta. La nota de remisión se abre además del ticket
      // SOLO si la venta la genera (cliente con usa_nota_remision o toggle activo).
      const v = resultado.venta;
      const generaNota = v.genera_nota_remision === true || !!v.nota_remision_numero;
      const ticketUrl = `/api/ventas/${v.id}/comprobante-a4`;
      const remisionUrl = `/api/ventas/${v.id}/ticket?tipo=remision&auto=1`;

      // Si esta venta se origino desde un presupuesto, marcar el presupuesto
      // como convertido (guardando el venta_id como convertido_pedido_id).
      if (presupuestoId) {
        try {
          await fetchWithSupabaseSession(`/api/presupuestos/${presupuestoId}/marcar-convertido`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venta_id: v.id }),
          });
        } catch { /* best-effort: si falla, se puede marcar a mano */ }
      }
      // Intento de apertura automática del ticket (popup; el navegador puede
      // bloquearlo). Si pasa, el cajero puede reimprimirlo desde el listado.
      try { window.open(ticketUrl, "_blank", "noopener"); } catch {}
      if (generaNota) { try { window.open(remisionUrl, "_blank", "noopener"); } catch {} }
      // Redirige directo al listado de ventas en lugar de mostrar el modal
      // post-venta. El cajero queda libre para registrar otra venta de
      // inmediato. El ticket sigue accesible desde el listado.
      router.push("/ventas");
    } finally {
      // Liberar el guard SIEMPRE: éxito, error o flujo de "confirmar sin stock".
      isSubmittingRef.current = false;
      setGuardando(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorVenta(null);
    if (!ventaValida) return;
    await enviarVenta(false);
  }

  async function confirmarVentaSinStock() {
    setConfirmSinStockOpen(false);
    setErrorVenta(null);
    await enviarVenta(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Nueva venta</h1>
          <p className="text-gray-600">
            Buscá un producto y se agrega al instante. Revisá cantidades y precios en la tabla.
          </p>
        </div>
        {/* Caja activa (múltiples cajas) */}
        {cajasAbiertas.length === 0 ? (
          <a href="/ventas" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
            ⚠ No hay caja abierta — abrí una caja
          </a>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.06] px-3 py-2">
            <span className="text-xs font-semibold text-[#3F8E91]">Caja activa</span>
            {cajasAbiertas.length === 1 ? (
              <span className="text-sm font-bold text-slate-800">Caja {cajasAbiertas[0].numero_caja}</span>
            ) : (
              <select
                value={cajaActivaId}
                onChange={(e) => setCajaActivaId(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
              >
                <option value="">— Elegí caja —</option>
                {cajasAbiertas.map((c) => (
                  <option key={c.id} value={c.id}>Caja {c.numero_caja}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {pedidoId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">Estás facturando un pedido{pedidoNumero ? ` (${pedidoNumero})` : ""}.</span>{" "}
          La venta se generará al confirmar y el pedido quedará marcado como facturado. Podés ajustar items, precios y método de pago.
        </div>
      )}

      {presupuestoId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">Cobrando presupuesto{presupuestoNumero ? ` ${presupuestoNumero}` : ""}.</span>{" "}
          Los productos y el cliente se cargaron automáticamente. Al confirmar la venta, el presupuesto queda marcado como convertido.
        </div>
      )}

      {pedidoCajaId && (
        <div className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-[#3F8E91]">
            Cobrando pedido de Consulta{pedidoCajaTitulo ? ` (${pedidoCajaTitulo})` : ""}.
          </span>{" "}
          Al confirmar, el pedido quedará marcado como facturado. Podés ajustar items, precios y método de pago.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-7xl">

        {/* ── SECCIÓN 0: Datos de la venta (cliente opcional + condición) ────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <SectionTitle>Datos de la venta</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Cliente (opcional) */}
            <div ref={clienteContainerRef} className="relative">
              <label className={labelClass}>
                Cliente <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clienteSel ? clienteSel.label : clienteQuery}
                  onChange={(e) => { setClienteId(""); setClienteQuery(e.target.value); setClienteOpen(true); }}
                  onFocus={() => setClienteOpen(true)}
                  placeholder="Buscar por nombre o RUC…"
                  className={`${inputClass} ${clienteSel ? "font-medium" : ""}`}
                />
                {clienteSel && (
                  <button
                    type="button"
                    onClick={() => { setClienteId(""); setClienteQuery(""); setGeneraNotaRemision(false); }}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs text-slate-500 hover:bg-slate-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {clienteSel && (clienteSel.ruc || clienteSel.telefono) && (
                <p className="mt-1 text-xs text-gray-500">
                  {clienteSel.ruc && <span className="font-medium">RUC {clienteSel.ruc}</span>}
                  {clienteSel.ruc && clienteSel.telefono && <span className="mx-1.5 text-gray-300">·</span>}
                  {clienteSel.telefono && <span>Tel {clienteSel.telefono}</span>}
                </p>
              )}
              {clienteOpen && !clienteSel && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {clientesFiltrados.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin clientes que coincidan.</p>
                  ) : (
                    clientesFiltrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClienteId(c.id); setClienteQuery(""); setClienteOpen(false); setGeneraNotaRemision(c.usa_nota_remision); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-gray-800">{c.label}</span>
                        {c.ruc && <span className="ml-2 text-xs text-gray-400">RUC {c.ruc}</span>}
                        {c.usa_nota_remision && <span className="ml-2 text-[10px] rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5 font-semibold">Nota remisión</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                Si no seleccionás cliente, la venta se registra sin cliente.
              </p>

              {/* Nota de remisión: solo con cliente. Si el cliente la usa, viene activada. */}
              {clienteSel && (
                <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
                  {clienteSel.usa_nota_remision && (
                    <p className="mb-1.5 text-[11px] text-sky-700">
                      Este cliente usa nota de remisión. Se generará junto al ticket.
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={generaNotaRemision}
                      onChange={(e) => setGeneraNotaRemision(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                    />
                    Generar nota de remisión
                  </label>
                </div>
              )}
            </div>

            {/* Condición: Contado / Crédito */}
            <div>
              <label className={labelClass}>Condición</label>
              <SegmentedControl<TipoVenta>
                value={tipoVenta}
                options={[
                  { value: "CONTADO", label: "Contado" },
                  { value: "CREDITO", label: "Crédito" },
                ]}
                onChange={(v) => { setTipoVenta(v); if (v === "CONTADO") setPlazoDias(""); }}
              />
              {tipoVenta === "CREDITO" && (
                <div className="mt-3">
                  <label className={labelClass}>Plazo de crédito (días)</label>
                  <input
                    type="number"
                    min={1}
                    value={plazoDias}
                    onChange={(e) => setPlazoDias(e.target.value)}
                    placeholder="Ej: 30"
                    className={`${inputClass} ${plazoDiasNum < 1 ? "border-red-300 bg-red-50" : ""}`}
                  />
                  {plazoDiasNum < 1 && (
                    <p className="mt-1 text-[11px] text-red-600">Ingresá un plazo de al menos 1 día.</p>
                  )}
                  {!clienteId && (
                    <p className="mt-1 text-[11px] text-red-600">La venta a crédito requiere un cliente: seleccioná uno o creá uno nuevo.</p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">Al confirmar se genera una cuenta por cobrar por el total.</p>
                </div>
              )}
            </div>

          </div>

          {/* Sin cliente seleccionado: crear uno nuevo (queda en el módulo
              Clientes y seleccionado en esta venta). */}
          {!clienteSel && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Cliente</p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  Sin cliente seleccionado. Si es nuevo, creá su ficha (queda en el listado de Clientes).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCrearCliente(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white shadow-sm shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91]"
              >
                <Plus className="h-4 w-4" />
                Crear cliente
              </button>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3: Carrito + totales + confirmar ─────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle>Productos en esta venta</SectionTitle>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#0EA5E9] hover:text-[#0284C7]"
              title="Buscador avanzado (presentaciones, crear producto)"
            >
              Buscador avanzado
            </button>
          </div>

          {/* Autocomplete compacto: al elegir un producto se agrega solo y se limpia. */}
          <div ref={comboContainerRef} className="relative">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#0EA5E9]" />
                <input
                  ref={comboInputRef}
                  type="text"
                  value={comboQuery}
                  onChange={(e) => { setComboQuery(e.target.value); setComboOpen(true); setComboHighlight(-1); }}
                  onFocus={() => setComboOpen(true)}
                  onKeyDown={onComboKeyDown}
                  placeholder="Buscar producto por nombre, SKU o palabras clave…"
                  className="h-12 w-full rounded-xl border-2 border-[#0EA5E9]/30 bg-white pl-12 pr-4 text-base text-slate-800 outline-none transition-all focus:border-[#0EA5E9] focus:ring-4 focus:ring-[#0EA5E9]/15"
                  autoComplete="off"
                />
              </div>
              <CategoriaCombo
                value={comboCategoriaId}
                options={categorias}
                onChange={(id) => { setComboCategoriaId(id); setComboOpen(true); setComboHighlight(-1); }}
              />
            </div>
            {comboOpen && (comboQuery.trim().length >= 2 || !!comboCategoriaId) && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[56vh] overflow-y-auto rounded-xl border-2 border-[#0EA5E9]/20 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)]">
                {comboBuscando && comboResultados.length === 0 ? (
                  <div className="px-4 py-5 text-center text-sm text-slate-400">Buscando…</div>
                ) : comboResultados.length === 0 ? (
                  <div className="px-4 py-5 text-center text-sm text-slate-400">
                    {comboQuery
                      ? `Sin resultados para "${comboQuery}"${comboCategoriaId ? " en esa categoría" : ""}.`
                      : "No hay productos en esta categoría."}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {comboResultados.map((p, i) => {
                      const controla = p.controla_stock !== false;
                      const sinStock = controla && (p.stock_actual ?? 0) <= 0;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            id={`combo-opt-${i}`}
                            onMouseEnter={() => setComboHighlight(i)}
                            onClick={() => agregarProductoRapido(p)}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === comboHighlight ? "bg-[#0EA5E9]/8" : "hover:bg-slate-50"}`}
                          >
                            <ProductoThumb url={p.imagen_url} alt={p.nombre} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-800">{p.nombre}</p>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                                <span className="font-mono">{p.sku}</span>
                                <span className="text-slate-300">·</span>
                                <span className={`font-semibold ${!controla ? "text-slate-400" : sinStock ? "text-red-600" : (p.stock_actual ?? 0) < 5 ? "text-amber-600" : "text-emerald-700"}`}>
                                  {!controla ? "Sin control" : sinStock ? "Sin stock" : `${p.stock_actual} ${p.unidad_medida ?? ""}`}
                                </span>
                              </div>
                            </div>
                            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800">{formatGs(precioPorTipo(p, "minorista"))}</span>
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#0EA5E9]/10 px-2.5 py-1 text-xs font-bold text-[#0284C7]">
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Agregar
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {!comboCategoriaId && comboResultados.length >= 20 && (
                      <li className="px-4 py-2 text-center text-[11px] text-slate-400">
                        Mostrando los primeros 20. Refiná la búsqueda o elegí una categoría para ver más.
                      </li>
                    )}
                    {comboCategoriaId && comboResultados.length >= 200 && (
                      <li className="px-4 py-2 text-center text-[11px] text-slate-400">
                        Mostrando los primeros 200 de la categoría. Escribí para filtrar más.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="mt-4 py-10 text-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              Buscá un producto arriba y se agrega automáticamente a la venta.
            </div>
          ) : (
            <>
              {/* min-w fuerza scroll horizontal en mobile (9 columnas).
                  Columnas secundarias (SKU, Subtotal, IVA Gs) se ocultan
                  progresivamente: en mobile solo Producto/Cant/Precio/Total/eliminar. */}
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[900px] text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-3">Producto</th>
                      <th className="hidden px-3 py-3 md:table-cell">Precio</th>
                      <th className="hidden px-3 py-3 text-center md:table-cell">IVA</th>
                      <th className="px-3 py-3 text-center">Cant.</th>
                      <th className="px-3 py-3 text-right">Precio unit.</th>
                      <th className="px-3 py-3 text-right">Stock</th>
                      <th className="px-3 py-3 text-right">Subtotal</th>
                      <th className="w-10 px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, idx) => {
                      const prod = productos.find((p) => p.id === item.producto_id);
                      const controla = prod ? prod.controla_stock !== false : true;
                      const stock = prod?.stock_actual ?? 0;
                      const stockBajo = controla && item.cantidad > stock;
                      // Piso del precio de venta = costo de compra del producto. El cajero
                      // puede bajar el precio, pero nunca por debajo del costo (regla del cliente).
                      const costoMin = prod?.costo_promedio ?? 0;
                      return (
                        <tr key={idx} className="align-middle transition-colors hover:bg-[#0EA5E9]/5">
                          {/* Producto + SKU */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-3">
                              <ProductoThumb url={prod?.imagen_url} alt={item.producto_nombre} />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 leading-snug">{item.producto_nombre}</p>
                                <p className="font-mono text-[11px] text-slate-500">{item.sku}</p>
                                {item.presentacion_nombre && (
                                  <p className="text-[11px] text-slate-500">
                                    {item.presentacion_nombre}
                                    {item.presentacion_cantidad_base != null && item.presentacion_cantidad_base !== 1
                                      ? ` = ${item.cantidad * item.presentacion_cantidad_base}` : ""}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          {/* Tipo de precio */}
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                              {(["minorista", "mayorista", "distribuidor"] as const).map((tp) => {
                                const sel = (item.tipo_precio ?? "minorista") === tp;
                                return (
                                  <button key={tp} type="button" onClick={() => changeTipoPrecioItem(idx, tp)}
                                    className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                    {tp === "minorista" ? "A" : tp === "mayorista" ? "B" : "C"}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          {/* IVA */}
                          <td className="hidden px-3 py-2.5 md:table-cell">
                            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                              {(["EXENTA", "5%", "10%"] as const).map((iva) => {
                                const sel = item.tipo_iva === iva;
                                return (
                                  <button key={iva} type="button" onClick={() => updateItemCampo(idx, { tipo_iva: iva })}
                                    className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                    {iva === "EXENTA" ? "Ex" : iva}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          {/* Cantidad */}
                          <td className="px-3 py-2.5">
                            <div className="mx-auto flex w-fit items-center rounded-md border border-slate-200 bg-white">
                              <button type="button" onClick={() => changeCantidadItem(idx, -1)} className="h-8 w-8 rounded-l-md text-slate-500 hover:bg-slate-100"><Minus className="mx-auto h-3.5 w-3.5" /></button>
                              <input
                                type="number" min={1} value={item.cantidad}
                                onChange={(e) => updateItemCampo(idx, { cantidad: Math.max(1, parseInt(e.target.value) || 1) })}
                                className="h-8 w-12 text-center text-sm tabular-nums outline-none"
                              />
                              <button type="button" onClick={() => changeCantidadItem(idx, 1)} className="h-8 w-8 rounded-r-md text-slate-500 hover:bg-slate-100"><Plus className="mx-auto h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                          {/* Precio unitario: editable libremente; el piso es el costo de compra. */}
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={item.precio_venta === 0 ? "" : String(item.precio_venta)}
                              onChange={(e) => {
                                // Solo dígitos: se puede editar libremente (subir, bajar, retipear)
                                // SIN forzar el mínimo en cada tecla.
                                const soloDigitos = e.target.value.replace(/[^\d]/g, "");
                                updateItemCampo(idx, { precio_venta: soloDigitos === "" ? 0 : Number(soloDigitos) });
                              }}
                              onBlur={() => {
                                // Al salir del campo se respeta el piso (costo de compra):
                                // no se puede vender por debajo del costo.
                                if (costoMin > 0 && item.precio_venta < costoMin) {
                                  updateItemCampo(idx, { precio_venta: costoMin });
                                }
                              }}
                              className={`h-8 w-28 rounded-md border bg-white px-2 text-right text-sm tabular-nums ${
                                costoMin > 0 && item.precio_venta < costoMin ? "border-red-300 bg-red-50" : "border-slate-200"
                              }`}
                              title={costoMin > 0
                                ? `Precio mínimo (costo de compra): ${formatGs(costoMin)}. No se puede cobrar por debajo del costo.`
                                : "Precio unitario"}
                            />
                            {costoMin > 0 && item.precio_venta < costoMin && (
                              <div className="mt-0.5 text-[10px] text-red-600">
                                Bajo el costo ({formatGs(costoMin)})
                              </div>
                            )}
                            {/* Descuento por línea sobre el precio del nivel elegido (A/B/C) */}
                            <div className="mt-1 flex justify-end gap-1">
                              {[0, 3, 5].map((d) => {
                                const base = item.precio_venta_original || item.precio_venta || 0;
                                const cur = base > 0 ? Math.round((1 - item.precio_venta / base) * 100) : 0;
                                const sel = cur === d;
                                return (
                                  <button
                                    key={d}
                                    type="button"
                                    onClick={() => updateItemCampo(idx, { precio_venta: Math.round(base * (1 - d / 100)) })}
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${sel ? "bg-[#0EA5E9] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                                    title={d === 0 ? "Sin descuento" : `Descuento ${d}%`}
                                  >
                                    {d === 0 ? "0%" : `-${d}%`}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          {/* Stock */}
                          <td className="px-3 py-2.5 text-right">
                            <span className={`text-xs font-semibold tabular-nums ${!controla ? "text-slate-400" : stockBajo ? "text-red-600" : "text-slate-600"}`}>
                              {!controla ? "—" : stock}
                            </span>
                          </td>
                          {/* Subtotal (total de línea) */}
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-sm font-bold tabular-nums text-slate-900">{formatGs(item.total_linea)}</span>
                          </td>
                          {/* Quitar */}
                          <td className="px-2 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleEliminarLinea(idx)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Quitar producto"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totales + Cobro (vuelto). Cuando hay pago mixto, ensancha
                  para dar aire al editor de multiples pagos. */}
              <div className="mt-5 flex justify-end">
                <div className={`w-full space-y-3 ${pagoMixto ? "lg:w-full" : "lg:w-80"}`}>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums font-medium">{formatGs(totalSubtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>IVA</span>
                      <span className="tabular-nums font-medium">
                        {totalIva > 0 ? formatGs(totalIva) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                      <span>TOTAL</span>
                      <span className="tabular-nums">{formatGs(totalGeneral)}</span>
                    </div>
                  </div>

                  {tipoVenta === "CONTADO" && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cobro</p>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={pagoMixto}
                            onChange={(e) => setPagoMixto(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                          />
                          Pago mixto
                        </label>
                      </div>

                      {pagoMixto && (
                        <PagosMixtoEditor
                          pagos={pagosMixto}
                          onChange={setPagosMixto}
                          total={totalGeneral}
                          entidades={entidades}
                          formatGs={formatGs}
                        />
                      )}

                      {!pagoMixto && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {([
                          { v: "efectivo", label: "Efectivo" },
                          { v: "transferencia", label: "Transferencia" },
                          { v: "tarjeta", label: "Tarjeta/Débito" },
                        ] as { v: MetodoPago; label: string }[]).map((m) => (
                          <button
                            key={m.v}
                            type="button"
                            onClick={() => handleSelectMetodo(m.v)}
                            className={`text-xs py-2 rounded-md border transition-colors ${
                              metodoPago === m.v
                                ? "border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#0EA5E9] font-medium"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      )}

                      {/* Efectivo: monto recibido + vuelto, sin datos extra */}
                      {!pagoMixto && metodoPago === "efectivo" && (
                        <div className="space-y-1.5">
                          <MontoInput
                            value={montoRecibido}
                            onChange={(n) => setMontoRecibido(String(n))}
                            placeholder="Monto recibido (Gs.) — opcional"
                            className={inputClass}
                            decimals={false}
                          />
                          {montoRecibidoNum > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">{vuelto >= 0 ? "Vuelto" : "Falta"}</span>
                              <span className={`font-bold tabular-nums ${vuelto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {formatGs(Math.abs(vuelto))}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Transferencia / Tarjeta: resumen compacto + editar */}
                      {!pagoMixto && (metodoPago === "transferencia" || metodoPago === "tarjeta") && (
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-700">
                              {metodoPago === "transferencia" ? "Transferencia" : "Tarjeta / Débito"}
                            </span>
                            <button type="button" onClick={() => { setEntidadQuery(""); setCobroModalOpen(true); }} className="text-sky-600 font-medium hover:underline">
                              Editar
                            </button>
                          </div>
                          <p className="text-slate-500">
                            Entidad: <span className="text-slate-700">{entidadSel ? `${entidadSel.codigo ? entidadSel.codigo + " · " : ""}${entidadSel.nombre}` : "— sin especificar —"}</span>
                          </p>
                          {pagoReferencia.trim() && <p className="text-slate-500">Comprobante: <span className="text-slate-700">{pagoReferencia}</span></p>}
                          {metodoPago === "transferencia" && pagoTitular.trim() && (
                            <p className="text-slate-500">Titular: <span className="text-slate-700">{pagoTitular}</span></p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Error confirmar */}
          {errorVenta && (
            <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <span className="font-medium">{errorVenta}</span>
            </div>
          )}

          {/* Acciones — stack vertical full-width en mobile (mas facil de tappear),
              fila en sm+. Confirmar en orden visual primero (primary). */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => router.push("/ventas")}
              className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors min-h-[48px] w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!ventaValida || guardando}
              aria-busy={guardando}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[48px] w-full sm:w-auto"
            >
              {guardando ? "Guardando…" : "Confirmar venta"}
            </button>
          </div>

        </div>

      </form>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAgregar={handleAgregarDesdePicker}
        excludeIds={items.map((i) => i.producto_id)}
        moneda={moneda}
        tipoCambio={tipoCambioNum}
        ivaDefault="10%"
      />

      {showCrearCliente && (
        <CrearClienteModal
          onClose={() => setShowCrearCliente(false)}
          onCreated={handleClienteCreado}
        />
      )}

      {/* Modal de cobro (transferencia / tarjeta-débito) */}
      {cobroModalOpen && (metodoPago === "transferencia" || metodoPago === "tarjeta") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCobroModalOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                {metodoPago === "transferencia" ? "Datos de transferencia" : "Datos de tarjeta / débito"}
              </h3>
              <button type="button" onClick={() => setCobroModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">
                {metodoPago === "tarjeta" ? "Entidad / banco / POS" : "Entidad / banco"}
              </label>
              <input
                type="text"
                value={entidadQuery}
                onChange={(e) => setEntidadQuery(e.target.value)}
                placeholder="Buscar por código o nombre…"
                className={inputClass}
                autoFocus
              />
              <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-100">
                {entidadesFiltradas.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Sin entidades. Cargalas en Configuración → Entidades bancarias.</p>
                ) : (
                  entidadesFiltradas.map((en) => (
                    <button
                      key={en.id}
                      type="button"
                      onClick={() => { setPagoEntidadId(en.id); setEntidadQuery(""); }}
                      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${pagoEntidadId === en.id ? "bg-sky-50" : ""}`}
                    >
                      {en.codigo && <span className="font-mono text-xs text-slate-400 mr-2">{en.codigo}</span>}
                      {en.nombre}
                    </button>
                  ))
                )}
              </div>
              {entidadSel && <p className="mt-1 text-[11px] text-emerald-600">Seleccionada: {entidadSel.nombre}</p>}
            </div>

            {metodoPago === "transferencia" && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Titular que transfirió</label>
                <input type="text" value={pagoTitular} onChange={(e) => setPagoTitular(e.target.value)} placeholder="Nombre del titular" className={inputClass} />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-600 mb-1">N° de comprobante / referencia</label>
              <input type="text" value={pagoReferencia} onChange={(e) => setPagoReferencia(e.target.value)} placeholder="Comprobante / transacción" className={inputClass} />
            </div>

            <button type="button" onClick={() => setCobroModalOpen(false)} className="w-full rounded-lg bg-[#0EA5E9] py-2 text-sm font-medium text-white hover:bg-[#0284C7]">
              Listo
            </button>
          </div>
        </div>
      )}

      {/* Modal de confirmación: venta sin stock suficiente */}
      {confirmSinStockOpen && faltantes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmSinStockOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-xl leading-none">⚠</span>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Hay productos/insumos sin stock suficiente</h3>
                <p className="text-xs text-slate-500 mt-0.5">Revisá el detalle. Podés vender igual: el stock quedará negativo y se registrará el movimiento de salida.</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 text-xs">
                    <th className="py-2 px-3 font-medium">Producto / Insumo</th>
                    <th className="py-2 px-3 font-medium text-right">Stock actual</th>
                    <th className="py-2 px-3 font-medium text-right">Solicitado</th>
                    <th className="py-2 px-3 font-medium text-right">Faltante</th>
                  </tr>
                </thead>
                <tbody>
                  {faltantes.map((f) => (
                    <tr key={f.producto_id} className="border-t border-slate-100">
                      <td className="py-2 px-3">
                        <span className="font-medium text-slate-800">{f.nombre}</span>
                        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${f.tipo === "insumo" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {f.tipo === "insumo" ? "Insumo" : "Producto"}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.stock_actual}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{f.solicitado}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-red-600">{f.faltante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => setConfirmSinStockOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
                Cancelar
              </button>
              <button type="button" disabled={guardando} aria-busy={guardando} onClick={() => void confirmarVentaSinStock()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
                {guardando ? "Guardando…" : "Confirmar venta de todos modos"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel post-venta: abrir ticket y (si aplica) nota de remisión */}
      {postVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 text-center">
            <div className="text-3xl">✅</div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">Venta {postVenta.numero} registrada</h3>
              {postVenta.credito && (
                <p className="mt-1 text-sm font-medium text-amber-700">Venta a crédito registrada. Cuenta por cobrar generada.</p>
              )}
              {postVenta.generaNota && (
                <p className="mt-1 text-sm text-sky-700">Esta venta genera nota de remisión.</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Si tu navegador bloqueó las pestañas, abrí los documentos con estos botones.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <a
                href={`/api/ventas/${postVenta.id}/comprobante-a4`}
                target="_blank"
                rel="noopener"
                className="rounded-lg bg-[#0EA5E9] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0284C7]"
              >
                Abrir ticket
              </a>
              <a
                href={`/api/ventas/${postVenta.id}/factura?auto=1`}
                target="_blank"
                rel="noopener"
                className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-2.5 text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/[0.16]"
              >
                Imprimir factura
              </a>
              {postVenta.generaNota && (
                <a
                  href={`/api/ventas/${postVenta.id}/ticket?tipo=remision&auto=1`}
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
                >
                  Abrir nota de remisión
                </a>
              )}
              {/* Recibo de dinero solo para venta contado (en crédito el recibo sale al cobrar). */}
              {!postVenta.credito && (
                <button
                  type="button"
                  onClick={async () => {
                    const r = await generarYAbrirRecibo({ origen: "venta_contado", venta_id: postVenta.id });
                    if (!r.ok) setErrorVenta(r.error ?? "No se pudo generar el recibo.");
                  }}
                  className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-4 py-2.5 text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/[0.16]"
                >
                  Generar recibo de dinero
                </button>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-center pt-1">
              <button
                type="button"
                onClick={() => { setPostVenta(null); router.push("/ventas"); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Ir a ventas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Combobox categoría con búsqueda (paleta Zentra) ───────────────────────────
// ── Editor de pago mixto (2+ metodos por venta) ───────────────────────────────
type PagoMixtoLinea = {
  metodo: "efectivo" | "transferencia" | "tarjeta";
  monto: string;
  entidad_id: string;
  referencia: string;
  titular: string;
};

function PagosMixtoEditor({
  pagos,
  onChange,
  total,
  entidades,
  formatGs,
}: {
  pagos: PagoMixtoLinea[];
  onChange: (next: PagoMixtoLinea[]) => void;
  total: number;
  entidades: { id: string; codigo: string | null; nombre: string; tipo: string | null }[];
  formatGs: (n: number) => string;
}) {
  const suma = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const restante = total - suma;

  function update(i: number, patch: Partial<PagoMixtoLinea>) {
    const next = pagos.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange(next);
  }
  function add() {
    onChange([
      ...pagos,
      { metodo: "efectivo", monto: "", entidad_id: "", referencia: "", titular: "" },
    ]);
  }
  function remove(i: number) {
    if (pagos.length <= 1) return;
    onChange(pagos.filter((_, idx) => idx !== i));
  }
  function autoCompletar(i: number) {
    if (restante <= 0) return;
    const actual = Number(pagos[i].monto) || 0;
    update(i, { monto: String(Math.round(actual + restante)) });
  }

  return (
    <div className="space-y-3">
      {pagos.map((p, i) => {
        const needEntidad = p.metodo === "transferencia" || p.metodo === "tarjeta";
        return (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
          {/* Grid fijo: metodo | monto | entidad | ref | titular | +resto | ×
              Los slots de entidad/ref/titular quedan vacios en Efectivo para
              que +resto y × queden alineados verticalmente entre lineas.
              Se apila con flex en pantallas chicas. */}
          <div className="hidden md:grid grid-cols-[10rem_11rem_1fr_1fr_1fr_auto_auto] items-center gap-2">
            <select
              value={p.metodo}
              onChange={(e) => update(i, { metodo: e.target.value as PagoMixtoLinea["metodo"] })}
              className="h-11 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta/Débito</option>
            </select>
            <input
              type="number"
              inputMode="numeric"
              value={p.monto}
              onChange={(e) => update(i, { monto: e.target.value })}
              placeholder="Monto (Gs.)"
              className="h-11 rounded-md border border-slate-200 px-3 text-sm text-right tabular-nums font-semibold"
            />
            {needEntidad ? (
              <select
                value={p.entidad_id}
                onChange={(e) => update(i, { entidad_id: e.target.value })}
                className="h-11 min-w-0 rounded-md border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">— Entidad —</option>
                {entidades.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.codigo ? `${e.codigo} · ` : ""}
                    {e.nombre}
                  </option>
                ))}
              </select>
            ) : <div />}
            {needEntidad ? (
              <input
                type="text"
                value={p.referencia}
                onChange={(e) => update(i, { referencia: e.target.value })}
                placeholder="Comprobante / ref."
                className="h-11 min-w-0 rounded-md border border-slate-200 px-3 text-sm"
              />
            ) : <div />}
            {needEntidad && p.metodo === "transferencia" ? (
              <input
                type="text"
                value={p.titular}
                onChange={(e) => update(i, { titular: e.target.value })}
                placeholder="Titular"
                className="h-11 min-w-0 rounded-md border border-slate-200 px-3 text-sm"
              />
            ) : <div />}
            <button
              type="button"
              onClick={() => autoCompletar(i)}
              disabled={restante <= 0}
              className="h-11 shrink-0 rounded-md border border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.08] px-3 text-xs font-bold text-[#0284C7] hover:bg-[#0EA5E9]/[0.15] disabled:opacity-40"
              title="Poner el restante en este pago"
            >
              + resto
            </button>
            {pagos.length > 1 ? (
              <button
                type="button"
                onClick={() => remove(i)}
                className="h-11 w-11 shrink-0 rounded-md border border-slate-200 text-slate-400 text-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                title="Quitar este pago"
              >
                ×
              </button>
            ) : <div className="w-11" />}
          </div>
          {/* Mobile: apilado */}
          <div className="md:hidden flex flex-wrap items-center gap-2">
            <select
              value={p.metodo}
              onChange={(e) => update(i, { metodo: e.target.value as PagoMixtoLinea["metodo"] })}
              className="h-11 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta/Débito</option>
            </select>
            <input
              type="number"
              inputMode="numeric"
              value={p.monto}
              onChange={(e) => update(i, { monto: e.target.value })}
              placeholder="Monto (Gs.)"
              className="h-11 flex-1 rounded-md border border-slate-200 px-3 text-sm text-right tabular-nums font-semibold"
            />
            <button
              type="button"
              onClick={() => autoCompletar(i)}
              disabled={restante <= 0}
              className="h-11 rounded-md border border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.08] px-3 text-xs font-bold text-[#0284C7] disabled:opacity-40"
            >+ resto</button>
            {pagos.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="h-11 w-11 rounded-md border border-slate-200 text-slate-400 text-lg"
              >×</button>
            )}
            {needEntidad && (
              <div className="w-full grid grid-cols-1 gap-2">
                <select value={p.entidad_id} onChange={(e) => update(i, { entidad_id: e.target.value })} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 text-sm">
                  <option value="">— Entidad —</option>
                  {entidades.map((e) => (
                    <option key={e.id} value={e.id}>{e.codigo ? `${e.codigo} · ` : ""}{e.nombre}</option>
                  ))}
                </select>
                <input type="text" value={p.referencia} onChange={(e) => update(i, { referencia: e.target.value })} placeholder="Comprobante / ref." className="h-10 rounded-md border border-slate-200 px-3 text-sm" />
                {p.metodo === "transferencia" && (
                  <input type="text" value={p.titular} onChange={(e) => update(i, { titular: e.target.value })} placeholder="Titular" className="h-10 rounded-md border border-slate-200 px-3 text-sm" />
                )}
              </div>
            )}
          </div>
        </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="w-full text-sm py-2.5 rounded-md border border-dashed border-slate-300 text-slate-600 hover:bg-white font-medium"
      >
        + Agregar pago
      </button>
      <div className="flex items-center justify-between pt-1 text-sm">
        <span className="text-slate-500">
          Total cobrado:{" "}
          <span className={`font-bold tabular-nums ${suma === total ? "text-emerald-600" : "text-slate-800"}`}>
            {formatGs(suma)}
          </span>
        </span>
        <span
          className={`font-bold tabular-nums ${
            restante === 0 ? "text-emerald-600" : restante > 0 ? "text-amber-600" : "text-red-600"
          }`}
        >
          {restante > 0 ? `Falta ${formatGs(restante)}` : restante < 0 ? `Sobra ${formatGs(-restante)}` : "✓ Coincide"}
        </span>
      </div>
    </div>
  );
}

function CategoriaCombo({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; nombre: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = options.find((o) => o.id === value) ?? null;
  const nq = q.trim().toLowerCase();
  const filtered = nq
    ? options.filter((o) => o.nombre.toLowerCase().includes(nq))
    : options;

  return (
    <div ref={wrapRef} className="relative sm:w-56">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-12 w-full items-center justify-between gap-2 rounded-xl border-2 bg-white px-3 text-sm outline-none transition-all ${
          open || selected
            ? "border-[#4FAEB2] text-slate-800 ring-4 ring-[#4FAEB2]/15"
            : "border-[#0EA5E9]/30 text-slate-700 hover:border-[#4FAEB2]/60"
        }`}
      >
        <span className="truncate">
          {selected ? selected.nombre : "Todas las categorías"}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-full min-w-[16rem] overflow-hidden rounded-xl border-2 border-[#4FAEB2]/25 bg-white shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)]">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar categoría…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/15"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); setQ(""); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  !value ? "bg-[#4FAEB2]/10 font-semibold text-[#3F8E91]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                Todas las categorías
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-center text-xs text-slate-400">Sin resultados.</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      value === c.id
                        ? "bg-[#4FAEB2]/10 font-semibold text-[#3F8E91]"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="truncate">{c.nombre}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
