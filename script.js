/* Near Ex - all page scripts in one file.
 * Each page selects its logic with <body data-page="index|portal|admin|drive|store">. */
(() => {
  'use strict';

  /* ---------- Config ---------- */
  const CONFIG = {
    loginUrl: 'https://script.google.com/macros/s/AKfycbwkDjXXLwfGRHkdkMlp2P94cZm6iXX4n0yJdCfbDkTffadNvsRkrDk09v0cyF_ALRyWNQ/exec',
    submitUrl: 'https://script.google.com/macros/s/AKfycbxd_Ad3embiPBLJc-37FAaOeEHbRN04fTM8RvmFC4M1VvyJDHjMLyNBr9JruJUo9icU1w/exec',
    zxingUrl: 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
    loginPage: 'index.html',
    portalPage: 'portal.html',
    maxImageSide: 1000,
    jpegQuality: 0.7,
    imageNameWithTime: true, // adds HHMMSS so two uploads from one store on the same day don't share a name
    requestTimeoutMs: 20000,
    uploadTimeoutMs: 60000
  };

  /* ---------- Helpers ---------- */
  const $ = (id) => document.getElementById(id);

  const session = {
    key: 'username',
    get() { try { return sessionStorage.getItem(this.key); } catch (_) { return null; } },
    set(v) { try { sessionStorage.setItem(this.key, v); } catch (_) {} },
    clear() { try { sessionStorage.removeItem(this.key); } catch (_) {} }
  };

  // Client-side convenience only (not real security): send visitors without a session to login.
  function requireLogin() {
    if (!session.get()) location.replace(CONFIG.loginPage);
  }

  async function fetchWithTimeout(url, options = {}, ms = CONFIG.requestTimeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  }

  // Photo file name = STORE_YYYYMMDD[_HHMMSS].jpg, using the device's local date (not UTC)
  function buildImageName(storeText) {
    const store = String(storeText).trim().toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'STORE';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const time = CONFIG.imageNameWithTime ? `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : '';
    return `${store}_${date}${time}.jpg`;
  }

  /* ---------- index.html : login ---------- */
  function initLogin() {
    const form = $('loginForm'), btn = $('loginBtn'), msg = $('message');
    const show = (text, type = '') => { msg.textContent = text; msg.className = 'msg ' + type; };

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); // also lets the Enter key submit
      const user = $('username').value.trim();
      const pass = $('password').value;
      btn.disabled = true;
      show('Checking credentials...');
      try {
        const url = `${CONFIG.loginUrl}?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
        const result = await (await fetchWithTimeout(url)).json();
        if (result.success) {
          session.set(user);
          show(`${result.message} Redirecting...`, 'ok');
          setTimeout(() => { location.href = CONFIG.portalPage; }, 700);
        } else {
          show(result.message || 'Login failed.', 'err');
          btn.disabled = false;
        }
      } catch (_) {
        show('Connection error. Try again.', 'err');
        btn.disabled = false;
      }
    });
  }

  /* ---------- portal.html ---------- */
  function initPortal() {
    requireLogin();
    // Optional: only wired up if a #logout button exists in the page.
    $('logout')?.addEventListener('click', () => {
      session.clear();
      location.href = CONFIG.loginPage;
    });
  }

  /* ---------- store.html : request form + barcode scanner ---------- */
  function initStore() {
    requireLogin();

    const form = $('myForm'), btn = $('submitBtn'), err = $('error');

    // Load, downscale and JPEG-compress a photo (smaller upload on mobile data)
    function compressImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, CONFIG.maxImageSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', CONFIG.jpegQuality));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
        img.src = url;
      });
    }

    // Text boxes: caps keyboard on phones, and the value itself is forced to UPPER CASE as you type
    form.querySelectorAll('input[type="text"]').forEach((input) => {
      input.setAttribute('autocapitalize', 'characters');
      input.addEventListener('input', () => {
        const { selectionStart: a, selectionEnd: b } = input;
        input.value = input.value.toUpperCase();
        try { input.setSelectionRange(a, b); } catch (_) {} // keep the cursor where it was
      });
    });

    function setBusy(busy) {
      btn.disabled = busy;
      btn.textContent = busy ? 'SUBMITTING...' : 'SUBMIT REQUEST';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!form.reportValidity()) return;
      setBusy(true);
      try {
        const val = (id) => $(id).value.trim().toUpperCase();
        const payload = {
          store_name: val('district_area'),   // JSON keys are fixed by the Apps Script backend
          store_district: val('store_number'),
          store_manager: val('store_manager'),
          store_cluster: val('store_cluster'),
          item_category: val('item_category'),
          item_sku: val('item_sku'),
          expiration_date: val('expiration_date'),
          suggested_promo: val('suggested_promo'),
          image_data: await compressImage($('item_image').files[0]),
          image_name: buildImageName(val('store_number'))
        };
        // no-cors: the response is opaque, so "no network error" is the best success signal available
        await fetchWithTimeout(CONFIG.submitUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        }, CONFIG.uploadTimeoutMs);
        form.style.display = 'none';
        $('thanks').style.display = 'block';
      } catch (ex) {
        console.error(ex);
        err.textContent = 'Submission failed. Check your connection and try again.';
      } finally {
        setBusy(false);
      }
    });

    $('againBtn').addEventListener('click', () => {
      form.reset();
      $('thanks').style.display = 'none';
      form.style.display = 'block';
    });

    /* --- Barcode scanner: fills the SKU field automatically --- */
    const scanner = $('scanner'), video = $('scanVideo'), scanMsg = $('scanMsg');
    let stream = null, timer = null, zxing = null, busy = false;

    function stopScan() {
      clearInterval(timer); timer = null;
      if (zxing) { try { zxing.reset(); } catch (_) {} zxing = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      video.srcObject = null;
      scanner.hidden = true;
    }

    function onCode(raw) {
      if (scanner.hidden) return; // already closed
      const digits = String(raw).replace(/\D/g, ''); // SKU field is numeric
      if (!digits) { scanMsg.textContent = 'Not a numeric code. Keep scanning...'; return; }
      $('item_sku').value = digits;
      if (navigator.vibrate) navigator.vibrate(100);
      stopScan();
    }

    // Fallback for browsers without BarcodeDetector (e.g. iPhone Safari)
    function loadZXing() {
      return new Promise((resolve, reject) => {
        if (window.ZXing) return resolve();
        const s = document.createElement('script');
        s.src = CONFIG.zxingUrl;
        s.onload = resolve;
        s.onerror = () => reject(new Error('zxing failed to load'));
        document.head.appendChild(s);
      });
    }

    async function startScan() {
      scanner.hidden = false;
      scanMsg.textContent = 'Point the camera at the barcode';
      try {
        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector();
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          video.srcObject = stream;
          await video.play();
          timer = setInterval(async () => {
            if (busy) return;
            busy = true;
            try { const found = await detector.detect(video); if (found.length) onCode(found[0].rawValue); }
            catch (_) {}
            finally { busy = false; }
          }, 250);
        } else {
          await loadZXing();
          zxing = new ZXing.BrowserMultiFormatReader();
          zxing.decodeFromVideoDevice(null, video, (result) => { if (result) onCode(result.getText()); });
        }
      } catch (ex) {
        console.error(ex);
        scanMsg.textContent = 'Camera unavailable. Allow camera access (https required) or type the code.';
      }
    }

    $('scanBtn').addEventListener('click', startScan);
    $('scanCancel').addEventListener('click', stopScan);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
  }

  /* ---------- drive.html : photo list, newest first ---------- */
  function initDrive() {
    requireLogin();
    const list = $('fileList'), frame = $('driveFrame'), status = $('driveStatus');

    const useEmbed = () => { list.hidden = true; status.hidden = true; frame.hidden = false; frame.src = frame.dataset.src; };
    if (!CONFIG.driveListUrl) return useEmbed();

    status.textContent = 'Loading files...';
    fetchWithTimeout(CONFIG.driveListUrl)
      .then((r) => r.json())
      .then((files) => {
        files.sort((a, b) => b.created - a.created); // newest first
        if (!files.length) { status.textContent = 'No files yet.'; return; }
        const frag = document.createDocumentFragment();
        for (const f of files) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.className = 'file'; a.href = f.url; a.target = '_blank'; a.rel = 'noopener';
          const img = document.createElement('img');
          img.alt = ''; img.loading = 'lazy';
          img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w120`;
          img.onerror = () => { img.style.visibility = 'hidden'; };
          const box = document.createElement('div');
          const name = document.createElement('b'); name.textContent = f.name;
          const when = document.createElement('small');
          when.textContent = new Date(f.created).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
          box.append(name, when);
          a.append(img, box); li.append(a); frag.append(li);
        }
        list.append(frag);
        status.hidden = true;
        list.hidden = false;
      })
      .catch(useEmbed); // list service unreachable -> fall back to the plain embed
  }

  /* ---------- Page router ---------- */
  const pages = {
    index: initLogin,
    portal: initPortal,
    admin: requireLogin,
    drive: initDrive,
    store: initStore
  };
  const init = pages[document.body.dataset.page];
  if (init) init();
})();
