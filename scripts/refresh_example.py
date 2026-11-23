#!/usr/bin/env python3
"""Refresh one public-place opening receipt; atomically preserve a last-good capture."""
import json
from datetime import datetime, timezone
from pathlib import Path
import time
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen
from build import ROOT

BASE = 'https://represent.opennorth.ca'


def endpoints(query, page_size):
    if query['mode'] == 'postal':
        import re
        code = re.sub(r'\s', '', query['postalCode']).upper()
        if not re.fullmatch(r'[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d', code):
            raise ValueError('Invalid default postal code')
        return {'postal': f'{BASE}/postcodes/{code}/'}
    if query['mode'] != 'coordinates':
        raise ValueError('Unknown query mode')
    lat, lon = float(query['latitude']), float(query['longitude'])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('Invalid coordinates')
    point = f'{lat},{lon}'
    return {kind: f'{BASE}/{kind}/?' + urlencode({parameter: point, 'limit': page_size})
            for kind, parameter in [('representatives', 'point'), ('boundaries', 'contains')]}


def fetch(url):
    request = Request(url, headers={'User-Agent': 'CoolCode Civic Lookup (+https://coolcode.ca/civiclookup/)', 'Accept': 'application/json'})
    with urlopen(request, timeout=30) as response:
        if 'json' not in response.headers.get('Content-Type', ''):
            raise ValueError('Provider returned non-JSON; example unchanged')
        return json.load(response)


def collect(config, request=fetch, pause=time.sleep):
    if config['apiBase'] != BASE:
        raise ValueError('Use official Represent API')
    query = config['defaultQuery']
    responses, sources = {}, []
    for kind, initial in endpoints(query, config['pageSize']).items():
        url, objects, total, pages = initial, [], 0, 0
        while url and pages < config['maxPages']:
            if sources:
                pause(config['requestGapMs'] / 1000)
            raw = request(url)
            sources.append(url)
            pages += 1
            if kind == 'postal':
                for field in ['representatives_centroid', 'representatives_concordance', 'boundaries_centroid', 'boundaries_concordance']:
                    if not isinstance(raw.get(field), list):
                        raise ValueError('Unrecognized postal response')
                responses[kind], url = raw, None
                break
            if not isinstance(raw.get('objects'), list) or not isinstance(raw.get('meta'), dict):
                raise ValueError('Unrecognized coordinate response')
            objects.extend(raw['objects'])
            total = raw['meta'].get('total_count')
            nxt = raw['meta'].get('next')
            url = urljoin(BASE, nxt) if nxt else None
            if url and (urlsplit(url).scheme != 'https' or urlsplit(url).netloc != 'represent.opennorth.ca' or urlsplit(url).path != f'/{kind}/'):
                raise ValueError('Unexpected pagination source')
        if url:
            raise ValueError('Example exceeded configured page limit; previous receipt unchanged')
        if kind != 'postal':
            responses[kind] = {'objects': objects, 'meta': {'total_count': total, 'pages': pages, 'next': None}}
    return {'schemaVersion': 1, 'provider': 'Represent by Open North',
            'capturedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'query': query, 'responses': responses, 'sourceURLs': sources, 'complete': True}


def main():
    config = json.loads((ROOT / 'web/config.json').read_text())
    receipt = collect(config)
    output = ROOT / 'web' / config['examplePath']
    if output.resolve().parent != (ROOT / 'web/data').resolve():
        raise ValueError('Example must be in web/data/')
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(output)
    print(f'Refreshed {output.relative_to(ROOT)} from {len(receipt["sourceURLs"])} official API responses')


if __name__ == '__main__':
    main()
