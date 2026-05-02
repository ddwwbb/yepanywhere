import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "../useSpeechRecognition";

type RecognitionErrorName = "no-speech" | "not-allowed";
type RecognitionError = Event & {
  error: RecognitionErrorName;
  message: string;
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

function installSpeechRecognition() {
  MockSpeechRecognition.instances = [];
  (
    window as unknown as {
      webkitSpeechRecognition?: typeof MockSpeechRecognition;
    }
  ).webkitSpeechRecognition = MockSpeechRecognition;
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
    (
      window as unknown as {
        webkitSpeechRecognition?: typeof MockSpeechRecognition;
      }
    ).webkitSpeechRecognition = undefined;
    vi.restoreAllMocks();
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
