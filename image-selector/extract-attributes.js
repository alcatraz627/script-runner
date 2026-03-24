#!/usr/bin/env node

/**
 * Extract attributes from Description + Features & Benefits for items
 * that have zero attributes.
 *
 * Usage: node extract-attributes.js [--source <path>] [--output-dir <path>] [--dry-run]
 *   --source     Path to data JSON (normalize.json or raw.json). Default: jegs-ebay-mar-20-03 normalize.json
 *   --output-dir Output directory for results. Default: datasets/attr-gaps/
 *   --dry-run    Process only 5 items to test prompt quality
 *
 * Auto-detects schema:
 *   normalize.json → uses "Part Number", "Part Type", "Features & Benefits", "Attributes Small"
 *   raw.json       → uses "SKU", "Category Hierarchy", "Features and Benefits", "Item Specifics (JSON)"
 *
 * Output files:
 *   extracted.json — raw LLM extraction results
 *   clean.json     — items where all attrs passed validation (auto-approved)
 *   review.json    — items with flagged attrs (needs user review)
 */

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const BATCH_SIZE = 20;
const MODEL = "claude-haiku-4-5-20251001";
const DRY_RUN = process.argv.includes("--dry-run");

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const SOURCE_FILE = getArg("--source") || path.join(
  __dirname,
  "../runs/jegs-ebay-mar-20-03/data/normalize.json"
);
const OUTPUT_DIR = getArg("--output-dir") || path.join(__dirname, "datasets/attr-gaps");

// Known attribute vocabulary (preferred names)
const KNOWN_ATTR_NAMES = [
  "Material", "Finish", "Includes", "Thread Size", "Voltage",
  "AN Size", "Amperage", "Length", "Width", "Diameter",
  "Wire Gauge", "Height", "Inner Diameter", "Thickness",
  "Capacity", "Weight", "Ohm Range", "Color", "Quantity",
  "Mounting Hole Size", "Temperature Rating", "Pressure Rating",
  "Thread Pitch",
];

const SYSTEM_PROMPT = `You are extracting product attributes from eBay vehicle parts listing descriptions and features.

Your job is to identify concrete, measurable specifications and return them as [name, value] pairs.

Rules:
- ONLY extract technically meaningful specs: dimensions, materials, finishes, voltages, thread sizes, capacities, weights, quantities, colors, ratings
- NO marketing language, NO sentences, NO part numbers as values
- NO brand names as attribute values (e.g., don't extract "Brand: JEGS")
- Values should be short (1-5 words max)
- Prefer these attribute names when applicable: ${KNOWN_ATTR_NAMES.join(", ")}
- New attribute names are fine if they're genuine specs not covered above
- If no meaningful specs can be extracted, return an empty array for that item
- Return ONLY a JSON array (no markdown, no explanation):
  [{"partNumber":"...","attrs":[[name,value],...]}, ...]`;

// Part-number-like pattern: digits with optional dashes
const PART_NUMBER_RE = /^\d{3,}[-\d]*$/;

function validateAttrs(attrs, sku) {
  const flags = [];

  for (const [name, value] of attrs) {
    // Flag unknown attribute names
    if (!KNOWN_ATTR_NAMES.includes(name)) {
      flags.push({ name, value, reason: `new attr name "${name}"` });
    }
    // Flag long values (likely sentence bleed)
    if (value && value.length > 40) {
      flags.push({ name, value, reason: "value too long (>40 chars)" });
    }
    // Flag part-number-looking values
    if (PART_NUMBER_RE.test(value)) {
      flags.push({ name, value, reason: "value looks like part number" });
    }
  }

  return flags;
}

async function extractBatch(client, batch, isRawSchema) {
  const input = batch.map((item) => ({
    partNumber: isRawSchema ? item["SKU"] : item["Part Number"],
    partType:   isRawSchema ? item["Category Hierarchy"] : item["Part Type"],
    description: item["Description"] || "",
    features:   isRawSchema ? (item["Features and Benefits"] || []) : (item["Features & Benefits"] || []),
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Extract product attributes from these items. Return only the JSON array.\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const text = response.content[0].text.trim();
  const jsonText = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("JSON parse failed for batch. Raw response:\n", text.slice(0, 500));
    throw new Error(`Batch parse error: ${e.message}`);
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable not set.");
    process.exit(1);
  }

  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`Error: Source file not found: ${SOURCE_FILE}`);
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const data = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf-8"));

  // Auto-detect schema: normalize.json has "Part Number", raw.json has "SKU"
  const isRawSchema = data[0] && "SKU" in data[0];
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Schema: ${isRawSchema ? "raw.json" : "normalize.json"}`);

  // Filter to zero-attribute items (schema-aware)
  let zeroAttrItems;
  if (isRawSchema) {
    zeroAttrItems = data.filter(item => {
      const specs = item["Item Specifics (JSON)"];
      return !specs || specs === "null" || String(specs).length < 5;
    });
  } else {
    zeroAttrItems = data.filter(
      (item) => !item["Attributes Small"] || item["Attributes Small"].length === 0
    );
  }

  console.log(`Total items: ${data.length}`);
  console.log(`Zero-attribute items: ${zeroAttrItems.length}`);

  if (DRY_RUN) {
    zeroAttrItems = zeroAttrItems.slice(0, 5);
    console.log(`\n--- DRY RUN: ${zeroAttrItems.length} items ---\n`);
  }

  const totalBatches = Math.ceil(zeroAttrItems.length / BATCH_SIZE);
  console.log(`Batches: ${totalBatches}`);
  console.log(`Model: ${MODEL}\n`);

  // Extract attributes via Claude API
  const extracted = [];

  for (let i = 0; i < zeroAttrItems.length; i += BATCH_SIZE) {
    const batch = zeroAttrItems.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`Batch ${batchNum}/${totalBatches}...`);

    const skuKey  = isRawSchema ? "SKU" : "Part Number";
    const typeKey = isRawSchema ? "Category Hierarchy" : "Part Type";

    try {
      const results = await extractBatch(client, batch, isRawSchema);

      for (const result of results) {
        const original = batch.find(
          (item) => item[skuKey] === result.partNumber
        );
        if (!original) {
          console.warn(` [warn: ${result.partNumber} not in batch]`);
          continue;
        }
        extracted.push({
          sku: result.partNumber,
          partType: original[typeKey],
          attrs: result.attrs || [],
          source: "extracted",
        });
      }

      process.stdout.write(` ✓ (${results.length} items)\n`);
    } catch (e) {
      process.stdout.write(` ✗ ${e.message}\n`);
      // Record failures as empty extractions
      for (const item of batch) {
        extracted.push({
          sku: item[skuKey],
          partType: item[typeKey],
          attrs: [],
          source: "error",
        });
      }
    }
  }

  // Save raw extraction
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "extracted.json"),
    JSON.stringify(extracted, null, 2)
  );

  // Auto-review pass: split into clean vs review
  const clean = [];
  const review = [];

  for (const item of extracted) {
    if (item.attrs.length === 0) {
      // No attrs extracted — nothing to review
      clean.push(item);
      continue;
    }

    const flags = validateAttrs(item.attrs, item.sku);
    if (flags.length === 0) {
      clean.push(item);
    } else {
      review.push({ ...item, flags });
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "clean.json"),
    JSON.stringify(clean, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "review.json"),
    JSON.stringify(review, null, 2)
  );

  // Summary
  const withAttrs = extracted.filter((e) => e.attrs.length > 0).length;
  const totalAttrs = extracted.reduce((sum, e) => sum + e.attrs.length, 0);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Items processed:     ${extracted.length}`);
  console.log(`Items with attrs:    ${withAttrs}`);
  console.log(`Items with no attrs: ${extracted.length - withAttrs}`);
  console.log(`Total attr pairs:    ${totalAttrs}`);
  console.log(`Auto-approved:       ${clean.length}`);
  console.log(`Needs review:        ${review.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  console.log(`\n✓ extracted.json → ${path.join(OUTPUT_DIR, "extracted.json")}`);
  console.log(`✓ clean.json     → ${path.join(OUTPUT_DIR, "clean.json")}`);
  console.log(`✓ review.json    → ${path.join(OUTPUT_DIR, "review.json")}`);

  // Print review items for terminal review
  if (review.length > 0 && !DRY_RUN) {
    console.log(`\n\n══════════════════════════════════════`);
    console.log(`  ITEMS NEEDING REVIEW (${review.length})`);
    console.log(`══════════════════════════════════════\n`);

    for (const item of review) {
      console.log(`  ${item.sku} — ${item.partType}`);
      for (const [name, value] of item.attrs) {
        const flag = item.flags.find((f) => f.name === name && f.value === value);
        const marker = flag ? ` ⚠ ${flag.reason}` : "";
        console.log(`    ${name}: ${value}${marker}`);
      }
      console.log();
    }

    console.log(`Review the items above, then run:`);
    console.log(`  node approve-attrs.js   (to merge clean + approved → approved.json)`);
  }

  if (DRY_RUN) {
    console.log(`\n--- DRY RUN RESULTS ---\n`);
    for (const item of extracted) {
      console.log(`  ${item.sku} — ${item.partType}`);
      if (item.attrs.length === 0) {
        console.log(`    (no attrs extracted)`);
      } else {
        for (const [name, value] of item.attrs) {
          console.log(`    ${name}: ${value}`);
        }
      }
      console.log();
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
