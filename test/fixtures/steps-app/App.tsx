import { state, next, back, quit, goTo } from 'forge';
import './App.css';

const message = state('Press the button');

function greet() {
  message.set('Hello, world!');
}

function confirm() {
  message.set('Language chosen');
  next();
}

export default function App() {
  return (
    <window title="Hello, forge">
      <steps>
        <step id="language" width={420} height={180}>
          <text>Choose your language</text>
          <select language />
          <progress source="language-download" />
          <view class="buttons">
            <button waitsForDownload onClick={confirm}>OK</button>
            <button onClick={quit}>Cancel</button>
          </view>
        </step>
        <step id="hello" width={600} height={440}>
          <text class="message">{message}</text>
          <button onClick={greet}>Greet</button>
          <view class="buttons">
            <button onClick={back}>Back</button>
            <button onClick={goTo('language')}>Language</button>
            <button onClick={quit}>Close</button>
          </view>
        </step>
      </steps>
    </window>
  );
}
