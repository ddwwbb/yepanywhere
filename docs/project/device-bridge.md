# Device Bridge: Extending Remote Control Beyond the Emulator

## Goal

The emulator remote control (see [android-emulator-remote-control.md](android-emulator-remote-control.md)) is complete through Phase 3. It streams a running Android emulator to any browser via WebRTC, with touch and key input over a DataChannel. The sidecar binary (`emulator-bridge`) handles encoding and WebRTC; the Yep server manages its lifecycle.

This document covers extending that same architecture to support **physical Android devices over USB** and (as a personal/internal tool) **ChromeOS devices over SSH**. The emulator path remains fully intact — we're widening the system, not replacing it.

## What Exists

The entire pipeline is built and working for emulators:

```
Phone ──(relay)──► Yep Server ──(WS IPC)──► Go sidecar ──(gRPC)──► Android Emulator
                                                  │
                                        WebRTC P2P (H.264 video + DataChannel input)
                                                  │
                                               Phone
```

Key pieces in `packages/emulator-bridge/`:
- **`internal/emulator/`** — gRPC client wrapping Android Emulator's screenshot/input API; `FrameSource` pub/sub with auto-pause when no subscribers
- **`internal/encoder/`** — RGB888→I420 conversion + x264 H.264 encoding (ultrafast/zerolatency)
- **`internal/stream/`** — Pion WebRTC peer, trickle ICE, DataChannel input handler
- **`internal/ipc/`** — session lifecycle, ref-counted resource pool, ADB discovery
- **`packages/server/src/emulator/`** — TypeScript service managing sidecar process + IPC

Everything above the `emulator/` package (encoding, WebRTC, session pool) is device-agnostic already. The emulator gRPC client is the only device-specific part.

## What Changes

### Naming

The package and all external-facing names say "emulator" when they mean any testbed device. This gets renamed throughout before adding new device types.

| Current | New |
|---|---|
| `packages/emulator-bridge/` | `packages/device-bridge/` |
| `EmulatorBridgeService` | `DeviceBridgeService` |
| `emulator_stream_start` / `emulator_webrtc_offer` / … | `device_stream_start` / `device_webrtc_offer` / … |
| `/api/emulators` | `/api/devices` |
| `EmulatorInfo`, `EmulatorStreamStart`, … | `DeviceInfo`, `DeviceStreamStart`, … |
| `capabilities.emulator` | `capabilities.deviceBridge` |
| Go IPC messages `session.start.emulatorId` | `session.start.deviceId` |

Internal Go package names (`internal/emulator/`, `internal/encoder/`, etc.) stay as-is — they're implementation details.

### Device abstraction

Currently the session pipeline talks directly to `*emulator.Client`. Extracting a `Device` interface lets `emulator.Client`, `AndroidDevice`, and `ChromeOSDevice` all plug into the same session/pool machinery:

```go
type Device interface {
    GetFrame(ctx context.Context, maxWidth int) (*Frame, error)
    SendTouch(ctx context.Context, touches []TouchPoint) error
    SendKey(ctx context.Context, key string) error
    ScreenSize() (width, height int32)
    Close() error
}
```

`emulator.Client` already has all these methods. No behavior change — just a formalized interface.

`DeviceInfo` gains a `type` field:

```go
type DeviceInfo struct {
    ID    string            // "emulator-5554", ADB serial, or hostname
    Label string            // "Pixel 7 (emulator)", "Pixel 8 Pro", "Chromebook"
    Type  string            // "emulator" | "android" | "chromeos"
    State string            // "running" | "stopped" | "connected"
}
```

### Frame capture model: pull for all device types

The emulator uses pull (sidecar polls gRPC). Physical Android and ChromeOS also use pull — neither has a public "frame ready" notification without root. The `FrameSource` polling loop works unchanged for all device types. `Device.GetFrame()` is the only addition.

---

## New Device Types

### Physical Android (primary goal)

Android devices connected via USB. No root needed. Uses the same `app_process` technique scrcpy discovered: running as the `shell` user via `adb shell app_process` is enough to call `SurfaceControl.screenshot()` and `InputManager.injectInputEvent()` via reflection.

**On-device: APK server**

A minimal APK (`yep-device-server.apk`) with no UI, no manifest permissions, no install dialog. Launched by the sidecar:

```bash
adb -s <serial> push yep-device-server.apk /data/local/tmp/
adb -s <serial> shell CLASSPATH=/data/local/tmp/yep-device-server.apk \
    app_process /system/bin com.yepanywhere.DeviceServer
adb -s <serial> forward tcp:27183 tcp:27183   # video
adb -s <serial> forward tcp:27184 tcp:27184   # control
```

APK listens on two TCP ports. No connection to the internet, no permissions.

**Wire protocol (two connections)**

Two connections separate video latency from control latency — a tap doesn't have to wait for an in-flight screenshot response:

```
Video conn (port 27183):
  Handshake (device → sidecar): [width uint16 LE][height uint16 LE]
  Loop:
    sidecar → [0x01]                         # request frame
    device  → [4-byte LE length][JPEG bytes] # JPEG at ~quality 70

Control conn (port 27184):
  sidecar → {"cmd":"touch","touches":[{"x":0.5,"y":0.3,"pressure":1.0}]}\n
  device  → {"ok":true}\n
  sidecar → {"cmd":"key","key":"back"}\n
  device  → {"ok":true}\n
```

JPEG because `Bitmap.compress(JPEG, 70, stream)` is built-in on Android and the sidecar needs to decode to YUV for x264 anyway — JPEG is smaller than raw RGB888 over the ADB forward tunnel.

**Go sidecar: `AndroidDevice`**

Implements `Device`. Connects to `localhost:27183/27184` (after sidecar does `adb forward`), reads handshake for screen dimensions, dispatches `GetFrame()` / `SendTouch()` / `SendKey()` over the two connections.

**Discovery**

`adb devices` already lists physical devices and emulators. Discovery reports both. Physical devices get `type: "android"`, emulators keep `type: "emulator"`. The sidecar handles APK push + `adb forward` automatically when a physical device is selected.

**APK distribution**

CI builds and attaches `yep-device-server.apk` to GitHub releases alongside the sidecar binary. Yep server auto-downloads it to `~/.yep-anywhere/bin/yep-device-server.apk` on first use, same mechanism as the sidecar binary.

---

### ChromeOS (personal/internal)

For Chromebooks with developer mode and SSH root access (`chromeroot` in `~/.ssh/config`). Not batteries-included — the user is expected to have SSH tunnels set up manually. No auto-discovery, no auto-deploy from the UI.

**On-device: `daemon.py`**

A thin TCP server wrapping the existing `client.py` logic. All the input and screenshot primitives already exist (`drm_screenshot` via EGL/GBM, `VirtualMouse`, evdev touch/keyboard). The daemon adds:
- TCP server on ports 27183 (video) and 27184 (control)
- Frame loop calling `drm_screenshot_jpeg()` at target FPS
- Same wire protocol as Android

Deploy manually:
```bash
scp ~/code/chromeos-testbed/daemon.py chromeroot:/mnt/stateful_partition/c2/
ssh chromeroot "python3 /mnt/stateful_partition/c2/daemon.py &"
ssh chromeroot -L 27183:localhost:27183 -L 27184:localhost:27184 -N &
```

Then add a `ChromeOSDevice` entry in the Yep server config (just a hostname/port pair). The sidecar connects to `localhost:27183/27184` through the tunnel.

**Go sidecar: `ChromeOSDevice`**

Same interface as `AndroidDevice`. The `tap`/`mouse_move`/`key` commands map directly to the existing `client.py` command set.

---

## Implementation Phases

### Phase 1 — Rename (mechanical, no behavior change)

1. Rename `packages/emulator-bridge/` → `packages/device-bridge/` (directory + build files)
2. Rename `EmulatorBridgeService` → `DeviceBridgeService` and all TypeScript types in `packages/shared/src/emulator.ts` → `devices.ts`
3. Rename WebSocket message types (`emulator_stream_*` → `device_stream_*`)
4. Rename REST routes `/api/emulators` → `/api/devices`
5. Update all imports, references, and the client UI

The emulator tab in the UI can still be labeled "Emulators" or "Devices" — that's a separate UX decision.

**Output:** identical behavior, clean naming.

### Phase 2 — Device interface + Android physical

1. Add `Device` interface in `internal/device/device.go`; make `emulator.Client` implement it (minimal wiring change in `FrameSource` + `SessionManager`)
2. Write `AndroidDevice.go` — TCP client for video/control connections
3. Write the Android APK — `app_process` entrypoint, `SurfaceControl` screenshot loop, `InputManager` injection, two TCP listeners
4. Wire `AndroidDevice` into `SessionManager` and pool; extend `adb devices` discovery to emit both types
5. Handle APK push + `adb forward` in the sidecar (or Yep server — TBD)
6. Add APK to CI build matrix

**Output:** physical Android devices stream and accept input over USB.

### Phase 3 — ChromeOS daemon (internal)

1. Write `daemon.py` in `chromeos-testbed` — TCP server wrapping `client.py`
2. Write `ChromeOSDevice.go` in `internal/device/`
3. Add ChromeOS device type to `DeviceInfo` and discovery (manual config, not auto)
4. Document the manual SSH tunnel setup

**Output:** Chromebook streams via manually configured SSH tunnel.

---

## Non-Goals

- ChromeOS auto-discovery or auto-deploy (manual setup only for now)
- WiFi Android without USB (v2 concern — ADB wireless pairing adds complexity)
- Audio streaming
- General remote desktop (this is a dev/supervision tool)
- Mouse scroll for Android (hover/scroll events ignored by most Android apps)
