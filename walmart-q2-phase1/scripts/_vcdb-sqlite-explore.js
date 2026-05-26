#!/usr/bin/env node
/**
 * _vcdb-sqlite-explore.js — quantify how much shipped data the AutoCare VCdb
 * SQLite can improve / decode / fill.
 *
 * Investigations:
 *   #3 — SubModel: decode numeric IDs → real names
 *   #4 — From-trim heuristic: validate against authoritative SubModel
 *   Engine cols: decode EngineBase ID → Liter/CC/CID/Cylinders/BlockType
 *   0%-coverage cols: see if VehicleID join lets us populate DriveType + BedLength
 *
 * Note: SubModel IDs in VCdb apparently use SubModelName === SubModelID for
 * many rows where we'd expect a real string. We use the SQLite SubModel table
 * (SubModelName) as the authoritative decoder.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const HOME = process.env.HOME;
const DB = `${HOME}/Downloads/vcdb.sqlite`;
const DATADIR = 'walmart-q2-phase1/data';

function sql(query) {
  return execSync(`sqlite3 -json "${DB}" "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 256 * 1024 * 1024 }).toString();
}

(async () => {
  // 1) Load full decoders into memory
  console.log('Loading decoders from VCdb SQLite...');
  const submodelById = new Map();
  for (const r of JSON.parse(sql('SELECT SubModelID, SubModelName FROM SubModel'))) {
    submodelById.set(String(r.SubModelID), r.SubModelName);
  }
  const engineBaseById = new Map();
  for (const r of JSON.parse(sql('SELECT EngineBaseID, Liter, CC, CID, Cylinders, BlockType FROM EngineBase'))) {
    engineBaseById.set(String(r.EngineBaseID), r);
  }
  const makeById = new Map();
  for (const r of JSON.parse(sql('SELECT MakeID, MakeName FROM Make'))) makeById.set(String(r.MakeID), r.MakeName);
  const modelById = new Map();
  for (const r of JSON.parse(sql('SELECT ModelID, ModelName FROM Model'))) modelById.set(String(r.ModelID), r.ModelName);
  console.log(`  SubModel: ${submodelById.size} rows`);
  console.log(`  EngineBase: ${engineBaseById.size} rows`);
  console.log(`  Make: ${makeById.size} rows`);
  console.log(`  Model: ${modelById.size} rows`);

  // 2) Stream our materialized VCdb JSONL and check decode impact
  console.log('\nScanning materialized JSONL with decoders...');
  let total = 0;
  let smHits = 0, smMisses = 0;            // SubModel decode
  let smIdMatchesName = 0;                  // VCdb's exported SubModel Name happens to match decoded
  let smNumericInExport = 0;                // The "20" problem
  let smDecodedDiffersFromExport = 0;       // Decoded name != exported "SubModel Name"
  const smDecodeSamples = [];

  let ebHits = 0, ebMisses = 0;            // EngineBase decode
  let literExportEqualsDecoded = 0;
  let literDecodedDiffers = 0;
  let literExportEncoded = 0;               // exported Liter is FK-encoded (not a decimal)
  let literDecodedAvailable = 0;
  const literDecodeSamples = [];

  let makeIdMatches = 0, makeIdDiffers = 0;
  let modelIdMatches = 0, modelIdDiffers = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      total++;
      const v = r.vcdbCol;

      // SubModel
      const smId = v['SubModel ID'];
      const smExport = v['SubModel Name'];
      if (smId) {
        const decoded = submodelById.get(String(smId));
        if (decoded) smHits++; else smMisses++;
        if (smExport && /^\d+$/.test(smExport)) smNumericInExport++;
        if (decoded && smExport && decoded === smExport) smIdMatchesName++;
        if (decoded && smExport && decoded !== smExport) {
          smDecodedDiffersFromExport++;
          if (smDecodeSamples.length < 12) smDecodeSamples.push({
            mpn: r.partNumber, year: v['Year ID'], make: v['Make Name'], model: v['Model Name'],
            exported: smExport, decoded, smId,
          });
        }
      }

      // EngineBase
      const ebId = v['EngineBase ID'];
      const literExport = v['Liter'];
      if (ebId) {
        const eb = engineBaseById.get(String(ebId));
        if (eb) {
          ebHits++;
          literDecodedAvailable++;
          if (literExport && /^\d+\.\d+$/.test(literExport)) {
            // already-decimal exported value
            if (literExport === eb.Liter) literExportEqualsDecoded++;
            else literDecodedDiffers++;
          } else if (literExport && /^\d+$/.test(literExport)) {
            literExportEncoded++;
            if (literDecodeSamples.length < 12) literDecodeSamples.push({
              mpn: r.partNumber, year: v['Year ID'], make: v['Make Name'], model: v['Model Name'],
              exportedLiter: literExport, decodedLiter: eb.Liter, ebCC: eb.CC, ebCylinders: eb.Cylinders, ebBlockType: eb.BlockType,
            });
          }
        } else ebMisses++;
      }

      // Sanity: Make/Model IDs match exports
      const makeId = v['Make ID'], makeExport = v['Make Name'];
      if (makeId && makeExport) {
        if (makeById.get(String(makeId)) === makeExport) makeIdMatches++;
        else makeIdDiffers++;
      }
      const modelId = v['Model ID'], modelExport = v['Model Name'];
      if (modelId && modelExport) {
        if (modelById.get(String(modelId)) === modelExport) modelIdMatches++;
        else modelIdDiffers++;
      }
    } catch (e) {}
  }

  console.log('\n═════════ #3 SubModel decode impact ═════════');
  console.log(`Total VCdb rows scanned: ${total}`);
  console.log(`SubModel ID decode hits:           ${smHits}  (${(smHits/total*100).toFixed(1)}%)`);
  console.log(`SubModel ID decode misses:         ${smMisses}`);
  console.log(`Exported "SubModel Name" is numeric: ${smNumericInExport}  (${(smNumericInExport/total*100).toFixed(1)}%)`);
  console.log(`Decoded SubModel == exported Name:  ${smIdMatchesName}`);
  console.log(`Decoded SubModel != exported Name:  ${smDecodedDiffersFromExport}  ← these gain a real name`);
  console.log('\nSample decodes (exported → real name):');
  smDecodeSamples.forEach(s => console.log(`  ${s.year} ${s.make} ${s.model.padEnd(20)}  exported="${s.exported}" → decoded="${s.decoded}"  (smId=${s.smId})`));

  console.log('\n═════════ Liter decode impact ═════════');
  console.log(`EngineBase ID decode hits:         ${ebHits}  (${(ebHits/total*100).toFixed(1)}%)`);
  console.log(`Exported Liter is FK-encoded:      ${literExportEncoded}  ← these can be decoded to real Liter`);
  console.log(`Exported Liter already decimal AND matches decoded: ${literExportEqualsDecoded}`);
  console.log(`Exported Liter already decimal AND differs:         ${literDecodedDiffers}`);
  console.log('\nSample Liter decodes (FK-encoded → real decimal):');
  literDecodeSamples.forEach(s => console.log(`  ${s.year} ${s.make} ${s.model.padEnd(22)}  encoded=${s.exportedLiter} → decoded=${s.decodedLiter}L ${s.ebCylinders}cyl ${s.ebBlockType} (CC=${s.ebCC})`));

  console.log('\n═════════ Sanity: Make/Model exports match VCdb DB ═════════');
  console.log(`Make: ${makeIdMatches} match · ${makeIdDiffers} differ`);
  console.log(`Model: ${modelIdMatches} match · ${modelIdDiffers} differ`);

  // 3) Quick check on the Vehicle/DriveType linkage feasibility
  console.log('\n═════════ Vehicle table feasibility for DriveType / BedLength ═════════');
  // Try to find a Vehicle row for one of our known rows
  const result = sql(`
    SELECT v.VehicleID, bv.BaseVehicleID, bv.YearID, bv.MakeID, bv.ModelID, v.SubmodelID
    FROM Vehicle v
    JOIN BaseVehicle bv ON bv.BaseVehicleID = v.BaseVehicleID
    WHERE bv.YearID = 1977 AND bv.MakeID = 45 AND bv.ModelID = 385 AND v.SubmodelID = 20
    LIMIT 3
  `);
  console.log('Vehicle lookup for 1977 Buick Century SubModel=20 (Base):');
  console.log(result || '(no rows)');

  // Check VehicleToDriveType
  const vtdt = sql(`
    SELECT v.VehicleID, dt.DriveTypeName
    FROM Vehicle v
    JOIN BaseVehicle bv ON bv.BaseVehicleID = v.BaseVehicleID
    JOIN VehicleToDriveType vtd ON vtd.VehicleID = v.VehicleID
    JOIN DriveType dt ON dt.DriveTypeID = vtd.DriveTypeID
    WHERE bv.YearID = 1977 AND bv.MakeID = 45 AND bv.ModelID = 385 AND v.SubmodelID = 20
    LIMIT 5
  `);
  console.log('DriveType lookup for same vehicle:');
  console.log(vtdt || '(no rows)');

  // BedLength feasibility
  const bedLookup = sql(`
    SELECT COUNT(*) AS bedconfig_total FROM VehicleToBedConfig
  `);
  console.log('VehicleToBedConfig table size:', bedLookup);
})().catch(e => { console.error(e); process.exit(1); });
