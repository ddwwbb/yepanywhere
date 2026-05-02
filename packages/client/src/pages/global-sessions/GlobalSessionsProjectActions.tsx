import { GitBranch, Plus } from "lucide-react";
import { useI18n } from "../../i18n";

interface GlobalSessionsProjectActionsProps {
  onOpenGitStatus: () => void;
  onStartNewSession: () => void;
}

export function GlobalSessionsProjectActions({
  onOpenGitStatus,
  onStartNewSession,
}: GlobalSessionsProjectActionsProps) {
  const { t } = useI18n();

  return (
    <div className="project-card__actions global-sessions-project-actions">
      <button
        type="button"
        className="project-card__action-btn project-card__action-btn--git"
        onClick={onOpenGitStatus}
        title={t("sidebarSourceControl")}
      >
        <GitBranch size={15} strokeWidth={2} aria-hidden="true" />
        <span className="project-card__new-session-label">Git</span>
      </button>
      <button
        type="button"
        className="project-card__action-btn project-card__action-btn--new"
        onClick={onStartNewSession}
        title={t("newSessionTitle")}
      >
        <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
        <span className="project-card__new-session-label">
          {t("projectCardNewSession")}
        </span>
      </button>
    </div>
  );
}
