import { PublicClientApplication, type Configuration } from "@azure/msal-browser";
import { config } from "./config";

const msalConfig: Configuration = {
  auth: {
    clientId: config.clientId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const apiScopes = [`${config.apiScope}`];

/** モバイルブラウザかどうかを判定 */
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function getAuthContextClaims(): string | undefined {
  const authContextId = config.passkeyAuthContextId?.trim();
  if (!authContextId) return undefined;

  // Entra の Authentication Context を指定し、ポリシー側でパスキー許可ルールに誘導する。
  return JSON.stringify({
    id_token: { acrs: { essential: true, values: [authContextId] } },
    access_token: { acrs: { essential: true, values: [authContextId] } },
  });
}

export function buildInteractiveLoginRequest() {
  const claims = getAuthContextClaims();
  return {
    scopes: apiScopes,
    // モバイルで手段選択 UI を出しやすくして、パスキー選択へ誘導する。
    ...(isMobile ? { prompt: "select_account" as const } : {}),
    ...(claims ? { claims } : {}),
  };
}

export async function getApiToken(): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in");
  const claims = getAuthContextClaims();
  try {
    const result = await msalInstance.acquireTokenSilent({
      account,
      scopes: apiScopes,
      ...(claims ? { claims } : {}),
    });
    return result.accessToken;
  } catch {
    if (isMobile) {
      // モバイルではリダイレクトフローを使用（ポップアップはブロックされやすい）
      await msalInstance.acquireTokenRedirect({
        scopes: apiScopes,
        ...(claims ? { claims } : {}),
      });
      throw new Error("Redirecting for token acquisition");
    }
    const result = await msalInstance.acquireTokenPopup({
      scopes: apiScopes,
      ...(claims ? { claims } : {}),
    });
    return result.accessToken;
  }
}
