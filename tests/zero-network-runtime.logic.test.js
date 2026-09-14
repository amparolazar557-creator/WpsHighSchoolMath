"use strict";

const assert = require("assert");
const {
  DOM_URL_PROPERTIES,
  createZeroNetworkRuntime,
  installZeroNetworkGuards
} = require("./helpers/zero-network-runtime.js");

{
  const runtime = createZeroNetworkRuntime();
  for (const constructorName of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "ActiveXObject"
  ]) {
    assert.throws(() => runtime[constructorName](), new RegExp(constructorName));
  }
  assert.throws(() => runtime.navigator.sendBeacon("/telemetry"), /sendBeacon/);
  assert.throws(() => runtime.Application.OAAssist.ShellExecute("helper.exe"), /OAAssist\.ShellExecute/);

  const element = runtime.document.createElement("img");
  for (const property of DOM_URL_PROPERTIES) {
    assert.throws(() => {
      element[property] = `./${property}.png`;
    }, new RegExp(property, "i"));
    assert.throws(() => element.setAttribute(property, `./${property}.png`), /setAttribute/);
  }
}

{
  const context = {
    keepValue: 42,
    pureNativeCommand(value) {
      return value * 2;
    }
  };
  installZeroNetworkGuards(context);
  assert.equal(context.keepValue, 42);
  assert.equal(context.pureNativeCommand(21), 42, "normal native logic must run without touching a guard");
  assert.throws(() => context.fetch("./relative"), /zero-network guard/);
}

console.log("zero-network runtime guard tests passed");
