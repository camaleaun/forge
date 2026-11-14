import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../../scripts/macos-sign.sh', import.meta.url).pathname;
const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;

// Runs the script in dry-run mode: commands are printed with "+ " instead of executed.
function run(args: string[], env: Record<string, string> = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'forge-sign-'));
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: temp, RUNNER_TEMP: temp, FORGE_DRY_RUN: '1', ...env },
  });
  rmSync(temp, { recursive: true, force: true });
  return { ...result, out: `${result.stdout}${result.stderr}` };
}

const IDENTITY = { MACOS_SIGNING_IDENTITY: 'Developer-ID' };
const NOTARY = { NOTARY_KEY_P8: Buffer.from('fake-key').toString('base64'), NOTARY_KEY_ID: 'KEYID', NOTARY_ISSUER_ID: 'ISSUER' };
const CERT = { MACOS_CERTIFICATE_P12: Buffer.from('fake-p12').toString('base64'), MACOS_CERTIFICATE_PASSWORD: 'sekret-pass', ...IDENTITY };

describe('given no signing secrets', () => {
  it('when asking the status, then both signing and notarization are reported as disabled', () => {
    const { stdout, status } = run(['status']);
    assert.equal(status, 0);
    assert.match(stdout, /signing: disabled \(ad-hoc\)/);
    assert.match(stdout, /notarization: disabled/);
  });

  it('when signing an app, then it is signed ad-hoc (what the releases do today)', () => {
    assert.equal(run(['sign', 'hello.app']).stdout, '+ codesign --force --deep -s - hello.app\n');
  });

  it('when notarizing, stapling or importing a certificate, then each step is skipped with a message and succeeds', () => {
    for (const args of [['notarize', 'hello.app'], ['staple', 'hello.app'], ['import-certificate']]) {
      const { status, stdout } = run(args);
      assert.equal(status, 0, args.join(' '));
      assert.match(stdout, /skipped/);
      assert.ok(!stdout.includes('+ '), `${args.join(' ')} must not run commands`);
    }
  });
});

describe('given a Developer ID identity', () => {
  it('when asking the status, then signing is enabled', () => {
    assert.match(run(['status'], IDENTITY).stdout, /signing: Developer ID/);
  });

  it('when signing an app, then it uses the hardened runtime and a secure timestamp', () => {
    assert.equal(run(['sign', 'hello.app'], IDENTITY).stdout, '+ codesign --force --deep --options runtime --timestamp -s Developer-ID hello.app\n');
  });

  it('when signing a dmg, then it is signed without --deep and without the runtime option', () => {
    assert.equal(run(['sign', 'hello.dmg'], IDENTITY).stdout, '+ codesign --force --timestamp -s Developer-ID hello.dmg\n');
  });

  it('when the identity has spaces, then the argument stays one argument', () => {
    const { stdout } = run(['sign', 'hello.app'], { MACOS_SIGNING_IDENTITY: 'Developer ID Application: Someone (TEAM12345)' });
    assert.match(stdout, /-s Developer\\ ID\\ Application:\\ Someone\\ \\\(TEAM12345\\\) hello\.app/);
  });
});

describe('given App Store Connect API credentials', () => {
  it('when asking the status, then notarization is enabled', () => {
    assert.match(run(['status'], NOTARY).stdout, /notarization: enabled/);
  });

  it('when notarizing an app, then it is zipped with ditto and submitted to notarytool and waits for the result', () => {
    const { stdout, status } = run(['notarize', 'hello.app'], NOTARY);
    assert.equal(status, 0);
    const lines = stdout.trim().split('\n');
    assert.match(lines[0], /^\+ ditto -c -k --keepParent hello\.app \S+hello\.app\.zip$/);
    assert.match(lines[1], /^\+ xcrun notarytool submit \S+hello\.app\.zip --key \S+AuthKey\.p8 --key-id KEYID --issuer ISSUER --wait$/);
  });

  it('when notarizing a dmg, then it is submitted directly', () => {
    const { stdout } = run(['notarize', 'hello.dmg'], NOTARY);
    assert.match(stdout, /^\+ xcrun notarytool submit hello\.dmg --key \S+AuthKey\.p8 --key-id KEYID --issuer ISSUER --wait\n$/);
  });

  it('when stapling, then it runs xcrun stapler staple on the path', () => {
    assert.equal(run(['staple', 'hello.dmg'], NOTARY).stdout, '+ xcrun stapler staple hello.dmg\n');
  });
});

describe('given a certificate to import', () => {
  it('when importing it, then a temporary keychain is created, unlocked, filled and made available to codesign', () => {
    const { stdout, status } = run(['import-certificate'], CERT);
    assert.equal(status, 0);
    assert.match(stdout, /\+ security create-keychain -p \*\*\* \S*forge-build\.keychain-db/);
    assert.match(stdout, /\+ security unlock-keychain -p \*\*\* \S*forge-build\.keychain-db/);
    assert.match(stdout, /\+ security import \S+certificate\.p12 -P \*\*\* -A -t cert -f pkcs12 -k \S*forge-build\.keychain-db/);
    assert.match(stdout, /\+ security set-key-partition-list -S apple-tool:,apple: -s -k \*\*\* \S*forge-build\.keychain-db/);
    assert.match(stdout, /\+ security list-keychains -d user -s \S*forge-build\.keychain-db/);
  });

  it('when running with secrets, then no secret value ever appears in the output', () => {
    const { out } = run(['import-certificate'], CERT);
    assert.ok(!out.includes('sekret-pass'));
    assert.ok(!out.includes(CERT.MACOS_CERTIFICATE_P12));
    const notary = run(['notarize', 'hello.app'], NOTARY);
    assert.ok(!notary.out.includes(NOTARY.NOTARY_KEY_P8));
  });
});

describe('given wrong usage', () => {
  it('when the subcommand is unknown or the path is missing, then the exit code is 2 and the usage is shown', () => {
    for (const args of [['frobnicate'], ['sign'], ['notarize'], []]) {
      const { status, out } = run(args);
      assert.equal(status, 2, args.join(' '));
      assert.match(out, /Usage: macos-sign\.sh/);
    }
  });
});

describe('given the script itself', () => {
  it('when linted with shellcheck, then it reports nothing', { skip: !hasShellcheck && 'shellcheck not installed' }, () => {
    const result = spawnSync('shellcheck', [script], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });
});
