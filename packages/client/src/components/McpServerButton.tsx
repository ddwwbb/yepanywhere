import type { McpServerStatus } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./ui/Modal";

interface McpServerButtonProps {
  processId?: string;
  initialServers?: McpServerStatus[];
  disabled?: boolean;
}

const STATUS_LABELS: Record<McpServerStatus["status"], string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-auth": "Needs auth",
  pending: "Pending",
  disabled: "Disabled",
};

function isEnabled(server: McpServerStatus): boolean {
  return server.status !== "disabled";
}

export function McpServerButton({
  processId,
  initialServers = [],
  disabled,
}: McpServerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousProcessIdRef = useRef(processId);

  const fallbackServers = useMemo<McpServerStatus[]>(
    () => initialServers,
    [initialServers],
  );
  const displayedServers = servers.length > 0 ? servers : fallbackServers;
  const connectedCount = displayedServers.filter(
    (server) => server.status === "connected",
  ).length;

  const loadServers = useCallback(async () => {
    if (!processId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getProcessMcpServers(processId);
      setServers(result.mcpServers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => {
    if (previousProcessIdRef.current === processId) return;
    previousProcessIdRef.current = processId;
    setServers([]);
    setError(null);
    setTogglingName(null);
  }, [processId]);

  useEffect(() => {
    if (!processId || fallbackServers.length > 0 || servers.length > 0) return;
    void loadServers();
  }, [processId, fallbackServers.length, servers.length, loadServers]);

  useEffect(() => {
    if (isOpen) {
      void loadServers();
    }
  }, [isOpen, loadServers]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const handleToggle = useCallback(
    async (serverName: string, enabled: boolean) => {
      if (!processId) return;
      setTogglingName(serverName);
      setError(null);
      try {
        const result = await api.setProcessMcpServerEnabled(
          processId,
          serverName,
          enabled,
        );
        setServers(result.mcpServers);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setTogglingName(null);
      }
    },
    [processId],
  );

  return (
    <div className="mcp-server-container">
      <button
        ref={buttonRef}
        type="button"
        className={`mcp-server-button ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled || !processId}
        title={
          processId ? "MCP servers" : "Resume session to manage MCP servers"
        }
        aria-label="Show MCP servers"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <svg
          className="mcp-server-icon"
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
          <circle cx="12" cy="12" r="3" />
          <circle cx="5" cy="5" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="m7 7 3 3" />
          <path d="m17 7-3 3" />
          <path d="m7 17 3-3" />
          <path d="m17 17-3-3" />
        </svg>
        {displayedServers.length > 0 && (
          <span className="mcp-server-count">
            {connectedCount}/{displayedServers.length}
          </span>
        )}
      </button>
      {isOpen && (
        <Modal title="MCP servers" onClose={handleClose}>
          <div className="mcp-server-modal-content" aria-label="MCP servers">
            <div className="mcp-server-menu-header">
              <span>Current MCP servers</span>
              <button
                type="button"
                className="mcp-server-refresh"
                onClick={() => void loadServers()}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
            {loading && displayedServers.length === 0 && (
              <div className="mcp-server-empty">Loading MCP servers...</div>
            )}
            {error && <div className="mcp-server-error">{error}</div>}
            {!loading && !error && displayedServers.length === 0 && (
              <div className="mcp-server-empty">No MCP servers active</div>
            )}
            {displayedServers.length > 0 && (
              <div className="mcp-server-list">
                {displayedServers.map((server) => {
                  const enabled = isEnabled(server);
                  const toggling = togglingName === server.name;
                  return (
                    <div className="mcp-server-item" key={server.name}>
                      <div className="mcp-server-main">
                        <span className="mcp-server-name">{server.name}</span>
                        <span
                          className={`mcp-server-status status-${server.status}`}
                        >
                          {STATUS_LABELS[server.status]}
                        </span>
                      </div>
                      {server.error && (
                        <div className="mcp-server-detail">{server.error}</div>
                      )}
                      {server.tools && server.tools.length > 0 && (
                        <div className="mcp-server-detail">
                          {server.tools.length} tools
                        </div>
                      )}
                      <label className="mcp-server-toggle">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={loading || toggling}
                          onChange={(event) =>
                            void handleToggle(server.name, event.target.checked)
                          }
                        />
                        <span className="mcp-server-toggle-slider" />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
