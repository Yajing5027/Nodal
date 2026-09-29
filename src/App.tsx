import { lazy, Suspense, useEffect, useState } from 'react';
import { AppProvider } from './app/AppContext';
import { useApp } from './app/useApp';
import { AppSidebar, NavIcon } from './components/layout/AppSidebar';
import { ThemeProvider } from './app/ThemeContext';
import './styles/globals.css';
import './styles/learning.css';
import './styles/plan.css';
import './styles/refinement.css';
import './styles/cards.css';
import './styles/appearance.css';
import './styles/sidebar.css';
import './styles/workspace-ui.css';

const HomePage = lazy(() => import('./features/library/HomePage').then((module) => ({ default: module.HomePage })));
const NodeLibrary = lazy(() => import('./features/library/NodeLibrary').then((module) => ({ default: module.NodeLibrary })));
const MapLibrary = lazy(() => import('./features/library/MapLibrary').then((module) => ({ default: module.MapLibrary })));
const TagLibrary = lazy(() => import('./features/library/TagLibrary').then((module) => ({ default: module.TagLibrary })));
const DataPage = lazy(() => import('./features/library/DataPage').then((module) => ({ default: module.DataPage })));
const MapShell = lazy(() => import('./features/maps/MapShell').then((module) => ({ default: module.MapShell })));
const ReviewSession = lazy(() => import('./features/review/ReviewSession').then((module) => ({ default: module.ReviewSession })));
const CardLibrary = lazy(() => import('./features/review/CardLibrary').then((module) => ({ default: module.CardLibrary })));
const BatchRecall = lazy(() => import('./features/review/BatchRecall').then(module => ({ default: module.BatchRecall })));
const PlanPage = lazy(() => import('./features/review/PlanPage').then(module => ({ default: module.PlanPage })));
const PlansPage = lazy(() => import('./features/review/PlansPage').then(module => ({ default: module.PlansPage })));
const NodesOverview = lazy(() => import('./features/nodes/NodesOverview').then(module => ({ default: module.NodesOverview })));

function Application() {
  const { activeView, isLoading } = useApp();
  const [navigationHidden, setNavigationHidden] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileNavigation(true);
        requestAnimationFrame(() => document.getElementById('global-search-input')?.focus());
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (isLoading) {
    return <div className="app-loading">Loading your knowledge base…</div>;
  }

  return (
    <div className={`app-frame${navigationHidden ? ' navigation-hidden' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <button className="desktop-navigation-toggle" aria-label={navigationHidden ? 'Show sidebar' : 'Hide sidebar'} title={navigationHidden ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={!navigationHidden} onClick={() => setNavigationHidden(value => !value)}><NavIcon name="panel" /></button>
      <AppSidebar mobileOpen={mobileNavigation} onClose={() => setMobileNavigation(false)} />
      <button className="mobile-navigation-toggle" aria-label="Show navigation" aria-expanded={mobileNavigation} onClick={() => setMobileNavigation(value => !value)}><NavIcon name="panel" /></button>
      <div className="app-content" id="main-content" tabIndex={-1}>
        <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
          {activeView === 'home' && <HomePage />}
          {activeView === 'nodes' && <NodeLibrary />}
          {activeView === 'maps' && <MapLibrary />}
          {activeView === 'tags' && <TagLibrary />}
          {activeView === 'data' && <DataPage />}
          {activeView === 'map' && <MapShell />}
          {activeView === 'review' && <ReviewSession />}
          {activeView === 'cards' && <CardLibrary />}
          {activeView === 'batch' && <BatchRecall />}
          {activeView === 'plan' && <PlanPage />}
          {activeView === 'plans' && <PlansPage />}
          {activeView === 'sections' && <NodesOverview />}
        </Suspense>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider><AppProvider>
      <Application />
    </AppProvider></ThemeProvider>
  );
}
