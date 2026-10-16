# -*- coding: utf-8 -*-
"""
Синхронизация папок данных с картой.

1. MLSD_moscow_data:  все .csv -> MLSD_moscow_data/manifest.json
2. data/zones:        все .geojson/.json/.gpkg -> data/zones/manifest.json

Карта при загрузке читает манифесты и подхватывает файлы.
Запуск:  python update_manifest.py   (или двойной клик по update_manifest.bat)
"""
import json
from pathlib import Path

ROOT = Path(__file__).parent

def write_manifest(folder: Path, patterns: list[str], label: str):
    folder.mkdir(parents=True, exist_ok=True)
    files = sorted(
        p.name for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in patterns and p.name != "manifest.json"
    )
    (folder / "manifest.json").write_text(
        json.dumps({"files": files}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"{label}: {len(files)} файл(ов)")
    for f in files:
        print("  -", f)

def main():
    write_manifest(ROOT / "MLSD_moscow_data", [".csv"], "MLSD_moscow_data/manifest.json")
    write_manifest(ROOT / "data" / "zones", [".geojson", ".json", ".gpkg"], "data/zones/manifest.json")

if __name__ == "__main__":
    main()
