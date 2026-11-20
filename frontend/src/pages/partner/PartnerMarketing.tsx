// The Affiliate's marketing kit (owner, 20 Nov 2026): ready banners to
// download, ready posts with the Affiliate's own link filled in, a short pitch
// and the rules. Everything says only what Spica's own materials say (no
// "official" or "accredited", and the AI tutor is not promoted). The posts are
// in English, the language Spica's tests are in.
import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Image as ImageIcon, MessageSquare, Mic, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { PageError, PageHeader, PageLoading } from "@/components/staff/StaffKit";
import { tr } from "@/i18n/tr";

interface Aff {
  code: string;
  link: string;
}

const BRAND = { clay: "#c0603b", clayDark: "#8f3e22", cream: "#fbf6ef", ink: "#2e2419" };

// One banner as an SVG string (also drawn to a PNG for download).
function bannerSvg(w: number, h: number, link: string, code: string, headline: string[], sub: string) {
  const s = Math.min(w, h) / 1080;
  const fs = (n: number) => Math.round(n * s);
  const x = fs(80);
  const top = h * 0.2;
  const lines = headline.map((t, i) => `<text x="${x}" y="${top + fs(110) * i}" font-size="${fs(96)}" font-weight="800" fill="${BRAND.ink}" font-family="Arial, Helvetica, sans-serif">${t}</text>`).join("");
  const host = link.replace(/^https?:\/\//, "").split("?")[0];
  // Wrap the small line to the banner's width (about 0.5 em per character).
  const perLine = Math.max(16, Math.floor((w - 2 * x) / (fs(40) * 0.52)));
  const subLines = sub.split(" ").reduce<string[]>((acc, word) => {
    const last = acc[acc.length - 1];
    if (last !== undefined && (last + " " + word).length <= perLine) acc[acc.length - 1] = last + " " + word;
    else acc.push(word);
    return acc;
  }, []);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BRAND.cream}"/>
  <circle cx="${w * 0.92}" cy="${h * 0.08}" r="${fs(320)}" fill="${BRAND.clay}" opacity="0.12"/>
  <circle cx="${w * 0.05}" cy="${h * 0.95}" r="${fs(260)}" fill="${BRAND.clay}" opacity="0.10"/>
  <rect x="${x}" y="${fs(70)}" width="${fs(70)}" height="${fs(70)}" rx="${fs(16)}" fill="${BRAND.clay}"/>
  <text x="${x + fs(90)}" y="${fs(122)}" font-size="${fs(48)}" font-weight="700" fill="${BRAND.clayDark}" font-family="Georgia, serif">Spica</text>
  ${lines}
  ${subLines.map((t, i) => `<text x="${x}" y="${top + fs(110) * headline.length + fs(30) + fs(52) * i}" font-size="${fs(40)}" fill="${BRAND.ink}" opacity="0.75" font-family="Arial, Helvetica, sans-serif">${t}</text>`).join("")}
  <rect x="${x}" y="${h - fs(250)}" width="${fs(560)}" height="${fs(96)}" rx="${fs(48)}" fill="${BRAND.clay}"/>
  <text x="${x + fs(48)}" y="${h - fs(188)}" font-size="${fs(40)}" font-weight="700" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">Take the free level test</text>
  <text x="${x}" y="${h - fs(90)}" font-size="${fs(34)}" fill="${BRAND.ink}" font-family="Arial, Helvetica, sans-serif">${host} · code ${code}</text>
</svg>`;
}

const BANNERS = [
  { key: "square", name: tr("Instagram or Facebook post"), w: 1080, h: 1080, headline: ["Find your", "English level.", "Prove it."], sub: "A level for each skill, and a certificate employers can check." },
  { key: "story", name: tr("Story or WhatsApp status"), w: 1080, h: 1920, headline: ["Know your", "real English", "level."], sub: "Speaking, listening, reading and writing." },
  { key: "wide", name: tr("LinkedIn or Facebook link"), w: 1200, h: 628, headline: ["English proof", "employers can check."], sub: "Free level test, practice and a checkable certificate." },
];

async function downloadPng(svg: string, w: number, h: number, file: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("image"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PartnerMarketing() {
  const [d, setD] = useState<Aff | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const load = () => api<Aff>("/partner/affiliate").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  const posts = useMemo(() => {
    if (!d) return [];
    const l = (src: string) => `${d.link}&src=${src}`;
    return [
      { key: "level", title: tr("Know your level"), src: "post", text: `Not sure what your English level really is? Take Spica's free placement test and get a level for speaking, listening, reading and writing: ${l("post")} (partner link)` },
      { key: "proof", title: tr("Proof for a job or university"), src: "post", text: `Need proof of your English for a job or university? Spica's proctored test ends in a certificate employers can check online, and you can add it to LinkedIn: ${l("post")} (partner link)` },
      { key: "prepare", title: tr("Preparing for a test"), src: "post", text: `Preparing for an English test? Practise every question type, take timed mock tests and see your level before the real test, on Spica: ${l("post")} (partner link)` },
      { key: "whatsapp", title: tr("Short message for WhatsApp"), src: "whatsapp", text: `Free English level test, with a level for each skill: ${l("whatsapp")} (partner link)` },
    ];
  }, [d]);
  if (failed) return <PageError message={tr("Could not load your marketing kit.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  const card = "bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4";
  const pitch =
    "Spica is an online English platform from Edstellar. You start with a free placement test that gives you a level for each skill: speaking, listening, reading and writing. You can practise every question type and take timed mock tests. When you're ready, a proctored test gives you a Spica score and a certificate that employers can check online.";
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Marketing kit")} subtitle={tr("Ready-made banners and posts with your own link already in them. Download, copy and share.")} />

      <section className={card}>
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <ImageIcon size={18} className="text-navy" /> {tr("Banners")}
        </h2>
        <p className="text-sm text-muted">{tr("Each banner shows your partner code, so people can type it if they don't click your link.")}</p>
        <div className="grid md:grid-cols-3 gap-4">
          {BANNERS.map((b) => {
            const svg = bannerSvg(b.w, b.h, d.link, d.code, b.headline, b.sub);
            return (
              <div key={b.key} className="flex flex-col gap-2">
                <div className="rounded-input border border-rule overflow-hidden bg-paper-warm flex items-center justify-center" style={{ aspectRatio: "1 / 1" }}>
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={b.name} className="max-h-full max-w-full" />
                </div>
                <p className="text-sm font-semibold">{b.name}</p>
                <p className="text-xs text-muted">
                  {b.w} × {b.h}
                </p>
                <Button variant="secondary" className="self-start flex items-center gap-1.5" onClick={() => downloadPng(svg, b.w, b.h, `spica-${b.key}-${d.code}.png`)}>
                  <Download size={14} /> {tr("Download PNG")}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className={card}>
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <MessageSquare size={18} className="text-navy" /> {tr("Ready posts")}
        </h2>
        <p className="text-sm text-muted">{tr("Your link is already in each post, tagged so your Track record shows where people came from. The posts are in English, like Spica's tests.")}</p>
        <div className="grid md:grid-cols-2 gap-4">
          {posts.map((p) => (
            <div key={p.key} className="rounded-input border border-rule p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold">{p.title}</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{p.text}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="flex items-center gap-1.5" onClick={() => copy(p.key, p.text)}>
                  <Copy size={14} /> {copied === p.key ? tr("Copied") : tr("Copy")}
                </Button>
                <a className="inline-flex items-center gap-1.5 rounded-pill border border-rule px-4 py-2 text-sm font-semibold text-ink" href={`https://wa.me/?text=${encodeURIComponent(p.text)}`} target="_blank" rel="noreferrer">
                  {tr("Share on WhatsApp")}
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <Mic size={18} className="text-navy" /> {tr("Short pitch")}
        </h2>
        <p className="text-sm text-muted">{tr("About 30 seconds, for a video, a call or a chat.")}</p>
        <p className="text-sm text-ink rounded-input bg-paper-warm/70 p-4">{pitch}</p>
        <Button variant="secondary" className="self-start flex items-center gap-1.5" onClick={() => copy("pitch", pitch)}>
          <Copy size={14} /> {copied === "pitch" ? tr("Copied") : tr("Copy")}
        </Button>
      </section>

      <section className={card}>
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <ShieldCheck size={18} className="text-navy" /> {tr("Rules for promoting Spica")}
        </h2>
        <ul className="text-sm text-ink list-disc pl-5 flex flex-col gap-1.5">
          <li>{tr("Say clearly that you are paid for referrals, for example \"partner link\" or #ad.")}</li>
          <li>{tr("Describe Spica only as Spica's own materials do. Don't promise a score, a pass or a job.")}</li>
          <li>{tr("Don't call Spica or its certificate \"official\" or \"accredited\", and don't compare it with other named tests.")}</li>
          <li>{tr("Don't send messages to people who haven't agreed to hear from you, and don't buy ads on the word \"Spica\".")}</li>
          <li>{tr("Don't use your own link to buy for yourself. Spica checks for this and may cancel those earnings.")}</li>
        </ul>
      </section>
    </div>
  );
}
