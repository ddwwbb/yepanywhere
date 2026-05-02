import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import { initializeFontSize, useFontSize } from "../useFontSize";

describe("useFontSize", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("defaults to the default font size when no preference is stored", () => {
    const { result } = renderHook(() => useFontSize());

    expect(result.current.fontSize).toBe("default");
    expect(document.documentElement.style.fontSize).toBe("100%");
  });

  it("initializes the default font size before React renders", () => {
    initializeFontSize();

    expect(document.documentElement.style.fontSize).toBe("100%");
  });

  it("preserves an existing stored font size preference", () => {
    localStorage.setItem(UI_KEYS.fontSize, "large");

    const { result } = renderHook(() => useFontSize());

    expect(result.current.fontSize).toBe("large");
    expect(document.documentElement.style.fontSize).toBe("114.99999999999999%");
  });
});
