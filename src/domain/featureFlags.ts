// ============================================================
// Feature Flags — centralized controls for experimental or deferred UI
// ============================================================

export interface FeatureFlags {
  enableClozeTools: boolean;
  enableBatchRecallHeader: boolean;
}

const STORAGE_KEY = 'nodal-feature-flags-v1';

const DEFAULT_FLAGS: FeatureFlags = {
  enableClozeTools: false,
  enableBatchRecallHeader: false,
};

export function getFeatureFlags(): FeatureFlags {
  if (typeof window === 'undefined') return DEFAULT_FLAGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FLAGS;
    return { ...DEFAULT_FLAGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FLAGS;
  }
}

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getFeatureFlags();
    current[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent('nodal:feature-flags-changed', { detail: current }));
  } catch (err) {
    console.error('Failed to save feature flags', err);
  }
}
