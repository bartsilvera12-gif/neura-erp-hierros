/**
 * Membrete (encabezado) común para todos los documentos imprimibles del ERP.
 * Devuelve HTML con estilos inline para no depender del CSS de cada endpoint
 * (evita duplicar el markup del encabezado en cada documento).
 *
 * SOLO presentación: no toca datos de negocio. Los datos comerciales son fijos
 * de la empresa (Ferretería República).
 *
 * TODO: confirmar datos comerciales reales (razón social, actividad SIFEN,
 * teléfono y dirección) con el equipo. Los valores actuales son placeholders.
 */

export const EMPRESA_DOC = {
  nombre: "HIERROS VH",
  actividad: [
    "Venta de hierros, caños, chapas, varillas y perfiles",
  ],
  telefono: "0992 558 631",
  direccion: ["Villa Hayes · Paraguay"],
  /** Logo del cliente (alta calidad, sin fondo). Servido desde /public. */
  logoUrl: "/brand/hierros-logo.png",
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete A4: logo a la izquierda, datos comerciales a la derecha, línea divisoria.
 * `origin` opcional para URL absoluta del logo (útil al imprimir/guardar PDF).
 */
export function membreteA4(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = origin ? `${origin}${e.logoUrl}` : e.logoUrl;
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #2E7D32;padding-bottom:12px;margin-bottom:16px;">
    <div style="flex:0 0 auto;">
      <img src="${esc(logo)}" alt="${esc(e.nombre)}" onerror="this.style.display='none'" style="max-width:180px;max-height:92px;width:auto;height:auto;object-fit:contain;display:block;" />
    </div>
    <div style="flex:1;min-width:0;text-align:right;font-size:11px;color:#374151;line-height:1.55;">
      <div style="font-size:14px;font-weight:800;color:#1f2937;">${esc(e.nombre)}</div>
      ${e.actividad.map((a) => `<div style="color:#6b7280;">${esc(a)}</div>`).join("")}
      <div style="margin-top:4px;"><strong>Tel:</strong> ${esc(e.telefono)}</div>
      <div>${e.direccion.map(esc).join(" · ")}</div>
    </div>
  </div>`;
}

/**
 * Membrete compacto para ticket angosto (58/80mm): logo arriba, datos centrados.
 */
export function membreteTicket(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = origin ? `${origin}${e.logoUrl}` : e.logoUrl;
  return `
  <div style="text-align:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px dashed #000;">
    <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:150px;max-height:72px;width:auto;height:auto;object-fit:contain;display:inline-block;margin:0 auto 4px;" />
    <div style="font-weight:700;font-size:12px;">${esc(e.nombre)}</div>
    <div style="font-size:10px;">Tel: ${esc(e.telefono)}</div>
    <div style="font-size:10px;">${esc(e.direccion[0])}</div>
    <div style="font-size:10px;">${esc(e.direccion.slice(1).join(" · "))}</div>
  </div>`;
}
