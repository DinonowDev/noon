document.addEventListener("DOMContentLoaded", () => {
  const btnScan = document.getElementById("btn-scan");
  const btnClear = document.getElementById("btn-clear");
  const resultBox = document.getElementById("result");
  const resultCount = document.getElementById("result-count");
  const slider = document.getElementById("min-length");
  const sliderValue = document.getElementById("min-length-value");

  function showResult(count) {
    resultCount.textContent = count;
    resultBox.classList.remove("hidden");
    btnClear.disabled = count === 0;
  }

  function sendToTab(msg, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) return;
        if (callback) callback(response);
      });
    });
  }

  function triggerScan() {
    const minLength = parseInt(slider.value, 10);
    sendToTab({ action: "scan", minLength }, (response) => {
      if (response) showResult(response.count);
    });
  }

  // Load saved setting
  chrome.storage.sync.get({ minPalindromeLength: 5 }, (settings) => {
    slider.value = settings.minPalindromeLength;
    sliderValue.textContent = settings.minPalindromeLength;
  });

  // Slider: update display live, save + re-scan on release
  slider.addEventListener("input", () => {
    sliderValue.textContent = slider.value;
  });

  slider.addEventListener("change", () => {
    const minLength = parseInt(slider.value, 10);
    chrome.storage.sync.set({ minPalindromeLength: minLength });
    triggerScan();
  });

  // Check current status on popup open (auto-scan already ran)
  sendToTab({ action: "status" }, (response) => {
    if (response && response.active) {
      showResult(response.count);
    }
  });

  btnScan.addEventListener("click", triggerScan);
  btnClear.addEventListener("click", () => {
    sendToTab({ action: "clear" }, () => {
      resultBox.classList.add("hidden");
      btnClear.disabled = true;
    });
  });
});
