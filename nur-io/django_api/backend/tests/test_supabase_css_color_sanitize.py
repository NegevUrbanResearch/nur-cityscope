from django.test import SimpleTestCase

from backend.supabase_proxy import _sanitize_css_color_signal


class SupabaseCssColorSanitizeTests(SimpleTestCase):
    def test_hex_and_strict_rgb_rgba_accepted(self):
        self.assertEqual(_sanitize_css_color_signal("#abc"), "#abc")
        self.assertEqual(_sanitize_css_color_signal("#aabbcc"), "#aabbcc")
        self.assertEqual(_sanitize_css_color_signal("rgb(0, 128, 255)"), "rgb(0, 128, 255)")
        self.assertEqual(
            _sanitize_css_color_signal("rgba(10, 20, 30, 0.25)"),
            "rgba(10, 20, 30, 0.25)",
        )
        self.assertEqual(
            _sanitize_css_color_signal("rgba(0,0,0,.5)"),
            "rgba(0,0,0,.5)",
        )

    def test_rejects_injection_chaining_and_non_strict_rgb(self):
        self.assertIsNone(_sanitize_css_color_signal('rgb(1,2,3);url("x")'))
        self.assertIsNone(_sanitize_css_color_signal("rgb(1,2,3)url(x)"))
        self.assertIsNone(_sanitize_css_color_signal("expression(alert(1))"))
        self.assertIsNone(_sanitize_css_color_signal("url(http://evil)"))
        self.assertIsNone(_sanitize_css_color_signal("rgb(256,0,0)"))
        self.assertIsNone(_sanitize_css_color_signal("rgb(01,2,3)"))
        self.assertIsNone(_sanitize_css_color_signal("rgb(1,2)"))
        self.assertIsNone(_sanitize_css_color_signal("rgb(1,2,3,4)"))
        self.assertIsNone(_sanitize_css_color_signal("rgba(0,0,0,2)"))
        self.assertIsNone(_sanitize_css_color_signal("rgba(0,0,0,1e-3)"))
