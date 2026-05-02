import { useI18n } from "../../i18n";

interface SessionWarningsProps {
  isExternal: boolean;
  hasPendingToolCalls: boolean;
}

export function SessionWarnings({
  isExternal,
  hasPendingToolCalls,
}: SessionWarningsProps) {
  const { t } = useI18n();

  return (
    <>
      {isExternal && (
        <div className="external-session-warning">
          {t("sessionExternalWarning")}
        </div>
      )}
      {hasPendingToolCalls ? (
        <div className="external-session-warning pending-tool-warning">
          {t("sessionPendingElsewhereWarning")}
        </div>
      ) : null}
    </>
  );
}
