import hashlib
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.models import OTEFProjectionCalibration, Table
from backend.projection_config_service import projection_baseline_root
from backend.projection_warp_assets import load_trusted_projection_asset, read_projection_baseline_manifest
from backend.projection_warp_geometry import evaluate_warp_mesh
from backend.projection_warp_schema import (
    TD_MIGRATION_PRESET_ID,
    TD_MIGRATION_PRESET_NAME,
    migrate_projection_config_to_v2,
    validate_projection_config_v2,
)


def _digest(value):
    value = str(value)
    return value[7:] if value.lower().startswith('sha256:') else value


def _load_captured_framing(root, manifest):
    framing = manifest['framing']
    path = Path(root) / framing['path']
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != _digest(framing['sha256']).lower():
        raise CommandError('captured framing hash mismatch')
    try:
        config = json.loads(payload.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CommandError(f'captured framing is not valid JSON: {error}') from error
    if not isinstance(config, dict) or config.get('schemaVersion') != 1:
        raise CommandError('captured framing must be a schema version 1 config')
    return config


def build_td_baseline(root):
    manifest, errors = read_projection_baseline_manifest(root)
    if errors:
        raise CommandError('invalid projection baseline manifest: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    framing = _load_captured_framing(root, manifest)
    meshes = {}
    baselines = {}
    for side in ('left', 'right'):
        mesh, trusted_manifest, asset = load_trusted_projection_asset(root, side)
        meshes[side] = mesh
        baselines[side] = {
            'assetId': asset['assetId'],
            'sha256': _digest(asset['sha256']).lower(),
            'width': asset.get('width', 1920),
            'height': asset.get('height', 1080),
            'origin': asset.get('origin', 'top-left'),
        }
    config = migrate_projection_config_to_v2(framing, baselines=baselines)
    errors = validate_projection_config_v2(config, trusted_manifest=manifest)
    if errors:
        raise CommandError('TD baseline config is invalid: ' + '; '.join(f'{path} {message}' for path, message in errors.items()))
    for side in ('left', 'right'):
        try:
            evaluate_warp_mesh(meshes[side], config['outputs'][side]['warp'])
        except (ValueError, TypeError, KeyError) as error:
            raise CommandError(f'{side} TD baseline geometry is unsafe: {error}') from error
    return config


class Command(BaseCommand):
    help = 'Install the immutable OTEF TD migration baseline preset.'

    def add_arguments(self, parser):
        parser.add_argument('--table', default='otef')
        parser.add_argument('--asset-root', default=None)

    def handle(self, *args, **options):
        root = Path(options['asset_root']) if options['asset_root'] else projection_baseline_root()
        config = build_td_baseline(root)
        with transaction.atomic():
            try:
                table = Table.objects.select_for_update().get(name=options['table'])
            except Table.DoesNotExist as error:
                raise CommandError(f'table not found: {options["table"]}') from error
            row, created = OTEFProjectionCalibration.objects.select_for_update().get_or_create(
                table=table,
                defaults={'working_config': config},
            )
            presets = list(row.presets or [])
            id_matches = [preset for preset in presets if preset.get('id') == TD_MIGRATION_PRESET_ID]
            name_matches = [preset for preset in presets if preset.get('name') == TD_MIGRATION_PRESET_NAME]
            by_id = id_matches[0] if id_matches else None
            by_name = name_matches[0] if name_matches else None
            expected = {
                'id': TD_MIGRATION_PRESET_ID,
                'name': TD_MIGRATION_PRESET_NAME,
                'config': config,
                'readOnly': True,
            }
            if by_id is not None:
                if len(id_matches) != 1 or len(name_matches) != 1 or by_id != expected or by_name is not by_id:
                    raise CommandError('TD migration baseline ID or name collision; refusing to overwrite')
                self.stdout.write('TD migration baseline already installed; unchanged.')
                return
            if by_name is not None:
                raise CommandError('TD migration baseline name collision; refusing to overwrite')
            if len(presets) >= 50:
                raise CommandError('cannot install TD migration baseline: preset limit is 50')
            presets.append(expected)
            row.presets = presets
            row.save(update_fields=['presets', 'updated_at'])
        self.stdout.write(self.style.SUCCESS('Installed TD migration baseline without changing working selection or revision.'))
