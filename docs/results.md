# Compare and export

Open `ga inspect` to browse prepared study revisions, experiments, baseline/replay jobs and paginated seed-level measurements. Inspect warnings and failed evaluations before interpreting a front.

Compare raw metric values with their direction, units, number of seeds, and variability. A promising search candidate is not necessarily validated. Missing replay data means no trace has been retained; it does not mean the candidate was never measured.

`await run.results()` separates `search`, all independently evaluated finalists in `validated`, and the feasible independent front in `validatedFront`. Read actual surviving populations and cumulative discovered-front IDs with `await run.generations()`, and use `collectPages` when history spans multiple pages. The service handle's `export()` returns service metadata and dataset references. For a portable archive containing snapshots, events, and replay resource bytes, use `await run.archive()` in service execution or `await optimizer.export()` locally. Archives are data-only and cannot resume execution. The inspector can export a selected candidate with provenance. Exporting does not apply a design to your application.

## Mount in an application

```js
import { mountInspector } from '@genetic-assembly/inspector'
const inspector = mountInspector(document.getElementById('optimization'), {
  baseUrl: 'http://127.0.0.1:3001',
  onPreview(decisions, study) { console.log(decisions, study) },
  onExport(value) { console.log('Selected design', value) },
  onReplay(dataset) { console.log('Open application replay', dataset) }
})
// Call inspector.dispose() when unmounting.
```

The inspector does not depend on an application framework. Your preview and replay callbacks control how exported designs and datasets are displayed or applied.
