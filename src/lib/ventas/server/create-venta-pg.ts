import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { convertirCantidad } from "@/lib/unidades/convert";
import {
  PRESENTACION_COLS,
  mapPresentacion,
} from "@/lib/inventario/presentaciones-server";
import type { ProductoPresentacion } from "@/lib/inventario/presentaciones-types";
import { obtenerSiguienteNumeroFacturaEmpresa } from "@/lib/facturacion/factura-suscripcion-servidor";

/** Un faltante de stock detectado al validar la venta. */
export interface FaltanteStock {
  tipo: "producto" | "insumo";
  producto_id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  solicitado: number;
  faltante: number;
}

/**
 * Se lanza cuando falta stock y NO se autorizó la venta sin stock
 * (`permitir_sin_stock` ausente/false). Lleva el detalle para que la UI
 * muestre el modal de confirmación y reintente con el flag.
 */
export class StockInsuficienteError extends Error {
  faltantes: FaltanteStock[];
  constructor(faltantes: FaltanteStock[]) {
    super("Stock insuficiente para uno o más productos/insumos.");
    this.name = "StockInsuficienteError";
    this.faltantes = faltantes;
  }
}

export interface CreateVentaItemInput {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  /**
   * Cantidad en la presentacion elegida. Ej: 2 (cajas), 10 (unidades).
   * El stock se descuenta usando `cantidad * presentacion.cantidad_base`.
   */
  cantidad: number;
  precio_venta_original: number;
  /** Precio POR PRESENTACION (lo que cobra el cajero por 1 caja, 1 unidad, etc). */
  precio_venta: number;
  tipo_iva: "EXENTA" | "5%" | "10%";
  tipo_precio: "minorista" | "mayorista" | "distribuidor" | "costo";
  subtotal: number;
  monto_iva: number;
  total_linea: number;
  /**
   * Opcional. Si no se manda, se usa la presentacion default activa del
   * producto. Si el producto tampoco tiene default (no deberia tras el
   * backfill), se asume cantidad_base = 1 (compatibilidad legacy).
   */
  presentacion_id?: string | null;
}

export interface CreateVentaPedidoCocinaInput {
  modalidad: "local" | "delivery" | "carry_out";
  mesa: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  direccion_entrega: string | null;
  observacion: string | null;
}

export interface CreateVentaPgParams {
  schema: string;
  empresaId: string;
  clienteId: string | null;
  observaciones: string | null;
  moneda: "GS" | "USD";
  tipoCambio: number;
  tipoVenta: "CONTADO" | "CREDITO";
  plazoDias: number | null;
  /** Fecha de vencimiento explícita (YYYY-MM-DD) para crédito. Si falta, se calcula con plazoDias. */
  fechaVencimiento?: string | null;
  metodoPago: "efectivo" | "tarjeta" | "transferencia" | null;
  items: CreateVentaItemInput[];
  subtotalDeclarado: number;
  montoIvaDeclarado: number;
  totalDeclarado: number;
  pedidoCocina?: CreateVentaPedidoCocinaInput | null;
  /** Si true, autoriza vender aunque falte stock de productos o insumos (stock puede quedar negativo). */
  permitirSinStock?: boolean;
  /** Si true y hay cliente, la venta emite nota de remisión (documento NO fiscal) con número NR-XXXXXX. */
  generaNotaRemision?: boolean;
  /** Caja (turno) a la que se asocia la venta. La elige el cajero cuando hay varias abiertas. */
  cajaId?: string | null;
  /** Usuario que registra la venta (auditoría de movimientos de inventario). */
  usuarioId?: string | null;
  usuarioNombre?: string | null;
  /**
   * Si true, activa el puente Venta → Factura ERP (SIFEN legal): crea una fila
   * `facturas` FAC-XXXXXX, sus `factura_items` y linkea `ventas.factura_id`.
   * El detalle /facturas/[id] usa después el panel electrónico para firmar/enviar.
   *
   * Default false: la venta se registra SOLO como ticket (comportamiento actual),
   * no toca `facturas` y `ventas.factura_id` queda null. La ruta activa este flag
   * únicamente cuando el cajero elige "Factura" Y la empresa está en modo 'sifen'.
   * Requiere cliente (SIFEN necesita receptor con RUC/razón social). Si falta el
   * cliente, no se rompe la venta: se devuelve `facturaWarning` y queda como ticket.
   */
  emitirFactura?: boolean;
}

function recalcTotals(items: CreateVentaItemInput[]) {
  let subtotal = 0;
  let montoIva = 0;
  let total = 0;
  for (const it of items) {
    subtotal += it.subtotal;
    montoIva += it.monto_iva;
    total += it.total_linea;
  }
  return { subtotal, montoIva, total };
}

const TOL = 2;

/**
 * Crea venta + ítems + movimientos + descuenta stock vía PostgREST/service-role.
 * Sin pool PG directo → compatible con Hostinger Node.js App.
 *
 * Atomicidad: PostgREST no expone transacciones multi-statement. Se hace best-effort:
 * si algún paso post-venta falla, se intenta rollback eliminando venta+items creados.
 * Para una instancia gastronómica de bajo volumen es aceptable.
 *
 * Regla `controla_stock` / recetas:
 *  - Producto con receta activa (Menú elaborado): NO descuenta su propio stock; explota la
 *    receta y descuenta cada insumo/materia prima (consumo = cantidad·(1+merma_pct)/rendimiento,
 *    consistente con fn_receta_costeo), generando un movimiento SALIDA (origen 'venta', ligado por
 *    venta_id) por insumo. Valida disponibilidad de insumos.
 *  - `controla_stock=true` (Reventa, sin receta): valida stock, descuenta stock, genera movimiento.
 *  - `controla_stock=false` (Menú sin receta / servicio): se inserta en ventas_items, NO descuenta.
 */
export async function createVentaTransaccionalPg(
  params: CreateVentaPgParams
): Promise<{
  ventaId: string;
  numeroControl: string;
  fechaIso: string;
  notaRemisionNumero: string | null;
  cuentaPorCobrarId?: string | null;
  facturaId?: string | null;
  numeroFactura?: string | null;
  facturaWarning?: string | null;
}> {
  const items = params.items;
  if (!items.length) {
    throw new Error("La venta debe tener al menos un ítem.");
  }

  const calc = recalcTotals(items);
  if (
    Math.abs(calc.subtotal - params.subtotalDeclarado) > TOL ||
    Math.abs(calc.montoIva - params.montoIvaDeclarado) > TOL ||
    Math.abs(calc.total - params.totalDeclarado) > TOL
  ) {
    throw new Error("Los totales no coinciden con los ítems; revisá el carrito.");
  }

  const sb = createServiceRoleClientWithDbSchema(params.schema);

  // ---------------------------------------------------------------------
  // Resolver presentaciones para cada item ANTES de validar stock.
  //
  // Diseño:
  // - `line.cantidad` es la cantidad EN LA PRESENTACION (ej. 2 cajas).
  // - Stock, validacion, decremento y movimientos usan `cantidad_total_base`
  //   = cantidad * presentacion.cantidad_base.
  // - Si la linea no trae presentacion_id, se busca la default activa del
  //   producto. Si no existe ninguna (no deberia tras el backfill), se asume
  //   cantidad_base = 1 (compat legacy: la cantidad ES la unidad base).
  // ---------------------------------------------------------------------
  const productoIds = [...new Set(items.map((i) => i.producto_id))];
  const explicitPresIds = items.map((i) => i.presentacion_id).filter((x): x is string => !!x);

  // 1) Defaults activos por producto (para items sin presentacion_id).
  const defaultsByProd = new Map<string, ProductoPresentacion>();
  if (productoIds.length > 0) {
    const dq = await sb
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("empresa_id", params.empresaId)
      .eq("activo", true)
      .eq("es_default", true)
      .in("producto_id", productoIds);
    if (dq.error) throw new Error(dq.error.message);
    for (const r of (dq.data ?? []) as Record<string, unknown>[]) {
      const p = mapPresentacion(r);
      defaultsByProd.set(p.producto_id, p);
    }
  }
  // 2) Presentaciones explicitas por id.
  const explicitByPres = new Map<string, ProductoPresentacion>();
  if (explicitPresIds.length > 0) {
    const eq = await sb
      .from("producto_presentaciones")
      .select(PRESENTACION_COLS)
      .eq("empresa_id", params.empresaId)
      .in("id", explicitPresIds);
    if (eq.error) throw new Error(eq.error.message);
    for (const r of (eq.data ?? []) as Record<string, unknown>[]) {
      const p = mapPresentacion(r);
      explicitByPres.set(p.id, p);
    }
  }

  // 3) Para cada line: { snapshot, cantidad_total_base }. Indexado por
  //    posicion para mantener orden y permitir multiples lineas del mismo
  //    producto con presentaciones distintas (ej. 1 caja + 3 unidades).
  type LineResolved = {
    presentacionId: string | null;
    presentacionNombre: string | null;
    presentacionCantBase: number;
    cantidadTotalBase: number;
  };
  const lineResolved: LineResolved[] = items.map((it) => {
    let pres: ProductoPresentacion | null = null;
    if (it.presentacion_id) {
      pres = explicitByPres.get(it.presentacion_id) ?? null;
      if (!pres) {
        throw new Error(
          `La presentación elegida para "${it.producto_nombre}" no existe o fue removida.`
        );
      }
      if (pres.producto_id !== it.producto_id) {
        throw new Error(
          `La presentación no corresponde al producto "${it.producto_nombre}".`
        );
      }
      if (!pres.activo) {
        throw new Error(
          `La presentación "${pres.nombre}" de "${it.producto_nombre}" está inactiva.`
        );
      }
    } else {
      pres = defaultsByProd.get(it.producto_id) ?? null;
    }
    // Compat legacy: producto sin ninguna presentacion (no deberia pasar).
    const cantBase = pres ? pres.cantidad_base : 1;
    return {
      presentacionId: pres ? pres.id : null,
      presentacionNombre: pres ? pres.nombre : null,
      presentacionCantBase: cantBase,
      cantidadTotalBase: it.cantidad * cantBase,
    };
  });

  // qtyByProduct acumula en UNIDADES BASE para validacion de stock,
  // explosion de recetas y decremento — todo el downstream piensa en base.
  const qtyByProduct = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    qtyByProduct.set(
      it.producto_id,
      (qtyByProduct.get(it.producto_id) ?? 0) + lineResolved[i].cantidadTotalBase
    );
  }

  // 1) Cliente
  if (params.clienteId) {
    const ck = await sb.from("clientes").select("id").eq("id", params.clienteId).eq("empresa_id", params.empresaId).maybeSingle();
    if (ck.error) throw new Error(ck.error.message);
    if (!ck.data) throw new Error("Cliente no encontrado en esta empresa.");
  }

  // 2) Cargar productos del carrito — TODOS los que existan y pertenezcan a la empresa, sin filtrar controla_stock ni stock>0.
  const ids = [...qtyByProduct.keys()];
  const prodQ = await sb
    .from("productos")
    .select("id, stock_actual, costo_promedio, nombre, sku, controla_stock, modo_receta")
    .eq("empresa_id", params.empresaId)
    .in("id", ids);
  if (prodQ.error) throw new Error(prodQ.error.message);
  const prodRows = (prodQ.data ?? []) as unknown as Array<{
    id: string;
    stock_actual: number | string;
    costo_promedio: number | string;
    nombre: string;
    sku: string;
    controla_stock: boolean | null;
    modo_receta: string | null;
  }>;

  if (prodRows.length !== ids.length) {
    const found = new Set(prodRows.map((r) => r.id));
    const faltantes = ids.filter((id) => !found.has(id));
    throw new Error(
      `Uno o más productos no existen o no pertenecen a esta empresa. IDs no encontrados: ${faltantes.join(", ")}`
    );
  }

  type ProdMeta = { stock: number; costo: number; nombre: string; sku: string; controlaStock: boolean; modo: string };
  const stockMap = new Map<string, ProdMeta>();
  for (const r of prodRows) {
    stockMap.set(r.id, {
      stock: Number(r.stock_actual),
      costo: Number(r.costo_promedio),
      nombre: r.nombre,
      sku: r.sku,
      controlaStock: r.controla_stock !== false,
      modo: r.modo_receta ?? "preparado_al_vender",
    });
  }

  // 2b) Recetas: para cada producto vendido con receta activa, calcular el consumo de
  //     materia prima (insumos). Consistente con el costeo (fn_receta_costeo):
  //     consumo por unidad vendida = cantidad * (1 + merma_pct) / rendimiento.
  const recetasQ = await sb
    .from("recetas")
    .select("id, producto_id, rendimiento_cantidad")
    .eq("empresa_id", params.empresaId)
    .eq("activa", true)
    .in("producto_id", ids);
  if (recetasQ.error) throw new Error(recetasQ.error.message);
  const recetaRows = (recetasQ.data ?? []) as unknown as Array<{
    id: string;
    producto_id: string;
    rendimiento_cantidad: number | string | null;
  }>;
  // Solo se explota la receta (descuento de materia prima al vender) para productos en modo
  // 'preparado_al_vender'. Los productos 'produccion_previa' descuentan su PROPIO stock del
  // terminado (la materia prima ya se descontó al fabricar) → NO se agregan acá, así caen en
  // la rama de descuento de stock propio (pasos 3a/7). Evita el doble descuento.
  const recetaByProducto = new Map<string, { id: string; rendimiento: number }>();
  for (const r of recetaRows) {
    const modo = stockMap.get(r.producto_id)?.modo ?? "preparado_al_vender";
    if (modo === "produccion_previa") continue;
    const rend = Number(r.rendimiento_cantidad);
    recetaByProducto.set(r.producto_id, { id: r.id, rendimiento: rend > 0 ? rend : 1 });
  }

  // insumo_producto_id -> cantidad total a descontar en esta venta (EN LA UNIDAD DEL INSUMO).
  const insumoNeed = new Map<string, number>();
  // Metadata de insumos (stock/costo/nombre/sku/unidad) para validar y registrar movimientos.
  type InsumoMeta = { stock: number; costo: number; nombre: string; sku: string; unidad: string | null };
  const insumoMeta = new Map<string, InsumoMeta>();
  // Ítems cuya unidad es incompatible con la del insumo (no se convierten ni descuentan).
  const insumosIncompatibles: string[] = [];

  if (recetaRows.length) {
    const recetaIds = recetaRows.map((r) => r.id);
    const itemsQ = await sb
      .from("receta_items")
      .select("receta_id, insumo_producto_id, cantidad, unidad_medida, merma_pct")
      .in("receta_id", recetaIds);
    if (itemsQ.error) throw new Error(itemsQ.error.message);
    const itemsByReceta = new Map<string, Array<{ insumo_producto_id: string; cantidad: number; unidad_item: string | null; merma_pct: number }>>();
    const insumoIdsSet = new Set<string>();
    for (const it of (itemsQ.data ?? []) as unknown as Array<{
      receta_id: string;
      insumo_producto_id: string;
      cantidad: number | string;
      unidad_medida: string | null;
      merma_pct: number | string | null;
    }>) {
      const arr = itemsByReceta.get(it.receta_id) ?? [];
      arr.push({
        insumo_producto_id: it.insumo_producto_id,
        cantidad: Number(it.cantidad),
        unidad_item: it.unidad_medida ?? null,
        merma_pct: Number(it.merma_pct ?? 0),
      });
      itemsByReceta.set(it.receta_id, arr);
      insumoIdsSet.add(it.insumo_producto_id);
    }

    // Cargar meta de insumos (incluida su unidad) ANTES de agregar, para poder convertir.
    const insumoIds = [...insumoIdsSet];
    if (insumoIds.length) {
      const insQ = await sb
        .from("productos")
        .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
        .eq("empresa_id", params.empresaId)
        .in("id", insumoIds);
      if (insQ.error) throw new Error(insQ.error.message);
      const insRows = (insQ.data ?? []) as unknown as Array<{
        id: string;
        stock_actual: number | string;
        costo_promedio: number | string;
        nombre: string;
        sku: string;
        unidad_medida: string | null;
      }>;
      if (insRows.length !== insumoIds.length) {
        const found = new Set(insRows.map((r) => r.id));
        const faltan = insumoIds.filter((i) => !found.has(i));
        throw new Error(`La receta referencia insumos inexistentes en esta empresa: ${faltan.join(", ")}`);
      }
      for (const r of insRows) {
        insumoMeta.set(r.id, {
          stock: Number(r.stock_actual),
          costo: Number(r.costo_promedio),
          nombre: r.nombre,
          sku: r.sku,
          unidad: r.unidad_medida ?? null,
        });
      }
    }

    // Agregar consumo CONVIRTIENDO la cantidad del ítem a la unidad del insumo.
    for (const [pid, qtySold] of qtyByProduct) {
      const rec = recetaByProducto.get(pid);
      if (!rec) continue;
      for (const ri of itemsByReceta.get(rec.id) ?? []) {
        const meta = insumoMeta.get(ri.insumo_producto_id);
        const unidadInsumo = meta?.unidad ?? null;
        // Sin unidad declarada en el ítem o en el insumo → se asume misma unidad (sin conversión).
        const cantConv = (ri.unidad_item == null || unidadInsumo == null)
          ? ri.cantidad
          : convertirCantidad(ri.cantidad, ri.unidad_item, unidadInsumo);
        if (cantConv == null) {
          // Unidad incompatible (familias distintas): no se descuenta para no corromper el stock.
          const nombre = meta?.nombre ?? ri.insumo_producto_id;
          if (!insumosIncompatibles.includes(nombre)) insumosIncompatibles.push(nombre);
          continue;
        }
        const consumo = (qtySold * cantConv * (1 + ri.merma_pct)) / rec.rendimiento;
        if (!(consumo > 0)) continue;
        insumoNeed.set(ri.insumo_producto_id, (insumoNeed.get(ri.insumo_producto_id) ?? 0) + consumo);
      }
    }
  }
  // Redondeo a 6 decimales para evitar ruido de coma flotante (la columna es numeric sin escala).
  for (const [k, v] of insumoNeed) insumoNeed.set(k, Math.round(v * 1e6) / 1e6);
  if (insumosIncompatibles.length > 0) {
    console.warn("[create-venta-pg] receta con unidades incompatibles (no se descuentan):", insumosIncompatibles.join(", "));
  }

  // 3) Validar stock. Se recolectan TODOS los faltantes (productos de reventa con receta
  //    consumen insumos, no su propio stock). Si hay faltantes y NO se autorizó la venta sin
  //    stock, se lanza StockInsuficienteError con el detalle (la UI muestra el modal y reintenta
  //    con permitir_sin_stock=true). Si se autorizó, se continúa y el stock puede quedar negativo.
  const faltantes: FaltanteStock[] = [];

  // 3a) Productos de reventa (controla_stock=true, sin receta).
  for (const [pid, need] of qtyByProduct) {
    const p = stockMap.get(pid)!;
    if (recetaByProducto.has(pid)) continue;
    // produccion_previa: descuenta su propio stock del terminado aunque controla_stock=false.
    if (!p.controlaStock && p.modo !== "produccion_previa") continue;
    if (p.stock < need) {
      faltantes.push({
        tipo: "producto", producto_id: pid, nombre: p.nombre, sku: p.sku,
        stock_actual: p.stock, solicitado: need, faltante: Math.round((need - p.stock) * 1e6) / 1e6,
      });
    }
  }

  // 3b) Materia prima (insumos) requerida por las recetas.
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    if (m.stock < need) {
      faltantes.push({
        tipo: "insumo", producto_id: insId, nombre: m.nombre, sku: m.sku,
        stock_actual: m.stock, solicitado: need, faltante: Math.round((need - m.stock) * 1e6) / 1e6,
      });
    }
  }

  if (faltantes.length > 0 && !params.permitirSinStock) {
    throw new StockInsuficienteError(faltantes);
  }

  // La venta guarda solo la observación que ingresó el usuario. No se agrega
  // ninguna nota automática (la venta sin stock ya queda trazada por el stock
  // negativo y el movimiento de inventario).
  const observacionesFinal = params.observaciones;

  // 4) Numero control VTA-XXXXXX (best-effort: race posible en entorno multi-usuario).
  const maxQ = await sb
    .from("ventas")
    .select("numero_control")
    .eq("empresa_id", params.empresaId)
    .like("numero_control", "VTA-%")
    .order("numero_control", { ascending: false })
    .limit(1);
  if (maxQ.error) throw new Error(maxQ.error.message);
  let nextNum = 1;
  const lastNum = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
  if (lastNum) {
    const m = lastNum.match(/^VTA-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  const numeroControl = `VTA-${String(nextNum).padStart(6, "0")}`;
  const fechaIso = new Date().toISOString();

  // 4b) Nota de remisión (solo si se solicita Y hay cliente). Numeración simple por
  //     empresa: NR-XXXXXX. Documento NO fiscal — no toca SIFEN/timbrado.
  const generaNota = params.generaNotaRemision === true && !!params.clienteId;
  let notaRemisionNumero: string | null = null;
  if (generaNota) {
    const nrQ = await sb
      .from("ventas")
      .select("nota_remision_numero")
      .eq("empresa_id", params.empresaId)
      .like("nota_remision_numero", "NR-%")
      .order("nota_remision_numero", { ascending: false })
      .limit(1);
    if (nrQ.error) throw new Error(nrQ.error.message);
    let nextNr = 1;
    const lastNr = (nrQ.data?.[0] as { nota_remision_numero?: string } | undefined)?.nota_remision_numero;
    if (lastNr) {
      const m = lastNr.match(/^NR-(\d+)$/);
      if (m) nextNr = parseInt(m[1], 10) + 1;
    }
    notaRemisionNumero = `NR-${String(nextNr).padStart(6, "0")}`;
  }

  // 4c) Resolver la caja (turno) a la que se asocia la venta. Soporta múltiples
  //     cajas abiertas: el cajero elige cuál (params.cajaId). Reglas:
  //       - Si viene cajaId, debe estar ABIERTA (no 'en_cierre' ni cerrada).
  //       - Si no viene y hay 1 sola abierta, se usa esa.
  //       - Si no hay ninguna abierta → bloquea la venta.
  //       - Si hay varias y no se especificó → pide elegir.
  const cQ = await sb
    .from("cajas")
    .select("id, numero_caja")
    .eq("empresa_id", params.empresaId)
    .eq("estado", "abierta")
    .order("numero_caja", { ascending: true });
  if (cQ.error) throw new Error(cQ.error.message);
  const abiertas = (cQ.data ?? []) as Array<{ id: string; numero_caja: number | string }>;

  let cajaIdActual: string;
  const pedida = params.cajaId ? String(params.cajaId) : null;
  if (pedida) {
    const match = abiertas.find((c) => String(c.id) === pedida);
    if (!match) {
      throw new Error("La caja seleccionada no está abierta. Elegí una caja abierta para registrar la venta.");
    }
    cajaIdActual = String(match.id);
  } else if (abiertas.length === 1) {
    cajaIdActual = String(abiertas[0].id);
  } else if (abiertas.length === 0) {
    throw new Error("Debe abrir una caja para registrar ventas/cobros.");
  } else {
    throw new Error("Hay varias cajas abiertas: seleccioná la caja para registrar la venta.");
  }

  // 5) Insertar venta
  const insVenta = await sb
    .from("ventas")
    .insert({
      empresa_id: params.empresaId,
      cliente_id: params.clienteId,
      numero_control: numeroControl,
      moneda: params.moneda,
      tipo_cambio: params.tipoCambio,
      subtotal: calc.subtotal,
      monto_iva: calc.montoIva,
      total: calc.total,
      estado: "completada",
      tipo_venta: params.tipoVenta,
      plazo_dias: params.plazoDias,
      metodo_pago: params.metodoPago,
      genera_nota_remision: generaNota,
      nota_remision_numero: notaRemisionNumero,
      fecha: fechaIso,
      observaciones: observacionesFinal,
      caja_id: cajaIdActual,
      created_by: params.usuarioId ?? null,
      usuario_nombre: params.usuarioNombre ?? null,
    })
    .select("id")
    .single();
  if (insVenta.error) throw new Error(insVenta.error.message);
  const ventaId = String((insVenta.data as { id: string }).id);

  // Helper de rollback best-effort
  const rollback = async () => {
    try {
      await sb.from("cuentas_por_cobrar").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("movimientos_inventario").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("ventas_items").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("ventas").delete().eq("id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
  };

  try {
    // 6) Insertar items (bulk). Cada item guarda el SNAPSHOT de la
    //    presentacion usada (id, nombre, cantidad_base) y la cantidad total
    //    en unidades base que se descuento. Esto permite que reportes
    //    historicos sigan funcionando aunque la presentacion cambie despues.
    const itemsRows = items.map((line, i) => {
      const lr = lineResolved[i];
      return {
        empresa_id: params.empresaId,
        venta_id: ventaId,
        producto_id: line.producto_id,
        producto_nombre: line.producto_nombre,
        sku: line.sku,
        cantidad: line.cantidad,
        precio_venta_original: line.precio_venta_original,
        precio_venta: line.precio_venta,
        tipo_iva: line.tipo_iva,
        tipo_precio: line.tipo_precio,
        subtotal: line.subtotal,
        monto_iva: line.monto_iva,
        total_linea: line.total_linea,
        presentacion_id: lr.presentacionId,
        presentacion_nombre: lr.presentacionNombre,
        presentacion_cantidad_base: lr.presentacionCantBase,
        cantidad_total_base: lr.cantidadTotalBase,
      };
    });
    const insItems = await sb.from("ventas_items").insert(itemsRows);
    if (insItems.error) throw new Error(insItems.error.message);

    // 7) Descuento de stock + movimientos solo para productos con controla_stock=true SIN receta.
    //    El decremento usa cantidad_total_base (cantidad de presentaciones * cantidad_base),
    //    no la cantidad cruda. Asi 1 caja de 1000 unidades resta 1000 del stock real.
    for (let i = 0; i < items.length; i++) {
      const line = items[i];
      const lr = lineResolved[i];
      const p = stockMap.get(line.producto_id)!;
      if (recetaByProducto.has(line.producto_id)) continue;
      if (!p.controlaStock && p.modo !== "produccion_previa") continue;
      const nuevoStock = Math.max(0, p.stock - lr.cantidadTotalBase);
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", line.producto_id)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      p.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        producto_id: line.producto_id,
        producto_nombre: line.producto_nombre,
        producto_sku: line.sku,
        tipo: "SALIDA",
        // El movimiento registra la cantidad real en unidades base que salio
        // del stock. La presentacion vendida se ve en ventas_items.
        cantidad: lr.cantidadTotalBase,
        costo_unitario: p.costo,
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.usuarioId ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 7b) Descontar materia prima (insumos) por explosión de receta + movimiento SALIDA por insumo.
    for (const [insId, need] of insumoNeed) {
      const m = insumoMeta.get(insId)!;
      // Igual que productos: el stock de insumos nunca baja de 0 (la salida real
      // queda registrada en el movimiento SALIDA del insumo).
      const nuevoStock = Math.max(0, m.stock - need);
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", insId)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      m.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        producto_id: insId,
        producto_nombre: m.nombre,
        producto_sku: m.sku,
        tipo: "SALIDA",
        cantidad: need,
        costo_unitario: m.costo,
        // origen restringido por CHECK a compra|venta|ajuste_manual|inventario_inicial.
        // El consumo de insumo lo causa una venta → 'venta' (se distingue por venta_id + producto insumo).
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.usuarioId ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 8) Pedido cocina (tarjeta en proyectos)
    if (params.pedidoCocina) {
      const tipoQ = await sb
        .from("proyecto_tipos")
        .select("id")
        .eq("empresa_id", params.empresaId)
        .eq("codigo", "pedido")
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (tipoQ.error) throw new Error(tipoQ.error.message);
      if (!tipoQ.data) throw new Error("Tipo de proyecto 'pedido' no configurado para esta empresa.");
      const tipoId = (tipoQ.data as { id: string }).id;

      const estadoQ = await sb
        .from("proyecto_estados")
        .select("id")
        .eq("empresa_id", params.empresaId)
        .eq("codigo", "nuevo")
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (estadoQ.error) throw new Error(estadoQ.error.message);
      if (!estadoQ.data) throw new Error("Estado 'nuevo' no configurado para esta empresa.");
      const estadoId = (estadoQ.data as { id: string }).id;

      const itemsSnapshot = items.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        sku: it.sku,
        cantidad: it.cantidad,
        precio_venta: it.precio_venta,
        total_linea: it.total_linea,
      }));
      const briefData = {
        modalidad: params.pedidoCocina.modalidad,
        mesa: params.pedidoCocina.mesa,
        cliente_nombre: params.pedidoCocina.cliente_nombre,
        cliente_telefono: params.pedidoCocina.cliente_telefono,
        direccion_entrega: params.pedidoCocina.direccion_entrega,
        observacion: params.pedidoCocina.observacion,
        items: itemsSnapshot,
        venta_id: ventaId,
        numero_control: numeroControl,
        fecha_iso: fechaIso,
      };
      const metadata = {
        source: "venta",
        venta_id: ventaId,
        numero_control: numeroControl,
        modalidad: params.pedidoCocina.modalidad,
      };
      const tituloModalidad =
        params.pedidoCocina.modalidad === "local" ? "Local"
        : params.pedidoCocina.modalidad === "delivery" ? "Delivery"
        : "Retiro";
      const detalle =
        params.pedidoCocina.modalidad === "local" && params.pedidoCocina.mesa
          ? ` · Mesa ${params.pedidoCocina.mesa}`
          : params.pedidoCocina.modalidad === "delivery" && params.pedidoCocina.cliente_nombre
          ? ` · ${params.pedidoCocina.cliente_nombre}`
          : "";
      const titulo = `Venta ${numeroControl} · ${tituloModalidad}${detalle}`.slice(0, 200);

      const insProy = await sb.from("proyectos").insert({
        empresa_id: params.empresaId,
        cliente_id: params.clienteId,
        tipo_id: tipoId,
        estado_id: estadoId,
        titulo,
        prioridad: "normal",
        monto_vendido: params.totalDeclarado,
        fecha_ingreso: fechaIso,
        brief_data: briefData,
        metadata,
      });
      if (insProy.error) throw new Error(insProy.error.message);
    }

    // 9) Cuenta por cobrar (solo CRÉDITO con cliente). El saldo inicial = total de la venta;
    //    estado 'pendiente'. NO afecta stock ni movimientos: es cobranza. Un índice único
    //    sobre venta_id impide CxC duplicada si la venta se reintentara.
    let cuentaPorCobrarId: string | null = null;
    if (params.tipoVenta === "CREDITO" && params.clienteId) {
      const fechaEmision = fechaIso.slice(0, 10);
      let fechaVencimiento: string | null = null;
      if (params.fechaVencimiento) {
        fechaVencimiento = params.fechaVencimiento;
      } else if (params.plazoDias && params.plazoDias > 0) {
        const d = new Date(fechaIso);
        d.setDate(d.getDate() + params.plazoDias);
        fechaVencimiento = d.toISOString().slice(0, 10);
      }
      const insCxc = await sb
        .from("cuentas_por_cobrar")
        .insert({
          empresa_id: params.empresaId,
          cliente_id: params.clienteId,
          venta_id: ventaId,
          numero_venta: numeroControl,
          fecha_emision: fechaEmision,
          fecha_vencimiento: fechaVencimiento,
          moneda: params.moneda === "USD" ? "USD" : "PYG",
          total: calc.total,
          saldo: calc.total,
          estado: "pendiente",
        })
        .select("id")
        .single();
      if (insCxc.error) throw new Error(insCxc.error.message);
      cuentaPorCobrarId = String((insCxc.data as { id: string }).id);
    }

    // ── Puente Venta → Factura ERP (SIFEN legal) ───────────────────────────
    // Cuando `emitirFactura===true` (el cajero eligió "Factura" y la empresa está
    // en modo 'sifen', validado en la ruta) creamos una factura ERP FAC-XXXXXX con
    // sus líneas y dejamos `ventas.factura_id` linkeado. Luego /facturas/[id] usa el
    // panel electrónico para generar el borrador SIFEN, firmar, enviar e imprimir KUDE.
    //
    // Best-effort aislado: si el puente falla, la venta YA está creada y NO se
    // revierte — se devuelve `facturaWarning` y la venta queda como ticket.
    //
    // Requisito fiscal: la factura ERP exige cliente (facturas.cliente_id es NOT NULL
    // y el payload SIFEN necesita receptor con RUC/razón social). Si la venta no tiene
    // cliente, se rechaza SOLO la emisión (no la venta) con un warning claro.
    let facturaId: string | null = null;
    let numeroFactura: string | null = null;
    let facturaWarning: string | null = null;
    if (params.emitirFactura === true) {
      if (!params.clienteId) {
        facturaWarning =
          "Venta registrada como ticket: para emitir factura electrónica hay que seleccionar un cliente (SIFEN requiere receptor).";
      } else {
        try {
          // 1) Snapshot de razón social / RUC del receptor. Prioridad:
          //    nombre_facturacion → empresa → nombre_contacto → nombre.
          let razonSocial: string | null = null;
          let rucSnap: string | null = null;
          const cliQ = await sb
            .from("clientes")
            .select("empresa, nombre, nombre_contacto, nombre_facturacion, ruc")
            .eq("id", params.clienteId)
            .eq("empresa_id", params.empresaId)
            .maybeSingle();
          const c = cliQ.data as Record<string, string | null> | null;
          if (c) {
            const s = (v: string | null | undefined) =>
              typeof v === "string" && v.trim() ? v.trim() : null;
            razonSocial =
              s(c.nombre_facturacion) || s(c.empresa) || s(c.nombre_contacto) || s(c.nombre);
            rucSnap = s(c.ruc);
          }

          // 2) Próximo número de factura con el helper canónico (RPC transaccional
          //    next_numero_factura_empresa + fallback). No se inventa numeración nueva.
          numeroFactura = await obtenerSiguienteNumeroFacturaEmpresa(sb, params.empresaId);

          // 3) Insert facturas. Solo columnas existentes en el schema ferrecolor
          //    + las aditivas del puente (cliente_razon_social/cliente_ruc/origen_venta_id).
          const fechaYmd = fechaIso.slice(0, 10);
          const facPayload: Record<string, unknown> = {
            empresa_id: params.empresaId,
            cliente_id: params.clienteId,
            numero_factura: numeroFactura,
            fecha: fechaYmd,
            fecha_vencimiento: fechaYmd,
            monto: calc.total,
            saldo: params.tipoVenta === "CREDITO" ? calc.total : 0,
            estado: params.tipoVenta === "CREDITO" ? "Pendiente" : "Pagado",
            tipo: params.tipoVenta === "CREDITO" ? "credito" : "contado",
            moneda: params.moneda === "USD" ? "USD" : "GS",
            cliente_razon_social: razonSocial,
            cliente_ruc: rucSnap,
            origen_venta_id: ventaId,
          };
          const insFac = await sb.from("facturas").insert(facPayload).select("id").single();
          if (insFac.error) throw new Error(insFac.error.message);
          facturaId = String((insFac.data as { id: string }).id);

          // 4) factura_items — una fila por línea. Los montos ya reflejan la tasa
          //    de IVA elegida (el builder SIFEN infiere la tasa desde subtotal/iva);
          //    tipo_iva se guarda además como dato consistente con ventas_items.
          const itemsFacRows = items.map((line) => ({
            empresa_id: params.empresaId,
            factura_id: facturaId,
            descripcion: line.producto_nombre,
            cantidad: line.cantidad,
            precio_unitario: line.precio_venta,
            subtotal: line.subtotal,
            iva: line.monto_iva,
            total: line.total_linea,
            tipo_iva: line.tipo_iva,
          }));
          const insFacItems = await sb.from("factura_items").insert(itemsFacRows);
          if (insFacItems.error) throw new Error(insFacItems.error.message);

          // 5) Link venta → factura.
          const linkUpd = await sb
            .from("ventas")
            .update({ factura_id: facturaId })
            .eq("id", ventaId)
            .eq("empresa_id", params.empresaId);
          if (linkUpd.error) throw new Error(linkUpd.error.message);
        } catch (bridgeErr) {
          const msg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
          facturaWarning = `Venta creada pero no se pudo generar la factura electrónica: ${msg}`;
          // Rollback best-effort de la factura (los items caen en cascada por FK).
          if (facturaId) {
            try {
              await sb.from("facturas").delete().eq("id", facturaId).eq("empresa_id", params.empresaId);
            } catch {}
          }
          facturaId = null;
          numeroFactura = null;
        }
      }
    }

    // Evaluar cruce de tramo de comision (best-effort, no rompe la venta).
    // Calcula ganancia leyendo los movimientos SALIDA reciennsertados.
    try {
      const movsQ = await sb
        .from("movimientos_inventario")
        .select("cantidad, costo_unitario")
        .eq("empresa_id", params.empresaId)
        .eq("venta_id", ventaId)
        .eq("tipo", "SALIDA");
      const costoVenta = (movsQ.data ?? []).reduce(
        (s, m) => s + (Number((m as { cantidad: number }).cantidad) || 0) * (Number((m as { costo_unitario: number }).costo_unitario) || 0),
        0
      );
      const gananciaVenta = calc.total - costoVenta;
      const vendedor = (params.usuarioNombre?.trim() as string) || "";
      if (vendedor && gananciaVenta > 0) {
        const { evaluarCruceTramoComision } = await import("@/lib/notificaciones/comisiones");
        const { fetchDataSchemaForEmpresaId } = await import("@/lib/supabase/empresa-data-schema");
        const schema = await fetchDataSchemaForEmpresaId(params.empresaId);
        void evaluarCruceTramoComision(schema, params.empresaId, vendedor, gananciaVenta).catch(() => {});
      }
    } catch { /* silencioso */ }

    return {
      ventaId,
      numeroControl,
      fechaIso,
      notaRemisionNumero,
      cuentaPorCobrarId,
      facturaId,
      numeroFactura,
      facturaWarning,
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}
