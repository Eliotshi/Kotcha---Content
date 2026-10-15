"use client";

import { useEffect, useRef, useState } from "react";

type Point = { t: string; value: number };

const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Courbe d'une métrique dans le temps (une seule série : le titre la nomme, pas de légende). */
export function MetricsChart({ points, metricLabel }: { points: Point[]; metricLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(600);
  const ref = useRef<HTMLDivElement>(null);

  // Le SVG suit la largeur réelle du conteneur : le texte garde sa taille sur mobile comme sur desktop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) {
    return <p className="py-6 text-center text-sm text-text-2">La courbe apparaît à partir du deuxième relevé (prochaine collecte).</p>;
  }

  const times = points.map((p) => new Date(p.t).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const maxV = Math.max(...points.map((p) => p.value), 1);
  const x = (t: number) => PAD.left + ((t - minT) / Math.max(maxT - minT, 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / maxV) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [0, maxV / 2, maxV];
  const fmtDay = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    times.forEach((t, i) => {
      if (Math.abs(x(t) - px) < Math.abs(x(times[nearest]) - px)) nearest = i;
    });
    setHover(nearest);
  }

  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative" ref={ref}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${metricLabel} au fil des relevés`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">
              {compact.format(v)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} fontSize={11} fill="var(--muted)">
          {fmtDay(minT)}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize={11} fill="var(--muted)" textAnchor="end">
          {fmtDay(maxT)}
        </text>
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && h && (
          <>
            <line x1={x(times[hover])} x2={x(times[hover])} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(times[hover])} cy={y(h.value)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
          style={
            x(times[hover]) > W - 140
              ? { right: W - x(times[hover]) + 10 }
              : { left: x(times[hover]) + 10 }
          }
        >
          <div className="font-semibold text-text tabular">{new Intl.NumberFormat("fr-FR").format(h.value)}</div>
          <div className="text-text-2">
            {new Date(h.t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      )}
    </div>
  );
}
