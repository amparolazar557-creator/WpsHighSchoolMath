(function (root, factory) {
  var api = factory(root);
  root.WpsPptApi = api;
  if (typeof globalThis !== "undefined") {
    globalThis.WpsPptApi = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function getApplication(app) {
    if (app) {
      return app;
    }
    if (root && root.Application) {
      return root.Application;
    }
    if (root && root.wps) {
      return root.wps;
    }
    return null;
  }

  function getActivePresentation(app) {
    var target = getApplication(app);
    try {
      if (target && target.ActivePresentation) {
        return target.ActivePresentation;
      }
    } catch (_) {}
    return null;
  }

  function getActiveSlide(app) {
    var target = getApplication(app);
    try {
      var selectedSlide = target.ActiveWindow.Selection.SlideRange.Item(1);
      if (selectedSlide) {
        return selectedSlide;
      }
    } catch (_) {}
    try {
      var viewSlide = target.ActiveWindow.View.Slide;
      if (viewSlide) {
        return viewSlide;
      }
    } catch (_) {}
    var presentation = getActivePresentation(target);
    try {
      if (presentation && presentation.Slides && presentation.Slides.Count > 0) {
        return presentation.Slides.Item(1);
      }
    } catch (_) {}
    return null;
  }

  function getPresentationSize(presentation) {
    try {
      return {
        width: Number(presentation.PageSetup.SlideWidth) || 720,
        height: Number(presentation.PageSetup.SlideHeight) || 540
      };
    } catch (_) {
      return { width: 720, height: 540 };
    }
  }

  function finiteNumber(value) {
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function shapeRect(shape) {
    try {
      var left = finiteNumber(shape.Left);
      var top = finiteNumber(shape.Top);
      var width = finiteNumber(shape.Width);
      var height = finiteNumber(shape.Height);
      if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) {
        return null;
      }
      return { left: left, top: top, width: width, height: height, shape: shape };
    } catch (_) {
      return null;
    }
  }

  function sameShape(leftShape, rightShape) {
    if (!leftShape || !rightShape) {
      return false;
    }
    try {
      if (leftShape === rightShape) {
        return true;
      }
    } catch (_) {}
    try {
      var leftId = String(leftShape.Id || leftShape.ID || "");
      var rightId = String(rightShape.Id || rightShape.ID || "");
      if (leftId && rightId && leftId === rightId) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function isVisibleShape(shape) {
    try {
      return shape.Visible !== 0 && shape.Visible !== false;
    } catch (_) {
      return true;
    }
  }

  function isBackgroundRect(rect, size, margin) {
    if (!rect || !size) {
      return false;
    }
    var coversWidth = rect.width >= size.width * 0.94;
    var coversHeight = rect.height >= size.height * 0.94;
    return coversWidth && coversHeight && rect.left <= margin && rect.top <= margin;
  }

  function collectObstacles(slide, size, options) {
    var result = [];
    var count = 0;
    var settings = options || {};
    var margin = Number(settings.margin) || 24;
    try { count = Number(slide.Shapes.Count) || 0; } catch (_) { count = 0; }
    for (var index = 1; index <= count; index += 1) {
      try {
        var shape = slide.Shapes.Item(index);
        if (!shape || sameShape(shape, settings.excludeShape) || !isVisibleShape(shape)) {
          continue;
        }
        var rect = shapeRect(shape);
        if (!rect || isBackgroundRect(rect, size, margin)) {
          continue;
        }
        result.push(rect);
      } catch (_) {}
    }
    return result;
  }

  function intersectionArea(rect, obstacle, padding) {
    var gap = Math.max(0, Number(padding) || 0);
    var obstacleLeft = obstacle.left - gap;
    var obstacleTop = obstacle.top - gap;
    var obstacleRight = obstacle.left + obstacle.width + gap;
    var obstacleBottom = obstacle.top + obstacle.height + gap;
    var left = Math.max(rect.left, obstacleLeft);
    var top = Math.max(rect.top, obstacleTop);
    var right = Math.min(rect.left + rect.width, obstacleRight);
    var bottom = Math.min(rect.top + rect.height, obstacleBottom);
    return right > left && bottom > top ? (right - left) * (bottom - top) : 0;
  }

  function measureOverlap(rect, obstacles, padding) {
    var total = 0;
    var count = 0;
    for (var index = 0; index < obstacles.length; index += 1) {
      var area = intersectionArea(rect, obstacles[index], padding);
      if (area > 0) {
        total += area;
        count += 1;
      }
    }
    return { area: total, count: count };
  }

  function rounded(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function addCandidate(candidates, seen, left, top, width, height, preference) {
    var key = Math.round(left) + ":" + Math.round(top);
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    candidates.push({
      left: rounded(left),
      top: rounded(top),
      width: rounded(width),
      height: rounded(height),
      preference: preference
    });
  }

  function placementCandidates(size, width, height, margin) {
    var minLeft = margin;
    var minTop = margin;
    var maxLeft = Math.max(minLeft, size.width - margin - width);
    var maxTop = Math.max(minTop, size.height - margin - height);
    var centerLeft = (minLeft + maxLeft) / 2;
    var centerTop = (minTop + maxTop) / 2;
    var candidates = [];
    var seen = {};
    var anchors = [
      [maxLeft, centerTop], [maxLeft, maxTop], [centerLeft, maxTop],
      [minLeft, maxTop], [minLeft, centerTop], [centerLeft, centerTop],
      [maxLeft, minTop], [centerLeft, minTop], [minLeft, minTop]
    ];
    for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
      addCandidate(candidates, seen, anchors[anchorIndex][0], anchors[anchorIndex][1], width, height, anchorIndex);
    }

    var horizontalSteps = Math.max(1, Math.ceil((maxLeft - minLeft) / Math.max(28, width * 0.16)));
    var verticalSteps = Math.max(1, Math.ceil((maxTop - minTop) / Math.max(24, height * 0.16)));
    for (var yIndex = 0; yIndex <= verticalSteps; yIndex += 1) {
      var top = minTop + (maxTop - minTop) * yIndex / verticalSteps;
      for (var xIndex = horizontalSteps; xIndex >= 0; xIndex -= 1) {
        var left = minLeft + (maxLeft - minLeft) * xIndex / horizontalSteps;
        addCandidate(candidates, seen, left, top, width, height, 20 + yIndex * (horizontalSteps + 1) + (horizontalSteps - xIndex));
      }
    }
    return candidates;
  }

  function fitBaseSize(size, desiredWidth, desiredHeight, margin) {
    var availableWidth = Math.max(40, size.width - margin * 2);
    var availableHeight = Math.max(40, size.height - margin * 2);
    var sourceWidth = Math.max(1, Number(desiredWidth) || 460);
    var sourceHeight = Math.max(1, Number(desiredHeight) || 300);
    var scale = Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight);
    return { width: sourceWidth * scale, height: sourceHeight * scale };
  }

  function findBestPlacement(slide, presentation, desiredWidth, desiredHeight, options) {
    var settings = options || {};
    var size = getPresentationSize(presentation);
    var margin = Math.max(8, Number(settings.margin) || 24);
    var padding = Math.max(0, Number(settings.padding) || 10);
    var fitted = fitBaseSize(size, desiredWidth, desiredHeight, margin);
    var obstacles = collectObstacles(slide, size, settings);
    var scales = settings.scales || [1, 0.9, 0.8, 0.7, 0.6, 0.5];
    var fallback = null;

    for (var scaleIndex = 0; scaleIndex < scales.length; scaleIndex += 1) {
      var scale = Math.max(0.25, Math.min(1, Number(scales[scaleIndex]) || 1));
      var width = fitted.width * scale;
      var height = fitted.height * scale;
      var candidates = placementCandidates(size, width, height, margin);
      var zeroOverlap = null;

      for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        var candidate = candidates[candidateIndex];
        var overlap = measureOverlap(candidate, obstacles, padding);
        candidate.overlapArea = rounded(overlap.area);
        candidate.overlapCount = overlap.count;
        candidate.scale = scale;
        candidate.score = overlap.area / Math.max(1, width * height) + (1 - scale) * 0.03 + candidate.preference * 0.000001;

        if (overlap.area === 0 && (!zeroOverlap || candidate.preference < zeroOverlap.preference)) {
          zeroOverlap = candidate;
        }
        if (!fallback || candidate.score < fallback.score) {
          fallback = candidate;
        }
      }
      if (zeroOverlap) {
        return zeroOverlap;
      }
    }

    return fallback || {
      left: margin,
      top: margin,
      width: rounded(fitted.width),
      height: rounded(fitted.height),
      overlapArea: 0,
      overlapCount: 0,
      scale: 1,
      score: 0
    };
  }

  return {
    getApplication: getApplication,
    getActivePresentation: getActivePresentation,
    getActiveSlide: getActiveSlide,
    getPresentationSize: getPresentationSize,
    findBestPlacement: findBestPlacement,
    _private: {
      shapeRect: shapeRect,
      isBackgroundRect: isBackgroundRect,
      collectObstacles: collectObstacles,
      intersectionArea: intersectionArea,
      measureOverlap: measureOverlap,
      placementCandidates: placementCandidates,
      fitBaseSize: fitBaseSize
    }
  };
});
