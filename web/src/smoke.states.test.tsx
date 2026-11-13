// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { REGISTRY } from "./screens/registry";
import { resetDemo, set } from "./state/store";
import { setupSmoke, wait } from "./test/smokeHarness";

setupSmoke();

describe("every registered state renders", () => {
  for (const screen of REGISTRY)
    for (const st of screen.states)
      it(`${screen.id}/${st.key}`, async () => {
        await act(async () => {
          resetDemo();
          set(() => ({ auth: "in", frame: "fluid" }));
        });
        await act(async () => st.apply());
        await wait(30);
        expect(document.querySelector("main")).toBeTruthy();
        expect(document.querySelector("[data-page-title]")).toBeTruthy();
      });
});
