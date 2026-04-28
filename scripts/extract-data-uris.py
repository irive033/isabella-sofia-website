#!/usr/bin/env python3
"""One-off: extract base64 data URIs from a post HTML file, save them as
real image files under images/<post-relative-path>/, and rewrite the
src/url() references in the HTML to point at those files.

Usage:
  python3 scripts/extract-data-uris.py <post-html-path>
Example:
  python3 scripts/extract-data-uris.py posts/style/how-to-build-a-capsule-wardrobe-for-miami.html
"""

import base64
import hashlib
import os
import re
import sys
from pathlib import Path


def mime_to_ext(mime: str) -> str:
    ext = mime.lower()
    if ext == "jpeg":
        return "jpg"
    if ext == "svg+xml":
        return "svg"
    if ext.startswith("x-"):
        ext = ext[2:]
    return ext.split("+", 1)[0]


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/extract-data-uris.py <post-html-path>", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    post_path = (repo_root / sys.argv[1]).resolve()
    if not post_path.is_file():
        print(f"File not found: {post_path}", file=sys.stderr)
        return 1

    post_rel = post_path.relative_to(repo_root)
    image_dir = repo_root / "images" / post_rel.parent / post_rel.stem
    image_dir.mkdir(parents=True, exist_ok=True)

    rel_prefix = os.path.relpath(image_dir, post_path.parent).replace(os.sep, "/")

    html = post_path.read_text(encoding="utf-8")
    size_before = len(html.encode("utf-8"))

    pattern = re.compile(r"data:image/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)")

    seen: dict[str, str] = {}
    counts = {"total": 0, "dedup": 0}

    def replace(match: re.Match) -> str:
        counts["total"] += 1
        mime, b64 = match.group(1), match.group(2)
        if b64 in seen:
            counts["dedup"] += 1
            return f"{rel_prefix}/{seen[b64]}"
        data = base64.b64decode(b64)
        digest = hashlib.sha1(data).hexdigest()[:12]
        filename = f"{digest}.{mime_to_ext(mime)}"
        out_path = image_dir / filename
        if not out_path.exists():
            out_path.write_bytes(data)
        seen[b64] = filename
        return f"{rel_prefix}/{filename}"

    new_html = pattern.sub(replace, html)
    post_path.write_text(new_html, encoding="utf-8")
    size_after = len(new_html.encode("utf-8"))

    def kb(n: int) -> str:
        return f"{n / 1024:.1f} KB"

    print(f"Processed: {post_rel}")
    print(f"  Data URIs found: {counts['total']}")
    print(f"  Unique images: {len(seen)} ({counts['dedup']} duplicates collapsed)")
    print(f"  HTML size: {kb(size_before)} -> {kb(size_after)}")
    print(f"  Images written to: {image_dir.relative_to(repo_root)}/")

    return 0


if __name__ == "__main__":
    sys.exit(main())
