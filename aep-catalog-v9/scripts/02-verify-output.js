#!/usr/bin/env node
/**
 * 02-verify-output.js — kept as an entry point, delegates to 04.
 *
 * Its own checks were a subset of 04's and its spot-check hardcoded a part
 * number from this drop, so a new workbook crashed it. One checker is easier to
 * trust than three that must agree.
 *
 * Usage:
 *   node aep-catalog-v9/scripts/02-verify-output.js [--spots N] [--verbose]
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const r = spawnSync(process.execPath, [path.resolve(__dirname, '04-validate.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
