import { Inbox } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { InboxContent } from "../components/InboxContent";
import { PageHeader } from "../components/PageHeader";
import { PageHero } from "../components/PageHero";
import { useInboxContext } from "../contexts/InboxContext";
import { useProjects } from "../hooks/useProjects";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";

/**
 * Global inbox page with project filter dropdown.
 * Shows sessions from all projects (or filtered to one) that need attention.
 */
export function InboxPage() {
  const { t } = useI18n();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { projects } = useProjects();
  const { needsAttention, active, recentActivity, unread8h, unread24h } =
    useInboxContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const projectId = searchParams.get("project") ?? undefined;

  const handleProjectChange = useCallback(
    (newProjectId: string | undefined) => {
      if (newProjectId) {
        setSearchParams({ project: newProjectId });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams],
  );

  // Find project name for header when filtered
  const projectName = useMemo(() => {
    if (!projectId) return undefined;
    return projects.find((p) => p.id === projectId)?.name;
  }, [projectId, projects]);

  const filteredCount = (items: { projectId: string }[]) =>
    projectId
      ? items.filter((item) => item.projectId === projectId).length
      : items.length;
  const attentionCount = filteredCount(needsAttention);
  const activeCount = filteredCount(active);
  const unreadCount = filteredCount(unread8h) + filteredCount(unread24h);
  const totalCount =
    attentionCount + activeCount + filteredCount(recentActivity) + unreadCount;

  return (
    <div
      className={isWideScreen ? "main-content-wrapper" : "main-content-mobile"}
    >
      <div
        className={
          isWideScreen
            ? "main-content-constrained"
            : "main-content-mobile-inner"
        }
      >
        <PageHeader
          title={
            projectName
              ? t("inboxTitleWithProject", { project: projectName })
              : t("inboxTitle")
          }
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner inbox-content">
            <PageHero
              title={t("inboxTitle")}
              icon={<Inbox size={22} strokeWidth={2} aria-hidden="true" />}
              metrics={[
                {
                  label: t("pageHeroInboxAttention"),
                  value: attentionCount,
                  tone: attentionCount > 0 ? "warning" : "default",
                },
                {
                  label: t("pageHeroInboxActive"),
                  value: activeCount,
                  tone: activeCount > 0 ? "success" : "default",
                },
                {
                  label: t("pageHeroInboxUnread"),
                  value: unreadCount,
                  tone: unreadCount > 0 ? "brand" : "default",
                },
                {
                  label: t("pageHeroInboxTotal"),
                  value: totalCount,
                },
              ]}
            />
            <InboxContent
              projectId={projectId}
              projects={projects}
              onProjectChange={handleProjectChange}
              embedded
            />
          </div>
        </main>
      </div>
    </div>
  );
}
