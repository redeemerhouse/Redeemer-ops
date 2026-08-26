import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: () => {
    console.error('UI error captured');
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
