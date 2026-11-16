import Link from "next/link";
import { LEVELS } from "@/lib/levels";

// The Spica scale as bars, one per CEFR level; each bar opens that level's page.
export function LevelScale({ active }: { active?: string }) {
  return (
    <div className="ladder" aria-label="The Spica scale from 10 to 90 and the CEFR levels">
      <div className="ladder-head">
        <b>Spica score → CEFR level</b>
        <span>10–19 is below A1</span>
      </div>
      <div className="ladder-bars">
        {LEVELS.map((l, i) => (
          <Link key={l.code} href={`/levels/${l.slug}`} className={`ladder-col${l.code === (active ?? "B2") ? " hl" : ""}`} style={{ ["--h" as string]: `${28 + i * 13}%` }}>
            <div className="ladder-bar">
              <b>{l.code}</b>
            </div>
            <small>{l.range}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

