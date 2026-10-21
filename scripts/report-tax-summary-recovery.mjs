import './windows-browser-lockout-guard.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSnapshots, loadIsolation, checkSourceUnchanged, taskBelongsToIsolation } from './report-generation-acceptance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5');
const OUT = path.join(SNAPSHOT, 'generation-runner');
const require = createRequire(import.meta.url);
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const TASKS = Object.freeze({
  '1.7': 'rsec_3774005ac2aadc63d0c5c0c5aad43d74f0d1703ae8ea06318ea5ba469b610a55',
  '3.7': 'rsec_9a369a5215c8e3d25cdb975e9112bce2be4472e47fd6df69e212e0cc7b65ee0e',
  '12.1': 'rsec_8275390aabad777b0249be20e1c6a8df4ce736ff9e6da76d8d2b64c3612fdd0b'
});

export function taskContextHash(task) {
  const graph = task?.graph;
  return (Array.isArray(graph) ? graph.find(row => row?.key === 'context_snapshot') : graph?.context_snapshot)?.hash || null;
}

async function exclusive(file, value) {
  const raw = JSON.stringify(value, null, 2) + '\n';
  await fs.writeFile(file, raw, { flag: 'wx' });
  if (sha(await fs.readFile(file)) !== sha(raw)) throw Error('Recovery audit readback failed');
  return { file, sha256: sha(raw) };
}

export async function inspectOriginalTaxSummaryTasks() {
  const snapshot = await loadSnapshots(SNAPSHOT);
  const beforeSources = Object.fromEntries(await Promise.all(Object.entries(snapshot.sources).map(async ([key, source]) => [key, await checkSourceUnchanged(source.sourceIdentity)])));
  if (Object.values(beforeSources).some(value => !value)) throw Error('Formal source changed; inspection stopped');
  const isolation = await loadIsolation(snapshot);
  const session = isolation.sessions.tax;
  if (session.target.id !== 'f4395f64-af1b-43bd-b809-580b5ec9406b') throw Error('Exact Tax QA identity required');
  const opened = await session.request('/api/projects?id=' + session.target.id);
  const checkpointRaw = await fs.readFile(path.join(OUT, 'checkpoint.json'));
  const pg = require(path.join(ROOT, 'local-server/node_modules/pg'));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8), rows = [];
  try {
    await client.query('BEGIN READ ONLY');
    for (const [number, taskId] of Object.entries(TASKS)) {
      const [ci, si] = number.split('.').map(value => Number(value) - 1);
      const section = opened.project.data.chapters[ci].sections[si];
      if (section.executionTask?.id !== taskId) throw Error('Original task changed: ' + number);
      const owner = (await client.query('SELECT id,project_id,user_id,run_id,input_hash FROM report_section_tasks WHERE id=$1', [taskId])).rows[0];
      if (!taskBelongsToIsolation(owner, session.target, session.user)) throw Error('Original task owner mismatch: ' + number);
      const response = await session.request('/api/reportexecution?id=' + encodeURIComponent(taskId));
      const task = response.task;
      if (task?.id !== taskId || task.runId !== section.executionTask.runId) throw Error('Returned task identity mismatch: ' + number);
      const localContextHash = taskContextHash(section.executionTask), originalHash = owner.input_hash;
      if (!originalHash || owner.run_id !== task.runId || taskContextHash(task) !== originalHash || localContextHash && localContextHash !== originalHash) throw Error('Original task input hash changed: ' + number);
      // Do not read job payloads, run input, prompts, pricing configuration or credentials.
      // GET suppresses a dead job's text, so retain its existing result-bearing rows too.
      const job = (await client.query('SELECT id,run_id,status,attempts,max_attempts,lease_owner,lease_expires_at,error_text,created_at,updated_at,completed_at FROM agent_jobs WHERE run_id=$1 AND user_id=$2', [task.runId, owner.user_id])).rows;
      const ledger = (await client.query('SELECT id,run_id,status,provider,model,reserved_input,reserved_output,reserved_cost,actual_input,actual_output,actual_cost,response_json,created_at,updated_at FROM agent_call_ledger WHERE run_id=$1 AND user_id=$2 ORDER BY created_at', [task.runId, owner.user_id])).rows;
      const runs = (await client.query('SELECT id,status,output_json,error_text,created_at,updated_at,completed_at FROM agent_runs WHERE id=$1 AND user_id=$2', [task.runId, owner.user_id])).rows;
      const checkpoints = (await client.query('SELECT id,step_no,state_json,created_at FROM agent_checkpoints WHERE run_id=$1 AND user_id=$2 ORDER BY step_no,created_at', [task.runId, owner.user_id])).rows;
      const steps = (await client.query('SELECT id,step_no,kind,status,output_json,error_text,created_at FROM agent_run_steps WHERE run_id=$1 AND user_id=$2 ORDER BY step_no,created_at', [task.runId, owner.user_id])).rows;
      const databaseEvidence = { job, ledger, runs, checkpoints, steps };
      const rawArtifact = await exclusive(path.join(OUT, 'tax-summary-original-task-' + number + '-' + stamp + '.json'), { version: 'tax-summary-original-task-get-v2', at, number, projectId: session.target.id, ownerVerified: true, originalSection: section, response, databaseEvidence, newPaidAiCalls: 0, methods: ['GET', 'READ ONLY SELECT'] });
      rows.push({ number, taskId, runId: task.runId, status: task.status, rulesChanged: task.rulesChanged === true, inputHash: originalHash, bodySha256: sha(String(section.editedHtml || section.content || '')), bodyNonempty: !!String(section.editedHtml || section.content || '').trim(), candidateSha256: section.pendingRevision ? sha(String(section.pendingRevision.after || '')) : null, taskTextSha256: sha(String(task.text || '')), taskTextChars: String(task.text || '').length, qualityStatus: task.quality?.status || null, errors: (task.quality?.issues || []).filter(issue => issue.severity === 'error').map(issue => ({ code: issue.code, message: issue.message })), ledger: ledger.map(row => ({ id: row.id, status: row.status, responseBytes: Buffer.byteLength(String(row.response_json || '')), responseSha256: sha(String(row.response_json || '')), actualInput: row.actual_input, actualOutput: row.actual_output, actualCost: row.actual_cost, createdAt: row.created_at, updatedAt: row.updated_at })), job: job.map(row => ({ id: row.id, status: row.status, attempts: row.attempts, error: row.error_text, createdAt: row.created_at, updatedAt: row.updated_at })), checkpointCount: checkpoints.length, steps: steps.map(row => ({ kind: row.kind, status: row.status, outputBytes: Buffer.byteLength(String(row.output_json || '')) })), rawArtifact });
    }
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  const reread = await session.request('/api/projects?id=' + session.target.id);
  if (sha(opened.project) !== sha(reread.project)) throw Error('Tax remote changed during GET audit');
  if (sha(await fs.readFile(path.join(OUT, 'checkpoint.json'))) !== sha(checkpointRaw)) throw Error('Checkpoint changed during GET audit');
  const afterSources = Object.fromEntries(await Promise.all(Object.entries(snapshot.sources).map(async ([key, source]) => [key, await checkSourceUnchanged(source.sourceIdentity)])));
  if (Object.values(afterSources).some(value => !value)) throw Error('Formal source changed during GET audit');
  const audit = await exclusive(path.join(OUT, 'tax-summary-original-task-audit-' + stamp + '.json'), { version: 'tax-summary-original-task-audit-v1', at, sourceUnchangedBefore: beforeSources, sourceUnchangedAfter: afterSources, projectId: session.target.id, projectName: session.target.name, remoteSha256: sha(opened.project), remoteReadbackUnchanged: true, checkpointSha256: sha(checkpointRaw), rows, newPaidAiCalls: 0, projectWrites: 0, onlyOriginalTasks: true });
  return { ...audit, rows, newPaidAiCalls: 0, projectWrites: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).join(' ') !== '--inspect') throw Error('Only explicit --inspect is supported; no generation or save mode');
  inspectOriginalTaxSummaryTasks().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(String(error.message || error).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
}
