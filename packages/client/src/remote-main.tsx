/**
 * Remote client entry point.
 *
 * This is a separate entry point for the remote (static) client that:
 * - Uses SecureConnection for all communication (SRP + NaCl encryption)
 * - Shows a login page before connecting
 * - Does NOT use cookie-based auth (uses SRP instead)
 *
 * Route structure:
 * - UnauthenticatedGate: wraps login routes, redirects to app if already connected
 * - ConnectionGate: wraps direct-mode app routes (no relay username in URL)
 * - RelayConnectionGate: wraps relay-mode app routes (/:relayUsername/...)
 *
 * ConnectionGate and RelayConnectionGate share the same APP_ROUTES.
 * This avoids duplicating route definitions or provider wrapping.
 */

console.log("[RemoteClient] Loading remote-main.tsx entry point");

import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Toggle to disable StrictMode for easier debugging (avoids double renders)
const STRICT_MODE = false;
const Wrapper = STRICT_MODE ? StrictMode : Fragment;

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ConnectionGate, RemoteApp, UnauthenticatedGate } from "./RemoteApp";
import { initializeFontSize } from "./hooks/useFontSize";
import { initializeTabSize } from "./hooks/useTabSize";
import { initializeTheme } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { DirectLoginPage } from "./pages/DirectLoginPage";
import { HostPickerPage } from "./pages/HostPickerPage";
import { RelayConnectionGate } from "./pages/RelayConnectionGate";
import { RelayLoginPage } from "./pages/RelayLoginPage";
import { createAppRoutes } from "./routes/appRoutes";
import "./styles/index.css";

// Apply saved preferences before React renders to avoid flash
initializeTheme();
initializeFontSize();
initializeTabSize();

// Get base URL for router (Vite sets this based on --base flag)
// Remove trailing slash for BrowserRouter basename
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

const APP_ROUTES = createAppRoutes({ includeCatchAll: true });

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <Wrapper>
    <BrowserRouter basename={basename}>
      <I18nProvider>
        <RemoteApp>
          <Routes>
            {/* Login routes — redirect to app if already connected */}
            <Route element={<UnauthenticatedGate />}>
              <Route path="/login" element={<HostPickerPage />} />
              <Route path="/login/direct" element={<DirectLoginPage />} />
              <Route path="/login/relay" element={<RelayLoginPage />} />
            </Route>

            {/* Direct mode — requires connection, no relay username in URL */}
            <Route element={<ConnectionGate />}>{APP_ROUTES}</Route>

            {/* Relay mode — manages relay connection by URL username.
                React Router ranks static segments above dynamic params,
                so /projects matches ConnectionGate, not /:relayUsername. */}
            <Route path="/:relayUsername" element={<RelayConnectionGate />}>
              {APP_ROUTES}
            </Route>
          </Routes>
        </RemoteApp>
      </I18nProvider>
    </BrowserRouter>
  </Wrapper>,
);
