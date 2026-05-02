import type { DeferredMessage } from "../../hooks/useSession";
import { useI18n } from "../../i18n";

interface DeferredQueueBannerProps {
  messages: DeferredMessage[];
  onCancel: (tempId: string) => void;
}

export function DeferredQueueBanner({
  messages,
  onCancel,
}: DeferredQueueBannerProps) {
  const { t } = useI18n();

  if (messages.length === 0) return null;

  const renderCancelButton = (tempId: string) => (
    <button
      type="button"
      className="deferred-queue-cancel"
      onClick={() => onCancel(tempId)}
      aria-label={t("toolbarQueueTitle")}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  return (
    <div className="deferred-queue-banner">
      {messages.map((message, index) => (
        <div
          key={message.tempId ?? `deferred-${index}`}
          className="deferred-queue-item"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 256 256"
            className="deferred-queue-icon"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88Zm64-88a8 8 0 0 1-8 8H128a8 8 0 0 1-8-8V72a8 8 0 0 1 16 0v48h56a8 8 0 0 1 0 16Z"
            />
          </svg>
          <span className="deferred-queue-text">
            {message.content.length > 80
              ? `${message.content.slice(0, 77)}...`
              : message.content}
          </span>
          {message.tempId && renderCancelButton(message.tempId)}
        </div>
      ))}
    </div>
  );
}
