import React from 'react';
import { ScaleMultiplierProvider } from '../context/ScaleMultiplierContext.jsx';
import ExecutionScaleControl from './ExecutionScaleControl.jsx';

export default function ScaleContextPanel({ children }) {
  return (
    <ScaleMultiplierProvider>
      <ExecutionScaleControl />
      {children}
    </ScaleMultiplierProvider>
  );
}
