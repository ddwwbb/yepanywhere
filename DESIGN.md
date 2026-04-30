# Design System — Yep Anywhere

## Product Context

- **What this is:** Yep Anywhere is a self-hosted, mobile-first control surface for local AI agent sessions. It lets users monitor, resume, approve, and manage Claude Code, Codex, Gemini, OpenCode, and other agent sessions from phone or desktop.
- **Who it's for:** Developers and builders who run long-lived agent tasks on a local machine but need to supervise them remotely.
- **Space/industry:** Developer tools, agent orchestration, self-hosted remote control, CLI session management.
- **Project type:** Web app / dashboard / mobile control console.
- **Memorable thing:** A phone-sized Agent control console. The user should immediately feel: “I can manage every running agent from here.”

## Aesthetic Direction

- **Direction:** Industrial / Utilitarian.
- **Decoration level:** Intentional, not expressive. Use depth, translucency, and status color sparingly. Avoid marketing gradients, decorative blobs, and ornamental layouts.
- **Mood:** Serious developer software. Dense enough for real work, calm enough for mobile use, fast enough that approval and reply actions feel one tap away.
- **Design thesis:** Mobile is a command dock, desktop is mission control.

## Responsive Strategy

- **Mobile `<768px`:** Optimize for one-thumb operation. Use bottom navigation, bottom sheets, compact headers, dense cards, and persistent input actions.
- **Tablet `768px–1099px`:** Use a compact navigation rail, single-column content, and drawers for secondary details.
- **Desktop `≥1100px`:** Use persistent sidebar navigation, high-density lists, multi-column layouts, detail panels, and keyboard-friendly controls.
- **State rule:** Responsive layout changes must not reset drafts, selected filters, selected settings category, expanded panels, current session, uploaded files, or pending approval state.

## Navigation

### Mobile

- Use a persistent bottom tab bar for the primary loop:
  - Inbox
  - Sessions
  - New
  - Activity
  - Settings
- Move project history, starred sessions, provider management, bridge, devices, and source control into a More / History bottom sheet.
- Keep the existing sidebar as a secondary history surface, not the primary mobile navigation.
- Every primary mobile destination should be reachable in one tap from the bottom bar.

### Desktop

- Keep the persistent sidebar.
- Preserve expanded and collapsed states.
- Use desktop width for richer layouts:
  - left navigation
  - center list or conversation
  - optional right detail / inspector panel
- Desktop may show more labels, metadata, filters, and status indicators than mobile.

## Typography

- **Display / Page titles:** Geist, fallback to current system stack.
- **Body / UI:** Geist or IBM Plex Sans. Prefer clear numerals and compact rhythm over brand personality.
- **Data / Tables:** JetBrains Mono or Geist Mono with `tabular-nums`.
- **Code:** JetBrains Mono.
- **Current fallback:** Keep `-apple-system`, BlinkMacSystemFont, `SF Pro Display`, `SF Pro Text`, `Segoe UI`, `Roboto`, sans-serif as fallback only.
- **Scale:**
  - `xs`: 12px, metadata and badges
  - `sm`: 14px, dense controls and secondary labels
  - `base`: 16px, mobile body and inputs
  - `lg`: 18px, compact page titles
  - `xl`: 20px, desktop section titles
  - `2xl`: 24px, desktop hero titles only
- **Mobile rule:** Do not shrink primary text below 14px. Prefer hiding secondary metadata over making text unreadable.

## Color

- **Approach:** Restrained.
- **Primary:** Current indigo may remain as `--color-brand`, but use it less. It should indicate active navigation, primary action, and focus, not decorate every panel.
- **Provider colors:** Use only for provider badges, session status hints, and compact identity markers.
- **Semantic colors:**
  - Success: process running or connected
  - Warning: needs attention or approval
  - Error: failed or disconnected
  - Info: neutral system state
- **Light mode:** Clean zinc / slate surfaces, low border contrast, clear text hierarchy.
- **Dark mode:** Deep zinc surfaces, subtle glass, reduced saturation for large surfaces.
- **Very dark mode:** Console-like, high contrast, minimal glow.
- **Rule:** Status color beats brand color. If an agent needs approval, warning color wins.

## Spacing and Density

- **Base unit:** 4px.
- **Mobile density:** Compact.
- **Desktop density:** Comfortable but information-rich.
- **Scale:**
  - `2xs`: 2px
  - `xs`: 4px
  - `sm`: 8px
  - `md`: 16px
  - `lg`: 24px
  - `xl`: 32px
  - `2xl`: 48px
  - `3xl`: 64px
- **Mobile rule:** Reduce page chrome before reducing content. Headers, heroes, and toolbars should give space back to sessions and messages.

## Shape and Elevation

- **Border radius:**
  - `sm`: 6px, badges and small controls
  - `md`: 8px, inputs and compact buttons
  - `lg`: 12px, list items and cards
  - `xl`: 16px, panels and sheets
  - `2xl`: 24px, major surfaces
- **Borders:** Prefer low-contrast separators or background contrast. Avoid heavy boxed layouts.
- **Elevation:** Use soft shadows only for floating surfaces: bottom sheets, drawers, popovers, modals, and sticky composer bars.
- **Mobile sheets:** Bottom sheets should feel native: rounded top corners, safe-area padding, sticky action row.

## Layout Patterns

### Page Shell

- Mobile pages use:
  - compact sticky header
  - scrollable content
  - bottom navigation or sticky composer
  - bottom sheets for secondary actions
- Desktop pages use:
  - persistent sidebar
  - constrained main content for reading pages
  - multi-column layout for operational pages

### PageHero

- Mobile PageHero should be compact or omitted when it does not help the next action.
- Desktop PageHero can show metrics and actions.
- Avoid large decorative hero blocks inside operational workflows.

### Lists and Cards

- Mobile lists should show only decision-critical information:
  - title
  - provider/status
  - last activity
  - unread / attention marker
  - draft marker
- Desktop lists can show project, model, message count, owner, source, activity, and actions.
- Use progressive disclosure: tap opens details, long press or overflow opens actions.

## Chat / Session Page

### Mobile

- Header should contain only:
  - navigation/back or history access
  - compact project/session title
  - status/provider pill
  - overflow menu
- Move Git status, new session, process info, model switch, rename, star, archive, share, and terminate into an action sheet.
- The message list is the main product surface. Preserve vertical space.
- Tool approval and AskUserQuestion should render as bottom sheets with sticky approve/deny/submit actions.
- The composer should default to a compact input with send/queue/stop always reachable.
- Secondary composer tools go into a horizontally scrollable strip or More Tools sheet:
  - attach
  - voice
  - slash command
  - MCP
  - permission mode
  - thinking mode
  - model switch
  - context usage

### Desktop

- Header may show project breadcrumb, title, provider, git, new session, and process controls.
- Consider a right inspector panel for process info, context usage, tools, MCP servers, and metadata.
- Keep keyboard-first behavior for sending, queuing, stopping, and opening command menus.

## Settings

### Mobile

- Settings home is a searchable command list, not a long category wall.
- Pin common categories first:
  - Providers
  - Model
  - Remote Access
  - Notifications
  - Appearance
- Category detail pages use a sticky back header and compact grouped cards.
- Dangerous or rare controls should move lower and require clear confirmation.

### Desktop

- Keep two-column layout.
- Left category navigation should be sticky.
- Right panel can use grouped sections, inline validation, and richer descriptions.
- Use a sticky summary or status panel when configuration has multi-step setup.

## Components

- **Button:** Primary, secondary, ghost, danger, icon. Minimum touch target 44px on coarse pointers.
- **Card:** Border-light or borderless surface with `lg` or `xl` radius.
- **Bottom Sheet:** Required for mobile action menus, approvals, model switch, process info, and advanced composer tools.
- **Drawer:** Preferred for tablet and desktop secondary details.
- **Modal:** Use only for blocking, high-risk, or large-form decisions on desktop. Avoid centered modals on mobile.
- **Status Pill:** Compact state display for provider, running, waiting, external, unread, draft, and approval.
- **Command List:** Searchable list pattern for settings, slash commands, session actions, and provider actions.

## Motion

- **Approach:** Minimal-functional.
- **Durations:**
  - Micro: 50–100ms
  - Short: 150–250ms
  - Medium: 250–400ms
- **Easing:** Use ease-out for entrance, ease-in for exit, ease-in-out for movement.
- **Rule:** Motion must explain state changes. Do not animate decoration for its own sake.
- **Mobile:** Sheet transitions and tab changes should feel fast. Do not delay approval actions.

## Accessibility

- Maintain 44px minimum touch targets on mobile.
- Preserve visible focus states in all themes.
- Do not rely on color alone for status.
- Bottom sheets and drawers must trap focus while open and restore focus when closed.
- Inputs must remain usable with mobile keyboards and safe-area insets.
- Text truncation must preserve full labels in `title` or accessible names where useful.

## Implementation Rules

- Keep existing route structure unless explicitly changing product behavior.
- Keep `main.tsx` and `remote-main.tsx` route definitions synchronized.
- Use existing React state and hooks. Do not add external state libraries for layout.
- Prefer shared layout primitives over page-specific one-offs.
- Add responsive behavior through CSS custom properties, media queries, and small viewport hooks.
- Do not introduce Tailwind; this project uses CSS custom properties.
- No feature should disappear on mobile. It may move behind a sheet, menu, drawer, or progressive disclosure.

## Priority Order for Refactor

1. Mobile navigation shell: bottom tabs, More / History sheet, safe-area handling.
2. Session page mobile header and composer density.
3. Tool approval and AskUserQuestion bottom sheets.
4. Settings searchable mobile command list and desktop grouping polish.
5. Projects, Sessions, Inbox, Activity list density and mobile card hierarchy.
6. Desktop inspector/detail panels for high-density workflows.
7. Final visual pass across light, dark, and verydark themes.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-04-28 | Initial design system created | Created before implementation to guide the full mobile-first product UI refresh. |
| 2026-04-28 | Memorable thing: phone-sized Agent control console | The product’s highest-value job is supervising and continuing agent work from a phone. |
| 2026-04-28 | Mobile Command Dock + Desktop Mission Control | Mobile needs one-thumb speed; desktop needs complete operational density. |
| 2026-04-28 | Industrial / Utilitarian visual direction | Yep Anywhere is serious developer software, not a marketing site. |
