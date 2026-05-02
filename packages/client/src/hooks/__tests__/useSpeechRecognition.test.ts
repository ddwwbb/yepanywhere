import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSpeechRecognitionConstructor,
  useSpeechRecognition,
} from "../useSpeechRecognition";

type RecognitionErrorName =
  | "no-speech"
  | "not-allowed"
  | "network"
  | "service-not-allowed";
type RecognitionError = Event & {
  error: RecognitionErrorName;
  message: string;
};

type SpeechRecognitionWindow = {
  SpeechRecognition?: typeof MockSpeechRecognition;
  webkitSpeechRecognition?: typeof MockSpeechRecognition;
};

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onstart: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: RecognitionError) => void) | null = null;
  onresult = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

function speechWindow(): SpeechRecognitionWindow {
  return window as unknown as SpeechRecognitionWindow;
}

function installSpeechRecognition({
  standard = false,
  webkit = true,
}: {
  standard?: boolean;
  webkit?: boolean;
} = {}) {
  MockSpeechRecognition.instances = [];
  speechWindow().SpeechRecognition = standard
    ? MockSpeechRecognition
    : undefined;
  speechWindow().webkitSpeechRecognition = webkit
    ? MockSpeechRecognition
    : undefined;
}

function currentRecognition() {
  const recognition = MockSpeechRecognition.instances.at(-1);
  if (!recognition) {
    throw new Error("Expected a speech recognition instance");
  }
  return recognition;
}

function speechError(error: RecognitionErrorName): RecognitionError {
  return { error, message: "" } as RecognitionError;
}

describe("useSpeechRecognition", () => {
  beforeEach(() => {
    installSpeechRecognition();
  });

  afterEach(() => {
    cleanup();
    speechWindow().SpeechRecognition = undefined;
    speechWindow().webkitSpeechRecognition = undefined;
    vi.restoreAllMocks();
  });

  it("supports the standard SpeechRecognition constructor used by Chromium browsers", () => {
    installSpeechRecognition({ standard: true, webkit: false });

    const { result } = renderHook(() => useSpeechRecognition());

    expect(getSpeechRecognitionConstructor()).toBe(MockSpeechRecognition);
    expect(result.current.isSupported).toBe(true);

    act(() => result.current.startListening());
    expect(currentRecognition().start).toHaveBeenCalledTimes(1);
  });

  it("falls back to the webkitSpeechRecognition constructor", () => {
    installSpeechRecognition({ standard: false, webkit: true });

    const { result } = renderHook(() => useSpeechRecognition());

    expect(getSpeechRecognitionConstructor()).toBe(MockSpeechRecognition);
    expect(result.current.isSupported).toBe(true);

    act(() => result.current.startListening());
    expect(currentRecognition().start).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported when no speech recognition constructor exists", () => {
    installSpeechRecognition({ standard: false, webkit: false });

    const { result } = renderHook(() => useSpeechRecognition());

    expect(getSpeechRecognitionConstructor()).toBeNull();
    expect(result.current.isSupported).toBe(false);

    act(() => result.current.startListening());
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Speech recognition not supported");
  });

  it("does not auto-restart after fatal recognition errors", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    act(() => result.current.startListening());
    const recognition = currentRecognition();
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => recognition.onstart?.(new Event("start")));
    expect(result.current.isListening).toBe(true);

    act(() => recognition.onerror?.(speechError("not-allowed")));
    expect(onError).toHaveBeenCalledWith("Microphone permission denied");
    expect(result.current.status).toBe("error");

    act(() => recognition.onend?.(new Event("end")));
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Microphone permission denied");
    expect(result.current.isListening).toBe(false);
  });

  it("reports speech service errors without auto-restarting", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    act(() => result.current.startListening());
    const recognition = currentRecognition();

    act(() => recognition.onstart?.(new Event("start")));
    act(() => recognition.onerror?.(speechError("service-not-allowed")));

    const message =
      "Speech recognition service is not available in this browser";
    expect(onError).toHaveBeenCalledWith(message);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(message);

    act(() => recognition.onend?.(new Event("end")));
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
  });

  it("reports speech service network errors without auto-restarting", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ onError }));

    act(() => result.current.startListening());
    const recognition = currentRecognition();

    act(() => recognition.onstart?.(new Event("start")));
    act(() => recognition.onerror?.(speechError("network")));

    const message = "Speech recognition service network error in this browser";
    expect(onError).toHaveBeenCalledWith(message);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(message);

    act(() => recognition.onend?.(new Event("end")));
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
  });

  it("continues auto-restarting after no-speech events", () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => result.current.startListening());
    const recognition = currentRecognition();
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => recognition.onstart?.(new Event("start")));
    act(() => recognition.onerror?.(speechError("no-speech")));
    expect(result.current.error).toBe("No speech detected");

    act(() => recognition.onend?.(new Event("end")));
    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("reconnecting");
    expect(result.current.error).toBeNull();
  });
});
