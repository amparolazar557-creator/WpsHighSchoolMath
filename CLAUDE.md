# WPS High School Math Add-in

## Architecture

- The project ships two WPS JS add-ins from one source tree:
  - Writer add-in: root `index.html`, `ribbon.xml`, `js/ribbon.js`
  - Presentation add-in: `ppt/index.html`, `ppt/ribbon.xml`, `js/ribbon-ppt.js`
- Shared symbol definitions live in `js/symbols.js`; do not duplicate the `SYMBOLS` map in host-specific ribbon files.
- Shared Presentation helpers live in `js/ppt-api.js`; use `WpsPptApi.getActivePresentation()` and `WpsPptApi.getActiveSlide()` instead of direct global `ActivePresentation` lookups.
- Shared task-pane cache invalidation and readiness checks live in `js/taskpane.js`; task-pane pages must call `MathTaskPanes.signalReady()` after successful initialization.
- Shared plotting configuration and validation live in `js/plot-config.js`, loaded synchronously before `js/plotter.js` and `js/function-plot-document.js`.
- Function graph rendering is host-independent in `js/plotter.js`. Offline installs use the packaged shared tool center with `ui/function-plot.js`; `js/function-plot-native.js` is a failure fallback and must not strip V2 settings from selected graphs.
- V1/V2/V3 metadata remains readable. V4 adds intersection and tangent settings, while results are recalculated rather than stored. Validate a newly inserted picture's metadata before deleting the old picture; propagate host operation errors.
- Use `FunctionPlotter.generateConfigSvg(config)` for the full editor; retain the legacy five-argument renderer for compatibility. Parameters must be resolved by the safe parser; guide positions cannot depend on x.
- Local graph favorites live in `js/plot-library.js`, loaded by both UI pages after the plotter. Pin one storage backend, verify writes, validate imports before merging, and preserve existing favorites on name conflicts. Never share its keys with licensing. Backup text is the supported migration route between storage environments.
- `js/plot-analysis.js` loads before the plotter in both synchronous host entries and UI pages. It performs bounded numerical searches and convergence checks; never describe the results as exhaustive or exact. `ui/function-analysis.js` owns the analysis controls and preserves curve identity during row edits. Analysis-enabled favorites use container version 2; continue reading version 1.
- Offline licensing uses Ed25519 signatures. `scripts/license-issuer.js` and `scripts/license-code.js` are issuer-side Node.js code; the add-ins load `js/vendor/tweetnacl-fast.min.js`, `js/license-public-key.js`, and then `js/license.js` to verify HSM2 codes. Never add private-key material or activation-code generation to a plugin payload.
- `scripts/license-keygen.js` initializes the issuer private key under `%APPDATA%\WpsHighSchoolMathIssuer` and writes the matching public-key module. Existing private keys must not be replaced after licenses have been issued.
- The issuer-only GUI is `scripts/license-tool.ps1`; `scripts/license-tool-cli.js` performs signing, public-key matching, and CSV history writes. `scripts/build-license-tool.ps1` packages the GUI with the pinned Node runtime, but must never package the private key or `license-keygen.js`.
- Per-user commercial uninstall registration is shared through `scripts/uninstall-registration.ps1`. Installation must register the product under HKCU Installed Apps and create the Start-menu shortcut; normal uninstall removes only product-owned WPS payloads/registrations while preserving `%APPDATA%\WpsHighSchoolMath` licensing state.
- The offline installer is built by `scripts/build-offline.ps1` and installs both plugin payloads into `%APPDATA%\kingsoft\wps\jsaddons`.

## Validation

Run these checks after changing ribbon, plotter, UI, or packaging code:

```powershell
node --check js\symbols.js
node --check js\ppt-api.js
node --check js\taskpane.js
node --check js\vendor\tweetnacl-fast.min.js
node --check js\license-public-key.js
node --check js\license.js
node --check scripts\license-issuer.js
node --check scripts\license-keygen.js
node --check scripts\license-code.js
node --check scripts\license-tool-cli.js
node tests\license-tool.logic.test.js
node --check js\ribbon.js
node --check js\ribbon-ppt.js
node --check js\plotter.js
node --check js\plot-config.js
node --check js\function-plot-native.js
node --check ui\function-plot.js
node --check ui\license-ui.js
node tests\taskpane.logic.test.js
node tests\license.logic.test.js
node tests\function-plot-native.logic.test.js
node tests\function-plot-enhanced.logic.test.js
node tests\function-plot-parameters.logic.test.js
node tests\plot-library.logic.test.js
node tests\plot-analysis.logic.test.js
node tests\ribbon.logic.test.js
node tests\ppt.logic.test.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\uninstall-registration.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\offline-uninstall.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-offline.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-license-tool.ps1
```
