(() => {
  "use strict";

  const DEFAULT_MIN_LENGTH = 5;
  let minPalindromeLength = DEFAULT_MIN_LENGTH;
  let highlights = [];
  let scrollbarTrack = null;
  let isActive = false;

  // ── Text node extraction ─────────────────────────────────────────────

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
    "SVG", "CANVAS", "TEMPLATE", "TEXTAREA", "INPUT", "SELECT",
  ]);

  function getTextNodes(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          let el = node.parentElement;
          while (el) {
            if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  // ── Palindrome scanning ──────────────────────────────────────────────
  // Collect contiguous text runs (sequences of adjacent text nodes
  // within the same block-level ancestor) and scan the concatenated
  // string for palindromic substrings using expand-around-center.

  function gatherTextRuns(textNodes) {
    // Group text nodes that are part of the same visible "run" of text.
    // A run breaks when there is a block-level boundary between nodes.
    const runs = [];
    let currentRun = [];

    for (const tn of textNodes) {
      if (currentRun.length === 0) {
        currentRun.push(tn);
        continue;
      }
      // Check if this node is in the same inline flow as the previous one
      const prev = currentRun[currentRun.length - 1];
      if (areInSameRun(prev, tn)) {
        currentRun.push(tn);
      } else {
        runs.push(currentRun);
        currentRun = [tn];
      }
    }
    if (currentRun.length) runs.push(currentRun);
    return runs;
  }

  function areInSameRun(a, b) {
    // Quick heuristic: they share a common ancestor that is inline,
    // or they are siblings / close cousins within an inline context.
    const ancestor = findCommonAncestor(a, b);
    if (!ancestor || ancestor === document.body || ancestor === document.documentElement) return false;
    // If the common ancestor is a block element, they might still be in
    // the same visual paragraph — accept if ancestor is a <p>, <div>, <li>, etc.
    return true;
  }

  function findCommonAncestor(a, b) {
    const parents = new Set();
    let node = a;
    while (node) { parents.add(node); node = node.parentNode; }
    node = b;
    while (node) {
      if (parents.has(node)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // Build a map from concatenated-string index → { textNode, offsetInNode }
  function buildIndexMap(run) {
    const map = [];
    for (const tn of run) {
      const text = tn.nodeValue;
      for (let i = 0; i < text.length; i++) {
        map.push({ node: tn, offset: i });
      }
    }
    return map;
  }

  // Check if a position in the full text is at a word boundary
  function isWordBoundary(fullText, index, side) {
    // side: "start" means we check that the character BEFORE index is non-alnum
    // side: "end" means we check that the character AFTER index is non-alnum
    if (side === "start") {
      if (index === 0) return true;
      const ch = fullText[index - 1].toLowerCase();
      return !((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9"));
    } else {
      if (index >= fullText.length - 1) return true;
      const ch = fullText[index + 1].toLowerCase();
      return !((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9"));
    }
  }

  // Expand-around-center palindrome detection on the *cleaned* string,
  // but we keep a mapping back to the original positions.
  function findPalindromesInRun(run) {
    const indexMap = buildIndexMap(run);
    const fullText = indexMap.map(m => {
      return m.node.nodeValue[m.offset];
    }).join("");

    // Build cleaned ↔ original index mapping
    const cleanToOrig = [];
    const lower = fullText.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
        cleanToOrig.push(i);
      }
    }
    const clean = cleanToOrig.map(i => lower[i]).join("");

    const results = [];
    const seen = new Set();

    function tryExpand(lo, hi) {
      while (lo >= 0 && hi < clean.length && clean[lo] === clean[hi]) {
        const len = hi - lo + 1;
        if (len >= minPalindromeLength) {
          const origStart = cleanToOrig[lo];
          const origEnd = cleanToOrig[hi];
          const key = origStart + ":" + origEnd;
          if (!seen.has(key)) {
            seen.add(key);
            // Trim leading/trailing non-alphanumeric from the original span
            results.push({ origStart, origEnd, length: len });
          }
        }
        lo--;
        hi++;
      }
    }

    for (let i = 0; i < clean.length; i++) {
      tryExpand(i, i);     // odd-length
      tryExpand(i, i + 1); // even-length
    }

    // Filter: only keep palindromes that start and end at word boundaries
    const bounded = results.filter(r =>
      isWordBoundary(fullText, r.origStart, "start") &&
      isWordBoundary(fullText, r.origEnd, "end")
    );

    // Deduplicate: keep only maximal palindromes (remove substrings of larger ones)
    bounded.sort((a, b) => b.length - a.length);
    const maximal = [];
    for (const r of bounded) {
      let dominated = false;
      for (const m of maximal) {
        if (r.origStart >= m.origStart && r.origEnd <= m.origEnd) {
          dominated = true;
          break;
        }
      }
      if (!dominated) maximal.push(r);
    }

    // Convert to Range objects
    return maximal.map(r => {
      const startInfo = indexMap[r.origStart];
      const endInfo = indexMap[r.origEnd];
      const range = document.createRange();
      range.setStart(startInfo.node, startInfo.offset);
      range.setEnd(endInfo.node, endInfo.offset + 1);
      return { range, text: fullText.slice(r.origStart, r.origEnd + 1) };
    });
  }

  // ── Highlighting ─────────────────────────────────────────────────────

  function highlightRange(range, text) {
    const mark = document.createElement("mark");
    mark.className = "palindrome-highlight";
    mark.title = `Palindrome: "${text}"`;
    try {
      range.surroundContents(mark);
      highlights.push(mark);
    } catch {
      // surroundContents fails if range crosses element boundaries;
      // fall back to inserting around the extracted contents.
      try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
        highlights.push(mark);
      } catch {
        // Skip this palindrome if we truly can't wrap it
      }
    }
    return mark;
  }

  // ── Scrollbar markers ───────────────────────────────────────────────

  function createScrollbarTrack() {
    removeScrollbarTrack();
    scrollbarTrack = document.createElement("div");
    scrollbarTrack.id = "palindrome-scrollbar-track";
    document.body.appendChild(scrollbarTrack);
  }

  function removeScrollbarTrack() {
    if (scrollbarTrack) {
      scrollbarTrack.remove();
      scrollbarTrack = null;
    }
  }

  function addScrollbarMarker(element, text) {
    if (!scrollbarTrack) return;
    const rect = element.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const viewportHeight = window.innerHeight;
    const pct = (absoluteTop / docHeight) * 100;

    const marker = document.createElement("div");
    marker.className = "palindrome-marker";
    marker.style.top = `${pct}%`;

    const tooltip = document.createElement("span");
    tooltip.className = "marker-tooltip";
    tooltip.textContent = text;
    marker.appendChild(tooltip);

    marker.addEventListener("click", () => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    scrollbarTrack.appendChild(marker);
  }

  // ── Main scan ────────────────────────────────────────────────────────

  function scan() {
    cleanup();
    isActive = true;

    const textNodes = getTextNodes(document.body);
    const runs = gatherTextRuns(textNodes);

    let totalFound = 0;
    const palindromeElements = [];

    createScrollbarTrack();

    for (const run of runs) {
      const palindromes = findPalindromesInRun(run);
      for (const { range, text } of palindromes) {
        const mark = highlightRange(range, text);
        if (mark && mark.isConnected) {
          palindromeElements.push({ el: mark, text });
          totalFound++;
        }
      }
    }

    // Add scrollbar markers after all highlights are placed
    for (const { el, text } of palindromeElements) {
      addScrollbarMarker(el, text);
    }

    return totalFound;
  }

  function cleanup() {
    isActive = false;
    // Unwrap all highlight marks
    for (const mark of highlights) {
      if (mark.parentNode) {
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize(); // merge adjacent text nodes
      }
    }
    highlights = [];
    removeScrollbarTrack();
  }

  // ── Message handling ─────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "scan") {
      if (typeof msg.minLength === "number") {
        minPalindromeLength = msg.minLength;
      }
      const count = scan();
      sendResponse({ count });
    } else if (msg.action === "clear") {
      cleanup();
      sendResponse({ count: 0 });
    } else if (msg.action === "status") {
      sendResponse({ active: isActive, count: highlights.length, minLength: minPalindromeLength });
    }
    return true; // keep channel open for async
  });

  // ── Listen for setting changes from other tabs / popup ─────────────
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.minPalindromeLength) {
      minPalindromeLength = changes.minPalindromeLength.newValue || DEFAULT_MIN_LENGTH;
      scan();
    }
  });

  // ── Auto-scan on page load ───────────────────────────────────────────
  chrome.storage.sync.get({ minPalindromeLength: DEFAULT_MIN_LENGTH }, (settings) => {
    minPalindromeLength = settings.minPalindromeLength;
    scan();
  });
})();
