import { App } from './view/App.js';
import './styles.css';

const mountNode = document.getElementById('app');

if (mountNode !== null) {
  mountNode.append(<App />);
}
