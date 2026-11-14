export function greet(ui: { setText(id: string, text: string): void }) {
  ui.setText('message', 'Hello, world!');
}
