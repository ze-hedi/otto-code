// runtime/routes/files.ts
// Filesystem browsing endpoints for agent workspaces.

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { PiAgent } from '../../agents/pi-agent.js';
import { activeAgents } from '../state.js';
import type { FileEntry } from '../types.js';

const router = Router();

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.next', '.cache', 'dist', 'build',
  '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', 'coverage',
]);

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.json': 'json', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.sql': 'sql', '.sh': 'shell', '.bash': 'shell',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
  '.lua': 'lua', '.r': 'r', '.R': 'r', '.dockerfile': 'dockerfile',
};

function getAgentRoot(piAgent: PiAgent): string | null {
  const config = piAgent.getConfig();
  return config.playground?.trim() || config.workingDir?.trim() || null;
}

function walkDir(root: string, rel: string, entries: FileEntry[], maxDepth: number, depth = 0): void {
  if (depth > maxDepth) return;
  const abs = path.join(root, rel);
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  // Sort: directories first, then alphabetically
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const item of items) {
    if (item.name.startsWith('.') && item.isDirectory()) continue;
    if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
    const itemRel = rel ? `${rel}/${item.name}` : item.name;
    entries.push({ path: itemRel, name: item.name, type: item.isDirectory() ? 'directory' : 'file' });
    if (item.isDirectory()) {
      walkDir(root, itemRel, entries, maxDepth, depth + 1);
    }
  }
}

/**
 * GET /runtime/agents/:id/files/tree
 *
 * Returns a flat list of files and directories in the agent's workspace.
 */
router.get('/runtime/agents/:id/files/tree', (req, res) => {
  const { id } = req.params;
  const piAgent = activeAgents.get(id);
  if (!piAgent) {
    res.status(404).json({ error: 'Agent not found in runtime.' });
    return;
  }
  const root = getAgentRoot(piAgent);
  if (!root) {
    res.status(400).json({ error: 'Agent has no playground or workingDir configured.' });
    return;
  }
  if (!fs.existsSync(root)) {
    res.status(400).json({ error: `Directory does not exist: ${root}` });
    return;
  }
  const entries: FileEntry[] = [];
  walkDir(root, '', entries, 8);
  res.json({ root, entries });
});

/**
 * GET /runtime/agents/:id/files/read?path=relative/path
 *
 * Returns the content of a file in the agent's workspace.
 */
router.get('/runtime/agents/:id/files/read', (req, res) => {
  const { id } = req.params;
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'Missing ?path= query parameter.' });
    return;
  }
  const piAgent = activeAgents.get(id);
  if (!piAgent) {
    res.status(404).json({ error: 'Agent not found in runtime.' });
    return;
  }
  const root = getAgentRoot(piAgent);
  if (!root) {
    res.status(400).json({ error: 'Agent has no playground or workingDir configured.' });
    return;
  }
  // Security: resolve and verify the path is within root
  const absolute = path.resolve(root, filePath);
  if (!absolute.startsWith(path.resolve(root))) {
    res.status(403).json({ error: 'Path escapes agent workspace.' });
    return;
  }
  if (!fs.existsSync(absolute)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    res.status(400).json({ error: 'Path is a directory, not a file.' });
    return;
  }
  // Cap at 1MB
  if (stat.size > 1_000_000) {
    res.status(413).json({ error: 'File too large (>1MB).' });
    return;
  }
  const content = fs.readFileSync(absolute, 'utf-8');
  const ext = path.extname(absolute).toLowerCase();
  const language = EXT_TO_LANGUAGE[ext] || 'plaintext';
  res.json({ path: filePath, content, language });
});

export default router;
