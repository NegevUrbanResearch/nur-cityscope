import copy
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from pyproj import Transformer
from shapely.geometry import LineString, shape
from shapely.ops import transform

import otef_layer_processing.nli_border_route_curation as curation
from otef_layer_processing.nli_border_route_curation import validate_base_pair, validate_recipe

RECIPE_PATH = Path(__file__).parents[1] / "nli-border-route-curation.json"


class RecipeValidationTests(unittest.TestCase):
    def load_recipe(self):
        return json.loads(RECIPE_PATH.read_text(encoding="utf-8"))

    def test_recipe_has_only_18_accepted_operations(self):
        recipe = self.load_recipe()
        validate_recipe(recipe)
        self.assertEqual(len(recipe["operations"]), 18)
        self.assertEqual({op["kind"] for op in recipe["operations"]}, {"new_approach", "trim_first_crossing", "extend_origin_direction"})

    def test_erez30_local_join_and_erez32_road_shape_are_selected(self):
        recipe = self.load_recipe()
        shapes = {op["parent_id"]: op["shape"] for op in recipe["operations"] if op["kind"] == "new_approach"}
        self.assertEqual(shapes[30], "origin_direction")
        self.assertEqual(shapes[32], "road_polyline")
        self.assertEqual({k: recipe["road_operation"][k] for k in ("feature_fid", "road_num", "start_vertex", "direction")}, {"feature_fid": 0, "road_num": "4", "start_vertex": 0, "direction": "forward"})

    def test_new_ids_are_stable_and_unique(self):
        operations = self.load_recipe()["operations"]
        new_ops = [o for o in operations if o["kind"] == "new_approach"]
        self.assertEqual({o["feature_id"] for o in new_ops}, set(range(1013, 1022)))
        self.assertEqual({o["feature_id"]: o["parent_id"] for o in new_ops}, dict(zip(range(1013,1022), [23,29,40,42,44,51,61,30,32])))
        existing = {o["feature_id"]: (o["parent_id"],o["kind"]) for o in operations if o["feature_id"] in {1001,1002,1005,1006,1008,1009,1010,1011,1012}}
        self.assertEqual(existing, {1001:(64,"trim_first_crossing"),1002:(66,"trim_first_crossing"),1005:(59,"trim_first_crossing"),1006:(57,"trim_first_crossing"),1008:(7,"trim_first_crossing"),1009:(1,"trim_first_crossing"),1010:(10,"trim_first_crossing"),1011:(43,"extend_origin_direction"),1012:(34,"extend_origin_direction")})
        self.assertEqual({k for k,v in self.load_recipe()["confirmed_directions"].items() if v == "reverse"},{"4","16"})

    def test_recipe_rejects_changed_operation_direction_and_road_hash(self):
        recipe = self.load_recipe()
        wrong_direction = copy.deepcopy(recipe)
        wrong_direction["operations"][0]["direction"] = "reverse"
        with self.assertRaises(ValueError):
            validate_recipe(wrong_direction)
        wrong_hash = copy.deepcopy(recipe)
        wrong_hash["road_operation"]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            validate_recipe(wrong_hash)

    def fixture_pair(self):
        recipe = self.load_recipe()
        ids = list(range(1,69)) + list(range(1001,1013))
        features = [{"type":"Feature","properties":{"OBJECTID":fid,"name":str(fid), **({"route_confidence":"unconfirmed"} if fid >= 1001 else {})},"geometry":{"type":"LineString","coordinates":[[fid,2],[fid+1,3]]}} for fid in ids]
        source = {"type":"FeatureCollection","features":features}
        runtime = copy.deepcopy(source)
        for feature in runtime["features"]:
            fid=feature["properties"]["OBJECTID"]
            feature["properties"]["flow_direction"] = recipe["confirmed_directions"][str(fid)] if fid < 1001 else "forward"
        return source,runtime,recipe

    def test_source_runtime_pair_differs_only_by_reviewed_direction_metadata(self):
        source,runtime,recipe=self.fixture_pair()
        normalized=validate_base_pair(source,runtime,recipe)
        self.assertEqual(normalized,runtime)
        bad=copy.deepcopy(runtime); bad["features"][3]["properties"]["name"]="changed"
        with self.assertRaises(ValueError): validate_base_pair(source,bad,recipe)

    def test_baseline_rejects_missing_target_or_parent_even_when_count_is_preserved(self):
        source,runtime,recipe=self.fixture_pair()
        for missing_id in (1001,64):
            bad_source=copy.deepcopy(source)
            bad_runtime=copy.deepcopy(runtime)
            for collection in (bad_source,bad_runtime):
                feature=next(f for f in collection["features"] if f["properties"]["OBJECTID"] == missing_id)
                feature["properties"]["OBJECTID"] = 2000
            self.assertEqual(len(bad_source["features"]),80)
            with self.subTest(missing_id=missing_id), self.assertRaises(ValueError):
                validate_base_pair(bad_source,bad_runtime,recipe)

    def test_present_conflicting_source_direction_is_rejected(self):
        source,runtime,recipe=self.fixture_pair()
        source["features"][3]["properties"]["flow_direction"]="forward"
        with self.assertRaises(ValueError):
            validate_base_pair(source,runtime,recipe)

    def test_baseline_rejects_unconfirmed_classification_changes(self):
        source,runtime,recipe=self.fixture_pair()
        for collection in (source,runtime):
            feature=next(f for f in collection["features"] if f["properties"]["OBJECTID"] == 1001)
            feature["properties"].pop("route_confidence")
        with self.assertRaises(ValueError):
            validate_base_pair(source,runtime,recipe)

    def test_missing_parents_duplicate_ids_and_unsupported_geometry_are_rejected(self):
        source,runtime,recipe=self.fixture_pair()
        for mutation in ("missing", "duplicate", "geometry", "parent"):
            bad=copy.deepcopy(source)
            if mutation == "missing": bad["features"].pop()
            elif mutation == "duplicate": bad["features"].append(copy.deepcopy(bad["features"][0]))
            elif mutation == "geometry": bad["features"][0]["geometry"]["type"]="Polygon"
            else:
                altered=copy.deepcopy(recipe); altered["operations"][0]["parent_id"]=999
                with self.assertRaises(ValueError): validate_recipe(altered)
                continue
            with self.assertRaises(ValueError): validate_base_pair(bad,bad,recipe)


class GeometryConstructionTests(unittest.TestCase):
    """Self-contained projected fixtures; no ignored route data is read."""
    def fixture(self):
        recipe = {"schema_version":1,"base_feature_count":80,"construction_crs":curation.EXPECTED_CRS,"output_crs":"EPSG:4326","confirmed_directions":{str(i):("reverse" if i in (4,16) else "forward") for i in range(1,69)},"road_operation":{"sha256":"a"*64,"feature_fid":0,"road_num":"4","start_vertex":0,"direction":"forward"},"operations":[]}
        parents = {1013:23,1014:29,1015:40,1016:42,1017:44,1018:51,1019:61,1020:30,1021:32}
        trimmed = {1001:64,1002:66,1005:59,1006:57,1008:7,1009:1,1010:10}
        extended = {1011:43,1012:34}
        for fid,parent in parents.items(): recipe["operations"].append({"kind":"new_approach","feature_id":fid,"parent_id":parent,"shape":"road_polyline" if fid==1021 else "origin_direction","direction":"forward"})
        for fid,parent in trimmed.items(): recipe["operations"].append({"kind":"trim_first_crossing","feature_id":fid,"parent_id":parent,"direction":"forward"})
        for fid,parent in extended.items(): recipe["operations"].append({"kind":"extend_origin_direction","feature_id":fid,"parent_id":parent,"direction":"forward"})
        to_wgs=Transformer.from_crs(curation.EXPECTED_CRS,"EPSG:4326",always_xy=True)
        def wgs(x,y): return list(to_wgs.transform(x,y))
        features=[]
        for fid in list(range(1,69))+list(range(1001,1013)):
            y=100+fid*10
            coords=[wgs(200100,y),wgs(200200,y)]
            if fid in (4,16): coords.reverse()
            if fid in {1001,1002,1005,1006,1008,1009,1010}: coords=[wgs(200100,y),wgs(199900,y),wgs(199800,y)]
            if fid in (1011,1012): coords=[wgs(200100,y),wgs(200200,y)]
            props={"OBJECTID":fid,"Name":str(fid),"timeline":"07:00","timeline_minutes":420,"flow_direction":"reverse" if fid in (4,16) else "forward"}
            if fid>=1001: props["route_confidence"]="unconfirmed"
            features.append({"type":"Feature","id":fid,"geometry":{"type":"LineString","coordinates":coords},"properties":props})
        border={"type":"Feature","geometry":{"type":"LineString","coordinates":[wgs(200000,0),wgs(200000,20000)]},"properties":{}}
        road={"type":"Feature","properties":{"FID":0,"NUM":"4"},"geometry":{"type":"LineString","coordinates":[wgs(200000,420),wgs(200040,420),wgs(200100,420)]}}
        road_hash=curation._feature_sha(road)
        return recipe,{"type":"FeatureCollection","features":features},border,{"sha256":"a"*64,"features":[road]},road_hash,to_wgs

    def build(self, recipe, runtime, border, road, road_feature_hash):
        with patch.object(curation,"validate_recipe"), patch.object(curation,"EXPECTED_ROAD_FEATURE_SHA256",road_feature_hash):
            return curation.build_curated_routes(runtime,border,recipe,road)

    def test_new_approach_is_unconfirmed_and_meets_parent_origin_exactly(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,_=self.build(recipe,runtime,border,road,road_hash)
        child=next(f for f in result["features"] if f["properties"]["OBJECTID"]==1013); parent=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==23)
        self.assertEqual(child["properties"]["route_confidence"],"unconfirmed"); self.assertEqual(child["properties"]["parent_objectid"],23)
        self.assertEqual(child["geometry"]["coordinates"], [child["geometry"]["coordinates"][0], parent["geometry"]["coordinates"][0]])

    def test_all_origin_direction_children_end_at_origin_without_parent_suffix(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,_=self.build(recipe,runtime,border,road,road_hash)
        output={f["properties"]["OBJECTID"]:f for f in result["features"]}
        parents={f["properties"]["OBJECTID"]:f for f in runtime["features"]}
        for child_id,parent_id in curation.EXPECTED_NEW_PARENTS.items():
            if parent_id == 32:
                continue
            child=output[child_id]
            self.assertEqual(len(child["geometry"]["coordinates"]), 2, child_id)
            self.assertEqual(child["geometry"]["coordinates"][-1], parents[parent_id]["geometry"]["coordinates"][0], child_id)
            self.assertEqual(child["properties"]["route_confidence"], "unconfirmed", child_id)

    def test_builder_output_reveals_continuously_into_parent_in_real_renderer(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,_=self.build(recipe,runtime,border,road,road_hash)
        features={f["properties"]["OBJECTID"]:f for f in result["features"]}
        payload=json.dumps({"child":features[1013],"parent":features[23]})
        script='''
import { splitCompositeLineFrame } from "./frontend/src/shared/nli-unconfirmed-route-progress.js";
import { buildLinePathMetrics } from "./frontend/src/shared/maplibre-line-progress-primitives.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { child, parent } = JSON.parse(input);
const childLength = buildLinePathMetrics(child.geometry.coordinates).total;
const parentLength = buildLinePathMetrics(parent.geometry.coordinates).total;
const split = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: childLength / (childLength + parentLength) });
process.stdout.write(JSON.stringify({ childCompleted: split.unconfirmedCompleted.includes(child), confirmedProgress: split.confirmedActive[0]?.progress, head: split.headPoints[0]?.coordinates, join: parent.geometry.coordinates[0] }));
'''
        app=Path(__file__).resolve().parents[2]
        completed=subprocess.run([r"C:\Program Files\nodejs\node.exe", "--input-type=module", "-e", script],
                                 cwd=app,input=payload,text=True,capture_output=True,check=True)
        rendered=json.loads(completed.stdout)
        self.assertTrue(rendered["childCompleted"])
        self.assertEqual(rendered["confirmedProgress"], 0)
        self.assertEqual(rendered["head"], rendered["join"])

    def test_reverse_parent_gets_forward_child(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); recipe["operations"][0]["parent_id"]=4
        child_result,_=self.build(recipe,runtime,border,road,road_hash)
        child=next(f for f in child_result["features"] if f["properties"]["OBJECTID"]==1013); parent=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==4)
        self.assertEqual(child["properties"]["flow_direction"],"forward"); self.assertEqual(child["geometry"]["coordinates"][1],parent["geometry"]["coordinates"][-1])

    def test_first_crossing_follows_travel_order(self):
        recipe,runtime,border,road,road_hash,_=self.fixture()
        # Add a second border crossing farther along the route.
        to_wgs=Transformer.from_crs(curation.EXPECTED_CRS,"EPSG:4326",always_xy=True)
        border["geometry"]["coordinates"]=[[to_wgs.transform(200000,0)[0],to_wgs.transform(200000,0)[1]],[to_wgs.transform(200000,20000)[0],to_wgs.transform(200000,20000)[1]],[to_wgs.transform(199950,20000)[0],to_wgs.transform(199950,20000)[1]],[to_wgs.transform(199950,0)[0],to_wgs.transform(199950,0)[1]]]
        result,_=self.build(recipe,runtime,border,road,road_hash); out=next(f for f in result["features"] if f["properties"]["OBJECTID"]==1001)
        xy=Transformer.from_crs("EPSG:4326",curation.EXPECTED_CRS,always_xy=True).transform(*out["geometry"]["coordinates"][0])
        self.assertAlmostEqual(xy[0],200000,places=2)

    def test_trim_preserves_remaining_vertices(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); original=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==1001)["geometry"]["coordinates"]
        result,_=self.build(recipe,runtime,border,road,road_hash); out=next(f for f in result["features"] if f["properties"]["OBJECTID"]==1001)["geometry"]["coordinates"]
        self.assertEqual(out[1:],original[1:])

    def test_duplicate_parent_approach_rejected(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); runtime["features"][67]["properties"]["OBJECTID"]=1013
        with self.assertRaisesRegex(ValueError,"duplicate feature ID|duplicate approach"):
            self.build(recipe,runtime,border,road,road_hash)

    def test_no_hit_does_not_invent_fallback(self):
        recipe,runtime,border,road,road_hash,to_wgs=self.fixture(); border["geometry"]["coordinates"]=[to_wgs.transform(300000,0),to_wgs.transform(300000,20000)]
        with self.assertRaisesRegex(ValueError,"no border intersection"):
            self.build(recipe,runtime,border,road,road_hash)

    def test_unchanged_features_compare_exactly(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,audit=self.build(recipe,runtime,border,road,road_hash)
        output={f["properties"]["OBJECTID"]:f for f in result["features"]}
        for fid in range(1,69):
            before=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==fid)
            self.assertEqual(output[fid]["geometry"],before["geometry"])
            self.assertEqual(output[fid]["properties"],before["properties"])
        self.assertTrue(audit["unchanged_confirmed"])

    def test_road32_preserves_road_vertices_and_exact_origin(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,_=self.build(recipe,runtime,border,road,road_hash)
        feature=next(f for f in result["features"] if f["properties"]["OBJECTID"]==1021); parent=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==32)
        self.assertEqual(feature["geometry"]["coordinates"][-1],parent["geometry"]["coordinates"][0])
        for road_vertex in road["features"][0]["geometry"]["coordinates"][1:-1]:
            self.assertIn(road_vertex,feature["geometry"]["coordinates"])

    def test_road32_rejects_changed_road_hash_or_feature(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); bad=copy.deepcopy(road); bad["sha256"]="0"*64
        with self.assertRaisesRegex(ValueError,"road layer hash changed"): self.build(recipe,runtime,border,bad,road_hash)
        bad=copy.deepcopy(road); bad["features"][0]["geometry"]["coordinates"][1][0]+=0.0001
        with self.assertRaisesRegex(ValueError,"road feature geometry changed"): self.build(recipe,runtime,border,bad,road_hash)

    def test_road_approach_rejects_border_reentry_on_simple_line(self):
        recipe,runtime,border,road,_,to_wgs=self.fixture()
        road_feature=road["features"][0]
        road_feature["geometry"]["coordinates"]=[to_wgs.transform(200000,420),to_wgs.transform(199900,425),to_wgs.transform(200100,430)]
        parent=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==32)
        parent["geometry"]["coordinates"]=[to_wgs.transform(200100,430),to_wgs.transform(200200,435)]
        projected=Transformer.from_crs("EPSG:4326",curation.EXPECTED_CRS,always_xy=True)
        self.assertTrue(LineString([projected.transform(*p) for p in road_feature["geometry"]["coordinates"]]).is_simple)
        road_feature_hash=curation._feature_sha(road_feature)
        with self.assertRaisesRegex(ValueError,"additional border crossing or re-entry"):
            self.build(recipe,runtime,border,road,road_feature_hash)

    def test_extension_rejects_border_reentry_on_simple_line(self):
        recipe,runtime,border,road,road_hash,to_wgs=self.fixture()
        target=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==1011)
        y=100+1011*10
        target["geometry"]["coordinates"]=[to_wgs.transform(200100,y),to_wgs.transform(200200,y+5),to_wgs.transform(199900,y+10),to_wgs.transform(200200,y+15)]
        projected=Transformer.from_crs("EPSG:4326",curation.EXPECTED_CRS,always_xy=True)
        coords=[projected.transform(*p) for p in target["geometry"]["coordinates"]]
        self.assertTrue(LineString(coords).is_simple)
        border_xy=transform(projected.transform,shape(border["geometry"]))
        hit=curation._first_border_hit(coords[0],coords[1],border_xy)
        self.assertTrue(LineString([hit,*coords]).is_simple)
        with self.assertRaisesRegex(ValueError,"additional border crossing or re-entry"):
            self.build(recipe,runtime,border,road,road_hash)

    def test_extension_loop_guard_includes_emitted_origin_vertex(self):
        recipe,runtime,border,road,road_hash,to_wgs=self.fixture()
        target=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==1011)
        y=100+1011*10
        # With the emitted origin vertex (20, 0), segment origin->C crosses
        # the later C->D segment. The shortcut from hit directly to C is simple.
        projected_coords=[(200020,y),(200057.531,y-67.643),(200120,y),(200020.239,y-21.243),(200055.795,y+92.355)]
        target["geometry"]["coordinates"]=[to_wgs.transform(*point) for point in projected_coords]
        projected=Transformer.from_crs("EPSG:4326",curation.EXPECTED_CRS,always_xy=True)
        target_xy=[projected.transform(*point) for point in target["geometry"]["coordinates"]]
        border_xy=transform(projected.transform,shape(border["geometry"]))
        hit=curation._first_border_hit(target_xy[0],target_xy[2],border_xy)
        shortcut=LineString([hit,*target_xy[1:]])
        emitted=LineString([hit,*target_xy])
        self.assertTrue(shortcut.is_simple)
        self.assertFalse(emitted.is_simple)
        with self.assertRaisesRegex(ValueError,"contains a loop"):
            self.build(recipe,runtime,border,road,road_hash)

    def test_route30_never_relocates_to_route29(self):
        recipe,runtime,border,road,road_hash,_=self.fixture(); result,_=self.build(recipe,runtime,border,road,road_hash)
        child=next(f for f in result["features"] if f["properties"]["OBJECTID"]==1020); p30=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==30); p29=next(f for f in runtime["features"] if f["properties"]["OBJECTID"]==29)
        self.assertEqual(child["properties"]["parent_objectid"],30); self.assertEqual(child["geometry"]["coordinates"][1],p30["geometry"]["coordinates"][0]); self.assertNotEqual(child["geometry"]["coordinates"][1],p29["geometry"]["coordinates"][0])

if __name__ == "__main__": unittest.main()
