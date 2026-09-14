const assert = require("assert");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const pptApi = require(path.join(projectRoot, "js", "ppt-api.js"));
global.WpsPptApi = pptApi;
const functionDocument = require(path.join(projectRoot, "js", "function-plot-document.js"));

const config = {
  expressions: ["x^2", "sin(x)"],
  bounds: { xMin: -6, xMax: 8, yMin: -4, yMax: 12 },
  options: {
    showTickLabels: true,
    showGrid: false,
    showBorder: true,
    showLegend: false
  }
};

{
  const metadata = functionDocument.serializeMetadata(config);
  assert(metadata.startsWith("函数图像：x^2；sin(x)"));
  assert(metadata.includes(functionDocument.METADATA_PREFIX));
  assert.deepStrictEqual(functionDocument.parseMetadata(metadata), config);
  assert.equal(functionDocument.parseMetadata("函数图像：x^2"), null);
  assert.equal(functionDocument.parseMetadata("HSM_FUNCTION_PLOT_V1:not-json"), null);
}

function makeShape(left, top, width, height, extra = {}) {
  return Object.assign({ Left: left, Top: top, Width: width, Height: height, Visible: -1 }, extra);
}

function makeSlide(existingShapes) {
  const items = existingShapes.slice();
  return {
    Shapes: {
      get Count() { return items.length; },
      Item(index) { return items[index - 1]; },
      AddPicture(filePath, linkToFile, saveWithDocument, left, top, width, height) {
        const shape = makeShape(left, top, width, height, {
          filePath,
          Delete() { this.deleted = true; },
          Select() { this.selected = true; }
        });
        items.push(shape);
        return shape;
      }
    },
    items
  };
}

{
  const presentation = { PageSetup: { SlideWidth: 720, SlideHeight: 540 } };
  const slide = makeSlide([
    makeShape(0, 0, 720, 76, { Name: "标题" }),
    makeShape(20, 110, 320, 350, { Name: "正文" })
  ]);
  const placement = pptApi.findBestPlacement(slide, presentation, 460, 307, {
    margin: 24,
    padding: 10
  });
  assert.equal(placement.overlapArea, 0);
  assert(placement.left >= 24);
  assert(placement.top >= 24);
  assert(placement.left + placement.width <= 696.01);
  assert(placement.top + placement.height <= 516.01);
  assert(placement.left >= 350, "plot should use the open right-hand region");
  assert(placement.scale < 1, "plot should shrink only enough to find a clear region");
}

{
  const presentation = { PageSetup: { SlideWidth: 720, SlideHeight: 540 } };
  const slide = makeSlide([
    makeShape(0, 0, 355, 265),
    makeShape(365, 0, 355, 265),
    makeShape(0, 275, 355, 265),
    makeShape(365, 275, 355, 265)
  ]);
  const placement = pptApi.findBestPlacement(slide, presentation, 460, 307, {
    margin: 24,
    padding: 10
  });
  assert(placement.overlapArea > 0, "crowded slide should report unavoidable overlap");
  assert(placement.left >= 24 && placement.top >= 24);
  assert(placement.left + placement.width <= 696.01);
  assert(placement.top + placement.height <= 516.01);
}

{
  const title = makeShape(0, 0, 720, 80);
  const body = makeShape(24, 110, 300, 330);
  const slide = makeSlide([title, body]);
  const presentation = {
    PageSetup: { SlideWidth: 720, SlideHeight: 540 },
    Slides: { Count: 1, Item() { return slide; } }
  };
  const selection = {
    ShapeRange: { Count: 0, Item() { return null; } },
    SlideRange: { Item() { return slide; } }
  };
  const app = {
    ActivePresentation: presentation,
    ActiveWindow: { Selection: selection, View: { Slide: slide } }
  };
  const plot = { width: 720, height: 480, expressions: config.expressions };
  const inserted = functionDocument.insertOrUpdate(app, "C:\\Temp\\plot.svg", plot, config);
  assert.equal(inserted.updated, false);
  assert.equal(inserted.host, "presentation");
  assert.equal(inserted.placement.overlapArea, 0);
  assert(inserted.shape.AlternativeText.includes(functionDocument.METADATA_PREFIX));
  assert.equal(inserted.shape.Name, "高中数学函数图像");

  const oldShape = makeShape(101, 202, 303, 204, {
    AlternativeText: functionDocument.serializeMetadata(config),
    Delete() { this.deleted = true; }
  });
  selection.ShapeRange = { Count: 1, Item() { return oldShape; } };
  const updatedConfig = Object.assign({}, config, {
    expressions: ["a*abs(x)+c"],
    parameters: require("../js/plot-config.js").normalizeParameters({}),
    guides: [{ axis: "y", expression: "c" }],
    analysis: { tangent: { curve: 0, x: "1" } }
  });
  const updated = functionDocument.insertOrUpdate(app, "C:\\Temp\\plot-2.svg", plot, updatedConfig);
  assert.equal(updated.updated, true);
  assert.equal(oldShape.deleted, true);
  assert.equal(updated.shape.Left, 101);
  assert.equal(updated.shape.Top, 202);
  assert.equal(updated.shape.Width, 303);
  assert.equal(updated.shape.Height, 204);
  assert.deepStrictEqual(functionDocument.parseMetadata(updated.shape.AlternativeText), updatedConfig);
}

{
  const plotShape = makeShape(80, 120, 320, 220, {
    AlternativeText: functionDocument.serializeMetadata(config)
  });
  const textBox = makeShape(40, 40, 240, 80, {
    AlternativeText: "普通文本框"
  });
  let selectedShape = plotShape;
  const app = {
    ActivePresentation: {},
    ActiveWindow: {
      Selection: {
        ShapeRange: {
          Count: 1,
          Item() { return selectedShape; }
        }
      }
    }
  };

  assert(functionDocument.getSelectedPlot(app), "plugin plot selection should enter update mode");
  selectedShape = textBox;
  assert.equal(functionDocument.getSelectedPlot(app), null, "ordinary text box selection should leave update mode");
}

console.log("editable function plot metadata and PPT auto-placement tests passed");
