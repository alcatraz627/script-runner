"""Load the flat sheet through the enhancement-product reader the app actually uses.

Run from the backend root so `lib.importer.excel` imports. Called by
03-verify-against-enhancement-ingest.js; see ../docs/PLAN.md for why each
assertion is here.
"""
import json
import pathlib
import re
import sys
from io import BytesIO

from lib.importer.excel import (
    get_excel_file_sheets,
    get_excel_file_headers,
    get_excel_file_metadata,
)

# Read the column list from scripts/schema.js rather than keeping a fifth copy.
_schema = pathlib.Path(__file__).with_name("schema.js").read_text()
_consts = dict(re.findall(r"^const ([A-Z_]+) = '([^']+)';", _schema, re.M))
EXPECTED_COLUMNS = [
    (m.group(1) if m.group(1) else _consts.get(m.group(2), m.group(2)))
    for m in re.finditer(r"\{ key: (?:'([^']+)'|([A-Za-z_]+)), width", _schema)
]

target = sys.argv[1]
# Counts come from the source workbook, not from literals: a hardcoded 898 makes
# the next drop fail for the right reason with the wrong message.
expected_rows = int(sys.argv[2]) if len(sys.argv) > 2 else None
expected_reasons = int(sys.argv[3]) if len(sys.argv) > 3 else None

with open(target, "rb") as fh:
    data = BytesIO(fh.read())

results = []


def check(label, ok, detail=""):
    results.append(ok)
    mark = "ok   " if ok else "FAIL "
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))


print(f"\nreading {target} through lib.importer.excel\n")

sheets = get_excel_file_sheets(target, data)
check("get_excel_file_sheets returns one sheet", sheets == ["Catalog"], str(sheets))

headers = get_excel_file_headers(target, data, "Catalog")
check("get_excel_file_headers survives the Unnamed filter",
      headers == EXPECTED_COLUMNS,
      f"{len(headers)} kept of {len(EXPECTED_COLUMNS)}")
missing = [c for c in EXPECTED_COLUMNS if c not in headers]
check("no column silently dropped", not missing, ", ".join(missing))

meta = get_excel_file_metadata(target, data, read_rows=True, max_rows=5, column_fill_stats=True)
sheet = meta.sheets[0]
check("metadata sheet name", sheet.name == "Catalog", sheet.name)
check("metadata columns match headers", list(sheet.columns) == EXPECTED_COLUMNS)
check("row streaming works", bool(sheet.rows) and len(sheet.rows) == 5, f"{len(sheet.rows or [])} rows")

stats = sheet.column_fill_stats or {}
check("column_fill_stats computed over the full sheet", bool(stats), f"{len(stats)} columns")
if stats:
    total = next(iter(stats.values()))["total"]
    if expected_rows is None:
        expected_rows = total
        print(f"  note  row count not supplied, taking the file's own {total}")
    check(f"fill stats see all {expected_rows} data rows", total == expected_rows, str(total))
    check("ITEM is 100% filled", stats["ITEM"]["empty"] == 0, json.dumps(stats["ITEM"]))
    check("OEM GROUP is 100% filled", stats["OEM GROUP"]["empty"] == 0, json.dumps(stats["OEM GROUP"]))
    check(f"Fitment non-empty on all {expected_rows} rows (empty arrays still count)",
          stats["Fitment"]["non_empty"] == expected_rows, json.dumps(stats["Fitment"]))
    if expected_reasons is not None:
        check(f"Not Found Reason filled on exactly {expected_reasons}",
              stats["Not Found Reason"]["non_empty"] == expected_reasons, json.dumps(stats["Not Found Reason"]))

first = sheet.rows[0]
check("first streamed row keys match the columns", list(first.keys()) == EXPECTED_COLUMNS,
      f"{len(first.keys())} keys")
try:
    parsed = json.loads(first["Fitment"])
    check("Fitment round-trips to JSON after their reader", isinstance(parsed, list) and len(parsed) > 0,
          f"{len(parsed)} entries, first={json.dumps(parsed[0])}")
except Exception as exc:
    check("Fitment round-trips to JSON after their reader", False, str(exc))

print(f"\n---- pass={sum(results)} fail={len(results) - sum(results)}")
sys.exit(0 if all(results) else 1)
