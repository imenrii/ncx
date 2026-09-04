import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { baseURI: "http://127.0.0.1:8765/" },
});

const { fetchCoordinate, fetchSlice, fetchStaticSlice } = await import("./api.ts");

function variable(path: string) {
  return {
    dataset_id: "case",
    path,
    name: path.slice(1),
    dtype: "f64",
    dimensions: [{ path, name: path.slice(1), length: 3 }],
    attributes: [],
    view_hint: { kind: "plain" as const },
  };
}

function binaryResponse(dtype: "f32" | "f64", values: number[]): Response {
  const body = dtype === "f64" ? Float64Array.from(values) : Float32Array.from(values);
  return new Response(body, {
    headers: {
      "X-Ncx-Dtype": dtype,
      "X-Ncx-Shape": String(values.length),
      "X-Ncx-Endian": "little",
    },
  });
}

test("fetchCoordinate requests and decodes little-endian f64 without sharing the f32 cache", async () => {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return url.includes("wire=f64")
      ? binaryResponse("f64", [1_100_000, 1_100_000.03125, 1_100_000.0625])
      : binaryResponse("f32", [1, 2, 3]);
  };
  try {
    const coordinate = variable("/time");
    const values = await fetchCoordinate(coordinate);
    assert.ok(values instanceof Float64Array);
    assert.ok(values[0] < values[1] && values[1] < values[2]);
    assert.equal(new Float32Array(values)[0], new Float32Array(values)[1]);

    assert.equal(await fetchCoordinate(coordinate), values);
    const display = await fetchStaticSlice(coordinate);
    assert.ok(display.values instanceof Float32Array);
    assert.equal(urls.length, 2);
    assert.match(urls[0], /wire=f64/);
    assert.doesNotMatch(urls[1], /wire=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchSlice keeps display values as f32", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => binaryResponse("f32", [2.5]);
  try {
    const slice = await fetchSlice({ path: "/temperature", selection: "0", stride: "1" });
    assert.equal(slice.dtype, "f32");
    assert.ok(slice.values instanceof Float32Array);
    assert.equal(slice.values[0], 2.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
