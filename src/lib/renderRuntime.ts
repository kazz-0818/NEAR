import { getEnv } from "../config/env.js";

/** Render が Web サービスに注入する既定変数（スキーマには載せず process.env を直接参照） */
export type RenderRuntimeInfo = {
  on_render: boolean;
  external_url: string | null;
  service_id: string | null;
  /** このサービスの Render 管理画面（ブラウザ用） */
  dashboard_url: string | null;
};

export function getRenderRuntimeInfo(): RenderRuntimeInfo {
  const external = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, "") ?? "";
  const serviceId = process.env.RENDER_SERVICE_ID?.trim() ?? "";
  const onRender = process.env.RENDER === "true" || Boolean(external || serviceId);
  const dashboardUrl =
    serviceId.length > 0 ? `https://dashboard.render.com/web/${serviceId}` : null;
  return {
    on_render: onRender,
    external_url: external.length > 0 ? external : null,
    service_id: serviceId.length > 0 ? serviceId : null,
    dashboard_url: dashboardUrl,
  };
}

/**
 * 通知・管理 API リンク用の本番ベース URL。
 * `PUBLIC_BASE_URL` が無いとき Render 上では `RENDER_EXTERNAL_URL` を使う（手動で二重設定しなくてよい）。
 */
export function getEffectivePublicBaseUrl(): string | undefined {
  try {
    const configured = getEnv().PUBLIC_BASE_URL?.trim();
    if (configured) return configured.replace(/\/$/, "");
  } catch {
    /* getEnv 未初期化時は下へ */
  }
  const r = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, "");
  return r || undefined;
}

export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
