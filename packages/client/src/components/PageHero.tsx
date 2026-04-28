import type { ReactNode } from "react";

export interface PageHeroMetric {
  label: string;
  value: ReactNode;
  tone?: "default" | "brand" | "success" | "warning" | "danger";
  icon?: ReactNode;
}

interface PageHeroProps {
  title: string;
  icon?: ReactNode;
  metrics?: PageHeroMetric[];
  actions?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}

export function PageHero({
  title,
  icon,
  metrics,
  actions,
  children,
  compact = false,
}: PageHeroProps) {
  return (
    <section className={`page-hero ${compact ? "page-hero--compact" : ""}`}>
      <div className="page-hero__backdrop" aria-hidden="true">
        <div className="page-hero__glow" />
        <div className="page-hero__pattern" />
      </div>

      <div className="page-hero__container">
        <div className="page-hero__header">
          <div className="page-hero__main">
            {icon && <div className="page-hero__icon">{icon}</div>}
            <div className="page-hero__copy">
              <h1>{title}</h1>
            </div>
          </div>

          {actions && <div className="page-hero__actions">{actions}</div>}
        </div>

        {children && <div className="page-hero__extra">{children}</div>}

        {metrics && metrics.length > 0 && (
          <div className="page-hero__metrics">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className={`page-hero__metric page-hero__metric--${metric.tone ?? "default"}`}
              >
                {metric.icon && (
                  <div className="page-hero__metric-icon">{metric.icon}</div>
                )}
                <div className="page-hero__metric-body">
                  <span className="page-hero__metric-value">
                    {metric.value}
                  </span>
                  <span className="page-hero__metric-label">
                    {metric.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
