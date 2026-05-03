# FilterDropdown Ghost 风格重新设计方案

## 1. 设计目标

将 `filter-dropdown-container` 的触发按钮改为 **Ghost 透明风格**（无边框/弱边框），同时优化下拉列表的间距和视觉层次。由于所有下拉组件共享 `--dropdown-*` 令牌，本次改动将统一影响系统内所有下拉菜单。

---

## 2. 改动范围

### 2.1 令牌层改动

**文件**: [`packages/client/src/styles/tokens/spacing.css`](../packages/client/src/styles/tokens/spacing.css:49)

需要修改的触发按钮令牌：

| 令牌 | 当前值 | 新值 | 说明 |
|------|--------|------|------|
| `--dropdown-trigger-bg` | `linear-gradient(135deg, color-mix(...), ...)` | `transparent` | 完全透明背景 |
| `--dropdown-trigger-hover-bg` | `linear-gradient(135deg, color-mix(...), ...)` | `var(--bg-hover)` | 悬停时使用标准 hover 背景 |
| `--dropdown-trigger-selected-bg` | `color-mix(brand 14%, surface)` | `color-mix(brand 8%, transparent)` | 选中态更轻微的品牌色 |
| `--dropdown-trigger-border` | `color-mix(input 78%, brand 22%)` | `transparent` | 默认无边框 |
| `--dropdown-trigger-shadow` | `0 8px 22px rgba(0,0,0,.08)` | `none` | 无阴影 |
| `--dropdown-trigger-radius` | `var(--radius-full)` | `var(--radius-md)` | 从药丸形改为圆角矩形 |

### 2.2 FilterDropdown CSS 改动

**文件**: [`packages/client/src/styles/components/filter-dropdown.css`](../packages/client/src/styles/components/filter-dropdown.css)

#### 触发按钮样式改动

```css
/* 改动点：
   1. 移除 font-weight: 600 → 改为 500（Ghost 按钮更轻盈）
   2. 移除 hover 时的 translateY(-1px)（Ghost 按钮不应有位移）
   3. hover 时添加弱边框 color-mix(brand 40%, transparent)
   4. has-selection / aria-expanded 时使用弱品牌色边框
*/
```

具体改动：

| 选择器 | 改动 |
|--------|------|
| `.filter-dropdown-button` | `font-weight: 600` → `500` |
| `.filter-dropdown-button:hover` | 移除 `transform: translateY(-1px)`；添加 `border-color: color-mix(brand 40%, transparent)` |
| `.filter-dropdown-button:active` | 添加 `background: var(--bg-active)` |
| `.filter-dropdown-button.has-selection` | `box-shadow` 简化为 `0 0 0 1px color-mix(brand 18%, transparent)` |

#### 列表样式优化

| 选择器 | 改动 | 说明 |
|--------|------|------|
| `.filter-dropdown-option` | `min-height` 从 `42px` → `38px` | 更紧凑 |
| `.filter-dropdown-option::before` | 宽度从 `3px` → `2px`，圆角保持 | 选中指示条更精致 |
| `.filter-dropdown-count` | 移除 `border`，背景改为 `var(--bg-secondary)` | 计数徽章更轻量 |
| `.filter-dropdown-label` | `line-height` 从 `1.3` → `1.4` | 略微增加行高提升可读性 |
| `.filter-dropdown-description` | `color` 改为 `var(--text-dimmed)` | 更清晰的层次区分 |

### 2.3 其他组件同步影响

由于所有组件共享令牌，以下组件的触发按钮会自动跟随 Ghost 风格变化：

| 组件 | 需要额外调整？ | 说明 |
|------|---------------|------|
| [`ModeSelector`](../packages/client/src/styles/pages/session-messages.css:342) | 可能需要 | `.mode-button` 有独立 hover 样式，需确认是否兼容 |
| [`SessionMenu`](../packages/client/src/styles/pages/session-metadata.css:28) | 不需要 | `.session-menu-trigger` 是图标按钮，不使用 trigger 令牌 |
| [`RecentSessionsDropdown`](../packages/client/src/styles/layouts/sidebar.css:450) | 不需要 | `.session-title-dropdown-trigger` 有独立样式 |
| [`ProjectSelector`](../packages/client/src/styles/components/project-selector.css:1) | 可能需要 | `.project-selector-button` 有独立样式但引用了部分令牌 |
| [`SlashCommand / McpServer`](../packages/client/src/styles/components/file-attachments.css:246) | 需要确认 | 按钮引用了 `--dropdown-trigger-border` 等令牌 |

---

## 3. 详细实施步骤

### 步骤 1：修改设计令牌

**文件**: `packages/client/src/styles/tokens/spacing.css`

将 `--dropdown-trigger-*` 系列令牌改为 Ghost 风格：

```css
/* 触发按钮 — Ghost 风格 */
--dropdown-trigger-height: 36px;
--dropdown-trigger-pad: 0 var(--space-3);
--dropdown-trigger-gap: var(--space-1);
--dropdown-trigger-radius: var(--radius-md);
--dropdown-trigger-bg: transparent;
--dropdown-trigger-hover-bg: var(--bg-hover);
--dropdown-trigger-selected-bg: color-mix(in srgb, var(--color-brand) 8%, transparent);
--dropdown-trigger-border: transparent;
--dropdown-trigger-shadow: none;
```

### 步骤 2：更新 FilterDropdown CSS

**文件**: `packages/client/src/styles/components/filter-dropdown.css`

改动要点：
- 按钮默认 `font-weight` 从 `600` → `500`
- 移除 hover 时的 `transform: translateY(-1px)`
- hover 时显示弱边框 `border-color: color-mix(in srgb, var(--color-brand) 40%, transparent)`
- has-selection / expanded 态的 `box-shadow` 简化
- 选项 `min-height` 优化
- 计数徽章去除边框

### 步骤 3：检查并调整 ModeSelector 按钮

**文件**: `packages/client/src/styles/pages/session-messages.css`

`.mode-button` 当前引用了 `--dropdown-trigger-border` 和 `--dropdown-trigger-radius`，令牌改为 transparent 后需确认：
- 按钮是否仍然有足够的视觉边界
- hover 态是否需要额外的边框处理

### 步骤 4：检查并调整 SlashCommand / McpServer 按钮

**文件**: `packages/client/src/styles/components/file-attachments.css`

`.slash-command-button` 等引用了 `--dropdown-trigger-border`，令牌改为 transparent 后：
- 按钮可能变为完全无边框，需确认视觉效果
- 可能需要为这些按钮单独设置弱边框

### 步骤 5：检查并调整 ProjectSelector 按钮

**文件**: `packages/client/src/styles/components/project-selector.css`

`.project-selector-button` 有独立样式，需确认令牌变化后的兼容性。

### 步骤 6：视觉验证

在以下页面验证效果：
- **Inbox 页面**：项目筛选下拉
- **GlobalSessions 页面**：多维度筛选下拉
- **NewSession 页面**：模型选择下拉
- **Session 页面**：ModeSelector、SessionMenu
- **Sidebar**：RecentSessionsDropdown
- **MessageInput**：SlashCommand、McpServer

---

## 4. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Ghost 按钮在浅色主题下可能不够醒目 | 中 | 确保 hover/selected 态有足够的视觉反馈 |
| 令牌变更影响所有下拉组件 | 中 | 逐组件检查，必要时为特定组件添加覆盖样式 |
| 移除边框后按钮可点击区域不明确 | 低 | 保持足够的 padding 和 hover 反馈 |

---

## 5. 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| [`tokens/spacing.css`](../packages/client/src/styles/tokens/spacing.css) | 修改令牌 |
| [`components/filter-dropdown.css`](../packages/client/src/styles/components/filter-dropdown.css) | 重构按钮+列表样式 |
| [`pages/session-messages.css`](../packages/client/src/styles/pages/session-messages.css) | 可能需调整 ModeSelector |
| [`components/file-attachments.css`](../packages/client/src/styles/components/file-attachments.css) | 可能需调整 SlashCommand |
| [`components/project-selector.css`](../packages/client/src/styles/components/project-selector.css) | 可能需调整 |
