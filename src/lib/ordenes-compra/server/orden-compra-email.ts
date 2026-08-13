/**
 * Correo de confirmación de Orden de Compra. Se envía SOLO cuando la OC se creó
 * correctamente (best-effort: si el SMTP no está configurado o falla, no rompe
 * la creación de la OC). Destinatario y remitente configurables por env.
 */
import { sendMail, EMAIL_FROM_DEFAULT, type SendMailResult } from "@/lib/email/mailer";
import type { OrdenCompraRow } from "./ordenes-compra-pg";

const DEST_DEFAULT = "info@ferreteriarepublica.com.py";

function gs(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return `Gs. ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString("es-PY")}`;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function buildHtml(rows: OrdenCompraRow[]): { subject: string; html: string } {
  const cab = rows[0];
  const total = rows.reduce((s, r) => s + num(r.total), 0);
  const fecha = (() => {
    try {
      const d = new Date(cab.fecha);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    } catch { return cab.fecha; }
  })();

  const filas = rows.map((r) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(r.producto_nombre)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${num(r.cantidad).toLocaleString("es-PY")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${gs(r.costo_unitario)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${gs(r.total)}</td>
    </tr>`).join("");

  const subject = `Orden de compra ${cab.numero_oc} — ${cab.proveedor_nombre || "Proveedor"}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:640px;margin:0 auto">
    <h2 style="color:#3F8E91;margin:0 0 4px">Orden de compra ${esc(cab.numero_oc)}</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">HIERROS VH · generada desde el ERP</p>
    <table style="width:100%;font-size:14px;margin-bottom:16px">
      <tr><td style="padding:2px 0;color:#64748b">Proveedor</td><td style="padding:2px 0;text-align:right;font-weight:bold">${esc(cab.proveedor_nombre || "—")}</td></tr>
      <tr><td style="padding:2px 0;color:#64748b">Fecha</td><td style="padding:2px 0;text-align:right">${esc(fecha)}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#E5F4F4;color:#3F8E91">
          <th style="padding:8px 10px;text-align:left">Producto</th>
          <th style="padding:8px 10px;text-align:right">Cantidad</th>
          <th style="padding:8px 10px;text-align:right">Precio unit.</th>
          <th style="padding:8px 10px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="text-align:right;font-size:16px;margin:16px 0 0"><strong>Total estimado: ${gs(total)}</strong></p>
  </div>`;
  return { subject, html };
}

/** Envía la confirmación de una OC recién creada. Nunca lanza. */
export async function enviarConfirmacionOrdenCompra(rows: OrdenCompraRow[]): Promise<SendMailResult> {
  if (rows.length === 0) return { ok: false, error: "OC sin líneas." };
  const { subject, html } = buildHtml(rows);
  const to = (process.env.OC_EMAIL_TO ?? "").trim() || DEST_DEFAULT;
  const from = (process.env.SMTP_FROM ?? "").trim() || EMAIL_FROM_DEFAULT;
  return sendMail({ to, from, subject, html });
}
