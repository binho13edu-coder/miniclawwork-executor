const { Octokit } = require('@octokit/rest');
const AdmZip = require('adm-zip');
const { parentPort } = require('worker_threads');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'binho13edu-coder';
const REPO_NAME = process.env.REPO_NAME || 'miniclawwork-executor';

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function triggerAndWait(code) {
  const taskId = require('crypto').randomUUID();
  const codeB64 = Buffer.from(code).toString('base64');
  await octokit.repos.createDispatchEvent({
    owner: REPO_OWNER, repo: REPO_NAME,
    event_type: 'run-python',
    client_payload: { code: codeB64, task_id: taskId }
  });
  await sleep(8000);
  for (let i = 0; i < 36; i++) {
    const runs = await octokit.actions.listWorkflowRunsForRepo({ owner: REPO_OWNER, repo: REPO_NAME, per_page: 10 });
    const run = runs.data.workflow_runs.find(r => r.display_title === taskId);
    if (!run) { await sleep(5000); continue; }
    if (run.status !== 'completed') { await sleep(5000); continue; }
    const artifacts = await octokit.actions.listWorkflowRunArtifacts({ owner: REPO_OWNER, repo: REPO_NAME, run_id: run.id });
    const artifact = artifacts.data.artifacts.find(a => a.name.includes(taskId));
    if (!artifact) { await sleep(5000); continue; }
    const dl = await octokit.actions.downloadArtifact({ owner: REPO_OWNER, repo: REPO_NAME, artifact_id: artifact.id, archive_format: 'zip' });
    const zip = new AdmZip(Buffer.from(dl.data));
    const entry = zip.getEntry('output.txt');
    if (!entry) return '❌ output.txt não encontrado';
    return zip.readAsText(entry);
  }
  return '⏱️ Timeout esperando resultado';
}

parentPort.on('message', async (code) => {
  const result = await triggerAndWait(code);
  parentPort.postMessage(result);
});
