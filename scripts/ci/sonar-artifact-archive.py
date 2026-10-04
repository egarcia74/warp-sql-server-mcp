#!/usr/bin/env python3
"""Download and extract one provenance-checked GitHub LCOV artifact as bounded data."""

import hashlib
import hmac
import io
import os
import re
import stat
import sys
import urllib.parse
import urllib.request
import zipfile

MAX_BYTES = 10 * 1024 * 1024
EXPECTED_FILES = frozenset(("manifest.json", "lcov.info"))


def validate_digest(value):
    if re.fullmatch(r"[a-fA-F0-9]{64}", value) is None:
        raise ValueError("invalid archive digest")
    return value.lower()


def bounded_read(stream):
    data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("archive exceeds raw size limit")
    return data


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        parsed = urllib.parse.urlparse(new_url)
        host = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or not host.endswith((".githubusercontent.com", ".blob.core.windows.net"))
        ):
            raise ValueError("unsafe artifact redirect")
        # GitHub's bearer token must never follow a redirect to blob storage.
        return urllib.request.Request(new_url, method="GET")


def download_artifact(artifact_id):
    if re.fullmatch(r"[1-9]\d*", artifact_id, flags=re.ASCII) is None:
        raise ValueError("invalid artifact ID")
    repository = "egarcia74/warp-sql-server-mcp"
    if os.environ.get("GITHUB_REPOSITORY") != repository:
        raise ValueError("invalid repository identity")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise ValueError("missing artifact read token")
    url = f"https://api.github.com/repos/{repository}/actions/artifacts/{artifact_id}/zip"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    opener = urllib.request.build_opener(SafeRedirect)
    with opener.open(request, timeout=30) as response:
        return bounded_read(response)


def read_verified_entries(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if len(infos) != 2 or {info.filename for info in infos} != EXPECTED_FILES:
            raise ValueError("unexpected archive entries")
        total_size = 0
        files = {}
        for info in infos:
            if info.is_dir() or info.flag_bits & 0x1:
                raise ValueError("unsafe archive entry")
            mode = info.external_attr >> 16 if info.create_system == 3 else 0
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise ValueError("non-regular archive entry")
            if info.file_size < 0 or info.file_size > MAX_BYTES:
                raise ValueError("archive entry exceeds size limit")
            total_size += info.file_size
            if total_size > MAX_BYTES:
                raise ValueError("archive exceeds uncompressed size limit")
            with archive.open(info) as source:
                data = bounded_read(source)
            if len(data) != info.file_size:
                raise ValueError("archive entry length mismatch")
            files[info.filename] = data
    return files


def extract_archive(raw, expected_digest, destination):
    actual_digest = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(actual_digest, validate_digest(expected_digest)):
        raise ValueError("archive digest mismatch")
    files = read_verified_entries(raw)
    # Create the destination only after every entry has passed validation.
    os.mkdir(destination, mode=0o700)
    for name in sorted(files):
        path = os.path.join(destination, name)
        with open(path, "xb") as target:
            target.write(files[name])


def main(argv):
    if len(argv) != 4 or argv[1] != "download":
        raise ValueError("usage: archive.py download ARTIFACT_ID SHA256")
    _, _, artifact_id, expected_digest = argv
    runner_temp = os.environ.get("RUNNER_TEMP")
    if not runner_temp or not os.path.isabs(runner_temp) or not os.path.isdir(runner_temp):
        raise ValueError("invalid trusted runner temporary directory")
    destination = os.path.join(runner_temp, "sonar-artifact")
    raw = download_artifact(artifact_id)
    extract_archive(raw, expected_digest, destination)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (OSError, ValueError, zipfile.BadZipFile, urllib.error.URLError) as error:
        print(f"Sonar artifact rejected: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
