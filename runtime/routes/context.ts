// runtime/routes/context.ts
// Project-scoped endpoints for browsing and editing context/*.md files.

import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

/**
 * GET /runtime/context/list?root=/abs/path
 *
 * Lists .md files in <root>/context/. Returns { files: [] } if the directory
 * does not exist.
 */
router.get('/runtime/context/list', (req, res) => {
  const root = req.query.root as string;
  if (!root) {
    res.status(400).json({ error: 'Missing ?root= query parameter.' });
    return;
  }
  const contextDir = path.resolve(root, 'context');
  if (!fs.existsSync(contextDir)) {
    res.json({ files: [] });
    return;
  }
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(contextDir, { withFileTypes: true });
  } catch {
    res.json({ files: [] });
    return;
  }
  const files = items
    .filter(i => i.isFile() && i.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(i => ({ name: i.name }));
  res.json({ files });
});

/**
 * GET /runtime/context/read?root=/abs/path&file=filename.md
 *
 * Returns the content of a single .md file from <root>/context/.
 */
router.get('/runtime/context/read', (req, res) => {
  const root = req.query.root as string;
  const file = req.query.file as string;
  if (!root || !file) {
    res.status(400).json({ error: 'Missing ?root= or ?file= query parameter.' });
    return;
  }
  const absolute = path.resolve(root, 'context', file);
  if (!absolute.startsWith(path.resolve(root, 'context'))) {
    res.status(403).json({ error: 'Path escapes context directory.' });
    return;
  }
  if (!fs.existsSync(absolute)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  const stat = fs.statSync(absolute);
  if (stat.size > 1_000_000) {
    res.status(413).json({ error: 'File too large (>1MB).' });
    return;
  }
  const content = fs.readFileSync(absolute, 'utf-8');
  res.json({ name: file, content });
});

/**
 * PUT /runtime/context/write?root=/abs/path&file=filename.md
 *
 * Writes content back to a .md file in <root>/context/.
 */
router.put('/runtime/context/write', (req, res) => {
  const root = req.query.root as string;
  const file = req.query.file as string;
  if (!root || !file) {
    res.status(400).json({ error: 'Missing ?root= or ?file= query parameter.' });
    return;
  }
  const absolute = path.resolve(root, 'context', file);
  if (!absolute.startsWith(path.resolve(root, 'context'))) {
    res.status(403).json({ error: 'Path escapes context directory.' });
    return;
  }
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Body must include { content: string }.' });
    return;
  }
  try {
    fs.writeFileSync(absolute, content, 'utf-8');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: `Write failed: ${err.message}` });
  }
});

export default router;
