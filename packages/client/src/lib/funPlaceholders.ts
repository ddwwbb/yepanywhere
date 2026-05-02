/**
 * Fun placeholder phrases for the message input area.
 * Displayed randomly (30% chance) to add personality to the UI.
 * Organized by scenario: "resume" (idle session), "queue" (agent running), "new" (new session).
 */

interface FunPlaceholderSet {
  resume: string[];
  queue: string[];
  new: string[];
}

const funPlaceholders: Record<string, FunPlaceholderSet> = {
  en: {
    resume: [
      "What's on your mind?",
      "I'm all ears...",
      "Ready when you are.",
      "Let's pick up where we left off.",
      "What shall we build next?",
      "Your wish is my command.",
      "Hit me with your best idea.",
      "The floor is yours.",
      "What are we tackling today?",
      "Bring it on...",
    ],
    queue: [
      "Got more ideas? Queue 'em up!",
      "While the agent's busy...",
      "Plant a seed for later...",
      "Queue your next big idea.",
      "Add to the wish list...",
    ],
    new: [
      "What shall we create today?",
      "A blank canvas awaits...",
      "Let's build something amazing.",
      "Every great project starts with a message.",
      "What adventure are we embarking on?",
      "Start something new...",
      "The future is just a message away.",
      "What's the plan?",
    ],
  },

  "zh-CN": {
    resume: [
      "有什么难题尽管问...",
      "我在听，请说...",
      "随时准备好了。",
      "今天想创造点什么？",
      "你的愿望就是我的命令。",
      "继续上次的冒险？",
      "说来听听...",
      "有什么新鲜事？",
      "准备好迎接下一个挑战了吗？",
      "请开始你的表演...",
    ],
    queue: [
      "趁等待的时候，再来一条？",
      "排队等候中，先占个位...",
      "种下一个想法的种子...",
      "把下一个灵感加入队列...",
      "还有什么想补充的？",
    ],
    new: [
      "今天想创造点什么？",
      "一张白纸等你来书写...",
      "让我们创造点不一样的。",
      "每个伟大的项目都始于一条消息。",
      "准备开始什么新冒险？",
      "未来就在一条消息之后...",
      "有什么计划？说来听听。",
      "新的一天，新的可能...",
    ],
  },
};

export type FunPlaceholderScenario = "resume" | "queue" | "new";

/**
 * Get a random fun placeholder for the given locale and scenario.
 * Returns `null` if no phrases are available (should not happen).
 */
export function getRandomFunPlaceholder(
  locale: string,
  scenario: FunPlaceholderScenario,
): string | null {
  const set = funPlaceholders[locale] ?? funPlaceholders.en;
  if (!set) return null;
  const phrases = set[scenario];
  if (!phrases || phrases.length === 0) return null;
  return phrases[Math.floor(Math.random() * phrases.length)] ?? null;
}

/**
 * Determine whether to show a fun placeholder (30% chance).
 */
export function shouldShowFunPlaceholder(): boolean {
  return Math.random() < 0.3;
}
