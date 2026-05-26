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

export async function getApiToken(): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in");
  try {
    const result = await msalInstance.acquireTokenSilent({ account, scopes: apiScopes });
    return result.accessToken;
  } catch {
    if (isMobile) {
      // モバイルではリダイレクトフローを使用（ポップアップはブロックされやすい）
      await msalInstance.acquireTokenRedirect({ scopes: apiScopes });
      throw new Error("Redirecting for token acquisition");
    }
    const result = await msalInstance.acquireTokenPopup({ scopes: apiScopes });
    return result.accessToken;
  }
}
