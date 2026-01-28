
import os
import subprocess
import logging
from pathlib import Path
from typing import Optional, List
import sys
import shutil

logger = logging.getLogger(__name__)

TIPPECANOE_IMAGE = "ingmapping/tippecanoe"
PMTILES_IMAGE = "protomaps/go-pmtiles"

def to_docker_path(path: Path) -> str:
    """Convert path to Docker-compatible format (for Windows/WSL)."""
    if sys.platform == "win32":
        abs_path = str(path.resolve()).replace('\\', '/')
        if ':' in abs_path:
            drive, rest = abs_path.split(':', 1)
            return f"/{drive.lower()}{rest}"
        return abs_path
    return str(path.resolve())

def run_tippecanoe(input_file: Path, output_mbtiles: Path, extra_args: List[str] = None) -> bool:
    """Run tippecanoe via Docker (One-Pass, Unicode-Safe)."""
    # CRITICAL: Unicode filenames fail in some Docker mounts.
    # Use a generic ASCII symlink or copy for the duration of the run.
    safe_input_name = "_docker_input.geojson"
    safe_output_name = "_docker_output.mbtiles"

    import uuid
    # Use UUID to prevent collisions if multiple layers have the same name (e.g. from different packs)
    temp_dir = input_file.parent / f"_tmp_tile_{uuid.uuid4().hex}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Copy file to a safe ASCII name in a temp subfolder
        shutil.copy2(input_file, temp_dir / safe_input_name)

        docker_cmd = [
            "docker", "run", "--rm",
            "-v", f"{to_docker_path(temp_dir)}:/work",
            TIPPECANOE_IMAGE,
            "tippecanoe",
            "-o", f"/work/{safe_output_name}",
            f"/work/{safe_input_name}",
            "--layer=layer",
            "--force",
            "--minimum-zoom=9",
            "--maximum-zoom=18",
            "--no-feature-limit",
            "--no-tile-size-limit",
            "--detect-shared-borders",
            "--drop-densest-as-needed",
            "--quiet"
        ]

        if extra_args:
            docker_cmd.extend(extra_args)

        result = subprocess.run(docker_cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')

        success = (temp_dir / safe_output_name).exists()

        if result.returncode != 0 or not success:
            logger.error(f"Tippecanoe failed for {input_file.name} (Exit code {result.returncode})")
            logger.error(f"STDOUT: {result.stdout}")
            logger.error(f"STDERR: {result.stderr}")
            if success: # File exists but error code was non-zero?
                 logger.warning("Output file exists despite non-zero exit code.")
            else:
                 return False

        if success:
            if output_mbtiles.exists(): output_mbtiles.unlink()
            shutil.move(temp_dir / safe_output_name, output_mbtiles)

        return success
    except Exception as e:
        logger.error(f"Tippecanoe exception for {input_file.name}: {e}")
        return False
    finally:
        if temp_dir.exists(): shutil.rmtree(temp_dir)

def convert_mbtiles_to_pmtiles(mbtiles_path: Path, pmtiles_path: Path) -> bool:
    """Convert MBTiles to PMTiles using the high-performance Go engine (Unicode-Safe)."""
    try:
        if not mbtiles_path.exists():
            return False

        size_mb = mbtiles_path.stat().st_size / (1024 * 1024)

        # Threshold: > 2MB MBTiles gets the Go Engine
        if size_mb < 2:
            from pmtiles.convert import mbtiles_to_pmtiles
            if pmtiles_path.exists(): pmtiles_path.unlink()
            mbtiles_to_pmtiles(str(mbtiles_path), str(pmtiles_path), maxzoom=18)
            return pmtiles_path.exists()

        # GO GO GO for big ones, using safe ASCII names
        import uuid
        temp_dir = mbtiles_path.parent / f"_tmp_pmtiles_{uuid.uuid4().hex}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        safe_in = "_in.mbtiles"
        safe_out = "_out.pmtiles"

        try:
            shutil.copy2(mbtiles_path, temp_dir / safe_in)

            docker_cmd = [
                "docker", "run", "--rm",
                "-v", f"{to_docker_path(temp_dir)}:/work",
                PMTILES_IMAGE,
                "convert",
                f"/work/{safe_in}",
                f"/work/{safe_out}"
            ]

            result = subprocess.run(docker_cmd, capture_output=True, text=True)

            success = (temp_dir / safe_out).exists()
            if result.returncode != 0 or not success:
                logger.error(f"PMTiles docker conversion failed (Exit code {result.returncode})")
                logger.error(f"STDOUT: {result.stdout}")
                logger.error(f"STDERR: {result.stderr}")
                if not success:
                    return False

            if success:
                if pmtiles_path.exists(): pmtiles_path.unlink()
                shutil.move(temp_dir / safe_out, pmtiles_path)
                return True
            return False
        finally:
            if temp_dir.exists(): shutil.rmtree(temp_dir)

    except Exception as e:
        logger.error(f"PMTiles conversion failed: {e}")
        return False

def generate_pmtiles_smart(input_geojson: Path, output_pmtiles: Path, high_fidelity: bool = False) -> bool:
    """Direct, optimized tiling with Unicode-safety."""
    try:
        # HIGH-FIDELITY: Disable simplification only if requested
        extra_args = ["--no-line-simplification"] if high_fidelity else ["--simplification=2"]

        temp_mb = output_pmtiles.with_suffix(".mbtiles")
        if run_tippecanoe(input_geojson, temp_mb, extra_args):
            success = convert_mbtiles_to_pmtiles(temp_mb, output_pmtiles)
            if temp_mb.exists(): temp_mb.unlink()
            return success

        return False
    except Exception as e:
        logger.error(f"Tiling failed: {e}")
        return False
