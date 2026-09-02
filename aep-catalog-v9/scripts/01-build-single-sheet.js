#!/usr/bin/env node
/**
 * 01-build-single-sheet.js — build without verifying.
 *
 * Delegates to the one-shot so there is only ever one implementation of the
 * transform. Two copies of it drifted apart within a day.
 *
 * Usage:
 *   node aep-catalog-v9/scripts/01-build-single-sheet.js
 *   node aep-catalog-v9/scripts/01-build-single-sheet.js --limit 3 --dry
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const oneShot = path.resolve(__dirname, '../build-aep-flat-sheet.js');
const args = process.argv.slice(2);
if (!args.includes('--no-verify')) args.push('--no-verify');

const r = spawnSync(process.execPath, [oneShot, ...args], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('\nbuilt without verifying. run scripts/04-validate.js to check it.');
