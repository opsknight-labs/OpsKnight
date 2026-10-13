"""Isolated NGINX admission test; no application/database or outbound delivery involved."""
import concurrent.futures
import datetime
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

root = pathlib.Path(__file__).resolve().parents[1]
image = 'nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94'
name = 'sso-edge-cert-' + uuid.uuid4().hex[:10]


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


with tempfile.TemporaryDirectory(prefix='sso-edge-') as directory:
    config = (root / 'deploy/nginx/emergency-rate-limit.conf').read_text()
    # The upstream fixture is deliberately separate so limit_req executes before proxying.
    config = config.replace('http://opsknight:3000', 'http://127.0.0.1:8081')
    config += '\nserver { listen 8081; location / { return 204; } }\n'
    path = pathlib.Path(directory) / 'default.conf'
    path.write_text(config)
    try:
        docker('run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8080',
               '-v', f'{path}:/etc/nginx/conf.d/default.conf:ro', image)
        port = docker('port', name, '8080/tcp').split(':')[-1]
        base = f'http://127.0.0.1:{port}'

        def request(path):
            try:
                with urllib.request.urlopen(base + path, timeout=5) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code

        for attempt in range(50):
            try:
                if request('/health') == 204:
                    break
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError('NGINX fixture did not become ready within 50 attempts')
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=30) as pool:
            results = list(pool.map(request, ['/api/auth/emergency'] * 1000))
        elapsed = time.monotonic() - started
        accepted = results.count(204)
        rejected = results.count(429)
        assert accepted + rejected == 1000, results
        assert rejected > 0 and accepted <= 12 + 2 * elapsed, (accepted, rejected, elapsed)
        assert request('/login') == 204
        # Refill admits a subsequent request; an anonymous burst causes no permanent lockout.
        time.sleep(1)
        assert request('/api/auth/emergency') == 204
        report = {
            'measuredAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'scope': 'One local NGINX instance with a 204 fixture upstream, no app or database.',
            'imageId': docker('inspect', name, '--format', '{{.Image}}'),
            'requests': 1000, 'concurrency': 30, 'acceptedByEdge': accepted,
            'rejectedBeforeUpstream': rejected, 'durationSeconds': elapsed,
            'ordinaryLoginUnaffected': True, 'admissionResumesAfterRefill': True,
        }
        target = root / 'plans/certification/enterprise-sso-2.1-edge.json'
        target.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, check=False)
