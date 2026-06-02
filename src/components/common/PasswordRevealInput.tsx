// PasswordRevealInput · input "***" + botón ojito para mostrar/ocultar.
// Pensado para claves fiscales y similares. Reusable en formularios públicos,
// drawer de gerencia y detail page del cliente.
//
// Decisión de seguridad (E-GG-32): la clave fiscal ARCA NO se cifra en BD
// (decisión del usuario 2026-06-02: tiene que estar disponible para la
// gestoría sin fricción). El componente solo agrega defensa contra
// over-the-shoulder / screen-share.

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './Field';
import { cn } from '@/lib/cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  invalid?: boolean;
};

export function PasswordRevealInput({ className, ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        className={cn('pr-12', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-brand-muted transition hover:text-brand-cyan"
        tabIndex={-1}
        aria-label={visible ? 'Ocultar' : 'Mostrar'}
        title={visible ? 'Ocultar' : 'Mostrar'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
