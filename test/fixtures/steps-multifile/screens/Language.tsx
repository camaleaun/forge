import { next, quit } from 'forge';
import './Language.css';

function confirm() {
  next();
}

export default function Language() {
  return (
    <step id="language" width={420} height={180}>
      <text>Choose your language</text>
      <select language />
      <progress source="language-download" />
      <view class="buttons">
        <button waitsForDownload onClick={confirm}>OK</button>
        <button onClick={quit}>Cancel</button>
      </view>
    </step>
  );
}
