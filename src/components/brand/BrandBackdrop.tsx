// Fondo institucional premium: degradé nocturno + glows suaves + motivo
// geométrico de triángulos (lenguaje visual de la marca Gestión Global).
export function BrandBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-night via-brand-night-2 to-[#0a2a3a]" />

      {/* glows */}
      <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-cyan/20 blur-[120px]" />
      <div className="absolute -bottom-40 right-[-6rem] h-[32rem] w-[32rem] rounded-full bg-brand-teal/20 blur-[140px]" />
      <div className="absolute right-1/3 top-10 h-72 w-72 rounded-full bg-brand-blue/10 blur-[120px]" />

      {/* grilla sutil */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg,#fff 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      {/* triángulos de marca */}
      <svg
        className="absolute right-6 top-24 h-44 w-44 animate-float text-brand-cyan/30"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path d="M10 30 L30 10 L30 30 Z" fill="currentColor" />
        <path d="M36 30 L56 10 L56 30 Z" fill="currentColor" opacity="0.6" />
        <path d="M10 56 L30 36 L30 56 Z" fill="currentColor" opacity="0.6" />
        <path d="M36 56 L56 36 L56 56 Z" fill="currentColor" opacity="0.3" />
      </svg>
      <svg
        className="absolute bottom-16 left-10 h-32 w-32 text-brand-teal/25"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path d="M50 8 L72 30 L50 30 Z" fill="currentColor" />
        <path d="M28 30 L50 30 L28 52 Z" fill="currentColor" opacity="0.5" />
      </svg>

      {/* viñeta inferior */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/30 to-transparent" />
    </div>
  );
}
