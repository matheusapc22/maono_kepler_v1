import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT, OrganizationEvidenceError, verifyOrganizationEvidence } from './organization-functional-evidence.mjs';

async function boundedFile(path, limit) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new OrganizationEvidenceError('ORG_EVIDENCE_FILE_TOO_LARGE');
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    for (;;) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      length += bytesRead;
      if (length > limit) throw new OrganizationEvidenceError('ORG_EVIDENCE_FILE_TOO_LARGE');
      if (!bytesRead) break;
    }
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}

export async function main(args = process.argv.slice(2)) {
  try {
    const input = {}, allowed = new Set(['--evidence', '--environment-report', '--environment-sha256', '--environment-source', '--output']);
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index], value = args[index + 1];
      if (!allowed.has(name) || Object.hasOwn(input, name) || !value || value.startsWith('--')) throw new OrganizationEvidenceError('ORG_CLI_ARGUMENTS_INVALID');
      input[name] = value;
    }
    if (!input['--evidence']) throw new OrganizationEvidenceError('ORG_CLI_EVIDENCE_REQUIRED');
    const environmentKeys = ['--environment-report', '--environment-sha256', '--environment-source'];
    const hasEnvironment = environmentKeys.some(key => Object.hasOwn(input, key));
    if (hasEnvironment && !environmentKeys.every(key => Object.hasOwn(input, key))) throw new OrganizationEvidenceError('ORG_CLI_ENVIRONMENT_INCOMPLETE');
    const evidencePath = resolve(input['--evidence']);
    const environmentPath = hasEnvironment ? resolve(input['--environment-report']) : null;
    const outputPath = input['--output'] ? resolve(input['--output']) : null;
    if (outputPath && [evidencePath, environmentPath].includes(outputPath)) throw new OrganizationEvidenceError('ORG_CLI_ORIGINAL_IMMUTABLE');
    let evidence;
    try { evidence = JSON.parse((await boundedFile(evidencePath, CONTRACT.maxEvidenceBytes)).toString('utf8')); }
    catch (error) { if (error instanceof SyntaxError) throw new OrganizationEvidenceError('ORG_EVIDENCE_JSON_INVALID'); throw error; }
    const external = hasEnvironment ? { bytes: await boundedFile(environmentPath, 1024 * 1024), sha256: input['--environment-sha256'], source: input['--environment-source'] } : null;
    const result = verifyOrganizationEvidence(evidence, { external });
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, text, { flag: 'wx', mode: 0o600 });
    process.stdout.write(text);
    // Exit 0 means the requested observations and external-artifact linkage
    // passed offline checks. complete remains false for operational acceptance.
    return result.ok ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, complete: false, acceptanceIncomplete: true,
      error: { code: error instanceof OrganizationEvidenceError ? error.code : error?.code === 'EEXIST' ? 'ORG_CERTIFICATE_ALREADY_EXISTS' : 'ORG_EVIDENCE_FILE_UNAVAILABLE' } })}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
