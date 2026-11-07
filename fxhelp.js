/* Formula assistant for the Tool builder: ready recipes (pick fields from drop-downs), every function with its format
   and an example, the fields you can use, and "describe in words" (AI writes the formula, the engine checks it). */
(function () {
  "use strict";
  // [name, format, what it does, example, group]
  var F = [
    ["IF", "IF(condition, value if yes, value if no)", "Pick one of two values", 'IF(amount > 5000, "ZSM", "ASM")', "Logic"],
    ["IFS", "IFS(cond1, value1, cond2, value2, …, TRUE, otherwise)", "First condition that is true wins", 'IFS(total <= 10000, "Low", total <= 100000, "Medium", TRUE, "High")', "Logic"],
    ["SWITCH", "SWITCH(field, match1, value1, match2, value2, …, otherwise)", "Value for each option", 'SWITCH(severity, "Critical", 4, "High", 24, 72)', "Logic"],
    ["AND", "AND(cond1, cond2, …)  or  cond1 AND cond2", "All must be true", 'amount > 1000 AND trip = "Outstation"', "Logic"],
    ["OR", "OR(cond1, cond2, …)  or  cond1 OR cond2", "Any one true", 'mode = "Air" OR amount > 20000', "Logic"],
    ["NOT", "NOT(condition)", "Opposite", "NOT(ISBLANK(bill))", "Logic"],
    ["IN", 'IN(field, "A", "B", …)', "Field is one of these", 'IN(user.state, "Bihar", "Jharkhand")', "Logic"],
    ["ISBLANK", "ISBLANK(field)", "Field is empty", "ISBLANK(gst_no)", "Logic"],
    ["COALESCE", "COALESCE(a, b, …)", "First value that isn't empty", "COALESCE(discount, 0)", "Logic"],
    ["SUM", "SUM(a, b, …)  or  SUM(table.column)", "Add up", "SUM(lines.amount)", "Numbers"],
    ["AVG", "AVG(table.column)", "Average", "AVG(lines.rate)", "Numbers"],
    ["MIN", "MIN(a, b, …)", "Smallest (use it to cap a value)", "MIN(incentive, 8000)", "Numbers"],
    ["MAX", "MAX(a, b, …)", "Largest (use it for a floor)", "MAX(payout, 0)", "Numbers"],
    ["ROUND", "ROUND(number, decimals)", "Round", "ROUND(amount * 1.18, 0)", "Numbers"],
    ["ROUNDUP", "ROUNDUP(number, decimals)", "Round up", "ROUNDUP(km / 10, 0)", "Numbers"],
    ["ROUNDDOWN", "ROUNDDOWN(number, decimals)", "Round down", "ROUNDDOWN(units / 5, 0)", "Numbers"],
    ["PERCENT", "PERCENT(part, whole)", "part ÷ whole × 100 (0 if whole is 0)", "PERCENT(achieved, target)", "Numbers"],
    ["SLAB", 'SLAB(value, "from:result, from:result, …")', "Slab payout — highest ‘from’ the value reaches", 'SLAB(units, "0:0,10:1000,25:3000,50:7500")', "Numbers"],
    ["TIER", 'TIER(value, "from:label, …")', "Same as SLAB but returns text", 'TIER(ach, "0:Red,80:Amber,100:Green")', "Numbers"],
    ["ABS", "ABS(number)", "Without minus sign", "ABS(gap)", "Numbers"],
    ["POWER", "POWER(number, power)", "Power", "POWER(1.1, 2)", "Numbers"],
    ["COUNT", "COUNT(table.column)", "How many filled", "COUNT(lines.bill)", "Numbers"],
    ["COUNTROWS", "COUNTROWS(table)", "Number of rows in a table", "COUNTROWS(lines)", "Numbers"],
    ["NUM", "NUM(value)", "Text → number", "NUM(retailer.balance)", "Numbers"],
    ["TODAY", "TODAY()", "Today's date", "TODAY()", "Dates"],
    ["NOW", "NOW()", "Date and time now", "NOW()", "Dates"],
    ["DAYS", "DAYS(later date, earlier date)", "Days between two dates", "DAYS(to_date, from_date) + 1", "Dates"],
    ["ADDDAYS", "ADDDAYS(date, days)", "Date after N days", "ADDDAYS(TODAY(), 7)", "Dates"],
    ["HOURS", "HOURS(later, earlier)", "Hours between two date-times", "HOURS(end_time, start_time)", "Dates"],
    ["YEAR", "YEAR(date)", "Year", "YEAR(bill_date)", "Dates"], ["MONTH", "MONTH(date)", "Month 1–12", "MONTH(bill_date) = MONTH(TODAY())", "Dates"], ["DAY", "DAY(date)", "Day of month", "DAY(TODAY()) <= 5", "Dates"],
    ["WEEKDAY", "WEEKDAY(date)", "1 = Monday … 7 = Sunday", "WEEKDAY(visit_date) >= 6", "Dates"],
    ["DATE", "DATE(year, month, day)", "Build a date", "DATE(2026, 12, 31)", "Dates"],
    ["CONCAT", 'CONCAT(a, " ", b)  or  a & " " & b', "Join text", 'CONCAT(name, " · ₹", total)', "Text"],
    ["CONTAINS", 'CONTAINS(field, "text")', "Has this text / this option ticked", 'CONTAINS(items, "Other")', "Text"],
    ["STARTSWITH", 'STARTSWITH(field, "text")', "Starts with", 'STARTSWITH(rid, "BR")', "Text"], ["ENDSWITH", 'ENDSWITH(field, "text")', "Ends with", 'ENDSWITH(email, "@vivo.com")', "Text"],
    ["LEN", "LEN(field)", "Number of characters", "LEN(mobile) = 10", "Text"],
    ["UPPER", "UPPER(field)", "CAPITALS", "UPPER(rid)", "Text"], ["LOWER", "LOWER(field)", "small letters", "LOWER(email)", "Text"], ["TRIM", "TRIM(field)", "Remove extra spaces", "TRIM(name)", "Text"],
    ["LEFT", "LEFT(text, n)", "First n characters", "LEFT(rid, 2)", "Text"], ["RIGHT", "RIGHT(text, n)", "Last n characters", "RIGHT(mobile, 4)", "Text"],
    ["REPLACE", 'REPLACE(text, "find", "with")', "Replace text", 'REPLACE(name, "  ", " ")', "Text"],
    ["TEXT", "TEXT(number, decimals)", "Number → text", "TEXT(ach, 1)", "Text"]
  ];
  // Recipes: {{X:kind|Label|default}} → a drop-down of matching fields (kind num/date/text/any/table/col/lookup) or a typed value (val/list).
  // A later {{X}} re-uses the same choice.
  var R = [
    ["Totals & amounts", "value", "Add two amounts", "{{A:num|First amount}} + {{B:num|Second amount}}"],
    ["Totals & amounts", "value", "Quantity × rate", "{{A:num|Quantity}} * {{B:num|Rate}}"],
    ["Totals & amounts", "value", "Total of a table column (e.g. all expense lines)", "SUM({{T:table|Table}}.{{C:col|Column to add}})"],
    ["Totals & amounts", "value", "Number of rows in a table", "COUNTROWS({{T:table|Table}})"],
    ["Totals & amounts", "value", "Average of a table column", "ROUND(AVG({{T:table|Table}}.{{C:col|Column}}), 2)"],
    ["Totals & amounts", "value", "Difference (A − B)", "{{A:num|Amount A}} - {{B:num|Amount B}}"],
    ["Totals & amounts", "value", "Cap at a maximum", "MIN({{A:num|Amount}}, {{M:val|Maximum|5000}})"],
    ["Tax & discount", "value", "Amount + GST", "ROUND({{A:num|Amount}} * (1 + {{P:val|GST %|18}} / 100), 0)"],
    ["Tax & discount", "value", "GST amount only", "ROUND({{A:num|Amount}} * {{P:val|GST %|18}} / 100, 0)"],
    ["Tax & discount", "value", "Price after discount %", "ROUND({{A:num|Price}} * (1 - {{P:val|Discount %|10}} / 100), 0)"],
    ["Tax & discount", "value", "TDS deduction", "ROUND({{A:num|Gross amount}} * {{P:val|TDS %|5}} / 100, 0)"],
    ["Targets & payouts", "value", "Achievement %", "ROUND(PERCENT({{A:num|Achieved}}, {{B:num|Target}}), 1)"],
    ["Targets & payouts", "value", "Slab payout (fixed amount per slab)", 'SLAB({{A:num|Units / value achieved}}, "{{S:val|Slabs  from:payout, …|0:0,10:1000,25:3000,50:7500}}")'],
    ["Targets & payouts", "value", "Per-unit incentive by slab rate", '{{A:num|Units}} * SLAB({{A}}, "{{S:val|Rate slabs  from:₹ per unit|0:50,20:75,50:100}}")'],
    ["Targets & payouts", "value", "Payout on achievement % slab", 'SLAB(PERCENT({{A:num|Achieved}}, {{B:num|Target}}), "{{S:val|Achievement %:payout|0:0,80:1500,100:3000,120:4500}}")'],
    ["Targets & payouts", "value", "Grade / band label", 'TIER({{A:num|Score or %}}, "{{S:val|from:label|0:Red,80:Amber,100:Green}}")'],
    ["Targets & payouts", "value", "Units still needed for target", "MAX({{B:num|Target}} - {{A:num|Achieved}}, 0)"],
    ["Dates", "value", "Number of days (both dates counted, e.g. leave)", "DAYS({{B:date|To date}}, {{A:date|From date}}) + 1"],
    ["Dates", "value", "Days since a date (ageing)", "DAYS(TODAY(), {{A:date|Date}})"],
    ["Dates", "value", "Due date = date + N days", "ADDDAYS({{A:date|Start date}}, {{N:val|Days|7}})"],
    ["Dates", "value", "Daily allowance × days", "(DAYS({{B:date|To date}}, {{A:date|From date}}) + 1) * {{R:val|₹ per day|400}}"],
    ["Text", "value", "Join two fields", 'CONCAT({{A:any|First}}, " - ", {{B:any|Second}})'],
    ["Text", "value", "Approval level by amount", 'IFS({{A:num|Amount}} <= {{X:val|Level 1 up to|10000}}, "ASM", {{A}} <= {{Y:val|Level 2 up to|100000}}, "ZSM", TRUE, "HO")'],
    ["Text", "value", "Value per option", 'SWITCH({{A:text|Dropdown field}}, "{{V1:val|Option 1|Low}}", {{R1:val|Result 1|72}}, "{{V2:val|Option 2|High}}", {{R2:val|Result 2|24}}, {{R0:val|Otherwise|48}})'],
    ["Text", "value", "Field from a lookup (e.g. retailer balance)", "{{L:lookup|Lookup field}}.{{P:val|Detail (balance, name, price, state…)|balance}}"],
    ["Conditions", "cond", "Dropdown is a value", '{{A:text|Field}} = "{{V:val|Value|Outstation}}"'],
    ["Conditions", "cond", "Dropdown is one of several", "IN({{A:text|Field}}, {{V:list|Values (comma separated)|Bihar, Jharkhand}})"],
    ["Conditions", "cond", "Ticked option / text contains", 'CONTAINS({{A:text|Field}}, "{{V:val|Option or text|Other}}")'],
    ["Conditions", "cond", "Amount above a limit", "{{A:num|Amount}} > {{V:val|Limit|5000}}"],
    ["Conditions", "cond", "Amount between two limits", "{{A:num|Amount}} >= {{L:val|From|1000}} AND {{A}} <= {{H:val|To|5000}}"],
    ["Conditions", "cond", "Field is empty", "ISBLANK({{A:any|Field}})"],
    ["Conditions", "cond", "Field is filled", "NOT(ISBLANK({{A:any|Field}}))"],
    ["Conditions", "cond", "Yes / No answered Yes", '{{A:text|Yes/No field}} = "Yes"'],
    ["Conditions", "cond", "Submitter's state is", 'user.state = "{{V:val|State|Bihar}}"'],
    ["Conditions", "cond", "Submitter is an HO admin", 'user.role = "admin"'],
    ["Conditions", "cond", "Date is on a weekend", "WEEKDAY({{A:date|Date}}) >= 6"],
    ["Conditions", "cond", "Two conditions together", '{{A:num|Amount}} > {{V:val|Limit|5000}} AND {{B:text|Field}} = "{{W:val|Value|Capex}}"'],
    ["Checks (validation)", "cond", "Mobile has 10 digits", "LEN({{A:text|Mobile field}}) = 10"],
    ["Checks (validation)", "cond", "End date not before start date", "{{B:date|End date}} >= {{A:date|Start date}}"],
    ["Checks (validation)", "cond", "Date not in the future", "{{A:date|Date}} <= TODAY()"],
    ["Checks (validation)", "cond", "Raised at least N days ahead", "DAYS({{A:date|Event date}}, TODAY()) >= {{N:val|Days|7}}"],
    ["Checks (validation)", "cond", "Amount within a maximum", "{{A:num|Amount}} <= {{V:val|Maximum|50000}}"],
    ["Checks (validation)", "cond", "Claim not more than looked-up balance", "{{A:num|Claim amount}} <= NUM({{L:lookup|Lookup field}}.balance)"],
    ["Checks (validation)", "cond", "GSTIN blank or 15 characters", "ISBLANK({{A:text|GSTIN field}}) OR LEN({{A}}) = 15"],
    ["Checks (validation)", "cond", "At least N table rows", "COUNTROWS({{T:table|Table}}) >= {{N:val|Rows|1}}"]
  ];
  var KIND = { num: ["number", "currency", "calc", "rating", "scale"], date: ["date", "datetime", "calc"], text: ["text", "select", "multi", "yesno", "user", "email", "phone", "longtext", "calc"], table: ["table"], lookup: ["lookup"] };
  function fieldsFor(kind, fields) { var L = fields.filter(function (f) { return f.type !== "heading" && f.type !== "image"; }); return kind === "any" ? L : L.filter(function (f) { return (KIND[kind] || []).indexOf(f.type) >= 0; }); }
  function phs(tpl) { var out = [], seen = {}; tpl.replace(/\{\{(\w+)(?::(\w+)(?:\|([^|}]*))?(?:\|([^}]*))?)?\}\}/g, function (m, id, kind, label, dflt) { if (kind && !seen[id]) { seen[id] = 1; out.push({ id: id, kind: kind, label: label || id, dflt: dflt || "" }); } return m; }); return out; }
  function build(tpl, ch) { return tpl.replace(/\{\{(\w+)(?::[^}]*)?\}\}/g, function (m, id) { var v = ch[id]; return v == null || v === "" ? "?" : v; }); }

  // open(opts): { esc, sheet, toast, input (element), fields, purpose:"value"|"cond", sample:fn, aiCall:fn(desc)->Promise<{ok,formula,explain}> , test:fn }
  window.BIFXHELP = { FUNCS: F, RECIPES: R, open: function (o) {
    var esc = o.esc, fields = o.fields || [], inp = o.input, purpose = o.purpose || "value", TAB = "rec";
    var ov = o.sheet("🪄 Formula helper", purpose === "cond" ? "This box needs a condition — something that is true or false." : "This box needs a value — a number, amount, date or text.", [], '<div class="seg" id="fh_t" style="margin-top:8px"><button data-t="rec">📋 Recipes</button><button data-t="ai">✨ Describe it</button><button data-t="fn">ƒ Functions</button><button data-t="fld">🧾 Fields</button></div><div id="fh_b" style="max-height:58vh;overflow:auto;margin-top:6px"></div>' +
      '<label class="lb">Formula</label><input class="tx fx" id="fh_f" value="' + esc(inp.value || "") + '"><div class="fxr" id="fh_r"></div><button class="btn pri block" id="fh_ok" style="margin-top:8px">✓ Use this formula</button>');
    var f = ov.querySelector("#fh_f"), res = ov.querySelector("#fh_r");
    var check = function () { if (!f.value.trim()) { res.textContent = ""; return; } var r = o.test(f.value); res.className = "fxr " + (r.ok ? "ok" : "bad"); res.textContent = r.ok ? "✓ Works · with sample values = " + JSON.stringify(r.value) : "✗ " + r.error; };
    var insert = function (txt) { var s = f.selectionStart == null ? f.value.length : f.selectionStart, e = f.selectionEnd == null ? s : f.selectionEnd; f.value = f.value.slice(0, s) + txt + f.value.slice(e); f.focus(); try { f.setSelectionRange(s + txt.length, s + txt.length); } catch (x) { } check(); };
    f.oninput = check; check();
    ov.querySelector("#fh_ok").onclick = function () { inp.value = f.value; inp.dispatchEvent(new Event("input", { bubbles: true })); ov.remove(); };
    var paint = function () {
      [].forEach.call(ov.querySelectorAll("#fh_t [data-t]"), function (b) { b.className = b.dataset.t === TAB ? "on" : ""; b.onclick = function () { TAB = b.dataset.t; paint(); }; });
      var box = ov.querySelector("#fh_b");
      if (TAB === "rec") {
        var L = R.filter(function (r) { return purpose === "any" || r[1] === purpose; }).concat(R.filter(function (r) { return purpose !== "any" && r[1] !== purpose; })), groups = [];
        L.forEach(function (r) { if (groups.indexOf(r[0]) < 0) groups.push(r[0]); });
        box.innerHTML = '<label class="lb">1 · What do you want to do?</label><select class="tx" id="fh_rs"><option value="">— choose a recipe —</option>' + groups.map(function (g) { return '<optgroup label="' + esc(g) + '">' + L.filter(function (r) { return r[0] === g; }).map(function (r) { return '<option value="' + R.indexOf(r) + '">' + esc(r[2]) + (r[1] !== purpose && purpose !== "any" ? (r[1] === "cond" ? "  (condition)" : "  (value)") : "") + "</option>"; }).join("") + "</optgroup>"; }).join("") + '</select><div id="fh_ph"></div>';
        var sel = box.querySelector("#fh_rs");
        sel.onchange = function () {
          var r = R[+sel.value], ph = box.querySelector("#fh_ph"); if (!r) { ph.innerHTML = ""; return; }
          var P = phs(r[3]), ch = {};
          ph.innerHTML = '<label class="lb">2 · Choose the fields / type the values</label>' + P.map(function (p) {
            if (p.kind === "val" || p.kind === "list") return '<div class="row" style="gap:6px;margin-top:5px"><span style="flex:1;font-size:12.5px">' + esc(p.label) + '</span><input class="tx" data-ph="' + p.id + '" data-k="' + p.kind + '" value="' + esc(p.dflt) + '" style="width:55%"></div>';
            if (p.kind === "col") { var tb = fields.filter(function (x) { return x.type === "table"; }), cols = []; tb.forEach(function (t) { (t.columns || []).forEach(function (c) { if (cols.indexOf(c.key) < 0) cols.push(c.key); }); }); return '<div class="row" style="gap:6px;margin-top:5px"><span style="flex:1;font-size:12.5px">' + esc(p.label) + '</span><select class="tx" data-ph="' + p.id + '" style="width:55%">' + (cols.length ? cols.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("") : '<option value="">(add a table field first)</option>') + "</select></div>"; }
            var opts = fieldsFor(p.kind, fields).concat(p.kind === "text" || p.kind === "any" ? [{ key: "user.state", label: "Submitter's state" }, { key: "user.role", label: "Submitter's role" }] : []).concat(p.kind === "date" ? [{ key: "TODAY()", label: "Today" }] : []);
            return '<div class="row" style="gap:6px;margin-top:5px"><span style="flex:1;font-size:12.5px">' + esc(p.label) + '</span><select class="tx" data-ph="' + p.id + '" style="width:55%">' + (opts.length ? opts.map(function (x) { return '<option value="' + esc(x.key) + '">' + esc(x.label || x.key) + "</option>"; }).join("") : '<option value="">(no matching field yet)</option>') + "</select></div>";
          }).join("") + '<div class="help" style="margin-top:8px">Pattern: <span class="fx">' + esc(r[3].replace(/\{\{(\w+)(?::\w+\|([^|}]*)(?:\|[^}]*)?)?\}\}/g, function (m, id, lb) { return "[" + (lb || id) + "]"; })) + "</span></div>";
          var upd = function () { [].forEach.call(ph.querySelectorAll("[data-ph]"), function (e) { var v = e.value; if (e.dataset.k === "list") v = v.split(",").map(function (x) { x = x.trim(); return x === "" ? "" : isFinite(+x) ? x : '"' + x.replace(/"/g, "") + '"'; }).filter(Boolean).join(", "); ch[e.dataset.ph] = v; }); f.value = build(r[3], ch); check(); };
          [].forEach.call(ph.querySelectorAll("[data-ph]"), function (e) { e.oninput = e.onchange = upd; }); upd();
        };
      } else if (TAB === "fn") {
        var gs = ["Logic", "Numbers", "Dates", "Text"];
        box.innerHTML = '<input class="tx" id="fh_q" placeholder="🔍 Search e.g. date, slab, total">' + '<div id="fh_fl"></div><div class="help">Operators: <span class="fx">+ − * / ^</span> · compare <span class="fx">= != &lt; &lt;= &gt; &gt;=</span> · <span class="fx">AND OR NOT</span> · join text <span class="fx">&amp;</span> · text in "double quotes" · numbers without ₹ or commas.</div>';
        var draw = function (q) { q = String(q || "").toLowerCase(); box.querySelector("#fh_fl").innerHTML = gs.map(function (g) { var L = F.filter(function (x) { return x[4] === g && (!q || (x.join(" ").toLowerCase().indexOf(q) >= 0)); }); return L.length ? '<div style="font-weight:800;font-size:12px;margin:10px 0 2px;color:var(--mut)">' + g + "</div>" + L.map(function (x) { return '<div class="it" style="margin-top:5px;cursor:pointer" data-fn="' + esc(x[0]) + '"><div class="m"><b class="fx">' + esc(x[1]) + "</b><span>" + esc(x[2]) + ' · e.g. <span class="fx">' + esc(x[3]) + '</span></span></div><button class="ib" title="Insert">＋</button></div>'; }).join("") : ""; }).join("");
          [].forEach.call(box.querySelectorAll("[data-fn]"), function (d) { d.onclick = function () { var x = F.find(function (y) { return y[0] === d.dataset.fn; }); insert(/\(\)$/.test(x[1]) ? x[0] + "()" : x[0] + "("); }; }); };
        box.querySelector("#fh_q").oninput = function () { draw(this.value); }; draw("");
      } else if (TAB === "fld") {
        var flds = fields.filter(function (x) { return x.type !== "heading" && x.type !== "image"; });
        box.innerHTML = '<div class="muted" style="font-size:12px">Tap to insert. Text values go in "quotes"; compare a dropdown like <span class="fx">trip = "Outstation"</span>.</div>' + flds.map(function (x) { return '<div class="it" style="margin-top:5px;cursor:pointer" data-k="' + esc(x.key) + '"><div class="m"><b class="fx">' + esc(x.key) + "</b><span>" + esc(x.label || "") + " · " + esc(x.type) + (x.options && x.options.length ? " · options: " + esc(x.options.slice(0, 6).join(", ")) : "") + "</span></div></div>" + (x.type === "table" ? (x.columns || []).map(function (c) { return '<div class="it" style="margin:3px 0 0 18px;cursor:pointer" data-k="' + esc(x.key + "." + c.key) + '"><div class="m"><b class="fx">' + esc(x.key + "." + c.key) + "</b><span>column " + esc(c.label) + " (all rows — use inside SUM / AVG)</span></div></div>"; }).join("") : "") + (x.type === "lookup" ? (x.lookup && x.lookup.show && x.lookup.show.length ? x.lookup.show : ["name", "state"]).map(function (s) { return '<div class="it" style="margin:3px 0 0 18px;cursor:pointer" data-k="' + esc(x.key + "." + s) + '"><div class="m"><b class="fx">' + esc(x.key + "." + s) + "</b><span>looked-up " + esc(s) + "</span></div></div>"; }).join("") : ""); }).join("") +
          [["user.state", "Submitter's state"], ["user.role", "state / admin"], ["user.name", "Submitter's name"], ["user.designation", "Designation"], ["TODAY()", "Today"]].map(function (u) { return '<div class="it" style="margin-top:5px;cursor:pointer" data-k="' + u[0] + '"><div class="m"><b class="fx">' + u[0] + "</b><span>" + u[1] + "</span></div></div>"; }).join("");
        [].forEach.call(box.querySelectorAll("[data-k]"), function (d) { d.onclick = function () { insert(d.dataset.k); }; });
      } else {
        box.innerHTML = '<label class="lb">Say what it should do, in simple words (Hindi or English)</label><textarea class="tx" id="fh_d" style="min-height:80px" placeholder="' + (purpose === "cond" ? "e.g. only when the trip is outstation and the amount is more than 5000" : "e.g. total of all expense lines plus 18% GST, but not more than 50,000") + '"></textarea><button class="btn sec block" id="fh_go" style="margin-top:6px">✨ Write the formula</button><div id="fh_ex" class="help" style="display:none"></div>';
        box.querySelector("#fh_go").onclick = function () { var b = this, d = box.querySelector("#fh_d").value.trim(); if (!d) return o.toast("Describe it first"); b.disabled = true; b.textContent = "Writing…"; o.aiCall(d).then(function (r) { b.disabled = false; b.textContent = "✨ Write the formula"; if (!r.ok) return o.toast(r.error || "AI is busy"); f.value = r.formula; check(); var ex = box.querySelector("#fh_ex"); ex.style.display = ""; ex.innerHTML = "<b>How it works:</b> " + esc(r.explain || ""); }); };
      }
    };
    paint();
    return ov;
  } };
})();
