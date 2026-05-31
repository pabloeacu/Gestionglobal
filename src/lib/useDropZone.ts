// Hook genérico para zonas drag&drop. Maneja onDragOver/onDragLeave/onDrop
// y expone un flag `isDragOver` para feedback visual.
//
// Uso típico:
//   const { isDragOver, dropProps } = useDropZone({
//     onDrop: (files) => handleFiles(files),
//     accept: ['image/*', 'application/pdf'],
//   });
//   return <div {...dropProps} className={isDragOver ? 'ring-2' : ''}>...</div>;
//
// `accept` filtra por mime; si no matchea ninguno, ignora el drop silenciosamente
// (el caller puede inspeccionar el array recibido para mostrar toast si quiere).

import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';

interface DropZoneOptions {
  onDrop: (files: File[]) => void | Promise<void>;
  /** Lista de mimes aceptados (con o sin wildcards "image/*"). */
  accept?: string[];
  /** Si está disabled, el handler ignora todo. */
  disabled?: boolean;
}

function matchesAccept(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;
  for (const a of accept) {
    if (a.endsWith('/*')) {
      if (file.type.startsWith(a.slice(0, -1))) return true;
    } else if (file.type === a) {
      return true;
    } else if (a.startsWith('.')) {
      // extension match
      if (file.name.toLowerCase().endsWith(a.toLowerCase())) return true;
    }
  }
  return false;
}

export function useDropZone({ onDrop, accept = [], disabled = false }: DropZoneOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  // Counter para manejar enter/leave anidados sin parpadeo.
  const counterRef = useRef(0);

  const onDragEnter = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      counterRef.current += 1;
      setIsDragOver(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      counterRef.current -= 1;
      if (counterRef.current <= 0) {
        counterRef.current = 0;
        setIsDragOver(false);
      }
    },
    [disabled],
  );

  const onDropHandler = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      counterRef.current = 0;
      setIsDragOver(false);
      const fl = e.dataTransfer.files;
      if (!fl || fl.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < fl.length; i++) {
        const f = fl.item(i);
        if (f && matchesAccept(f, accept)) files.push(f);
      }
      if (files.length > 0) void onDrop(files);
    },
    [disabled, accept, onDrop],
  );

  return {
    isDragOver,
    dropProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: onDropHandler,
    },
  };
}
