import type { ComponentProps } from "react";
import { MessageList } from "../../components/MessageList";
import { AgentContentProvider } from "../../contexts/AgentContentContext";
import { SessionMetadataProvider } from "../../contexts/SessionMetadataContext";

type AgentContentProviderProps = Omit<
  ComponentProps<typeof AgentContentProvider>,
  "children"
>;
type MessageListProps = ComponentProps<typeof MessageList>;

interface SessionMessagesProps
  extends AgentContentProviderProps,
    MessageListProps {
  loading: boolean;
  loadingLabel: string;
  projectPath: string | null;
}

export function SessionMessages({
  loading,
  loadingLabel,
  projectId,
  projectPath,
  sessionId,
  agentContent,
  setAgentContent,
  toolUseToAgent,
  ...messageListProps
}: SessionMessagesProps) {
  return (
    <main className="session-messages">
      {loading ? (
        <div className="loading">{loadingLabel}</div>
      ) : (
        <SessionMetadataProvider
          projectId={projectId}
          projectPath={projectPath}
          sessionId={sessionId}
        >
          <AgentContentProvider
            agentContent={agentContent}
            setAgentContent={setAgentContent}
            toolUseToAgent={toolUseToAgent}
            projectId={projectId}
            sessionId={sessionId}
          >
            <MessageList {...messageListProps} />
          </AgentContentProvider>
        </SessionMetadataProvider>
      )}
    </main>
  );
}
