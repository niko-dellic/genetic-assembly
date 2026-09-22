# Evaluator context

The built-in Three.js evaluator exports `evaluate(ctx)` and returns `{ objectives: number[], constraints: number[] }`. Values must be finite and match declared dimensions. Functions read a candidate's immutable metric snapshot; they do not expose mutable scene objects.

| Function | Result |
| --- | --- |
| `objectCount()` | Number of objects in the input snapshot |
| `lever(id)` | Numeric value for a declared lever; unknown IDs throw |
| `visible(id)` | Object visibility |
| `bounds(id)` | Axis-aligned bounds with `min` and `max` coordinate arrays |
| `surfaceArea(id)` | Surface area metric |
| `volume(id)` | Volume metric |
| `vertexCount(id)` | Vertex count |
| `triangleCount(id)` | Triangle count |
| `metadata(id, key)` | Metadata value; missing keys return `undefined` |
| `property(id, key)` | Numeric property value; missing keys return `undefined` |
| `centerDistance(left, right)` | Euclidean distance between bounding-box centers |
| `targetDistance(id, [x, y, z])` | Distance from bounding-box center to target |
| `overlapVolume(left, right)` | Axis-aligned bounding-box overlap volume |
| `intersects(left, right)` | True when bounding boxes overlap strictly on every axis; touching alone is false |
| `targetPenalty(value, target)` | Absolute difference |
| `rangePenalty(value, minimum, maximum)` | Distance outside the range, or zero inside |

Every object-reading function throws for an unknown object ID. AABB intersection is not exact triangle collision. Use the same spatial units throughout the problem. Surface and volume metrics describe the scene snapshot and its supported transforms.

```js
export function evaluate(ctx) {
  return {
    objectives: [ctx.targetDistance('box', [4, 0, 0])],
    constraints: [ctx.overlapVolume('box', 'obstacle')]
  };
}
```

QuickJS enforces configured memory, stack, and time limits. Ambient imports and randomness are rejected. Keep evaluation deterministic and use an external adapter when the model needs a different runtime or richer capabilities.
