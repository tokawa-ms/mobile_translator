import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from "@azure/msal-react";
import { Outlet, Link, useMatch } from "react-router-dom";
import { apiScopes, isMobile } from "./auth";

export default function App() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const isSessionDetail = useMatch("/sessions/:id") !== null;

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/sessions" className="brand">Mobile Translator</Link>
        <div className="user">
          <AuthenticatedTemplate>
            <span>{account?.name ?? account?.username}</span>
            <button onClick={() =>
              isMobile ? instance.logoutRedirect() : instance.logoutPopup()
            }>Sign out</button>
          </AuthenticatedTemplate>
          <UnauthenticatedTemplate>
            <button onClick={() =>
              isMobile
                ? instance.loginRedirect({ scopes: apiScopes })
                : instance.loginPopup({ scopes: apiScopes })
            }>Sign in</button>
          </UnauthenticatedTemplate>
        </div>
      </header>
      <main className={`app-main ${isSessionDetail ? "app-main--wide" : ""}`}>
        <AuthenticatedTemplate>
          <Outlet />
        </AuthenticatedTemplate>
        <UnauthenticatedTemplate>
          <p>サインインしてください。</p>
        </UnauthenticatedTemplate>
      </main>
    </div>
  );
}
