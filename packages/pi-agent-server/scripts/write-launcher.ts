// Generates dist/index.js — a thin launcher for the real SDK bundle.
//
// Pi 0.85.0's main.js chain (re-exported from the package root) carries
// top-level entry guards (experimental/server.js etc.) that throw when the
// bundler output is executed directly (argv[1] === import.meta.url). Splitting
// the bundle into bundle.js + this launcher keeps the guard's moduleUrl
// distinct from the executed entry, so the SDK's own coordinator/server entry
// checks never fire while our subprocess runs.
await Bun.write(new URL('../dist/index.js', import.meta.url), 'import "./bundle.js";\n');
