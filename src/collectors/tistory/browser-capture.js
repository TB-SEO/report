/**
 * 티스토리 통계 페이지(로그인된 관리 화면) 콘솔에 붙여 넣는다.
 * 네트워크 JSON + 화면 텍스트를 파일로 내려받는다.
 */
(() => {
  const key = "__seoReportTistoryCapture";
  const w = window;

  if (!w[key]) {
    const bag = [];
    const push = (url, body) => {
      bag.push({ url, body, at: Date.now() });
    };

    const origFetch = w.fetch.bind(w);
    w.fetch = async (...args) => {
      const res = await origFetch(...args);
      try {
        const clone = res.clone();
        const type = clone.headers.get("content-type") || "";
        if (type.includes("json")) push(String(args[0]), await clone.json());
      } catch (_) {}
      return res;
    };

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__seoUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        try {
          const type = this.getResponseHeader("content-type") || "";
          if (type.includes("json")) push(String(this.__seoUrl), JSON.parse(this.responseText));
        } catch (_) {}
      });
      return origSend.apply(this, args);
    };

    w[key] = bag;
    console.log("[SEO Report] 캡처 훅을 설치했습니다. 통계 페이지를 새로고침한 뒤 이 스크립트를 한 번 더 실행하세요.");
    location.reload();
    return;
  }

  const payload = {
    capturedAt: new Date().toISOString(),
    pageUrl: location.href,
    pageText: document.body.innerText,
    networkJson: w[key],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tistory-stats-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  console.log(`[SEO Report] ${payload.networkJson.length}개 JSON 응답을 저장했습니다. data/tistory-raw 에 넣고 npm run tistory:ingest`);
})();
