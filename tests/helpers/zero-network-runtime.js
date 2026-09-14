"use strict";

const DOM_URL_PROPERTIES = ["src", "href", "action", "formAction", "poster", "data"];

function blocked(name) {
  return function zeroNetworkBlockedCall() {
    throw new Error(`zero-network guard blocked ${name}`);
  };
}

function defineBlockedUrlProperties(target, label) {
  for (const property of DOM_URL_PROPERTIES) {
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: true,
      get() {
        return "";
      },
      set: blocked(`${label}.${property}`)
    });
  }
  target.setAttribute = function setAttribute(name) {
    if (DOM_URL_PROPERTIES.some(property => property.toLowerCase() === String(name).toLowerCase())) {
      return blocked(`${label}.setAttribute(${name})`)();
    }
    return undefined;
  };
  return target;
}

function createZeroNetworkRuntime(overrides = {}) {
  const application = Object.assign({}, overrides.Application || {});
  application.OAAssist = new Proxy({}, {
    get(target, property) {
      return blocked(`Application.OAAssist.${String(property)}`);
    }
  });

  const document = Object.assign({}, overrides.document || {});
  document.createElement = function createElement(tagName) {
    return defineBlockedUrlProperties({ tagName: String(tagName).toUpperCase() }, `document.createElement(${tagName})`);
  };

  const navigator = Object.assign({}, overrides.navigator || {}, {
    sendBeacon: blocked("navigator.sendBeacon")
  });

  const runtime = Object.assign({}, overrides, {
    fetch: blocked("fetch"),
    XMLHttpRequest: blocked("XMLHttpRequest"),
    WebSocket: blocked("WebSocket"),
    EventSource: blocked("EventSource"),
    RTCPeerConnection: blocked("RTCPeerConnection"),
    webkitRTCPeerConnection: blocked("webkitRTCPeerConnection"),
    mozRTCPeerConnection: blocked("mozRTCPeerConnection"),
    ActiveXObject: blocked("ActiveXObject"),
    navigator,
    document,
    Application: application
  });
  runtime.window = runtime;
  return runtime;
}

function installZeroNetworkGuards(target) {
  const runtime = createZeroNetworkRuntime(target);
  for (const key of Object.keys(runtime)) {
    target[key] = runtime[key];
  }
  return target;
}

module.exports = {
  DOM_URL_PROPERTIES,
  blocked,
  defineBlockedUrlProperties,
  createZeroNetworkRuntime,
  installZeroNetworkGuards
};
