import { ImageResponse } from "next/og";

export const alt = "Spica by Edstellar: measure, build and certify English";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture shown when a Spica page is shared on LinkedIn, WhatsApp, Slack and so on.
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #fcfaf6 0%, #f6efe4 55%, #f3d7c6 100%)",
          color: "#1d1712",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40, fontWeight: 700, color: "#8f4526" }}>Spica by Edstellar</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Measure English. Build it. Certify it.</div>
          <div style={{ fontSize: 32, color: "#6b5d4e" }}>CEFR A1–C2 · proctored tests · certificates anyone can check</div>
        </div>
      </div>
    ),
    size,
  );
}
