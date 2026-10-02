import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const installer = join(repositoryRoot, 'bin', 'install.mjs');

function run(...args) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('installs the complete skill into a custom target', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-extension-launch-'));
  const target = join(root, 'skill');
  try {
    const result = run('install', '--target', target);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(target, 'SKILL.md'), 'utf8'), /name: browser-extension-launch/);
    assert.match(readFileSync(join(target, 'agents', 'openai.yaml'), 'utf8'), /display_name/);
    assert.match(readFileSync(join(target, 'scripts', 'project.py'), 'utf8'), /def main/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('refuses to overwrite and backs up only with --replace', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-extension-launch-'));
  const target = join(root, 'skill');
  try {
    const first = run('install', '--target', target);
    assert.equal(first.status, 0, first.stderr);
    writeFileSync(join(target, 'local-note.txt'), 'keep me');

    const refused = run('install', '--target', target);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Target already exists/);

    const replaced = run('install', '--target', target, '--replace');
    assert.equal(replaced.status, 0, replaced.stderr);
    const backupMatch = replaced.stdout.match(/backed up to (.+)$/m);
    assert.ok(backupMatch);
    assert.equal(readFileSync(join(backupMatch[1], 'local-note.txt'), 'utf8'), 'keep me');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
