// CrabbyTab guide: mobile navigation toggle and client-side search over search-index.json.
(function () {
  "use strict";

  // ---- Navigation drawer (below 960px) ----
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("guide-nav");
  if (toggle && nav) {
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        var current = nav.querySelector('[aria-current="page"]') || nav.querySelector("a");
        if (current) current.focus();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
    var currentLink = nav.querySelector('[aria-current="page"]');
    if (currentLink && window.matchMedia("(min-width: 960px)").matches) {
      currentLink.scrollIntoView({ block: "center" });
    }
  }

  // ---- Search ----
  var input = document.getElementById("search-input");
  var list = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  if (!input || !list) return;

  var index = null;
  var loading = null;

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch("search-index.json")
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (data) {
          index = data.map(function (p) {
            return { t: p.t, u: p.u, h: p.h, x: p.x, tl: p.t.toLowerCase(), xl: p.x.toLowerCase() };
          });
          return index;
        })
        .catch(function (err) {
          loading = null;
          throw err;
        });
    }
    return loading;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(text, terms) {
    var html = escapeHtml(text);
    terms.forEach(function (t) {
      var re = new RegExp("(" + escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      html = html.replace(re, "<mark>$1</mark>");
    });
    return html;
  }

  function snippet(page, terms) {
    var at = page.xl.indexOf(terms[0]);
    if (at < 0) return page.x.slice(0, 140) + (page.x.length > 140 ? "…" : "");
    var start = Math.max(0, at - 60);
    var end = Math.min(page.x.length, at + 100);
    return (start > 0 ? "…" : "") + page.x.slice(start, end) + (end < page.x.length ? "…" : "");
  }

  function count(hay, needle) {
    var n = 0;
    var i = hay.indexOf(needle);
    while (i !== -1 && n < 50) {
      n++;
      i = hay.indexOf(needle, i + needle.length);
    }
    return n;
  }

  function search(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var results = [];
    index.forEach(function (page) {
      var score = 0;
      var section = null;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var inTitle = page.tl.indexOf(t) !== -1;
        var inBody = count(page.xl, t);
        if (!inTitle && !inBody) return; // every term must match somewhere
        score += (inTitle ? 20 : 0) + Math.min(inBody, 10);
      }
      for (var j = 0; j < page.h.length; j++) {
        var h = page.h[j][0].toLowerCase();
        if (terms.every(function (t) { return h.indexOf(t) !== -1; })) {
          section = page.h[j];
          score += 10;
          break;
        }
      }
      results.push({ page: page, score: score, section: section });
    });
    results.sort(function (a, b) {
      return b.score - a.score || a.page.t.localeCompare(b.page.t);
    });
    return results.slice(0, 12).map(function (r) {
      r.terms = terms;
      return r;
    });
  }

  function render(query) {
    if (!query.trim()) {
      list.hidden = true;
      list.innerHTML = "";
      status.textContent = "";
      return;
    }
    var results = search(query);
    if (!results.length) {
      list.innerHTML = '<li class="result-empty">No pages match “' + escapeHtml(query) + "”.</li>";
    } else {
      list.innerHTML = results
        .map(function (r) {
          var href = r.page.u + (r.section ? "#" + r.section[1] : "");
          return (
            '<li><a href="' + escapeHtml(href) + '"><span class="result-title">' +
            highlight(r.page.t, r.terms) +
            (r.section ? ' <span class="result-section">› ' + highlight(r.section[0], r.terms) + "</span>" : "") +
            '</span><span class="result-snippet">' + highlight(snippet(r.page, r.terms), r.terms) + "</span></a></li>"
          );
        })
        .join("");
    }
    list.hidden = false;
    status.textContent = results.length + (results.length === 1 ? " result" : " results");
  }

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value;
    timer = setTimeout(function () {
      load().then(
        function () {
          render(q);
        },
        function () {
          list.innerHTML =
            '<li class="result-empty">Search could not load its index. Serve the site over HTTP (see site/README.md) rather than opening the files directly.</li>';
          list.hidden = false;
          status.textContent = "Search is unavailable.";
        },
      );
    }, 80);
  });
  input.addEventListener("focus", function () {
    load().catch(function () {});
    if (input.value.trim() && list.innerHTML) list.hidden = false;
  });

  // Arrow keys move between results; Escape closes the list.
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") {
      var first = list.querySelector("a");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Escape") {
      list.hidden = true;
    } else if (e.key === "Enter") {
      var top = list.querySelector("a");
      if (top && !list.hidden) {
        e.preventDefault();
        window.location.href = top.getAttribute("href");
      }
    }
  });
  list.addEventListener("keydown", function (e) {
    var links = Array.prototype.slice.call(list.querySelectorAll("a"));
    var i = links.indexOf(document.activeElement);
    if (e.key === "ArrowDown" && i < links.length - 1) {
      e.preventDefault();
      links[i + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i > 0) links[i - 1].focus();
      else input.focus();
    } else if (e.key === "Escape") {
      list.hidden = true;
      input.focus();
    }
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".search")) list.hidden = true;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== input && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
})();
