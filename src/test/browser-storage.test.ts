import { expect, it } from "vitest";

it("uses jsdom document storage even when Node provides its own Web Storage globals", () => {
  const dom = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom;
  for (const key of ["localStorage", "sessionStorage"] as const) {
    const storage = globalThis[key];
    expect(storage).toBe(dom.window[key]);
    expect(window[key]).toBe(storage);
    storage.setItem("browser-storage-probe", key);
    expect(dom.window[key].getItem("browser-storage-probe")).toBe(key);
    storage.removeItem("browser-storage-probe");
  }
});
