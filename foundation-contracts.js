/* v9.8.0-phase5. Presentation/session contracts only; no underwriting formulas. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./integration-core.js'));
 else root.STMFoundation=factory(root.STMIntegration);
})(typeof window!=='undefined'?window:globalThis,function(C){
 'use strict';
 const AUTH_HASH_KEYS=['access_token','refresh_token','expires_in','expires_at','token_type','type','provider_token','provider_refresh_token'];
 const AUTH_ERROR_KEYS=['error','error_code','error_description'];
 const AUTH_RETURN_KEY='stm-login-destination-v9';
 function validRoute(value){return typeof value==='string'&&Object.hasOwn(C.ROUTES,value);}
 function shellRoutes(){return Object.fromEntries(Object.entries(C.ROUTES).map(([id,r])=>[id,{surface:r[0],nav:r[1],hash:r[2],title:r[3]}]));}
 function isEditable(target){return !!target&&(target.isContentEditable||!!target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]'));}
 function theme(value){return value==='dark'?'dark':'light';}
 function cleanIdentity(value){return value==null||value===''?null:String(value);}
 // Keep callback secrets in a short-lived closure, never in storage or messages.
 // The original SDK inside engine-platform remains the only callback consumer.
 function readLocation(href,remembered){
  const u=new URL(href,'https://app.invalid/'),hp=new URLSearchParams(u.hash.slice(1));
  const authHash=AUTH_HASH_KEYS.some(k=>hp.has(k)),hasError=AUTH_ERROR_KEYS.some(k=>hp.has(k)||u.searchParams.has(k)),code=u.searchParams.get('code');
  const callback=!!code||authHash||hasError;
  let id=validRoute(u.searchParams.get('stm_route'))?u.searchParams.get('stm_route'):null;
  if(!id&&!callback&&u.hash)id=C.resolveRoute(u.hash);
  if(!id&&callback&&validRoute(remembered?.route))id=remembered.route;
  if(!id)id=!u.hash&&/workbench(?:\.html)?\/?$/.test(u.pathname)?'wb-deal':'queue';
  const sid=cleanIdentity(u.searchParams.get('submission'))||(callback?cleanIdentity(remembered?.submission):null);
  let hostSuffix='',error='';
  if(hasError)error='The sign-in link could not be accepted. Request a new link and try again.';
  else if(code)hostSuffix='?'+new URLSearchParams({code}).toString();
  else if(authHash){
   if(!hp.get('access_token')||!hp.get('refresh_token'))error='The sign-in link is incomplete. Request a new link and try again.';
   else {const safe=new URLSearchParams();for(const k of AUTH_HASH_KEYS)if(hp.has(k))safe.set(k,hp.get(k));hostSuffix='#'+safe.toString();}
  }
  for(const k of ['code','stm_route',...AUTH_ERROR_KEYS])u.searchParams.delete(k);
  if(sid)u.searchParams.set('submission',sid);else u.searchParams.delete('submission');
  u.hash=C.ROUTES[id][2];
  return {route:id,submission:sid,callback,hostSuffix,error,cleanUrl:u.pathname+u.search+u.hash};
 }
 function loginRedirect(href,route,submission){const u=new URL('platform.html',href);u.search='';u.hash='';u.searchParams.set('stm_route',validRoute(route)?route:'queue');if(cleanIdentity(submission))u.searchParams.set('submission',String(submission));return u.href;}
 function destination(href){const u=new URL(href,'https://app.invalid/');return {route:C.resolveRoute(u.hash),submission:cleanIdentity(u.searchParams.get('submission'))};}
 function identityStamp(actor,submission){return JSON.stringify([cleanIdentity(actor),cleanIdentity(submission)]);}
 return Object.freeze({AUTH_RETURN_KEY,validRoute,shellRoutes,isEditable,theme,readLocation,loginRedirect,destination,identityStamp});
});
