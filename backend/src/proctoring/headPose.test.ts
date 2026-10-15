import { describe, expect, it } from "vitest";
import { headPose } from "./headPose.js";
import type { FaceBox } from "../face/detect.js";

// Eyes 60 px apart, mouth 60 px below them; the nose moves.
function face(noseX: number, noseY: number): FaceBox {
  return {
    score: 0.9,
    x: 0,
    y: 0,
    w: 120,
    h: 140,
    landmarks: [
      { x: 30, y: 50 },
      { x: 90, y: 50 },
      { x: noseX, y: noseY },
      { x: 40, y: 110 },
      { x: 80, y: 110 },
    ],
  };
}

describe("headPose", () => {
  it("reads a frontal face as center", () => {
    expect(headPose(face(60, 85))?.direction).toBe("center");
  });

  it("reads a turned head by where the nose sits", () => {
    expect(headPose(face(98, 85))?.direction).toBe("left");
    expect(headPose(face(22, 85))?.direction).toBe("right");
  });

  it("reads looking down and up", () => {
    expect(headPose(face(60, 108))?.direction).toBe("down");
    expect(headPose(face(60, 60))?.direction).toBe("up");
  });

  it("gives up on degenerate landmarks", () => {
    expect(headPose({ ...face(60, 85), landmarks: [] })).toBeNull();
  });
});
