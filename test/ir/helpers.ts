import { h } from '../../src/ir/runtime.ts';
import { state, resetStates } from '../../src/ir/state.ts';

export function helloApp() {
  resetStates();
  const message = state('Press the button');
  function greet() {
    message.set('Hello, world!');
  }
  const App = () =>
    h('window', { title: 'Hello, forge', 'forge:loc': [7, 5] },
      h('text', { class: 'message', 'forge:loc': [8, 7] }, message),
      h('button', { onClick: greet, 'forge:loc': [9, 7] }, 'Greet'));
  return { App, greet, message, commands: { '--greet': { description: 'Print the greeting', run: greet } } };
}
