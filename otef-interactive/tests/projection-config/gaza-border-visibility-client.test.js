import { beforeEach, describe, expect, it, vi } from "vitest";
import * as visibility from "../../frontend/src/projection-config/gaza-border-visibility-client.js";

function setup({ getSnapshot = async () => ({ gaza_border_visible: false }), writeVisible = async visible => ({ gaza_border_visible: visible }) } = {}) {
  const listeners = new Map();
  const socket = { on: (event, callback) => listeners.set(event, callback), off: event => listeners.delete(event) };
  const client = visibility.createGazaBorderVisibilityClient({ getSnapshot, writeVisible, socket });
  const receive = (visible, table = "otef") => listeners.get("otef_gaza_border_visibility_changed")?.({ table, gazaBorderVisible: visible });
  return { client, receive, listeners };
}

describe("saved Gaza border visibility", () => {
  beforeEach(() => expect(visibility.createGazaBorderVisibilityClient).toBeTypeOf("function"));

  it("starts hidden and hydrates the shared value after a page reload", async () => {
    const { client } = setup({ getSnapshot: async () => ({ gaza_border_visible: true }) });
    expect(client.getState()).toMatchObject({ visible: false, loading: true });
    await client.hydrate();
    expect(client.getState()).toMatchObject({ visible: true, loading: false });
    client.destroy();
  });

  it("waits for persistence acknowledgement before showing the saved state", async () => {
    let finish;
    const { client } = setup({ writeVisible: () => new Promise(resolve => { finish = resolve; }) });
    await client.hydrate();
    const saving = client.setVisible(true);
    expect(client.getState()).toMatchObject({ visible: false, pending: true });
    finish({ gaza_border_visible: true });
    expect(await saving).toMatchObject({ ok: true });
    expect(client.getState()).toMatchObject({ visible: true, pending: false });
    client.destroy();
  });

  it("keeps the last saved state when saving fails", async () => {
    const { client } = setup({ writeVisible: async () => { throw new Error("Connection unavailable"); } });
    await client.hydrate();
    expect(await client.setVisible(true)).toMatchObject({ ok: false });
    expect(client.getState()).toMatchObject({ visible: false, pending: false, error: "Connection unavailable" });
    client.destroy();
  });

  it("keeps a newer shared change when an older hydration request finishes", async () => {
    let finish;
    const { client, receive } = setup({ getSnapshot: () => new Promise(resolve => { finish = resolve; }) });
    const hydration = client.hydrate();
    receive(true);
    finish({ gaza_border_visible: false });
    await hydration;
    expect(client.getState().visible).toBe(true);
    receive(false, "other-table");
    expect(client.getState().visible).toBe(true);
    client.destroy();
  });

  it("keeps a newer shared receipt when a previous write response arrives late", async () => {
    let finish;
    const { client, receive } = setup({ writeVisible: () => new Promise(resolve => { finish = resolve; }) });
    await client.hydrate();
    const saving = client.setVisible(true);
    receive(true);
    receive(false);
    finish({ gaza_border_visible: true });
    await saving;
    expect(client.getState().visible).toBe(false);
    client.destroy();
  });

  it("keeps a saved change when a reconnect read finishes with the previous value", async () => {
    let save, read;
    const { client } = setup({ writeVisible: () => new Promise(resolve => { save = resolve; }), getSnapshot: vi.fn()
      .mockResolvedValueOnce({ gaza_border_visible: false })
      .mockImplementationOnce(() => new Promise(resolve => { read = resolve; })) });
    await client.hydrate();
    const saving = client.setVisible(true);
    const hydration = client.hydrate();
    save({ gaza_border_visible: true });
    await saving;
    read({ gaza_border_visible: false });
    await hydration;
    expect(client.getState().visible).toBe(true);
    client.destroy();
  });
});
