import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyManualCleanup } from './manual-evidence.mjs';
import { safeError } from './production-acceptance-lib.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    const parsed = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--report', '--evidence', '--output'].includes(args[i]) || parsed[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
      parsed[args[i]] = resolve(args[i + 1]);
    }
    if (!parsed['--report'] || !parsed['--evidence']) throw new Error('arguments');
    const read = async path => { const value = await readFile(path, 'utf8'); if (Buffer.byteLength(value) > 1024 * 1024) throw new Error('oversized'); return JSON.parse(value); };
    const result = verifyManualCleanup(await read(parsed['--report']), await read(parsed['--evidence']));
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (parsed['--output']) await writeFile(parsed['--output'], text, { mode: 0o600, flag: 'wx' });
    process.stdout.write(text); return result.complete ? 0 : 1;
  } catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, complete: false, error: safeError(error) })}\n`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
