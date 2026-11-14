import { qrMatrix } from '../qr/qr.ts';
import { qrToTerminal } from '../qr/render.ts';

export function formatLanBanner(urls: string[], options: { qr?: boolean; token?: boolean } = {}): string {
  const lines = [
    'WARNING: the dev server is exposed on the local network.',
    options.token === false
      ? 'Anyone on this network can open it (no token). Use --token to require a secret token, or --local to keep it on this machine.'
      : 'Anyone on this network who has the URL below (it contains a secret token) can open it.',
    '',
    ...urls.map((url) => `  ${url}`),
  ];
  if (urls.length > 0 && options.qr !== false) {
    try {
      lines.push('', qrToTerminal(qrMatrix(urls[0])));
    } catch {
      // the URL does not fit the QR limits: the URL alone is printed
    }
  }
  return lines.join('\n') + '\n';
}
