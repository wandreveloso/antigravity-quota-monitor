const esbuild = require('esbuild');

async function build() {
  // Build main extension bundle
  await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: false,
  });

  // Build test bundle
  await esbuild.build({
    entryPoints: ['src/test/normalizer.test.ts'],
    bundle: true,
    outfile: 'dist/test/normalizer.test.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
  });

  console.log('Build completed successfully.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});

