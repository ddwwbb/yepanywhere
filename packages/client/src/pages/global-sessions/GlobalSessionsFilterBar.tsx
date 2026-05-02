import type { ProviderName } from "@yep-anywhere/shared";
import type { FormEvent } from "react";
import {
  FilterDropdown,
  type FilterOption,
} from "../../components/FilterDropdown";
import { useI18n } from "../../i18n";
import type { AgeFilter, StatusFilter } from "./sessionFilters";

interface GlobalSessionsFilterBarProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  projectOptions: FilterOption<string>[];
  projectFilter?: string;
  onProjectFilterChange: (selected: string[]) => void;
  statusOptions: FilterOption<StatusFilter>[];
  statusFilters: StatusFilter[];
  onStatusFiltersChange: (filters: StatusFilter[]) => void;
  providerOptions: FilterOption<ProviderName>[];
  providerFilters: ProviderName[];
  onProviderFiltersChange: (filters: ProviderName[]) => void;
  executorOptions: FilterOption<string>[];
  executorFilters: string[];
  onExecutorFiltersChange: (filters: string[]) => void;
  ageOptions: FilterOption<AgeFilter>[];
  ageFilter?: AgeFilter;
  onAgeFilterChange: (selected: AgeFilter[]) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function GlobalSessionsFilterBar({
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  projectOptions,
  projectFilter,
  onProjectFilterChange,
  statusOptions,
  statusFilters,
  onStatusFiltersChange,
  providerOptions,
  providerFilters,
  onProviderFiltersChange,
  executorOptions,
  executorFilters,
  onExecutorFiltersChange,
  ageOptions,
  ageFilter,
  onAgeFilterChange,
  hasFilters,
  onClearFilters,
}: GlobalSessionsFilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="filter-bar">
      <form onSubmit={onSearchSubmit} className="filter-search-form">
        <input
          type="text"
          className="filter-search"
          placeholder={t("globalSessionsSearchPlaceholder")}
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
        />
        <button type="submit" className="filter-search-button">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </form>
      <div className="filter-dropdowns">
        {projectOptions.length > 0 && (
          <FilterDropdown
            label={t("inboxFilterProject")}
            options={projectOptions}
            selected={projectFilter ? [projectFilter] : []}
            onChange={onProjectFilterChange}
            multiSelect={false}
            placeholder={t("globalSessionsFilterProjectPlaceholder")}
          />
        )}
        <FilterDropdown
          label={t("globalSessionsFilterStatus")}
          options={statusOptions}
          selected={statusFilters}
          onChange={onStatusFiltersChange}
          placeholder={t("globalSessionsStatusAll")}
        />
        {providerOptions.length > 1 && (
          <FilterDropdown
            label={t("globalSessionsFilterProvider")}
            options={providerOptions}
            selected={providerFilters}
            onChange={onProviderFiltersChange}
            placeholder={t("globalSessionsStatusAll")}
          />
        )}
        {executorOptions.length > 1 && (
          <FilterDropdown
            label={t("globalSessionsFilterExecutor")}
            options={executorOptions}
            selected={executorFilters}
            onChange={onExecutorFiltersChange}
            placeholder={t("globalSessionsFilterMachinePlaceholder")}
          />
        )}
        <FilterDropdown
          label={t("globalSessionsFilterAge")}
          options={ageOptions}
          selected={ageFilter ? [ageFilter] : []}
          onChange={onAgeFilterChange}
          multiSelect={false}
          placeholder={t("globalSessionsFilterAgePlaceholder")}
        />
      </div>
      {hasFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="filter-clear-button"
        >
          {t("globalSessionsClearFilters")}
        </button>
      )}
    </div>
  );
}
