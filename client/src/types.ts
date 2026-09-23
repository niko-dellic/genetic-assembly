export type Axis = "x" | "y" | "z";

export type Variable =
  | { kind: "real"; lower: number; upper: number }
  | { kind: "integer"; lower: number; upper: number; step?: number }
  | { kind: "binary" };

export type LeverTarget =
  | { type: "position"; object_id: string; axis: Axis }
  | { type: "rotation"; object_id: string; axis: Axis }
  | { type: "scale"; object_id: string; axis: Axis }
  | { type: "visibility"; object_id: string }
  | { type: "material"; object_id: string; property: string }
  | { type: "user_data"; object_id: string; path: string };

export type LeverSpec = Variable & { id: string; target: LeverTarget };

export interface ManifestObject {
  id: string;
  numeric_metadata?: Record<string, number>;
  numeric_properties?: Record<string, number>;
  visible?: boolean;
}

export interface SceneManifest { schema_version?: 1; objects?: ManifestObject[]; levers: LeverSpec[] }

export interface ScenePatch { lever_id: string; target: LeverTarget; value: number }
export interface SceneDecisionBinding { decision: string; target: LeverTarget }
