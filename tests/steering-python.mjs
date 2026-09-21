// Uses the exact bundled Python dependencies; no system NumPy install is needed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from '../web/node_modules/pyodide/pyodide.mjs';
import { UNIT_FAMILIES } from '../web/src/data/units.ts';
const root = new URL('../', import.meta.url);
try {
  const { version } = JSON.parse(await readFile(new URL('web/node_modules/pyodide/package.json', root), 'utf8'));
  const base = fileURLToPath(new URL(`web/dist/assets/python-${version}/`, root));
  const py = await loadPyodide({ indexURL: base, packageBaseUrl: base });
  await py.loadPackage(['numpy', 'pyyaml']);
  const site = py.runPython("__import__('site').getsitepackages()[0]");
  const packages = JSON.parse(await readFile(new URL('web/python/packages.json', root), 'utf8'));
  for (const item of packages) py.unpackArchive(new Uint8Array(await readFile(new URL('web/python/' + item.file, root))), 'zip', { extractDir: site });
  Object.assign(globalThis, {
    ncx_instance: 'test', ncx_read: () => {},
    ncx_move_probe: async (_target, position) => {
      const point = JSON.parse(position);
      if (point.x < 0) throw Error('Outside the field');
      const indices = {'/y':2, '/z':3};
      return JSON.stringify({selection:{indices,x:2,y:3,value:0}, position:{x:2,y:3}, probe:{indices,along:'/x'}});
    }, ncx_units: JSON.stringify(UNIT_FAMILIES),
    ncx_limits: JSON.stringify({ readBytes: 1024 * 1024, publishedBytes: 4 * 1024 * 1024, computeBytes: 8 * 1024 * 1024, blockBytes: 24, graphTasks: 10000, names: 100, history: 100, outputChars: 65536 }),
  });
  for (const [file, module] of [['runtime', 'ncx_runtime'], ['evaluation', 'ncx_evaluation'], ['console', 'ncx_console']]) {
    py.FS.writeFile(`${site}/${module}.py`, await readFile(new URL(`web/src/steering/${file}.py`, root), 'utf8'));
  }
  await py.runPythonAsync(await readFile(new URL('tests/steering-python.py', root), 'utf8'));
} catch (error) { console.error(String(error)); process.exitCode = 1; }
