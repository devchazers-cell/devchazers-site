/* DevChazers intro: particles gather, big name rises, then the site slides in. No typing effect. */
(function(){
  var root=document.documentElement,el=document.getElementById('intro');
  if(!el||!root.classList.contains('intro'))return;
  var NAME='DEVCHAZERS',w=el.querySelector('.word');
  NAME.split('').forEach(function(c,i){var s=document.createElement('span'),t=document.createElement('i');t.textContent=c;t.style.animationDelay=(0.7+i*0.07)+'s';s.appendChild(t);w.appendChild(s)});
  w.setAttribute('aria-label','DevChazers');
  /* particles */
  var cv=el.querySelector('canvas'),cx=cv.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2),W,H,P=[],t0=performance.now(),raf;
  function size(){W=cv.width=innerWidth*dpr;H=cv.height=innerHeight*dpr}size();
  for(var i=0;i<70;i++){var a=Math.random()*6.283,r=Math.max(W,H)*(0.45+Math.random()*0.4);P.push({x:W/2+Math.cos(a)*r,y:H/2+Math.sin(a)*r,a:a,s:(1+Math.random()*2.2)*dpr,d:Math.random()*0.4,c:Math.random()>.5?'#ff6b4a':'#ffb938'})}
  function draw(now){var t=(now-t0)/1000;cx.clearRect(0,0,W,H);
    P.forEach(function(p){var k=Math.min(1,Math.max(0,(t-p.d)/1.0)),e=1-Math.pow(1-k,3),
      tx=W/2+Math.cos(p.a+t*1.5)*Math.min(W,H)*0.12,ty=H/2+Math.sin(p.a+t*1.5)*Math.min(W,H)*0.12,
      x=p.x+(tx-p.x)*e,y=p.y+(ty-p.y)*e,burst=t>1.5?Math.min(1,(t-1.5)/0.5):0;
      x+=Math.cos(p.a)*burst*W*0.5;y+=Math.sin(p.a)*burst*H*0.5;
      cx.globalAlpha=(1-burst)*Math.min(1,k*1.5);cx.fillStyle=p.c;cx.beginPath();cx.arc(x,y,p.s,0,6.283);cx.fill()});
    if(t<2.2)raf=requestAnimationFrame(draw)}
  raf=requestAnimationFrame(draw);
  /* finish */
  var done=false;
  function finish(){if(done)return;done=true;cancelAnimationFrame(raf);el.classList.add('out');
    setTimeout(function(){root.classList.remove('intro');root.classList.add('intro-done');el.classList.add('gone');try{sessionStorage.setItem('dc_intro','1')}catch(e){}},880)}
  setTimeout(finish,2600);
  el.querySelector('.skip').addEventListener('click',finish);
  addEventListener('keydown',function(e){if(e.key==='Escape')finish()});
})();
