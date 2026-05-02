import { useI18n } from "../../i18n";

interface GlobalSessionsEmptyStateProps {
  hasFilters: boolean;
}

export function GlobalSessionsEmptyState({
  hasFilters,
}: GlobalSessionsEmptyStateProps) {
  const { t } = useI18n();

  return (
    <div className="inbox-empty">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <h3>{t("globalSessionsNoResultsTitle")}</h3>
      <p>
        {hasFilters
          ? t("globalSessionsNoResultsFiltered")
          : t("globalSessionsNoResultsEmpty")}
      </p>
    </div>
  );
}
