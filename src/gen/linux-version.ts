// deb and rpm sort "1.0.0-rc.1" after "1.0.0"; a tilde makes the prerelease sort first.
export function packageVersion(version: string): string {
  return version.replace('-', '~');
}

// File names use x86_64 and arm64 (uname reports aarch64).
export function linuxArch(machine: string): string {
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64';
  if (machine === 'amd64' || machine === 'x86_64') return 'x86_64';
  return machine;
}
