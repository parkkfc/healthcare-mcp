"""Turn the K-FCDB workbooks into SQL for `wrangler d1 execute --file`."""

from __future__ import annotations

import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / ".wrangler"
SOURCES = (
    (ROOT / "migrations" / "음식_db.xlsx", "1인(회)분량 참고량"),
    (ROOT / "migrations" / "가공식품_db.xlsx", "1회 섭취참고량"),
)
COLUMNS = (
    "food_code",
    "food_name",
    "category",
    "basis",
    "kcal",
    "carb_g",
    "protein_g",
    "fat_g",
    "serving_ref",
    "serving_weight",
)
STATEMENT_LIMIT = 60_000


def sql_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\ufeff", "").replace("\r", " ").replace("\n", " ").strip()
    if text == "":
        return None
    return "'" + text.replace("'", "''") + "'"


def sql_number(value: object) -> str:
    if value is None or isinstance(value, bool):
        return "NULL"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return "NULL"
        return format(value, ".10g")
    text = str(value).strip().replace(",", "")
    if text == "" or text.lower() in {"-", "tr", "trace"}:
        return "NULL"
    try:
        return format(float(text), ".10g")
    except ValueError:
        return "NULL"


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    seen: set[str] = set()
    written = 0
    skipped = 0
    out_path: Path | None = None
    handle = None
    batch: list[str] = []
    batch_bytes = 0

    def flush() -> None:
        nonlocal batch, batch_bytes, handle
        if not batch or handle is None:
            return
        handle.write(
            "INSERT INTO foods ("
            + ", ".join(COLUMNS)
            + ") VALUES\n"
            + ",\n".join(batch)
            + ";\n"
        )
        batch = []
        batch_bytes = 0

    try:
        for path, serving_column in SOURCES:
            if handle is not None:
                flush()
                handle.close()
            out_path = OUT_DIR / f"foods-{path.stem}.sql"
            handle = out_path.open("w", encoding="utf-8", newline="\n")
            workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
            sheet = workbook[workbook.sheetnames[0]]
            rows = sheet.iter_rows(values_only=True)
            header = next(rows)
            index = {name: position for position, name in enumerate(header)}
            file_written = 0
            for row in rows:
                code = sql_text(row[index["식품코드"]])
                name = sql_text(row[index["식품명"]])
                category = sql_text(row[index["데이터구분명"]])
                if code is None or name is None or category is None or code[1:-1] in seen:
                    skipped += 1
                    continue
                seen.add(code[1:-1])
                basis = sql_text(row[index["영양성분함량기준량"]]) or "'100g'"
                values = ", ".join(
                    (
                        code,
                        name,
                        category,
                        basis,
                        sql_number(row[index["에너지(kcal)"]]),
                        sql_number(row[index["탄수화물(g)"]]),
                        sql_number(row[index["단백질(g)"]]),
                        sql_number(row[index["지방(g)"]]),
                        sql_text(row[index[serving_column]]) or "NULL",
                        sql_text(row[index["식품중량"]]) or "NULL",
                    )
                )
                line = f"({values})"
                line_bytes = len(line.encode("utf-8")) + 2
                if batch and batch_bytes + line_bytes > STATEMENT_LIMIT:
                    flush()
                batch.append(line)
                batch_bytes += line_bytes
                written += 1
                file_written += 1
            flush()
            workbook.close()
            print(f"{path.name}: {file_written} rows -> {out_path}", file=sys.stderr)
    finally:
        if handle is not None:
            handle.close()

    print(f"written {written}, skipped {skipped}", file=sys.stderr)


if __name__ == "__main__":
    main()
