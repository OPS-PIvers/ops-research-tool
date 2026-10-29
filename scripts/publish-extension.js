/**
 * Uploads extension/dist/ops-research-tool-v<version>.zip (built by
 * scripts/build-extension-zip.ps1) to the Web Store listing and submits it for
 * review. Run by .github/workflows/publish-extension.yml (README, "Publishing").
 *
 *   node scripts/publish-extension.js
 */
const fs = require('fs');
const path = require('path');
const { PublishError, readConfig, uploadAndPublish } = require('./web-store');

async function main() {
  const cfg = readConfig(process.env);
  const ext = path.join(__dirname, '..', 'extension');
  const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
  const zipPath = path.join(ext, 'dist', 'ops-research-tool-v' + version + '.zip');
  if (!fs.existsSync(zipPath)) throw new PublishError('No zip at ' + zipPath + '; run scripts/build-extension-zip.ps1 first.');
  await uploadAndPublish({ cfg, version, zip: fs.readFileSync(zipPath) });
}

main().catch((err) => {
  console.error('::error::' + (err instanceof PublishError ? err.message : String(err)));
  process.exitCode = 1;
});
