# -*- coding: utf-8 -*-
"""
Синхронизация папки данных MLSD_moscow_data с картой.

Сканирует папку MLSD_moscow_data, находит все .csv
и записывает их список в MLSD_moscow_data/manifest.json.
Карта при загрузке читает manifest.json и подхватывает все файлы.

Запуск:  python update_manifest.py   (или двойной клик по update_manifest.bat)
"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "MLSD_moscow_data"
MANIFEST = DATA_DIR / "manifest.json"

def main():
    DATA_DIR.mkdir(exist_ok=True)
    files = sorted(p.name for p in DATA_DIR.glob("*.csv"))
    MANIFEST.write_text(
        json.dumps({"files": files}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"manifest.json обновлён: {len(files)} файл(ов)")
    for f in files:
        print("  -", f)

if __name__ == "__main__":
    main()
