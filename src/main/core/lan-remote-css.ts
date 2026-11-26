/**
 * Стили веб-приложения «Пульт LAZEYKA» (lan-remote-page.ts). Без внешних ресурсов; анимации — только transform/opacity,
 * при prefers-reduced-motion выключаются. Тема — по системе или по выбору на вкладке «Ещё» (html[data-theme]).
 */
export const SHELL_CSS = String.raw`
:root{color-scheme:dark;--bg:#0a0c0f;--bg2:#0d1014;--s1:#12161b;--s2:#181d23;--s3:#1f252c;--bd:rgba(255,255,255,.07);--bd2:rgba(255,255,255,.12);
--fg:#ecf1f5;--mu:#8d97a4;--mu2:#5f6874;--ac:#4ce896;--acf:#3fdc8a;--aci:#04140b;--acs:rgba(76,232,150,.13);--acg:rgba(76,232,150,.28);
--wr:#f4b860;--wrs:rgba(244,184,96,.13);--er:#ff7f7f;--ers:rgba(255,127,127,.13);--tg:#2aabee;--sh:0 10px 30px rgba(0,0,0,.45);--sh2:0 1px 0 rgba(255,255,255,.04) inset;
--r:22px;--ease:cubic-bezier(.2,.8,.2,1)}
html[data-theme=light]{color-scheme:light;--bg:#f1f3f5;--bg2:#e9edf0;--s1:#ffffff;--s2:#f3f5f7;--s3:#e8ecef;--bd:rgba(12,22,32,.08);--bd2:rgba(12,22,32,.14);
--fg:#11161c;--mu:#5d6876;--mu2:#97a1ad;--ac:#0f9f5c;--acf:#14b86b;--aci:#ffffff;--acs:rgba(20,184,107,.12);--acg:rgba(20,184,107,.25);
--wr:#b26b00;--wrs:rgba(214,138,20,.13);--er:#cf3c3c;--ers:rgba(207,60,60,.1);--sh:0 10px 30px rgba(20,30,45,.14);--sh2:0 1px 0 rgba(255,255,255,.6) inset}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{-webkit-text-size-adjust:100%;background:var(--bg);overscroll-behavior-y:contain}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,sans-serif;letter-spacing:-.005em;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
svg{display:block}
.hide{display:none!important}
.mono{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0}

/* ---- Шапка ---- */
.top{position:sticky;top:0;z-index:20;padding:calc(env(safe-area-inset-top) + 10px) calc(16px + env(safe-area-inset-right)) 10px calc(16px + env(safe-area-inset-left));
display:flex;align-items:center;gap:12px;background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(18px);backdrop-filter:saturate(1.6) blur(18px);border-bottom:1px solid transparent;transition:border-color .2s}
.top.scrolled{border-bottom-color:var(--bd)}
@supports not (background:color-mix(in srgb,red,blue)){.top{background:var(--bg)}}
.logo{flex:none;width:38px;height:38px;border-radius:11px;box-shadow:0 4px 14px rgba(31,216,115,.18)}
.ttl{flex:1;min-width:0}
.ttl b{display:block;font-size:18px;font-weight:700;letter-spacing:.04em;line-height:1.1}
.ttl small{display:block;font-size:13px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.conn{flex:none;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;background:var(--s1);border:1px solid var(--bd);font-size:13px;font-weight:600;color:var(--mu);font-variant-numeric:tabular-nums}
.conn i{width:8px;height:8px;border-radius:50%;background:var(--mu2)}
.conn[data-q=good] i{background:var(--ac);box-shadow:0 0 0 3px var(--acs)}.conn[data-q=good]{color:var(--fg)}
.conn[data-q=mid] i{background:var(--wr)}.conn[data-q=bad] i,.conn[data-q=off] i{background:var(--er)}.conn[data-q=off]{color:var(--er)}
.icbtn{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--mu);background:var(--s1);border:1px solid var(--bd);transition:transform .15s var(--ease)}
.icbtn:active{transform:scale(.92)}
.icbtn svg{width:20px;height:20px}
.icbtn.spin svg{animation:rot .8s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}

/* ---- Основная область и вкладки ---- */
main{max-width:1040px;margin:0 auto;padding:6px calc(16px + env(safe-area-inset-right)) calc(96px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
body.guest main{padding-bottom:calc(32px + env(safe-area-inset-bottom))}
.view{display:none}
.view.on{display:block;animation:vin .28s var(--ease)}
@keyframes vin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;justify-content:center;padding:6px calc(10px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));
background:color-mix(in srgb,var(--bg2) 86%,transparent);-webkit-backdrop-filter:saturate(1.6) blur(20px);backdrop-filter:saturate(1.6) blur(20px);border-top:1px solid var(--bd)}
@supports not (background:color-mix(in srgb,red,blue)){.tabbar{background:var(--bg2)}}
body.guest .tabbar{display:none}
.tabbar .in{display:flex;width:100%;max-width:520px}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:52px;padding:6px 4px 4px;border-radius:14px;color:var(--mu2);font-size:11.5px;font-weight:600;letter-spacing:.01em;transition:color .2s}
.tab svg{width:25px;height:25px;transition:transform .25s var(--ease)}
.tab .tp{position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:30px;border-radius:999px;transition:background .25s}
.tab.on{color:var(--ac)}.tab.on .tp{background:var(--acs)}
.tab:active svg{transform:scale(.88)}

h2.sec{display:flex;align-items:center;justify-content:space-between;margin:24px 4px 10px;font-size:15px;font-weight:700;color:var(--fg);letter-spacing:0}
h2.sec span{text-transform:none;letter-spacing:0;font-weight:500;color:var(--mu2)}
.card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);padding:16px;box-shadow:var(--sh2)}
.card+.card{margin-top:12px}
.muted{color:var(--mu)}.small{font-size:14px;line-height:1.5}

/* ---- Главный статус ---- */
.hero{position:relative;overflow:hidden;display:flex;align-items:center;gap:16px;margin-top:6px;padding:20px 18px;border-radius:26px;background:var(--s1);border:1px solid var(--bd);box-shadow:var(--sh2)}
.hero::before{content:"";position:absolute;inset:-40% -20% auto auto;width:260px;height:260px;border-radius:50%;background:radial-gradient(closest-side,var(--acg),transparent);opacity:0;transform:scale(.7);transition:opacity .5s,transform .6s var(--ease);pointer-events:none}
.hero[data-tone=on]::before{opacity:1;transform:none}
.hero-ic{position:relative;flex:none;width:58px;height:58px;border-radius:18px;display:flex;align-items:center;justify-content:center;background:var(--s3);color:var(--mu);transition:background .3s,color .3s}
.hero-ic svg{width:30px;height:30px}
.hero[data-tone=on] .hero-ic{background:var(--ac);color:var(--aci)}
.hero[data-tone=busy] .hero-ic{background:var(--wrs);color:var(--wr)}
.hero[data-tone=offline] .hero-ic{background:var(--ers);color:var(--er)}
.hero-tx{position:relative;min-width:0;flex:1}
.hero-t{font-size:21px;font-weight:700;letter-spacing:-.015em;line-height:1.2}
.hero[data-tone=on] .hero-t{color:var(--ac)}
.hero-s{margin-top:4px;font-size:14.5px;color:var(--mu);line-height:1.35}
.hero .retry{position:relative;margin-left:auto}

/* ---- Проверка сети ---- */
.net-card{margin-top:20px;padding:16px;display:grid;gap:10px;border:1px solid var(--bd2);border-radius:var(--r);background:var(--s1);box-shadow:var(--sh2)}
.net-head,.net-proxy,.net-step{display:flex;align-items:center;gap:12px;min-width:0}
.net-icon,.net-step-icon,.net-result-icon{display:grid;place-items:center;flex:none;color:var(--ac);background:var(--acs);border-radius:12px}
.net-icon,.net-step-icon{width:40px;height:40px}.net-icon svg,.net-step-icon svg{width:22px;height:22px}
.net-heading,.net-proxy-text,.net-step-text{flex:1;min-width:0}
.net-title{font-size:18px;line-height:1.2;margin:0}
.net-heading p,.net-foot,.net-message,.setup-check p{margin:4px 0 0;color:var(--mu);font-size:13px;line-height:1.4}
.net-proxy,.net-step{padding:10px 12px;border:1px solid var(--bd);border-radius:15px;background:var(--s2)}
.net-proxy b,.net-step b,.net-result b{display:block;font-size:14px;line-height:1.25}
.net-status,.net-step small,.net-result small{display:block;margin-top:3px;color:var(--mu);font-size:12.5px;overflow-wrap:anywhere}
.net-status[data-on=true]{color:var(--ac)}
.net-step{text-align:left;width:100%;color:var(--fg);min-height:54px}
.net-step:disabled{opacity:.65;cursor:default}
.net-step>.chev{color:var(--mu)}.net-step>.chev svg{width:16px;height:16px}
.net-setup{justify-self:start;min-height:38px;color:var(--ac);font-size:13px;text-align:left}
.net-results{display:grid;gap:8px}
.net-result{display:flex;align-items:center;gap:9px;padding:9px;background:var(--s2);border:1px solid var(--bd);border-radius:12px}
.net-result-icon{width:28px;height:28px;border-radius:8px}.net-result-icon svg{width:16px;height:16px}
.net-result[data-ok=false] .net-result-icon{color:var(--er);background:var(--ers)}
.net-message.error{color:var(--er)}
.net-message.success{color:var(--ac)}
.setup-check{margin-top:12px}.setup-check .btn{margin-top:10px}
@media (max-width:380px){.net-card{padding:12px}.net-proxy,.net-step{gap:8px;padding:9px}.net-proxy .btn{padding-inline:10px}}

/* ---- Сценарии (быстрые) ---- */
.chips{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x proximity;margin:0 -16px;padding:2px 16px 4px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;scroll-snap-align:start;display:flex;align-items:center;gap:10px;min-height:56px;max-width:240px;padding:8px 16px 8px 8px;border-radius:18px;background:var(--s1);border:1px solid var(--bd);font-weight:600;font-size:15.5px;transition:transform .15s var(--ease),background .2s}
.chip:active{transform:scale(.95)}
.chip .em{flex:none;width:40px;height:40px;border-radius:13px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}
.chip .em img{width:26px;height:26px;border-radius:6px}
.chip .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip.busy .em{background:var(--acs)}
.chip.busy .em>*{opacity:0}
.chip.busy .em{position:relative}
.chip.busy .em::after{content:"";position:absolute;width:20px;height:20px;border-radius:50%;border:2.5px solid var(--acs);border-top-color:var(--ac);animation:rot .8s linear infinite}
.chip[disabled]{opacity:.5}

/* ---- Плитки ---- */
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:600px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:900px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tile{position:relative;display:flex;flex-direction:column;align-items:stretch;text-align:left;min-height:140px;padding:14px 14px 14px;border-radius:var(--r);background:var(--s1);border:1px solid var(--bd);box-shadow:var(--sh2);
-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation;overflow:hidden;transition:transform .18s var(--ease),border-color .25s,background-color .25s}
.tile::before{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(155deg,var(--acs),transparent 62%);opacity:0;transition:opacity .35s;pointer-events:none}
.tile.on{border-color:color-mix(in srgb,var(--ac) 45%,transparent)}
.tile.on::before{opacity:1}
.tile:active,.tile.press{transform:scale(.965)}
.tile[aria-disabled=true]{opacity:.55}
.t-top{position:relative;display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:auto}
.t-ic{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:var(--s3);color:var(--mu);transition:background .25s,color .25s}
.t-ic svg{width:24px;height:24px}
.tile.on .t-ic{background:var(--ac);color:var(--aci)}
.tile[data-k=tg].on .t-ic{background:var(--tg);color:#fff}
.sw{position:relative;flex:none;width:50px;height:30px;border-radius:999px;background:var(--s3);border:1px solid var(--bd);transition:background .25s,border-color .25s}
.sw i{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);transition:transform .28s var(--ease)}
html[data-theme=light] .sw{background:#d9dfe4}
.tile.on .sw{background:var(--acf);border-color:transparent}
.tile.on .sw i{transform:translateX(20px)}
.tile.busy .sw i::after{content:"";position:absolute;inset:4px;border-radius:50%;border:2.5px solid rgba(0,0,0,.12);border-top-color:#1a1f24;animation:rot .75s linear infinite}
.tile.busy.want-on .sw i{transform:translateX(10px)}
.tile.busy.want-off .sw i{transform:translateX(10px)}
.t-name{position:relative;margin-top:14px;font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.2}
.t-st{position:relative;margin-top:3px;font-size:14px;line-height:1.3;color:var(--mu);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tile.on .t-st{color:var(--ac)}
.tile.busy .t-st{color:var(--wr)}
.tile.err{border-color:color-mix(in srgb,var(--er) 55%,transparent)}
.tile.err .t-st{color:var(--er)}
.t-sub{position:relative;margin-top:2px;font-size:12.5px;color:var(--mu2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-act{position:relative;align-self:flex-start;margin-top:10px;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:var(--ers);color:var(--er);font-size:13.5px;font-weight:700}
.tile.flash{animation:flash .5s var(--ease)}
@keyframes flash{40%{transform:scale(1.025)}}

.duo{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:10px 16px;border-radius:16px;background:var(--s1);border:1px solid var(--bd);font-weight:650;font-size:15.5px;text-decoration:none;color:var(--fg);transition:transform .15s var(--ease),opacity .2s;text-align:center}
.btn:active{transform:scale(.96)}
.btn svg{width:19px;height:19px;flex:none}
.btn.pri{background:var(--ac);border-color:transparent;color:var(--aci)}
.btn.tgb{background:var(--tg);border-color:transparent;color:#fff}
.btn.dng{color:var(--er)}
.btn[disabled]{opacity:.45;pointer-events:none}
.btn.sm{min-height:40px;border-radius:13px;font-size:14.5px;padding:8px 14px}

/* ---- Строки-списки ---- */
.list{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh2)}
.row{display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:12px 14px;text-align:left;border-top:1px solid var(--bd);transition:background .15s}
.row:first-child{border-top:0}
button.row:active{background:var(--s2)}
.row .ri{flex:none;width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--s3);color:var(--mu)}
.row .ri svg{width:20px;height:20px}
.row .rt{flex:1;min-width:0}
.row .rt b{display:block;font-weight:600;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .rt small{display:block;color:var(--mu);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.row .rv{flex:none;max-width:45%;color:var(--mu);font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .chev{flex:none;width:18px;height:18px;color:var(--mu2)}
.hint{margin:10px 6px 0;font-size:13px;color:var(--mu2);line-height:1.45}

/* ---- Плашки событий ---- */
#toasts{position:fixed;z-index:80;left:0;right:0;top:calc(env(safe-area-inset-top) + 64px);display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 12px;pointer-events:none}
.toast{pointer-events:auto;display:flex;align-items:center;gap:12px;width:100%;max-width:480px;padding:12px 14px;border-radius:18px;background:var(--s2);border:1px solid var(--bd2);box-shadow:var(--sh);font-size:15px;line-height:1.35;
transform:translateY(-14px) scale(.97);opacity:0;transition:transform .32s var(--ease),opacity .25s}
.toast.in{transform:none;opacity:1}
.toast .ti{flex:none;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--s3);color:var(--mu)}
.toast .ti svg{width:18px;height:18px}
.toast[data-tone=ok] .ti{background:var(--acs);color:var(--ac)}
.toast[data-tone=err] .ti{background:var(--ers);color:var(--er)}
.toast[data-tone=warn] .ti{background:var(--wrs);color:var(--wr)}

/* ---- Нет связи / доступ закрыт ---- */
.banner{display:flex;gap:12px;align-items:flex-start;margin-top:12px;padding:14px;border-radius:18px;background:var(--ers);color:var(--fg);font-size:14.5px;line-height:1.45}
.banner svg{flex:none;width:22px;height:22px;color:var(--er);margin-top:1px}
.banner b{display:block;color:var(--er);font-size:15.5px;margin-bottom:2px}
.closed{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px 8px}
.closed .big{width:76px;height:76px;border-radius:24px;display:flex;align-items:center;justify-content:center;background:var(--s1);border:1px solid var(--bd);color:var(--mu);margin-bottom:18px}
.closed .big svg{width:36px;height:36px}
.closed h1{margin:0 0 8px;font-size:23px;letter-spacing:-.02em}
.closed p{margin:0 0 6px;color:var(--mu);max-width:360px;font-size:15px}
.closed .btn{margin-top:18px;min-width:220px}
.invite{display:flex;gap:14px;align-items:center;margin-top:6px;padding:16px;border-radius:var(--r);background:linear-gradient(150deg,var(--acs),var(--s1) 70%);border:1px solid color-mix(in srgb,var(--ac) 30%,transparent)}
.invite .qr{flex:none;width:48px;height:48px;border-radius:15px;background:var(--ac);color:var(--aci);display:flex;align-items:center;justify-content:center}
.invite .qr svg{width:26px;height:26px}
.invite b{display:block;font-size:16px;margin-bottom:2px}
.invite p{margin:0;color:var(--mu);font-size:14px;line-height:1.4}

/* ---- Подключение ---- */
.addr{display:flex;align-items:center;gap:12px;padding:6px 0}
.addr+.addr{border-top:1px solid var(--bd);padding-top:12px;margin-top:6px}
.addr .l{font-size:12.5px;color:var(--mu);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.addr .v{font-size:clamp(19px,6vw,26px);font-weight:700;line-height:1.2;white-space:nowrap;margin-top:2px}
.addr>div{flex:1;min-width:0}
.cp span{display:none}@media (min-width:430px){.cp span{display:inline}}
.cp{flex:none;justify-content:center;min-width:44px;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:13px;background:var(--s2);border:1px solid var(--bd);font-size:14px;font-weight:650;transition:transform .15s var(--ease)}
.cp:active{transform:scale(.94)}.cp svg{width:16px;height:16px}
.cp.done{color:var(--ac)}
.tgh{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.tgh .tgi{flex:none;width:44px;height:44px}
.tgh b{font-size:17px}
.stack{display:grid;gap:10px;margin-top:14px}
.seg{display:flex;gap:6px;padding:4px;border-radius:16px;background:var(--s1);border:1px solid var(--bd);overflow-x:auto;scrollbar-width:none}
.seg::-webkit-scrollbar{display:none}
.seg button{flex:1 0 auto;min-height:40px;padding:0 14px;border-radius:12px;font-size:14.5px;font-weight:600;color:var(--mu);white-space:nowrap;transition:background .2s,color .2s}
.seg button.on{background:var(--s3);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.guide{margin-top:12px}
.guide ol{margin:0;padding:0;list-style:none;counter-reset:st}
.guide li{position:relative;counter-increment:st;padding:2px 0 14px 42px;font-size:15px;line-height:1.45}
.guide li::before{content:counter(st);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:9px;background:var(--acs);color:var(--ac);font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center}
.guide li:last-child{padding-bottom:4px}
.note{margin-top:10px;padding:12px 14px;border-radius:14px;background:var(--s2);font-size:14px;color:var(--mu);line-height:1.5}
.note.warn{background:var(--wrs);color:var(--fg)}
.note.warn b{color:var(--wr)}
details.more{margin-top:12px;background:var(--s1);border:1px solid var(--bd);border-radius:18px;padding:0 16px}
details.more summary{display:flex;align-items:center;justify-content:space-between;min-height:54px;font-weight:600;cursor:pointer;list-style:none}
details.more summary::-webkit-details-marker{display:none}
details.more summary svg{width:18px;height:18px;color:var(--mu2);transition:transform .2s}
details.more[open] summary svg{transform:rotate(90deg)}
details.more p{margin:0 0 14px;font-size:14px;color:var(--mu);line-height:1.5}

/* ---- Ещё ---- */
.inst{position:relative;overflow:hidden}
.inst .ih{display:flex;gap:14px;align-items:center}
.inst .ih img{flex:none;width:56px;height:56px;border-radius:15px;box-shadow:0 6px 18px rgba(31,216,115,.2)}
.inst .ih b{display:block;font-size:17px}
.inst .ih p{margin:2px 0 0;font-size:14px;color:var(--mu)}
.glyph{display:inline-flex;vertical-align:-4px;width:22px;height:22px;border-radius:6px;background:var(--s3);align-items:center;justify-content:center;color:var(--tg);margin:0 2px}
.glyph svg{width:15px;height:15px}
.swrow{display:flex;align-items:center;gap:12px;min-height:56px}
.swrow .ri{flex:none;width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--acs);color:var(--ac)}.swrow .ri svg{width:20px;height:20px}
.row.dng b,.row.dng .ri{color:var(--er)}
.swrow .rt{flex:1}
.swrow .rt b{display:block;font-weight:600}
.swrow .rt small{display:block;color:var(--mu);font-size:13.5px}
.tg-sw{position:relative;flex:none;width:50px;height:30px;border-radius:999px;background:var(--s3);border:1px solid var(--bd);transition:background .25s}
.tg-sw i{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);transition:transform .25s var(--ease)}
.tg-sw[aria-checked=true]{background:var(--acf);border-color:transparent}
.tg-sw[aria-checked=true] i{transform:translateX(20px)}
html[data-theme=light] .tg-sw{background:#d9dfe4}
html[data-theme=light] .tg-sw[aria-checked=true]{background:var(--acf)}
.foot{margin:28px 0 8px;text-align:center;font-size:12.5px;color:var(--mu2)}

/* ---- Нижние листы ---- */
.scrim{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);opacity:0;transition:opacity .25s}
.scrim.in{opacity:1}
.sheet{position:fixed;z-index:71;left:0;right:0;bottom:0;margin:0 auto;max-width:620px;max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;background:var(--bg2);border-radius:26px 26px 0 0;border:1px solid var(--bd2);border-bottom:0;box-shadow:var(--sh);
transform:translateY(102%);transition:transform .34s var(--ease);padding-bottom:env(safe-area-inset-bottom)}
.sheet.in{transform:none}
.sheet .grab{width:40px;height:5px;border-radius:3px;background:var(--bd2);margin:8px auto 2px}
.sheet .sh{display:flex;align-items:center;gap:10px;padding:6px 16px 10px}
.sheet .sh b{flex:1;font-size:19px;letter-spacing:-.015em}
.sheet .sb{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px 18px;overscroll-behavior:contain}
.search{display:flex;align-items:center;gap:8px;height:46px;padding:0 14px;border-radius:14px;background:var(--s1);border:1px solid var(--bd);margin-bottom:12px}
.search svg{width:18px;height:18px;color:var(--mu2);flex:none}
.search input{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:16px;outline:none}
.grp{margin:16px 4px 8px;font-size:12.5px;font-weight:700;color:var(--mu);text-transform:uppercase;letter-spacing:.07em}
.grp:first-child{margin-top:4px}
.node .chk{flex:none;width:22px;height:22px;color:var(--ac);opacity:0}
.node.sel .chk{opacity:1}
.node.sel b{color:var(--ac)}
.ping{flex:none;min-width:58px;height:26px;padding:0 9px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;background:var(--s3);color:var(--mu)}
.ping[data-q=good]{background:var(--acs);color:var(--ac)}
.ping[data-q=mid]{background:var(--wrs);color:var(--wr)}
.ping[data-q=bad]{background:var(--ers);color:var(--er)}
.badge{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:7px;background:var(--s3);color:var(--mu);font-size:11.5px;font-weight:700;margin-left:6px;vertical-align:1px}
.badge.ac{background:var(--acs);color:var(--ac)}
.spin{width:20px;height:20px;border-radius:50%;border:2.5px solid var(--bd2);border-top-color:var(--ac);animation:rot .8s linear infinite;flex:none}
.empty{padding:22px 16px;text-align:center;color:var(--mu);font-size:14.5px}
.kv{display:flex;justify-content:space-between;gap:16px;padding:12px 2px;border-top:1px solid var(--bd);font-size:15px}
.kv:first-child{border-top:0}
.kv span{color:var(--mu)}
.kv b{font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere}
.cur{display:flex;align-items:center;gap:12px;padding:14px;border-radius:18px;background:var(--s1);border:1px solid var(--bd);margin-bottom:12px}
.cur .ri{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--acs);color:var(--ac)}
.cur .ri svg{width:22px;height:22px}
.cur small{display:block;color:var(--mu);font-size:13px}
.cur b{display:block;font-size:16.5px}

/* ---- Лист серверов: обновить подписки, проверить пинг, порядок ---- */
.tools{margin:0 0 10px}
.tools .duo{margin-top:0}
.scope{display:flex;align-items:center;gap:10px;height:44px;padding:0 6px 0 14px;margin-bottom:8px;border-radius:14px;background:var(--s1);border:1px solid var(--bd);font-size:14px;color:var(--mu)}
.scope span{flex:none;font-weight:600}
.scope select{flex:1;min-width:0;height:100%;border:0;background:none;color:var(--fg);font:inherit;font-size:15px;font-weight:600;outline:none;-webkit-appearance:none;appearance:none;padding-right:22px;
background-image:linear-gradient(45deg,transparent 50%,var(--mu) 50%),linear-gradient(135deg,var(--mu) 50%,transparent 50%);background-position:calc(100% - 12px) 52%,calc(100% - 7px) 52%;background-size:5px 5px;background-repeat:no-repeat}
.scope select option{color:#11161c}
.tools .btn.dng{border-color:color-mix(in srgb,var(--er) 45%,transparent)}
.jt{display:flex;flex-direction:column;min-width:0}
.jt small{font-size:12.5px;font-weight:500;color:var(--mu)}
.tools .btn{font-size:13.5px;padding:8px 8px;gap:6px;white-space:nowrap}
.tools .btn svg{width:17px;height:17px}
.job{margin:0 0 10px;padding:12px 14px;border-radius:16px;background:var(--s1);border:1px solid var(--bd);font-size:14px;font-weight:600}
.job[data-tone=ok]{background:var(--acs);border-color:transparent}
.job[data-tone=err]{background:var(--ers);border-color:transparent}
.job[data-tone=stop]{background:var(--wrs);border-color:transparent}.job[data-tone=stop] .ji{color:var(--wr)}
.jh{display:flex;align-items:center;gap:10px}
.jh .spin{width:18px;height:18px}
.ji{flex:none;width:20px;height:20px;display:flex}.ji svg{width:20px;height:20px}
.job[data-tone=ok] .ji{color:var(--ac)}.job[data-tone=err] .ji{color:var(--er)}
.bar{position:relative;height:6px;margin-top:10px;border-radius:999px;background:var(--s3);overflow:hidden}
.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:var(--ac);transition:width .4s var(--ease)}
.bar.ind i{width:35%;animation:ind 1.3s var(--ease) infinite}
@keyframes ind{from{transform:translateX(-100%)}to{transform:translateX(290%)}}
.sortseg{margin:0 0 4px}
.sortseg button{min-height:36px;font-size:14px}

/* ---- Потянуть для обновления ---- */
#ptr{position:fixed;z-index:19;left:50%;top:calc(env(safe-area-inset-top) + 62px);width:38px;height:38px;margin-left:-19px;border-radius:50%;background:var(--s2);border:1px solid var(--bd2);box-shadow:var(--sh);display:flex;align-items:center;justify-content:center;color:var(--ac);opacity:0;transform:translateY(-30px);pointer-events:none}
#ptr svg{width:20px;height:20px}
#ptr.go svg{animation:rot .8s linear infinite}

@media (display-mode:standalone){html[data-theme=light] .top::before{content:"";position:absolute;left:0;right:0;top:0;height:env(safe-area-inset-top);background:#0a0c0f}}
@media (min-width:700px){.hero{padding:24px}.hero-t{font-size:24px}}
@media (orientation:landscape) and (max-height:500px){.top{padding-top:calc(env(safe-area-inset-top) + 6px);padding-bottom:6px}.tab{flex-direction:row;justify-content:center;min-height:40px;gap:6px;font-size:13px}.tab .tp{width:auto;height:30px;padding:0 10px}.tab svg{width:21px;height:21px}main{padding-bottom:calc(64px + env(safe-area-inset-bottom))}.grid{grid-template-columns:repeat(4,minmax(0,1fr))}h2.sec{margin-top:16px}.tile{min-height:132px}.hero{padding:14px 16px}.hero-ic{width:48px;height:48px;border-radius:15px}#toasts{top:calc(env(safe-area-inset-top) + 56px)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`
