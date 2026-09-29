import type { ReactNode } from 'react';

export function CardSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`knowledge-card-surface ${className}`}>{children}</section>;
}
