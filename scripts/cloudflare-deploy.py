#!/usr/bin/env python3
"""个人站点部署：只输出状态，不输出凭据；生产配置与加密密钥不入库。"""
import argparse
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'wrangler.production.json'

class DeployError(Exception):
    pass

class API:
    def __init__(self):
        self.account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
        self.token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
        if not re.fullmatch(r'[a-f0-9]{32}', self.account) or not self.token:
            raise DeployError('请在本机设置 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN，不要发到聊天或提交到 Git。')

    def call(self, path, method='GET', body=None, missing_ok=False):
        req = urllib.request.Request(
            'https://api.cloudflare.com/client/v4/accounts/' + self.account + path,
            method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                value = json.load(response)
        except urllib.error.HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            value = json.load(error)
            details = '; '.join(str(e.get('message', '')) for e in value.get('errors', []))
            raise DeployError(f'{path}: HTTP {error.code} {details}') from None
        except (urllib.error.URLError, TimeoutError):
            raise DeployError(f'{path}: 网络连接失败或超时') from None
        if not value.get('success'):
            raise DeployError(f'{path}: Cloudflare 未确认请求成功')
        return value.get('result')


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(value)
    path.chmod(0o600)


def doctor(api):
    checks = [('Workers 子域', '/workers/subdomain'), ('D1 数据库', '/d1/database'),
              ('Access 应用', '/access/apps'), ('Access 团队', '/access/organizations')]
    def check(item):
        label, path = item
        try:
            api.call(path)
            return True, f'OK  {label}（只读访问通过，写权限在发布时验证）'
        except DeployError as error:
            return False, f'FAIL {label}: {error}'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, checks))
    for _, line in results:
        print(line)
    return all(ok for ok, _ in results)


def identity_settings():
    values = {k: os.environ.get(k, '').strip() for k in ['OWNER_EMAIL', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']}
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', values['OWNER_EMAIL']):
        raise DeployError('请设置 OWNER_EMAIL 为你确认允许登录的邮箱。')
    if not re.fullmatch(r'[a-z0-9-]+\.cloudflareaccess\.com', values['ACCESS_TEAM_DOMAIN']):
        raise DeployError('请设置 ACCESS_TEAM_DOMAIN，例如 your-team.cloudflareaccess.com。')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', values['ACCESS_AUD']):
        raise DeployError('请设置 ACCESS_AUD 为 Access 应用的 64 位 audience。')
    return values


def prepare(api):
    values = identity_settings()
    config = json.loads((ROOT / 'wrangler.jsonc').read_text())
    config['account_id'] = api.account
    config['workers_dev'] = True
    config['preview_urls'] = False
    config['vars'] = values
    # 先确认 Access 已配置；缺少登录方案时不创建数据库，也不公开开发身份。
    subdomain = api.call('/workers/subdomain')['subdomain']
    expected = f'{config["name"]}.{subdomain}.workers.dev/login'
    apps = api.call('/access/apps')
    if not any(app.get('aud') == values['ACCESS_AUD'] and app.get('domain') == expected for app in apps):
        raise DeployError(f'Access 未找到匹配 AUD 的 {expected} 应用；只保护 /login，启用 One-time PIN 并只允许 OWNER_EMAIL。')
    org = api.call('/access/organizations')
    if org.get('auth_domain') != values['ACCESS_TEAM_DOMAIN']:
        raise DeployError('Access 团队域名与当前账号不一致。')
    name = config['d1_databases'][0]['database_name']
    databases = api.call('/d1/database?per_page=10000')
    database = next((item for item in databases if item.get('name') == name), None)
    if database is None:
        database = api.call('/d1/database', 'POST', {'name': name})
    identifier = database.get('uuid')
    if not re.fullmatch(r'[a-f0-9-]{36}', identifier or ''):
        raise DeployError('D1 未返回有效数据库 ID，未写入配置。')
    config['d1_databases'][0]['database_id'] = identifier
    private_write(CONFIG, json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    print('生产配置已生成（不入 Git）；D1 已就绪。下一步：npm run cloud:publish')


def wrangler(*args, secret=None):
    cli = ROOT / 'node_modules/wrangler/bin/wrangler.js'
    if not cli.exists():
        raise DeployError('请先运行 npm ci 安装项目锁定的 Wrangler。')
    env = dict(os.environ, WRANGLER_SEND_METRICS='false', CI='true')
    command = ['node', str(cli), *args, '--config', str(CONFIG)]
    if secret is not None:
        # Secret 只经 stdin 发送；不进入命令参数，也不把 CLI 输出带入日志。
        result = subprocess.run(command, cwd=ROOT, env=env, input=secret, text=True, capture_output=True)
        if result.returncode:
            raise DeployError('Secret 上传失败；本地备份已保留，可重试，不要重新生成密钥。')
    else:
        result = subprocess.run(command, cwd=ROOT, env=env)
        if result.returncode:
            raise DeployError('Wrangler 命令未完成，请先解决上方错误。')


def publish(api):
    if not CONFIG.exists():
        raise DeployError('请先运行 npm run cloud:prepare。')
    config = json.loads(CONFIG.read_text())
    if config.get('account_id') != api.account or config.get('vars', {}).get('DEV_AUTH'):
        raise DeployError('生产账号不匹配或配置包含 DEV_AUTH，停止发布。')
    bindings = config.get('vars', {})
    if any(not bindings.get(k) for k in ['OWNER_EMAIL', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']):
        raise DeployError('生产登录配置不完整。')
    name = config['name']
    existing = api.call(f'/workers/scripts/{name}/secrets', missing_ok=True) or []
    has_key = any(item.get('name') == 'MODEL_CONFIG_KEY' for item in existing)
    backup = ROOT / '.cloudflare/model-config-key'
    if not has_key:
        # 数据库可能有之前加密的内容：没有远端 Key 时禁止静默生成替代密钥。
        db = config['d1_databases'][0]['database_id']
        tables = api.call(f'/d1/database/{db}/query', 'POST', {'sql': "SELECT name FROM sqlite_master WHERE type='table' AND name='model_profiles'"})
        if tables[0].get('results'):
            rows = api.call(f'/d1/database/{db}/query', 'POST', {'sql': 'SELECT COUNT(*) AS n FROM model_profiles'})
            if rows[0]['results'][0]['n']:
                raise DeployError('已有加密模型配置但远端 Secret 缺失，请恢复原密钥；不会自动替换。')
        if not backup.exists():
            private_write(backup, base64.b64encode(secrets.token_bytes(32)).decode())
        try:
            if len(base64.b64decode(backup.read_text().strip(), validate=True)) != 32:
                raise ValueError()
        except ValueError:
            raise DeployError('本地加密密钥备份格式异常，请检查；未上传。') from None
    wrangler('d1', 'migrations', 'apply', 'sensebook-personal', '--remote')
    wrangler('deploy')
    if not has_key:
        wrangler('secret', 'put', 'MODEL_CONFIG_KEY', secret=backup.read_text().strip())
        print('模型加密 Secret 已配置；本机备份在 .cloudflare/model-config-key，请安全备份。')
    else:
        print('已保留既有模型加密 Secret。')
    subdomain = api.call('/workers/subdomain')['subdomain']
    print(f'部署完成：https://{name}.{subdomain}.workers.dev （仍需验证邮箱登录）')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'prepare', 'publish'])
    args = parser.parse_args()
    try:
        api = API()
        if args.action == 'doctor':
            return 0 if doctor(api) else 1
        {'prepare': prepare, 'publish': publish}[args.action](api)
        return 0
    except (DeployError, KeyError, json.JSONDecodeError) as error:
        print(f'未完成：{error}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
