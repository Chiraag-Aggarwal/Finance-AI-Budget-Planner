"""In-memory statement parsing and Excel export. Never treat balances as cash flow."""
import csv
import io
import math
import re
import zipfile
from datetime import date, datetime
from pathlib import Path

MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_ROWS = 2000
CATEGORIES = {
    "income": ["Salary", "Business income", "Other income"],
    "expense": ["Food and groceries", "Housing and rent", "Utilities", "Transport",
                "Health", "Education", "Loan EMI", "Family support", "Personal", "Other"],
}
ALIASES = {
    "date": {"date", "transaction date", "txn date", "value date", "दिनांक"},
    "note": {"note", "description", "particulars", "narration", "details", "remarks", "विवरण"},
    "type": {"type", "entry type", "transaction type", "dr cr", "credit debit"},
    "category": {"category", "श्रेणी"},
    "amount": {"amount", "transaction amount", "राशि"},
    "debit": {"debit", "withdrawal", "withdrawals", "withdrawal amount", "debit amount", "expense", "expenses", "money out"},
    "credit": {"credit", "deposit", "deposits", "deposit amount", "credit amount", "income", "money in"},
}

class DocumentError(ValueError):
    """Safe user-facing error; no document contents in logs."""

def normalise_header(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"\b(inr|rs|rupees)\b|₹|\([^)]*\)", "", text)
    return re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", text).strip()

def money(value):
    """Read a finite rupee amount; an unknown or blank amount remains None, not zero."""
    if value is None or str(value).strip() in {"", "-", "—"}:
        return None
    text = re.sub(r"^(?:INR|Rs\.?)\s*", "", str(value).strip().replace(",", "").replace("₹", ""), flags=re.I)
    if text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    try:
        number = float(text)
        return round(number, 2) if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None

def transaction_date(value, date_order="day-first"):
    """Use the chosen day/month order instead of guessing ambiguous dates."""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    formats = ["%Y-%m-%d", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y", "%d %B %Y"]
    formats += (["%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"] if date_order == "day-first"
                else ["%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y"])
    for pattern in formats:
        try:
            return datetime.strptime(str(value or "").strip(), pattern).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""

def check_zip(data):
    # Bound expanded Office XML before parsing.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items = archive.infolist()
            if len(items) > 1000 or sum(i.file_size for i in items) > 24 * 1024 * 1024:
                raise DocumentError("This document is too large to read. Export a smaller table.")
    except zipfile.BadZipFile:
        raise DocumentError("This is not a readable Office document.") from None

def read_tables(filename, data):
    """Extract bounded tables in memory. Images and scanned PDFs have no OCR path."""
    extension = Path(filename).suffix.lower()
    if not data or len(data) > MAX_FILE_BYTES:
        raise DocumentError("Choose a file smaller than 4 MB.")
    if extension == ".csv":
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise DocumentError("Save the CSV as UTF-8, then try again.") from None
        try:
            dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        table = []
        for row in csv.reader(io.StringIO(text), dialect):
            if not any(cell.strip() for cell in row):
                continue
            if len(row) > 30 or len(table) >= MAX_ROWS + 50:
                raise DocumentError("Use a table with at most 2,000 entries and 30 columns.")
            table.append(row)
        return [table]
    if extension == ".xlsx":
        check_zip(data)
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
        try:
            if len(book.worksheets) > 10:
                raise DocumentError("Use a workbook with 10 sheets or fewer.")
            tables = []
            for sheet in book:
                if (sheet.max_row or 0) > MAX_ROWS + 50 or (sheet.max_column or 0) > 30:
                    raise DocumentError("Use a table with at most 2,000 entries and 30 columns.")
                tables.append([list(row) for row in sheet.iter_rows(max_row=min(sheet.max_row or MAX_ROWS + 51, MAX_ROWS + 51), max_col=min(sheet.max_column or 30, 30), values_only=True)])
            return tables
        finally:
            book.close()
    if extension == ".docx":
        check_zip(data)
        from defusedxml import ElementTree
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = ElementTree.fromstring(archive.read("word/document.xml"))
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        tables = xml.findall(".//w:tbl", ns)
        if len(tables) > 10 or sum(len(table.findall("./w:tr", ns)) for table in tables) > MAX_ROWS + 50:
            raise DocumentError("Use a document with at most 2,000 entries and 10 tables.")
        return [[["".join(n.text or "" for n in cell.findall(".//w:t", ns))
                  for cell in row.findall("./w:tc", ns)]
                 for row in table.findall("./w:tr", ns)]
                for table in tables]
    if extension == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise DocumentError("Use an unlocked PDF exported by your bank. Do not upload a password.")
        if len(reader.pages) > 10:
            raise DocumentError("Import up to 10 PDF pages at a time.")
        tables, positions = [], None
        for page in reader.pages:
            contents = page.get_contents()
            if contents and len(contents.get_data()) > 5 * 1024 * 1024:
                raise DocumentError("This PDF page is too complex. Export a CSV or Excel table.")
            text = page.extract_text(extraction_mode="layout") or ""
            table = []
            for line in text.splitlines():
                if not line.strip():
                    continue
                chunks = list(re.finditer(r"\S.*?(?=\s{2,}|$)", line))
                names = {normalise_header(chunk.group()) for chunk in chunks}
                is_header = bool(names & ALIASES["date"]) and bool(names & (ALIASES["amount"] | ALIASES["debit"] | ALIASES["credit"]))
                if is_header:
                    positions = [max(0, chunk.start() - 2) for chunk in chunks]
                    table.append([chunk.group() for chunk in chunks])
                elif positions:
                    # Preserve empty debit/credit cells. Splitting on whitespace
                    # would shift a credit into the debit column.
                    table.append([line[start:(positions[i+1] if i+1 < len(positions) else len(line))].strip()
                                  for i, start in enumerate(positions)])
            tables.append(table)
        return tables
    raise DocumentError("Use CSV, XLSX, DOCX tables or a readable PDF. Photos, scanned passbooks and old DOC/XLS files need a table export first.")

def preview_document(filename, data, date_order="day-first"):
    """Normalise rows and flag uncertain fields for review; do not save transactions."""
    if date_order not in {"day-first", "month-first"}:
        raise DocumentError("Choose day-first or month-first dates.")
    try:
        tables = read_tables(filename, data)
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("This file could not be read. Try an unprotected CSV or Excel table.") from None
    entries, skipped, found_header = [], 0, False
    columns = None
    for table in tables:
        if Path(filename).suffix.lower() != ".pdf":
            columns = None
        for source_row, values in enumerate(table, 1):
            if not any(str(v or "").strip() for v in values):
                continue
            candidate = {}
            for index, value in enumerate(values[:30]):
                for key, names in ALIASES.items():
                    if normalise_header(value) in names and key not in candidate:
                        candidate[key] = index
            if "date" in candidate and ({"amount", "debit", "credit"} & candidate.keys()):
                columns, found_header = candidate, True
                continue
            if not columns:
                skipped += 1
                continue
            raw = lambda key: values[columns[key]] if key in columns and columns[key] < len(values) else None
            if re.match(r"^(?:total|closing balance|opening balance)\b", str(values[0] or ""), re.I):
                skipped += 1
                continue
            kind = str(raw("type") or "").strip().lower()
            kind = {"dr": "expense", "debit": "expense", "withdrawal": "expense",
                    "cr": "income", "credit": "income", "deposit": "income"}.get(kind, kind)
            amount, debit, credit = money(raw("amount")), money(raw("debit")), money(raw("credit"))
            issues = []
            if "debit" in columns or "credit" in columns:
                invalid_side = any(str(raw(key) or "").strip() not in {"", "-", "—"} and money(raw(key)) is None for key in ("debit", "credit"))
                if invalid_side:
                    kind, amount = "", None
                    issues.append("Check debit and credit")
                elif debit is not None and debit > 0 and (credit is None or credit == 0):
                    kind, amount = "expense", debit
                elif credit is not None and credit > 0 and (debit is None or debit == 0):
                    kind, amount = "income", credit
                else:
                    kind, amount = "", None
                    issues.append("Check debit and credit")
            if kind not in CATEGORIES:
                kind = ""
                issues.append("Choose income or expense")
            if amount is None or not 0 < amount <= 1_000_000_000:
                amount = None
                issues.append("Enter a positive amount")
            parsed_date = transaction_date(raw("date"), date_order)
            if not parsed_date:
                issues.append("Check the date")
            category = str(raw("category") or "").strip()
            if category not in CATEGORIES.get(kind, []):
                category = "Other income" if kind == "income" else "Other"
            note = str(raw("note") or "").strip()
            if len(note) > 80:
                issues.append("Note shortened to 80 characters")
            entries.append({"date": parsed_date, "type": kind, "amount": amount, "note": note[:80],
                            "category": category, "issues": issues, "sourceRow": source_row})
            if len(entries) > MAX_ROWS:
                raise DocumentError("Import up to 2,000 rows at a time. Split this file into smaller parts.")
    if not found_header or not entries:
        raise DocumentError("No transaction table found. Use headers Date, Description and Debit/Credit, or Date, Type and Amount. Scanned pages need a readable table export.")
    return {"entries": entries, "skippedRows": skipped,
            "notice": "Check dates, income/expense and categories. Exclude transfers between your own accounts. Originals are not saved."}

def export_workbook(entries, month=""):
    """Create dated transaction details and monthly summaries from caller-scoped entries."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    book = Workbook()
    # Open the transaction details first; totals are on a separate summary tab.
    sheet = book.active
    sheet.title = "Entries"
    summary = book.create_sheet("Summary")
    book.active = 0
    sheet.sheet_view.tabSelected = True
    summary.sheet_view.tabSelected = False
    sheet.sheet_view.zoomScale = 90
    filtered = sorted((e for e in entries if not month or e["date"].startswith(month)),
                      key=lambda e: (e["date"], e["id"]))
    totals, monthly = {"income": 0, "expense": 0}, {}
    sheet.append(["Date", "Type", "Category", "Note / description", "Income (INR)", "Expense (INR)"])
    for entry in filtered:
        amount = entry["amount"]
        totals[entry["type"]] += amount
        bucket = monthly.setdefault(entry["date"][:7], {"income": 0, "expense": 0})
        bucket[entry["type"]] += amount
        sheet.append([datetime.strptime(entry["date"], "%Y-%m-%d"), entry["type"].title(),
                      entry["category"], entry.get("note", ""),
                      amount if entry["type"] == "income" else None,
                      amount if entry["type"] == "expense" else None])
        # Explicit text prevents uploaded notes becoming executable spreadsheet formulas.
        for column in (2, 3, 4):
            sheet.cell(sheet.max_row, column).data_type = "s"
        sheet.cell(sheet.max_row, 1).number_format = "dd mmm yyyy"
    summary.append(["Finance AI · Recorded budget", month or "All months"])
    summary.append(["Income (INR)", round(totals["income"], 2)])
    summary.append(["Expenses (INR)", round(totals["expense"], 2)])
    summary.append(["Recorded balance (INR)", round(totals["income"] - totals["expense"], 2)])
    summary.append(["Entries", len(filtered)])
    summary.append(["Only recorded transactions; this is not a bank balance."])
    summary.append([])
    summary.append(["Month", "Income (INR)", "Expenses (INR)", "Recorded balance (INR)"])
    for key, value in sorted(monthly.items()):
        summary.append([key, round(value["income"], 2), round(value["expense"], 2),
                        round(value["income"] - value["expense"], 2)])
    for tab, widths in ((sheet, [20, 15, 28, 60, 22, 22]), (summary, [48, 24, 24, 26])):
        tab.freeze_panes = "A2"
        for index, width in enumerate(widths, 1):
            tab.column_dimensions[get_column_letter(index)].width = width
        for cell in tab[1]:
            cell.fill = PatternFill("solid", fgColor="6B48A6")
            cell.font = Font(color="FFFFFF", bold=True)
        for row in tab.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if isinstance(cell.value, (float, int)):
                    cell.number_format = '#,##0.00'
        tab.sheet_view.showGridLines = False
    sheet.auto_filter.ref = sheet.dimensions
    sheet.row_dimensions[1].height = 30
    sheet.print_title_rows = "1:1"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.sheet_properties.tabColor = "6B48A6"
    summary.sheet_properties.tabColor = "2D8474"
    for row in range(2, sheet.max_row + 1):
        sheet.row_dimensions[row].height = 34
        # Amounts stay numeric, so Excel can filter and total them.
        for column in (5, 6):
            sheet.cell(row, column).number_format = '"₹" #,##0.00'

    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            if cell.row % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F3EDF9")
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()
