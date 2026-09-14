(function (root) {
  function panelMarkup() {
    return [
      '<main class="license-shell">',
      '  <header class="status-panel">',
      '    <div class="title-row">',
      '      <div><p class="eyebrow">离线授权状态</p><h1>授权中心</h1></div>',
      '      <span id="statusBadge" class="status-badge">读取中</span>',
      '    </div>',
      '    <p id="featureNotice" class="notice" hidden></p>',
      '    <dl class="license-details" aria-label="授权状态详情">',
      '      <div class="primary-detail"><dt>授权类型</dt><dd id="licenseType">-</dd></div>',
      '      <div><dt>到期时间</dt><dd id="expiryTime">-</dd></div>',
      '      <div><dt>剩余时间</dt><dd id="remainingTime">-</dd></div>',
      '      <div><dt>可用范围</dt><dd id="accessScope">-</dd></div>',
      '    </dl>',
      '  </header>',
      '  <section class="panel machine-panel" aria-labelledby="machineTitle">',
      '    <div class="section-heading"><span class="section-index">01</span><div><h2 id="machineTitle">复制本机机器码</h2><p>购买或续费时，把机器码发送给客服。</p></div></div>',
      '    <label class="field-label" for="machineCode">本机机器码</label>',
      '    <div class="inline-row"><input id="machineCode" class="code-field" type="text" readonly aria-describedby="machineTitle"><button id="copyMachineCode" type="button" class="secondary">复制机器码</button></div>',
      '  </section>',
      '  <details class="license-disclosure activation-disclosure">',
      '    <summary id="activationTitle"><span class="disclosure-heading"><span class="section-index">02</span><span>粘贴并激活</span></span><small>月卡 / 季卡 / 年卡 / 永久版</small><span class="disclosure-arrow" aria-hidden="true"><svg class="disclosure-chevron" viewBox="0 0 16 16" focusable="false"><path d="M4 6l4 4 4-4"></path></svg></span></summary>',
      '    <section class="panel activation-panel" aria-labelledby="activationTitle">',
      '      <label class="field-label" for="activationCode">激活码</label>',
      '      <textarea id="activationCode" class="code-field" rows="3" autocomplete="off" spellcheck="false" placeholder="在这里粘贴激活码"></textarea>',
      '      <div class="activation-actions"><button id="pasteActivationCode" type="button" class="secondary">粘贴激活码</button><button id="activateButton" type="button" class="primary">立即激活</button></div>',
      '      <p id="status" class="status" role="status" aria-live="polite"></p>',
      '    </section>',
      '  </details>',
      '  <details class="license-disclosure contact-disclosure">',
      '    <summary id="contactTitle"><span class="disclosure-heading"><span>购买、续费与售后</span></span><small>微信 / QQ 联系方式</small><span class="disclosure-arrow" aria-hidden="true"><svg class="disclosure-chevron" viewBox="0 0 16 16" focusable="false"><path d="M4 6l4 4 4-4"></path></svg></span></summary>',
      '    <section class="panel contact-panel" aria-labelledby="contactTitle">',
      '      <div class="section-heading"><span class="section-index">03</span><div><h2>联系客服</h2><p>添加微信或联系 QQ，并发送上方机器码。</p></div></div>',
      '      <div class="contact-grid">',
      '        <img id="wechatQr" class="wechat-qr" src="../assets/wechat-qr.jpg" alt="购买与售后微信二维码">',
      '        <div class="contact-copy">',
      '          <div class="contact-method"><span class="contact-label">微信号</span><strong id="wechatNumber" class="contact-number"></strong><button id="copyWechatNumber" type="button" class="secondary">复制微信号</button></div>',
      '          <div class="contact-method"><span class="contact-label">QQ 联系方式</span><strong id="qqNumber" class="contact-number"></strong><button id="copyQqNumber" type="button" class="secondary">复制 QQ</button></div>',
      '        </div>',
      '      </div>',
      '    </section>',
      '  </details>',
      '  <p class="privacy-note">授权校验完全在本机完成，不上传文档、机器码或激活码。</p>',
      '</main>'
    ].join("");
  }

  function render(target) {
    var mount = target || document.getElementById("licenseRoot") || document.body;
    mount.innerHTML = panelMarkup();
    return mount.querySelector ? mount.querySelector(".license-shell") : null;
  }

  root.MathLicensePanelView = {
    render: render
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { render(); });
  } else {
    render();
  }
})(window);
