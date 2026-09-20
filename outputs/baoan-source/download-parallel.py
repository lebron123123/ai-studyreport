import concurrent.futures as futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'guangdong-260912.osm.pbf'
URL = 'https://download.geofabrik.de/asia/china/guangdong-260912.osm.pbf'
TOTAL = 172311064
WORK = ROOT / 'parallel-parts'

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'md5').hexdigest()

def main():
    WORK.mkdir(exist_ok=True)
    manifest = WORK / 'plan.json'
    if manifest.exists():
        plan = json.loads(manifest.read_text())
    else:
        prefix = SOURCE.stat().st_size
        plan = {'prefix': prefix, 'hash': digest(SOURCE)}
        manifest.write_text(json.dumps(plan))
    prefix = plan['prefix']
    if SOURCE.stat().st_size != prefix or digest(SOURCE) != plan['hash']:
        raise RuntimeError('Original file changed. Stopping to protect downloaded data.')
    if prefix >= TOTAL:
        raise RuntimeError('Source already at expected size; verify it separately.')
    width = (TOTAL-prefix+3)//4

    def download(i):
        start = prefix+i*width
        end = min(TOTAL-1, start+width-1)
        part = WORK / f'{i}.part'
        done = WORK / f'{i}.done'
        if done.exists() and part.exists() and part.stat().st_size == end-start+1:
            return part
        headers = WORK / f'{i}.headers'
        result = subprocess.run(['curl.exe', '-L', '--fail', '--silent', '--show-error',
            '--connect-timeout', '30', '--max-time', '14400', '--range', f'{start}-{end}',
            '-D', str(headers), '-o', str(part), URL])
        expected = f'content-range: bytes {start}-{end}/{TOTAL}'
        if result.returncode or not part.exists() or part.stat().st_size != end-start+1 or expected not in headers.read_text().lower():
            raise RuntimeError(f'Connection {i+1} incomplete. Original download remains safe.')
        done.touch()
        return part

    print('4-CONNECTION DOWNLOAD | original downloaded bytes preserved', flush=True)
    print('Keep this window open. Final checksum verification is automatic.', flush=True)
    def progress_bytes():
        return prefix+sum(p.stat().st_size for p in WORK.glob('*.part'))
    started = time.monotonic()
    previous = progress_bytes()
    last = started
    with futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(download, i) for i in range(4)]
        while not all(j.done() for j in jobs):
            time.sleep(5)
            current = progress_bytes()
            now = time.monotonic()
            speed = max(0, current-previous)/(now-last)
            eta = f'{(TOTAL-current)/speed/60:.1f} min' if speed else '--'
            print(f'{current/TOTAL:6.1%} | {current/1048576:.2f}/164.33 MiB | {speed/1024:.1f} KiB/s | remaining {eta}', flush=True)
            previous, last = current, now
        parts = [j.result() for j in jobs]
    checksum = ROOT / 'guangdong-260912.osm.pbf.md5'
    subprocess.run(['curl.exe', '-L', '--fail', '--silent', '--show-error', '--max-time', '60', '-o', str(checksum), URL+'.md5'], check=True)
    expected = checksum.read_text().split()[0].lower()
    merged = WORK / 'verified-complete.pbf'
    print('Download complete. Combining and verifying official MD5...', flush=True)
    if digest(SOURCE) != plan['hash']:
        raise RuntimeError('Original changed; merge cancelled.')
    with merged.open('wb') as out:
        for item in [SOURCE]+parts:
            with item.open('rb') as src:
                shutil.copyfileobj(src, out)
    if merged.stat().st_size != TOTAL or digest(merged) != expected:
        raise RuntimeError('Checksum failed. Original preserved; do not use merged file.')
    backup = WORK / 'original-prefix.backup'
    if backup.exists():
        raise RuntimeError('Backup already exists; manual review required.')
    os.rename(SOURCE, backup)
    os.rename(merged, SOURCE)
    print('SUCCESS: 100%, official checksum matched. Ready for Baoan extraction.', flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'STOPPED: {error}', flush=True)
        raise
