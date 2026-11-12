(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("fileInput");
  var pickBtn = document.getElementById("pickBtn");
  var filelistWrap = document.getElementById("filelistWrap");
  var filelist = document.getElementById("filelist");
  var fileCount = document.getElementById("fileCount");
  var summaryBar = document.getElementById("summaryBar");
  var summaryText = document.getElementById("summaryText");
  var mergeBtn = document.getElementById("mergeBtn");
  var statusEl = document.getElementById("status");

  /** @type {{id:string, file:File, name:string, size:number, bytes:Uint8Array, pages:number|null, error:string|null}[]} */
  var entries = [];
  var uid = 0;
  var dragId = null;

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function updateDropzoneMode() {
    dropzone.classList.toggle("compact", entries.length > 0);
    dropzone.querySelector(".dropzone-title").textContent =
      entries.length > 0 ? "PDF·이미지 더 추가하기" : "PDF·이미지 파일을 이곳에 끌어다 놓으세요";
  }

  function render() {
    filelistWrap.hidden = entries.length === 0;
    summaryBar.hidden = entries.length === 0;
    updateDropzoneMode();

    filelist.innerHTML = "";
    var totalPages = 0, totalSize = 0;

    entries.forEach(function (entry, i) {
      totalSize += entry.size;
      if (entry.pages != null) totalPages += entry.pages;

      var li = document.createElement("li");
      li.className = "file-row";
      li.draggable = true;
      li.dataset.id = entry.id;

      var metaText = entry.error
        ? entry.error
        : entry.kind === "pdf"
          ? (entry.pages != null ? entry.pages + "쪽 · " + fmtSize(entry.size) : "읽는 중…")
          : (entry.width != null ? entry.width + "×" + entry.height + " · " + fmtSize(entry.size) : "읽는 중…");

      var thumbHtml = entry.kind === "image" && entry.thumbUrl
        ? '<span class="thumb"><img src="' + entry.thumbUrl + '" alt=""></span>'
        : '<span class="thumb thumb-doc" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>';

      li.innerHTML =
        '<span class="grip" aria-hidden="true">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>' +
        '</span>' +
        '<span class="order-badge">' + (i + 1) + '</span>' +
        thumbHtml +
        '<span class="file-info">' +
          '<span class="file-name" title="' + escapeHtml(entry.name) + '">' + escapeHtml(entry.name) + '</span>' +
          '<span class="file-meta' + (entry.error ? ' error' : '') + '">' + escapeHtml(metaText) + '</span>' +
        '</span>' +
        '<span class="row-controls">' +
          '<button type="button" class="icon-btn" data-action="up" aria-label="위로 이동"' + (i === 0 ? ' disabled' : '') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg></button>' +
          '<button type="button" class="icon-btn" data-action="down" aria-label="아래로 이동"' + (i === entries.length - 1 ? ' disabled' : '') + '><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
          '<button type="button" class="icon-btn remove" data-action="remove" aria-label="목록에서 제거"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</span>';

      filelist.appendChild(li);
    });

    fileCount.textContent = entries.length + "개 파일";
    var validCount = entries.filter(function (e) { return !e.error; }).length;
    summaryText.innerHTML = "총 <b>" + validCount + "개</b> 파일 · <b>" + totalPages + "쪽</b> · <b>" + fmtSize(totalSize) + "</b>";

    mergeBtn.disabled = validCount === 0;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isPdfFile(f) {
    return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  }

  function isImageFile(f) {
    return /^image\/(jpe?g|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
  }

  function imgMime(f) {
    return (/\.png$/i.test(f.name) || f.type === "image/png") ? "image/png" : "image/jpeg";
  }

  // Redraws the image onto a canvas and re-encodes it before handing it to
  // pdf-lib. This does two things: it guarantees a baseline (non-progressive,
  // non-interlaced) encoding pdf-lib can always embed, and — because the
  // <img> element already applies EXIF rotation when it decodes — it bakes
  // that rotation into the pixels, so phone photos don't end up sideways.
  function normalizeImage(url, mime) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d").drawImage(img, 0, 0);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("encode-failed")); return; }
            blob.arrayBuffer().then(function (buf) {
              resolve({ width: img.naturalWidth, height: img.naturalHeight, bytes: new Uint8Array(buf), mime: mime });
            }, reject);
          }, mime, mime === "image/jpeg" ? 0.92 : undefined);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error("decode-failed")); };
      img.src = url;
    });
  }

  async function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return isPdfFile(f) || isImageFile(f);
    });
    if (files.length === 0) return;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var kind = isPdfFile(file) ? "pdf" : "image";
      var entry = {
        id: "f" + (++uid),
        file: file,
        name: file.name,
        size: file.size,
        kind: kind,
        bytes: null,
        mime: null,
        pages: null,
        width: null,
        height: null,
        thumbUrl: null,
        error: null
      };
      entries.push(entry);
      render();

      if (kind === "pdf") {
        try {
          var buf = await file.arrayBuffer();
          var bytes = new Uint8Array(buf);
          var doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
          if (doc.isEncrypted) {
            entry.error = "암호로 보호된 파일이라 열 수 없어요";
          } else {
            entry.bytes = bytes;
            entry.pages = doc.getPageCount();
          }
        } catch (err) {
          entry.error = "PDF를 읽을 수 없는 파일이에요";
        }
      } else {
        entry.thumbUrl = URL.createObjectURL(file);
        try {
          var norm = await normalizeImage(entry.thumbUrl, imgMime(file));
          entry.width = norm.width;
          entry.height = norm.height;
          entry.bytes = norm.bytes;
          entry.mime = norm.mime;
          entry.pages = 1;
        } catch (err) {
          entry.error = "이미지를 열 수 없는 파일이에요";
        }
      }
      render();
    }
  }

  function moveEntry(id, dir) {
    var idx = entries.findIndex(function (e) { return e.id === id; });
    var swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= entries.length) return;
    var tmp = entries[idx];
    entries[idx] = entries[swapWith];
    entries[swapWith] = tmp;
    render();
  }

  function removeEntry(id) {
    var target = entries.find(function (e) { return e.id === id; });
    if (target && target.thumbUrl) URL.revokeObjectURL(target.thumbUrl);
    entries = entries.filter(function (e) { return e.id !== id; });
    render();
  }

  // --- events: file picking ---
  pickBtn.addEventListener("click", function (e) { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // --- events: row controls ---
  filelist.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var id = btn.closest(".file-row").dataset.id;
    if (btn.dataset.action === "up") moveEntry(id, -1);
    else if (btn.dataset.action === "down") moveEntry(id, 1);
    else if (btn.dataset.action === "remove") removeEntry(id);
  });

  // --- events: drag reorder ---
  filelist.addEventListener("dragstart", function (e) {
    var row = e.target.closest(".file-row");
    if (!row) return;
    dragId = row.dataset.id;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  filelist.addEventListener("dragend", function (e) {
    var row = e.target.closest(".file-row");
    if (row) row.classList.remove("dragging");
    filelist.querySelectorAll(".drop-target").forEach(function (r) { r.classList.remove("drop-target"); });
    dragId = null;
  });
  filelist.addEventListener("dragover", function (e) {
    e.preventDefault();
    var row = e.target.closest(".file-row");
    filelist.querySelectorAll(".drop-target").forEach(function (r) { r.classList.remove("drop-target"); });
    if (row && row.dataset.id !== dragId) row.classList.add("drop-target");
  });
  filelist.addEventListener("drop", function (e) {
    e.preventDefault();
    var row = e.target.closest(".file-row");
    if (!row || !dragId || row.dataset.id === dragId) return;
    var fromIdx = entries.findIndex(function (x) { return x.id === dragId; });
    var toIdx = entries.findIndex(function (x) { return x.id === row.dataset.id; });
    if (fromIdx < 0 || toIdx < 0) return;
    var moved = entries.splice(fromIdx, 1)[0];
    entries.splice(toIdx, 0, moved);
    render();
  });

  // --- merge (standard browser download, no server involved) ---
  mergeBtn.addEventListener("click", async function () {
    var valid = entries.filter(function (e) { return e.bytes && !e.error; });
    if (valid.length === 0) return;

    mergeBtn.disabled = true;
    mergeBtn.classList.add("loading");
    setStatus("합치는 중…");

    try {
      var merged = await PDFLib.PDFDocument.create();
      for (var i = 0; i < valid.length; i++) {
        var entry = valid[i];
        try {
          if (entry.kind === "pdf") {
            var src = await PDFLib.PDFDocument.load(entry.bytes);
            var pages = await merged.copyPages(src, src.getPageIndices());
            pages.forEach(function (p) { merged.addPage(p); });
          } else {
            var img = entry.mime === "image/png"
              ? await merged.embedPng(entry.bytes)
              : await merged.embedJpg(entry.bytes);
            var page = merged.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          }
        } catch (innerErr) {
          throw new Error(entry.name + " 파일을 처리하는 중 문제가 생겼어요");
        }
      }
      var outBytes = await merged.save();

      var d = new Date();
      var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
      var blob = new Blob([outBytes], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "합친문서_" + stamp + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

      setStatus("저장했어요.", "success");
    } catch (err) {
      setStatus((err && err.message) || "합치는 중 문제가 생겼어요. 다시 시도해 주세요.", "error");
    } finally {
      mergeBtn.disabled = valid.length === 0;
      mergeBtn.classList.remove("loading");
    }
  });

  render();

  // =====================================================================
  // 나누기 (split)
  // =====================================================================

  var tabMerge = document.getElementById("tabMerge");
  var tabSplit = document.getElementById("tabSplit");
  var panelMerge = document.getElementById("panelMerge");
  var panelSplit = document.getElementById("panelSplit");

  function showTab(which) {
    var split = which === "split";
    panelMerge.hidden = split;
    panelSplit.hidden = !split;
    tabMerge.setAttribute("aria-selected", String(!split));
    tabSplit.setAttribute("aria-selected", String(split));
  }
  tabMerge.addEventListener("click", function () { showTab("merge"); });
  tabSplit.addEventListener("click", function () { showTab("split"); });

  var splitDrop = document.getElementById("splitDrop");
  var splitInput = document.getElementById("splitInput");
  var splitPick = document.getElementById("splitPick");
  var splitSrc = document.getElementById("splitSrc");
  var splitName = document.getElementById("splitName");
  var splitMeta = document.getElementById("splitMeta");
  var splitRemove = document.getElementById("splitRemove");
  var splitModes = document.getElementById("splitModes");
  var splitEvery = document.getElementById("splitEvery");
  var splitRanges = document.getElementById("splitRanges");
  var splitExtract = document.getElementById("splitExtract");
  var splitPreview = document.getElementById("splitPreview");
  var splitBtn = document.getElementById("splitBtn");
  var splitStatus = document.getElementById("splitStatus");

  /** @type {{name:string, size:number, bytes:Uint8Array, pages:number}|null} */
  var splitFile = null;

  function setSplitStatus(text, kind) {
    splitStatus.textContent = text || "";
    splitStatus.className = "status" + (kind ? " " + kind : "");
  }

  // Parses "1-2, 3, 5-7" into [{from,to}] (1-based, inclusive).
  // Returns {error} on any malformed or out-of-range token.
  function parseRanges(text, total) {
    var cleaned = String(text || "")
      .replace(/[，、;]/g, ",")
      .replace(/[~–—−－∼]/g, "-")
      .replace(/\s+/g, "");
    if (!cleaned) return { error: "쪽 범위를 입력해 주세요. 예: 1-2, 3, 4-5" };
    var out = [];
    var parts = cleaned.split(",").filter(function (p) { return p !== ""; });
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d+)(?:-(\d+))?$/.exec(parts[i]);
      if (!m) return { error: "'" + parts[i] + "'은(는) 올바른 범위가 아니에요. 예: 1-2, 3, 4-5" };
      var a = parseInt(m[1], 10);
      var b = m[2] != null ? parseInt(m[2], 10) : a;
      if (a < 1 || b < 1 || a > total || b > total) {
        return { error: "'" + parts[i] + "'은(는) 이 문서의 쪽수(1-" + total + ")를 벗어나요." };
      }
      if (a > b) return { error: "'" + parts[i] + "'은(는) 시작 쪽이 끝 쪽보다 커요." };
      out.push({ from: a, to: b });
    }
    if (out.length === 0) return { error: "쪽 범위를 입력해 주세요. 예: 1-2, 3, 4-5" };
    return { ranges: out };
  }

  function rangeLabel(r) {
    return r.from === r.to ? r.from + "쪽" : r.from + "-" + r.to + "쪽";
  }

  // Builds the list of output files for the current options.
  // Each output is {label, indices:[0-based page indexes]}.
  function buildPlan() {
    if (!splitFile) return { error: "나눌 PDF를 먼저 선택해 주세요." };
    var total = splitFile.pages;
    var mode = (document.querySelector('input[name="splitMode"]:checked') || {}).value;
    var groups = [];

    function span(from, to) {
      var idx = [];
      for (var p = from; p <= to; p++) idx.push(p - 1);
      return idx;
    }

    if (mode === "each") {
      for (var p = 1; p <= total; p++) groups.push({ label: rangeLabel({ from: p, to: p }), indices: span(p, p) });
    } else if (mode === "every") {
      var n = parseInt(splitEvery.value, 10);
      if (!(n >= 1)) return { error: "묶을 쪽수는 1 이상의 숫자로 입력해 주세요." };
      for (var s = 1; s <= total; s += n) {
        var e = Math.min(s + n - 1, total);
        groups.push({ label: rangeLabel({ from: s, to: e }), indices: span(s, e) });
      }
    } else if (mode === "ranges") {
      var pr = parseRanges(splitRanges.value, total);
      if (pr.error) return { error: pr.error };
      pr.ranges.forEach(function (r) { groups.push({ label: rangeLabel(r), indices: span(r.from, r.to) }); });
    } else if (mode === "extract") {
      var px = parseRanges(splitExtract.value, total);
      if (px.error) return { error: px.error };
      var idx = [];
      px.ranges.forEach(function (r) { idx = idx.concat(span(r.from, r.to)); });
      groups.push({ label: px.ranges.map(function (r) { return r.from === r.to ? r.from : r.from + "-" + r.to; }).join(",") + "쪽", indices: idx });
    }
    return { groups: groups };
  }

  function renderSplit() {
    var has = !!splitFile;
    splitSrc.hidden = !has;
    splitModes.hidden = !has;
    splitPreview.hidden = !has;
    splitDrop.classList.toggle("compact", has);
    splitDrop.querySelector(".dropzone-title").textContent =
      has ? "다른 PDF로 바꾸기" : "나눌 PDF 파일을 이곳에 끌어다 놓으세요";

    if (!has) { splitBtn.disabled = true; splitBtn.textContent = "PDF 나누기"; return; }

    splitName.textContent = splitFile.name;
    splitName.title = splitFile.name;
    splitMeta.textContent = splitFile.pages + "쪽 · " + fmtSize(splitFile.size);

    var plan = buildPlan();
    if (plan.error) {
      splitPreview.className = "preview error";
      splitPreview.textContent = plan.error;
      splitBtn.disabled = true;
      splitBtn.textContent = "PDF 나누기";
      return;
    }
    var g = plan.groups;
    var shown = g.slice(0, 12).map(function (x) { return x.label; }).join(", ");
    if (g.length > 12) shown += " 외 " + (g.length - 12) + "개";
    splitPreview.className = "preview";
    splitPreview.innerHTML = "<b>" + g.length + "개</b> 파일로 나뉘어요 → " + escapeHtml(shown);
    splitBtn.disabled = false;
    splitBtn.textContent = g.length > 1 ? "PDF " + g.length + "개로 나누기 (ZIP)" : "PDF 나누기";
  }

  async function loadSplitFile(file) {
    if (!file || !isPdfFile(file)) {
      setSplitStatus("PDF 파일만 선택할 수 있어요.", "error");
      return;
    }
    setSplitStatus("");
    try {
      var bytes = new Uint8Array(await file.arrayBuffer());
      var doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      if (doc.isEncrypted) { setSplitStatus("암호로 보호된 파일이라 열 수 없어요.", "error"); return; }
      splitFile = { name: file.name, size: file.size, bytes: bytes, pages: doc.getPageCount() };
      if (splitFile.pages === 0) { splitFile = null; setSplitStatus("쪽이 없는 PDF예요.", "error"); }
    } catch (err) {
      splitFile = null;
      setSplitStatus("PDF를 읽을 수 없는 파일이에요.", "error");
    }
    renderSplit();
  }

  splitPick.addEventListener("click", function (e) { e.stopPropagation(); splitInput.click(); });
  splitDrop.addEventListener("click", function () { splitInput.click(); });
  splitDrop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); splitInput.click(); }
  });
  splitInput.addEventListener("change", function () {
    if (splitInput.files[0]) loadSplitFile(splitInput.files[0]);
    splitInput.value = "";
  });
  ["dragenter", "dragover"].forEach(function (evt) {
    splitDrop.addEventListener(evt, function (e) { e.preventDefault(); splitDrop.classList.add("drag-over"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    splitDrop.addEventListener(evt, function (e) { e.preventDefault(); splitDrop.classList.remove("drag-over"); });
  });
  splitDrop.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadSplitFile(f);
  });
  splitRemove.addEventListener("click", function () {
    splitFile = null;
    setSplitStatus("");
    renderSplit();
  });

  // Re-render the preview whenever an option changes. Typing in a field also
  // selects its radio so the user never has to click twice.
  splitModes.addEventListener("input", function (e) {
    var t = e.target;
    if (t.type !== "radio") {
      var radio = t.closest(".mode").querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    }
    setSplitStatus("");
    renderSplit();
  });

  async function saveSplitFile(data, filename) {
    var mime = /\.zip$/i.test(filename) ? "application/zip" : "application/pdf";
    var url = URL.createObjectURL(new Blob([data], { type: mime }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function baseName(name) {
    return name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "_") || "문서";
  }

  splitBtn.addEventListener("click", async function () {
    var plan = buildPlan();
    if (plan.error) { setSplitStatus(plan.error, "error"); return; }

    splitBtn.disabled = true;
    splitBtn.classList.add("loading");
    setSplitStatus("나누는 중…");

    try {
      var src = await PDFLib.PDFDocument.load(splitFile.bytes);
      var base = baseName(splitFile.name);
      var pad = String(plan.groups.length).length < 2 ? 2 : String(plan.groups.length).length;
      var files = [];

      for (var i = 0; i < plan.groups.length; i++) {
        var g = plan.groups[i];
        var out = await PDFLib.PDFDocument.create();
        var pages = await out.copyPages(src, g.indices);
        pages.forEach(function (p) { out.addPage(p); });
        var bytes = await out.save();
        var num = String(i + 1);
        while (num.length < pad) num = "0" + num;
        files.push({ name: base + "_" + num + "_" + g.label + ".pdf", bytes: bytes });
      }

      if (files.length === 1) {
        await saveSplitFile(files[0].bytes, files[0].name);
      } else {
        if (typeof JSZip === "undefined") throw new Error("ZIP 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
        var zip = new JSZip();
        files.forEach(function (f) { zip.file(f.name, f.bytes); });
        var zipBytes = await zip.generateAsync({ type: "uint8array" });
        await saveSplitFile(zipBytes, base + "_분할.zip");
      }
      setSplitStatus(files.length > 1 ? files.length + "개 파일을 ZIP으로 저장했어요." : "저장했어요.", "success");
    } catch (err) {
      var code = err && err.code;
      if (code === "declined") setSplitStatus("저장을 취소했어요.");
      else if (code === "too_large") setSplitStatus("결과 파일이 16MB를 넘어요. 범위를 줄여 다시 시도해 주세요.", "error");
      else if (code === "rate_limited") setSplitStatus("잠시 후 다시 시도해 주세요.", "error");
      else setSplitStatus((err && err.message) || "나누는 중 문제가 생겼어요. 다시 시도해 주세요.", "error");
    } finally {
      splitBtn.classList.remove("loading");
      renderSplit();
    }
  });

  renderSplit();
})();
