import type { ReactNode } from "react";

export interface PageHeroMetric {
  label: string;
  value: ReactNode;
  tone?: "default" | "brand" | "success" | "warning" | "danger";
}

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  metrics?: PageHeroMetric[];
  actions?: ReactNode;
  compact?: boolean;
}

export function PageHero({
  eyebrow,
  title,
  description,
  icon,
  metrics,
  actions,
  compact = false,
}: PageHeroProps) {
  return (
    <section className={`page-hero ${compact ? "page-hero--compact" : ""}`}>
      <div className="page-hero__main">
        {icon && <div className="page-hero__icon">{icon}</div>}
        <div className="page-hero__copy">
          {eyebrow && <span className="page-hero__eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>

      {actions && <div className="page-hero__actions">{actions}</div>}

      {metrics && metrics.length > 0 && (
        <div className="page-hero__metrics">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={`page-hero__metric page-hero__metric--${metric.tone ?? "default"}`}
            >
              <span className="page-hero__metric-value">{metric.value}</span>
              <span className="page-hero__metric-label">{metric.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
