import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { tr } from "@/i18n/tr";

// The cities of one country, largest first: [name, region].
type City = [string, string?];
const cache = new Map<string, Promise<City[]>>();

// One small file per country (built by scripts/build-city-lists.mjs from
// GeoNames), fetched only for the country picked.
function citiesOf(country: string): Promise<City[]> {
  let p = cache.get(country);
  if (!p) {
    p = fetch(`/geo/cities/${encodeURIComponent(country)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<City[]>) : []))
      .catch(() => []);
    cache.set(country, p);
  }
  return p;
}

const MAX_SHOWN = 50;

// A searchable dropdown of the chosen country's cities. A place too small to
// be listed can still be typed in and kept as typed.
export function CitySelect({
  country,
  value,
  onChange,
  className = "",
  placeholder,
  onRegion,
}: {
  // ISO country code (e.g. "IN"), from the country dropdown next to it.
  country: string;
  value: string;
  onChange: (city: string) => void;
  className?: string;
  placeholder?: string;
  // A listed city was picked: its state or province (e.g. to fill an address).
  onRegion?: (region: string) => void;
}) {
  const [cities, setCities] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    setCities([]);
    if (country) citiesOf(country).then((c) => !cancelled && setCities(c));
    return () => {
      cancelled = true;
    };
  }, [country]);

  // Starts-with matches first (biggest cities first), then the rest.
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return cities.slice(0, MAX_SHOWN);
    const starts: City[] = [];
    const contains: City[] = [];
    for (const c of cities) {
      const name = c[0].toLowerCase();
      if (name.startsWith(q)) starts.push(c);
      else if (name.includes(q) || c[1]?.toLowerCase().startsWith(q)) contains.push(c);
      if (starts.length >= MAX_SHOWN) break;
    }
    return [...starts, ...contains].slice(0, MAX_SHOWN);
  }, [cities, value]);
  const typedIsListed = shown.some((c) => c[0].toLowerCase() === value.trim().toLowerCase());

  useEffect(() => setActive(0), [value, country]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(city: string, region?: string) {
    onChange(city);
    if (region) onRegion?.(region);
    setOpen(false);
  }

  if (!country) {
    return <input className={`${className} opacity-60 cursor-not-allowed`} disabled placeholder={tr("Choose a country first")} value="" readOnly />;
  }

  return (
    <div className="relative">
      <input
        className={`${className} pr-9`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder ?? tr("Search your city")}
        onFocus={() => setOpen(true)}
        // Closes after a click on an option has been handled.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active][0], shown[active][1]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-input border border-rule bg-surface shadow-lg py-1"
        >
          {shown.map((c, i) => (
            <li
              key={`${c[0]}|${c[1] ?? ""}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c[0], c[1])}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${i === active ? "bg-navy/10" : ""}`}
            >
              <MapPin size={14} className="text-muted shrink-0" />
              <span className="text-ink">{c[0]}</span>
              {c[1] && <span className="text-xs text-muted truncate">{c[1]}</span>}
            </li>
          ))}
          {value.trim() && !typedIsListed && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(value.trim())}
              className="px-3 py-2 text-sm text-navy-deep cursor-pointer hover:bg-navy/10 border-t border-rule"
            >
              {shown.length ? tr("Not listed? Keep “{{city}}”", { city: value.trim() }) : tr("No city found. Keep “{{city}}”", { city: value.trim() })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
