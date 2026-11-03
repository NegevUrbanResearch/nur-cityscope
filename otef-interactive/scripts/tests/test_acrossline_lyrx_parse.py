import unittest

from otef_layer_processing.styles import hsv_to_srgb_hex, parse_acrossline_from_lyrx


def _hsv_color(h, s, v, a=100):
    return {"type": "CIMHSVColor", "colorSpace": "HSV", "values": [h, s, v, a]}


def _gradient_stroke(width, *, dashes_without_template=False):
    effects = []
    if dashes_without_template:
        effects.append(
            {
                "type": "CIMGeometricEffectDashes",
                "lineDashEnding": "NoConstraint",
                "controlPointEnding": "NoConstraint",
            }
        )
    effects.append({"type": "CIMGeometricEffectTaperedPolygon", "toWidth": 1})
    return {
        "type": "CIMGradientStroke",
        "effects": effects,
        "enable": True,
        "capStyle": "Round",
        "joinStyle": "Round",
        "width": width,
        "colorRamp": {
            "type": "CIMPolarContinuousColorRamp",
            "fromColor": _hsv_color(60, 100, 96, 100),
            "toColor": _hsv_color(0, 100, 96, 100),
            "interpolationSpace": "HSV",
        },
        "gradientMethod": "AcrossLine",
        "gradientSize": 75,
        "gradientSizeUnits": "Relative",
        "gradientType": "Continuous",
    }


def _line_symbol_ref(stroke):
    return {
        "type": "CIMSymbolReference",
        "symbol": {
            "type": "CIMLineSymbol",
            "symbolLayers": [stroke],
        },
    }


def _class_break(upper_bound, width):
    return {
        "type": "CIMClassBreak",
        "upperBound": upper_bound,
        "symbol": _line_symbol_ref(
            _gradient_stroke(width, dashes_without_template=True)
        ),
    }


# Minimal copies of CIMGradientStroke / HSV / taper from the 2026-09-14 designer lyrx.
fleeing_individual_lyrx = {
    "layerDefinitions": [
        {
            "name": "Fleeing_route",
            "transparency": 40,
            "renderer": {
                "type": "CIMSimpleRenderer",
                "symbol": _line_symbol_ref(_gradient_stroke(1)),
            },
        }
    ]
}

overlap_lyrx = {
    "layerDefinitions": [
        {
            "name": "fleeing_route_overlapp",
            "renderer": {
                "type": "CIMClassBreaksRenderer",
                "classBreakType": "GraduatedSymbol",
                "field": "COUNT_",
                "breaks": [
                    _class_break(13, 0.5),
                    _class_break(39, 1.375),
                    _class_break(100, 2.25),
                    _class_break(146, 3.125),
                    _class_break(235, 4),
                ],
            },
        }
    ]
}


class AcrossLineLyrxParseTests(unittest.TestCase):
    def test_acrossline_hsv_and_transparency(self):
        ir = parse_acrossline_from_lyrx(fleeing_individual_lyrx)
        self.assertEqual(ir["fromColor"], "#f5f500")
        self.assertEqual(ir["toColor"], "#f50000")
        self.assertEqual(ir["opacity"], 0.6)
        self.assertEqual(ir["taper"]["fromWidthPt"], 0.0)
        self.assertEqual(ir["taper"]["toWidthPt"], 1.0)
        self.assertIsNone(ir.get("dashTemplate"))
        self.assertIsNone(ir.get("dashArray"))
        self.assertFalse(ir.get("dashed"))
        self.assertNotIn("line-dasharray", ir)
        self.assertNotEqual(ir.get("color"), "#828282")
        self.assertNotEqual(ir.get("color"), "#000000")

    def test_overlap_lyrx_ignores_dashes_without_template(self):
        ir = parse_acrossline_from_lyrx(overlap_lyrx)
        self.assertIsNone(ir.get("dashArray"))
        self.assertNotEqual(ir.get("strokeStyle"), "dash")

    def test_overlap_class_break_widths(self):
        ir = parse_acrossline_from_lyrx(overlap_lyrx)
        self.assertEqual(
            [(b["max"], b["widthPt"]) for b in ir["classBreaks"]],
            [(13, 0.5), (39, 1.375), (100, 2.25), (146, 3.125), (235, 4.0)],
        )

    def test_hsv_60_converts_in_parser_only(self):
        self.assertEqual(hsv_to_srgb_hex(60, 100, 96), "#f5f500")


if __name__ == "__main__":
    unittest.main()
