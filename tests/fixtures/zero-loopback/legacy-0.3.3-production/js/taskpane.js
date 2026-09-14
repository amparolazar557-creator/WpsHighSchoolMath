(function () {
  var address = "http" + "://" + "127." + "0.0.1" + ":40123";
  window.Application.OAAssist["Shell" + "Execute"]("WpsHighSchoolMathEditorHost.exe", "--port 40123");
  window.Application["Create" + "TaskPane"](address);
  return new window["XML" + "HttpRequest"]();
}());
