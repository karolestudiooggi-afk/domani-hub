import { describe, it, expect } from "vitest";
import { HF_VIDEO_MODELS, getHfModel } from "./higgsfield-models";

describe("higgsfield-models", () => {
  it("getHfModel encontra por id e retorna undefined p/ inexistente", () => {
    expect(getHfModel("kling-video/v2.6/pro/text-to-video")?.family).toBe("Kling");
    expect(getHfModel("inexistente")).toBeUndefined();
  });

  it("tem ao menos 4 modelos text-to-video com durações válidas", () => {
    const tv = HF_VIDEO_MODELS.filter((m) => m.kind === "text-to-video");
    expect(tv.length).toBeGreaterThanOrEqual(4);
    for (const m of tv) {
      expect(m.durations.length).toBeGreaterThan(0);
      expect(m.durations.every((d) => d > 0)).toBe(true);
    }
  });

  it("DoP é image-to-video sem áudio", () => {
    const dop = getHfModel("higgsfield-ai/dop/standard");
    expect(dop?.kind).toBe("image-to-video");
    expect(dop?.supportsAudio).toBe(false);
  });
});
