import { buildProjectChangeProposal } from '../../../../functions/_lib/project-change-request-operations.js';
import { dropboxContentHashBlockDigest, dropboxContentHashFromBlockDigestsHex } from '../../../../functions/_lib/dropbox-content-hash.js';
import { loadReviewBaseProjectConfig } from './review-base-config-client';

// Same deterministic operations engine as legacy Apply; large JSON stays in the browser.
export async function prepareReviewApplyArtifact(slug: string, id: string) {
  const { config, review } = await loadReviewBaseProjectConfig(slug, id, new AbortController().signal);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Revisão-base inválida.');
  const proposal = buildProjectChangeProposal({ baseConfig: config as Record<string, unknown>, operations: review.operations });
  const blob = new Blob([JSON.stringify(proposal.config)], { type: 'application/vnd.maono.map-config+json' });
  if (blob.size > 100 * 1024 * 1024) throw new Error('O MapConfig excede o limite de 100 MiB deste transporte.');
  const digests: Uint8Array[] = [];
  for (let offset = 0; offset < blob.size; offset += 4 * 1024 * 1024) {
    digests.push(await dropboxContentHashBlockDigest(await blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()));
  }
  return { body: blob, headers: {
    'Content-Type': blob.type,
    'X-Maono-Large-Config': '1',
    'X-Maono-Expected-Revision': String(review.base.revision),
    'X-Maono-Config-Size': String(blob.size),
    'X-Maono-Config-Schema': 'legacy-kepler',
    'X-Maono-Config-Schema-Version': '1',
    'X-Maono-Config-Version': String(proposal.config.version),
    'X-Maono-Dataset-Count': String((proposal.config.datasets as unknown[]).length),
    'X-Maono-Config-Checksum': await dropboxContentHashFromBlockDigestsHex(digests),
    'X-Maono-Change-Request-Version': String(review.changeRequest.lifecycleVersion),
  } };
}
