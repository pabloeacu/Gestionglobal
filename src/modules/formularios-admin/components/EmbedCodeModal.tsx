// Backlog #19: snippet para embeber el formulario en cualquier sitio externo.
// Dos sabores:
//  - Iframe simple (copia y pegá).
//  - Iframe con script de auto-resize (postMessage handshake básico).

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Modal, CopyButton as InlineCopyButton, Button } from '@/components/common';
// InlineCopyButton es para el URL corto; los snippets usan SnippetBlock propio.
const CopyButton = InlineCopyButton;
import { toast } from '@/lib/toast';

interface EmbedCodeModalProps {
  open: boolean;
  onClose: () => void;
  slug: string;
}

export function EmbedCodeModal({ open, onClose, slug }: EmbedCodeModalProps) {
  const baseUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'https://gestionglobal.ar';
    return window.location.origin;
  }, []);

  const url = `${baseUrl}/formulario/${slug}`;
  const iframeSnippet = `<iframe src="${url}" width="100%" height="800" frameborder="0" style="border:0;border-radius:16px;" allow="clipboard-write"></iframe>`;
  const autoResizeSnippet = `<div id="gg-form-${slug}"></div>
<script>
(function(){
  var d=document.getElementById('gg-form-${slug}');
  var f=document.createElement('iframe');
  f.src='${url}';
  f.width='100%';f.height='600';f.frameBorder='0';f.style.border='0';f.style.borderRadius='16px';
  d.appendChild(f);
  window.addEventListener('message',function(e){
    if(e.origin!=='${baseUrl}')return;
    if(e.data && e.data.type==='gg-form-resize' && e.data.slug==='${slug}'){
      f.height=e.data.height;
    }
  });
})();
</script>`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Embeber formulario"
      kicker="Compartir"
      width={620}
    >
      <div className="space-y-5 text-sm">
        <div>
          <p className="kicker mb-1">URL pública</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs">
            <span className="flex-1 truncate text-brand-ink">{url}</span>
            <CopyButton value={url} />
          </div>
        </div>

        <SnippetBlock kicker="Iframe simple" code={iframeSnippet} />
        <SnippetBlock kicker="Iframe con auto-resize" code={autoResizeSnippet} />
      </div>
    </Modal>
  );
}

function SnippetBlock({ kicker, code }: { kicker: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Snippet copiado');
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('No pudimos copiar al portapapeles');
    }
  }
  return (
    <div>
      <p className="kicker mb-1">{kicker}</p>
      <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-brand-zebra/60 p-3 text-[11px] leading-relaxed text-brand-ink">
        {code}
      </pre>
      <div className="mt-2 flex justify-end">
        <Button variant="secondary" onClick={onCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}
