import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_example import collect, endpoints
ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'web/config.json').read_text())


class CollectorTests(unittest.TestCase):
    def test_new_coordinates_are_not_restricted_to_presets(self):
        urls = endpoints({'mode': 'coordinates', 'latitude': 49.2827, 'longitude': -123.1207}, 100)
        self.assertIn('49.2827%2C-123.1207', urls['representatives'])
        self.assertIn('contains=', urls['boundaries'])

    def test_collects_each_required_endpoint_with_source_receipt(self):
        urls = []
        def request(url):
            urls.append(url)
            return {'objects': [], 'meta': {'total_count': 0, 'next': None}}
        result = collect(CONFIG, request, lambda _: None)
        self.assertEqual(len(urls), 2)
        self.assertEqual(result['sourceURLs'], urls)
        self.assertTrue(result['complete'])
        self.assertTrue(result['capturedAt'].endswith('Z'))

    def test_rejects_a_partial_example(self):
        config = dict(CONFIG, maxPages=1)
        def request(url):
            return {'objects': [], 'meta': {'total_count': 1000, 'next': '/representatives/?offset=100'}}
        with self.assertRaisesRegex(ValueError, 'page limit'):
            collect(config, request, lambda _: None)

    def test_rejects_hostile_pagination_or_malformed_responses(self):
        def request(url):
            return {'objects': [], 'meta': {'total_count': 1, 'next': 'https://example.com/private'}}
        with self.assertRaisesRegex(ValueError, 'pagination'):
            collect(CONFIG, request, lambda _: None)
        with self.assertRaisesRegex(ValueError, 'Unrecognized'):
            collect(CONFIG, lambda _: {}, lambda _: None)


if __name__ == '__main__':
    unittest.main()
