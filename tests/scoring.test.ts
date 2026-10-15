import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAgainst, valueAtAge } from "../src/lib/scoring-core.ts";

// Historique type : 12 posts relevés à 20 h, 68 h et 116 h (≈10 000 → 20 000 → 24 000 vues, avec dispersion).
const history = Array.from({ length: 12 }, (_, i) => {
  const k = 0.8 + (i % 5) * 0.1;
  return [
    { age: 20, value: 10_000 * k },
    { age: 68, value: 20_000 * k },
    { age: 116, value: 24_000 * k },
  ];
});

test("un post jeune est noté sur son rythme : 6 000 vues en 1 h surperforme, 200 vues sous-performe", () => {
  const fast = scoreAgainst({ age: 1, value: 6_000 }, history);
  const slow = scoreAgainst({ age: 1, value: 200 }, history);
  assert.ok(fast.score! > 2);
  assert.ok(slow.score! < 0.2);
  assert.equal(fast.estimated, true); // référence estimée avant le 1er relevé des autres posts
});

test("biais d'âge corrigé : un post de 20 h est comparé aux autres à 20 h, pas à leur total final", () => {
  const young = scoreAgainst({ age: 20, value: 10_000 }, history);
  assert.ok(young.score! > 0.9 && young.score! < 1.2);
  assert.equal(young.estimated, false);
});

test("interpolation entre relevés, sans extrapolation au-delà du dernier", () => {
  assert.equal(valueAtAge([{ age: 20, value: 100 }, { age: 60, value: 300 }], 40)!.value, 200);
  assert.equal(valueAtAge([{ age: 20, value: 100 }], 100), null);
});

test("pas de score sans au moins 3 posts comparables, fiabilité selon l'échantillon", () => {
  const few = scoreAgainst({ age: 20, value: 5_000 }, history.slice(0, 2));
  assert.equal(few.score, null);
  assert.equal(scoreAgainst({ age: 20, value: 5_000 }, history.slice(0, 4)).confidence, "low");
  assert.equal(scoreAgainst({ age: 20, value: 5_000 }, history.slice(0, 7)).confidence, "medium");
  assert.equal(scoreAgainst({ age: 20, value: 5_000 }, history).confidence, "high");
});
