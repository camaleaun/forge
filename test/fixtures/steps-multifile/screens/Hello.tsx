import { state, back, quit, goTo } from 'forge';
import './Hello.css';

const message = state('Press the button');

function greet() {
  message.set('Hello, world!');
}

export default function Hello() {
  return (
    <step id="hello" width={600} height={440}>
      <text class="message">{message}</text>
      <button onClick={greet}>Greet</button>
      <view class="buttons">
        <button onClick={back}>Back</button>
        <button primary onClick={goTo('language')}>Language</button>
        <button cancel onClick={quit}>Close</button>
      </view>
    </step>
  );
}
