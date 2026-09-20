"""
extract_bupot.py

Extracts key fields from Bukti Pemotongan dan/atau Pemungutan PPh Unifikasi
(BPPU) PDF documents from Coretax, assuming they all share the same layout
as the sample this was built against.

Fields extracted:
    nomor_bupot        Nomor bukti potong (top left of the form)
    nama_wp_dipotong    A.2 Nama wajib pajak yang dipotong
    masa_pajak          Masa pajak
    jenis_pph           B.2 Jenis PPh
    dpp                 B.5 DPP (Rp)
    pajak_penghasilan   B.7 Pajak Penghasilan (Rp)
    nomor_dokumen       B.9 Nomor Dokumen
    nama_pemotong       C.3 Nama pemotong dan/atau pemungut PPh
    tanggal             C.4 Tanggal

These regex patterns were tested directly against pdfplumber's text output
for a real sample file, not guessed from the visual layout, so they should
hold as long as the source PDFs come from the same Coretax template. If a
future batch comes back with missing fields, print the raw text with
extract_text_from_pdf() and check what actually shifted before touching
the regex blindly.

Usage:
    python extract_bupot.py /path/to/folder_with_pdfs --out results.xlsx
    python extract_bupot.py /path/to/single_file.pdf --out results.csv

Install dependencies first:
    pip install pdfplumber pandas openpyxl --break-system-packages
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

FIELD_PATTERNS = {
    "jenis_pph": r"B\.2\s+Jenis PPh\s*:\s*(.+)",
    "nomor_dokumen": r"B\.9\s+Nomor Dokumen\s*:\s*(\S+)",
    "nama_pemotong": r"C\.3\s+NAMA PEMOTONG DAN/ATAU PEMUNGUT\s*:\s*(.+)\n",
    "tanggal": r"C\.4\s+TANGGAL\s*:\s*(.+)",
    "nama_wp_dipotong": r"A\.2\s+NAMA\s*:\s*(.+)",
}

# These three come from one combined line and one combined match, so they
# get their own dedicated patterns instead of living in FIELD_PATTERNS.
HEADER_PATTERN = r"\n([A-Z0-9]{6,12})\s+(\d{2}-\d{4})\s+(TIDAK FINAL|FINAL)\s+(\S+)\n"
TABLE_ROW_PATTERN = r"(\d{2}-\d{3}-\d{2})\s+.+?\s+([\d\.]+)\s+([\d,\.]+)\s+([\d\.]+)\n"


def extract_text_from_pdf(pdf_path: Path) -> str:
    """Pulls all text out of a PDF, page by page, joined into one string."""
    full_text = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            full_text.append(page_text)
    # A trailing and leading newline makes the header regex easier to anchor.
    return "\n" + "\n".join(full_text) + "\n"


def extract_fields(text: str) -> dict:
    """Runs every regex pattern against the text and collects matches."""
    result = {}

    for field_name, pattern in FIELD_PATTERNS.items():
        match = re.search(pattern, text)
        result[field_name] = match.group(1).strip() if match else None

    header_match = re.search(HEADER_PATTERN, text)
    if header_match:
        result["nomor_bupot"] = header_match.group(1).strip()
        result["masa_pajak"] = header_match.group(2).strip()
    else:
        result["nomor_bupot"] = None
        result["masa_pajak"] = None

    table_match = re.search(TABLE_ROW_PATTERN, text)
    if table_match:
        result["dpp"] = table_match.group(2).strip()
        result["pajak_penghasilan"] = table_match.group(4).strip()
    else:
        result["dpp"] = None
        result["pajak_penghasilan"] = None

    return result


def process_pdf(pdf_path: Path) -> dict:
    """Extracts fields from a single PDF and tags the row with its filename."""
    text = extract_text_from_pdf(pdf_path)
    fields = extract_fields(text)
    fields["source_file"] = pdf_path.name
    return fields


def collect_pdf_paths(input_path: Path) -> list:
    """Handles both a single PDF file and a folder full of PDFs."""
    if input_path.is_file() and input_path.suffix.lower() == ".pdf":
        return [input_path]
    if input_path.is_dir():
        return sorted(input_path.glob("*.pdf"))
    raise ValueError(f"{input_path} is neither a PDF file nor a folder containing PDFs")


COLUMN_ORDER = [
    "nomor_bupot",
    "nama_wp_dipotong",
    "masa_pajak",
    "jenis_pph",
    "dpp",
    "pajak_penghasilan",
    "nomor_dokumen",
    "nama_pemotong",
    "tanggal",
    "source_file",
]


def main():
    parser = argparse.ArgumentParser(description="Extract fields from BPPU (Bukti Potong Unifikasi) PDFs")
    parser.add_argument("input", help="Path to a single PDF or a folder of PDFs")
    parser.add_argument("--out", default="extracted_bupot.xlsx", help="Output file, .csv or .xlsx")
    args = parser.parse_args()

    input_path = Path(args.input)
    pdf_paths = collect_pdf_paths(input_path)

    if not pdf_paths:
        print("No PDF files found at that path.")
        sys.exit(1)

    print(f"Found {len(pdf_paths)} PDF file(s). Extracting...")

    rows = []
    for pdf_path in pdf_paths:
        try:
            row = process_pdf(pdf_path)
            rows.append(row)
            missing = [k for k in COLUMN_ORDER if k not in ("source_file",) and row.get(k) is None]
            if missing:
                print(f"  {pdf_path.name}: extracted, but missing fields {missing}")
            else:
                print(f"  {pdf_path.name}: all fields extracted")
        except Exception as e:
            print(f"  {pdf_path.name}: FAILED ({e})")
            rows.append({"source_file": pdf_path.name})

    df = pd.DataFrame(rows)
    df = df.reindex(columns=COLUMN_ORDER)

    out_path = Path(args.out)
    if out_path.suffix.lower() == ".csv":
        df.to_csv(out_path, index=False)
    else:
        df.to_excel(out_path, index=False)

    print(f"\nDone. Results saved to {out_path}")


if __name__ == "__main__":
    main()
