"use client";

declare global {
  interface Window {
    $crisp: any;
    CRISP_WEBSITE_ID: string;
  }
}

const CRISP_WEBSITE_ID = "2af6b20b-f6d5-48ba-99bf-8421baef0a2f";

let loaded = false;

function loadCrisp() {
  if (loaded) return;
  loaded = true;

  window.$crisp = [];
  window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
  window.$crisp.push(["do", "chat:hide"]);
  window.$crisp.push(["on", "chat:closed", function () {
    window.$crisp.push(["do", "chat:hide"]);
  }]);

  const s = document.createElement("script");
  s.src = "https://client.crisp.chat/l.js";
  s.async = true;
  document.head.appendChild(s);
}

export function useCrisp() {
  const openFeedback = () => {
    loadCrisp();
    window.$crisp.push(["do", "chat:show"]);
    window.$crisp.push(["do", "chat:open"]);
  };

  return { openFeedback };
}
