import assert from "node:assert/strict";
import test from "node:test";
import { pngSampling } from "./png.ts";

test("sampling metadata uses a valid PNG text chunk without changing image chunks", async () => {
  const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const annotated = Buffer.from(await pngSampling(new Blob([original]), ["native"]).arrayBuffer());
  const offset = original.length - 12;
  assert.deepEqual(annotated.subarray(0, offset), original.subarray(0, offset));
  assert.deepEqual(annotated.subarray(-12), original.subarray(-12));
  assert.equal(annotated.toString("ascii", offset + 4, offset + 8), "tEXt");
  assert.equal(annotated.toString("ascii", offset + 8, annotated.length - 16), 'ncx_sampling\0["native"]');
  assert.equal(annotated.readUInt32BE(annotated.length - 16), 0x552af68d);
});
