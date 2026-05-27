export interface RuntimeConfig {
  tenantId: string;
  clientId: string;
  apiScope: string;
  apiBaseUrl: string;
  passkeyAuthContextId?: string;
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
  passkeyAuthContextId: import.meta.env.VITE_PASSKEY_AUTH_CONTEXT_ID ?? "",
};

export const config: RuntimeConfig = window.__APP_CONFIG__ ?? fallback;
