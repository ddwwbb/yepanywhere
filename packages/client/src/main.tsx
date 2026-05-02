import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Toggle to disable StrictMode for easier debugging (avoids double renders)
const STRICT_MODE = false;
const Wrapper = STRICT_MODE ? StrictMode : Fragment;
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeFontSize } from "./hooks/useFontSize";
import { initializeTabSize } from "./hooks/useTabSize";
import { initializeTheme } from "./hooks/useTheme";
import { LoginPage } from "./pages/LoginPage";
import { createAppRoutes } from "./routes/appRoutes";
import "./styles/index.css";

// Apply saved preferences before React renders to avoid flash
initializeTheme();
initializeFontSize();
initializeTabSize();

// SSE activity stream connection is managed by useActivityBusConnection hook
// in App.tsx, which connects only when authenticated (or auth is disabled)

// Get base URL for router (Vite sets this based on --base flag)
// Remove trailing slash for BrowserRouter basename
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <Wrapper>
    <ErrorBoundary>
      <BrowserRouter basename={basename}>
        <App>
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/login" element={<LoginPage />} />
            {createAppRoutes({
              includeRootRedirect: false,
              projectRedirectTo: "/sessions",
            })}
          </Routes>
        </App>
      </BrowserRouter>
    </ErrorBoundary>
  </Wrapper>,
);
