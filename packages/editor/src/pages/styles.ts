// The page editor's own styles (outline, frame, panel groups and lists), in the chrome's --ms-* tokens. Injected
// once by mountPageEditor, so the pages folder needs nothing from the shell's stylesheets beyond the tokens.
export const PAGE_CSS = `
.msp{position:relative;display:grid;grid-template-columns:264px minmax(0,1fr);height:100%;min-height:0;background:var(--ms-bg)}
.msp.is-outline-hidden{grid-template-columns:0 minmax(0,1fr)}
.msp.is-outline-hidden .msp-side{visibility:hidden}
.msp-side{min-height:0;overflow:auto;border-right:1px solid var(--ms-line);background:var(--ms-chrome);scrollbar-width:thin;font:13px/1.45 var(--ms-sans);color:var(--ms-text)}
.msp-side__toggle{position:absolute;left:8px;bottom:12px;z-index:2;background:var(--ms-paper);border:1px solid var(--ms-line)}
.msp-stage{position:relative;display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;padding:10px 14px 14px}
.msp-stage:focus{outline:none}
.msp-note{margin:0 0 8px;color:var(--ms-muted);font:12px var(--ms-sans)}
.msp-frame{width:100%;height:100%;border:1px solid var(--ms-line);border-radius:10px;background:#fff;box-shadow:0 1px 3px rgba(20,24,31,.06)}
.msp-wait{position:absolute;inset:0;z-index:1;display:grid;place-items:center;pointer-events:none}
.msp-wait[hidden]{display:none}
.msp-wait__box{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:36ch;padding:18px 22px;border:1px solid var(--ms-line);border-radius:12px;background:var(--ms-paper);color:var(--ms-text);font:13px/1.5 var(--ms-sans);text-align:center;box-shadow:0 4px 16px rgba(20,24,31,.08);pointer-events:auto}
.msp-wait__text{margin:0;color:var(--ms-muted)}
.msp-wait__spin{width:18px;height:18px;border:2px solid var(--ms-line);border-top-color:var(--ms-accent);border-radius:50%;animation:msp-spin .8s linear infinite}
@keyframes msp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.msp-wait__spin{animation:none}}
.msp-outline__title{margin:0;padding:16px 16px 6px;color:var(--ms-muted);font:600 12px var(--ms-sans)}
.msp-outline__list,.msp-outline__slot{padding:0 8px}
.msp-outline__end{padding:6px 8px 56px}
.msp-outline__add{display:flex;width:100%;justify-content:center}
.msp-outline .ms-order__row{min-height:0;padding:0 2px}
.msp-sec-wrap{flex:1;min-width:0}
.msp-sec{position:relative;display:flex;align-items:center;border-radius:8px}
.msp-sec:hover,.msp-sec:focus-within{background:var(--ms-accent-tint)}
.msp-sec.is-selected{background:var(--ms-accent-tint);box-shadow:inset 3px 0 0 var(--ms-accent)}
.msp-sec__main{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:6px 8px;border:0;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer;border-radius:8px}
.msp-sec__main:focus-visible{outline:2px solid var(--ms-accent);outline-offset:-2px}
.msp-sec__pic{flex:none}
.msp-sec__pic svg{display:block;width:54px;height:36px}
.msp-sec__txt{display:grid;min-width:0}
.msp-sec__kind{color:var(--ms-muted);font-size:11px}
.msp-sec__title{overflow:hidden;font-size:12.5px;font-weight:500;white-space:nowrap;text-overflow:ellipsis}
.msp-sec__tools{position:absolute;right:4px;top:50%;display:flex;gap:1px;padding:2px;border-radius:7px;background:var(--ms-paper);box-shadow:0 1px 4px rgba(20,24,31,.12);transform:translateY(-50%);opacity:0;pointer-events:none}
.msp-sec:hover .msp-sec__tools,.msp-sec:focus-within .msp-sec__tools{opacity:1;pointer-events:auto}
.msp-sec__tools .ms-iconbtn{width:24px;height:24px}
.msp-picker{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;padding:8px;border:1px solid var(--ms-line);border-radius:10px;background:var(--ms-paper)}
.msp-picker__kind{display:grid;justify-items:center;gap:3px;padding:6px 4px;border:1px solid transparent;border-radius:8px;background:none;font:11.5px var(--ms-sans);color:var(--ms-text);cursor:pointer}
.msp-picker__kind:hover,.msp-picker__kind:focus-visible{border-color:var(--ms-accent);background:var(--ms-accent-tint);outline:0}
.msp-picker__pic svg{display:block;width:72px;height:48px}
.msp-picker__none{grid-column:1/-1;margin:0;color:var(--ms-muted);font-size:12px}
.msp-picker__lib{display:grid;grid-template-columns:subgrid;grid-column:1/-1;gap:6px;padding-top:6px;border-top:1px solid var(--ms-line)}
.msp-picker__group{grid-column:1/-1;margin:0;color:var(--ms-muted);font:600 12px var(--ms-sans)}
.msp-picker__pic img{display:block;width:72px;height:48px;object-fit:cover;border-radius:4px}
.msp-picker__name{text-align:center}
.msp-picker__synced{display:block;color:var(--ms-accent-deep);font-size:10.5px;font-weight:600}
.msp-picker__kind[draggable=true]{cursor:grab}
.msp-outline{position:relative}
.msp-libdrop{position:absolute;left:8px;right:8px;z-index:4;height:3px;border-radius:2px;background:var(--ms-accent);box-shadow:0 0 0 2px var(--ms-accent-tint);pointer-events:none}
.msp-picker__libitem{display:grid;align-content:start;gap:2px}
.msp-picker__places{justify-self:center;padding:2px 8px;border:0;border-radius:6px;background:none;color:var(--ms-accent-deep);font:500 11px var(--ms-sans);cursor:pointer}
.msp-picker__places:hover,.msp-picker__places[aria-expanded=true]{background:var(--ms-accent-tint)}
.msp-picker__places:focus-visible{outline:2px solid var(--ms-accent);outline-offset:1px}
.msp-places{display:grid;grid-column:1/-1;gap:2px;padding:6px;border:1px solid var(--ms-line-2);border-radius:8px;background:var(--ms-bg)}
.msp-places__at{padding:6px 8px;border:0;border-radius:6px;background:none;color:var(--ms-text);font:12px/1.4 var(--ms-sans);text-align:left;cursor:pointer}
.msp-places__at:hover,.msp-places__at:focus-visible{background:var(--ms-accent-tint);outline:0;box-shadow:inset 0 0 0 1px var(--ms-accent)}
.msp-places__at[aria-disabled=true]{color:var(--ms-faint);cursor:not-allowed;background:none;box-shadow:none}
.msp-places__locked,.msp-places__why{margin:0;padding:4px 8px;border-left:2px solid var(--ms-warn-line);color:var(--ms-warn-ink);font:11.5px/1.45 var(--ms-sans)}
.msp-places__why{border-radius:6px;background:var(--ms-warn-tint)}
.msp-dropsheet{position:absolute;z-index:5;overflow:hidden;border-radius:9px;box-shadow:inset 0 0 0 2px var(--ms-accent-tint)}
.msp-dropsheet__line{position:absolute;left:16px;right:16px;height:3px;border-radius:2px;background:var(--ms-accent);box-shadow:0 0 0 3px var(--ms-accent-tint);pointer-events:none}
.msp-dropsheet__tag{position:absolute;left:0;bottom:8px;max-width:100%;overflow:hidden;padding:3px 9px;border-radius:999px;background:var(--ms-accent);color:#fff;font:600 12px/1.4 var(--ms-sans);white-space:nowrap;text-overflow:ellipsis;box-shadow:var(--ms-shadow)}
.msp-dropsheet__line.is-low .msp-dropsheet__tag{top:9px;bottom:auto}
.msp-dropsheet__no{position:absolute;left:0;right:0;display:grid;place-items:center;padding:12px 32px;background:repeating-linear-gradient(135deg,var(--ms-warn-tint) 0 10px,var(--ms-warn-tint-2) 10px 20px);box-shadow:inset 0 0 0 2px var(--ms-warn-line);color:var(--ms-warn-ink);font:600 13px/1.5 var(--ms-sans);text-align:center;pointer-events:none}
.msp-dropsheet__why{max-width:62ch;padding:8px 14px;border:1px solid var(--ms-warn-line);border-radius:8px;background:var(--ms-paper);box-shadow:var(--ms-shadow)}
.msp-sec:has(> .msp-sec__synced){flex-wrap:wrap}
.msp-sec:has(> .msp-sec__synced) .msp-sec__main{flex-basis:100%;padding-bottom:2px}
.msp-sec:has(> .msp-sec__synced) .msp-sec__tools{top:24px}
.msp-sec__synced{display:inline-flex;flex:none;align-items:center;gap:4px;height:24px;margin:0 0 6px 8px;padding:0 9px;border:1px solid var(--ms-accent);border-radius:999px;background:var(--ms-paper);color:var(--ms-accent-deep);font:600 11.5px var(--ms-sans);cursor:pointer}
.msp-sec__synced + .ms-padlock{margin-left:6px}
.msp-sec__synced:hover{background:var(--ms-accent-tint)}
.msp-sec__synced:focus-visible{outline:2px solid var(--ms-accent);outline-offset:1px}
.msp-sec__synced svg{display:block}
.msp-synced{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--ms-accent);border-radius:10px;background:var(--ms-accent-tint)}
.msp-synced.is-changed{border-style:dashed}
.msp-synced__text{margin:0;font-size:12.5px;line-height:1.5}
.msp-synced__tools{display:flex;flex-wrap:wrap;gap:6px}
.ms-panel__title:has(.msp-panel__pic){display:flex;align-items:center;gap:8px}
.msp-panel__pic svg{display:block;width:36px;height:24px}
.msp-panel__back{justify-self:start}
.msp-panel__back svg{transform:rotate(-90deg)}
.msp-group{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;min-width:0;margin:0;padding:12px;border:1px solid var(--ms-line);border-radius:10px}
.msp-group__label{padding:0 4px;color:var(--ms-label);font-size:12px;font-weight:600}
.msp-image__thumb{display:grid;place-items:center;min-height:72px;max-height:160px;overflow:hidden;border-radius:8px;background:var(--ms-bg)}
.msp-image__thumb img{display:block;max-width:100%;max-height:160px;object-fit:contain}
.msp-image__none{color:var(--ms-faint);font-size:12px}
.msp-image > .ms-ai__ask{justify-self:start;margin-top:-4px}
.msp-image > .ms-ai__ask[hidden],.msp-image__ai:empty{display:none}
.msp-list{gap:6px}
.msp-list > .ms-btn{justify-self:start}
.msp-list__rows .ms-order__row{align-items:flex-start;padding:0}
.msp-list__rows .ms-order__grip{margin-top:7px}
.msp-list__rows .msp-item{flex:1;min-width:0}
.msp-item{border:1px solid var(--ms-line);border-radius:8px;background:var(--ms-paper)}
.msp-item[open]{border-color:var(--ms-line-2)}
.msp-item__head{display:flex;align-items:center;gap:6px;min-height:34px;padding:2px 4px 2px 8px;list-style:none;cursor:pointer}
.msp-item__head::-webkit-details-marker{display:none}
.msp-item__chev svg{display:block;transform:rotate(-90deg);transition:transform var(--ms-dur) var(--ms-ease)}
.msp-item[open] > .msp-item__head .msp-item__chev svg{transform:none}
.msp-item__title{flex:1;min-width:0;overflow:hidden;font-size:12.5px;white-space:nowrap;text-overflow:ellipsis}
.msp-item__tools{display:flex;gap:1px;opacity:0}
.msp-item__head:hover .msp-item__tools,.msp-item__head:focus-within .msp-item__tools{opacity:1}
.msp-item__tools .ms-iconbtn{width:24px;height:24px}
.msp-item__body{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:4px 10px 12px}
.msp-item__body > .msp-group{padding:0;border:0}
.msp-item__body > .msp-group > .msp-group__label{display:none}
.msp-raw{max-height:200px;overflow:auto;margin:0;padding:8px;border-radius:6px;background:var(--ms-bg);font:11.5px/1.5 var(--ms-mono);white-space:pre-wrap}
.msp-flash{animation:msp-flash 1.4s ease-out}
@keyframes msp-flash{0%{box-shadow:0 0 0 3px rgba(97,97,255,.45);border-radius:8px}100%{box-shadow:0 0 0 3px rgba(97,97,255,0)}}
`;
