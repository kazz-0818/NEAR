export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 px-6 py-16 text-center">
      <p className="font-display text-xs tracking-[0.3em] text-slate-600 uppercase">
        Veliora Showcase
      </p>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-slate-600">
        本サイトはポートフォリオ用のデモです。LINE 連携・本番 API・データ操作は含みません。
        能力一覧は <code className="text-cyan-800">site/src/data/showcase.json</code>{" "}
        を編集して更新してください。
      </p>
      <p className="mt-6 text-[10px] text-slate-700">
        © Veliora Organization OS — Demonstration only
      </p>
    </footer>
  );
}
