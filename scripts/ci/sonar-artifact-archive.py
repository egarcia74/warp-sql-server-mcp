#!/usr/bin/env python3
"""Download only a preflight-validated GitHub artifact; inspect before extraction.

No PR-provided URLs, dependencies, or extraction utilities are used. All archive
bytes and every decompressed entry are checked before any output file is opened.
"""

import argparse
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

MAX_BYTES = 10 * 1024 * 1024
NAMES = {"manifest.json", "lcov.info"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_bounded(stream):
    """Read at most the cap plus one sentinel byte, regardless of HTTP headers."""
    chunks = []
    total = 0
    while True:
        chunk = stream.read(min(65536, MAX_BYTES + 1 - total))
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        require(total <= MAX_BYTES, "Raw artifact exceeds 10 MiB limit")
        chunks.append(chunk)


def validate_digest(digest):
    require(isinstance(digest, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", digest),
            "Missing or malformed API SHA-256 digest")


def inspect_payload(raw, info, remaining):
    """Bound actual DEFLATE output, not just the ZIP central directory's claim.

    ZipExtFile limits reads to file_size, so using it alone would not detect a
    lying file_size that hides additional decompressed bytes. Read the compressed
    stream ourselves, checking the local header, stream termination and CRC.
    """
    offset = info.header_offset
    require(0 <= offset <= len(raw) - 30, "Invalid ZIP entry offset")
    header = struct.unpack_from("<4s5H3I2H", raw, offset)
    signature, _, flags, compression, _, _, _, _, _, name_size, extra_size = header
    require(signature == b"PK\x03\x04" and flags == info.flag_bits and
            compression == info.compress_type, "ZIP local header mismatch")
    start = offset + 30 + name_size + extra_size
    require(start <= len(raw) and start + info.compress_size <= len(raw), "Truncated ZIP entry")
    local_name = raw[offset + 30:offset + 30 + name_size]
    require(local_name == info.filename.encode("ascii"), "ZIP local filename mismatch")
    payload = raw[start:start + info.compress_size]
    if compression == zipfile.ZIP_STORED:
        require(len(payload) <= remaining, "Actual uncompressed artifact exceeds 10 MiB")
        data = payload
    elif compression == zipfile.ZIP_DEFLATED:
        inflater = zlib.decompressobj(-15)
        data = inflater.decompress(payload, remaining + 1)
        require(len(data) <= remaining and not inflater.unconsumed_tail,
                "Actual uncompressed artifact exceeds 10 MiB")
        require(inflater.eof and not inflater.unused_data, "Invalid ZIP compressed stream")
    else:
        raise ValueError("Unsupported ZIP compression")
    require(len(data) == info.file_size, "ZIP actual/declared size mismatch")
    require(zlib.crc32(data) & 0xFFFFFFFF == info.CRC, "ZIP CRC mismatch")
    return data


def extract_archive(raw, digest, output):
    validate_digest(digest)
    require(len(raw) <= MAX_BYTES, "Raw artifact exceeds 10 MiB limit")
    require(hmac.compare_digest(hashlib.sha256(raw).hexdigest(), digest[7:]),
            "Artifact API digest mismatch")
    output = Path(output)
    require(not output.is_symlink() and output.is_dir() and not any(output.iterdir()),
            "Output must be an empty dedicated directory")
    contents = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(len(entries) == 2, "Artifact must have exactly two entries")
        declared = 0
        for info in entries:
            require(info.orig_filename == info.filename and info.filename in NAMES and
                    info.filename not in contents, "Unsafe or duplicate ZIP entry name")
            mode = info.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG) and not info.is_dir() and
                    not (info.external_attr & 0x10), "ZIP entry must be a regular file")
            require(not (info.flag_bits & 1), "Encrypted ZIP entries are forbidden")
            require(0 < info.file_size <= MAX_BYTES, "Invalid or oversized ZIP entry")
            declared += info.file_size
            require(declared <= MAX_BYTES, "Declared uncompressed artifact exceeds 10 MiB")
            contents[info.filename] = None
        total = 0
        for info in entries:
            data = inspect_payload(raw, info, MAX_BYTES - total)
            total += len(data)
            contents[info.filename] = data
    # No extraction API: names are exact literals and all bytes passed inspection.
    # O_EXCL/NOFOLLOW and a held directory fd protect against replacement at write.
    directory = os.open(output, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(not os.listdir(directory), "Output directory became nonempty")
        for name, data in contents.items():
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
            with os.fdopen(fd, "wb") as destination:
                destination.write(data)
    finally:
        os.close(directory)
    return [{"name": name, "type": "file", "size": len(data)} for name, data in contents.items()]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_artifact(repository, artifact_id, digest, output, token):
    validate_digest(digest)
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) is not None,
            "Invalid repository")
    require(isinstance(artifact_id, int) and 0 < artifact_id <= 9007199254740991,
            "Invalid artifact ID")
    require(bool(token) and not any(ord(char) < 33 or ord(char) > 126 for char in token),
            "Missing or invalid GitHub token")
    # Only this constant API origin receives the token. Follow its authenticated
    # redirect separately, without Authorization; never accept an input URL.
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/actions/artifacts/{artifact_id}/zip",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"})
    try:
        response = opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        require(error.code == 302, "GitHub artifact download request failed")
        location = error.headers.get("Location", "")
        error.close()
    else:
        response.close()
        raise ValueError("GitHub artifact endpoint did not return its expected redirect")
    parsed = urllib.parse.urlsplit(location)
    require(parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and
            not parsed.password and parsed.port in (None, 443) and
            not any(ord(char) < 33 or ord(char) > 126 for char in location),
            "Invalid authenticated artifact redirect")
    # No subsequent redirects: avoid forwarding even signed URLs to other hosts.
    with opener.open(urllib.request.Request(location), timeout=30) as response:
        require(response.status == 200, "Artifact storage download failed")
        raw = read_bounded(response)
    return extract_archive(raw, digest, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--artifact-id", type=int, required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        entries = download_artifact(args.repository, args.artifact_id, args.digest,
                                    args.output, os.environ.get("GH_TOKEN", ""))
        print(json.dumps(entries))
    except Exception:
        # Do not expose tokens, signed URLs, or untrusted entry text in Actions logs.
        print("sonar-artifact-archive: artifact download or validation failed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
