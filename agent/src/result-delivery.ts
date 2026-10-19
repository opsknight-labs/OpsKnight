import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AgentApiError, type AgentClient } from './client';
import type { ResultSpool } from './spool';
import type { SpoolRecord } from './types';
import { boundOutput, sliceUtf8Safe, MAX_DECODED_OUTPUT_BYTES } from './output-limits';
import { sanitizeOutputText } from './output-safety';

/** Artifacts are optional evidence: their failure must never suppress the execution outcome. */
export async function deliverSpoolRecord(
  client: Pick<AgentClient, 'uploadArtifact' | 'submit'>,
  spool: Pick<ResultSpool, 'put'>,
  record: SpoolRecord
) {
  // The original outcome was fsynced before delivery. Metadata updates are best effort:
  // a full disk must not stop delivery of that already-durable execution outcome.
  const persistMetadata = async (updated: SpoolRecord) => {
    try {
      await spool.put(updated);
    } catch {
      process.stderr.write(
        '[Agent Storage Error] Result metadata update failed; original outcome remains spooled.\n'
      );
    }
  };
  const { localOutput, ...result } = record;
  if (localOutput && !result.outputArtifactId && Buffer.byteLength(localOutput) > 32_768) {
    try {
      // Bound after sanitization, which can expand text. Compression is not a decoded size limit.
      const output = boundOutput(
        sanitizeOutputText(localOutput),
        MAX_DECODED_OUTPUT_BYTES - 65_536
      );
      const content = gzipSync(Buffer.from(output.text));
      const artifact = await client.uploadArtifact({
        attemptId: record.attemptId,
        leaseToken: record.leaseToken,
        kind: 'OUTPUT',
        mediaType: 'text/plain; charset=utf-8',
        encoding: 'gzip',
        contentBase64: content.toString('base64'),
        sha256: createHash('sha256').update(content).digest('hex'),
        truncated: output.truncated || output.text.endsWith('[output truncated]'),
      });
      result.outputArtifactId = artifact.id;
      result.outputPreview = sliceUtf8Safe(output.text, 32_768);
      await persistMetadata({ ...record, ...result });
    } catch (error) {
      // Never include a remote error body or local output in the error annotation.
      const code = error instanceof AgentApiError ? `HTTP ${error.status}` : 'upload interrupted';
      const marker = `\n[Artifact unavailable: ${code}. Execution outcome retained.]`;
      result.outputPreview =
        sliceUtf8Safe(sanitizeOutputText(localOutput), 32_768 - Buffer.byteLength(marker)) + marker;
      // Persist before attempting submission, so a crash/retry retains the explanation. Retry
      // transient uploads if result delivery also fails; permanently rejected logs are omitted.
      await persistMetadata({
        ...record,
        ...result,
        localOutput:
          error instanceof AgentApiError && (error.terminal || error.status === 413)
            ? undefined
            : localOutput,
      });
    }
  }
  await client.submit(result);
}
