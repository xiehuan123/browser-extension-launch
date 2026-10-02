#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultTarget = join(homedir(), '.codex', 'skills', 'browser-extension-launch');
const includedEntries = [
  'SKILL.md',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  '使用说明.md',
  'agents',
  'assets',
  'references',
  'scripts',
];

function usage() {
  console.log(`browser-extension-launch

Usage:
  browser-extension-launch install [--target <directory>] [--replace]
  browser-extension-launch path
  browser-extension-launch --help

The default target is:
  ${defaultTarget}

--replace renames an existing target to a timestamped backup before installing.`);
}

function parseInstallArgs(args) {
  let target = defaultTarget;
  let replace = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--replace') {
      replace = true;
      continue;
    }
    if (argument === '--target') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--target requires a directory.');
      }
      target = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { replace, target };
}

function install(args) {
  const { replace, target } = parseInstallArgs(args);
  let backup;

  if (existsSync(target)) {
    if (!replace) {
      throw new Error(`Target already exists: ${target}\nRun again with --replace to keep a backup and install the new version.`);
    }
    backup = `${target}.backup-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
    renameSync(target, backup);
  }

  try {
    mkdirSync(target, { recursive: true });
    for (const entry of includedEntries) {
      cpSync(join(packageRoot, entry), join(target, entry), { recursive: true });
    }
  } catch (error) {
    rmSync(target, { force: true, recursive: true });
    if (backup) {
      renameSync(backup, target);
    }
    throw error;
  }

  console.log(`Installed browser-extension-launch to ${target}`);
  if (backup) {
    console.log(`Previous installation backed up to ${backup}`);
  }
  console.log('Start a new agent session, then invoke $browser-extension-launch.');
}

const [command = '--help', ...args] = process.argv.slice(2);

try {
  if (command === 'install') {
    install(args);
  } else if (command === 'path') {
    console.log(defaultTarget);
  } else if (command === '--help' || command === '-h' || command === 'help') {
    usage();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
