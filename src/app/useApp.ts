import { useContext } from 'react';
import { AppStateContext, type AppState } from './AppState';

export function useApp(): AppState {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
