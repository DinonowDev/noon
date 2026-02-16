document.addEventListener("DOMContentLoaded", () => {
  const btnScan = document.getElementById("btn-scan");
  const btnClear = document.getElementById("btn-clear");
  const resultBox = document.getElementById("result");
  const resultCount = document.getElementById("result-count");

  function showResult(count) {
    resultCount.textContent = count;
    resultBox.classList.remove("hidden");
    btnClear.disabled = count === 0;
  }

  function sendMessage(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
        if (chrome.runtime.lastError) {
          resultBox.classList.remove("hidden");
          resultBox.innerHTML = '<span style="color:#e55">Cannot access this page</span>';
          return;
        }
        if (response) {
          if (action === "clear") {
            resultBox.classList.add("hidden");
            btnClear.disabled = true;
          } else {
            showResult(response.count);
          }
        }
      });
    });
  }

  // Check current status on popup open (auto-scan already ran)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: "status" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.active) {
        showResult(response.count);
      }
    });
  });

  btnScan.addEventListener("click", () => sendMessage("scan"));
  btnClear.addEventListener("click", () => sendMessage("clear"));
});
