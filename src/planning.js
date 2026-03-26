const fs = require('fs');
const path = require('path');

const PLANNING_DIR = path.join(__dirname, '..', '.planning');

function readDoc(name) {
  try {
    return fs.readFileSync(path.join(PLANNING_DIR, name), 'utf8');
  } catch {
    return '';
  }
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

function loadPlanningContext() {
  const nowDoc = readDoc('NOW.md');
  const nextDoc = readDoc('NEXT.md');
  const backlogDoc = readDoc('BACKLOG.md');
  const risksDoc = readDoc('RISKS.md');
  const statusDoc = readDoc('STATUS.md');

  return {
    objective: extractParagraphAfterHeading(statusDoc, 'Objective'),
    currentState: extractBulletsAfterHeading(statusDoc, 'Current state'),
    health: extractBulletsAfterHeading(statusDoc, 'Health'),
    now: parseTaskBlocks(nowDoc),
    next: parseTaskBlocks(nextDoc),
    backlog: parseTaskBlocks(backlogDoc),
    risks: parseTaskBlocks(risksDoc),
  };
}

module.exports = {
  loadPlanningContext,
};
