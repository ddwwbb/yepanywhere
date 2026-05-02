import { useI18n } from "../../i18n";

interface SessionErrorStateProps {
  message: string;
}

export function SessionErrorState({ message }: SessionErrorStateProps) {
  const { t } = useI18n();

  return (
    <div className="error">
      {t("sessionErrorPrefix")} {message}
    </div>
  );
}
