/**
 * Authoritative decoder against ~/Downloads/vcdb.sqlite (AutoCare VCdb).
 *
 * Provides:
 *   - submodel(id)        → real SubModel name ("20" → "Base")
 *   - engineBase(id)      → { Liter, CC, CID, Cylinders, BlockType }
 *   - vehicleAttrs(year, makeId, modelId, submodelId) →
 *       { DriveType, BedLength, BodyType, BodyNumDoors, FuelType, Aspiration }
 *
 * For vehicleAttrs: when multiple Vehicle rows match the (Year,Make,Model,
 * SubModel) tuple AND they share the same attribute value, return it.
 * If they disagree, return null (conservative — leave the cell blank
 * rather than ship a wrong value).
 *
 * Loads everything into in-memory maps at construction. Memory cost is
 * proportional to VCdb size (≈100MB working set for the full database).
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

const DECODER_VERSION = '1.0.0';

function sql(dbPath, query) {
  const buf = execSync(`sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 * 1024 });
  const s = buf.toString().trim();
  return s ? JSON.parse(s) : [];
}

class VcdbSqliteDecoder {
  constructor(dbPath) {
    if (!fs.existsSync(dbPath)) throw new Error(`VCdb SQLite not found at: ${dbPath}`);
    this.dbPath = dbPath;
    this._load();
  }

  _load() {
    const t0 = Date.now();
    // Direct decoders
    this.submodels = new Map();
    for (const r of sql(this.dbPath, 'SELECT SubModelID, SubModelName FROM SubModel')) {
      this.submodels.set(String(r.SubModelID), r.SubModelName);
    }
    this.engineBases = new Map();
    for (const r of sql(this.dbPath, 'SELECT EngineBaseID, Liter, CC, CID, Cylinders, BlockType FROM EngineBase')) {
      this.engineBases.set(String(r.EngineBaseID), {
        Liter: r.Liter, CC: r.CC, CID: r.CID, Cylinders: r.Cylinders, BlockType: r.BlockType,
      });
    }

    // BaseVehicle: (Year, Make, Model) → BaseVehicleID
    this.baseVehicleByYMM = new Map(); // "year|makeId|modelId" → BaseVehicleID
    for (const r of sql(this.dbPath, 'SELECT BaseVehicleID, YearID, MakeID, ModelID FROM BaseVehicle')) {
      this.baseVehicleByYMM.set(`${r.YearID}|${r.MakeID}|${r.ModelID}`, r.BaseVehicleID);
    }

    // Vehicle: (BaseVehicleID, SubmodelID) → [VehicleID]
    this.vehiclesByBaseSubmodel = new Map();
    for (const r of sql(this.dbPath, 'SELECT VehicleID, BaseVehicleID, SubmodelID FROM Vehicle')) {
      const k = `${r.BaseVehicleID}|${r.SubmodelID}`;
      if (!this.vehiclesByBaseSubmodel.has(k)) this.vehiclesByBaseSubmodel.set(k, []);
      this.vehiclesByBaseSubmodel.get(k).push(r.VehicleID);
    }

    // DriveType per vehicle
    this.driveTypeByVehicle = new Map(); // VehicleID → Set of DriveTypeName
    for (const r of sql(this.dbPath, `
      SELECT vtdt.VehicleID, dt.DriveTypeName
      FROM VehicleToDriveType vtdt JOIN DriveType dt ON dt.DriveTypeID = vtdt.DriveTypeID
    `)) {
      if (!this.driveTypeByVehicle.has(r.VehicleID)) this.driveTypeByVehicle.set(r.VehicleID, new Set());
      this.driveTypeByVehicle.get(r.VehicleID).add(r.DriveTypeName);
    }

    // BedLength per vehicle (via VehicleToBedConfig → BedConfig → BedLength)
    this.bedLengthByVehicle = new Map();
    for (const r of sql(this.dbPath, `
      SELECT vtbc.VehicleID, bl.BedLength
      FROM VehicleToBedConfig vtbc
      JOIN BedConfig bc ON bc.BedConfigID = vtbc.BedConfigID
      JOIN BedLength bl ON bl.BedLengthID = bc.BedLengthID
    `)) {
      if (!this.bedLengthByVehicle.has(r.VehicleID)) this.bedLengthByVehicle.set(r.VehicleID, new Set());
      this.bedLengthByVehicle.get(r.VehicleID).add(r.BedLength);
    }

    // BodyType + BodyNumDoors per vehicle
    this.bodyByVehicle = new Map(); // VehicleID → { types: Set, doors: Set }
    for (const r of sql(this.dbPath, `
      SELECT vtbsc.VehicleID, bt.BodyTypeName, bnd.BodyNumDoors
      FROM VehicleToBodyStyleConfig vtbsc
      JOIN BodyStyleConfig bsc ON bsc.BodyStyleConfigID = vtbsc.BodyStyleConfigID
      JOIN BodyType bt ON bt.BodyTypeID = bsc.BodyTypeID
      JOIN BodyNumDoors bnd ON bnd.BodyNumDoorsID = bsc.BodyNumDoorsID
    `)) {
      if (!this.bodyByVehicle.has(r.VehicleID)) this.bodyByVehicle.set(r.VehicleID, { types: new Set(), doors: new Set() });
      const b = this.bodyByVehicle.get(r.VehicleID);
      b.types.add(r.BodyTypeName);
      b.doors.add(r.BodyNumDoors);
    }

    // FuelType + Aspiration per vehicle via EngineConfig (EngineConfig has FuelTypeID + AspirationID + EngineBaseID)
    this.engineCfgByVehicle = new Map(); // VehicleID → { fuelTypes: Set, aspirations: Set, engineBases: Set }
    for (const r of sql(this.dbPath, `
      SELECT vtec.VehicleID, ft.FuelTypeName, asp.AspirationName, ec.EngineBaseID
      FROM VehicleToEngineConfig vtec
      JOIN EngineConfig ec ON ec.EngineConfigID = vtec.EngineConfigID
      JOIN FuelType ft ON ft.FuelTypeID = ec.FuelTypeID
      JOIN Aspiration asp ON asp.AspirationID = ec.AspirationID
    `)) {
      if (!this.engineCfgByVehicle.has(r.VehicleID)) this.engineCfgByVehicle.set(r.VehicleID, { fuelTypes: new Set(), aspirations: new Set(), engineBases: new Set() });
      const e = this.engineCfgByVehicle.get(r.VehicleID);
      e.fuelTypes.add(r.FuelTypeName);
      e.aspirations.add(r.AspirationName);
      e.engineBases.add(r.EngineBaseID);
    }

    console.log(`[VcdbSqliteDecoder] loaded in ${((Date.now()-t0)/1000).toFixed(1)}s:`);
    console.log(`  SubModel: ${this.submodels.size}`);
    console.log(`  EngineBase: ${this.engineBases.size}`);
    console.log(`  BaseVehicle: ${this.baseVehicleByYMM.size}`);
    console.log(`  Vehicle keys: ${this.vehiclesByBaseSubmodel.size}`);
    console.log(`  DriveType vehicles: ${this.driveTypeByVehicle.size}`);
    console.log(`  BedLength vehicles: ${this.bedLengthByVehicle.size}`);
    console.log(`  Body vehicles: ${this.bodyByVehicle.size}`);
    console.log(`  EngineCfg vehicles: ${this.engineCfgByVehicle.size}`);
  }

  // ─────────── Direct decoders ───────────
  subModel(id)    { return id == null ? null : this.submodels.get(String(id)) || null; }
  engineBase(id)  { return id == null ? null : this.engineBases.get(String(id)) || null; }

  /**
   * For a (Year, Make, Model, SubModel), return the set of VehicleIDs that
   * match. May be 0 (no match), 1 (clean), or N (multiple variants).
   */
  vehicleIds(yearId, makeId, modelId, submodelId) {
    const baseId = this.baseVehicleByYMM.get(`${yearId}|${makeId}|${modelId}`);
    if (!baseId) return [];
    return this.vehiclesByBaseSubmodel.get(`${baseId}|${submodelId}`) || [];
  }

  /**
   * Conservative consensus across matching vehicles. Returns:
   *   { value, vehicleCount, agreement: 'unanimous' | 'conflict' | 'none' }
   * If no vehicles match or no attribute exists on any of them → value=null, agreement='none'.
   * If all matching vehicles share one value → value=that, agreement='unanimous'.
   * If they disagree → value=null, agreement='conflict' (leave cell blank, no fabrication).
   */
  /**
   * Threshold-based consensus.
   * @param {number} thresholdPct — minimum modal % required (default 67 = 2/3 supermajority)
   * Returns { value, agreement: 'unanimous' | 'supermajority' | 'conflict' | 'none', modalPct }
   */
  _consensus(vehicleIds, attrMap, key, thresholdPct = 67) {
    if (vehicleIds.length === 0) return { value: null, vehicleCount: 0, agreement: 'none' };
    const counts = new Map();
    let totalSeen = 0;
    for (const vId of vehicleIds) {
      const entry = attrMap.get(vId);
      if (!entry) continue;
      const vals = key ? entry[key] : entry;
      if (!vals) continue;
      for (const v of vals) {
        counts.set(v, (counts.get(v) || 0) + 1);
        totalSeen++;
      }
    }
    if (totalSeen === 0) return { value: null, vehicleCount: vehicleIds.length, agreement: 'none' };
    if (counts.size === 1) return { value: [...counts.keys()][0], vehicleCount: vehicleIds.length, agreement: 'unanimous', modalPct: 100 };
    const sorted = [...counts.entries()].sort((a,b) => b[1] - a[1]);
    const modal = sorted[0][1];
    const pct = (modal / totalSeen) * 100;
    if (pct >= thresholdPct) {
      return { value: sorted[0][0], vehicleCount: vehicleIds.length, agreement: 'supermajority', modalPct: +pct.toFixed(0) };
    }
    return { value: null, vehicleCount: vehicleIds.length, agreement: 'conflict', modalPct: +pct.toFixed(0), alternatives: sorted.map(([k,c]) => `${k}(${c})`) };
  }

  driveType(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.driveTypeByVehicle);
  }
  bedLength(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.bedLengthByVehicle);
  }
  bodyType(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.bodyByVehicle, 'types');
  }
  bodyNumDoors(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.bodyByVehicle, 'doors');
  }
  fuelType(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.engineCfgByVehicle, 'fuelTypes');
  }
  aspiration(yearId, makeId, modelId, submodelId) {
    return this._consensus(this.vehicleIds(yearId, makeId, modelId, submodelId), this.engineCfgByVehicle, 'aspirations');
  }
}

module.exports = { VcdbSqliteDecoder, DECODER_VERSION };
