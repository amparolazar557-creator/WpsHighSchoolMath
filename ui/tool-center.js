(function (root) {
  var PANE_NAME = "tool-center";
  var DEFAULT_VIEW = "function-plot";
  var VIEWS = {
    "function-plot": true,
    "license": true
  };
  var activeView = "";

  function normalizeView(view) {
    var value = String(view || "");
    return VIEWS[value] ? value : DEFAULT_VIEW;
  }

  function queryValue(name) {
    var query = String(document.location.search || "").replace(/^\?/, "").split("&");
    for (var index = 0; index < query.length; index += 1) {
      var pair = query[index].split("=");
      if (!pair[0]) {
        continue;
      }
      try {
        if (decodeURIComponent(pair[0]) === name) {
          return decodeURIComponent(pair.slice(1).join("=") || "");
        }
      } catch (_) {}
    }
    return "";
  }

  function getApplication() {
    try { return root.Application || root.wps || null; } catch (_) { return null; }
  }

  function tabs() {
    return document.querySelectorAll("[data-view]");
  }

  function panels() {
    return document.querySelectorAll("[data-panel]");
  }

  function updateUi(view, focusTab) {
    var normalized = normalizeView(view);
    var tabList = tabs();
    var panelList = panels();
    var selectedTab = null;
    var index;
    for (index = 0; index < tabList.length; index += 1) {
      var tabSelected = tabList[index].getAttribute("data-view") === normalized;
      tabList[index].className = tabSelected ? "tool-tab active" : "tool-tab";
      tabList[index].setAttribute("aria-selected", tabSelected ? "true" : "false");
      tabList[index].setAttribute("tabindex", tabSelected ? "0" : "-1");
      if (tabSelected) {
        selectedTab = tabList[index];
      }
    }
    for (index = 0; index < panelList.length; index += 1) {
      var panelSelected = panelList[index].getAttribute("data-panel") === normalized;
      panelList[index].hidden = !panelSelected;
      panelList[index].className = panelSelected ? "tool-view active" : "tool-view";
    }
    activeView = normalized;
    if (root.MathFunctionPlotPanel && typeof root.MathFunctionPlotPanel.setVisible === "function") {
      root.MathFunctionPlotPanel.setVisible(normalized === "function-plot");
    }
    if (normalized === "license" && root.MathLicensePanel &&
        typeof root.MathLicensePanel.refresh === "function") {
      root.MathLicensePanel.refresh();
    }
    if (focusTab && selectedTab && selectedTab.focus) {
      selectedTab.focus();
    }
    return true;
  }

  function showView(view, options) {
    options = options || {};
    var normalized = normalizeView(view);
    updateUi(normalized, options.focus === true);
    if (options.store !== false && root.MathTaskPanes &&
        typeof root.MathTaskPanes.requestView === "function") {
      root.MathTaskPanes.requestView(getApplication(), PANE_NAME, normalized);
    }
    return true;
  }

  function synchronizeRequestedView() {
    if (!root.MathTaskPanes) {
      return;
    }
    var app = getApplication();
    if (typeof root.MathTaskPanes.getRequestedView === "function") {
      var requested = root.MathTaskPanes.getRequestedView(app, PANE_NAME, activeView || DEFAULT_VIEW);
      if (requested && requested !== activeView) {
        updateUi(requested, false);
      }
    }
    if (typeof root.MathTaskPanes.acknowledgeView === "function") {
      root.MathTaskPanes.acknowledgeView(app, PANE_NAME);
    }
  }

  function handleTabKey(event) {
    event = event || root.event;
    var key = event.key || "";
    var keyCode = event.keyCode;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && keyCode !== 37 && keyCode !== 39) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    showView(activeView === "function-plot" ? "license" : "function-plot", { focus: true });
  }

  function initialize() {
    var initialView = queryValue("hsmView");
    if (root.MathTaskPanes && typeof root.MathTaskPanes.getRequestedView === "function") {
      initialView = root.MathTaskPanes.getRequestedView(getApplication(), PANE_NAME, initialView || DEFAULT_VIEW);
    }
    updateUi(initialView, false);
    var tabList = tabs();
    for (var index = 0; index < tabList.length; index += 1) {
      tabList[index].addEventListener("click", function () {
        showView(this.getAttribute("data-view"));
      });
      tabList[index].addEventListener("keydown", handleTabKey);
    }
    synchronizeRequestedView();
    if (root.MathTaskPanes) {
      root.MathTaskPanes.signalReady(PANE_NAME);
    }
    if (typeof root.setInterval === "function") {
      root.setInterval(synchronizeRequestedView, 250);
    }
  }

  root.MathToolCenter = {
    showView: showView,
    getActiveView: function () { return activeView; },
    synchronize: synchronizeRequestedView
  };

  root.addEventListener("DOMContentLoaded", initialize);
})(window);
