(() => {
  "use strict";

  const DEFAULT_MIN_LENGTH = 5;
  let minPalindromeLength = DEFAULT_MIN_LENGTH;
  let highlights = [];
  let scrollbarTrack = null;
  let isActive = false;
  let scanId = 0; // incremented to cancel stale async scans

  // ── Utility ──────────────────────────────────────────────────────────

  function isAlnum(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
  }

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
          if (SKIP_TAGS.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  // ── Text run grouping ────────────────────────────────────────────────
  // Group text nodes by their nearest block-level ancestor.
  // This is O(n·depth) total but avoids the O(n·depth²) pairwise
  // findCommonAncestor approach.

  const INLINE_DISPLAY = new Set([
    "inline", "inline-block", "inline-flex", "inline-grid", "inline-table",
  ]);

  function getBlockAncestor(node) {
    let el = node.parentElement;
    while (el && el !== document.body) {
      const display = getComputedStyle(el).display;
      if (!INLINE_DISPLAY.has(display)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  function gatherTextRuns(textNodes) {
    if (textNodes.length === 0) return [];
    const runs = [];
    let currentBlock = getBlockAncestor(textNodes[0]);
    let currentRun = [textNodes[0]];

    for (let i = 1; i < textNodes.length; i++) {
      const block = getBlockAncestor(textNodes[i]);
      if (block === currentBlock) {
        currentRun.push(textNodes[i]);
      } else {
        runs.push(currentRun);
        currentBlock = block;
        currentRun = [textNodes[i]];
      }
    }
    runs.push(currentRun);
    return runs;
  }

  // ── Palindrome scanning ──────────────────────────────────────────────
  // Uses flat arrays instead of per-character objects for the index map.
  // runNodes[] and runOffsets[] store cumulative character offsets so we
  // can binary-search for the owning text node of any character index.

  function findPalindromesInRun(run) {
    // Build flat concatenated text + node offset table
    const runNodes = [];   // text node references
    const runStarts = [];  // cumulative start index of each node in fullText
    const parts = [];
    let total = 0;
    for (let n = 0; n < run.length; n++) {
      const val = run[n].nodeValue;
      runNodes.push(run[n]);
      runStarts.push(total);
      parts.push(val);
      total += val.length;
    }
    const fullText = parts.join("");
    if (total === 0) return [];

    // Build cleaned ↔ original index mapping (flat Int32Arrays)
    const lower = fullText.toLowerCase();
    const cleanIndices = []; // cleanIndices[i] = original index of clean char i
    const cleanChars = [];
    for (let i = 0; i < lower.length; i++) {
      if (isAlnum(lower[i])) {
        cleanIndices.push(i);
        cleanChars.push(lower[i]);
      }
    }
    const cleanLen = cleanChars.length;
    if (cleanLen < minPalindromeLength) return [];

    // Expand-around-center — only record the outermost (maximal) palindrome
    // per center, and only if it meets word-boundary + length requirements.
    const results = [];

    function tryExpand(lo, hi) {
      while (lo >= 0 && hi < cleanLen && cleanChars[lo] === cleanChars[hi]) {
        lo--;
        hi++;
      }
      // lo+1..hi-1 is the maximal palindrome for this center
      lo++;
      hi--;
      const len = hi - lo + 1;
      if (len < minPalindromeLength) return;

      const origStart = cleanIndices[lo];
      const origEnd = cleanIndices[hi];

      // Word boundary check (inline for speed)
      if (origStart > 0 && isAlnum(lower[origStart - 1])) return;
      if (origEnd < lower.length - 1 && isAlnum(lower[origEnd + 1])) return;

      results.push(origStart, origEnd, len);
    }

    for (let i = 0; i < cleanLen; i++) {
      tryExpand(i, i);     // odd-length
      tryExpand(i, i + 1); // even-length
    }

    // results is a flat array of [origStart, origEnd, len, ...]
    // Deduplicate: keep only maximal (non-dominated) palindromes
    const count = results.length / 3;
    if (count === 0) return [];

    // Sort by length descending (index into flat triples)
    const indices = new Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    indices.sort((a, b) => results[b * 3 + 2] - results[a * 3 + 2]);

    const maximal = [];
    for (const idx of indices) {
      const os = results[idx * 3];
      const oe = results[idx * 3 + 1];
      let dominated = false;
      for (let j = 0; j < maximal.length; j++) {
        if (os >= maximal[j][0] && oe <= maximal[j][1]) {
          dominated = true;
          break;
        }
      }
      if (!dominated) maximal.push([os, oe]);
    }

    // Binary search helper: find which text node owns a given fullText index
    function nodeAt(charIdx) {
      let lo = 0, hi = runNodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (runStarts[mid] <= charIdx) lo = mid; else hi = mid - 1;
      }
      return { node: runNodes[lo], offset: charIdx - runStarts[lo] };
    }

    // Convert to Range objects
    return maximal.map(([os, oe]) => {
      const startInfo = nodeAt(os);
      const endInfo = nodeAt(oe);
      const range = document.createRange();
      range.setStart(startInfo.node, startInfo.offset);
      range.setEnd(endInfo.node, endInfo.offset + 1);
      return { range, text: fullText.slice(os, oe + 1) };
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
      try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
        highlights.push(mark);
      } catch {
        return null;
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
    const absoluteTop = rect.top + (window.scrollY || document.documentElement.scrollTop);
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
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

  // ── Main scan (async chunked) ──────────────────────────────────────

  function scan(callback) {
    cleanup();
    isActive = true;
    const thisScan = ++scanId;

    const textNodes = getTextNodes(document.body);
    const runs = gatherTextRuns(textNodes);

    let totalFound = 0;
    const palindromeElements = [];
    let runIdx = 0;

    createScrollbarTrack();

    function processChunk(deadline) {
      // If a newer scan was started, abandon this one
      if (thisScan !== scanId) return;

      while (runIdx < runs.length) {
        const palindromes = findPalindromesInRun(runs[runIdx]);
        runIdx++;

        for (const { range, text } of palindromes) {
          const mark = highlightRange(range, text);
          if (mark && mark.isConnected) {
            palindromeElements.push({ el: mark, text });
            totalFound++;
          }
        }

        // Yield to the browser if we've used most of the idle time
        if (deadline.timeRemaining() < 2 && runIdx < runs.length) {
          requestIdleCallback(processChunk, { timeout: 100 });
          return;
        }
      }

      // All runs processed — add scrollbar markers in one batch
      for (const { el, text } of palindromeElements) {
        addScrollbarMarker(el, text);
      }

      if (callback) callback(totalFound);
    }

    // Kick off the first chunk
    if (runs.length === 0) {
      if (callback) callback(0);
    } else {
      requestIdleCallback(processChunk, { timeout: 200 });
    }
  }

  function cleanup() {
    isActive = false;
    scanId++; // cancel any in-flight async scan
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
      scan((count) => sendResponse({ count }));
      return true; // keep channel open for async response
    } else if (msg.action === "clear") {
      cleanup();
      sendResponse({ count: 0 });
    } else if (msg.action === "status") {
      sendResponse({ active: isActive, count: highlights.length, minLength: minPalindromeLength });
    }
    return true;
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
