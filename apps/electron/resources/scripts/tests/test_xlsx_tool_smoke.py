from __future__ import annotations

import json
import base64
import tempfile
import unittest
from pathlib import Path

from ._tool_test_harness import build_env, run_tool


class XlsxToolSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = build_env()
        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="xlsx-tool-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)
        cls.book = cls.tmpdir / "workbook.xlsx"
        bootstrap = run_tool(
            "xlsx-tool",
            "write",
            str(cls.book),
            "--cell",
            "A1",
            "--value",
            "bootstrap",
            env=cls.env,
        )
        if bootstrap.returncode != 0:
            raise RuntimeError(f"Failed to initialize xlsx fixture: {bootstrap.stderr}")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_tool(self, *args: str):
        return run_tool("xlsx-tool", *args, env=self.env)

    def test_write_read_info_export_and_add_sheet(self) -> None:
        write_a1 = self.run_tool("write", str(self.book), "--cell", "A1", "--value", "name")
        self.assertEqual(write_a1.returncode, 0, msg=write_a1.stderr)

        write_b1 = self.run_tool("write", str(self.book), "--cell", "B1", "--value", "score")
        self.assertEqual(write_b1.returncode, 0, msg=write_b1.stderr)

        write_a2 = self.run_tool("write", str(self.book), "--cell", "A2", "--value", "alice")
        self.assertEqual(write_a2.returncode, 0, msg=write_a2.stderr)

        write_b2 = self.run_tool(
            "write", str(self.book), "--cell", "B2", "--value", "42", "--type", "number"
        )
        self.assertEqual(write_b2.returncode, 0, msg=write_b2.stderr)

        info = self.run_tool("info", str(self.book))
        self.assertEqual(info.returncode, 0, msg=info.stderr)
        meta = json.loads(info.stdout)
        self.assertGreaterEqual(meta["sheet_count"], 1)

        read_json = self.run_tool("read", str(self.book), "--format", "json")
        self.assertEqual(read_json.returncode, 0, msg=read_json.stderr)
        rows = json.loads(read_json.stdout)
        self.assertEqual(rows[0]["name"], "alice")
        self.assertEqual(rows[0]["score"], 42)

        csv_path = self.tmpdir / "workbook.csv"
        exp = self.run_tool("export", str(self.book), "--format", "csv", "-o", str(csv_path))
        self.assertEqual(exp.returncode, 0, msg=exp.stderr)
        self.assertTrue(csv_path.exists())

        add_sheet = self.run_tool("add-sheet", str(self.book), "--name", "Data")
        self.assertEqual(add_sheet.returncode, 0, msg=add_sheet.stderr)

        info2 = self.run_tool("info", str(self.book))
        self.assertEqual(info2.returncode, 0, msg=info2.stderr)
        self.assertIn("Data", info2.stdout)

    def test_invalid_sheet_errors(self) -> None:
        result = self.run_tool("read", str(self.book), "--sheet", "Missing")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not found", result.stderr)

    def test_structured_build_range_styles_validation_chart_and_image(self) -> None:
        image = self.tmpdir / "pixel.png"
        image.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nZ8AAAAASUVORK5CYII="
        ))
        spec = self.tmpdir / "workbook-spec.json"
        spec.write_text(json.dumps({
            "properties": {"title": "Quarterly Scores", "creator": "Craft Agent"},
            "sheets": [{
                "name": "Scores",
                "rows": [["Name", "Math", "English"], ["Ada", 91, 88], ["Lin", 84, 95]],
                "cells": {
                    "D1": {"value": "Total", "style": {"font": {"bold": True}, "fill": {"color": "DDEBFF"}}},
                    "D2": {"formula": "SUM(B2:C2)", "style": {"numberFormat": "0"}},
                    "E1": {"value": "Summary", "style": {"alignment": {"horizontal": "center"}}},
                },
                "ranges": [{"start": "D3", "values": [[{"formula": "SUM(B3:C3)"}]]}],
                "merges": ["E1:F1"],
                "freezePanes": "A2",
                "autoFilter": "A1:D3",
                "columnWidths": {"A": 18, "B": 12},
                "conditionalFormats": [{"range": "B2:C3", "type": "colorScale"}],
                "dataValidations": [{"range": "A2:A20", "type": "list", "formula1": "\"Ada,Lin\""}],
                "charts": [{
                    "type": "column", "title": "Scores", "data": "B1:C3",
                    "categories": "A2:A3", "anchor": "F3"
                }],
                "images": [{"path": str(image), "anchor": "H1", "width": 16, "height": 16}],
            }],
        }), encoding="utf-8")
        rich_book = self.tmpdir / "rich.xlsx"
        built = self.run_tool("build", "--spec", str(spec), "-o", str(rich_book))
        self.assertEqual(built.returncode, 0, msg=built.stderr)

        batch = self.run_tool(
            "write-range", str(rich_book), "--sheet", "Scores", "--start", "A5",
            "--values", '[["Status", "Value"], ["Ready", 1]]',
            "--style", '{"fill":{"color":"E8F5E9"}}',
        )
        self.assertEqual(batch.returncode, 0, msg=batch.stderr)

        info = self.run_tool("info", str(rich_book))
        self.assertEqual(info.returncode, 0, msg=info.stderr)
        sheet = json.loads(info.stdout)["sheets"][0]
        self.assertEqual(sheet["formula_count"], 2)
        self.assertEqual(sheet["merged_ranges"], ["E1:F1"])
        self.assertEqual(sheet["conditional_format_count"], 1)
        self.assertEqual(sheet["data_validation_count"], 1)
        self.assertEqual(sheet["chart_count"], 1)
        self.assertEqual(sheet["image_count"], 1)
        self.assertEqual(sheet["freeze_panes"], "A2")


if __name__ == "__main__":
    unittest.main()
