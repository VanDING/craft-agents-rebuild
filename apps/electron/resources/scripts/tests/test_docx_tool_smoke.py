from __future__ import annotations

import tempfile
import unittest
import base64
import json
from pathlib import Path

from ._tool_test_harness import build_env, run_tool


class DocxToolSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = build_env()
        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="docx-tool-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_tool(self, *args: str):
        return run_tool("docx-tool", *args, env=self.env)

    def test_create_extract_template_and_replace(self) -> None:
        created = self.tmpdir / "created.docx"
        create = self.run_tool(
            "create",
            "--text",
            "# Report\n\nHello **world**",
            "--title",
            "Q1",
            "-o",
            str(created),
        )
        self.assertEqual(create.returncode, 0, msg=create.stderr)
        self.assertTrue(created.exists())

        extracted = self.run_tool("extract", str(created))
        self.assertEqual(extracted.returncode, 0, msg=extracted.stderr)
        self.assertIn("Report", extracted.stdout)
        self.assertIn("Hello", extracted.stdout)

        template_doc = self.tmpdir / "template.docx"
        tmpl = self.run_tool("create", "--text", "Hello {{name}}", "-o", str(template_doc))
        self.assertEqual(tmpl.returncode, 0, msg=tmpl.stderr)

        filled_doc = self.tmpdir / "filled.docx"
        fill = self.run_tool(
            "template",
            str(template_doc),
            "--data",
            '{"name":"Balint"}',
            "-o",
            str(filled_doc),
        )
        self.assertEqual(fill.returncode, 0, msg=fill.stderr)

        extracted_filled = self.run_tool("extract", str(filled_doc))
        self.assertEqual(extracted_filled.returncode, 0, msg=extracted_filled.stderr)
        self.assertIn("Balint", extracted_filled.stdout)

        replaced_doc = self.tmpdir / "replaced.docx"
        repl = self.run_tool(
            "replace",
            str(filled_doc),
            "--find",
            "Balint",
            "--replace-with",
            "Craft Agent",
            "-o",
            str(replaced_doc),
        )
        self.assertEqual(repl.returncode, 0, msg=repl.stderr)

        extracted_replaced = self.run_tool("extract", str(replaced_doc))
        self.assertIn("Craft Agent", extracted_replaced.stdout)

    def test_template_invalid_json_fails(self) -> None:
        template_doc = self.tmpdir / "bad-template.docx"
        create = self.run_tool("create", "--text", "Hello {{name}}", "-o", str(template_doc))
        self.assertEqual(create.returncode, 0, msg=create.stderr)

        out = self.tmpdir / "bad-output.docx"
        result = self.run_tool("template", str(template_doc), "--data", "{not-json}", "-o", str(out))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Error parsing JSON", result.stderr)

    def test_structured_styles_table_image_headers_sections_and_page_setup(self) -> None:
        image = self.tmpdir / "pixel.png"
        image.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nZ8AAAAASUVORK5CYII="
        ))
        spec = self.tmpdir / "document-spec.json"
        spec.write_text(json.dumps({
            "properties": {"title": "Structured Report", "author": "Craft Agent"},
            "styles": {
                "Normal": {"fontName": "Arial", "fontSize": 10},
                "Heading 1": {"color": "1F4E79", "bold": True},
            },
            "page": {"size": "a4", "margins": {"top": 0.7, "right": 0.7, "bottom": 0.7, "left": 0.7}},
            "header": {"text": "Quarterly Report", "alignment": "center"},
            "footer": {"text": "Page", "pageNumber": True},
            "blocks": [
                {"type": "heading", "level": 1, "text": "Executive Summary"},
                {"type": "paragraph", "runs": [
                    {"text": "Revenue ", "bold": True},
                    {"text": "grew by 24%.", "color": "2E7D32"},
                ], "alignment": "justify", "spaceAfter": 8},
                {"type": "table", "style": "Table Grid", "alignment": "center", "rows": [
                    [{"text": "Metric", "shading": "DDEBFF"}, {"text": "Value", "shading": "DDEBFF"}],
                    ["Revenue", "$1.2M"],
                ]},
                {"type": "image", "path": str(image), "width": 0.2, "caption": "Generated marker"},
                {"type": "sectionBreak", "page": {"size": "letter", "orientation": "landscape"}, "header": "Appendix"},
                {"type": "paragraph", "text": "Landscape appendix"},
            ],
        }), encoding="utf-8")
        document = self.tmpdir / "structured.docx"
        created = self.run_tool("create", "--json-data", str(spec), "-o", str(document))
        self.assertEqual(created.returncode, 0, msg=created.stderr)

        info = self.run_tool("info", str(document))
        self.assertEqual(info.returncode, 0, msg=info.stderr)
        metadata = json.loads(info.stdout)
        self.assertEqual(metadata["sections"], 2)
        self.assertEqual(metadata["tables"], 1)
        self.assertEqual(metadata["inline_shapes"], 1)
        self.assertEqual(metadata["table_details"][0]["rows"], 2)
        self.assertEqual(metadata["section_details"][0]["header"], "Quarterly Report")
        self.assertEqual(metadata["section_details"][1]["orientation"], "landscape")

        extracted = self.run_tool("extract", str(document))
        self.assertEqual(extracted.returncode, 0, msg=extracted.stderr)
        self.assertIn("Executive Summary", extracted.stdout)
        self.assertIn("Revenue | $1.2M", extracted.stdout)
        self.assertIn("Landscape appendix", extracted.stdout)


if __name__ == "__main__":
    unittest.main()
