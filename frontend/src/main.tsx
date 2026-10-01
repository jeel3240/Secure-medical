import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { armRingtone } from './lib/ringtone';
import './styles/tokens.css';
import './styles/global.css';

// From the very first click, the sign-in button included: the click that
// signs an agent in is the one that lets an incoming call ring - lib/ringtone.ts.
armRingtone();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
