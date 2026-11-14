import './App.css';
import Language from './screens/Language.tsx';
import Hello from './screens/Hello.tsx';

export default function App() {
  return (
    <window title="Hello, forge">
      <steps>
        <Language />
        <Hello />
      </steps>
    </window>
  );
}
