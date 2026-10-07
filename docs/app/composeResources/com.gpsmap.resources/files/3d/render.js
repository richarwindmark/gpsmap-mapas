// GPSMap: video de la ruta (como Relive), creado en el propio dispositivo sin servidor.
// Presentacion -> vuelo 3D por la ruta (camara de seguimiento) con paradas en las fotos y videos hechos en ella
// -> resumen final. Cada fotograma se dibuja con el mapa ya cargado (no depende de lo rapido que vaya el movil),
// se compone en un lienzo con los rotulos y se codifica en H.264 (WebCodecs) dentro de un MP4 (mp4-muxer, MIT).
const FPS = window.GPSMAP_FPS || 30;   // (las pruebas automaticas usan menos)
let rendering = false, cancelRender = false;

function renderSupported() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined'; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- panel ----------
function renderPanel() {
  let p = document.getElementById('render');
  if (p) return p;
  p = document.createElement('div'); p.id = 'render'; p.className = 'panel';
  p.innerHTML = `
    <b>Vídeo de la ruta</b>
    <div id="rtext">Un vuelo en 3D por tu recorrido${cfg && cfg.media && cfg.media.length ? ', con tus ' + cfg.media.length + ' fotos y vídeos en el sitio donde los hiciste' : ''}. Se crea en este dispositivo y se guarda en tu galería.</div>
    <div id="rprog" style="display:none"><div id="rbar"></div></div>
    <div id="rstatus"></div>
    <div class="rbtns"><button class="btn on" id="rgo">🎬 Crear vídeo</button><button class="btn" id="rclose">Cerrar</button></div>`;
  document.body.appendChild(p);
  document.getElementById('rgo').onclick = () => { if (rendering) { cancelRender = true; } else startRender(); };
  document.getElementById('rclose').onclick = () => { if (rendering) cancelRender = true; p.style.display = 'none'; };
  return p;
}
function openRenderPanel() {
  const p = renderPanel(); p.style.display = 'block';
  if (!renderSupported()) {
    document.getElementById('rstatus').textContent = 'Este navegador no permite crear vídeos. Prueba con la app de Android o con Chrome/Edge en el PC.';
    document.getElementById('rgo').style.display = 'none';
  }
}
function setStatus(s, frac) {
  document.getElementById('rstatus').textContent = s;
  if (frac != null) { document.getElementById('rprog').style.display = 'block'; document.getElementById('rbar').style.width = Math.round(frac * 100) + '%'; }
}

// ---------- utilidades de dibujo ----------
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function cover(c, img, W, H, scale) {
  const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height;
  const s = Math.max(W / iw, H / ih) * (scale || 1);
  c.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

// ---------- el render ----------
async function startRender() {
  if (!route || rendering) return;
  rendering = true; cancelRender = false;
  document.getElementById('rgo').textContent = '■ Cancelar';
  document.body.classList.add('rendering');
  const wasPlaying = playing; if (playing) setPlaying(false);
  hideSummary();
  ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate'].forEach(h => map[h] && map[h].disable());
  const landscape = innerWidth > innerHeight;
  const W = landscape ? 1280 : 720, H = landscape ? 720 : 1280;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d');
  let encoder, muxer, frame = 0;
  try {
    // codificador H.264 (el primero que admita el dispositivo)
    let codec = null;
    for (const k of ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1.42001f']) {
      try { const s = await VideoEncoder.isConfigSupported({ codec: k, width: W, height: H, bitrate: 6_000_000, framerate: FPS }); if (s.supported) { codec = k; break; } } catch (e) {}
    }
    if (!codec) throw new Error('el dispositivo no puede codificar vídeo H.264');
    muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
    let encErr = null;
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
    encoder.configure({ codec, width: W, height: H, bitrate: 6_000_000, framerate: FPS });
    const emit = async () => {
      if (encErr) throw encErr;
      const vf = new VideoFrame(out, { timestamp: Math.round(frame * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(vf, { keyFrame: frame % (FPS * 2) === 0 }); vf.close(); frame++;
      while (encoder.encodeQueueSize > 8) await sleep(4);
    };

    // captura del mapa: se espera a que esten cargadas las teselas de lo que se ve (con un limite)
    async function grabMap(maxWaitMs) {
      if (!map.areTilesLoaded()) await Promise.race([new Promise(r => map.once('idle', r)), sleep(maxWaitMs == null ? 1500 : maxWaitMs)]);
      await new Promise(r => { map.once('render', () => { c.drawImage(map.getCanvas(), ...coverRect(map.getCanvas(), W, H)); r(); }); map.triggerRepaint(); });
    }
    function coverRect(src, W, H) { const s = Math.max(W / src.width, H / src.height); const w = src.width * s, h = src.height * s; return [(W - w) / 2, (H - h) / 2, w, h]; }

    // rotulos
    const name = cfg.name || 'Ruta';
    const st = cfg.summary || {};
    const big = Math.round(H * (landscape ? 0.065 : 0.042));
    function titleCard(alpha) {
      c.save(); c.globalAlpha = alpha;
      const g = c.createLinearGradient(0, 0, 0, H * 0.45); g.addColorStop(0, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H * 0.45);
      c.fillStyle = '#fff'; c.font = `700 ${big}px system-ui, sans-serif`; c.textBaseline = 'top';
      c.fillText(name, W * 0.06, H * 0.07, W * 0.88);
      c.font = `500 ${Math.round(big * 0.55)}px system-ui, sans-serif`; c.fillStyle = '#FFE066';
      const line = [fmtKm(total), st.gain != null ? '↑ ' + Math.round(st.gain) + ' m' : null, st.time ? fmtDur(st.time) : null].filter(Boolean).join('  ·  ');
      c.fillText(line, W * 0.06, H * 0.07 + big * 1.35, W * 0.88);
      c.restore();
    }
    function hud(d, ele) {
      const s = Math.round(big * 0.5), pad = s * 0.6;
      const text = fmtKm(d) + (ele != null ? '   ' + Math.round(ele) + ' m' : '');
      c.font = `600 ${s}px system-ui, sans-serif`;
      const w = c.measureText(text).width + pad * 2, h = s + pad * 1.4;
      c.fillStyle = 'rgba(20,20,15,0.55)'; roundRect(c, W * 0.05, H - h - H * 0.05, w, h, h / 2); c.fill();
      c.fillStyle = '#FFE066'; c.textBaseline = 'middle'; c.fillText(text, W * 0.05 + pad, H - h / 2 - H * 0.05);
      c.font = `600 ${Math.round(s * 0.8)}px system-ui, sans-serif`; c.fillStyle = 'rgba(255,255,255,0.85)'; c.textBaseline = 'top';
      c.fillText(name, W * 0.05, H * 0.04, W * 0.9);
    }
    function summaryCard(alpha) {
      c.save(); c.globalAlpha = alpha;
      const bw = W * 0.86, bh = H * (landscape ? 0.5 : 0.3), x = (W - bw) / 2, y = (H - bh) / 2;
      c.fillStyle = 'rgba(255,255,255,0.93)'; roundRect(c, x, y, bw, bh, 28); c.fill();
      c.fillStyle = '#1F6F4A'; c.font = `700 ${Math.round(big * 0.8)}px system-ui, sans-serif`; c.textBaseline = 'top';
      c.fillText(name, x + bw * 0.06, y + bh * 0.08, bw * 0.88);
      const items = [['Distancia', fmtKm(st.distance || total)], ['Desnivel +', Math.round(st.gain || 0) + ' m'], ['Tiempo', st.time ? fmtDur(st.time) : '—'],
        ['Desnivel −', Math.round(st.loss || 0) + ' m'], ['Alt. máx.', st.maxEle != null ? Math.round(st.maxEle) + ' m' : '—'], ['Alt. mín.', st.minEle != null ? Math.round(st.minEle) + ' m' : '—']];
      items.forEach(([k, v], i) => {
        const cx = x + bw * (0.06 + (i % 3) * 0.31), cy = y + bh * (0.38 + Math.floor(i / 3) * 0.3);
        c.fillStyle = '#4a574f'; c.font = `500 ${Math.round(big * 0.38)}px system-ui, sans-serif`; c.fillText(k, cx, cy);
        c.fillStyle = '#14201A'; c.font = `700 ${Math.round(big * 0.56)}px system-ui, sans-serif`; c.fillText(v, cx, cy + big * 0.48);
      });
      c.restore();
    }

    // tiempos del video
    const flyFrames = Math.round(Math.min(50, Math.max(15, total / 1000 * 2.6)) * FPS);
    const media = (cfg.media || []).slice().sort((a, b) => a.d - b.d);
    const mediaFrames = media.reduce((s, m) => s + (m.type === 'video' ? 8 : 3) * FPS, 0);
    const allFrames = FPS * 3 + FPS * 2 + flyFrames + mediaFrames + FPS * 4;
    const progress = () => setStatus('Creando el vídeo… ' + Math.min(99, Math.round(frame / allFrames * 100)) + ' %', frame / allFrames);
    const check = () => { if (cancelRender) throw new Error('cancelado'); };

    // 1) presentacion: toda la ruta desde arriba, con el titulo
    showProgress(null);
    const bounds = route.reduce((bb, p) => bb.extend([p[0], p[1]]), new maplibregl.LngLatBounds([route[0][0], route[0][1]], [route[0][0], route[0][1]]));
    const startBrg = camBearingAt(0);
    // (cameraForBounds no devuelve la inclinacion: se pone aparte)
    const over = Object.assign({ bearing: startBrg }, map.cameraForBounds(bounds, { padding: Math.min(innerWidth, innerHeight) * 0.18, bearing: startBrg, pitch: 50 }), { pitch: 50 });
    map.jumpTo(over);
    setStatus('Cargando el relieve de la zona…', 0);
    await grabMap(8000);
    const still = document.createElement('canvas'); still.width = W; still.height = H; still.getContext('2d').drawImage(out, 0, 0);
    for (let i = 0; i < FPS * 3; i++) {
      check();
      c.drawImage(still, 0, 0);
      titleCard(Math.min(1, i / (FPS * 0.6)));
      await emit(); if (i % 10 === 0) progress();
    }
    // 2) la camara baja hasta detras del punto de salida (vuelo suave)
    showProgress(0.00001);
    t = 0; camT = null; update(0, true, 0);
    const end = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    for (let i = 1; i <= FPS * 2; i++) {
      check();
      const k = i / (FPS * 2), e = k * k * (3 - 2 * k);
      let db = end.bearing - over.bearing; while (db > 180) db -= 360; while (db < -180) db += 360;
      map.jumpTo({
        center: [over.center.lng + (end.center.lng - over.center.lng) * e, over.center.lat + (end.center.lat - over.center.lat) * e],
        zoom: over.zoom + (end.zoom - over.zoom) * e, bearing: over.bearing + db * e, pitch: over.pitch + (end.pitch - over.pitch) * e,
      });
      await grabMap(1200);
      titleCard(Math.max(0, 1 - k * 2));
      await emit(); if (i % 5 === 0) progress();
    }
    // 3) el recorrido, con paradas en las fotos y videos
    let mi = 0;
    t = 0; camT = null; update(0, true, 0);
    for (let i = 0; i <= flyFrames; i++) {
      check();
      const d = i / flyFrames * total;
      t = d / total * duration();
      update(d, true, 1000 / FPS);
      await grabMap(1500);
      hud(d, at(d)[2]);
      await emit(); if (i % 5 === 0) progress();
      // ¿se ha llegado al sitio de una foto o un video?
      while (mi < media.length && media[mi].d <= d) {
        const m = media[mi++];
        const base = document.createElement('canvas'); base.width = W; base.height = H; base.getContext('2d').drawImage(out, 0, 0);
        try {
          if (m.type === 'video') {
            const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = m.url;
            await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(rej, 15000); });
            const n = Math.round(Math.min(8, v.duration || 8) * FPS);
            for (let j = 0; j < n; j++) {
              check();
              v.currentTime = j / FPS;
              await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
              c.fillStyle = '#000'; c.fillRect(0, 0, W, H); cover(c, v, W, H, 1);
              const a = Math.min(1, j / (FPS * 0.4), (n - j) / (FPS * 0.4));
              if (a < 1) { c.globalAlpha = 1 - a; c.drawImage(base, 0, 0); c.globalAlpha = 1; }
              await emit(); if (j % 10 === 0) progress();
            }
          } else {
            const img = await loadImage(m.url);
            const n = FPS * 3;
            for (let j = 0; j < n; j++) {
              check();
              c.drawImage(base, 0, 0);
              const a = Math.min(1, j / (FPS * 0.4), (n - j) / (FPS * 0.4));
              c.globalAlpha = a; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
              cover(c, img, W, H, 1 + 0.08 * j / n);
              c.globalAlpha = 1;
              await emit(); if (j % 10 === 0) progress();
            }
          }
        } catch (e) { if (cancelRender) throw e; console.warn('video: no se pudo usar ' + m.url + ': ' + e); }
      }
    }
    // 4) final: toda la ruta con el resumen
    showProgress(null);
    map.jumpTo(Object.assign({}, map.cameraForBounds(bounds, { padding: Math.min(innerWidth, innerHeight) * 0.15, bearing: map.getBearing(), pitch: 45 }), { bearing: map.getBearing(), pitch: 45 }));
    await grabMap(6000);
    const fin = document.createElement('canvas'); fin.width = W; fin.height = H; fin.getContext('2d').drawImage(out, 0, 0);
    for (let i = 0; i < FPS * 4; i++) {
      check();
      c.drawImage(fin, 0, 0);
      summaryCard(Math.min(1, i / (FPS * 0.8)));
      await emit(); if (i % 10 === 0) progress();
    }
    setStatus('Terminando el vídeo…', 1);
    await encoder.flush();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    setStatus('Guardando (' + (blob.size / 1e6).toFixed(1) + ' MB)…', 1);
    const msg = await saveVideo(blob, name);
    setStatus('✓ ' + msg, 1);
  } catch (e) {
    setStatus(cancelRender ? 'Cancelado.' : 'No se pudo crear el vídeo: ' + (e && e.message || e), null);
    console.error('video: ' + (e && e.stack || e));
  } finally {
    try { encoder && encoder.state !== 'closed' && encoder.close(); } catch (e) {}
    rendering = false;
    document.getElementById('rgo').textContent = '🎬 Crear vídeo';
    document.body.classList.remove('rendering');
    ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate'].forEach(h => map[h] && map[h].enable());
    if (wasPlaying) setPlaying(true);
  }
}

/** Guarda el video: en la app (galeria del movil / carpeta Videos del PC) o descargandolo en la web. */
async function saveVideo(blob, name) {
  if (bridge && bridge.saveVideo) { bridge.saveVideo(blob, name + ' - GPSMap.mp4'); return 'Vídeo descargado'; }
  try {
    const r = await fetch('save-video?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    const txt = await r.text();
    if (r.ok) return txt;
    throw new Error(txt);
  } catch (e) {
    // ultimo recurso: descarga
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + ' - GPSMap.mp4';
    document.body.appendChild(a); a.click(); a.remove();
    return 'Vídeo descargado';
  }
}
