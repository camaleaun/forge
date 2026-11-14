export const SITE = {
  name: 'forge',
  pitch: 'Tiny native apps from a web-like source: TSX, CSS and TypeScript',
  url: 'https://camaleaun.github.io/forge/',
  repos: [
    { name: 'camaleaun/forge', url: 'https://github.com/camaleaun/forge', about: 'the tool' },
    { name: 'camaleaun/forge-hello-world', url: 'https://github.com/camaleaun/forge-hello-world', about: 'the smallest example app' },
    { name: 'camaleaun/forge-action', url: 'https://github.com/camaleaun/forge-action', about: 'GitHub Actions to build and release' },
  ],
};

export const helloTsx = `import { state } from 'forge';
import './App.css';

const message = state('Press the button');

function greet() {
  message.set('Hello, world!');
}

export const commands = {
  '--greet': { description: 'Print the greeting', run: greet },
};

export default function App() {
  return (
    <window title="Hello, forge">
      <text class="message">{message}</text>
      <button onClick={greet}>Greet</button>
    </window>
  );
}`;

export const helloCss = `window   { width: 320px; height: 120px; padding: 20px; gap: 12px; align-items: start; }
.message { font-size: 15px; }
button   { width: 100px; }`;
