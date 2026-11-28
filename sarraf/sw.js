/* Sarraf service worker — offline shell + background rate alerts */
const CACHE = "sarraf-v1.0.0";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, {ignoreSearch: true});
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || c.match("./index.html");
  }));
});

/* ---- tiny IndexedDB key/value ---- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("sarraf", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function get(k) { const db = await idb(); return new Promise(r => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }
async function set(k, v) { const db = await idb(); return new Promise(r => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = r; tx.onerror = r; }); }

const TITLE = {bn: "রেট অ্যালার্ট", fr: "Alerte de taux", en: "Rate alert"};
async function checkAlerts() {
  const d = await get("alerts");
  if (!d || !d.list || !d.list.some(a => a.on)) return;
  const j = await (await fetch("https://open.er-api.com/v6/latest/USD", {cache: "no-store"})).json();
  if (j.result !== "success") return;
  const R = j.rates; if (R.EUR) { R.XOF = R.EUR * 655.957; R.XAF = R.XOF; }
  let changed = false;
  for (const al of d.list) {
    if (!al.on || !R[al.a] || !R[al.b]) continue;
    const r = R[al.b] / R[al.a];
    if ((al.cond === "above" && r >= al.v) || (al.cond === "below" && r <= al.v)) {
      al.on = false; al.hitAt = Date.now(); al.hitRate = r; changed = true;
      await self.registration.showNotification("💱 " + (TITLE[d.lang] || TITLE.en), {
        body: `1 ${al.a} = ${r.toFixed(r >= 100 ? 2 : 4)} ${al.b} (${al.cond === "above" ? "≥" : "≤"} ${al.v})`,
        icon: "icon-192.png", badge: "icon-192.png", tag: "sarraf-" + al.id
      });
    }
  }
  if (changed) {
    d.ts = Date.now(); await set("alerts", d);
    (await self.clients.matchAll()).forEach(c => c.postMessage({type: "alerts"}));
  }
}
self.addEventListener("periodicsync", e => { if (e.tag === "sarraf-rates") e.waitUntil(checkAlerts().catch(() => {})); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: "window"}).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
