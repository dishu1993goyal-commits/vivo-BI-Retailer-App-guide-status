// Runs inside the vivo portal page (in-transfer.vivo.xyz) after HO has logged in themselves.
// Called by the app about once a second with the job:  c = { st, b64, name }
// st 0 = find the "Unblock Imeis" screen · 1 = file attached · 2 = "Batch Unblock" clicked, waiting for the pop-up
// Returns JSON: { st, s, msg }   s = login | nav | lost | file | chooser | clicked | wait | confirm | result
// It never touches the login form, the password or the captcha.
(function (c) {
  try {
    function docs() {
      var L = [document];
      (function walk(w) {
        for (var i = 0; i < w.frames.length; i++) {
          try { var d = w.frames[i].document; if (d && d.body) { L.push(d); walk(w.frames[i]); } } catch (e) { }
        }
      })(window);
      return L;
    }
    function vis(e) {
      try {
        var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
        var s = (e.ownerDocument.defaultView || window).getComputedStyle(e);
        return s.visibility !== "hidden" && s.display !== "none" && +s.opacity !== 0;
      } catch (x) { return false; }
    }
    function txt(e) { return String(e.innerText || e.textContent || e.value || "").replace(/\s+/g, " ").trim(); }
    function find(re, d0) {
      var best = null;
      (d0 ? [d0] : docs()).forEach(function (d) {
        [].forEach.call(d.querySelectorAll("a,span,div,li,button,input[type=button],input[type=submit],td,label,b,p"), function (e) {
          var t = txt(e);
          if (t.length < 40 && re.test(t) && vis(e) && (!best || best.contains(e) || txt(best).length > t.length)) best = e;
        });
      });
      return best;
    }
    function tap(e) {
      try { e.scrollIntoView({ block: "center" }); } catch (x) { }
      ["mousedown", "mouseup"].forEach(function (t) { try { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: e.ownerDocument.defaultView })); } catch (x) { } });
      e.click();
    }
    function out(st, s, msg) { return JSON.stringify({ st: st, s: s, msg: msg || "" }); }

    // ---- pop-ups (EasyUI messager "Tips", layer, bootstrap modal, sweetalert …) ----
    function dialogs() {
      var R = [];
      docs().forEach(function (d) {
        [].forEach.call(d.querySelectorAll(".messager-window,.window,.layui-layer,.modal.in,.modal.show,.modal-dialog,[role=dialog],.swal2-popup,.el-message-box,.ant-modal,.dialog,.popup"), function (w) {
          if (!vis(w) || R.some(function (x) { return x.contains(w) || w.contains(x); })) return;
          var body = w.querySelector(".messager-body,.layui-layer-content,.modal-body,.swal2-html-container,.swal2-content,.el-message-box__message,.ant-modal-body,.window-body,.panel-body") || w;
          var t = txt(body).replace(/\b(ok|cancel|close|确定|取消)\b\s*$/i, "").trim();
          var title = w.querySelector(".panel-title,.layui-layer-title,.modal-title,.swal2-title,.el-message-box__title,.ant-modal-title");
          if (t || title) R.push({ w: w, text: t, title: title ? txt(title) : "" });
        });
      });
      return R;
    }
    function okBtn(w) {
      var L = [].filter.call(w.querySelectorAll("a,button,input[type=button],span.l-btn-text"), vis);
      return L.filter(function (b) { return /^(ok|okay|yes|confirm|sure|确定|是)$/i.test(txt(b)); })[0] || null;
    }

    // ---- login screen: HO logs in; nothing is filled here ----
    var pw = docs().some(function (d) { return [].some.call(d.querySelectorAll("input[type=password]"), vis); });
    if (pw && c.st < 2) return out(c.st, "login");

    // ---- after "Batch Unblock": read the pop-up ----
    if (c.st >= 2) {
      var D = dialogs();
      for (var i = 0; i < D.length; i++) {
        var x = D[i], all = (x.title + " " + x.text);
        if (/confirm|are you sure|确认/i.test(all) && !/success|fail/i.test(all)) { var o = okBtn(x.w); if (o) { tap(o); return out(2, "confirm", all); } }
        if (/^(please wait|waiting|loading|processing|uploading|submitting)/i.test(x.text)) continue;
        if (x.text && (c.seen || []).indexOf(x.text) < 0) {
          var b = okBtn(x.w); setTimeout(function () { if (b) tap(b); }, 1200);
          return out(3, "result", (x.title ? x.title + ": " : "") + x.text);
        }
      }
      return out(2, "wait");
    }

    // ---- find the screen that has a file input and a "Batch Unblock" button ----
    var ds = docs(), page = null;
    for (var k = 0; k < ds.length; k++) {
      var inp = ds[k].querySelector("input[type=file]"), bb = find(/^batch\s*unblock/i, ds[k]);
      if (inp && bb) { page = { d: ds[k], inp: inp, btn: bb }; break; }
    }
    if (!page) {
      var m = find(/^unblock\s*imeis?$/i);
      if (m && (c.nav || 0) % 3 === 0) { tap(m); return out(0, "nav", "Unblock Imeis"); }
      var q = find(/^imeis?\s*query$/i);
      if (q && !m) { tap(q); return out(0, "nav", "Imeis Query"); }
      return out(0, m ? "nav" : "lost");
    }

    // ---- attach the file ----
    if (c.st === 0) {
      var W = page.d.defaultView || window;
      if (page.inp.files && page.inp.files.length === 1 && page.inp.files[0].name === c.name) return out(1, "file");
      try {
        var bin = atob(c.b64), u8 = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
        var f = new W.File([u8], c.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var dt = new W.DataTransfer(); dt.items.add(f);
        page.inp.files = dt.files;
        ["input", "change"].forEach(function (t) { page.inp.dispatchEvent(new W.Event(t, { bubbles: true })); });
        // EasyUI filebox shows the chosen name in a sibling text box
        var box = page.inp.parentNode && page.inp.parentNode.querySelector("input.textbox-text,input[type=text]");
        if (box && !box.value) box.value = c.name;
      } catch (e) { }
      if (page.inp.files && page.inp.files.length === 1) return out(1, "file", c.name);
      return out(0, "chooser");
    }

    // ---- st 1: press "Batch Unblock" ----
    c.seen = dialogs().map(function (x) { return x.text; });
    tap(page.btn);
    return out(2, "clicked", JSON.stringify(c.seen));
  } catch (e) { return JSON.stringify({ st: c.st, s: "err", msg: String(e && e.message || e) }); }
})
