import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : undefined}>{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  return <button className={['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')} {...rest} />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      <span>{label}</span>
    </div>
  );
}

/** A swatch that gives a colour its meaning next to text, since text never wears the data colour. */
export function ColourDot({ slot, label }: { slot: number; label?: string }) {
  return (
    <span
      className="colour-dot"
      style={{ background: slot === 0 ? 'var(--series-0)' : `var(--series-${slot})` }}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
    />
  );
}

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'good';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'critical' ? 'alert' : undefined}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
