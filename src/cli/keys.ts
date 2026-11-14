export type KeyActions = { open(): void; showQr(): void; showHelp(): void; stop(): void };

// Maps a key pressed in the terminal to an action. Returns false for keys that mean nothing.
export function handleKey(key: string, actions: KeyActions): boolean {
  switch (key.toLowerCase()) {
    case 'o': actions.open(); return true;
    case 'q': actions.showQr(); return true;
    case 'h':
    case '?': actions.showHelp(); return true;
    case '\u0003': actions.stop(); return true;
    default: return false;
  }
}
