import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deployment', Path(__file__).resolve().parents[1] / 'scripts/cloudflare-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class FakeAPI:
    account = 'a' * 32
    def __init__(self, has_key=True, rows=0):
        self.has_key, self.rows, self.calls = has_key, rows, []
    def call(self, path, method='GET', body=None, missing_ok=False):
        self.calls.append((path, method))
        if path.endswith('/secrets'):
            return [{'name': 'MODEL_CONFIG_KEY'}] if self.has_key else []
        if path.endswith('/query'):
            return [{'results': [{'n': self.rows}] if 'COUNT' in body['sql'] else [{'name': 'model_profiles'}]}]
        if path == '/workers/subdomain':
            return {'subdomain': 'test'}
        raise AssertionError(path)

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        output = patch("sys.stdout", new_callable=io.StringIO)
        output.start()
        self.addCleanup(output.stop)
    def fixture(self, folder, **changes):
        config = {'name':'sensebook-personal', 'account_id':'a'*32, 'vars':{'OWNER_EMAIL':'test@example.com','ACCESS_TEAM_DOMAIN':'test.cloudflareaccess.com','ACCESS_AUD':'b'*64}, 'd1_databases':[{'database_id':'test-db'}]}
        config.update(changes)
        path = Path(folder)/'wrangler.production.json'
        path.write_text(json.dumps(config))
        return path
    def test_existing_secret_not_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            config = self.fixture(folder)
            with patch.object(deploy,'ROOT',Path(folder)), patch.object(deploy,'CONFIG',config), patch.object(deploy,'wrangler') as run:
                deploy.publish(FakeAPI())
                self.assertEqual(run.call_count,2)
                self.assertFalse((Path(folder)/'.cloudflare/model-config-key').exists())
    def test_encrypted_rows_without_secret_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            config = self.fixture(folder)
            with patch.object(deploy,'ROOT',Path(folder)), patch.object(deploy,'CONFIG',config), patch.object(deploy,'wrangler') as run:
                with self.assertRaises(deploy.DeployError): deploy.publish(FakeAPI(False,1))
                run.assert_not_called()
    def test_first_secret_is_reused_from_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            config = self.fixture(folder)
            with patch.object(deploy,'ROOT',Path(folder)), patch.object(deploy,'CONFIG',config), patch.object(deploy,'wrangler') as run:
                deploy.publish(FakeAPI(False))
                first = (Path(folder)/'.cloudflare/model-config-key').read_text()
                deploy.publish(FakeAPI(False))
                self.assertEqual(first,(Path(folder)/'.cloudflare/model-config-key').read_text())
                self.assertEqual(run.call_args.kwargs['secret'],first)
                self.assertEqual((Path(folder)/'.cloudflare/model-config-key').stat().st_mode & 0o777,0o600)
    def test_development_auth_cannot_publish(self):
        with tempfile.TemporaryDirectory() as folder:
            config = self.fixture(folder,vars={'DEV_AUTH':'true'})
            with patch.object(deploy,'CONFIG',config), patch.object(deploy,'wrangler') as run:
                with self.assertRaises(deploy.DeployError): deploy.publish(FakeAPI())
                run.assert_not_called()
    def test_missing_owner_cannot_prepare(self):
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaises(deploy.DeployError): deploy.identity_settings()

if __name__ == '__main__': unittest.main()
