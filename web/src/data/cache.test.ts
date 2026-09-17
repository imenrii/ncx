import assert from "node:assert/strict";
import test from "node:test";
import { AsyncByteCache } from "./cache.ts";

test("byte eviction retains pending deduplication and uses recent completed entries", async () => {
  const cache = new AsyncByteCache<Uint8Array>(8, value => value.byteLength);
  let reads = 0;
  const load = () => { reads += 1; return Promise.resolve(new Uint8Array(4)); };
  const first = cache.load("a", load);
  assert.equal(cache.load("a", load), first);
  await first;
  await cache.load("b", load);
  await cache.load("a", load);
  await cache.load("c", load);
  assert.equal(cache.bytes, 8);
  await cache.load("b", load);
  assert.equal(reads, 4);
  await cache.load("large", async () => new Uint8Array(20));
  assert.ok(cache.bytes <= 8);
});

test("failed and obsolete work cannot poison a cache or exceed pending admission", async () => {
  const cache = new AsyncByteCache<number>(8, () => 1, 8, 1);
  let complete!: (value: number) => void;
  const first = cache.load("a", () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  await assert.rejects(cache.load("b", async () => 2), /busy/);
  cache.clear();
  complete(1);
  await assert.rejects(first, /Aborted/);
  await assert.rejects(cache.load("a", async () => { throw new Error("missing"); }), /missing/);
  assert.equal(await cache.load("a", async () => 3), 3);
  assert.equal(cache.bytes, 1);
});
