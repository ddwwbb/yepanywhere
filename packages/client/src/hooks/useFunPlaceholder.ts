import { useMemo } from "react";
import { useI18n } from "../i18n";
import {
  type FunPlaceholderScenario,
  getRandomFunPlaceholder,
  shouldShowFunPlaceholder,
} from "../lib/funPlaceholders";

/**
 * Hook that returns either the default placeholder or a random fun phrase.
 * The decision is made once per mount (stable via useMemo).
 * 30% chance of showing a fun phrase, 70% chance of showing the default.
 *
 * @param defaultPlaceholder - The normal i18n placeholder text
 * @param scenario - The context: "resume" (idle), "queue" (agent running), "new" (new session)
 */
export function useFunPlaceholder(
  defaultPlaceholder: string,
  scenario: FunPlaceholderScenario,
): string {
  const { locale } = useI18n();

  return useMemo(() => {
    if (shouldShowFunPlaceholder()) {
      const funPhrase = getRandomFunPlaceholder(locale, scenario);
      if (funPhrase) return funPhrase;
    }
    return defaultPlaceholder;
  }, [defaultPlaceholder, locale, scenario]);
}
