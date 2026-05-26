// ColorPicker · input HTML5 + hex input sincronizados.
// Sin dependencias externas. Usa el color picker nativo del browser.

import { useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ColorPicker({ value, onChange, label }: Props) {
  // Mantenemos un estado local para que el usuario pueda tipear hex incompletos.
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function handleHexChange(v: string) {
    setLocal(v);
    if (HEX_RE.test(v)) onChange(v);
  }

  return (
    <div>
      {label && (
        <label className="kicker mb-1 block text-brand-muted">{label}</label>
      )}
      <div className="inline-flex items-center gap-2">
        <label className="relative inline-block h-9 w-12 cursor-pointer overflow-hidden rounded-lg ring-1 ring-slate-200 transition hover:ring-brand-cyan/50">
          <input
            type="color"
            value={HEX_RE.test(local) ? local : value}
            onChange={(e) => {
              setLocal(e.target.value);
              onChange(e.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer border-0 p-0"
            style={{ background: 'transparent' }}
          />
        </label>
        <input
          type="text"
          value={local}
          onChange={(e) => handleHexChange(e.target.value)}
          placeholder="#0891b2"
          maxLength={7}
          spellCheck={false}
          className="h-9 w-28 rounded-lg border border-slate-300 px-2 font-mono text-xs uppercase text-brand-ink shadow-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20"
        />
      </div>
    </div>
  );
}
