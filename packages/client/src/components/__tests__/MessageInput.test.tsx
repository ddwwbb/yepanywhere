import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { MessageInput } from "../MessageInput";
import type { VoiceInputButtonRef } from "../VoiceInputButton";

vi.mock("../VoiceInputButton", async () => {
  const React = await import("react");

  return {
    VoiceInputButton: React.forwardRef<VoiceInputButtonRef>(
      function MockVoiceInputButton(_props, ref) {
        React.useImperativeHandle(ref, () => ({
          stopAndFinalize: () => "",
          toggle: () => {},
          isListening: false,
          isAvailable: false,
        }));
        return null;
      },
    ),
  };
});

function renderMessageInput(onWrapperClick = vi.fn()) {
  return render(
    <I18nProvider>
      <div onClick={onWrapperClick} onKeyDown={() => {}}>
        <MessageInput onSend={vi.fn()} draftKey="test-message-input" />
      </div>
    </I18nProvider>,
  );
}

describe("MessageInput", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("toggles collapse without bubbling the click", () => {
    const onWrapperClick = vi.fn();
    const { container } = renderMessageInput(onWrapperClick);

    const toggle = screen.getByRole("button", { name: "收起消息输入框" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Button should be inside .message-input (inline, not floating)
    expect(toggle.closest(".message-input")).not.toBeNull();
    // Button should have the new class name
    expect(toggle.classList.contains("message-input-collapse-btn")).toBe(true);

    fireEvent.click(toggle);

    expect(onWrapperClick).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector(".message-input-wrapper-collapsed"),
    ).not.toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector(".message-input-wrapper-collapsed"),
    ).toBeNull();
  });

  it("hides collapse button when externally collapsed", () => {
    const { rerender } = render(
      <I18nProvider>
        <MessageInput
          onSend={vi.fn()}
          draftKey="test-external-collapse"
          collapsed={false}
        />
      </I18nProvider>,
    );

    // Button visible when not externally collapsed
    expect(
      screen.queryByRole("button", { name: "收起消息输入框" }),
    ).not.toBeNull();

    // Rerender with external collapse
    rerender(
      <I18nProvider>
        <MessageInput
          onSend={vi.fn()}
          draftKey="test-external-collapse"
          collapsed={true}
        />
      </I18nProvider>,
    );

    // Button should NOT be rendered when externally collapsed
    expect(screen.queryByRole("button", { name: "收起消息输入框" })).toBeNull();
    expect(screen.queryByRole("button", { name: "展开消息输入框" })).toBeNull();
  });
});
