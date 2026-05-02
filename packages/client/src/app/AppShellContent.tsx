import type { ReactNode } from "react";
import { ConnectionBar } from "../components/ConnectionBar";
import { FloatingActionButton } from "../components/FloatingActionButton";
import { ReloadBanner } from "../components/ReloadBanner";
import { useReloadNotifications } from "../hooks/useReloadNotifications";

interface AppShellContentProps {
  children: ReactNode;
  showConnectionBar?: boolean;
}

export function AppShellContent({
  children,
  showConnectionBar = true,
}: AppShellContentProps) {
  const {
    isManualReloadMode,
    pendingReloads,
    reloadBackend,
    reloadFrontend,
    dismiss,
    unsafeToRestart,
    workerActivity,
  } = useReloadNotifications();

  return (
    <>
      {showConnectionBar && <ConnectionBar />}
      {isManualReloadMode && pendingReloads.backend && (
        <ReloadBanner
          target="backend"
          onReload={reloadBackend}
          onDismiss={() => dismiss("backend")}
          unsafeToRestart={unsafeToRestart}
          activeWorkers={workerActivity.activeWorkers}
        />
      )}
      {isManualReloadMode && pendingReloads.frontend && (
        <ReloadBanner
          target="frontend"
          onReload={reloadFrontend}
          onDismiss={() => dismiss("frontend")}
        />
      )}
      {children}
      <FloatingActionButton />
    </>
  );
}
