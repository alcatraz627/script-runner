"""Convert a JSON array of objects to an XLSX file using openpyxl.

Supports per-file plugin presets to customize column handling.
"""

import json
import re
import sys
from pathlib import Path
from openpyxl import Workbook


# ---------------------------------------------------------------------------
# Plugin presets — keyed by input filename (stem)
# Each preset can specify:
#   "drop_columns": list of column names to exclude
#   "bullet_columns": list of column names to render as "- item" bullet lists
#   "sanitize_non_ascii": True to replace non-ASCII chars with a space
# ---------------------------------------------------------------------------
PRESETS = {
    "normalize": {
        "drop_columns": ["Fitment"],
        "bullet_columns": ["Features & Benefits"],
        "sanitize_non_ascii": True,
    },
}


def sanitize_text(text: str) -> str:
    """Replace non-ASCII characters with a space."""
    return re.sub(r'[^\x00-\x7F]', ' ', text)


def flatten_value(val, *, bullet: bool = False):
    """Flatten lists/nested arrays into a string suitable for a spreadsheet cell."""
    if isinstance(val, list):
        parts = []
        for item in val:
            if isinstance(item, list):
                parts.append(": ".join(str(v) for v in item))
            else:
                parts.append(str(item))
        prefix = "- " if bullet else ""
        return "\n".join(f"{prefix}{p}" for p in parts)
    return val


def json_to_xlsx(json_path: str, xlsx_path: str | None = None):
    json_path = Path(json_path)
    if xlsx_path is None:
        xlsx_path = json_path.with_suffix(".xlsx")
    else:
        xlsx_path = Path(xlsx_path)

    preset = PRESETS.get(json_path.stem, {})
    drop_columns = set(preset.get("drop_columns", []))
    bullet_columns = set(preset.get("bullet_columns", []))
    do_sanitize = preset.get("sanitize_non_ascii", False)

    if preset:
        print(f"Using preset: {json_path.stem}")

    with open(json_path, "r") as f:
        data = json.load(f)

    if not data:
        print("Empty JSON array, nothing to write.")
        return

    wb = Workbook()
    ws = wb.active
    ws.title = "Data"

    # Header row — filtered by preset
    headers = [h for h in data[0].keys() if h not in drop_columns]
    ws.append(headers)

    # Data rows
    for row in data:
        cells = []
        for h in headers:
            val = flatten_value(row.get(h, ""), bullet=(h in bullet_columns))
            if do_sanitize and isinstance(val, str):
                val = sanitize_text(val)
            cells.append(val)
        ws.append(cells)

    wb.save(str(xlsx_path))
    print(f"Written {len(data)} rows to {xlsx_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python json_to_xlsx.py <input.json> [output.xlsx]")
        sys.exit(1)
    json_to_xlsx(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
