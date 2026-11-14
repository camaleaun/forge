import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLanBanner } from '../../src/dev/banner.ts';

describe('given LAN urls', () => {
  const url = 'http://192.168.1.20:5170/?t=abc123';
  it('when formatting then it warns that the server is exposed on the local network and shows the URL', () => {
    const banner = formatLanBanner([url]);
    assert.match(banner, /exposed on the local network/i);
    assert.ok(banner.includes(url));
  });
  it('when formatting then a QR block of half-block characters follows', () => {
    const banner = formatLanBanner([url]);
    const qrLines = banner.split('\n').filter((l) => /^[ █▀▄]{21,}$/.test(l));
    assert.ok(qrLines.length >= 10, `qr lines: ${qrLines.length}`);
  });
  it('when several urls are given then all are listed but the QR encodes the first', () => {
    const banner = formatLanBanner([url, 'http://10.0.0.2:5170/?t=abc123']);
    assert.ok(banner.includes('http://10.0.0.2:5170/?t=abc123'));
  });
  it('when the URL does not fit the QR limits then only the URL is printed', () => {
    const long = 'http://192.168.1.20:5170/?t=' + 'a'.repeat(5000);
    const banner = formatLanBanner([long]);
    assert.ok(banner.includes(long));
    assert.equal(banner.split('\n').filter((l) => /^[ █▀▄]{21,}$/.test(l)).length, 0);
  });
});
