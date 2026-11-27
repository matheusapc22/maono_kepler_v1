import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './production-acceptance-lib.mjs';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_RECORD_BYTES = 8192;
const SHA256 = /^[a-f0-9]{64}$/;

export async function openSyntheticCheckpoint(directory, { key, scenario, evidence }) {
  if (![key, scenario, evidence].every((value) => typeof value === 'string' && SHA256.test(value))) {
    fail('CHECKPOINT_IDENTITY', 'Invalid synthetic checkpoint identity.');
  }
  if (process.platform === 'win32' || typeof process.getuid !== 'function' ||
    typeof constants.O_NOFOLLOW !== 'number') {
    fail('CHECKPOINT_FILESYSTEM', 'Use a private local POSIX filesystem for this synthetic checkpoint.');
  }
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.uid !== process.getuid() ||
    (directoryInfo.mode & 0o077) !== 0) {
    fail('CHECKPOINT_DIRECTORY', 'Use an existing directory owned by you and inaccessible to other users.');
  }

  const pathFor = (phase) => join(directory, `${key}.${phase}.json`);
  const syncDirectory = async () => {
    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  async function read(phase) {
    let handle;
    try {
      handle = await open(pathFor(phase), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    let record;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 ||
        info.size > MAX_RECORD_BYTES) {
        fail('CHECKPOINT_RECORD', 'Invalid checkpoint file.');
      }
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      try {
        if (offset > MAX_RECORD_BYTES) throw new Error('oversize');
        const envelope = JSON.parse(bytes.subarray(0, offset));
        record = envelope.payload;
        if (digest(JSON.stringify(record)) !== envelope.checksum ||
          record.version !== 1 || record.key !== key || record.phase !== phase ||
          record.report?.kind !== 'synthetic' || record.report?.evidenceDigest !== record.evidence ||
          record.report?.complete !== false || record.report?.acceptanceExecuted !== false ||
          record.report?.state !== (phase === 'accepted' ? 'cleanup' : 'closed')) throw new Error('invalid');
      } catch {
        fail('CHECKPOINT_RECORD', 'Invalid checkpoint record.');
      }
    } finally {
      await handle.close();
    }
    if (record.scenario !== scenario || record.evidence !== evidence) {
      fail('CHECKPOINT_CONFLICT', 'This run, attempt and case already use different input bytes.');
    }
    await syncDirectory();
    return record.report;
  }

  async function commit(phase, report) {
    const existing = await read(phase);
    if (existing) return existing;
    const payload = { version: 1, key, phase, scenario, evidence, report };
    const bytes = JSON.stringify({ payload, checksum: digest(JSON.stringify(payload)) });
    const temporary = join(directory, `.pending-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      // Publish without ever replacing a record accepted by a different process.
      try {
        await link(temporary, pathFor(phase));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const winner = await read(phase);
        if (!winner) fail('CHECKPOINT_RECORD', 'Concurrent checkpoint disappeared.');
        return winner;
      }
      await syncDirectory();
      return report;
    } finally {
      await unlink(temporary);
    }
  }

  return { read, commit };
}
