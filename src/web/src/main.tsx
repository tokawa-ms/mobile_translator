import React from "react";
import ReactDOM from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { msalInstance } from "./auth";
import App from "./App";
import { SessionList } from "./pages/SessionList";
import { SessionView } from "./pages/SessionView";
import "./styles.css";

async function bootstrap() {
  await msalInstance.initialize();
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0]);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />}>
              <Route index element={<Navigate to="/sessions" replace />} />
              <Route path="sessions" element={<SessionList />} />
              <Route path="sessions/:id" element={<SessionView />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MsalProvider>
    </React.StrictMode>,
  );
}

bootstrap().catch(err => {
  console.error("Failed to start app", err);
});
