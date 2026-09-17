import { describe, expect, test, vi } from "vitest";
import {
  computeDpadPanVector,
  computeJoystickPanVector,
  createRemoteJoystickController,
  getPanSpeedFactorForZoom,
} from "../../frontend/src/remote/remote-joystick-controls.js";

const viewport = {
  zoom: 15,
  bbox: [0, 0, 100, 50],
};

describe("remote joystick controls", () => {
  test("speed factor tightens as zoom increases", () => {
    expect(getPanSpeedFactorForZoom(14)).toBe(0.32);
    expect(getPanSpeedFactorForZoom(15)).toBe(0.28);
    expect(getPanSpeedFactorForZoom(18)).toBe(0.16);
  });

  test("deadzone and missing bbox produce a zero vector", () => {
    expect(computeJoystickPanVector({ force: 0.1, angleRad: 0, viewport })).toEqual({
      dx: 0,
      dy: 0,
    });
    expect(computeJoystickPanVector({ force: 1, angleRad: 0, viewport: {} })).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  test("eastward stick maps to a positive ITM x at identity orientation", () => {
    const vector = computeJoystickPanVector({
      force: 1,
      angleRad: 0,
      viewport,
      viewerAngleDeg: 0,
    });
    expect(vector.dx).toBeCloseTo(100 * 0.28);
    expect(vector.dy).toBeCloseTo(0);
  });

  test("north dpad maps to a positive ITM y at identity orientation", () => {
    const vector = computeDpadPanVector({
      vx: 0,
      vy: 1,
      viewport,
      viewerAngleDeg: 0,
    });
    expect(vector.dx).toBeCloseTo(0);
    expect(vector.dy).toBeCloseTo(50 * 0.28);
  });

  test("init binds nipple events and throttles velocity", () => {
    vi.useFakeTimers();
    const zone = { classList: { add: vi.fn(), remove: vi.fn() } };
    const handlers = {};
    const nipple = {
      create: vi.fn(() => ({
        on(name, fn) {
          handlers[name] = fn;
        },
        destroy: vi.fn(),
      })),
    };
    const sendVelocity = vi.fn();
    const controller = createRemoteJoystickController({
      zone,
      nipplejs: nipple,
      isConnected: () => true,
      getViewport: () => viewport,
      getViewerAngleDeg: () => 0,
      sendVelocity,
    });

    controller.init();
    handlers.start();
    handlers.move(null, { force: 1, angle: { radian: 0 } });
    handlers.move(null, { force: 1, angle: { radian: 0 } });
    expect(sendVelocity).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    handlers.move(null, { force: 1, angle: { radian: 0 } });
    expect(sendVelocity).toHaveBeenCalledTimes(2);
    handlers.end();
    expect(sendVelocity).toHaveBeenLastCalledWith(0, 0);
    vi.useRealTimers();
  });

  test("init waits until the zone has a layout box", () => {
    const zone = {
      classList: { add: vi.fn(), remove: vi.fn() },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
    };
    const nipple = { create: vi.fn() };
    const controller = createRemoteJoystickController({
      zone,
      nipplejs: nipple,
      isConnected: () => true,
      getViewport: () => viewport,
      sendVelocity: vi.fn(),
    });
    expect(controller.init()).toBeNull();
    expect(nipple.create).not.toHaveBeenCalled();
    zone.getBoundingClientRect = () => ({ width: 100, height: 100 });
    nipple.create.mockReturnValue({ on: vi.fn(), destroy: vi.fn() });
    expect(controller.init()).toBeTruthy();
    expect(nipple.create).toHaveBeenCalledTimes(1);
  });

  test("init uses globalThis.nipplejs when no library is passed", () => {
    const zone = { classList: { add: vi.fn(), remove: vi.fn() } };
    const create = vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() }));
    const previous = globalThis.nipplejs;
    globalThis.nipplejs = { create };
    try {
      const controller = createRemoteJoystickController({
        zone,
        isConnected: () => true,
        getViewport: () => viewport,
        sendVelocity: vi.fn(),
      });
      expect(controller.init()).toBeTruthy();
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.nipplejs = previous;
    }
  });
});
