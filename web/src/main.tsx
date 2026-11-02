import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { connect } from './store';
import './index.css';

if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
connect();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
