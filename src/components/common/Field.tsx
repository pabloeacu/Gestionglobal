import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label?: ReactNode;  // permite badges / íconos inline en el label
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label className="kicker block">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-brand-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-brand-ink outline-none transition placeholder:text-brand-muted/60 ' +
  'border-slate-300 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-brand-muted';

export function Input({
  className,
  invalid,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={cn(inputBase, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-100', className)}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...rest}
      className={cn(inputBase, 'pr-8', invalid && 'border-red-400', className)}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  invalid,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      className={cn(inputBase, 'resize-y min-h-[80px]', invalid && 'border-red-400', className)}
    />
  );
}
