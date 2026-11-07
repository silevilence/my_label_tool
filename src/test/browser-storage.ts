import { afterAll } from "vitest";

// Vitest's jsdom environment leaves existing Node Web Storage globals in place.
// Bind the real, per-document browser storage before application modules load.
const dom = (globalThis as typeof globalThis & { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
    afterAll(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}
