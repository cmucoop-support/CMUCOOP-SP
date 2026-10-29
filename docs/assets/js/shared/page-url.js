function pageUrl(file, fallback){ if (/google(usercontent)?\.com$/.test(location.hostname)) return fallback; return location.origin + location.pathname.replace(/[^\/]*$/, '') + file; }
