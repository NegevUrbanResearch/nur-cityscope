import copy
import json
import hashlib
import tempfile
from pathlib import Path
from django.test import SimpleTestCase

from backend.projection_warp_assets import load_trusted_projection_asset, read_projection_baseline_manifest
from backend.projection_warp_geometry import create_full_frame_projection_mesh, evaluate_warp_mesh, evaluate_warp_point, interpolate_grid_offset, validate_warp_mesh
from backend.projection_warp_schema import migrate_projection_config_to_v2, validate_projection_config_v2, validate_projection_warp
from backend.projection_config_schema import validate_projection_config


GOLDEN = json.loads((Path(__file__).parent / 'fixtures' / 'projection-warp-golden.json').read_text())
V1 = json.loads((Path(__file__).parent / 'fixtures/projection-config-v1.json').read_text())['valid']


class ProjectionWarpTests(SimpleTestCase):
    def test_migrates_v1_framing_losslessly(self):
        migrated = migrate_projection_config_to_v2(V1)
        self.assertEqual(migrated['schemaVersion'], 2)
        self.assertEqual(migrated['pre'], V1['pre'])
        self.assertEqual(migrated['outputs']['left']['crop'], V1['outputs']['left']['crop'])
        self.assertEqual(migrated['outputs']['left']['presentationEffect'], {'enabled': False, 'mode': 'passthrough'})
        self.assertTrue(migrated['outputs']['left']['warp']['enabled'])
        self.assertEqual(migrated['outputs']['left']['warp']['baseline'], {'type': 'identity', 'width': 1920, 'height': 1080, 'origin': 'top-left'})
        self.assertEqual(validate_projection_config_v2(migrated), {})
        self.assertEqual(validate_projection_config(V1), {})

    def test_geometry_golden_cases(self):
        warp = GOLDEN['identity']['warp']
        for point in GOLDEN['samples']['identityCorners']:
            self.assertEqual(evaluate_warp_point(*point, warp), point)
        grid = json.loads(json.dumps(warp['grid']))
        sample = GOLDEN['samples']['oneCell']
        grid['offsets'][0], grid['offsets'][1], grid['offsets'][7], grid['offsets'][8] = sample['cornerOffsets']
        self.assertAlmostEqual(interpolate_grid_offset(*sample['point'], grid)[0], sample['offset'][0])
        self.assertAlmostEqual(interpolate_grid_offset(*sample['point'], grid)[1], sample['offset'][1])

    def test_mesh_preserves_uv_and_topology(self):
        mesh = GOLDEN['identity']['mesh']
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        sample = GOLDEN['samples']['bilinearCenter']
        warp['grid']['offsets'][sample['index']] = [0.01, 0]
        result = evaluate_warp_mesh(mesh, warp)
        self.assertEqual(result['triangles'], mesh['triangles'])
        self.assertEqual([[p['u'], p['v']] for p in result['vertices']], [[p['u'], p['v']] for p in mesh['vertices']])
        self.assertEqual([result['vertices'][sample['index']]['x'], result['vertices'][sample['index']]['y']], [0.51, 0.5])
        self.assertIs(validate_warp_mesh(result), result)

    def test_identity_baseline_supplies_fixed_left_and_right_topologies(self):
        left = evaluate_warp_mesh(None, GOLDEN['identity']['warp'])
        right = evaluate_warp_mesh(None, GOLDEN['rightIdentity']['warp'])
        self.assertEqual(left['vertices'], GOLDEN['identity']['mesh']['vertices'])
        self.assertEqual(left['triangles'], GOLDEN['identity']['mesh']['triangles'])
        self.assertEqual(right['vertices'], GOLDEN['rightIdentity']['mesh']['vertices'])
        self.assertEqual(right['triangles'], GOLDEN['rightIdentity']['mesh']['triangles'])
        changed = json.loads(json.dumps(GOLDEN['identity']['warp']))
        changed['grid']['offsets'][GOLDEN['samples']['bilinearCenter']['index']] = [0.01, 0]
        moved = evaluate_warp_mesh(None, changed)
        self.assertAlmostEqual(moved['vertices'][GOLDEN['samples']['bilinearCenter']['index']]['x'], 0.51)

    def test_projective_corner_samples_use_shared_fixture(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['keystone']['corners'] = GOLDEN['samples']['projectiveCorners']['corners']
        for sample in GOLDEN['samples']['projectiveCorners']['points']:
            result = evaluate_warp_point(*sample['point'], warp)
            self.assertAlmostEqual(result[0], sample['expected'][0])
            self.assertAlmostEqual(result[1], sample['expected'][1])

    def test_trusted_manifest_requires_requested_side(self):
        value = json.loads(json.dumps(GOLDEN['identity']['warp']))
        value['baseline'] = {'type': 'tdMesh', 'assetId': 'fixture-right', 'sha256': 'b' * 64, 'width': 1920, 'height': 1080, 'origin': 'top-left'}
        errors = validate_projection_warp(value, 'right', {'assets': {'left': {'assetId': 'fixture-left', 'sha256': 'a' * 64}}})
        self.assertIn('baseline.assetId', errors)
        self.assertIn('baseline.sha256', errors)

    def test_manifest_metadata_and_loader_errors_are_controlled(self):
        manifest = {'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': [], 'framing': []}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps(manifest))
            _, errors = read_projection_baseline_manifest(root)
            self.assertIn('assets', errors)
            self.assertIn('framing', errors)

        manifest = {'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': {}, 'framing': {'path': 'framing.json', 'sha256': 'invalid'}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps(manifest))
            _, errors = read_projection_baseline_manifest(root)
            self.assertIn('framing.sha256', errors)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'width': 1920, 'height': 1080, 'assets': {'left': {'assetId': 'left', 'path': 'left.json', 'sha256': 'a' * 64, 'logicalGrid': {'columns': 7, 'rows': 7}}, 'right': {'assetId': 'right', 'path': 'right.json', 'sha256': 'b' * 64, 'logicalGrid': {'columns': 8, 'rows': 7}}}, 'framing': {'path': 'framing.json', 'sha256': 'c' * 64}}))
            (root / 'left.json').write_text('{}')
            (root / 'right.json').write_text('{}')
            (root / 'framing.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                load_trusted_projection_asset(root, 'left')

    def test_loader_accepts_case_insensitive_sha256_prefix_with_local_manifest_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            left_payload = json.dumps(GOLDEN['identity']['mesh']).encode()
            right_payload = json.dumps(GOLDEN['rightIdentity']['mesh']).encode()
            (root / 'left.json').write_bytes(left_payload)
            (root / 'right.json').write_bytes(right_payload)
            left_hash = hashlib.sha256(left_payload).hexdigest()
            right_hash = hashlib.sha256(right_payload).hexdigest()
            manifest = {
                'schemaVersion': 1,
                'width': 1920,
                'height': 1080,
                'assets': {
                    'left': {'assetId': 'left', 'path': 'left.json', 'sha256': f'SHA256:{left_hash}', 'logicalGrid': {'columns': 7, 'rows': 7}},
                    'right': {'assetId': 'right', 'path': 'right.json', 'sha256': f'Sha256:{right_hash}', 'logicalGrid': {'columns': 8, 'rows': 7}},
                },
                'framing': {'path': 'framing.json', 'sha256': 'c' * 64},
            }
            (root / 'manifest.json').write_text(json.dumps(manifest))
            mesh, loaded_manifest, asset = load_trusted_projection_asset(root, 'left')
            self.assertEqual(mesh, GOLDEN['identity']['mesh'])
            self.assertEqual(loaded_manifest['assets']['left']['assetId'], 'left')
            self.assertEqual(asset['sha256'], f'SHA256:{left_hash}')

    def test_malformed_non_object_baseline_without_mesh_is_a_controlled_error(self):
        for baseline in (None, 'identity', []):
            warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
            warp['baseline'] = baseline
            with self.assertRaises(ValueError):
                evaluate_warp_mesh(None, warp)

    def test_structural_errors_are_precise(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['grid']['columns'] = 8
        self.assertIn('grid.columns', validate_projection_warp(warp, 'left'))
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['grid']['offsets'][0][0] = True
        self.assertIn('grid.offsets[0][0]', validate_projection_warp(warp, 'left'))

    def test_disabled_warp_returns_fixed_full_frame_quad(self):
        warp = json.loads(json.dumps(GOLDEN['identity']['warp']))
        warp['enabled'] = False
        self.assertEqual(evaluate_warp_mesh(None, warp), create_full_frame_projection_mesh('left'))

        right = json.loads(json.dumps(GOLDEN['rightIdentity']['warp']))
        right['enabled'] = False
        self.assertEqual(evaluate_warp_mesh(None, right), create_full_frame_projection_mesh('right'))

    def test_v7_uniform_grid_uses_legacy_geometry_and_nonuniform_layout_is_staged(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        config = migrate_projection_config_to_v7(V1)
        warp = config['outputs']['left']['warp']
        before = json.loads(json.dumps(config))
        with self.assertRaisesRegex(ValueError, 'explicit side'):
            evaluate_warp_mesh(None, warp, schema_version=7)
        legacy = json.loads(json.dumps(warp))
        del legacy['grid']['columnPositions']; del legacy['grid']['rowPositions']
        self.assertEqual(evaluate_warp_mesh(None, warp, side='left', schema_version=7), evaluate_warp_mesh(None, legacy, side='left'))
        right = config['outputs']['right']['warp']
        right_legacy = json.loads(json.dumps(right))
        del right_legacy['grid']['columnPositions']; del right_legacy['grid']['rowPositions']
        self.assertEqual(evaluate_warp_mesh(None, right, side='right', schema_version=7), evaluate_warp_mesh(None, right_legacy, side='right'))
        self.assertEqual(config, before)

    def test_v7_integral_float_counts_validate_and_evaluate_without_mutation(self):
        from backend.projection_warp_schema import validate_projection_warp_v7
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        config = migrate_projection_config_to_v7(V1)
        warp = config['outputs']['left']['warp']
        warp['grid']['columns'] = 7.0
        warp['grid']['rows'] = 7.0
        before = copy.deepcopy(warp)
        self.assertEqual(validate_projection_warp_v7(warp, 'left'), {})
        self.assertEqual(evaluate_warp_mesh(None, warp, side='left', schema_version=7),
                         evaluate_warp_mesh(None, {**warp, 'grid': {key: value for key, value in warp['grid'].items() if key not in ('columnPositions', 'rowPositions')}}, side='left'))
        legacy = copy.deepcopy(warp); legacy['grid'].pop('columnPositions'); legacy['grid'].pop('rowPositions')
        self.assertEqual(evaluate_warp_point(.31, .62, warp, .2, .8, side='left', schema_version=7),
                         evaluate_warp_point(.31, .62, legacy, .2, .8, side='left'))
        self.assertEqual(warp, before)
        legacy_float = copy.deepcopy(legacy)
        legacy_float['grid']['columns'] = 7.0
        legacy_float['grid']['rows'] = 7.0
        self.assertEqual(validate_projection_warp(legacy_float, 'left'), {})
        self.assertEqual(evaluate_warp_mesh(None, legacy_float, side='left'), evaluate_warp_mesh(None, legacy, side='left'))
        for invalid in (0, -1, 1.5, True, float('inf')):
            candidate = copy.deepcopy(warp)
            candidate['grid']['columns'] = invalid
            candidate['grid']['columnPositions'] = [] if invalid == 0 else candidate['grid']['columnPositions']
            self.assertIn('grid.columns', validate_projection_warp_v7(candidate, 'left'))

    def test_v7_oversized_integer_axis_value_is_a_field_error(self):
        from backend.projection_warp_schema import validate_projection_warp_v7, migrate_projection_config_to_v7
        warp = migrate_projection_config_to_v7(V1)['outputs']['left']['warp']
        warp['grid']['columnPositions'][1] = 10 ** 400
        self.assertIn('grid.columnPositions[1]', validate_projection_warp_v7(warp, 'left'))

    def test_v7_point_api_requires_valid_uniform_grid_and_does_not_mutate(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        warp = migrate_projection_config_to_v7(V1)['outputs']['right']['warp']
        before = copy.deepcopy(warp)
        legacy = copy.deepcopy(warp); legacy['grid'].pop('columnPositions'); legacy['grid'].pop('rowPositions')
        self.assertEqual(evaluate_warp_point(.31, .62, warp, .2, .8, side='right', schema_version=7),
                         evaluate_warp_point(.31, .62, legacy, .2, .8, side='right'))
        self.assertEqual(warp, before)
        custom = copy.deepcopy(warp); custom['grid']['rowPositions'][2] += .01
        with self.assertRaisesRegex(ValueError, 'configurable grid point evaluation requires a trusted source mesh'):
            evaluate_warp_point(.31, .62, custom, .2, .8, side='right', schema_version=7)
        malformed = copy.deepcopy(warp); malformed['grid'].pop('columnPositions')
        with self.assertRaisesRegex(ValueError, 'invalid warp'):
            evaluate_warp_point(.31, .62, malformed, .2, .8, side='right', schema_version=7)

    def test_nonuniform_v7_grid_prepares_render_topology_with_control_vertices(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        warp = migrate_projection_config_to_v7(V1)['outputs']['left']['warp']
        warp['grid'].update(columns=3, rows=3, columnPositions=[0, .17, 1], rowPositions=[0, .61, 1],
                            offsets=[[.04 if index % 3 == 1 else 0, -.03 if index // 3 == 1 else 0] for index in range(9)])
        before = copy.deepcopy(warp)
        mesh = evaluate_warp_mesh(None, warp, side='left', schema_version=7)
        self.assertEqual(mesh['validationProfile'], 'relative-source-v1')
        self.assertLessEqual(mesh['sampledMaxErrorPx'], .5)
        for t in warp['grid']['rowPositions']:
            for s in warp['grid']['columnPositions']:
                self.assertTrue(any(point['s'] == s and point['t'] == t for point in mesh['vertices']))
        self.assertEqual(warp, before)
        custom = json.loads(json.dumps(warp))
        custom['grid']['rowPositions'][1] += .01
        self.assertEqual(evaluate_warp_mesh(None, custom, side='left', schema_version=7)['validationProfile'], 'relative-source-v1')
        disabled = json.loads(json.dumps(custom)); disabled['enabled'] = False
        self.assertEqual(evaluate_warp_mesh(None, disabled, side='left', schema_version=7), create_full_frame_projection_mesh('left'))
        malformed = json.loads(json.dumps(warp)); malformed['grid']['rowPositions'].pop()
        with self.assertRaisesRegex(ValueError, 'invalid warp'):
            evaluate_warp_mesh(None, malformed, side='left', schema_version=7)

    def test_nonuniform_v7_render_accepts_integral_float_counts_without_mutation(self):
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        warp = migrate_projection_config_to_v7(V1)['outputs']['left']['warp']
        warp['grid'].update(columns=3, rows=3, columnPositions=[0, .17, 1], rowPositions=[0, .61, 1], offsets=[[0, 0] for _ in range(9)])
        integer_mesh=evaluate_warp_mesh(None,warp,side='left',schema_version=7)
        float_warp=copy.deepcopy(warp);float_warp['grid']['columns']=3.0;float_warp['grid']['rows']=3.0
        before=copy.deepcopy(float_warp)
        float_mesh=evaluate_warp_mesh(None,float_warp,side='left',schema_version=7)
        self.assertEqual(float_mesh['triangles'],integer_mesh['triangles'])
        self.assertEqual(len(float_mesh['vertices']),len(integer_mesh['vertices']))
        self.assertEqual(float_warp,before)

    def test_compact_shared_grid_render_fixture_fixes_deterministic_topology(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        result=evaluate_warp_mesh(fixture['mesh'],fixture['warp'],side='left',schema_version=7)
        self.assertEqual(len(result['vertices']),fixture['expected']['vertexCount'])
        self.assertEqual(len(result['triangles'])//3,fixture['expected']['triangleCount'])
        self.assertEqual(result['triangles'],fixture['expected']['triangles'])
        self.assertLessEqual(result['sampledMaxErrorPx'],.5)
        for t in fixture['warp']['grid']['rowPositions']:
            for s in fixture['warp']['grid']['columnPositions']:
                self.assertTrue(any(p['s']==s and p['t']==t for p in result['vertices']))

    def test_relative_source_profile_accepts_small_faces_and_rejects_float32_collapse(self):
        small={'width':1920,'height':1080,'validationProfile':'relative-source-v1','vertices':[
            {'s':.1,'t':.1,'x':.1,'y':.1,'u':0,'v':0},{'s':.101,'t':.1,'x':.101,'y':.1,'u':1,'v':0},{'s':.1,'t':.101,'x':.1,'y':.101,'u':0,'v':1}], 'triangles':[0,1,2]}
        self.assertIs(validate_warp_mesh(small),small)
        collapsed={**small,'vertices':[
            {'s':.3,'t':.3,'x':.3,'y':.3,'u':0,'v':0},{'s':.300000001,'t':.3,'x':.300000001,'y':.3,'u':1,'v':0},{'s':.3,'t':.300000001,'x':.3,'y':.300000001,'u':0,'v':1}]}
        with self.assertRaisesRegex(ValueError,'render precision collapses or inverts a grid triangle'):
            validate_warp_mesh(collapsed)
        with self.assertRaisesRegex(ValueError,'validation profile is unknown'):
            validate_warp_mesh({**small,'validationProfile':'unknown'})

    def test_sampled_render_error_uses_float32_vertices_against_double_target(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        warp=copy.deepcopy(fixture['warp']);warp['grid']['offsets']=[[.123456,.031415] for _ in warp['grid']['offsets']]
        result=evaluate_warp_mesh(fixture['mesh'],warp,side='left',schema_version=7)
        self.assertGreater(result['sampledMaxErrorPx'],0)
        self.assertLessEqual(result['sampledMaxErrorPx'],.5)

    def test_grid_point_agreement_and_near_axis_or_fold_rejection(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        result=evaluate_warp_mesh(fixture['mesh'],fixture['warp'],side='left',schema_version=7)
        from backend.projection_grid_mesh import evaluate_grid_warp_point
        for t in fixture['warp']['grid']['rowPositions']:
            for s in fixture['warp']['grid']['columnPositions']:
                point=evaluate_grid_warp_point(fixture['mesh'],fixture['warp'],s,t)
                vertex=next(p for p in result['vertices'] if p['s']==s and p['t']==t)
                self.assertEqual([point['x'],point['y']],[vertex['x'],vertex['y']])
        tiny=copy.deepcopy(fixture['warp']);tiny['grid']['columnPositions']=[0,5e-11,1]
        with self.assertRaisesRegex(ValueError,'source grid is numerically degenerate'):
            evaluate_warp_mesh(fixture['mesh'],tiny,side='left',schema_version=7)
        folded=copy.deepcopy(fixture['warp']);folded['grid']['offsets']=[[ -.8 if i%3==1 else 0,0] for i in range(9)]
        with self.assertRaisesRegex(ValueError,'grid warp folds or collapses a triangle'):
            evaluate_warp_mesh(fixture['mesh'],folded,side='left',schema_version=7)
        pole=copy.deepcopy(fixture['warp']);slope=1/.513;scale=.001;pole['keystone']['corners']=[[0,0],[scale/(1-slope),0],[0,scale],[scale/(1-slope),scale/(1-slope)]]
        with self.assertRaisesRegex(ValueError,'projective denominator'):
            evaluate_warp_mesh(fixture['mesh'],pole,side='left',schema_version=7)

    def test_global_source_sampling_retains_coverage_near_bin_boundary_knot(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        warp=copy.deepcopy(fixture['warp']);warp['grid'].update(columns=3,rows=2,columnPositions=[0,.5-1e-14,1],rowPositions=[0,1],offsets=[[0,0] for _ in range(6)])
        mesh=evaluate_warp_mesh(fixture['mesh'],warp,side='left',schema_version=7)
        self.assertTrue(mesh['triangles']);self.assertLessEqual(mesh['sampledMaxErrorPx'],.5)
        self.assertEqual(evaluate_warp_point(0,0,warp,.5,.5,side='left',schema_version=7,mesh=fixture['mesh']),[.5,.5])

    def test_compiled_global_probe_retains_every_tolerance_incident_face(self):
        from backend.projection_grid_mesh import _compile_source_probe_state
        vertices=[{'s':0,'t':0,'x':0,'y':0,'u':0,'v':0},{'s':1,'t':0,'x':1,'y':0,'u':1,'v':0},
                  {'s':0,'t':1,'x':0,'y':1,'u':0,'v':1},{'s':1,'t':1,'x':1,'y':1,'u':1,'v':1}]
        faces=[{'v':[0,1,2],'tri':0,'cell':0},{'v':[0,1,2],'tri':0,'cell':1},
               {'v':[2,1,3],'tri':1,'cell':0},{'v':[2,1,3],'tri':1,'cell':1}]
        sample=lambda s,t,triangle_id:{'s':s,'t':t,'x':s,'y':t,'u':s,'v':t,'triangleId':triangle_id}
        state=_compile_source_probe_state(vertices,faces,[0,.5-1e-14,1],[0,1],sample)
        check=next(item for item in state['globalChecks'] if item['owner']['baseline']['s']==.5 and item['owner']['baseline']['t']==.5)
        self.assertEqual([entry['faceId'] for entry in check['incident']],[0,1,2,3])

    def test_refinement_capacity_or_depth_limit_rejects_partial_topology(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        warp=copy.deepcopy(fixture['warp']);warp['grid']['offsets']=[[.01 if i==4 else 0,0] for i in range(9)]
        from backend.projection_grid_mesh import prepare_grid_warp_mesh
        with self.assertRaisesRegex(ValueError,'mesh vertex capacity exceeded|refinement did not meet'):
            prepare_grid_warp_mesh(fixture['mesh'],warp,side='left',tolerance_px=1e-9)

    def test_nonuniform_residual_grids_prepare_both_trusted_dense_td_outputs(self):
        from backend.projection_warp_assets import load_trusted_projection_asset
        from backend.projection_config_service import projection_baseline_root
        from backend.projection_warp_schema import migrate_projection_config_to_v7
        config=migrate_projection_config_to_v7(V1);xs=[0,.16,.52,.77,1];ys=[0,.22,.54,.8,1]
        for side in ('left','right'):
            baseline,_,_=load_trusted_projection_asset(projection_baseline_root(),side)
            warp=copy.deepcopy(config['outputs'][side]['warp']);warp['keystone']['corners']=[[0,0],[1,0],[0,1],[1,1]]
            warp['grid'].update(columns=5,rows=5,columnPositions=xs,rowPositions=ys,
                offsets=[[.001*(index%5)*(index//5),-.001*(index%5)*(index//5)] for index in range(25)])
            before=copy.deepcopy(warp);result=evaluate_warp_mesh(baseline,warp,side=side,schema_version=7)
            self.assertEqual(result['side'],side);self.assertEqual(result['validationProfile'],'relative-source-v1')
            self.assertLessEqual(len(result['vertices']),65536);self.assertLessEqual(result['sampledMaxErrorPx'],.5)
            for t in ys:
                for s in xs:self.assertTrue(any(p['s']==s and p['t']==t for p in result['vertices']))
            self.assertEqual(warp,before)

    def test_rectangular_three_by_five_cells_keep_row_major_control_sampling(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        warp=copy.deepcopy(fixture['warp']);xs=[0,.37,1];ys=[0,.2,.55,.78,1]
        warp['grid'].update(columns=3,rows=5,columnPositions=xs,rowPositions=ys,
            offsets=[[.0005*(i%3)*(i//3),-.0003*(i%3)*(i//3)] for i in range(15)])
        mesh=evaluate_warp_mesh(fixture['mesh'],warp,side='left',schema_version=7)
        self.assertLessEqual(mesh['sampledMaxErrorPx'],.5)
        from backend.projection_grid_mesh import evaluate_grid_warp_point
        for t in ys:
            for s in xs:
                vertex=next(p for p in mesh['vertices'] if p['s']==s and p['t']==t)
                point=evaluate_grid_warp_point(fixture['mesh'],warp,s,t)
                self.assertEqual([point['x'],point['y']],[vertex['x'],vertex['y']])

    def test_accepted_nonidentity_refinement_matches_shared_all_attribute_fixture(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-refinement-parity.json').read_text())
        result=evaluate_warp_mesh(fixture['mesh'],fixture['warp'],side='left',schema_version=7)
        self.assertEqual(result['triangles'],fixture['triangles'])
        self.assertEqual(len(result['vertices']),len(fixture['vertices']))
        for actual,expected in zip(result['vertices'],fixture['vertices']):
            for key in ('s','t','x','y','u','v'):self.assertAlmostEqual(actual[key],expected[key],places=10)
        self.assertLessEqual(result['sampledMaxErrorPx'],.5)

    def test_configurable_identity_without_imported_mesh_uses_full_frame_source(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        warp=copy.deepcopy(fixture['warp']);warp['grid']['offsets']=[[0,0] for _ in warp['grid']['offsets']]
        implicit=evaluate_warp_mesh(None,warp,side='left',schema_version=7)
        from backend.projection_warp_geometry import create_full_frame_projection_mesh
        explicit=evaluate_warp_mesh(create_full_frame_projection_mesh('left'),warp,side='left',schema_version=7)
        self.assertEqual(implicit['vertices'],explicit['vertices'])
        self.assertEqual(implicit['triangles'],explicit['triangles'])

    def test_relative_source_validation_rejects_insufficient_float32_area_ratio(self):
        mesh={'width':1920,'height':1080,'validationProfile':'relative-source-v1','vertices':[
            {'s':0,'t':0,'x':.6113237719982862,'y':.9376534202601761,'u':0,'v':0},
            {'s':1,'t':0,'x':.7954265424050391,'y':.6015647205058485,'u':1,'v':0},
            {'s':0,'t':1,'x':.7312631888714295,'y':.7186981057826362,'u':0,'v':1}], 'triangles':[0,1,2]}
        with self.assertRaisesRegex(ValueError,'render precision collapses or inverts a grid triangle'):
            validate_warp_mesh(mesh)

    def test_grid_candidate_cache_is_defensive_bounded_and_tracks_baseline_mutation(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        baseline=copy.deepcopy(fixture['mesh']);warp=copy.deepcopy(fixture['warp'])
        original=evaluate_warp_mesh(baseline,warp,side='left',schema_version=7)
        expected_uv=next(point['u'] for point in original['vertices'] if point['s']==0 and point['t']==0)
        original['vertices'][0]['x']=999
        for index in range(1,5):
            changed=copy.deepcopy(warp);changed['grid']['offsets'][4]=[index*1e-4,index*-1e-4]
            evaluate_warp_mesh(baseline,changed,side='left',schema_version=7)
        after_eviction=evaluate_warp_mesh(baseline,warp,side='left',schema_version=7)
        self.assertNotEqual(after_eviction['vertices'][0]['x'],999)
        self.assertEqual(next(point['u'] for point in after_eviction['vertices'] if point['s']==0 and point['t']==0),expected_uv)
        changed_keystone=copy.deepcopy(warp);changed_keystone['keystone']['corners']=[[0,0],[.98,.02],[.02,.97],[1,1]]
        changed_result=evaluate_warp_mesh(baseline,changed_keystone,side='left',schema_version=7)
        fresh_result=evaluate_warp_mesh(copy.deepcopy(baseline),copy.deepcopy(changed_keystone),side='left',schema_version=7)
        self.assertEqual(changed_result['triangles'],fresh_result['triangles'])
        self.assertEqual(changed_result['vertices'],fresh_result['vertices'])
        baseline['vertices'][0]=dict(baseline['vertices'][0],u=baseline['vertices'][0]['u']+.01)
        changed_baseline=evaluate_warp_mesh(baseline,warp,side='left',schema_version=7)
        fresh_baseline=evaluate_warp_mesh(copy.deepcopy(baseline),copy.deepcopy(warp),side='left',schema_version=7)
        self.assertEqual(changed_baseline['vertices'],fresh_baseline['vertices'])
        self.assertEqual(changed_baseline['triangles'],fresh_baseline['triangles'])
        self.assertEqual(changed_baseline['sampledMaxErrorPx'],fresh_baseline['sampledMaxErrorPx'])
        self.assertAlmostEqual(next(point['u'] for point in changed_baseline['vertices'] if point['s']==0 and point['t']==0),expected_uv+.01,places=10)

    def test_public_point_evaluation_rebuilds_sampler_after_destination_replacement(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/projection-grid-render-parity.json').read_text())
        baseline=copy.deepcopy(fixture['mesh'])
        evaluate_warp_point(0,0,fixture['warp'],0,0,side='left',schema_version=7,mesh=baseline)
        baseline['vertices'][0]=dict(baseline['vertices'][0],x=baseline['vertices'][0]['x']+.01)
        actual=evaluate_warp_point(0,0,fixture['warp'],0,0,side='left',schema_version=7,mesh=baseline)
        expected=evaluate_warp_point(0,0,fixture['warp'],0,0,side='left',schema_version=7,mesh=copy.deepcopy(baseline))
        self.assertEqual(actual,expected)
