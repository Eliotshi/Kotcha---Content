// Calcul pur du score à âge égal (sans accès base) : testable isolément. Voir scoring.ts pour la méthode.

export type Point = { age: number; value: number };

export const MAX_REFERENCE_POSTS = 30;
const EARLY_GROWTH_EXPONENT = 0.5;

export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Valeur d'une série à l'âge `age` (interpolation ; null si l'âge dépasse le dernier relevé). */
export function valueAtAge(series: Point[], age: number): { value: number; estimated: boolean } | null {
  if (!series.length) return null;
  const last = series[series.length - 1];
  if (age > last.age * 1.1) return null; // pas d'extrapolation au-delà du dernier relevé (+10 % de tolérance)
  if (age >= last.age) return { value: last.value, estimated: false };
  const firstPoint = series[0];
  if (age < firstPoint.age) {
    // Avant le premier relevé : croissance concave (les vues arrivent surtout au début).
    return { value: firstPoint.value * Math.pow(Math.max(age, 0) / firstPoint.age, EARLY_GROWTH_EXPONENT), estimated: true };
  }
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (age <= b.age) {
      const t = (age - a.age) / (b.age - a.age || 1);
      return { value: a.value + t * (b.value - a.value), estimated: false };
    }
  }
  return { value: last.value, estimated: false };
}

/**
 * Compare le dernier relevé d'un post aux autres posts (séries triées par âge, du plus récent au plus ancien post)
 * pris au même âge.
 */
export function scoreAgainst(latest: Point, others: Point[][]) {
  const refs: number[] = [];
  let estimatedCount = 0;
  for (const series of others) {
    const v = valueAtAge(series, latest.age);
    if (!v) continue;
    refs.push(v.value);
    if (v.estimated) estimatedCount++;
    if (refs.length >= MAX_REFERENCE_POSTS) break;
  }
  const sample = refs.length;
  const baseline = sample ? median(refs) : null;
  const confidence = sample >= 10 ? "high" : sample >= 5 ? "medium" : sample >= 3 ? "low" : null;
  const score = confidence && baseline && baseline > 0 ? Math.round((latest.value / baseline) * 100) / 100 : null;
  return { baseline, sample, confidence, score, estimated: sample > 0 && estimatedCount / sample > 0.5 };
}
