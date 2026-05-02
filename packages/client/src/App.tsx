import { type ReactNode, useEffect } from "react";
import { AppProviders } from "./app/AppProviders";
import { AppShellContent } from "./app/AppShellContent";
import { OnboardingWizard } from "./components/onboarding";
import { AuthProvider } from "./contexts/AuthContext";
import { useActivityBusConnection } from "./hooks/useActivityBusConnection";
import { useNeedsAttentionBadge } from "./hooks/useNeedsAttentionBadge";
import { useSyncNotifyInAppSetting } from "./hooks/useNotifyInApp";
import { useOnboarding } from "./hooks/useOnboarding";
import { I18nProvider } from "./i18n";
import { initClientLogCollection } from "./lib/diagnostics";

interface Props {
  children: ReactNode;
}

/**
 * Inner component that uses hooks requiring InboxContext.
 */
function AppContent({ children }: Props) {
  // Manage SSE connection based on auth state (prevents 401s on login page)
  useActivityBusConnection();

  // Client-side log collection for connection diagnostics
  useEffect(() => initClientLogCollection(), []);

  // Sync notifyInApp setting to service worker on app startup and SW restarts
  useSyncNotifyInAppSetting();

  // Update tab title with needs-attention badge count (uses InboxContext)
  useNeedsAttentionBadge();

  return <AppShellContent>{children}</AppShellContent>;
}

/**
 * App wrapper that provides global functionality like reload notifications, toasts,
 * and schema validation.
 */
export function App({ children }: Props) {
  const { showWizard, isLoading, completeOnboarding } = useOnboarding();

  return (
    <I18nProvider>
      <AppProviders AccessProvider={AuthProvider}>
        <AppContent>{children}</AppContent>
        {!isLoading && showWizard && (
          <OnboardingWizard onComplete={completeOnboarding} />
        )}
      </AppProviders>
    </I18nProvider>
  );
}
