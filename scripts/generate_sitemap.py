#!/usr/bin/env python3
"""Generate sitemap.xml from data.json owned victor42.work URLs."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
SITEMAP_PATH = ROOT / "sitemap.xml"

SITE_ORIGIN = "https://victor42.work"
SITE_HOST = "victor42.work"


def normalize_loc(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"invalid product url: {url!r}")
    path = parsed.path if parsed.path else "/"
    if not path.endswith("/"):
        path += "/"
    return f"https://{parsed.hostname.lower()}{path}"


def is_owned_product_host(hostname: str) -> bool:
    host = hostname.lower()
    # cloud.* is the R2 file bucket (share/*.pptx etc.), not a product site.
    if host == f"cloud.{SITE_HOST}":
        return False
    return host.endswith(f".{SITE_HOST}") and host != SITE_HOST


def collect_product_locs(products: list[dict]) -> list[str]:
    locs: list[str] = []
    seen: set[str] = set()
    for product in products:
        url = product.get("url")
        if not isinstance(url, str) or not url.strip():
            continue
        hostname = urlparse(url).hostname
        if not hostname or not is_owned_product_host(hostname):
            continue
        loc = normalize_loc(url)
        if loc in seen:
            continue
        seen.add(loc)
        locs.append(loc)
    return locs


def render_url(loc: str, lastmod: str, priority: str) -> str:
    return "\n".join(
        [
            "  <url>",
            f"    <loc>{escape(loc)}</loc>",
            f"    <lastmod>{lastmod}</lastmod>",
            "    <changefreq>monthly</changefreq>",
            f"    <priority>{priority}</priority>",
            "  </url>",
        ]
    )


def build_sitemap(product_locs: list[str], lastmod: str) -> str:
    entries = [render_url(f"{SITE_ORIGIN}/", lastmod, "1.0")]
    entries.extend(render_url(loc, lastmod, "0.8") for loc in product_locs)
    body = "\n".join(entries)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    products = data.get("products")
    if not isinstance(products, list):
        raise SystemExit("data.json: missing products array")

    product_locs = collect_product_locs(products)
    lastmod = date.today().isoformat()
    sitemap = build_sitemap(product_locs, lastmod)
    SITEMAP_PATH.write_text(sitemap, encoding="utf-8")

    print(f"wrote {SITEMAP_PATH.relative_to(ROOT)} ({1 + len(product_locs)} urls, lastmod={lastmod})")
    for loc in [f"{SITE_ORIGIN}/", *product_locs]:
        print(f"  {loc}")


if __name__ == "__main__":
    main()
