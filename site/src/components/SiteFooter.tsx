interface SiteFooterProps {
  className?: string;
}

export function SiteFooter({ className = "" }: SiteFooterProps) {
  return (
    <footer className={`border-t border-white/5 px-6 py-16 text-center ${className}`}>
      <p className="font-display text-xs tracking-[0.3em] text-slate-600 uppercase">
        Veriora Showcase
      </p>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-slate-600">
        本サイトはポートフォリオ用です。
      </p>
      <p className="mt-6 text-[10px] text-slate-700">
        © Veliora Organization OS — Demonstration only
      </p>
    </footer>
  );
}
