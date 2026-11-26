"""CI-only browser checks with actual saved source data and deterministic network fixtures."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import tempfile
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / 'browser-checks'
    screenshots.mkdir(exist_ok=True)
    receipt = json.loads((ROOT / 'web/data/example.json').read_text())
    postal = json.loads((ROOT / 'tests/fixtures/postal-no-concordance.json').read_text())
    expected = len(receipt['responses']['representatives']['objects'])
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / 'dist', Path(temporary) / 'civiclookup')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={'width': 1280, 'height': 1000})
                errors, requests = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                failing = False
                empty_postal = False
                def route_api(route):
                    if route.request.method == 'OPTIONS':
                        route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'accept'})
                        return
                    requests.append(route.request.url)
                    if failing:
                        route.fulfill(status=503, content_type='application/json', body='{}')
                        return
                    path = urlsplit(route.request.url).path
                    if path == f"/postcodes/{postal['code']}/":
                        payload = {key: value for key, value in postal.items() if not (empty_postal and key.startswith('representatives_'))}
                    else:
                        kind = 'representatives' if path == '/representatives/' else 'boundaries'
                        payload = receipt['responses'][kind]
                    route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(payload))
                page.route('https://represent.opennorth.ca/**', route_api)
                page.goto(f'http://127.0.0.1:{server.server_port}/civiclookup/')
                page.wait_for_function("document.querySelectorAll('.rep-card').length > 0")
                assert page.locator('.rep-card').count() == expected
                assert not requests, 'Opening saved example must not send location to provider'
                assert 'SAVED PUBLIC EXAMPLE' in page.locator('#receipt-kind').inner_text()
                assert page.locator('#postal-code').is_visible() and page.locator('#postal-code').input_value() == ''
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.locator('#postal-code').bounding_box()['y'] < 650
                page.locator('#preview-example').click()
                assert page.locator('#results-heading').evaluate("node => node === document.activeElement")
                assert not requests
                page.set_viewport_size({'width': 1280, 'height': 1000})
                page.screenshot(path=str(screenshots / 'desktop.png'), full_page=True)
                page.locator('#filter').fill('no-matching-name-xyz')
                assert page.locator('.rep-card').count() == 0
                page.locator('#filter').fill('')
                page.locator('input[name="mode"][value="coordinates"]').check()
                page.locator('#latitude').fill('49.2827')
                page.locator('#longitude').fill('-123.1207')
                page.locator('#search-button').click()
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Lookup complete.') && document.querySelector('#results-heading').textContent === '49.2827, -123.1207'")
                assert 'LIVE LOOKUP' in page.locator('#receipt-kind').inner_text()
                assert len(requests) == 2, requests
                assert '49.2827' in requests[0] and '-123.1207' in requests[0]
                assert '49.2827, -123.1207' == page.locator('#results-heading').inner_text()
                assert page.locator('.rep-card').count() == expected
                with page.expect_download() as download_info:
                    page.locator('#export-json').click()
                downloaded = Path(temporary) / 'receipt.json'
                download_info.value.save_as(downloaded)
                exported = json.loads(downloaded.read_text())
                assert exported['query']['latitude'] == 49.2827
                page.locator('#import-receipt').set_input_files(downloaded)
                page.wait_for_function("document.querySelector('#receipt-kind').textContent.includes('IMPORTED')")
                with page.expect_download() as download_info:
                    page.locator('#export-csv').click()
                csv_path = Path(temporary) / 'receipt.csv'
                download_info.value.save_as(csv_path)
                assert 'Retrieved UTC' in csv_path.read_text()
                failing = True
                page.locator('#search-button').click()
                page.wait_for_function("document.querySelector('#status').textContent.includes('previous capture is unchanged')")
                assert page.locator('.rep-card').count() == expected
                failing = False
                page.locator('input[name="mode"][value="postal"]').check()
                page.locator('#postal-code').fill('l5g 4l3')
                page.locator('#search-button').click()
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Lookup complete.') && document.querySelector('#results-heading').textContent === 'L5G 4L3'")
                assert page.locator('.rep-card').count() > 0
                assert postal['representatives_centroid'][0]['name'] in page.locator('#representatives').inner_text()
                assert 'MISSISSAUGA, ON' in page.locator('#capture-summary').inner_text()
                assert requests[-1].endswith('/postcodes/L5G4L3/')
                with page.expect_download() as download_info:
                    page.locator('#export-json').click()
                postal_path = Path(temporary) / 'postal-receipt.json'
                download_info.value.save_as(postal_path)
                assert json.loads(postal_path.read_text())['responses']['postal'] == postal
                empty_postal = True
                page.locator('#search-button').click()
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Lookup complete. 0')")
                assert page.locator('.rep-card').count() == 0
                assert page.locator('.boundary-row').count() > 0
                assert page.locator('#empty-results').is_visible()
                page.locator('#load-example').click()
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.screenshot(path=str(screenshots / 'mobile.png'), full_page=True)
                assert not errors, errors
                browser.close()
            print('Browser checks passed: saved data, custom coordinates and real postal shape, missing representative groups, raw export, filter, import, error retention and mobile layout')
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
