// Some older WPS Writer builds initialize ribbon callbacks before async script
// elements finish loading. document.write keeps the legacy add-in load order
// synchronous: index.html -> main.js -> shared helpers -> ribbon.js.
document.write("<script type='text/javascript' src='js/symbols.js'></script>");
document.write("<script type='text/javascript' src='js/taskpane.js'></script>");
document.write("<script type='text/javascript' src='js/vendor/tweetnacl-fast.min.js'></script>");
document.write("<script type='text/javascript' src='js/license-public-key.js'></script>");
document.write("<script type='text/javascript' src='js/license.js'></script>");
document.write("<script type='text/javascript' src='js/plot-config.js'></script>");
document.write("<script type='text/javascript' src='js/plot-analysis.js'></script>");
document.write("<script type='text/javascript' src='js/plotter.js'></script>");
document.write("<script type='text/javascript' src='js/function-plot-document.js'></script>");
document.write("<script type='text/javascript' src='js/function-plot-native.js'></script>");
document.write("<script type='text/javascript' src='js/ribbon.js'></script>");
