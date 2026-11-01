/** Fundo dos ecrãs de entrada: grelha fina, arcos geométricos e um brilho verde localizado.
 *  Estático (nada se mexe em permanência) e só decorativo. */
export function FundoLis() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="grelha-fundo absolute inset-0" />
      <div className="absolute left-1/2 top-[38%] h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgb(30_215_96/0.14),transparent_62%)]" />
      <svg className="absolute left-1/2 top-[42%] h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 opacity-70" viewBox="0 0 900 900" fill="none">
        <circle cx="450" cy="450" r="250" stroke="rgb(255 255 255 / 0.05)" />
        <circle cx="450" cy="450" r="340" stroke="rgb(255 255 255 / 0.035)" strokeDasharray="2 10" />
        <circle cx="450" cy="450" r="430" stroke="rgb(255 255 255 / 0.025)" />
        <path d="M200 450 A250 250 0 0 1 450 200" stroke="rgb(30 215 96 / 0.35)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M790 450 A340 340 0 0 1 450 790" stroke="rgb(30 215 96 / 0.18)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M450 20 L470 40 L450 60 L430 40 Z" stroke="rgb(255 255 255 / 0.07)" />
        <path d="M80 640 L104 664 L80 688 L56 664 Z" stroke="rgb(30 215 96 / 0.16)" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
    </div>
  )
}
