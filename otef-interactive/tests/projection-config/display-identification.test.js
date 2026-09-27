import { afterEach, expect, test, vi } from "vitest";
import { createOutputWindowController } from "../../frontend/src/projection-config/output-window-controller.js";

const displays = [
  { label: "Same projector", left: 1920, top: 0, width: 1920, height: 1080 },
  { label: "Same projector", left: -1920, top: 0, width: 1920, height: 1080 },
  { label: "Laptop", left: 0, top: 0, width: 1920, height: 1080 },
];
const controllers = [];
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose?.()); vi.useRealTimers(); });

function setup() {
  const details = new EventTarget();
  details.screens = displays;
  const screenApi = { getScreenDetails: vi.fn(async () => details) };
  const opened = [];
  const open = vi.fn((url, name, features) => {
    const win = { closed: false, close: vi.fn(() => { win.closed = true; }), focus: vi.fn() };
    opened.push({ url, name, features, win });
    return win;
  });
  const controller = createOutputWindowController({ open, screenApi, navigatorApi: {}, storage: null, location: "http://localhost/otef-interactive/projection.html", sessionId: "identify-test" });
  controllers.push(controller);
  return { controller, details, screenApi, open, opened };
}

test("discovery lists numbered screens without opening windows and keeps numbers stable on reorder", async () => {
  const { controller, details, open } = setup();
  const screens = await controller.refreshDisplays();
  expect(screens.map((screen) => screen.displayNumber)).toEqual([3, 1, 2]);
  expect(open).not.toHaveBeenCalled();
  details.screens = [...displays].reverse();
  const reordered = await controller.refreshDisplays();
  expect(reordered.find((screen) => screen.left === -1920).displayNumber).toBe(1);
});

test("Identify immediately opens one numbered badge per discovered screen, with no discovery request", async () => {
  vi.useFakeTimers();
  const { controller, open, opened, screenApi } = setup();
  await controller.refreshDisplays();
  screenApi.getScreenDetails.mockClear();
  controller.identifyDisplays();
  expect(open).toHaveBeenCalledTimes(3);
  expect(screenApi.getScreenDetails).not.toHaveBeenCalled();
  expect(opened.map(({ url }) => new URL(url).searchParams.get("display"))).toEqual(["3", "1", "2"]);
  expect(opened.every(({ url, name }) => url.includes("display-identify.html") && name.includes("display-identify"))).toBe(true);
  expect(opened[1].features).toContain("left=-1140");
  expect(controller.getOwnedWindows().size).toBe(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(opened.every(({ win }) => win.closed)).toBe(true);
});

test("repeated identification and Close Both clean up only temporary badges", async () => {
  vi.useFakeTimers();
  const { controller, opened } = setup();
  await controller.refreshDisplays();
  controller.identifyDisplays();
  controller.identifyDisplays();
  expect(opened.slice(0, 3).every(({ win }) => win.closed)).toBe(true);
  expect(opened.slice(3).every(({ win }) => !win.closed)).toBe(true);
  controller.closeBoth();
  expect(opened.every(({ win }) => win.closed)).toBe(true);
});

test("blocked badge cleans up partial identification and preserves discovered choices", async () => {
  const { controller, open, opened } = setup();
  await controller.refreshDisplays();
  const normalOpen = open.getMockImplementation();
  open.mockImplementationOnce(normalOpen).mockImplementationOnce(() => null);
  expect(() => controller.identifyDisplays()).toThrow(/popup|pop-up/i);
  expect(opened[0].win.closed).toBe(true);
  expect(controller.getState().screens).toHaveLength(3);
  expect(controller.getState().error).toMatch(/popup|pop-up/i);
});

test("screen changes refresh choices automatically, clear badges, and preserve assignment identity", async () => {
  const { controller, details, opened } = setup();
  const screens = await controller.refreshDisplays();
  controller.assignDisplays({ left: screens[1].key, right: screens[0].key });
  const assignments = controller.getState().assignments;
  controller.identifyDisplays();
  details.screens = displays.slice(0, 2);
  details.dispatchEvent(new Event("screenschange"));
  await vi.waitFor(() => expect(controller.getState().screens).toHaveLength(2));
  expect(opened.every(({ win }) => win.closed)).toBe(true);
  expect(controller.getState().assignments).toEqual(assignments);
  controller.dispose();
  details.screens = displays;
  details.dispatchEvent(new Event("screenschange"));
  expect(controller.getState().screens).toHaveLength(2);
});

test("denied automatic discovery opens no windows and identifies no screens", async () => {
  const { controller, screenApi, open } = setup();
  screenApi.getScreenDetails.mockRejectedValue(new Error("Permission denied"));
  await expect(controller.refreshDisplays()).rejects.toThrow(/permission/i);
  expect(controller.getState().screens).toEqual([]);
  expect(controller.getState().error).toMatch(/permission/i);
  expect(open).not.toHaveBeenCalled();
});

test("rearranging existing displays refreshes badge positions without a screenschange event", async () => {
  const { controller, details, opened } = setup();
  details.screens = displays.map((display) => Object.assign(new EventTarget(), display));
  await controller.refreshDisplays();
  const moved = details.screens[0];
  moved.left = -3840;
  moved.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(controller.getState().screens[0].left).toBe(-3840));
  expect(controller.getState().screens[0].displayNumber).toBe(1);
  controller.identifyDisplays();
  expect(opened[0].features).toContain("left=-3060");
  controller.dispose();
  moved.left = 1920;
  moved.dispatchEvent(new Event("change"));
  expect(controller.getState().screens[0].left).toBe(-3840);
});
