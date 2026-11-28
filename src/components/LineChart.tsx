/** A small, readable line chart for one measure over sessions (e.g. pain
 * 0-10). Plain SVG with theme colours; values are labelled on every point so
 * nobody has to read them off the axis. */
export function LineChart({
  points, yMax, yMin = 0, title, unit = '', testId,
}: {
  points: { label: string; value: number }[];
  yMax: number;
  /** Bottom of the scale (default 0), so a narrow range like body temperature shows its trend. */
  yMin?: number;
  title: string;
  unit?: string;
  testId?: string;
}) {
  const w = 640, h = 220, left = 44, right = 52, top = 24, bottom = 40;
  const iw = w - left - right, ih = h - top - bottom;
  const x = (i: number) => left + (points.length <= 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const span = yMax - yMin || 1;
  const y = (v: number) => top + ih - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / span) * ih;
  const ticks = [yMin, Math.round(((yMin + yMax) / 2) * 10) / 10, yMax];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.value)}`).join(' ');

  return (
    <figure className="m-0" data-testid={testId}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--ink-faint)">{t}</text>
          </g>
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r="5" fill="var(--surface-solid)" stroke="var(--accent)" strokeWidth="2.5" />
            <text x={x(i)} y={y(p.value) - 12} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">{p.value}{unit}</text>
            <text x={x(i)} y={h - 14} textAnchor="middle" fontSize="12" fill="var(--ink-faint)">{p.label}</text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">{title}</figcaption>
    </figure>
  );
}
