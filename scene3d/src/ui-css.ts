/* 三维场景界面样式：沿用现有网页的 CSS 变量（在独立开发页里用后备值）。 */
export const CSS = /* css */ `
.s3d { position: relative; overflow: hidden; background: #08090b;
  --t: var(--text, #f2f3f5); --t2: var(--text-2, #a9aeb8); --mu: var(--muted, #737985);
  --sf: var(--surface, rgba(19,20,23,.84)); --ln: var(--line, rgba(255,255,255,.075)); --ln2: var(--line-2, rgba(255,255,255,.14));
  --ac: #4aa3ff; font-family: var(--font, system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif); color: var(--t); }
.s3d-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.s3d-ui { position: absolute; inset: 0; pointer-events: none; }
.s3d-ui > * { pointer-events: auto; }

.s3d-hud { position: absolute; left: 24px; top: 20px; pointer-events: none; max-width: 380px; text-shadow: 0 1px 10px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.5); }
/* 人眼视角：屏幕为主，文字少而大 */
.s3d.eyeview .s3d-scene { font-size: 18px; color: var(--t); }
.s3d.eyeview .s3d-hero [data-k="theta"] { font-size: 56px; }
.s3d.eyeview .s3d-hero-sub, .s3d.eyeview .s3d-note, .s3d.eyeview .s3d-stats span:nth-child(3) { display: none; }
.s3d.eyeview .s3d-stats { font-size: 18px; gap: 20px; }
.s3d.eyeview .s3d-stats i { color: var(--t2); }
.s3d.eyeview .s3d-inset-cap { font-size: 15px; }
/* H：隐藏全部界面（录屏） */
.s3d.clean .s3d-ui > *:not(.s3d-inset) { display: none !important; }
.s3d.clean .s3d-inset-cap { display: none; }
.s3d-scene { font-size: 13px; font-weight: 600; color: var(--t2); letter-spacing: .02em; }
.s3d-hero { display: flex; align-items: baseline; gap: 10px; margin-top: 8px; }
.s3d-hero [data-k="theta"] { font-size: 48px; font-weight: 600; line-height: 1; letter-spacing: -.02em; }
.s3d-hero-sub { font-size: 13px; color: var(--t2); }
.s3d-stats { display: flex; gap: 16px; margin-top: 10px; font-size: 13px; }
.s3d-stats i { font-style: normal; color: var(--mu); margin-right: 5px; }
.s3d-stats b { font-weight: 600; font-variant-numeric: tabular-nums; margin-right: 3px; }
.s3d-note { margin-top: 10px; font-size: 12px; color: var(--mu); line-height: 1.5; }

.s3d-bar { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  padding: 6px; border-radius: 16px; background: var(--sf); border: 1px solid var(--ln);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0,0,0,.4); max-width: calc(100% - 24px); }
.s3d-row2 { display: contents; }
.s3d-seg { display: flex; gap: 2px; }
.s3d-seg button { margin: 0; box-shadow: none; font: inherit; font-size: 13px; color: var(--t2); background: transparent; border: 0; border-radius: 10px; padding: 8px 12px; cursor: pointer; white-space: nowrap; }
.s3d-seg button:hover:not(:disabled) { color: var(--t); background: rgba(255,255,255,.05); }
.s3d-seg button.on { color: var(--t); background: rgba(255,255,255,.14); }
.s3d-seg button:disabled { opacity: .35; cursor: default; }
.s3d-div { width: 1px; height: 22px; background: var(--ln2); }
.s3d-select { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--t2); padding: 0 6px; white-space: nowrap; }
.s3d-select select { font: inherit; color: var(--t); background: rgba(255,255,255,.06); border: 1px solid var(--ln); border-radius: 8px; padding: 6px 8px; width: auto; min-width: 84px; }
.s3d-select option { background: #1b1d22; }

.s3d-warn { margin-top: 8px; font-size: 12px; color: #fab219; }
.s3d-warn:empty { display: none; }
.s3d-btn { font: inherit; font-size: 13px; color: var(--t2); background: rgba(255,255,255,.06); border: 1px solid var(--ln); border-radius: 10px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
.s3d-btn:hover, .s3d-btn.on { color: var(--t); background: rgba(255,255,255,.14); }
.s3d-toggle { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--t2); cursor: pointer; white-space: nowrap; padding: 0 4px; }
.s3d-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.s3d-sw { position: relative; width: 34px; height: 20px; border-radius: 10px; background: rgba(255,255,255,.16); transition: background .2s; flex: none; }
.s3d-sw::after { content: ""; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .2s; }
.s3d-toggle input:checked + .s3d-sw { background: var(--ac); }
.s3d-toggle input:checked + .s3d-sw::after { transform: translateX(14px); }
.s3d-toggle input:focus-visible + .s3d-sw { outline: 2px solid var(--ac); outline-offset: 2px; }

/* 调整面板 */
.s3d-adjust { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); width: 300px; padding: 14px 16px 12px; border-radius: 14px;
  background: var(--sf); border: 1px solid var(--ln); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0,0,0,.4); }
.s3d-adjust[hidden] { display: none; }
.s3d-adjust-h { font-size: 12px; font-weight: 600; color: var(--t2); margin-bottom: 8px; }
.s3d-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--t2); margin-top: 6px; }
.s3d-row b { color: var(--t); font-weight: 600; font-variant-numeric: tabular-nums; }
.s3d-adjust input[type=range] { width: 100%; accent-color: var(--ac); margin: 6px 0 4px; }
.s3d-derived { font-size: 12px; color: var(--mu); margin-top: 4px; }
.s3d-derived:empty { display: none; }
.s3d-link { font: inherit; font-size: 12px; color: var(--t2); background: none; border: 0; padding: 6px 0 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

/* 机身颜色 */
.s3d-swatches { display: flex; gap: 10px; margin: 8px 0 4px; }
.s3d-sw-btn { width: 24px; height: 24px; border-radius: 50%; padding: 0; cursor: pointer; background: var(--c); border: 2px solid rgba(255,255,255,.15); }
.s3d-sw-btn.on { border-color: #141518; box-shadow: 0 0 0 2px var(--t); }

/* 数据面板：宽屏放在左侧读数下方，手机放在工具栏上方 */
.s3d-data { position: absolute; left: 20px; top: 178px; width: 300px; max-height: calc(100% - 270px); overflow-y: auto; padding: 12px 14px;
  border-radius: 14px; background: var(--sf); border: 1px solid var(--ln); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  box-shadow: 0 16px 40px rgba(0,0,0,.4); scrollbar-width: thin; }
.s3d-data[hidden] { display: none; }
.s3d.eyeview .s3d-data { top: 196px; }
.s3d-data-h { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--t2); margin-bottom: 8px; }
.s3d-data-h i { font-style: normal; font-weight: 500; color: var(--mu); margin-left: 4px; }
.s3d-seg.mini { padding: 2px; border-radius: 9px; background: rgba(0,0,0,.28); border: 1px solid var(--ln); }
.s3d-seg.mini button { padding: 3px 10px; font-size: 12px; border-radius: 7px; }
.s3d-pad { display: block; width: 100%; max-width: 220px; aspect-ratio: 1; margin: 0 auto; }
.s3d-pad-read { text-align: center; font-size: 12px; color: var(--t2); margin-top: 4px; min-height: 17px; font-variant-numeric: tabular-nums; }
.s3d-pad-read b { color: var(--t); font-weight: 600; }
.s3d-pad-scale { max-width: 200px; margin: 6px auto 0; }
.s3d-ramp { height: 6px; border-radius: 3px; }
.s3d-ramp-ticks { display: flex; justify-content: space-between; color: var(--mu); font-size: 11px; margin-top: 3px; }
.s3d-pad-note { font-size: 11px; color: var(--mu); text-align: center; margin-top: 6px; }
.s3d-pad-note .hatch { display: inline-block; width: 16px; height: 9px; margin-right: 4px; vertical-align: -1px; border-radius: 2px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.45) 0 1px, transparent 1px 4px); border: 1px solid var(--ln2); }
.s3d-curve-col { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ln); }
.s3d-curve-h { font-size: 12px; color: var(--mu); margin-bottom: 6px; }
.s3d-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--mu); margin-bottom: 6px; }
.s3d-legend:empty { display: none; }
.s3d-legend span { display: inline-flex; align-items: center; gap: 6px; }
.s3d-legend span.on { color: var(--t); }
.s3d-legend i { width: 14px; height: 2px; border-radius: 1px; }
.s3d-charts svg { display: block; width: 100%; overflow: visible; }
.s3d-charts svg + svg { margin-top: 6px; }
.s3d-charts .ch-title { fill: var(--t2); font-size: 11.5px; }
.s3d-charts .ch-val { fill: var(--t); font-size: 11.5px; font-weight: 600; }
.s3d-charts .ch-tick { fill: var(--mu); font-size: 10.5px; }
.s3d-charts .ch-grid { stroke: rgba(255,255,255,.07); }
.s3d-charts .ch-base { stroke: rgba(255,255,255,.18); }
.s3d-charts .ch-cursor { stroke: rgba(255,255,255,.55); }
.s3d-charts .ch-hover { stroke: rgba(255,255,255,.3); }
.s3d-charts .ch-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.s3d-charts .ch-hit { fill: transparent; }
/* 数据面板打开时，宽屏把左侧说明收起，避免拥挤 */
.s3d.with-data .s3d-note { display: none; }

/* 地铁场景小窗：另一个人的眼睛看到的 */
.s3d-inset { position: absolute; display: none; pointer-events: none; border-radius: 12px; border: 1px solid rgba(255,157,77,.55); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.s3d-inset-cap { position: absolute; left: 0; right: 0; bottom: -1px; transform: translateY(100%); padding: 6px 2px 0; font-size: 12px; display: flex; justify-content: space-between; gap: 8px; }
.s3d-inset-cap b { font-weight: 600; }
.s3d-inset-cap span { color: var(--t2); font-variant-numeric: tabular-nums; }

/* 标注 */
.ann-layer { position: absolute; inset: 0; pointer-events: none; }
.ann-leaders { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ann-leaders path { fill: none; stroke: rgba(255,255,255,.35); stroke-width: 1; }
.ann-leaders circle { fill: #fff; }
.ann { position: absolute; left: 0; top: 0; white-space: nowrap; font-size: 12px; line-height: 1.3; padding: 5px 9px; border-radius: 8px;
  background: rgba(14,15,18,.78); border: 1px solid var(--ln2); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  font-variant-numeric: tabular-nums; }
.ann .k { color: var(--mu); margin-right: 4px; }
.ann b { font-weight: 600; }
.ann .sep { display: inline-block; width: 10px; }
.ann .warn { color: #fab219; margin-left: 8px; }
.ann-dist { border-color: color-mix(in srgb, var(--ac) 55%, transparent); }
.ann-dist b { margin-right: 5px; }
.ann-v2 { border-color: rgba(255,157,77,.6); }

@media (max-width: 980px) {
  .s3d-bar { flex-wrap: wrap; justify-content: center; }
  .s3d-div { display: none; }
}
@media (max-width: 760px) {
  /* 手机：两行——第一行场景，第二行视角与其他（放不下时可横向滑动） */
  .s3d-bar { left: 8px; right: 8px; transform: none; max-width: none; flex-direction: column; flex-wrap: nowrap !important; align-items: stretch; gap: 4px; padding: 5px; }
  .s3d-bar > [data-k="scenes"] { justify-content: space-between; }
  .s3d-bar > [data-k="scenes"] button { flex: 1; padding: 8px 4px; }
  .s3d-row2 { display: flex; align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: none;
    -webkit-mask-image: linear-gradient(90deg, #000 88%, transparent); mask-image: linear-gradient(90deg, #000 88%, transparent); padding-right: 24px; }
  .s3d-row2::-webkit-scrollbar { display: none; }
  .s3d-row2 > * { flex: none; }
  .s3d-select span { display: none; }
  .s3d-adjust { bottom: 112px; width: calc(100% - 24px); }
  .s3d-data { left: 8px; right: 8px; width: auto; top: auto; bottom: 112px; max-height: 46%; padding: 10px; }
  .s3d.eyeview .s3d-data { top: auto; }
  .s3d-data-body { display: grid; grid-template-columns: 44% 1fr; gap: 10px; align-items: start; }
  .s3d-curve-col { margin-top: 0; padding-top: 0; border-top: 0; }
  .s3d-pad-note { display: none; }
  .s3d.eyeview .s3d-hero [data-k="theta"] { font-size: 40px; }
  .s3d.eyeview .s3d-scene { font-size: 15px; }
  .s3d.eyeview .s3d-stats { font-size: 15px; gap: 14px; }
  .s3d-inset-cap, .s3d.eyeview .s3d-inset-cap { font-size: 11.5px; white-space: nowrap; flex-direction: column; gap: 0; }
  .s3d-hud { left: 14px; top: 12px; }
  .s3d-hero [data-k="theta"] { font-size: 34px; }
  .s3d-note { display: none; }
  .s3d-bar { bottom: 10px; border-radius: 14px; }
  .s3d-div { display: none; }
  .s3d-seg button { padding: 7px 9px; }
}
`;
