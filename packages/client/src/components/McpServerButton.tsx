import type { McpServerStatus } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./ui/Modal";

interface McpServerButtonProps {
  processId?: string;
  initialServers?: Array<{ name: string; status: string }>;
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

  const fallbackServers = useMemo<McpServerStatus[]>(
    () =>
      initialServers.map((s) => ({
        name: s.name,
        status: (s.status as McpServerStatus["status"]) || "pending",
      })),
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
    if (isOpen) {
      void loadServers();
    }
  }, [isOpen, loadServers]);

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
        type="button"
        className={`mcp-server-button ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled || !processId}
        title={
          processId ? "MCP servers" : "Resume session to manage MCP servers"
        }
        aria-label="Show MCP servers"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="mcp-server-label">MCP</span>
        {displayedServers.length > 0 && (
          <span className="mcp-server-count">
            {connectedCount}/{displayedServers.length}
          </span>
        )}
      </button>
      {isOpen && (
        <Modal title="MCP servers" onClose={() => setIsOpen(false)}>
          <div className="model-switch-content mcp-server-modal-content">
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
              <div className="model-switch-loading">Loading MCP servers...</div>
            )}
            {error && <div className="model-switch-error">{error}</div>}
            {!loading && !error && displayedServers.length === 0 && (
              <div className="model-switch-loading">No MCP servers active</div>
            )}
            {displayedServers.length > 0 && (
              <div className="model-switch-list mcp-server-list">
                {displayedServers.map((server) => {
                  const enabled = isEnabled(server);
                  const toggling = togglingName === server.name;
                  return (
                    <div
                      className={`model-switch-item mcp-server-item ${enabled ? "current" : ""}`}
                      key={server.name}
                    >
                      <div className="mcp-server-main">
                        <span className="model-switch-name mcp-server-name">
                          {server.name}
                        </span>
                        <span
                          className={`mcp-server-status status-${server.status}`}
                        >
                          {STATUS_LABELS[server.status]}
                        </span>
                      </div>
                      {server.error && (
                        <div className="model-switch-description mcp-server-detail">
                          {server.error}
                        </div>
                      )}
                      {server.tools && server.tools.length > 0 && (
                        <div className="model-switch-description mcp-server-detail">
                          {server.tools.length} tools
                        </div>
                      )}
                      <label className="toggle-switch mcp-server-toggle">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={loading || toggling}
                          onChange={(event) =>
                            void handleToggle(server.name, event.target.checked)
                          }
                        />
                        <span className="toggle-slider" />
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
