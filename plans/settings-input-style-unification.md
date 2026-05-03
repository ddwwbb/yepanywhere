# 设置页面输入框样式统一方案

## 问题分析

### 当前状态

设置页面中存在 **5 种不同的输入框样式类**，但只有 3 种有 CSS 定义，且视觉风格不一致：

| CSS 类名 | 使用位置 | 有 CSS？ | 背景 | 边框 | 圆角 | Focus Ring |
|---|---|---|---|---|---|---|
| `.settings-input` | LifecycleWebhooks, LocalAccess, RemoteChannels, ProvidersSettings | ❌ 无 | 无 | 无 | 无 | 无 |
| `.settings-input-small` | LocalAccess (端口号) | ❌ 无 | 无 | 无 | 无 | 无 |
| `.settings-select` | Appearance, Model, Emulator(错误!), PushNotification | ✅ | `bg-secondary` | `border-default` | `radius-md` | ✅ brand ring |
| `.settings-textarea` | AgentContext, ProvidersSettings | ✅ | `bg-secondary` | `border-default` | `radius-lg` | ✅ brand ring |
| `.remote-executor-input` | RemoteExecutorsSettings | ✅ | `bg-input` | `border-input` | `radius-sm` | ❌ 仅 border 变色 |
| `.form-field input` | settings-forms.css | ✅ | `bg-input` | `border-input` | `radius-md` | ❌ 仅 border 变色 |

### 核心问题

1. **`.settings-input` 和 `.settings-input-small` 完全没有 CSS 定义** — 输入框呈现浏览器默认样式
2. **背景色不一致** — `bg-secondary` vs `bg-input`
3. **边框色不一致** — `border-default` vs `border-input`
4. **圆角不一致** — `radius-sm` vs `radius-md` vs `radius-lg`
5. **Focus 效果不一致** — 有的有 brand ring，有的只有边框变色，有的完全没有
6. **缺少 hover / disabled / placeholder 状态**
7. **语义错误** — [`EmulatorSettings.tsx`](packages/client/src/pages/settings/EmulatorSettings.tsx:227) 中文本输入框使用了 `.settings-select` 类

---

## 统一方案

### 设计规范

所有设置页面的输入控件（input、select、textarea）统一使用以下设计 token：

```css
/* 统一输入框基础样式 */
背景:    var(--bg-input)        /* 与 login、remote-access 页面一致 */
边框:    1px solid var(--border-input)
圆角:    var(--radius-md)       /* 8px，统一 */
内边距:  var(--space-2) var(--space-3)
字号:    var(--text-base)
颜色:    var(--text-primary)

/* 交互状态 */
Hover:   border-color → var(--text-muted)
Focus:   border-color → var(--color-brand) + box-shadow: 0 0 0 3px var(--color-brand-alpha)
Disabled: opacity: 0.5; cursor: not-allowed
Placeholder: color: var(--text-muted); opacity: 0.6
```

### 设计决策说明

- **选择 `bg-input` + `border-input`** 而非 `bg-secondary` + `border-default`：因为输入框嵌套在 `.settings-item`（背景为 `bg-secondary`）中，使用 `bg-input` 可以提供更好的层次对比，避免输入框与卡片背景融为一体
- **统一 `radius-md`**：与项目大多数输入组件保持一致
- **统一 brand focus ring**：提升可访问性和视觉一致性

---

## 修改清单

### 1. CSS 修改

#### 文件: [`settings.css`](packages/client/src/styles/pages/settings.css)

**添加 `.settings-input` 样式**（当前完全缺失）：

```css
/* Text input for settings */
.settings-input {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  width: 100%;
  max-width: 320px;
  transition: border-color var(--duration-smooth) var(--ease-default),
    box-shadow var(--duration-smooth) var(--ease-default);
}

.settings-input:hover {
  border-color: var(--text-muted);
}

.settings-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-alpha);
}

.settings-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-input::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}
```

**添加 `.settings-input-small` 样式**（用于端口号等短输入）：

```css
/* Compact input for short values (port numbers, etc.) */
.settings-input-small {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  width: 100px;
  text-align: right;
  transition: border-color var(--duration-smooth) var(--ease-default),
    box-shadow var(--duration-smooth) var(--ease-default);
}

.settings-input-small:hover {
  border-color: var(--text-muted);
}

.settings-input-small:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-alpha);
}

.settings-input-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**更新 `.settings-select` 样式**（统一背景和边框变量）：

```css
.settings-select {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);          /* 改: bg-secondary → bg-input */
  border: 1px solid var(--border-input); /* 改: border-default → border-input */
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  cursor: pointer;
  min-width: 160px;
  transition: border-color var(--duration-smooth) var(--ease-default),
    box-shadow var(--duration-smooth) var(--ease-default);
}

.settings-select:hover {
  border-color: var(--text-muted);
}

.settings-select:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-alpha);
}

.settings-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**更新 `.settings-textarea` 样式**（统一圆角和边框变量）：

```css
.settings-textarea {
  width: 100%;
  min-height: 120px;
  padding: var(--space-3);
  border-radius: var(--radius-md);        /* 改: radius-lg → radius-md */
  border: 1px solid var(--border-input);  /* 改: border-default → border-input */
  background: var(--bg-input);            /* 改: bg-secondary → bg-input */
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  line-height: 1.5;
  resize: vertical;
  margin-top: var(--space-2);
  transition: border-color var(--duration-smooth) var(--ease-default),
    box-shadow var(--duration-smooth) var(--ease-default);
}

.settings-textarea:hover {
  border-color: var(--text-muted);
}

.settings-textarea:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-alpha);
}

.settings-textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}
```

#### 文件: [`new-session.css`](packages/client/src/styles/pages/new-session.css)

**更新 `.remote-executor-input` 样式**（统一圆角和添加 focus ring）：

```css
.remote-executor-input {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);  /* 改: radius-sm → radius-md */
  color: var(--text-primary);
  font-size: var(--text-base);      /* 改: text-sm → text-base */
  transition: border-color var(--duration-smooth) var(--ease-default),
    box-shadow var(--duration-smooth) var(--ease-default);
}

.remote-executor-input:hover {
  border-color: var(--text-muted);
}

.remote-executor-input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-alpha);  /* 新增: focus ring */
}

.remote-executor-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.remote-executor-input::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}
```

### 2. TSX 修改

#### 文件: [`EmulatorSettings.tsx`](packages/client/src/pages/settings/EmulatorSettings.tsx:227)

将第 227 行的 `className="settings-select"` 改为 `className="settings-input"`：

```tsx
// 修改前
<input
  type="text"
  name="chromeosHost"
  placeholder={t("emulatorHostAliasPlaceholder")}
  className="settings-select"     // ← 错误：文本输入用了 select 的类
  autoComplete="off"
  value={hostInput}
  onChange={(event) => setHostInput(event.target.value)}
/>

// 修改后
<input
  type="text"
  name="chromeosHost"
  placeholder={t("emulatorHostAliasPlaceholder")}
  className="settings-input"      // ← 修正为 input 类
  autoComplete="off"
  value={hostInput}
  onChange={(event) => setHostInput(event.target.value)}
/>
```

---

## 影响范围

### 受影响的设置页面

| 页面 | 修改类型 |
|---|---|
| AppearanceSettings | `.settings-select` 背景和边框变量更新 |
| ModelSettings | `.settings-select` 背景和边框变量更新 |
| AgentContextSettings | `.settings-textarea` 背景和边框变量更新 |
| LifecycleWebhooksSettings | `.settings-input` 从无样式变为有样式 |
| LocalAccessSettings | `.settings-input` 和 `.settings-input-small` 从无样式变为有样式 |
| RemoteChannelsSettings | `.settings-input` 从无样式变为有样式 |
| ProvidersSettings | `.settings-input` 从无样式变为有样式 + `.settings-textarea` 更新 |
| EmulatorSettings | `.settings-select` 更新 + className 修正 |
| RemoteExecutorsSettings | `.remote-executor-input` 圆角和 focus ring 更新 |
| NotificationsSettings | `.settings-select` 背景和边框变量更新 |

### 不受影响

- Toggle switch（checkbox）样式不变
- Button 样式不变
- 非设置页面的输入框不受影响

---

## 视觉对比预览

```
修改前:
┌─ .settings-item (bg-secondary) ──────────────────┐
│  Label                                            │
│  Description                                      │
│  ┌─────────────────────────────────────────────┐  │
│  │ [unstyled browser default input]             │  │ ← 无背景、无边框
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘

修改后:
┌─ .settings-item (bg-secondary) ──────────────────┐
│  Label                                            │
│  Description                                      │
│  ┌─────────────────────────────────────────────┐  │
│  │ [bg-input + border-input + radius-md]  ✨    │  │ ← 有层次对比
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```
