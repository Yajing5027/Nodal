// ============================================================
// Shared UI Components — Modal, ConfirmDialog, Toast
// ============================================================
import { useEffect, useRef, type ReactNode } from 'react';

// ---------- Modal ----------
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, width = 480 }: ModalProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    const focusInitial = () => {
      if (!dialogRef.current) return;
      const bodyFirst = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = bodyFirst ?? dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? dialogRef.current;
      target?.focus();
    };

    focusInitial();
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(focusInitial) : null;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handler);
      if (triggerRef.current && typeof triggerRef.current.focus === 'function' && triggerRef.current.isConnected) {
        triggerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay, rgba(0,0,0,0.3))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          width,
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          outline: 'none',
        }}
      >
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 'var(--font-lg)' }}>{title}</span>
          <button className="ghost" aria-label="Close dialog" onClick={onClose} style={{ fontSize: 'var(--font-lg)' }}>✕</button>
        </div>
        <div ref={bodyRef} style={{ padding: 'var(--space-4)', overflow: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------- ConfirmDialog ----------
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width={420}>
      <div style={{ fontSize: 'var(--font-md)', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)', lineHeight: 1.6 }}>
        {message}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button onClick={onCancel}>{cancelLabel}</button>
        <button className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------- InlineNodeCreator (for map double-click) ----------
interface InlineCreatorProps {
  x: number;
  y: number;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function InlineNodeCreator({ x, y, onSubmit, onCancel }: InlineCreatorProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--selection-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--space-2)',
        width: 220,
      }}
    >
      <input
        autoFocus
        placeholder="Node title…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) onSubmit(val);
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={onCancel}
        style={{ fontSize: 'var(--font-md)' }}
      />
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-1)' }}>
        Enter to create · Esc to cancel
      </div>
    </div>
  );
}

// ---------- Section (collapsible) ----------
interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}

import { useState } from 'react';

export function Section({ title, children, defaultOpen = true, action }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {action}
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▶</span>
        </div>
      </div>
      {open && <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>{children}</div>}
    </div>
  );
}
