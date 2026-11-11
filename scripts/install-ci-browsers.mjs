import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Preserve suites, components, architectures and Signed-By. Match only the
// official Azure Ubuntu mirror, never similarly named hosts or third parties.
export function replaceAzureMirror(source) {
  return source.replace(/(^|\s)https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=\/?(?:\s|$))/g,
    '$1https://archive.ubuntu.com/ubuntu');
}

export function isAzureDnsFailure(output) {
  return /(?:Could not resolve|Temporary failure resolving)\s+['"]?azure\.archive\.ubuntu\.com(?:['"\s]|$)/i.test(output);
}

function isHostedUbuntu() {
  return process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
    && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
    && /^ID=ubuntu$/m.test(readFileSync('/etc/os-release', 'utf8'));
}

function readRunnerSources() {
  const files = ['/etc/apt/sources.list'];
  for (const entry of readdirSync('/etc/apt/sources.list.d', { withFileTypes: true })) {
    if (entry.isFile() && /\.(list|sources)$/.test(entry.name)) {
      files.push(`/etc/apt/sources.list.d/${entry.name}`);
    }
  }
  return files.flatMap((file) => {
    try { return [{ file, before: readFileSync(file, 'utf8') }]; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  });
}

export function repairRunnerSources() {
  // Never rewrite a developer machine or a self-hosted runner's APT sources.
  if (!isHostedUbuntu()) throw new Error('Mirror recovery is restricted to GitHub-hosted Ubuntu runners.');
  let changed = 0;
  for (const { file, before } of readRunnerSources()) {
    const after = replaceAzureMirror(before);
    if (after === before) continue;
    const result = spawnSync('sudo', ['-n', 'tee', file], {
      input: after, encoding: 'utf8', timeout: 10000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Cannot update ${file}: ${result.error?.message ?? result.stderr}`);
    }
    console.log(`Recovered Azure Ubuntu mirror in ${file}; package trust settings unchanged.`);
    changed += 1;
  }
  if (!changed) throw new Error('Azure DNS failed, but no recognized Ubuntu mirror source was found.');
}

export function lookupAzureMirror({ spawn = spawnSync } = {}) {
  // Isolate the probe, not apt: timing out a package installer can orphan apt
  // children and leave locks behind. Job-level timeouts remain authoritative.
  const result = spawn(process.execPath, ['--input-type=module', '-e', `
    import { lookup } from 'node:dns';
    lookup('azure.archive.ubuntu.com', (error) => {
      if (!error) process.exit(0);
      console.error(error.code);
      process.exit(['ENOTFOUND', 'EAI_AGAIN'].includes(error.code) ? 2 : 1);
    });
  `], { encoding: 'utf8', timeout: 10000 });
  if (result.error?.code === 'ETIMEDOUT') {
    console.warn('Azure mirror DNS lookup timed out after 10 seconds; treating this fixed-host probe as unavailable.');
    return false;
  }
  if (result.error || ![0, 2].includes(result.status)) {
    throw new Error('Azure DNS preflight failed: ' + (result.error?.message ?? result.stderr));
  }
  return result.status === 0;
}

export function recoverBeforeInstall({ eligible = isHostedUbuntu, sources = readRunnerSources,
  lookup = lookupAzureMirror, repair = repairRunnerSources } = {}) {
  if (!eligible() || !sources().some(({ before }) => replaceAzureMirror(before) !== before)) return false;
  if (lookup()) return false;
  console.warn('Azure Ubuntu mirror DNS preflight failed. Using the official Ubuntu archive over HTTPS.');
  repair();
  return true;
}

function runInstall(browsers) {
  console.log(`Installing Playwright browsers and OS dependencies: ${browsers.join(', ')}`);
  const result = spawnSync(process.execPath,
    [resolve('node_modules/playwright/cli.js'), 'install', '--with-deps', ...browsers], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) console.error(result.error.message);
  // A spawn/buffer error is not a completed apt failure; never retry it.
  return { status: result.error ? 1 : result.status ?? 1,
    output: result.error ? '' : `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

export function installBrowsers(browsers, { run = runInstall, repair = repairRunnerSources, allowRecovery = true } = {}) {
  if (!browsers.length || browsers.some((browser) => !['chromium', 'firefox', 'webkit'].includes(browser))) {
    throw new Error('Specify supported browsers explicitly: chromium, firefox, webkit.');
  }
  const first = run(browsers);
  if (first.status === 0 || !allowRecovery || !isAzureDnsFailure(first.output)) return first.status;
  console.warn('Azure Ubuntu mirror DNS failed. Retrying once using the official Ubuntu archive over HTTPS.');
  repair();
  const retry = run(browsers);
  if (retry.status !== 0) console.error('Playwright installation failed after the single mirror recovery retry.');
  return retry.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const recovered = recoverBeforeInstall();
    process.exitCode = installBrowsers(process.argv.slice(2), { allowRecovery: !recovered });
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
