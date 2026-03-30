const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function parseGitStatusSummary(rawStatus) {
  const text = String(rawStatus || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').filter(Boolean);
  const summary = {
    branch: '',
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    untrackedCount: 0,
  };

  const branchLine = lines.find(line => line.startsWith('## '));
  if (branchLine) {
    const branchMatch = branchLine.match(/^##\s+([^.\s]+)(?:\.\.\.[^\s]+)?(?:\s+\[(.+)\])?/);
    if (branchMatch) {
      summary.branch = branchMatch[1] || '';
      const relationText = branchMatch[2] || '';
      const aheadMatch = relationText.match(/ahead\s+(\d+)/);
      const behindMatch = relationText.match(/behind\s+(\d+)/);
      summary.ahead = aheadMatch ? Number(aheadMatch[1]) || 0 : 0;
      summary.behind = behindMatch ? Number(behindMatch[1]) || 0 : 0;
    } else {
      summary.branch = branchLine.replace(/^##\s+/, '').trim();
    }
  }

  lines
    .filter(line => !line.startsWith('## '))
    .forEach((line) => {
      if (line.startsWith('??')) {
        summary.untrackedCount += 1;
        return;
      }
      if (line.trim()) summary.dirtyCount += 1;
    });

  return summary;
}

async function listProjectDirectories(rootPath) {
  const resolvedRoot = path.resolve(String(rootPath || ''));
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return [];
  const entries = await fs.promises.readdir(resolvedRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => path.join(resolvedRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function collectGitMetadata(projectPath) {
  const resolvedPath = path.resolve(String(projectPath || ''));
  const repoCheck = await execFileAsync('git', ['-C', resolvedPath, 'rev-parse', '--is-inside-work-tree']);
  if (!repoCheck.ok || repoCheck.stdout.trim() !== 'true') {
    return {
      isGitRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
      untrackedCount: 0,
      lastCommitShortHash: '',
      lastCommitSubject: '',
      lastCommitRelative: '',
    };
  }

  const [status, commit] = await Promise.all([
    execFileAsync('git', ['-C', resolvedPath, 'status', '--porcelain=1', '--branch']),
    execFileAsync('git', ['-C', resolvedPath, 'log', '-1', '--pretty=format:%h%x09%s%x09%cr']),
  ]);

  const parsedStatus = parseGitStatusSummary(status.stdout);
  const commitParts = commit.ok
    ? commit.stdout.trim().split('\t')
    : [];

  return {
    isGitRepo: true,
    branch: parsedStatus.branch,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    dirtyCount: parsedStatus.dirtyCount,
    untrackedCount: parsedStatus.untrackedCount,
    lastCommitShortHash: commitParts[0] || '',
    lastCommitSubject: commitParts[1] || '',
    lastCommitRelative: commitParts[2] || '',
  };
}

module.exports = {
  collectGitMetadata,
  listProjectDirectories,
  parseGitStatusSummary,
};
