import { type ReactNode, Suspense, lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import { NavigationLayout } from "../layouts";

const ActivityPage = lazy(() =>
  import("../pages/ActivityPage").then(({ ActivityPage }) => ({
    default: ActivityPage,
  })),
);
const AgentsPage = lazy(() =>
  import("../pages/AgentsPage").then(({ AgentsPage }) => ({
    default: AgentsPage,
  })),
);
const BridgePage = lazy(() =>
  import("../pages/BridgePage").then(({ BridgePage }) => ({
    default: BridgePage,
  })),
);
const EmulatorPage = lazy(() =>
  import("../pages/EmulatorPage").then(({ EmulatorPage }) => ({
    default: EmulatorPage,
  })),
);
const FilePage = lazy(() =>
  import("../pages/FilePage").then(({ FilePage }) => ({
    default: FilePage,
  })),
);
const GitStatusPage = lazy(() =>
  import("../pages/GitStatusPage").then(({ GitStatusPage }) => ({
    default: GitStatusPage,
  })),
);
const GlobalSessionsPage = lazy(() =>
  import("../pages/GlobalSessionsPage").then(({ GlobalSessionsPage }) => ({
    default: GlobalSessionsPage,
  })),
);
const InboxPage = lazy(() =>
  import("../pages/InboxPage").then(({ InboxPage }) => ({
    default: InboxPage,
  })),
);
const NewSessionPage = lazy(() =>
  import("../pages/NewSessionPage").then(({ NewSessionPage }) => ({
    default: NewSessionPage,
  })),
);
const ProjectsPage = lazy(() =>
  import("../pages/ProjectsPage").then(({ ProjectsPage }) => ({
    default: ProjectsPage,
  })),
);
const SessionPage = lazy(() =>
  import("../pages/SessionPage").then(({ SessionPage }) => ({
    default: SessionPage,
  })),
);
const SettingsLayout = lazy(() =>
  import("../pages/settings").then(({ SettingsLayout }) => ({
    default: SettingsLayout,
  })),
);

interface AppRoutesOptions {
  includeRootRedirect?: boolean;
  includeCatchAll?: boolean;
  projectRedirectTo?: string;
}

function routeElement(element: ReactNode): ReactNode {
  return (
    <Suspense fallback={<div className="loading" aria-busy="true" />}>
      {element}
    </Suspense>
  );
}

export function createAppRoutes({
  includeRootRedirect = true,
  includeCatchAll = false,
  projectRedirectTo = "../sessions",
}: AppRoutesOptions = {}): ReactNode {
  return (
    <>
      {includeRootRedirect && (
        <Route index element={<Navigate to="projects" replace />} />
      )}
      <Route element={<NavigationLayout />}>
        <Route path="projects" element={routeElement(<ProjectsPage />)} />
        <Route path="sessions" element={routeElement(<GlobalSessionsPage />)} />
        <Route path="agents" element={routeElement(<AgentsPage />)} />
        <Route path="inbox" element={routeElement(<InboxPage />)} />
        <Route path="settings" element={routeElement(<SettingsLayout />)} />
        <Route
          path="settings/:category"
          element={routeElement(<SettingsLayout />)}
        />
        <Route path="bridge" element={routeElement(<BridgePage />)} />
        <Route
          path="projects/:projectId"
          element={<Navigate to={projectRedirectTo} replace />}
        />
        <Route path="git-status" element={routeElement(<GitStatusPage />)} />
        <Route path="devices" element={routeElement(<EmulatorPage />)} />
        <Route
          path="devices/:deviceId"
          element={routeElement(<EmulatorPage />)}
        />
        <Route path="new-session" element={routeElement(<NewSessionPage />)} />
        <Route
          path="projects/:projectId/sessions/:sessionId"
          element={routeElement(<SessionPage />)}
        />
      </Route>
      <Route
        path="projects/:projectId/file"
        element={routeElement(<FilePage />)}
      />
      <Route path="activity" element={routeElement(<ActivityPage />)} />
      {includeCatchAll && (
        <Route path="*" element={<Navigate to="../projects" replace />} />
      )}
    </>
  );
}
