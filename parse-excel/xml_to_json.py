import argparse
import os
import sys

import pandas as pd


def parse_args():
    parser = argparse.ArgumentParser(description="Convert Excel sheets to JSON files.")
    parser.add_argument(
        "-i",
        "--input",
        required=True,
        help="Path to the input Excel file (relative or absolute)",
    )
    return parser.parse_args()


def load_excel_file(path: str) -> dict:
    """
    Loads all sheets from the Excel file.
    Returns a dictionary: {sheet_name: dataframe}
    """
    try:
        return pd.read_excel(path, sheet_name=None, engine=None)
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        sys.exit(1)


def ensure_output_folder(input_file: str) -> str:
    """
    Creates output/{input_filename_without_ext}/
    Returns path to the output folder.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    filename_no_ext = os.path.splitext(os.path.basename(input_file))[0]

    out_folder = os.path.join(script_dir, "output", filename_no_ext)
    os.makedirs(out_folder, exist_ok=True)

    return out_folder


def save_sheet_to_json(df: pd.DataFrame, sheet_name: str, out_folder: str):
    """
    Saves a DataFrame as JSON inside the output folder.
    Sheet name becomes lowercase.json
    """

    # Lowercase file name
    file_path = os.path.join(out_folder, f"{sheet_name.lower()}.json")

    # Replace NaN values with None (becomes null in JSON)
    df = df.where(pd.notna(df), None)

    # Convert DataFrame to JSON list-of-objects style
    json_data = df.to_dict(orient="records")

    with open(file_path, "w", encoding="utf-8") as f:
        import json
        json.dump(json_data, f, ensure_ascii=False, indent=2)

    print(f"✔ Saved {file_path}")

    return file_path


def main():
    args = parse_args()

    input_path = os.path.abspath(args.input)

    if not os.path.exists(input_path):
        print(f"❌ Input file not found: {input_path}")
        sys.exit(1)

    # Load sheets
    print(f"📄 Loading Excel file: {input_path}")
    sheets = load_excel_file(input_path)

    # Prepare output directory
    out_folder = ensure_output_folder(input_path)
    print(f"📁 Output folder: {out_folder}")

    out_path = None
    # Save each sheet as JSON
    for sheet_name, df in sheets.items():
        print(f"→ Processing sheet: {sheet_name}")
        _out = save_sheet_to_json(df, sheet_name, out_folder)
        if not out_path:
            out_path = _out

    print("\n✅ DONE!")
    if out_path:
        os.system(f"code '{out_path}'")


if __name__ == "__main__":
    print("XML to JSON")
    main()
