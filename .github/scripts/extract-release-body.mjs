#!/usr/bin/env node
// Extracts the `## [<version>]` section from CHANGELOG.md and writes it to
// the given output file, to be used as the GitHub Release body.
// When the section is missing, exits 0 with an empty body (plus a workflow
// warning) so the release still goes out with auto-generated notes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, output] = process.argv.slice(2);
if (!version || !output) {
  console.error('usage: node extract-release-body.mjs <version> <output.md>');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));

mkdirSync(dirname(resolve(output)), { recursive: true });

if (start === -1) {
  console.error(`::warning::no '## [${version}]' section in CHANGELOG.md; release body will fall back to auto-generated notes`);
  writeFileSync(resolve(output), '');
} else {
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) break;
    body.push(lines[i]);
  }
  writeFileSync(resolve(output), `${lines[start]}\n${body.join('\n').trimEnd()}\n`);
  console.log(`wrote ${output} (${lines[start]})`);
}
