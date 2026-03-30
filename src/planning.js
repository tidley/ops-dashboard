const fs = require('fs');
const path = require('path');

const PLANNING_DIR = path.join(__dirname, '..', '.planning');
const PLAYBOOK_ROOT = path.join(__dirname, '..', '..', 'engineering-playbook');

function readDoc(dir, name) {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return '';
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readPlanningBundle(dir, scope) {
  if (!dir) return null;
  if (!fs.existsSync(dir)) return null;

  return {
    scope,
    rootDir: dir,
    now: readDoc(dir, 'NOW.md'),
    next: readDoc(dir, 'NEXT.md'),
    backlog: readDoc(dir, 'BACKLOG.md'),
    risks: readDoc(dir, 'RISKS.md'),
    status: readDoc(dir, 'STATUS.md'),
    todo: readDoc(dir, 'TODO.md'),
    decisions: readDoc(dir, 'DECISIONS.md'),
    log: readDoc(dir, 'LOG.md'),
    context: readDoc(dir, 'CONTEXT.md'),
  };
}

function readPlaybookBundle(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;

  return {
    scope: 'playbook',
    rootDir,
    bootstrapGuidelines: readTextFile(path.join(rootDir, 'guidelines', 'project-bootstrap.md')),
    tddLoop: readTextFile(path.join(rootDir, 'skills', 'tdd-loop.md')),
    reliabilityReview: readTextFile(path.join(rootDir, 'skills', 'reliability-review.md')),
  };
}

function parseTaskBlocks(text) {
  const tasks = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const titleMatch = line.match(/^\d+\.\s+(.*)$/);
    if (titleMatch) {
      current = { title: titleMatch[1].trim(), bullets: [] };
      tasks.push(current);
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.*)$/);
    if (bulletMatch && current) {
      current.bullets.push(bulletMatch[1].trim());
      continue;
    }

    if (current && current.bullets.length) {
      current.bullets[current.bullets.length - 1] += ` ${line.trim()}`;
    } else if (current) {
      current.bullets.push(line.trim());
    }
  }

  return tasks;
}

function extractParagraphAfterHeading(text, heading) {
  const lines = text.split(/\r?\n/);
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === `## ${heading}`) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;
    if (line.startsWith('## ')) break;
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('-')) return line;
  }

  return '';
}

function extractBulletsAfterHeading(text, heading) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const bullets = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === `## ${heading}`) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;
    if (line.trim().startsWith('## ') && line.trim() !== `## ${heading}`) break;

    const bulletMatch = line.trim().match(/^-+\s+(.*)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
    }
  }

  return bullets;
}

function mergeTaskBlocks(documents, key) {
  return documents.flatMap(doc => parseTaskBlocks(doc[key] || '').map(task => ({
    ...task,
    title: `[${doc.scope}] ${task.title}`,
  })));
}

function mergeBulletSections(documents, key, heading) {
  return documents.flatMap(doc => extractBulletsAfterHeading(doc[key] || '', heading).map(item => `[${doc.scope}] ${item}`));
}

function loadPlanningContext({
  projectRoot = '',
  includeDashboard = true,
  includePlaybook = true,
  playbookRoot = PLAYBOOK_ROOT,
} = {}) {
  const documents = [];
  const projectBundle = readPlanningBundle(projectRoot ? path.join(projectRoot, '.planning') : '', 'project');
  if (projectBundle) documents.push(projectBundle);
  if (includeDashboard) {
    const dashboardBundle = readPlanningBundle(PLANNING_DIR, 'dashboard');
    if (dashboardBundle) documents.push(dashboardBundle);
  }

  const statusDocs = documents.map(doc => doc.status).filter(Boolean);
  const objective = statusDocs.map(statusDoc => extractParagraphAfterHeading(statusDoc, 'Objective')).find(Boolean) || '';
  const playbook = includePlaybook ? readPlaybookBundle(playbookRoot) : null;

  return {
    objective,
    currentState: statusDocs.flatMap(statusDoc => extractBulletsAfterHeading(statusDoc, 'Current state')),
    health: statusDocs.flatMap(statusDoc => extractBulletsAfterHeading(statusDoc, 'Health')),
    now: mergeTaskBlocks(documents, 'now'),
    next: mergeTaskBlocks(documents, 'next'),
    backlog: mergeTaskBlocks(documents, 'backlog'),
    risks: mergeTaskBlocks(documents, 'risks'),
    todo: documents.flatMap(doc => (doc.todo || '').trim() ? [{ scope: doc.scope, text: doc.todo }] : []),
    decisions: documents.flatMap(doc => (doc.decisions || '').trim() ? [{ scope: doc.scope, text: doc.decisions }] : []),
    log: documents.flatMap(doc => (doc.log || '').trim() ? [{ scope: doc.scope, text: doc.log }] : []),
    context: documents.flatMap(doc => (doc.context || '').trim() ? [{ scope: doc.scope, text: doc.context }] : []),
    sources: documents.map(doc => ({
      scope: doc.scope,
      rootDir: doc.rootDir,
    })),
    playbook,
  };
}

module.exports = {
  loadPlanningContext,
};
