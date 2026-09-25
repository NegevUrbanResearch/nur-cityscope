import unittest
from nli_people_refresh import (
    apply_nli_person_fields,
    spoken_catalog_name,
    records_from_header_rows,
    build_people_search_index,
)


def _person(**props):
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [34.5, 31.4]}}


class SpokenCatalogNameTests(unittest.TestCase):
    def test_flips_one_comma_and_strips_date_tail(self):
        self.assertEqual(spoken_catalog_name("$$aלוק, שני ניקול,$$d2001-2023$$9heb"), "שני ניקול לוק")
        self.assertEqual(spoken_catalog_name("$$aShoshani, Ofir, 2003-2023$$9lat"), "Ofir Shoshani")
        self.assertEqual(spoken_catalog_name("$$aאליקים שפירא ענר$$9heb"), "")
        self.assertEqual(spoken_catalog_name(""), "")


class ApplyNliPersonFieldsTests(unittest.TestCase):
    def test_shani_hebrew_aner_untouched_and_fill_rules(self):
        people = {"features": [
            _person(pid=801, name="Shani Louk", hebrew_name="לוק שני", mms_id="987012794276905171", first_name=None, last_name=None, age="23", gender="F"),
            _person(pid=744, name="Aner Elyakim Shapira", hebrew_name="אליקים שפירא ענר", mms_id="987012770624905171"),
            _person(pid=219, name="Ohad (Bodi) Cohen", hebrew_name="כהן אוהד", mms_id="1"),
            _person(pid=921, name="Gideon Rivlin", hebrew_name="ריבלין גדעון", mms_id="2", gender="F", age="40"),
            _person(pid=338, name="Ofir Shoshani", hebrew_name="שושני אופיר", mms_id="3"),
            _person(pid=90, name="Hanna Katzir", hebrew_name="חנה קציר", status="Kidnap survivor"),
            _person(pid=50, name="Blank Age", hebrew_name="ב", mms_id="4", age=""),
            _person(pid=51, name="Unknown Gender", hebrew_name="ג", mms_id="5", gender="?"),
        ]}
        records = {
            "987012794276905171": {
                "he100": "$$aלוק, שני ניקול,$$d2001-2023$$9heb",
                "en100": "$$aLouk, Shani,$$d2001-2023$$9lat",
                "see400": "$$aLouk, Shani Nicole",
                "ar100": "", "ru100": "",
                "gender375": "$$afemale",
                "dates046": "$$f2001-02-07$$g2023-10-07",
            },
            "1": {"he100": "$$aכהן, אוהד$$9heb", "en100": "$$aCohen, Ohad$$9lat", "see400": "", "ar100": "", "ru100": "", "gender375": "", "dates046": ""},
            "2": {"he100": "$$aריבלין, גדעון$$9heb", "en100": "$$aRivlin, Gideon$$9lat", "see400": "", "ar100": "", "ru100": "", "gender375": "$$amale", "dates046": "$$f1980$$g2023"},
            "3": {"he100": "", "en100": "$$aShoshani, Ofir, 2003-2023$$9lat", "see400": "", "ar100": "", "ru100": "", "gender375": "", "dates046": ""},
            "4": {"he100": "", "en100": "", "see400": "", "ar100": "", "ru100": "", "gender375": "", "dates046": "$$f2000$$g2023"},
            "5": {"he100": "", "en100": "", "see400": "", "ar100": "", "ru100": "", "gender375": "$$afemale", "dates046": ""},
        }
        stats = apply_nli_person_fields(people, records)
        by = {f["properties"]["pid"]: f["properties"] for f in people["features"]}
        self.assertEqual(by[801]["hebrew_name"], "שני ניקול לוק")
        self.assertEqual(by[801]["name"], "Shani Louk")
        self.assertEqual(by[801]["first_name"], "Shani")
        self.assertEqual(by[801]["last_name"], "Louk")
        self.assertEqual(by[744]["hebrew_name"], "אליקים שפירא ענר")
        self.assertEqual(by[219]["name"], "Ohad (Bodi) Cohen")
        self.assertEqual(by[921]["gender"], "F")
        self.assertEqual(by[921]["age"], "40")
        self.assertNotIn("2003", by[338]["name"])
        self.assertEqual(by[50]["age"], "23")
        self.assertEqual(by[51]["gender"], "F")
        self.assertEqual(len(people["features"]), 8)
        self.assertNotIn("mms_id", by[90])
        self.assertNotIn("_nli_search_aliases", by[801])
        self.assertIn("Ohad Cohen", stats["aliases_by_pid"]["219"])
        self.assertIn("Shani Nicole Louk", stats["aliases_by_pid"]["801"])
        self.assertEqual(by[90]["hebrew_name"], "חנה קציר")


class RecordsFromHeaderRowsTests(unittest.TestCase):
    def test_maps_known_headers_and_skips_short_mms(self):
        header = ["MMSID", "Hebrew Name (100)", "English Name (100)", "400", "Arabic Name (100)", "Russian Name (100)", "375", "046"]
        rows = [
            ["987012794276905171", "$$aלוק, שני ניקול", "$$aLouk, Shani", "$$aLouk, Shani Nicole", "", "", "$$afemale", "$$f2001$$g2023"],
            ["12", "ignore", "", "", "", "", "", ""],
        ]
        recs = records_from_header_rows(header, rows)
        self.assertEqual(set(recs), {"987012794276905171"})
        self.assertEqual(recs["987012794276905171"]["he100"], "$$aלוק, שני ניקול")


class BuildPeopleSearchIndexTests(unittest.TestCase):
    def test_index_keeps_survivors_status_and_aliases(self):
        people = {"features": [
            _person(pid=801, name="Shani Louk", hebrew_name="שני ניקול לוק", status="Murdered in captivity", mms_id="x", nli_url="https://nli", location="Nova", sublocation=""),
            _person(pid=90, name="Hanna Katzir", hebrew_name="חנה קציר", status="Kidnap survivor", location="Nir Oz", sublocation="Dining room"),
        ]}
        idx = build_people_search_index(people, "v1", {"801": ["Shani Nicole Louk"]})
        by = {row["pid"]: row for row in idx["people"]}
        self.assertEqual(by["90"]["status"], "Kidnap survivor")
        self.assertEqual(by["90"]["sublocation"], "Dining room")
        self.assertEqual(by["801"]["nameForms"][0], "שני ניקול לוק")
        self.assertIn("Shani Nicole Louk", by["801"]["nameForms"])
        self.assertTrue(by["801"]["hasArchiveRecord"])
        self.assertFalse(by["90"]["hasArchiveRecord"])
        self.assertEqual({row["pid"] for row in idx["people"]}, {"801", "90"})
        self.assertEqual(idx["datasetVersion"], "v1")


if __name__ == "__main__":
    unittest.main()
