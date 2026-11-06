// Builds app.js from src/. Run: npm install && npm run build
// (Only needed after changing files in src/. config.js, styles.css and index.html need no build.)
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  outfile: 'app.js',
  jsx: 'automatic',
  target: ['es2020', 'safari15'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  external: ['https://*'],
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : [],
  logLevel: 'info',
};

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
