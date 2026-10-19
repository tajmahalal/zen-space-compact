import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMap,
  pruneMap,
  wantCompact,
  setChoice,
  shouldRecord,
  matchExpected,
} from "../space-compact.uc.mjs";

test("matchExpected treats the value the mod set as its own change, once", () => {
  assert.deepEqual(matchExpected(true, true), { own: true, expected: null });
  assert.deepEqual(matchExpected(null, true), { own: false, expected: null });
  assert.deepEqual(matchExpected(false, true), { own: false, expected: false });
});

test("parseMap reads saved booleans", () => {
  assert.deepEqual(parseMap('{"a":true,"b":false}'), { a: true, b: false });
});

test("parseMap returns {} for invalid or non-object input", () => {
  for (const raw of ["not json", null, undefined, "[1]", '"x"', "null"]) {
    assert.deepEqual(parseMap(raw), {}, `input: ${raw}`);
  }
});

test("parseMap drops non-boolean values", () => {
  assert.deepEqual(parseMap('{"a":true,"b":"yes"}'), { a: true });
});

test("pruneMap keeps only existing spaces", () => {
  assert.deepEqual(pruneMap({ a: true, b: false }, ["a"]), { a: true });
});

test("pruneMap leaves the map alone when no spaces are known yet", () => {
  assert.deepEqual(pruneMap({ a: true }, []), { a: true });
});

test("wantCompact is true only for a saved true", () => {
  assert.equal(wantCompact({ a: true }, "a"), true);
  assert.equal(wantCompact({ a: false }, "a"), false);
  assert.equal(wantCompact({}, "z"), false);
});

test("setChoice returns a new map without mutating the input", () => {
  const m = {};
  assert.deepEqual(setChoice(m, "a", true), { a: true });
  assert.deepEqual(m, {});
});

test("shouldRecord ignores the mod's own toggles and switches", () => {
  assert.equal(shouldRecord({ applying: true, switching: false, uuid: "a" }), false);
  assert.equal(shouldRecord({ applying: false, switching: true, uuid: "a" }), false);
  assert.equal(shouldRecord({ applying: false, switching: false, uuid: "" }), false);
  assert.equal(shouldRecord({ applying: false, switching: false, uuid: "a" }), true);
});
