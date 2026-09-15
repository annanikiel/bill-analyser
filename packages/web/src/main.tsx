import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyThemeChoice, readThemeChoice } from './lib/theme-toggle.js';
import './theme.css';
import './app.css';

// Stamp the theme before first paint so a dark-mode user does not get a white flash.
applyThemeChoice(readThemeChoice());

const container = document.getElementById('root');
if (!container) throw new Error('No #root element to mount into');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
