/**
 * Поведение веб-приложения «Пульт LAZEYKA» (lan-remote-page.ts). Обычный JS без библиотек и без сети наружу:
 * только запросы к /api/* этого же компьютера. Данные из сети вставляются через textContent.
 *
 * Опрос состояния — только пока страница видна (раз в 3 с, во время действия — раз в секунду), при скрытой странице
 * таймер снимается. Код доступа хранится в localStorage и уходит в заголовке X-LZ-Key.
 */
import { PHONE_PROXY_CHECK_ORIGIN, PHONE_PROXY_CHECK_PATH } from './lan-proxy'

export const SHELL_JS = String.raw`
(function(){
'use strict';
var boot=JSON.parse(document.getElementById('lz-boot').textContent);
var IC=JSON.parse(document.getElementById('lz-icons').textContent);
var LS={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}}};
function $(id){return document.getElementById(id)}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function icon(name){var s=el('span');s.innerHTML=IC[name]||'';return s.firstChild}
function add(p){for(var i=1;i<arguments.length;i++){var c=arguments[i];if(c)p.appendChild(c)}return p}
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
var standalone=matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
var ua=navigator.userAgent||'';
var isIOS=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
var isAndroid=/Android/.test(ua);

var NAMES={zapret:'Zapret',vpn:'VPN',tg:'Telegram',exitlag:'ExitLag'};
var FULL={zapret:'Zapret',vpn:'VPN',tg:'Telegram-прокси',exitlag:'ExitLag'};
var DESC={zapret:'Обход блокировок',vpn:'Весь трафик через сервер',tg:'Прокси для Telegram',exitlag:'VPN только для игр'};
var ORDER=['zapret','vpn','tg','exitlag'];
var S={authed:false,state:null,offline:false,fails:0,rtt:null,tab:null,pending:{},tileErr:{},lastSeq:null,timer:null,stopped:false,loading:false,dns:null,nodes:null,sheet:null,tiles:{},net:{checking:false,toggling:false,rows:null,error:'',route:'',at:0,phone:'idle'}};

// ---- Тема, вибрация ----
function themePref(){return LS.get('lz.theme')||'auto'}
function applyTheme(){
  var t=themePref();var d=t==='auto'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;
  document.documentElement.setAttribute('data-theme',d);
  var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',d==='light'?'#f1f3f5':'#0a0c0f');
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change',applyTheme);
var canVibe=typeof navigator.vibrate==='function';
function vibe(p){if(!canVibe||LS.get('lz.vibe')==='0')return;try{navigator.vibrate(p)}catch(e){}}

// ---- Плашки событий ----
var TONE_IC={ok:'check',err:'alert',warn:'alert',info:'info'};
function toast(text,tone){
  tone=tone||'info';var box=$('toasts');
  while(box.children.length>=3)box.removeChild(box.firstChild);
  var t=el('div','toast');t.setAttribute('data-tone',tone);
  add(t,add(el('span','ti'),icon(TONE_IC[tone]||'info')),el('span',null,text));
  box.appendChild(t);
  requestAnimationFrame(function(){requestAnimationFrame(function(){t.classList.add('in')})});
  var gone=function(){t.classList.remove('in');setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},reduce?0:300)};
  t.onclick=gone;setTimeout(gone,tone==='err'?6000:3800);
}

// ---- Запросы ----
function api(path,body,ms){
  var ctl=typeof AbortController==='function'?new AbortController():null;
  var to=setTimeout(function(){if(ctl)ctl.abort()},ms||12000);
  var headers={};var k=LS.get('lz.k');if(k)headers['X-LZ-Key']=k;
  var o={cache:'no-store',credentials:'same-origin',headers:headers};if(ctl)o.signal=ctl.signal;
  if(body){o.method='POST';headers['Content-Type']='application/json';headers['X-LZ']='1';o.body=JSON.stringify(body)}
  var t0=performance.now();
  return fetch(path,o).then(function(r){
    clearTimeout(to);
    if(path==='/api/state')S.rtt=Math.max(1,Math.round(performance.now()-t0));
    if(r.status===401)return r.json().catch(function(){return{}}).then(function(j){var e=new Error('auth');e.auth=true;e.had=!!j.had;throw e});
    if(r.status===429)throw new Error('Слишком много запросов. Подождите немного.');
    if(r.status===404&&path.indexOf('/api/')===0){var e4=new Error('Пульт выключен в программе на компьютере.');e4.off=true;throw e4}
    if(!r.ok&&r.status!==400)throw new Error('Компьютер ответил ошибкой ('+r.status+').');
    return r.json();
  },function(e){clearTimeout(to);var n=new Error('Нет связи с компьютером');n.net=true;throw n});
}

// ---- Вкладки ----
function setTab(t,save){
  if(!S.authed)t='setup';
  if(t==='setup'&&S.authed&&S.state&&S.state.proxy&&Boolean(S.state.proxy.on)!==boot.hasSetup){
    LS.set('lz.tab','setup');
    location.assign('/setup');
    return;
  }
  S.tab=t;
  ['remote','setup','more','closed'].forEach(function(v){$('v-'+v).classList.toggle('on',v===t)});
  var tabs=document.querySelectorAll('.tab');
  for(var i=0;i<tabs.length;i++){var on=tabs[i].getAttribute('data-tab')===t;tabs[i].classList.toggle('on',on);tabs[i].setAttribute('aria-current',on?'page':'false')}
  $('sub').textContent=t==='setup'?'Подключение устройства':t==='more'?'Ещё':t==='closed'?'Доступ закрыт':'Пульт';
  if(save&&S.authed)LS.set('lz.tab',t);
  window.scrollTo(0,0);
}
document.querySelector('.tabbar').addEventListener('click',function(e){var b=e.target.closest('.tab');if(b){vibe(8);setTab(b.getAttribute('data-tab'),true)}});
window.addEventListener('scroll',function(){$('top').classList.toggle('scrolled',window.scrollY>4)},{passive:true});

// ---- «Подключение»: копирование и инструкции ----
function copy(t){
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(t);
  return new Promise(function(ok,no){var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.className='hide';document.body.appendChild(a);a.className='';a.select();
    try{document.execCommand('copy')?ok():no()}catch(e){no()}document.body.removeChild(a)});
}
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;
  var s=b.querySelector('span');var old=s?s.textContent:'';
  copy(b.getAttribute('data-copy')).then(function(){vibe(10);b.classList.add('done');if(s)s.textContent='Скопировано';toast('Скопировано: '+b.getAttribute('data-copy'),'ok')},function(){if(s)s.textContent='Не вышло'})
   .then(function(){setTimeout(function(){b.classList.remove('done');if(s)s.textContent=old},1600)});
});
(function(){
  var seg=document.querySelector('#v-setup .seg');if(!seg)return;
  var hidden=document.querySelectorAll('#v-setup .js-hide');for(var i=0;i<hidden.length;i++){hidden[i].classList.remove('js-hide');hidden[i].classList.add('hide')}
  function pick(id){
    var bs=seg.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',bs[i].getAttribute('data-guide')===id);
    var ps=document.querySelectorAll('#v-setup [data-panel]');for(var j=0;j<ps.length;j++)ps[j].classList.toggle('hide',ps[j].getAttribute('data-panel')!==id);
  }
  seg.addEventListener('click',function(e){var b=e.target.closest('button');if(b){vibe(6);pick(b.getAttribute('data-guide'))}});
  pick(isAndroid?'android':'ios');
})();

// ---- Пульт: разметка ----
function buildRemote(){
  var v=$('v-remote');v.textContent='';
  var hero=el('section','hero');hero.id='hero';hero.setAttribute('data-tone','wait');
  var hi=add(el('div','hero-ic'),icon('shieldOff'));hi.id='hero-ic';
  var tx=add(el('div','hero-tx'),el('div','hero-t','Загрузка…'),el('div','hero-s',''));
  add(hero,hi,tx);v.appendChild(hero);
  var ban=el('div','banner hide');ban.id='offline';
  add(ban,icon('wifiOff'),add(el('div'),el('b',null,'Нет связи с компьютером'),el('span',null,'Проверьте, что компьютер включён, LAZEYKA запущена и телефон в той же сети Wi-Fi. Если на телефоне включён VPN, в его настройках включите доступ к локальной сети или выключите VPN на время. Пульт пробует снова сам.')));
  v.appendChild(ban);

  var scH=el('h2','sec hide','Быстрые сценарии');scH.id='sc-h';v.appendChild(scH);
  var chips=el('div','chips hide');chips.id='chips';chips.setAttribute('data-tour','lan-remote-scenarios');v.appendChild(chips);

  add(v,el('h2','sec','Службы'));
  var grid=el('div','grid');grid.id='grid';
  ORDER.forEach(function(k){
    var b=el('button','tile');b.type='button';b.setAttribute('data-k',k);b.setAttribute('role','switch');b.setAttribute('aria-checked','false');
    var top=add(el('span','t-top'),add(el('span','t-ic'),icon(k)),add(el('span','sw'),el('i')));
    var name=el('span','t-name',NAMES[k]);var st=el('span','t-st',DESC[k]);var sub=el('span','t-sub hide');var act=el('span','t-act hide');act.setAttribute('role','button');
    add(b,top,name,st,sub,act);
    S.tiles[k]={b:b,st:st,sub:sub,act:act};
    bindTile(b,k);grid.appendChild(b);
  });
  v.appendChild(grid);
  var duo=el('div','duo');duo.setAttribute('data-tour','lan-remote-all');
  var allOn=add(el('button','btn sm'),icon('power'),el('span',null,'Включить всё'));allOn.id='all-on';allOn.type='button';
  var allOff=add(el('button','btn sm'),icon('power'),el('span',null,'Выключить всё'));allOff.id='all-off';allOff.type='button';
  allOn.onclick=function(){doAll(true)};allOff.onclick=function(){doAll(false)};
  add(duo,allOn,allOff);v.appendChild(duo);
  v.appendChild(buildNetwork());

  add(v,el('h2','sec','Настройки'));
  var list=el('div','list');
  var rv=row('server','Сервер VPN','','rv-vpn');rv.setAttribute('data-tour','lan-remote-vpn-server');rv.onclick=openServers;
  var rd=row('dns','DNS','','rv-dns');rd.setAttribute('data-tour','lan-remote-dns');rd.onclick=openDns;
  add(list,rv,rd);v.appendChild(list);
  v.appendChild(el('p','hint','Долгое нажатие на плитку — подробности. Потяните экран вниз, чтобы обновить.'));
}
function buildNetwork(){
  var card=el('section','net-card');card.id='net-card';card.setAttribute('aria-labelledby','net-title');
  var title=el('h2','net-title','Проверка сети');title.id='net-title';
  var heading=add(el('div','net-head'),add(el('span','net-icon'),icon('pulse')),
    add(el('div','net-heading'),title,el('p',null,'Проверьте отдельно телефон и доступ к YouTube через ПК.')));
  var status=el('span','net-status','Загрузка…');status.id='net-status';
  var share=add(el('button','btn sm'),icon('power'),el('span',null,'Включить прокси'));
  share.type='button';share.id='net-share';share.onclick=toggleProxyShare;
  var proxyRow=add(el('div','net-proxy'),add(el('div','net-proxy-text'),el('b',null,'Прокси для устройств'),status),share);
  var phone=add(el('button','net-step'),add(el('span','net-step-icon'),icon('phone')),
    add(el('span','net-step-text'),el('b',null,'Проверить этот телефон'),el('small',null,'Проверка браузера через прокси')),
    add(el('span','chev'),icon('chev')));
  phone.id='net-phone';phone.type='button';phone.onclick=runPhoneCheck;
  var phoneResult=el('p','net-message hide');phoneResult.id='net-phone-result';phoneResult.setAttribute('role','status');
  var setup=el('button','net-setup','Адрес, порт и инструкция');
  setup.type='button';setup.id='net-setup';setup.onclick=function(){setTab('setup',true)};
  var test=add(el('button','btn pri'),icon('play'),el('span',null,'Проверить YouTube через ПК'));
  test.type='button';test.id='net-test';test.onclick=runYouTubeCheck;
  var rows=el('div','net-results hide');rows.id='net-results';rows.setAttribute('aria-live','polite');
  var detail=el('p','net-foot','Состояние Zapret на ПК и доступность YouTube проверяются отдельно.');
  detail.id='net-foot';
  return add(card,heading,proxyRow,phone,phoneResult,setup,test,rows,detail);
}
function proxyState(){return (S.state&&S.state.proxy)||{}}
function netRoute(){
  var z=svc('zapret'),v=svc('vpn');
  return [proxyState().on,z.on,z.since,z.strategy,v.on,v.since,v.mode,v.server&&v.server.name].join('|');
}
function resetPhoneCheck(){
  if(S.net.phoneRequest)S.net.phoneRequest.abort();
  S.net.phoneRequest=null;S.net.phone='idle';
}
function runPhoneCheck(){
  var p=proxyState();
  if(S.net.phone==='checking'||(S.authed&&(S.offline||!p.on||p.busy||S.net.toggling)))return;
  var ctl=new AbortController(), timer=setTimeout(function(){ctl.abort()},6500);
  S.net.phoneRequest=ctl;S.net.phone='checking';
  if(S.authed)renderNetwork();else renderPhoneCheck();
  fetch('${PHONE_PROXY_CHECK_ORIGIN}${PHONE_PROXY_CHECK_PATH}',{mode:'cors',credentials:'include',cache:'no-store',redirect:'error',signal:ctl.signal})
    .then(function(r){if(!r.ok)throw new Error('probe failed');return r.json()})
    .then(function(body){return body&&body.proxy==='lazeyka'?'ok':'failed'},function(){return 'failed'})
    .then(function(state){
      clearTimeout(timer);
      if(S.net.phoneRequest!==ctl)return;
      S.net.phoneRequest=null;S.net.phone=state;
      if(S.authed)renderNetwork();else renderPhoneCheck();
    });
}
function renderPhoneCheck(){
  var state=S.net.phone;
  var text=state==='checking'?'Проверяю прокси…':state==='ok'?'Браузер подключён через прокси LAZEYKA.':
    state==='failed'?'Прокси LAZEYKA в этом браузере не подтверждён. Если прокси на телефоне выключен, такой результат ожидаем. Если включён, проверьте адрес и порт Wi-Fi.':'';
  ['net','setup'].forEach(function(prefix){
    var b=$(prefix+'-phone'), result=$(prefix+'-phone-result');
    if(!b||!result)return;
    var blocked=S.authed&&(S.offline||!proxyState().on||proxyState().busy||S.net.toggling);
    b.disabled=state==='checking'||blocked;
    b.querySelector('b').textContent=state==='checking'?'Проверяю…':'Проверить этот телефон';
    result.classList.toggle('hide',!text||(prefix==='net'&&!proxyState().on));
    result.classList.toggle('error',state==='failed');
    result.classList.toggle('success',state==='ok');
    if(result.textContent!==text)result.textContent=text;
  });
}
var setupPhone=$('setup-phone');if(setupPhone)setupPhone.onclick=runPhoneCheck;
function runYouTubeCheck(){
  if(S.offline||!proxyState().on||proxyState().busy||S.net.checking||S.net.toggling)return;
  S.net.checking=true;S.net.error='';S.net.rows=null;S.net.at=0;S.net.route=netRoute();renderNetwork();
  api('/api/proxy/youtube',{},17000).then(function(r){
    if(!r.ok){S.net.error=r.message||'Проверка не удалась';return}
    S.net.rows=Array.isArray(r.value)?r.value:[];
    S.net.at=Date.now();
  }).catch(function(e){if(e.auth||e.off)handleErr(e);else S.net.error=e.message})
    .then(function(){S.net.checking=false;if(S.authed)renderNetwork()});
}
function toggleProxyShare(){
  if(S.offline||!S.state||proxyState().busy||S.net.checking||S.net.toggling||S.net.phone==='checking')return;
  var on=!proxyState().on;
  S.net.toggling=true;S.net.error='';renderNetwork();
  api('/api/proxy/share',{on:on},20000).then(function(r){
    if(!r.ok){S.net.error=r.message||'Не удалось переключить прокси';return}
    S.net.rows=null;S.net.at=0;resetPhoneCheck();
    S.state.proxy={on:on,busy:false};
    toast(on?'Прокси для устройств включён':'Прокси для устройств выключен','ok');
    poll(400);
  }).catch(function(e){if(e.auth||e.off)handleErr(e);else S.net.error=e.message})
    .then(function(){S.net.toggling=false;if(S.authed)renderNetwork()});
}
function renderNetwork(){
  var p=proxyState(),n=S.net,changing=p.busy||n.toggling;
  var status=$('net-status'),share=$('net-share'),phone=$('net-phone'),test=$('net-test'),rows=$('net-results');
  status.textContent=changing?'Переключается…':p.on?'Включён':'Выключен';
  status.setAttribute('data-on',p.on?'true':'false');
  share.querySelector('span').textContent=p.on?'Выключить':'Включить';
  share.disabled=S.offline||changing||n.checking||n.phone==='checking';
  phone.classList.toggle('hide',!p.on);
  renderPhoneCheck();
  $('net-setup').classList.toggle('hide',!p.on);
  test.disabled=S.offline||!p.on||changing||n.checking;
  test.querySelector('span').textContent=n.checking?'Проверяю YouTube…':'Проверить YouTube через ПК';
  var stale=Boolean(n.at&&n.route!==netRoute());
  var key=JSON.stringify([n.error,n.rows,n.at,stale,n.checking]);
  if(rows.getAttribute('data-result')!==key){
    rows.setAttribute('data-result',key);rows.textContent='';
    if(n.checking)rows.appendChild(el('p','net-message','Запрашиваю сайт и загружаю данные с сервера видео…'));
    if(n.error)rows.appendChild(el('p','net-message error',n.error));
    if(n.rows)n.rows.forEach(function(x){
      var r=el('div','net-result');r.setAttribute('data-ok',x.ok?'true':'false');
      add(r,add(el('span','net-result-icon'),icon(x.ok?'check':'alert')),
        add(el('div'),el('b',null,x.label),el('small',null,x.detail)));
      rows.appendChild(r);
    });
    if(stale)rows.appendChild(el('p','net-message','Маршрут изменился. Запустите проверку снова.'));
    rows.classList.toggle('hide',rows.children.length===0);
  }
  $('net-foot').textContent=!p.on?'Включите прокси для проверки. Службы на компьютере можно переключать независимо.':
    'Проверка телефона подтверждает маршрут браузера. Приложение YouTube может идти другим маршрутом.';
}
function row(ic,title,sub,valId){
  var r=el('button','row');r.type='button';
  var rt=add(el('span','rt'),el('b',null,title),sub?el('small',null,sub):null);
  var rv=el('span','rv','');if(valId)rv.id=valId;
  add(r,add(el('span','ri'),icon(ic)),rt,rv,add(el('span','chev'),icon('chev')));
  return r;
}

// ---- Долгое нажатие ----
function bindTile(b,k){
  var t=null,long=false,x0=0,y0=0;
  b.addEventListener('pointerdown',function(e){long=false;x0=e.clientX;y0=e.clientY;b.classList.add('press');clearTimeout(t);t=setTimeout(function(){long=true;b.classList.remove('press');vibe([8,30,8]);openDetails(k)},520)});
  b.addEventListener('pointermove',function(e){if(Math.abs(e.clientX-x0)>10||Math.abs(e.clientY-y0)>10){clearTimeout(t);b.classList.remove('press')}});
  ['pointerup','pointercancel','pointerleave'].forEach(function(n){b.addEventListener(n,function(){clearTimeout(t);b.classList.remove('press')})});
  b.addEventListener('contextmenu',function(e){e.preventDefault()});
  b.addEventListener('click',function(e){
    if(long){long=false;return}
    var a=e.target.closest('.t-act');
    if(a){e.stopPropagation();vibe(8);var code=a.getAttribute('data-code');if(code==='need_server')openServers();else if(code==='no_nodes')openDetails(k);else onTile(k);return}
    onTile(k);
  });
}

// ---- Действия ----
function svc(k){return(S.state&&S.state.services&&S.state.services[k])||{}}
function anyBusy(){if(!S.state)return false;for(var i=0;i<ORDER.length;i++){if(S.pending[ORDER[i]]||svc(ORDER[i]).busy)return true}return Object.keys(S.pending).length>0}
function onTile(k){
  if(S.offline||!S.state){vibe([20,40,20]);toast('Нет связи с компьютером','err');return}
  var v=svc(k);if(S.pending[k]||v.busy)return;
  vibe(12);var want=!v.on;
  delete S.tileErr[k];S.pending[k]={want:want,at:Date.now()};render();
  api('/api/toggle',{service:k,on:want},20000).then(function(r){
    if(!r.ok){delete S.pending[k];S.tileErr[k]={text:r.message||'Не получилось',code:r.code};vibe([30,50,30]);render();return}
    S.pending[k].acked=Date.now();if(r.message)toast(r.message,'info');poll(400);
  }).catch(function(e){delete S.pending[k];handleErr(e,k);render()});
}
function doAll(on){
  if(S.offline||!S.state)return;vibe(14);
  ['zapret','vpn','tg'].forEach(function(k){if(!!svc(k).on!==on){delete S.tileErr[k];S.pending[k]={want:on,at:Date.now()}}});render();
  api('/api/all',{on:on},20000).then(function(r){
    if(!r.ok){toast(r.message||'Не получилось','err');S.pending={};render();return}
    Object.keys(S.pending).forEach(function(k){S.pending[k].acked=Date.now()});
    if(r.message)toast(r.message,'warn');poll(400);
  }).catch(function(e){S.pending={};handleErr(e);render()});
}
function runScenario(x,chip){
  if(S.offline)return;vibe(12);chip.classList.add('busy');chip.disabled=true;
  api('/api/scenario',{id:x.id},20000).then(function(r){if(!r.ok)toast(r.message||'Сценарий не запустился','err');poll(500)})
   .catch(function(e){handleErr(e)}).then(function(){setTimeout(function(){chip.classList.remove('busy');chip.disabled=false;render()},600)});
}
function handleErr(e,k){
  if(e.auth)return closed(e.had?'changed':'need');
  if(e.off)return closed('off');
  if(e.net){setOffline(true);return}
  if(k)S.tileErr[k]={text:e.message};else toast(e.message,'err');
}

// ---- Отрисовка пульта ----
function shortErr(t){t=String(t||'');var i=t.indexOf(': ');return t.length>34&&i>8?t.slice(0,i):t}
function since(ts){
  if(!ts)return'';var m=Math.max(0,Math.round((Date.now()-ts)/60000));
  if(m<1)return'меньше минуты';if(m<60)return m+' мин';var h=Math.floor(m/60);return h+' ч '+(m%60)+' мин';
}
function render(){
  var st=S.state;if(!st)return;
  var linux=st.platform==='linux';
  var on=[],busyName=null;
  ORDER.forEach(function(k){
    var v=svc(k),t=S.tiles[k],p=S.pending[k];
    var busy=!!(p||v.busy);var err=S.tileErr[k]||(v.err&&!busy?{text:v.err,code:v.errCode}:null);
    var want=p?p.want:!v.on;
    t.b.classList.toggle('on',!!v.on&&!(busy&&p&&!p.want));
    t.b.classList.toggle('busy',busy);t.b.classList.toggle('want-on',busy&&want);t.b.classList.toggle('want-off',busy&&!want);
    t.b.classList.toggle('err',!!err&&!busy);
    t.b.setAttribute('aria-checked',v.on?'true':'false');
    t.b.setAttribute('aria-disabled',S.offline?'true':'false');
    var text;
    if(busy){text=v.detail||(want?(k==='vpn'?'Подключаю…':'Включаю…'):(k==='vpn'?'Отключаю…':'Выключаю…'));if(!busyName)busyName=(want?(k==='vpn'?'Подключаю ':'Включаю '):(k==='vpn'?'Отключаю ':'Выключаю '))+FULL[k]+'…'}
    else if(err)text=shortErr(err.text);
    else if(v.on)text=k==='vpn'?(v.recovering?'Переподключаюсь…':'Подключено'):'Включено';
    else text=k==='vpn'&&!v.server?'Сервер не выбран':'Выключено';
    t.st.textContent=text;
    var sub='';if(k==='vpn'&&v.server)sub=v.server.name;else if(k==='zapret'&&v.on&&v.strategy)sub=v.strategy;else if(v.on&&v.since)sub='работает '+since(v.since);
    t.sub.textContent=sub;t.sub.classList.toggle('hide',!sub);
    var actText=null;
    if(err&&!busy){if(err.code==='need_server')actText='Выбрать сервер';else if(err.code==='no_nodes')actText='Подробнее';else actText='Повторить'}
    t.act.classList.toggle('hide',!actText);if(actText){t.act.textContent=actText;t.act.setAttribute('data-code',err.code||'retry')}
    if(v.on&&(k==='zapret'||k==='vpn'))on.push(k==='vpn'&&v.server?'VPN · '+v.server.name:NAMES[k]);
    else if(v.on)on.push(NAMES[k]);
  });
  var hero=$('hero'),prot=svc('zapret').on||svc('vpn').on;
  var tone=S.offline?'offline':busyName?'busy':prot?'on':'off';
  hero.setAttribute('data-tone',tone);
  var hic=$('hero-ic');hic.textContent='';hic.appendChild(icon(tone==='offline'?'wifiOff':prot?'shield':'shieldOff'));
  hero.querySelector('.hero-t').textContent=S.offline?'Нет связи':busyName?busyName:(linux?on.length>0:prot)?'Службы на ПК включены':linux?'Службы выключены':'Zapret и VPN выключены';
  hero.querySelector('.hero-s').textContent=S.offline?'Последнее известное состояние ниже':busyName?'Обычно это занимает несколько секунд':on.length?('Работает: '+on.join(', ')):linux?'Нажмите на плитку, чтобы включить службу.':'Zapret и VPN выключены. Нажмите на плитку, чтобы включить.';
  $('offline').classList.toggle('hide',!S.offline);
  // Сценарии
  var sc=st.scenarios||[],chips=$('chips');
  $('sc-h').classList.toggle('hide',!sc.length);chips.classList.toggle('hide',!sc.length);
  var sig=sc.map(function(x){return x.id+'|'+x.name+'|'+x.emoji}).join(',');
  if(chips.getAttribute('data-sig')!==sig){
    chips.setAttribute('data-sig',sig);chips.textContent='';
    sc.forEach(function(x){
      var c=el('button','chip');c.type='button';
      var em=el('span','em');
      if(x.icon){var im=el('img');im.alt='';im.src=x.icon;em.appendChild(im)}else em.appendChild(el('span',null,x.emoji||'▶'));
      add(c,em,el('span','nm',x.name));c.onclick=function(){runScenario(x,c)};chips.appendChild(c);
    });
  }
  var all=ORDER.slice(0,3);
  $('all-on').disabled=S.offline||all.every(function(k){return svc(k).on});
  $('all-off').disabled=S.offline||all.every(function(k){return!svc(k).on});
  var vs=svc('vpn');$('rv-vpn').textContent=vs.server?vs.server.name:'не выбран';
  if(S.dns)$('rv-dns').textContent=S.dns.current?S.dns.current.name:'Стандартный';
  renderNetwork();
  if(S.sheet&&S.sheet.refresh)S.sheet.refresh();
}

// ---- Связь ----
function setOffline(off){
  if(off){S.fails++;if(S.fails<2&&S.state)return}else S.fails=0;
  if(S.offline!==off){S.offline=off;if(off){vibe([40,60,40]);toast('Связь с компьютером потеряна','err')}else if(S.state)toast('Связь восстановлена','ok')}
  showConn();render();
}
function showConn(){
  var c=$('conn'),t=$('connt');
  if(S.offline){c.setAttribute('data-q','off');t.textContent='Нет связи';return}
  if(S.rtt==null){c.setAttribute('data-q','wait');t.textContent='Связь…';return}
  c.setAttribute('data-q',S.rtt<80?'good':S.rtt<250?'mid':'bad');t.textContent=S.rtt+' мс';
  c.setAttribute('aria-label','Задержка до компьютера '+S.rtt+' мс');
}
function onState(next){
  var prev=S.state;
  var evs=next.events||[];var maxSeq=evs.reduce(function(m,e){return Math.max(m,e.seq)},0);
  var told={};
  if(S.lastSeq===null)S.lastSeq=maxSeq;
  else evs.forEach(function(e){if(e.seq>S.lastSeq){told[e.key]=1;
    // Итог «Обновить подписки» / «Проверить пинг» уже виден в открытом листе серверов — плашка не нужна.
    if(S.sheet&&S.sheet.jobs&&String(e.key).indexOf('vpn-')===0)return;
    toast(e.text,e.tone);vibe(e.tone==='err'?[30,50,30]:14)}});
  S.lastSeq=Math.max(S.lastSeq,maxSeq);
  if(prev){
    ['zapret','vpn','tg'].forEach(function(k){
      var a=prev.services[k]||{},b=next.services[k]||{};
      if(told[k]||S.pending[k]||a.busy||b.busy||!!a.on===!!b.on)return;
      if(a.on&&!b.on){toast(k==='vpn'?'VPN отключился'+(b.err?': '+b.err:''):FULL[k]+' остановился'+(b.err?': '+b.err:''),'warn');vibe([60,40,60])}
      else toast(FULL[k]+(k==='vpn'?' подключён':' включён')+' на компьютере','ok');
    });
  }
  // Ожидание результата действия: ждём, пока служба закончит и состояние станет нужным (или придёт ошибка).
  Object.keys(S.pending).forEach(function(k){
    var p=S.pending[k],v=next.services[k]||{};
    if(!p.acked){if(Date.now()-p.at>30000)delete S.pending[k];return}
    if(v.busy)return;
    if(!!v.on===p.want||v.err||Date.now()-p.acked>2500){delete S.pending[k];var t=S.tiles[k];if(t&&!reduce){t.b.classList.remove('flash');void t.b.offsetWidth;t.b.classList.add('flash')}}
  });
  if(prev&&Boolean(prev.proxy&&prev.proxy.on)!==Boolean(next.proxy&&next.proxy.on))resetPhoneCheck();
  S.state=next;setOffline(false);
  if(S.tab==='setup'&&next.proxy&&Boolean(next.proxy.on)!==boot.hasSetup)setTab('setup',true);
}
function load(){
  if(S.stopped)return Promise.resolve();
  S.loading=true;$('refresh').classList.add('spin');
  return api('/api/state').then(function(r){if(r&&r.ok){onState(r.value);showConn()}})
   .catch(function(e){if(e.auth)closed(e.had?'changed':'need');else if(e.off)closed('off');else if(e.net)setOffline(true);else toast(e.message,'err')})
   .then(function(){S.loading=false;$('refresh').classList.remove('spin')});
}
function schedule(ms){
  clearTimeout(S.timer);
  if(S.stopped||document.visibilityState!=='visible')return;
  var d=ms!=null?ms:anyBusy()?1000:S.offline?Math.min(10000,3000*Math.max(1,S.fails)):3000;
  S.timer=setTimeout(function(){load().then(function(){schedule()})},d);
}
function poll(ms){schedule(ms)}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'){if(S.authed){load().then(function(){schedule()})}if(S.sheet&&S.sheet.resume)S.sheet.resume()}else clearTimeout(S.timer);
});
window.addEventListener('online',function(){if(S.authed)load().then(function(){schedule()})});
$('refresh').addEventListener('click',function(){vibe(8);refreshAll()});
function refreshAll(){var p=load();if(S.authed&&S.tab==='remote')loadDns(false);return p.then(function(){schedule()})}

// ---- Потянуть вниз для обновления ----
(function(){
  var y0=null,dy=0,ptr=$('ptr'),busy=false;
  window.addEventListener('touchstart',function(e){if(!S.authed||S.sheet||busy||window.scrollY>0){y0=null;return}y0=e.touches[0].clientY;dy=0},{passive:true});
  window.addEventListener('touchmove',function(e){if(y0==null)return;dy=e.touches[0].clientY-y0;if(dy<=0){ptr.style.opacity='0';return}
    var d=Math.min(dy*.5,80);ptr.style.opacity=String(Math.min(1,d/50));ptr.style.transform='translateY('+(d-30)+'px) rotate('+(d*4)+'deg)'},{passive:true});
  window.addEventListener('touchend',function(){if(y0==null)return;y0=null;
    if(dy*.5>=60){busy=true;vibe(10);ptr.classList.add('go');refreshAll().then(function(){setTimeout(function(){busy=false;ptr.classList.remove('go');ptr.style.opacity='0';ptr.style.transform=''},300)})}
    else{ptr.style.opacity='0';ptr.style.transform=''}},{passive:true});
})();

// ---- Нижние листы ----
function openSheet(title,build){
  closeSheet(true);
  var scrim=el('div','scrim'),sh=el('div','sheet');sh.setAttribute('role','dialog');sh.setAttribute('aria-modal','true');sh.setAttribute('aria-label',title);
  var x=add(el('button','icbtn'),icon('close'));x.type='button';x.setAttribute('aria-label','Закрыть');
  var head=add(el('div','sh'),el('b',null,title),x);var body=el('div','sb');
  add(sh,el('div','grab'),head,body);document.body.appendChild(scrim);document.body.appendChild(sh);
  var obj={sh:sh,scrim:scrim,body:body,refresh:null};S.sheet=obj;
  scrim.onclick=function(){closeSheet()};x.onclick=function(){closeSheet()};
  // Смахнуть вниз за ручку/заголовок
  var y0=null;head.addEventListener('touchstart',function(e){y0=e.touches[0].clientY},{passive:true});
  head.addEventListener('touchmove',function(e){if(y0==null)return;var d=Math.max(0,e.touches[0].clientY-y0);sh.style.transform='translateY('+d+'px)'},{passive:true});
  head.addEventListener('touchend',function(e){if(y0==null)return;var d=e.changedTouches[0].clientY-y0;y0=null;sh.style.transform='';if(d>90)closeSheet()},{passive:true});
  build(obj);
  requestAnimationFrame(function(){requestAnimationFrame(function(){scrim.classList.add('in');sh.classList.add('in')})});
  return obj;
}
function closeSheet(now){
  var o=S.sheet;if(!o)return;S.sheet=null;
  o.scrim.classList.remove('in');o.sh.classList.remove('in');
  setTimeout(function(){if(o.scrim.parentNode)o.scrim.parentNode.removeChild(o.scrim);if(o.sh.parentNode)o.sh.parentNode.removeChild(o.sh)},now||reduce?0:340);
}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeSheet()});
function kv(k,v){return add(el('div','kv'),el('span',null,k),el('b',null,v))}

// ---- Подробности плитки (долгое нажатие) ----
var MODE={tun:'Туннель (TUN)',system_proxy:'Системный прокси',only_proxy:'Только прокси'};
function openDetails(k){
  openSheet(FULL[k],function(o){
    o.refresh=function(){
      var v=svc(k),b=o.body;b.textContent='';
      var box=el('div','card');
      box.appendChild(kv('Состояние',v.busy?'Выполняется…':v.on?(k==='vpn'?'Подключено':'Включено'):(k==='vpn'?'Отключено':'Выключено')));
      if(k==='vpn'){
        box.appendChild(kv('Сервер',v.server?v.server.name:'не выбран'));
        if(v.server&&v.server.group)box.appendChild(kv('Группа',v.server.group));
        if(v.on&&v.since)box.appendChild(kv('Подключено',since(v.since)+' назад'));
        if(v.mode)box.appendChild(kv('Режим',MODE[v.mode]||v.mode));
      }
      if(k==='zapret'){box.appendChild(kv('Стратегия',v.strategy||'не выбрана'));if(v.on&&v.since)box.appendChild(kv('Работает',since(v.since)))}
      if(k==='tg'&&v.on&&v.since)box.appendChild(kv('Работает',since(v.since)));
      if(k==='exitlag')box.appendChild(kv('Что делает','Через VPN идут только игры из списка в программе'));
      if(v.err)box.appendChild(kv('Ошибка',v.err));
      b.appendChild(box);
      if(k==='vpn'&&v.errCode==='no_nodes')b.appendChild(el('p','hint','Серверов нет. Добавьте подписку в программе на компьютере: раздел INCY.'));
      if(k==='exitlag')b.appendChild(el('p','hint','Сам список игр и режим подключения меняются в программе на компьютере.'));
      var st=el('div','stack');
      var tg=add(el('button','btn pri'),icon('power'),el('span',null,v.on?(k==='vpn'?'Отключить':'Выключить'):(k==='vpn'?'Подключить':'Включить')));tg.type='button';
      if(v.on)tg.className='btn';tg.disabled=!!(v.busy||S.pending[k]||S.offline);
      tg.onclick=function(){closeSheet();onTile(k)};st.appendChild(tg);
      if(k==='vpn'){var cs=add(el('button','btn'),icon('server'),el('span',null,'Сменить сервер'));cs.type='button';cs.onclick=openServers;st.appendChild(cs)}
      b.appendChild(st);
    };
    o.refresh();
  });
}

// ---- Выбор сервера VPN ----
function pingQ(ms){return ms==null?'':ms<120?'good':ms<300?'mid':'bad'}
var STOP_IC='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
function openServers(){
  var q='',busyId=null,sort=LS.get('lz.sort')==='ping'?'ping':'group',jobT=null,starting=null,stopping=false,lastSeq=null,scope='all',seenOp=null;
  openSheet('Сервер VPN',function(o){
    var b=o.body;
    var sr=el('label','search');var inp=el('input');inp.type='search';inp.placeholder='Поиск по названию или группе';inp.setAttribute('aria-label','Поиск сервера');inp.autocomplete='off';
    add(sr,icon('search'),inp);
    // Обновить подписки и проверить пинг: действие идёт на компьютере (общее с программой), страница опрашивает ход.
    // Что проверять: все серверы или одну группу (подписку). Во время действия его кнопка становится «Остановить».
    var tools=el('div','tools');tools.setAttribute('data-tour','lan-remote-vpn-tools');
    var sc=el('label','scope');var scSel=el('select');scSel.setAttribute('aria-label','Что проверять и обновлять');
    add(sc,el('span',null,'Что'),scSel);
    var duo=el('div','duo');
    var bRef=add(el('button','btn sm'),icon('refresh'),el('span',null,'Обновить подписки'));bRef.type='button';
    var bPing=add(el('button','btn sm'),icon('pulse'),el('span',null,'Проверить пинг'));bPing.type='button';
    add(duo,bRef,bPing);add(tools,sc,duo);
    var job=el('div','job hide');job.setAttribute('role','status');job.setAttribute('aria-live','polite');
    var seg=el('div','seg sortseg');seg.setAttribute('role','tablist');seg.setAttribute('aria-label','Порядок');
    var sGroup=el('button',null,'По группам'),sPing=el('button',null,'По пингу');sGroup.type=sPing.type='button';add(seg,sGroup,sPing);
    var listBox=el('div');add(b,sr,tools,job,seg,listBox);
    inp.addEventListener('input',function(){q=inp.value.trim().toLowerCase();draw()});
    scSel.addEventListener('change',function(){scope=scSel.value;vibe(6);drawTools()});
    function setSort(v){sort=v;LS.set('lz.sort',v);draw()}
    sGroup.onclick=function(){vibe(6);setSort('group')};sPing.onclick=function(){vibe(6);setSort('ping')};
    bRef.onclick=function(){onTool('refresh')};bPing.onclick=function(){onTool('ping')};
    function curJob(){return S.nodes&&S.nodes.job||null}
    function groups(){
      var d=S.nodes,m={},out=[];if(!d||!d.nodes)return out;
      d.nodes.forEach(function(n){var k=n.gid||'';if(!m[k]){m[k]={gid:k,name:n.group,count:0};out.push(m[k])}m[k].count++});
      return out;
    }
    function drawScope(){
      var gs=groups(),d=S.nodes,cur=scope;
      if(cur!=='all'&&!gs.some(function(g){return'g:'+g.gid===cur}))cur=scope='all';
      scSel.textContent='';
      var oa=el('option',null,'Все серверы'+(d&&d.nodes?' ('+d.nodes.length+')':''));oa.value='all';scSel.appendChild(oa);
      if(gs.length>1)gs.forEach(function(g){var op=el('option',null,'Группа «'+g.name+'» ('+g.count+')');op.value='g:'+g.gid;scSel.appendChild(op)});
      scSel.value=cur;sc.classList.toggle('hide',gs.length<2);
    }
    function scopeGid(){return scope.indexOf('g:')===0?scope.slice(2):null}
    function drawTools(){
      var d=S.nodes,j=curJob(),run=!!(j&&j.running),gid=scopeGid(),manual=gid==='';
      drawScope();
      var bad=!d||!!d.error||S.offline;
      scSel.disabled=bad||run||!!starting;
      // Кнопка идущего действия превращается в «Остановить»; вторая ждёт.
      [[bRef,'refresh'],[bPing,'ping']].forEach(function(p){
        var btn=p[0],k=p[1],mine=run&&j.kind===k,ic=btn.firstChild,lab=btn.querySelector('span');
        btn.classList.toggle('dng',mine);
        if(mine){var s1=el('span');s1.innerHTML=STOP_IC;btn.replaceChild(s1.firstChild,ic);lab.textContent=j.stopping||stopping?'Останавливаю…':'Остановить';btn.disabled=!!(j.stopping||stopping)||S.offline}
        else{btn.replaceChild(icon(k==='ping'?'pulse':'refresh'),ic);
          lab.textContent=starting===k?(k==='ping'?'Проверяю…':'Обновляю…'):k==='ping'?'Проверить пинг':gid!=null?'Обновить подписку':'Обновить подписки';
          btn.disabled=bad||run||!!starting||(k==='ping'?!(d&&d.nodes&&d.nodes.length):(!d||!d.subs||manual))}
      });
      if(manual)bRef.title='Серверы, добавленные вручную, не обновляются';else bRef.removeAttribute('title');
      sGroup.classList.toggle('on',sort==='group');sPing.classList.toggle('on',sort==='ping');
      sGroup.setAttribute('aria-selected',sort==='group'?'true':'false');sPing.setAttribute('aria-selected',sort==='ping'?'true':'false');
      job.textContent='';
      // Итог показываем только для действия, запущенного или увиденного в этом листе.
      var show=j&&(run||(lastSeq!=null&&j.seq>=lastSeq));
      job.classList.toggle('hide',!show);if(!show)return;
      job.setAttribute('data-tone',run?'run':j.stopped?'stop':j.ok?'ok':'err');
      var head=el('div','jh');
      if(run)head.appendChild(el('span','spin'));else head.appendChild(add(el('span','ji'),icon(j.ok||j.stopped?'check':'alert')));
      var lbl=j.label&&j.scope!=='all'?' · '+j.label:'';
      var txt=run?(j.stopping?'Останавливаю: дожидаюсь текущего шага…':j.kind==='ping'?'Проверяю пинг: '+j.done+' из '+j.total+lbl:'Обновляю подписки'+(j.total>1?': '+j.done+' из '+j.total:'…')+lbl):(j.text||(j.ok?'Готово':'Не получилось'));
      var tx=add(el('span','jt'),el('span',null,txt));if(run&&j.fromApp)tx.appendChild(el('small',null,'Запущено на компьютере'));
      head.appendChild(tx);job.appendChild(head);
      if(run){var bar=el('div','bar');var fill=el('i');
        if(j.total>1||j.kind==='ping'&&j.total){fill.style.width=Math.max(4,Math.round(j.done/j.total*100))+'%'}else bar.classList.add('ind');
        bar.appendChild(fill);job.appendChild(bar)}
    }
    function pingCell(n){
      if(n.pinging)return el('span','spin');
      var p=el('span','ping',n.ping!=null?n.ping+' мс':n.checked?'нет ответа':'—');p.setAttribute('data-q',n.ping!=null?pingQ(n.ping):n.checked?'bad':'');return p;
    }
    function nodeRow(n,d,withGroup){
      var r=el('button','row node'+(n.id===d.selectedId?' sel':''));r.type='button';
      var rt=add(el('span','rt'),el('b',null,n.name));
      if(n.id===d.activeId&&svc('vpn').on)rt.appendChild(el('small',null,'Подключено сейчас'));else if(withGroup)rt.appendChild(el('small',null,n.group));
      add(r,rt,pingCell(n),busyId===n.id?el('span','spin'):add(el('span','chk'),icon('check')));
      r.onclick=function(){pickNode(n)};return r;
    }
    function draw(){
      drawTools();
      listBox.textContent='';var d=S.nodes;
      if(!d){add(listBox,add(el('div','empty'),el('div','spin')));return}
      if(d.error){add(listBox,el('div','empty',d.error));return}
      if(!d.nodes.length){add(listBox,el('div','empty','Серверов нет. Добавьте подписку в программе на компьютере: раздел INCY.'));return}
      var vis=d.nodes.filter(function(n){return!q||(n.name+' '+n.group).toLowerCase().indexOf(q)>=0});
      if(!vis.length){add(listBox,el('div','empty','Ничего не нашлось'));return}
      if(sort==='ping'){
        var rank=function(n){return n.ping!=null?n.ping:n.pinging?1e7:n.checked?1e8:1e9};
        vis=vis.slice().sort(function(a,c){return rank(a)-rank(c)});
        var l0=el('div','list');vis.forEach(function(n){l0.appendChild(nodeRow(n,d,true))});
        listBox.appendChild(l0);
      }else{
        var gr={},order=[];
        vis.forEach(function(n){if(!gr[n.group]){gr[n.group]=[];order.push(n.group)}gr[n.group].push(n)});
        order.forEach(function(g){
          listBox.appendChild(el('div','grp',g+' · '+gr[g].length));
          var l=el('div','list');gr[g].forEach(function(n){l.appendChild(nodeRow(n,d,false))});
          listBox.appendChild(l);
        });
      }
      listBox.appendChild(el('p','hint','Пинг меряет компьютер, а не телефон. Проверку, запущенную в программе, видно и можно остановить здесь, и наоборот.'));
    }
    function fetchNodes(){
      return api('/api/vpn/nodes').then(function(r){S.nodes=r.ok?r.value:{error:r.message||'Не удалось получить список'}})
       .catch(function(e){if(!S.nodes||S.nodes.error)S.nodes={error:e.message};handleErr(e)});
    }
    // Опрос хода — только пока лист открыт, страница видна и действие идёт.
    function watch(){
      clearTimeout(jobT);jobT=null;
      if(S.sheet!==o||document.visibilityState!=='visible')return;
      var j=curJob();if(!(j&&j.running)&&!starting){stopping=false;return}
      jobT=setTimeout(function(){if(S.sheet!==o)return;fetchNodes().then(function(){if(S.sheet!==o)return;draw();watch()})},1000);
    }
    o.resume=function(){fetchNodes().then(function(){if(S.sheet===o){draw();watch()}})};
    function onTool(kind){var j=curJob();if(j&&j.running&&j.kind===kind)stopJob();else runJob(kind)}
    function runJob(kind){
      if(starting||S.offline)return;var j=curJob();if(j&&j.running)return;
      var gid=scopeGid(),body=gid!=null?{scope:'group',gid:gid}:{};
      starting=kind;vibe(10);if(kind==='ping'&&sort!=='ping'){sort='ping';LS.set('lz.sort','ping')}draw();
      api('/api/vpn/'+kind,body,15000).then(function(r){
        if(!r.ok){starting=null;toast(r.message||'Не получилось',r.code==='rate'||r.code==='busy'||r.code==='manual'?'warn':'err');vibe([30,50,30]);draw();return}
        if(r.code==='joined'&&r.message)toast(r.message,'info');
        return fetchNodes().then(function(){starting=null;var jj=curJob();lastSeq=jj?jj.seq:null;if(S.sheet===o){draw();watch()}});
      }).catch(function(e){starting=null;handleErr(e);draw()});
    }
    function stopJob(){
      if(stopping||S.offline)return;stopping=true;vibe(10);drawTools();
      api('/api/vpn/stop',{},15000).then(function(r){
        if(!r.ok&&r.code!=='idle')toast(r.message||'Не удалось остановить','err');
        return fetchNodes().then(function(){if(S.sheet===o){draw();watch()}});
      }).catch(function(e){stopping=false;handleErr(e);drawTools()});
    }
    function pickNode(n){
      if(busyId)return;if(n.id===S.nodes.selectedId&&svc('vpn').on){closeSheet();return}
      busyId=n.id;vibe(10);draw();
      api('/api/vpn/select',{id:n.id},20000).then(function(r){
        busyId=null;
        if(!r.ok){toast(r.message||'Не удалось выбрать сервер','err');draw();return}
        S.nodes.selectedId=n.id;delete S.tileErr.vpn;
        if(r.code==='reconnect'){S.pending.vpn={want:true,at:Date.now(),acked:Date.now()}}
        toast(r.message||('Выбран сервер: '+n.name),'ok');closeSheet();load().then(function(){schedule()});
      }).catch(function(e){busyId=null;handleErr(e);draw()});
    }
    // Состояние пульта приходит само; если на компьютере началась проверка, а лист её ещё не видит — подхватываем.
    o.refresh=function(){
      var seq=svc('vpn').opSeq;
      if(seq&&seq!==seenOp&&!jobT&&!starting){seenOp=seq;fetchNodes().then(function(){if(S.sheet!==o)return;var j=curJob();if(j&&j.running)lastSeq=j.seq;draw();watch()});return}
      drawTools();
    };
    o.jobs=true;
    S.nodes=null;draw();
    fetchNodes().then(function(){var j=curJob();if(j&&j.running){lastSeq=j.seq;seenOp=j.seq}if(S.sheet===o){draw();watch()}});
  });
}
// ---- DNS ----
function loadDns(ping){
  return api('/api/dns'+(ping?'?ping=1':''),null,ping?30000:15000).then(function(r){if(r.ok){S.dns=r.value;render()}return r}).catch(function(e){if(e.auth)handleErr(e);return{ok:false,message:e.message}});
}
function openDns(){
  var busyId=null,pinging=false;
  openSheet('DNS',function(o){
    var b=o.body;
    function draw(){
      b.textContent='';var d=S.dns;
      if(!d){add(b,add(el('div','empty'),el('div','spin')));return}
      var cur=el('div','cur');
      add(cur,add(el('span','ri'),icon('dns')),add(el('div'),el('small',null,'Сейчас в системе'),el('b',null,d.current?d.current.name:'Стандартный'),
        el('small',null,d.current?(d.current.encrypted?'Шифрованный (DoH)':'Без шифрования'):'От роутера или провайдера')));
      b.appendChild(cur);
      var l=el('div','list');
      (d.list||[]).forEach(function(p){
        var on=d.current&&d.current.id===p.id;
        var r=el('button','row node'+(on?' sel':''));r.type='button';
        var nm=el('b',null,p.name);if(p.encrypted)nm.appendChild(el('span','badge ac','DoH'));if(p.custom)nm.appendChild(el('span','badge','свой'));
        var rt=add(el('span','rt'),nm,p.desc?el('small',null,p.desc):null);
        var tail=busyId===p.id?el('span','spin'):p.ping!=null?el('span','ping',p.ping+' мс'):add(el('span','chk'),icon('check'));
        if(p.ping!=null&&busyId!==p.id)tail.setAttribute('data-q',pingQ(p.ping));
        add(r,rt,tail);if(on&&p.ping!=null)r.appendChild(add(el('span','chk'),icon('check')));
        r.onclick=function(){apply(p.id,p.name)};l.appendChild(r);
      });
      b.appendChild(l);
      var st=el('div','stack');
      var reset=add(el('button','btn'),icon('refresh'),el('span',null,busyId==='dhcp'?'Сбрасываю…':'Сбросить на стандартный'));reset.type='button';reset.disabled=!!busyId||!d.current;
      reset.onclick=function(){apply('dhcp','стандартный')};
      var pg=add(el('button','btn'),icon('pulse'),el('span',null,pinging?'Проверяю скорость…':'Проверить скорость серверов'));pg.type='button';pg.disabled=pinging||!!busyId;
      pg.onclick=function(){pinging=true;draw();loadDns(true).then(function(){pinging=false;draw()})};
      add(st,reset,pg);b.appendChild(st);
      b.appendChild(el('p','hint','DNS меняется на компьютере, а не на телефоне. На Windows — для всех активных сетевых адаптеров.'));
    }
    function apply(id,name){
      if(busyId)return;busyId=id;vibe(10);draw();
      api('/api/dns',{id:id},60000).then(function(r){
        busyId=null;toast(r.message||(r.ok?'DNS: '+name:'Не удалось изменить DNS'),r.ok?'ok':'err');vibe(r.ok?14:[30,50,30]);
        return loadDns(false);
      }).catch(function(e){busyId=null;handleErr(e)}).then(draw);
    }
    o.refresh=null;draw();loadDns(false).then(draw);
  });
}

// ---- «Ещё» ----
function buildMore(){
  var v=$('v-more');v.textContent='';
  if(!standalone){
    v.appendChild(el('h2','sec','Приложение'));
    var c=el('div','card inst');c.setAttribute('data-tour','lan-remote-install');
    var im=el('img');im.src='/apple-touch-icon.png';im.alt='';
    add(c,add(el('div','ih'),im,add(el('div'),el('b',null,'Пульт на экране «Домой»'),el('p',null,'Значок LAZEYKA откроет пульт без адресной строки, как обычное приложение.'))));
    var seg=el('div','seg');seg.setAttribute('role','tablist');var bi=el('button',null,'iPhone и iPad'),ba=el('button',null,'Android');bi.type=ba.type='button';add(seg,bi,ba);
    var g=el('div','guide');seg.classList.add('stackseg');
    function steps(which){
      bi.classList.toggle('on',which==='ios');ba.classList.toggle('on',which==='android');g.textContent='';var ol=el('ol');
      var L=function(parts){var li=el('li');parts.forEach(function(p){li.appendChild(typeof p==='string'?document.createTextNode(p):p)});ol.appendChild(li)};
      var gl=function(n){return add(el('span','glyph'),icon(n))};
      if(which==='ios'){
        L(['Откройте эту страницу в Safari (в других браузерах на iPhone пункт может называться иначе).']);
        L(['Нажмите «Поделиться» ',gl('share'),' внизу экрана.']);
        L(['Прокрутите список и выберите «На экран „Домой“» ',gl('plusSq'),'.']);
        L(['Нажмите «Добавить». Значок LAZEYKA появится среди приложений.']);
      }else{
        L(['Откройте эту страницу в Chrome.']);
        L(['Нажмите меню ',gl('dots'),' в правом верхнем углу.']);
        L(['Выберите «Добавить на гл. экран» или «Установить приложение».']);
        L(['Подтвердите. Значок LAZEYKA появится на рабочем столе.']);
      }
      g.appendChild(ol);
    }
    bi.onclick=function(){vibe(6);steps('ios')};ba.onclick=function(){vibe(6);steps('android')};
    add(c,seg,g);steps(isAndroid?'android':'ios');
    c.appendChild(el('div','note','Значок работает, пока телефон в той же сети Wi-Fi, что и компьютер, и в LAZEYKA включён раздел «Локальная сеть». Если в программе сменят код доступа, отсканируйте новый QR.'));
    v.appendChild(c);
  }
  v.appendChild(el('h2','sec','Уведомления'));
  var n=el('div','card');n.setAttribute('data-tour','lan-remote-events');
  add(n,add(el('div','swrow'),add(el('span','ri'),icon('bell')),add(el('div','rt'),el('b',null,'События, пока пульт открыт'),el('small',null,'Обрыв VPN, остановка Zapret, выполненный сценарий'))));
  n.appendChild(el('div','note','Когда пульт закрыт, уведомления не приходят. Для настоящих уведомлений телефону нужен защищённый адрес (https), а пульт работает внутри домашней сети по обычному http. Пока страница открыта, события появляются плашками вверху экрана.'));
  if(canVibe){
    var vr=el('div','swrow');var tg=el('button','tg-sw');tg.type='button';tg.setAttribute('role','switch');tg.appendChild(el('i'));
    var setV=function(){tg.setAttribute('aria-checked',LS.get('lz.vibe')==='0'?'false':'true')};setV();
    tg.onclick=function(){LS.set('lz.vibe',LS.get('lz.vibe')==='0'?'1':'0');setV();vibe(15)};tg.setAttribute('aria-label','Вибрация');
    add(vr,add(el('div','rt'),el('b',null,'Вибрация'),el('small',null,'Короткий отклик на нажатия и события')),tg);n.appendChild(vr);
  }
  v.appendChild(n);
  v.appendChild(el('h2','sec','Оформление'));
  var th=el('div','seg');th.setAttribute('data-tour','lan-remote-theme');
  [['auto','Как в системе'],['dark','Тёмная'],['light','Светлая']].forEach(function(x){
    var b=el('button',null,x[1]);b.type='button';b.classList.toggle('on',themePref()===x[0]);
    b.onclick=function(){LS.set('lz.theme',x[0]);applyTheme();vibe(6);var bs=th.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',bs[i]===b)};th.appendChild(b);
  });
  v.appendChild(th);
  v.appendChild(el('h2','sec','Связь с компьютером'));
  var l=el('div','list');
  var a=row('phone','Компьютер',location.host,null);a.disabled=true;a.querySelector('.chev').classList.add('hide');
  var out=row('logout','Забыть этот телефон','Удалить код доступа из браузера',null);out.classList.add('dng');
  out.onclick=function(){if(!confirm('Забыть код доступа на этом телефоне? Чтобы снова управлять, понадобится QR из программы.'))return;LS.set('lz.k',null);LS.set('lz.tab',null);location.replace('/setup')};
  add(l,a,out);v.appendChild(l);
  v.appendChild(el('div','foot','LAZEYKA · пульт в домашней сети'));
}

// ---- Доступ закрыт / гость ----
function closed(why){
  S.stopped=true;S.authed=false;clearTimeout(S.timer);closeSheet(true);
  if(why!=='off')LS.set('lz.k',null);
  document.body.classList.add('guest');
  var v=$('v-closed');v.textContent='';
  var box=el('div','closed');
  var t=why==='off'?'Пульт выключен':'Доступ закрыт';
  var p=why==='off'?'Пульт выключили в программе на компьютере. Включите его в разделе «Локальная сеть».':why==='bad'?'Код из QR не подошёл. Возможно, код сменили в программе.':why==='changed'?'Код доступа сменили в программе. Чтобы снова управлять, отсканируйте QR пульта заново: LAZEYKA → «Локальная сеть».':'Чтобы управлять, отсканируйте QR пульта в программе: LAZEYKA → «Локальная сеть».';
  add(box,add(el('div','big'),icon(why==='off'?'power':'lock')),el('h1',null,t),el('p',null,p));
  if(standalone&&why!=='off')box.appendChild(el('p',null,'Если пульт установлен значком на экран «Домой», после сканирования удалите старый значок и добавьте пульт заново.'));
  if(boot.hasSetup){var b=add(el('button','btn'),icon('link'),el('span',null,'Подключить устройство к прокси'));b.type='button';b.onclick=function(){guest()};box.appendChild(b)}
  v.appendChild(box);
  $('conn').classList.add('hide');$('refresh').classList.add('hide');
  setTab('closed');S.tab='closed';
  var tabs=document.querySelectorAll('.view');for(var i=0;i<tabs.length;i++)tabs[i].classList.toggle('on',tabs[i].id==='v-closed');
  $('sub').textContent=t;
}
function guest(){
  S.authed=false;document.body.classList.add('guest');
  $('invite').classList.toggle('hide',!boot.remote);
  $('conn').classList.add('hide');$('refresh').classList.add('hide');
  setTab('setup');
}
function enter(){
  S.authed=true;S.stopped=false;document.body.classList.remove('guest');
  $('invite').classList.add('hide');$('conn').classList.remove('hide');$('refresh').classList.remove('hide');
  // Значок на экране «Домой» должен открывать пульт уже с кодом (у установленного приложения на iPhone своё хранилище).
  var k=LS.get('lz.k');if(k)$('lz-mf').setAttribute('href','/manifest.webmanifest?s='+encodeURIComponent(k));
  buildRemote();buildMore();
  var t=boot.tab==='setup'&&!fromApp?'setup':(LS.get('lz.tab')||'remote');
  if(['remote','setup','more'].indexOf(t)<0)t='remote';
  setTab(t);render();showConn();schedule();loadDns(false);
}

// ---- Запуск ----
applyTheme();
var qs=new URLSearchParams(location.search);
var urlK=qs.get('k');var fromApp=qs.get('app')==='1'||standalone;
if(urlK!==null||qs.has('app')){if(urlK&&!boot.keyBad)LS.set('lz.k',urlK);history.replaceState(null,'',location.pathname==='/setup'&&urlK===null?'/setup':'/')}
if(!$('invite'))(function(){var d=el('div','invite hide');d.id='invite';$('v-setup').insertBefore(d,$('v-setup').firstChild)})();
if(!boot.remote){guest()}
else if(boot.keyBad){closed('bad')}
else{
  guest();
  api('/api/state').then(function(r){if(r&&r.ok){enter();onState(r.value);render();showConn()}})
   .catch(function(e){if(e.auth){if(e.had)closed('changed');else guest()}else if(e.off)guest();else if(LS.get('lz.k')){enter();setOffline(true);S.fails=2;setOffline(true)}else guest()});
}
})();
`
