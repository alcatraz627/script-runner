/**
 * VCdb Raw Content dialect parser.
 *
 * Three observed formats:
 *   A: "Buick Century (1977)" or "Buick LeSabre (1977-1981)"  — sparse
 *   B: "1999 CHRYSLER LHS | Liter: 3.5 | SubModel: BASE | Aspiration: NATURALLY ASPIRATED | CUI: 215 | Engine Type: V8 ( 3.5L / 215 )"
 *   C: "Year: 1990 | Make: Subaru | Model: Legacy | Trim: Base Sedan 4-Door | Engine: 2.2L 2212CC H4 GAS SOHC Naturally Aspirated | Notes: Position:Camshaft ..."
 *
 * Output is a flat object: { format, year?, make?, model?, submodel?, trim?,
 *   liter?, cc?, cid?, cylinders?, blockType?, aspiration?, fuelType?,
 *   bodyType?, bodyNumDoors?, position?, fitmentNotes?, yearList?,
 *   submodelDerivation? }.
 *
 * Pure / deterministic — no I/O, no time-dependent values.
 */
'use strict';

function parseRawContent(raw) {
  if (!raw) return { format: 'empty' };
  const r = String(raw).trim();
  const out = { rawContent: r };

  if (/^Year:\s*\d/i.test(r)) {
    out.format = 'C';
    const parts = r.split('|').map(s => s.trim());
    const map = {};
    for (const p of parts) {
      const m = p.match(/^([^:]+):\s*(.+)$/);
      if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
    }
    out.year = map.year || '';
    out.make = map.make || '';
    out.model = map.model || '';
    out.trim = map.trim || '';
    const engine = map.engine || '';
    if (engine) {
      const lit = engine.match(/(\d+\.\d+)\s*L\b/i);          out.liter = lit ? lit[1] : '';
      const cc = engine.match(/(\d+)\s*CC\b/i);                out.cc = cc ? cc[1] : '';
      const cyl = engine.match(/\b([HVL])(\d+)\b/);
      if (cyl) { out.blockType = cyl[1]; out.cylinders = cyl[2]; }
      if (/GAS/i.test(engine)) out.fuelType = 'GAS';
      else if (/DIESEL/i.test(engine)) out.fuelType = 'DIESEL';
      else if (/FLEX/i.test(engine)) out.fuelType = 'FLEX FUEL';
      else if (/ELECTRIC/i.test(engine)) out.fuelType = 'ELECTRIC';
      if (/Turbocharged/i.test(engine)) out.aspiration = 'TURBOCHARGED';
      else if (/Supercharged/i.test(engine)) out.aspiration = 'SUPERCHARGED';
      else if (/Naturally\s+Aspirated/i.test(engine)) out.aspiration = 'NATURALLY ASPIRATED';
    }
    if (out.trim) {
      const doors = out.trim.match(/(\d+)[\s-]?door/i);
      if (doors) out.bodyNumDoors = doors[1];
      const bodyWords = ['Sedan','Coupe','Wagon','Hatchback','SUV','Convertible','Pickup','Truck','Van','Minivan','Crossover'];
      for (const w of bodyWords) {
        if (new RegExp('\\b' + w + '\\b', 'i').test(out.trim)) { out.bodyType = w; break; }
      }
      const lc = out.trim.toLowerCase();
      const firstBody = bodyWords.find(w => lc.includes(w.toLowerCase()));
      if (firstBody) {
        const idx = lc.indexOf(firstBody.toLowerCase());
        const guess = out.trim.slice(0, idx).trim();
        if (guess) {
          out.submodel = guess;
          out.submodelDerivation = 'fromTrim';
        }
      }
    }
    if (map.notes) {
      out.fitmentNotes = map.notes;
      // Position: short noun, not the entire remainder of Notes. Stop at the
      // next " Word:" key or segment punctuation.
      const posMatch = map.notes.match(/Position:\s*([^|;]*?)(?=\s+[A-Z][A-Za-z]+:|[|;]|$)/);
      if (posMatch && posMatch[1].trim()) out.position = posMatch[1].trim();
    }
    return out;
  }

  if (/^\d{4}\b/.test(r) && r.includes('|')) {
    const parts = r.split('|').map(s => s.trim());
    const head = parts[0];
    // Format B2 detection: head is just a bare 4-digit year AND the next
    // pipe-segment carries no "Key: Value" pair — so the row is pipe-positional
    // (YYYY | Make | Model | Trim | Engine | Notes) rather than B's
    // "YYYY MAKE MODEL | Key: Value | ..." shape.
    const headIsBareYear = /^\d{4}$/.test(head);
    const secondHasColon = parts[1] && parts[1].includes(':');
    if (headIsBareYear && !secondHasColon) {
      out.format = 'B2';
      out.year = head;
      out.make = parts[1] || '';
      out.model = parts[2] || '';
      // Trim slot: parse for body type + doors + submodel heuristic
      const trim = parts[3] || '';
      if (trim && trim !== '--') {
        out.trim = trim;
        const doors = trim.match(/(\d+)[\s-]?door/i);
        if (doors) out.bodyNumDoors = doors[1];
        const bodyWords = ['Sedan','Coupe','Wagon','Hatchback','SUV','Convertible','Pickup','Truck','Van','Minivan','Crossover'];
        for (const w of bodyWords) {
          if (new RegExp('\\b' + w + '\\b', 'i').test(trim)) { out.bodyType = w; break; }
        }
        const lc = trim.toLowerCase();
        const firstBody = bodyWords.find(w => lc.includes(w.toLowerCase()));
        if (firstBody) {
          const idx = lc.indexOf(firstBody.toLowerCase());
          const guess = trim.slice(0, idx).trim();
          if (guess) {
            out.submodel = guess;
            out.submodelDerivation = 'fromTrim';
          }
        }
      }
      // Engine slot: "3.0L 2960CC 181Cu. In. V6 GAS DOHC Naturally Aspirated"
      const engine = parts[4] || '';
      if (engine && engine !== '--') {
        const lit = engine.match(/(\d+\.\d+)\s*L\b/i);          out.liter = lit ? lit[1] : '';
        const cc = engine.match(/(\d+)\s*CC\b/i);                out.cc = cc ? cc[1] : '';
        const cid = engine.match(/(\d+)\s*Cu\.?\s*In\.?/i);     if (cid) out.cid = cid[1];
        const cyl = engine.match(/\b([HVLIhvli])(\d+)\b/);
        if (cyl) { out.blockType = cyl[1].toUpperCase(); out.cylinders = cyl[2]; }
        if (/GAS/i.test(engine)) out.fuelType = 'GAS';
        else if (/DIESEL/i.test(engine)) out.fuelType = 'DIESEL';
        else if (/FLEX/i.test(engine)) out.fuelType = 'FLEX FUEL';
        else if (/ELECTRIC/i.test(engine)) out.fuelType = 'ELECTRIC';
        if (/Turbocharged/i.test(engine)) out.aspiration = 'TURBOCHARGED';
        else if (/Supercharged/i.test(engine)) out.aspiration = 'SUPERCHARGED';
        else if (/Naturally\s+Aspirated/i.test(engine)) out.aspiration = 'NATURALLY ASPIRATED';
      }
      // Notes slot (anything past 5)
      const notes = parts.slice(5).join(' | ').trim();
      if (notes && notes !== '--') out.fitmentNotes = notes;
      return out;
    }

    // Format B (original): "YYYY MAKE MODEL | Key: Value | ..."
    out.format = 'B';
    parts.shift();
    const headM = head.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (headM) {
      out.year = headM[1];
      out.make = headM[2];
      out.model = headM[3];
    }
    for (const p of parts) {
      const m = p.match(/^([^:]+):\s*(.+)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === 'liter') out.liter = val;
      else if (key === 'submodel') out.submodel = val;
      else if (key === 'aspiration') out.aspiration = val.toUpperCase();
      else if (key === 'fitment notes') out.fitmentNotes = val;
      else if (key === 'cui') out.cid = val;
      else if (key === 'engine type') {
        const eng = val.match(/^([HVL])(\d+)/);
        if (eng) { out.blockType = eng[1]; out.cylinders = eng[2]; }
      }
      else if (key === 'engine vin' && val !== '-') out.engineVin = val;
    }
    return out;
  }

  if (/\(\d{4}/.test(r)) {
    out.format = 'A';
    const m = r.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) {
      const head = m[1].trim();
      const yearPart = m[2].trim();
      out.yearList = yearPart;
      const headParts = head.split(/\s+/);
      out.make = headParts[0];
      out.model = headParts.slice(1).join(' ');
    }
    return out;
  }

  out.format = 'unknown';
  return out;
}

module.exports = { parseRawContent, PARSER_VERSION: '1.1.0' };
