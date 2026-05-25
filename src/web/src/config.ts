export interface RuntimeConfig {
  tenantId: string;
  clientId: string;
  apiScope: string;
  apiBaseUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

const fallback: RuntimeConfig = {
  tenantId: import.meta.env.VITE_TENANT_ID ?? "",
  clientId: import.meta.env.VITE_CLIENT_ID ?? "",
  apiScope: import.meta.env.VITE_API_SCOPE ?? "",
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
};

export const config: RuntimeConfig = window.__APP_CONFIG__ ?? fallback;
