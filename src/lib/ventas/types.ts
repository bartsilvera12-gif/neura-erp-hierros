export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
export type MetodoPago  = "efectivo" | "tarjeta" | "transferencia" | "mixto";
/** Nivel de precio elegido para la línea de venta.
 *  'costo' se conserva SOLO como histórico (ventas viejas); ya no se ofrece en la UI. */
export type TipoPrecioVenta = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  /** Cantidad en la PRESENTACION elegida (ej. 2 = 2 cajas o 10 unidades). */
  cantidad:              number;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS, POR PRESENTACION
  tipo_iva:              TipoIvaVenta;
  /** Nivel de precio aplicado: minorista (precio_venta) | mayorista (precio_mayorista) | costo (costo_promedio). */
  tipo_precio?:          TipoPrecioVenta;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
  /**
   * Presentacion de venta elegida (Caja, Paquete, etc). Opcional para mantener
   * compatibilidad con flujos antiguos. Cuando viene, el backend descuenta
   * `cantidad * presentacion.cantidad_base` del stock. Cuando NO viene, usa
   * la default activa del producto (efecto: igual que antes).
   */
  presentacion_id?:           string | null;
  presentacion_nombre?:       string | null;
  presentacion_cantidad_base?: number | null;
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  metodo_pago?: MetodoPago;  // En lo de Mari: efectivo/tarjeta/transferencia

  /** La venta emite nota de remisión (documento no fiscal). */
  genera_nota_remision?: boolean;
  /** Número de nota de remisión (NR-XXXXXX) si genera_nota_remision. */
  nota_remision_numero?: string | null;

  fecha: string;             // ISO string, generado automáticamente

  /** Nombre del usuario que registró la venta (auditoría). */
  usuario_nombre?: string | null;

  /** Factura ERP linkeada por el puente venta→factura (SIFEN). NULL si fue solo ticket. */
  factura_id?: string | null;
  /** Número de la factura ERP (FAC-XXXXXX) si `factura_id` está seteado. */
  numero_factura?: string | null;
  /** Estado SIFEN de la factura electrónica (borrador, firmado, aprobado, …) si existe. */
  factura_estado_sifen?: string | null;

  /** Estado de la venta. anulada queda para auditoría pero no suma en reportes. */
  estado?: "activa" | "anulada" | "parcialmente_devuelta" | "devuelta_total";
  anulada_at?: string | null;
  anulada_motivo?: string | null;
}
