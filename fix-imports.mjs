#!/usr/bin/env node
/**
 * fix-imports.mjs
 * Replaces relative imports with @shared/ and @modules/ aliases
 * in all .ts files under src/
 *
 * Usage: node fix-imports.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const SRC_DIR = './src';

// Patterns to replace — order matters, more specific first
const REPLACEMENTS = [
  // _proxy — unique folder, always maps to @modules/downloaders/_proxy
  [/from '(?:\.\.\/)+_proxy\//g,            "from '@modules/downloaders/_proxy/"],
  [/from "(?:\.\.\/)+_proxy\//g,            'from "@modules/downloaders/_proxy/'],

  // downloaders/_proxy — explicit path
  [/from '(?:\.\.\/)+downloaders\/_proxy\//g, "from '@modules/downloaders/_proxy/"],
  [/from "(?:\.\.\/)+downloaders\/_proxy\//g, 'from "@modules/downloaders/_proxy/'],

  // shared/* — any depth of ../
  [/from '(?:\.\.\/)+shared\//g,            "from '@shared/"],
  [/from "(?:\.\.\/)+shared\//g,            'from "@shared/'],
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

let changed = 0;
let scanned = 0;

for (const file of walk(SRC_DIR)) {
  const original = readFileSync(file, 'utf8');
  let updated = original;

  for (const [pattern, replacement] of REPLACEMENTS) {
    updated = updated.replace(pattern, replacement);
  }

  scanned++;

  if (updated !== original) {
    changed++;
    const rel = relative('.', file);

    if (DRY_RUN) {
      console.log(`[DRY RUN] would update: ${rel}`);
      const origLines = original.split('\n');
      const newLines  = updated.split('\n');
      for (let i = 0; i < origLines.length; i++) {
        if (origLines[i] !== newLines[i]) {
          console.log(`  - ${origLines[i].trim()}`);
          console.log(`  + ${newLines[i].trim()}`);
        }
      }
    } else {
      writeFileSync(file, updated, 'utf8');
      console.log(`✓ updated: ${rel}`);
    }
  }
}

console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done — ${changed}/${scanned} files ${DRY_RUN ? 'would be ' : ''}updated.`);
