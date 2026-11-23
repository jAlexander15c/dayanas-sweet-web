import celebrationsJavaScript from '../../celebraciones/src/admin-ui.js';
import celebrationsCss from '../../celebraciones/src/admin-ui.css';

// The caller verifies the App Proxy signature and external-login gate first.
// Static assets contain no personal data and never receive a session token. The markup is part of
// the portal page (#celebraciones-view); there is no separate Celebraciones page or iframe.
export function celebrationsView(path,env) {
  if(['/proxy/assets/celebraciones.js','/proxy/assets/celebraciones.css'].includes(path))return new Response(path.endsWith('.js')?celebrationsJavaScript:celebrationsCss,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return null;
}
