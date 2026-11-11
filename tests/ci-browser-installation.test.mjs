import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { installBrowsers, isAzureDnsFailure, replaceAzureMirror, recoverBeforeInstall, lookupAzureMirror, readRunnerSources } from '../scripts/install-ci-browsers.mjs';

test('legacy and deb822 sources retain package trust, suites and components', () => {
  const source = `deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] http://azure.archive.ubuntu.com/ubuntu noble main universe
Types: deb
URIs: https://azure.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`;
  const expected = source.replaceAll('http://azure.archive.ubuntu.com/ubuntu', 'https://archive.ubuntu.com/ubuntu')
    .replaceAll('https://azure.archive.ubuntu.com/ubuntu', 'https://archive.ubuntu.com/ubuntu');
  assert.equal(replaceAzureMirror(source), expected);
  assert.equal(replaceAzureMirror(expected), expected);
});

test('unrelated hosts, security mirror, URL paths and schemes are unchanged', () => {
  const source = `https://security.ubuntu.com/ubuntu
https://archive.ubuntu.com/ubuntu
https://azure.archive.ubuntu.com.example/ubuntu
https://other.example/ubuntu
https://azure.archive.ubuntu.com/ubuntu-other
ftp://azure.archive.ubuntu.com/ubuntu
https://evil.example/https://azure.archive.ubuntu.com/ubuntu
prefixhttp://azure.archive.ubuntu.com/ubuntu
https://azure.archive.ubuntu.com/ubuntu/arbitrary/subpath
https://azure.archive.ubuntu.com/ubuntu?key=value
https://username@azure.archive.ubuntu.com/ubuntu`;
  assert.equal(replaceAzureMirror(source), source);
});

test('only recognized Azure DNS failures trigger fallback', () => {
  assert.ok(isAzureDnsFailure("E: Could not resolve 'azure.archive.ubuntu.com'"));
  assert.ok(isAzureDnsFailure("Temporary failure resolving 'azure.archive.ubuntu.com'"));
  for (const output of ['Could not resolve archive.ubuntu.com', 'Could not resolve azure.archive.ubuntu.com.evil',
    'azure.archive.ubuntu.com signature verification failed', 'browser CDN download failed']) {
    assert.equal(isAzureDnsFailure(output), false);
  }
});

for (const browsers of [['chromium'], ['chromium', 'firefox', 'webkit']]) {
  test(`one bounded retry preserves all browser arguments: ${browsers}`, () => {
    let calls = 0;
    let repairs = 0;
    assert.equal(installBrowsers(browsers, {
      run(args) {
        assert.deepEqual(args, browsers);
        return { status: ++calls === 1 ? 100 : 0, output: "Could not resolve 'azure.archive.ubuntu.com'" };
      },
      repair() { repairs++; },
    }), 0);
    assert.equal(calls, 2);
    assert.equal(repairs, 1);
  });
}

test('success, unrelated failure, failed repair and repeated DNS failure never loop', () => {
  for (const status of [0, 1]) {
    let calls = 0;
    assert.equal(installBrowsers(['chromium'], {
      run() { calls++; return { status, output: 'other output' }; },
      repair() { assert.fail('unexpected repair'); },
    }), status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const run = () => { calls++; return { status: 100, output: "Could not resolve 'azure.archive.ubuntu.com'" }; };
  assert.equal(installBrowsers(['webkit'], { run, repair() {} }), 100);
  assert.equal(calls, 2);
  calls = 0;
  assert.throws(() => installBrowsers(['chromium'], { run, repair() { throw new Error('repair denied'); } }), /repair denied/);
  assert.equal(calls, 1);
});

test('invalid browser input cannot execute a command', () => {
  for (const args of [[], ['--help'], ['chromium; echo unsafe']]) {
    assert.throws(() => installBrowsers(args, { run() { assert.fail('must not execute'); } }), /Specify supported browsers/);
  }
});

test('all equivalent CI installs use the shared recovery and track its changes', () => {
  let consumers = 0;
  for (const name of readdirSync('.github/workflows')) {
    const source = readFileSync(`.github/workflows/${name}`, 'utf8');
    assert.doesNotMatch(source, /npx playwright install --with-deps/);
    if (!source.includes('run: node scripts/install-ci-browsers.mjs')) continue;
    consumers++;
    if (/^    paths:/m.test(source)) {
      assert.match(source, /- 'scripts\/install-ci-browsers.mjs'/);
      assert.match(source, /- 'tests\/ci-browser-installation.test.mjs'/);
    }
  }
  assert.equal(consumers, 15);
});


test('DNS preflight checks only recognized sources on eligible runners before any installation', () => {
  const sources = () => [{ before: 'URIs: http://azure.archive.ubuntu.com/ubuntu/' }];
  let probes = 0;
  let repairs = 0;
  const lookup = () => { probes++; return false; };
  const repair = () => { repairs++; };
  assert.equal(recoverBeforeInstall({ eligible: () => false, sources, lookup, repair }), false);
  assert.equal(recoverBeforeInstall({ eligible: () => true, sources: () => [], lookup, repair }), false);
  assert.equal(probes, 0);
  assert.equal(recoverBeforeInstall({ eligible: () => true, sources, lookup: () => true, repair }), false);
  assert.equal(repairs, 0);
  assert.equal(recoverBeforeInstall({ eligible: () => true, sources, lookup, repair }), true);
  assert.equal(probes, 1);
  assert.equal(repairs, 1);
});

test('probe or repair errors fail closed and prior recovery prevents another retry', () => {
  const base = { eligible: () => true, sources: () => [{ before: 'http://azure.archive.ubuntu.com/ubuntu' }] };
  assert.throws(() => recoverBeforeInstall({ ...base, lookup() { throw new Error('probe timeout'); },
    repair() { assert.fail('must not repair on unknown probe outcome'); } }), /probe timeout/);
  assert.throws(() => recoverBeforeInstall({ ...base, lookup: () => false,
    repair() { throw new Error('repair failed'); } }), /repair failed/);
  let calls = 0;
  assert.equal(installBrowsers(['chromium'], { allowRecovery: false,
    run() { calls++; return { status: 100, output: "Could not resolve 'azure.archive.ubuntu.com'" }; },
    repair() { assert.fail('must not repair twice'); } }), 100);
  assert.equal(calls, 1);
});


test('isolated fixed-host DNS timeout permits fallback but unrelated errors fail closed', () => {
  const spawn = (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.match(args[2], /lookup\('azure\.archive\.ubuntu\.com'/);
    assert.equal(options.timeout, 10000);
    return { status: null, error: Object.assign(new Error('probe timeout'), { code: 'ETIMEDOUT' }) };
  };
  assert.equal(lookupAzureMirror({ spawn }), false);
  let repairs = 0;
  assert.equal(recoverBeforeInstall({ eligible: () => true,
    sources: () => [{ before: 'http://azure.archive.ubuntu.com/ubuntu' }],
    lookup: () => lookupAzureMirror({ spawn }), repair() { repairs++; } }), true);
  assert.equal(repairs, 1);
  for (const code of ['EACCES', 'ENOENT', 'ENOBUFS']) {
    assert.throws(() => lookupAzureMirror({ spawn: () => ({ status: null,
      error: Object.assign(new Error(code), { code }) }) }), /Azure DNS preflight failed/);
  }
  assert.throws(() => lookupAzureMirror({ spawn: () => ({ status: 1, stderr: 'unexpected lookup error' }) }),
    /Azure DNS preflight failed/);
  assert.equal(lookupAzureMirror({ spawn: () => ({ status: 0 }) }), true);
  assert.equal(lookupAzureMirror({ spawn: () => ({ status: 2 }) }), false);
});


function syntheticAptFiles(files, { linked = [], nonRegular = [] } = {}) {
  const reads = [];
  const missing = (file) => { throw Object.assign(new Error(file), { code: 'ENOENT' }); };
  return {
    reads,
    io: {
      read(file) { reads.push(file); return files[file] ?? missing(file); },
      list() { return Object.keys(files).filter((file) => file.startsWith('/etc/apt/sources.list.d/'))
        .map((file) => ({ name: file.split('/').at(-1), isFile: () => true })); },
      stat(file) { if (!(file in files)) return missing(file);
        return { isFile: () => !nonRegular.includes(file) }; },
      realpath(file) { return linked.includes(file) ? '/outside/target' : file; },
    },
  };
}

test('effective mirror+file source is inspected before installation, preserving priorities and trust', () => {
  const source = `Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports noble-security
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`;
  const mirrors = `http://azure.archive.ubuntu.com/ubuntu/\tpriority:1
https://archive.ubuntu.com/ubuntu/\tpriority:2
https://security.ubuntu.com/ubuntu/\tpriority:3
`;
  const fs = syntheticAptFiles({ '/etc/apt/sources.list.d/ubuntu.sources': source,
    '/etc/apt/apt-mirrors.txt': mirrors });
  const effective = readRunnerSources(fs.io);
  assert.equal(effective.length, 2);
  assert.equal(replaceAzureMirror(source), source);
  assert.equal(replaceAzureMirror(mirrors), mirrors.replace('http://azure.archive.ubuntu.com', 'https://archive.ubuntu.com'));
  let repaired = 0;
  assert.equal(recoverBeforeInstall({ eligible: () => true, sources: () => effective,
    lookup: () => false, repair() { repaired++; } }), true);
  assert.equal(repaired, 1);
});

test('legacy source can reference the fixed security list, and non-Azure entries stay unchanged', () => {
  const fs = syntheticAptFiles({ '/etc/apt/sources.list':
    'deb mirror+file:/etc/apt/apt-security-mirrors.txt noble-security main',
    '/etc/apt/apt-security-mirrors.txt': 'https://security.ubuntu.com/ubuntu/\tpriority:1\n' });
  const effective = readRunnerSources(fs.io);
  assert.equal(effective.length, 2);
  assert.equal(recoverBeforeInstall({ eligible: () => true, sources: () => effective,
    lookup() { assert.fail('no Azure mirror to probe'); } }), false);
});

test('mirror references cannot traverse, select arbitrary files, recurse or use URI suffixes', () => {
  const invalid = ['mirror+file:/etc/apt/../apt/apt-mirrors.txt',
    'mirror+file:/etc/apt/apt-mirrors.txt/other', 'mirror+file:/etc/apt/apt-mirrors.txt?query',
    'mirror+file:/etc/apt/apt-mirrors.txt#fragment', 'mirror+file:/etc/apt/apt-mirrors.txt.evil',
    'mirror+file:///etc/apt/apt-mirrors.txt', 'mirror+file:/tmp/evil',
    'https://evil/mirror+file:/etc/apt/apt-mirrors.txt'];
  for (const uri of invalid) {
    const fs = syntheticAptFiles({ '/etc/apt/sources.list': `deb ${uri} noble main`,
      '/etc/apt/apt-mirrors.txt': 'http://azure.archive.ubuntu.com/ubuntu/' });
    assert.equal(readRunnerSources(fs.io).length, 1);
    assert.deepEqual(fs.reads, ['/etc/apt/sources.list']);
  }
  const fs = syntheticAptFiles({ '/etc/apt/sources.list': 'deb mirror+file:/etc/apt/apt-mirrors.txt noble main',
    '/etc/apt/apt-mirrors.txt': 'mirror+file:/etc/apt/apt-security-mirrors.txt',
    '/etc/apt/apt-security-mirrors.txt': 'http://azure.archive.ubuntu.com/ubuntu/' });
  assert.equal(readRunnerSources(fs.io).length, 2);
  assert.ok(!fs.reads.includes('/etc/apt/apt-security-mirrors.txt'));
});

test('linked, nonregular and missing referenced mirror files fail closed before reading content', () => {
  const files = { '/etc/apt/sources.list': 'deb mirror+file:/etc/apt/apt-mirrors.txt noble main',
    '/etc/apt/apt-mirrors.txt': 'http://azure.archive.ubuntu.com/ubuntu/' };
  for (const opts of [{ linked: ['/etc/apt/apt-mirrors.txt'] }, { nonRegular: ['/etc/apt/apt-mirrors.txt'] },
    { linked: ['/etc/apt/sources.list'] }]) {
    const fs = syntheticAptFiles(files, opts);
    assert.throws(() => readRunnerSources(fs.io), /Refusing non-regular or linked/);
    assert.ok(!fs.reads.includes(opts.linked?.[0] ?? opts.nonRegular[0]));
  }
  const fs = syntheticAptFiles({ '/etc/apt/sources.list': files['/etc/apt/sources.list'] });
  assert.throws(() => readRunnerSources(fs.io), /apt-mirrors.txt/);
});
