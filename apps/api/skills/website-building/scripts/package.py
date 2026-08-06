from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path('/workspace/work').resolve()
dist = (root / 'dist').resolve()
output = Path('/workspace/output').resolve()
output.mkdir(parents=True, exist_ok=True)

excluded_dirs = {'.git', '.next', '.turbo', '.vite', 'coverage', 'dist', 'node_modules'}
excluded_names = {'.DS_Store'}


def safe_files(base: Path, exclude_build: bool):
    for path in sorted(base.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(base)
        if any(part in excluded_dirs for part in relative.parts):
            continue
        if path.name in excluded_names or path.name == '.env' or path.name.startswith('.env.'):
            continue
        if exclude_build and relative.parts and relative.parts[0] == 'dist':
            continue
        yield path, relative


with ZipFile(output / 'source.zip', 'w', ZIP_DEFLATED) as archive:
    for path, relative in safe_files(root, True):
        archive.write(path, relative.as_posix())

with ZipFile(output / 'dist.zip', 'w', ZIP_DEFLATED) as archive:
    for path, relative in safe_files(dist, False):
        archive.write(path, relative.as_posix())
