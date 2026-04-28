import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./ui/Modal";

export interface SlashCommandItem {
  name: string;
  description?: string;
  argumentHint?: string;
  category?: "command" | "slash" | "skill";
}

const BUILT_IN_COMMANDS: SlashCommandItem[] = [
  { name: "help", description: "显示可用命令和提示", category: "command" },
  { name: "clear", description: "清除对话历史", category: "command" },
  { name: "cost", description: "显示 Token 用量统计", category: "command" },
  { name: "compact", description: "压缩对话上下文", category: "command" },
  { name: "doctor", description: "诊断项目健康状况", category: "command" },
  { name: "init", description: "初始化项目 CLAUDE.md", category: "command" },
  { name: "review", description: "审查代码质量", category: "command" },
  {
    name: "terminal-setup",
    description: "配置终端设置",
    category: "command",
  },
  { name: "memory", description: "编辑项目记忆文件", category: "command" },
];

const SKILL_DESCRIPTIONS: Record<string, string> = {
  "update-config":
    "配置 Claude Code harness、settings.json、权限、环境变量和 hooks。",
  debug: "开启本次会话 debug 日志并辅助诊断问题。",
  simplify: "审查当前改动的复用、质量和效率，并修复发现的问题。",
  batch: "研究并规划大型变更，再并行分配到多个隔离 worktree agent。",
  loop: "按固定间隔重复运行提示或 slash command。",
  "claude-api": "构建、调试和优化 Claude API / Anthropic SDK 应用。",
  checkpoint: "保存和恢复工作状态检查点。",
  "java-dev": "按团队规范实现、修改、重构和审查 Java / Spring Boot 代码。",
  context: "显示当前上下文使用情况。",
  heapdump: "导出 JS heap 到桌面。",
  "security-review": "对当前分支待提交改动做安全审查。",
  insights: "生成 Claude Code 会话使用分析报告。",
  "team-onboarding": "根据使用情况生成团队上手指南。",
};

const BUILT_IN_SKILLS: SlashCommandItem[] = Object.entries(
  SKILL_DESCRIPTIONS,
).map(([name, description]) => ({
  name,
  description,
  category: "skill",
}));

const KNOWN_SKILL_NAMES = new Set(Object.keys(SKILL_DESCRIPTIONS));

interface SlashCommandButtonProps {
  /** Available slash commands, either names or metadata objects. */
  commands: SlashCommandItem[];
  /** Callback when a command is selected */
  onSelectCommand: (command: SlashCommandItem) => void;
  /** Whether the button should be disabled */
  disabled?: boolean;
}

function normalizeCommand(command: SlashCommandItem): SlashCommandItem {
  const name = command.name.startsWith("/")
    ? command.name.slice(1)
    : command.name;
  const description = command.description || SKILL_DESCRIPTIONS[name];
  return {
    ...command,
    name,
    description,
    category:
      command.category ?? (KNOWN_SKILL_NAMES.has(name) ? "skill" : "slash"),
  };
}

function buildCommandList(commands: SlashCommandItem[]): SlashCommandItem[] {
  const byName = new Map<string, SlashCommandItem>();

  for (const command of BUILT_IN_COMMANDS) {
    byName.set(command.name, command);
  }

  for (const command of BUILT_IN_SKILLS) {
    byName.set(command.name, command);
  }

  for (const command of commands) {
    const normalized = normalizeCommand(command);
    const current = byName.get(normalized.name);
    byName.set(normalized.name, {
      ...current,
      ...normalized,
      description: normalized.description ?? current?.description,
      category: current?.category ?? normalized.category,
    });
  }

  return [...byName.values()];
}

const CATEGORY_LABELS: Record<
  NonNullable<SlashCommandItem["category"]>,
  string
> = {
  command: "Commands",
  slash: "Slash Commands",
  skill: "Agent Skills",
};

/**
 * Button that shows available slash commands in a grouped searchable menu.
 * Selecting a command inserts "/{command}" into the message input.
 */
export function SlashCommandButton({
  commands,
  onSelectCommand,
  disabled,
}: SlashCommandButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => buildCommandList(commands), [commands]);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, query]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  const handleCommandClick = useCallback(
    (command: SlashCommandItem) => {
      onSelectCommand(command);
      setIsOpen(false);
    },
    [onSelectCommand],
  );

  const renderGroup = (category: NonNullable<SlashCommandItem["category"]>) => {
    const groupItems = filteredItems.filter(
      (item) => item.category === category,
    );
    if (groupItems.length === 0) return null;
    return (
      <div className="slash-command-group" key={category}>
        <div className="slash-command-group-label">
          {CATEGORY_LABELS[category]}
        </div>
        {groupItems.map((command) => (
          <button
            key={command.name}
            type="button"
            className="model-switch-item slash-command-item"
            onClick={() => handleCommandClick(command)}
            role="menuitem"
          >
            <span className="slash-command-item-main">
              <span className="model-switch-name slash-command-item-name">
                /{command.name}
              </span>
              {command.argumentHint && (
                <span className="model-switch-badge slash-command-item-hint">
                  {command.argumentHint}
                </span>
              )}
            </span>
            {command.description && (
              <span className="model-switch-description slash-command-item-description">
                {command.description}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="slash-command-container">
      <button
        type="button"
        className={`slash-command-button ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Slash commands"
        aria-label="Show slash commands"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="slash-icon">/</span>
      </button>
      {isOpen && (
        <Modal title="Commands and skills" onClose={() => setIsOpen(false)}>
          <div className="model-switch-content slash-command-modal-content">
            <div className="slash-command-search-wrap">
              <input
                ref={searchRef}
                className="slash-command-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands or skills"
                aria-label="Search commands or skills"
              />
            </div>
            <div className="model-switch-list slash-command-list">
              {renderGroup("command")}
              {renderGroup("slash")}
              {renderGroup("skill")}
              {filteredItems.length === 0 && (
                <div className="model-switch-loading slash-command-empty">
                  No commands found
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
