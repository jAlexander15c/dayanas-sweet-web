import {renderAdminPage} from '../../celebraciones/src/admin-page.mjs';
import celebrationsJavaScript from '../../celebraciones/src/admin-ui.js';
import celebrationsCss from '../../celebraciones/src/admin-ui.css';

// The caller verifies the App Proxy signature and external-login gate first.
// Static shell/assets contain no personal data and never receive a session token.
export function celebrationsView(path,env) {
  if(path==='/proxy/celebraciones')return renderAdminPage({shop:env.SHOPIFY_SHOP,clientId:env.SHOPIFY_CLIENT_ID,portal:true,storefrontOrigin:new URL(env.PORTAL_PUBLIC_URL).origin});
  if(['/proxy/assets/celebraciones.js','/proxy/assets/celebraciones.css'].includes(path))return new Response(path.endsWith('.js')?celebrationsJavaScript:celebrationsCss,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return null;
}
