import type { ComponentType, ReactNode } from "react";
import { InboxProvider } from "../contexts/InboxContext";
import { SchemaValidationProvider } from "../contexts/SchemaValidationContext";
import { ToastProvider } from "../contexts/ToastContext";

interface AccessProviderProps {
  children: ReactNode;
}

interface AppProvidersProps {
  AccessProvider: ComponentType<AccessProviderProps>;
  children: ReactNode;
}

export function AppProviders({ AccessProvider, children }: AppProvidersProps) {
  return (
    <ToastProvider>
      <AccessProvider>
        <InboxProvider>
          <SchemaValidationProvider>{children}</SchemaValidationProvider>
        </InboxProvider>
      </AccessProvider>
    </ToastProvider>
  );
}
