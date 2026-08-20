//! Immutable glTF/Three.js scene storage and candidate overlays.

use genetic_assembly_core::Variable;
use glam::{EulerRot, Mat4, Quat, Vec3};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use thiserror::Error;

pub const SCENE_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SceneManifest {
    #[serde(default = "manifest_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub objects: Vec<ManifestObject>,
    pub levers: Vec<LeverSpec>,
}

const fn manifest_version() -> u32 {
    SCENE_MANIFEST_SCHEMA_VERSION
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct ManifestObject {
    pub id: String,
    #[serde(default)]
    pub numeric_metadata: HashMap<String, f64>,
    #[serde(default)]
    pub numeric_properties: HashMap<String, f64>,
    #[serde(default = "default_visible")]
    pub visible: bool,
}

const fn default_visible() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LeverSpec {
    pub id: String,
    #[serde(flatten)]
    pub variable: Variable,
    pub target: LeverTarget,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Axis {
    X,
    Y,
    Z,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LeverTarget {
    Position { object_id: String, axis: Axis },
    Rotation { object_id: String, axis: Axis },
    Scale { object_id: String, axis: Axis },
    Visibility { object_id: String },
    Material { object_id: String, property: String },
    UserData { object_id: String, path: String },
}

impl LeverTarget {
    pub fn object_id(&self) -> &str {
        match self {
            Self::Position { object_id, .. }
            | Self::Rotation { object_id, .. }
            | Self::Scale { object_id, .. }
            | Self::Visibility { object_id }
            | Self::Material { object_id, .. }
            | Self::UserData { object_id, .. } => object_id,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ScenePatch {
    pub lever_id: String,
    pub target: LeverTarget,
    pub value: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Aabb {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl Aabb {
    pub fn center(self) -> Vec3 {
        (Vec3::from_array(self.min.map(|v| v as f32))
            + Vec3::from_array(self.max.map(|v| v as f32)))
            * 0.5
    }

    pub fn volume(self) -> f64 {
        (self.max[0] - self.min[0]).max(0.0)
            * (self.max[1] - self.min[1]).max(0.0)
            * (self.max[2] - self.min[2]).max(0.0)
    }
}

#[derive(Clone, Debug)]
struct MeshGeometry {
    positions: Arc<[Vec3]>,
    indices: Arc<[u32]>,
    local_bounds: Aabb,
    signed_volume: f64,
}

#[derive(Clone, Debug)]
struct SceneNode {
    id: Option<String>,
    parent: Option<usize>,
    translation: Vec3,
    rotation: Quat,
    euler: Vec3,
    scale: Vec3,
    mesh: Option<usize>,
}

/// Heavy buffers are held once and shared by all candidate evaluations.
#[derive(Clone, Debug)]
pub struct SceneGeometry {
    nodes: Arc<[SceneNode]>,
    meshes: Arc<[MeshGeometry]>,
    object_indices: Arc<HashMap<String, usize>>,
    manifest_objects: Arc<HashMap<String, ManifestObject>>,
    manifest: Arc<SceneManifest>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MetricSnapshot {
    pub object_count: usize,
    pub levers: HashMap<String, f64>,
    pub objects: HashMap<String, ObjectMetrics>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ObjectMetrics {
    pub visible: bool,
    pub bounds: Option<Aabb>,
    pub surface_area: Option<f64>,
    pub volume: Option<f64>,
    pub vertex_count: Option<usize>,
    pub triangle_count: Option<usize>,
    pub metadata: HashMap<String, f64>,
    pub properties: HashMap<String, f64>,
}

impl SceneGeometry {
    pub fn from_glb(glb: &[u8], manifest: SceneManifest) -> Result<Self, SceneError> {
        if manifest.schema_version != SCENE_MANIFEST_SCHEMA_VERSION {
            return Err(SceneError::InvalidManifest(format!(
                "unsupported schema version {}",
                manifest.schema_version
            )));
        }
        validate_manifest(&manifest)?;
        let (document, buffers, _) =
            gltf::import_slice(glb).map_err(|error| SceneError::InvalidGlb(error.to_string()))?;
        let mut meshes = Vec::new();
        let mut mesh_indices = HashMap::new();
        for mesh in document.meshes() {
            if mesh.weights().is_some() {
                return Err(SceneError::Unsupported(
                    "mesh morph weights are not supported".into(),
                ));
            }
            let mut positions = Vec::new();
            let mut indices = Vec::new();
            for primitive in mesh.primitives() {
                if primitive.mode() != gltf::mesh::Mode::Triangles {
                    return Err(SceneError::Unsupported(
                        "only triangle primitives are supported".into(),
                    ));
                }
                if primitive.morph_targets().len() > 0 {
                    return Err(SceneError::Unsupported(
                        "morph targets are not supported".into(),
                    ));
                }
                let reader = primitive.reader(|buffer| Some(&buffers[buffer.index()]));
                let base = positions.len() as u32;
                let primitive_positions: Vec<Vec3> = reader
                    .read_positions()
                    .ok_or_else(|| {
                        SceneError::InvalidGlb("triangle primitive has no positions".into())
                    })?
                    .map(Vec3::from_array)
                    .collect();
                positions.extend(primitive_positions);
                if let Some(read_indices) = reader.read_indices() {
                    indices.extend(read_indices.into_u32().map(|index| base + index));
                } else {
                    indices.extend(base..positions.len() as u32);
                }
            }
            let geometry = MeshGeometry::new(positions, indices)?;
            mesh_indices.insert(mesh.index(), meshes.len());
            meshes.push(geometry);
        }

        let mut nodes = Vec::new();
        let mut document_to_scene = HashMap::new();
        for node in document.nodes() {
            if node.skin().is_some() {
                return Err(SceneError::Unsupported(
                    "skinned meshes are not supported".into(),
                ));
            }
            let (translation, rotation, scale) = node.transform().decomposed();
            let rotation = Quat::from_array(rotation).normalize();
            let (rx, ry, rz) = rotation.to_euler(EulerRot::XYZ);
            let id = extract_ga_id(node.extras());
            let index = nodes.len();
            document_to_scene.insert(node.index(), index);
            nodes.push(SceneNode {
                id,
                parent: None,
                translation: Vec3::from_array(translation),
                rotation,
                euler: Vec3::new(rx, ry, rz),
                scale: Vec3::from_array(scale),
                mesh: node
                    .mesh()
                    .and_then(|mesh| mesh_indices.get(&mesh.index()).copied()),
            });
        }
        for parent in document.nodes() {
            let parent_index = document_to_scene[&parent.index()];
            for child in parent.children() {
                nodes[document_to_scene[&child.index()]].parent = Some(parent_index);
            }
        }

        let mut object_indices = HashMap::new();
        for (index, node) in nodes.iter().enumerate() {
            if let Some(id) = &node.id
                && object_indices.insert(id.clone(), index).is_some()
            {
                return Err(SceneError::InvalidManifest(format!(
                    "duplicate userData.gaId `{id}` in GLB"
                )));
            }
        }
        for lever in &manifest.levers {
            if !object_indices.contains_key(lever.target.object_id()) {
                return Err(SceneError::InvalidManifest(format!(
                    "lever `{}` references missing userData.gaId `{}`",
                    lever.id,
                    lever.target.object_id()
                )));
            }
        }
        let manifest_objects: HashMap<_, _> = manifest
            .objects
            .iter()
            .cloned()
            .map(|object| (object.id.clone(), object))
            .collect();
        Ok(Self {
            nodes: nodes.into(),
            meshes: meshes.into(),
            object_indices: Arc::new(object_indices),
            manifest_objects: Arc::new(manifest_objects),
            manifest: Arc::new(manifest),
        })
    }

    pub fn manifest(&self) -> &SceneManifest {
        &self.manifest
    }
    pub fn variables(&self) -> Vec<Variable> {
        self.manifest
            .levers
            .iter()
            .map(|lever| lever.variable.clone())
            .collect()
    }
    pub fn object_count(&self) -> usize {
        self.object_indices.len()
    }
    pub fn mesh_count(&self) -> usize {
        self.meshes.len()
    }
    pub fn view<'a>(&'a self, genes: &'a [f64]) -> Result<SceneView<'a>, SceneError> {
        if genes.len() != self.manifest.levers.len() {
            return Err(SceneError::InvalidCandidate(format!(
                "expected {} genes, got {}",
                self.manifest.levers.len(),
                genes.len()
            )));
        }
        if genes.iter().any(|value| !value.is_finite()) {
            return Err(SceneError::InvalidCandidate("genes must be finite".into()));
        }
        Ok(SceneView {
            scene: self,
            genes,
            world_cache: RefCell::new(vec![None; self.nodes.len()]),
        })
    }
    pub fn patches(&self, genes: &[f64]) -> Result<Vec<ScenePatch>, SceneError> {
        self.view(genes)?;
        Ok(self
            .manifest
            .levers
            .iter()
            .zip(genes)
            .map(|(lever, &value)| ScenePatch {
                lever_id: lever.id.clone(),
                target: lever.target.clone(),
                value,
            })
            .collect())
    }

    pub fn metric_snapshot(&self, genes: &[f64]) -> Result<MetricSnapshot, SceneError> {
        let view = self.view(genes)?;
        let levers = self
            .manifest
            .levers
            .iter()
            .zip(genes)
            .map(|(lever, &value)| (lever.id.clone(), value))
            .collect();
        let mut objects = HashMap::new();
        for (object_id, &node_index) in self.object_indices.iter() {
            let manifest_object = self.manifest_objects.get(object_id);
            let mut properties = manifest_object
                .map(|object| object.numeric_properties.clone())
                .unwrap_or_default();
            for (index, lever) in self.manifest.levers.iter().enumerate() {
                match &lever.target {
                    LeverTarget::Material {
                        object_id: id,
                        property,
                    } if id == object_id => {
                        properties.insert(property.clone(), genes[index]);
                    }
                    LeverTarget::UserData {
                        object_id: id,
                        path,
                    } if id == object_id => {
                        properties.insert(path.clone(), genes[index]);
                    }
                    _ => {}
                }
            }
            let mesh = self.nodes[node_index].mesh.map(|index| &self.meshes[index]);
            objects.insert(
                object_id.clone(),
                ObjectMetrics {
                    visible: view.visible(object_id)?,
                    bounds: view.bounds(object_id).ok(),
                    surface_area: view.surface_area(object_id).ok(),
                    volume: view.volume(object_id).ok(),
                    vertex_count: mesh.map(|mesh| mesh.positions.len()),
                    triangle_count: mesh.map(|mesh| mesh.indices.len() / 3),
                    metadata: manifest_object
                        .map(|object| object.numeric_metadata.clone())
                        .unwrap_or_default(),
                    properties,
                },
            );
        }
        Ok(MetricSnapshot {
            object_count: self.object_indices.len(),
            levers,
            objects,
        })
    }
}

pub struct SceneView<'a> {
    scene: &'a SceneGeometry,
    genes: &'a [f64],
    world_cache: RefCell<Vec<Option<Mat4>>>,
}

impl SceneView<'_> {
    pub fn lever(&self, id: &str) -> Result<f64, SceneError> {
        self.scene
            .manifest
            .levers
            .iter()
            .position(|lever| lever.id == id)
            .map(|index| self.genes[index])
            .ok_or_else(|| SceneError::UnknownLever(id.into()))
    }

    pub fn metadata(&self, object_id: &str, key: &str) -> Result<f64, SceneError> {
        self.scene
            .manifest_objects
            .get(object_id)
            .and_then(|object| object.numeric_metadata.get(key))
            .copied()
            .ok_or_else(|| SceneError::UnknownProperty(format!("{object_id}.metadata.{key}")))
    }

    pub fn property(&self, object_id: &str, key: &str) -> Result<f64, SceneError> {
        for (index, lever) in self.scene.manifest.levers.iter().enumerate() {
            match &lever.target {
                LeverTarget::Material {
                    object_id: id,
                    property,
                } if id == object_id && property == key => return Ok(self.genes[index]),
                LeverTarget::UserData {
                    object_id: id,
                    path,
                } if id == object_id && path == key => return Ok(self.genes[index]),
                _ => {}
            }
        }
        self.scene
            .manifest_objects
            .get(object_id)
            .and_then(|object| object.numeric_properties.get(key))
            .copied()
            .ok_or_else(|| SceneError::UnknownProperty(format!("{object_id}.{key}")))
    }

    pub fn visible(&self, object_id: &str) -> Result<bool, SceneError> {
        for (index, lever) in self.scene.manifest.levers.iter().enumerate() {
            if let LeverTarget::Visibility { object_id: id } = &lever.target
                && id == object_id
            {
                return Ok(self.genes[index] >= 0.5);
            }
        }
        Ok(self
            .scene
            .manifest_objects
            .get(object_id)
            .map(|object| object.visible)
            .unwrap_or(true))
    }

    pub fn bounds(&self, object_id: &str) -> Result<Aabb, SceneError> {
        let node_index = self.node_index(object_id)?;
        let node = &self.scene.nodes[node_index];
        let mesh_index = node.mesh.ok_or_else(|| {
            SceneError::MetricUnavailable(format!("object `{object_id}` has no mesh"))
        })?;
        Ok(transform_bounds(
            self.scene.meshes[mesh_index].local_bounds,
            self.world_matrix(node_index),
        ))
    }

    pub fn center_distance(&self, left: &str, right: &str) -> Result<f64, SceneError> {
        Ok(self
            .bounds(left)?
            .center()
            .distance(self.bounds(right)?.center()) as f64)
    }

    pub fn target_distance(&self, object_id: &str, target: [f64; 3]) -> Result<f64, SceneError> {
        Ok(self.bounds(object_id)?.center().distance(Vec3::new(
            target[0] as f32,
            target[1] as f32,
            target[2] as f32,
        )) as f64)
    }

    pub fn overlap_volume(&self, left: &str, right: &str) -> Result<f64, SceneError> {
        let left = self.bounds(left)?;
        let right = self.bounds(right)?;
        Ok(
            (left.max[0].min(right.max[0]) - left.min[0].max(right.min[0])).max(0.0)
                * (left.max[1].min(right.max[1]) - left.min[1].max(right.min[1])).max(0.0)
                * (left.max[2].min(right.max[2]) - left.min[2].max(right.min[2])).max(0.0),
        )
    }

    pub fn intersects(&self, left: &str, right: &str) -> Result<bool, SceneError> {
        Ok(self.overlap_volume(left, right)? > 0.0)
    }

    pub fn surface_area(&self, object_id: &str) -> Result<f64, SceneError> {
        let index = self.node_index(object_id)?;
        let mesh = self.scene.nodes[index].mesh.ok_or_else(|| {
            SceneError::MetricUnavailable(format!("object `{object_id}` has no mesh"))
        })?;
        let geometry = &self.scene.meshes[mesh];
        let transform = self.world_matrix(index);
        Ok(geometry
            .indices
            .chunks_exact(3)
            .map(|triangle| {
                let a = transform.transform_point3(geometry.positions[triangle[0] as usize]);
                let b = transform.transform_point3(geometry.positions[triangle[1] as usize]);
                let c = transform.transform_point3(geometry.positions[triangle[2] as usize]);
                0.5 * ((b - a).cross(c - a).length() as f64)
            })
            .sum())
    }

    pub fn volume(&self, object_id: &str) -> Result<f64, SceneError> {
        let index = self.node_index(object_id)?;
        let mesh = self.scene.nodes[index].mesh.ok_or_else(|| {
            SceneError::MetricUnavailable(format!("object `{object_id}` has no mesh"))
        })?;
        let determinant = self.world_matrix(index).determinant().abs() as f64;
        Ok(self.scene.meshes[mesh].signed_volume.abs() * determinant)
    }

    fn node_index(&self, object_id: &str) -> Result<usize, SceneError> {
        self.scene
            .object_indices
            .get(object_id)
            .copied()
            .ok_or_else(|| SceneError::UnknownObject(object_id.into()))
    }

    fn world_matrix(&self, node_index: usize) -> Mat4 {
        if let Some(matrix) = self.world_cache.borrow()[node_index] {
            return matrix;
        }
        let node = &self.scene.nodes[node_index];
        let mut translation = node.translation;
        let mut euler = node.euler;
        let mut scale = node.scale;
        for (index, lever) in self.scene.manifest.levers.iter().enumerate() {
            let value = self.genes[index] as f32;
            match &lever.target {
                LeverTarget::Position { object_id, axis }
                    if node.id.as_deref() == Some(object_id) =>
                {
                    set_axis(&mut translation, *axis, value)
                }
                LeverTarget::Rotation { object_id, axis }
                    if node.id.as_deref() == Some(object_id) =>
                {
                    set_axis(&mut euler, *axis, value)
                }
                LeverTarget::Scale { object_id, axis } if node.id.as_deref() == Some(object_id) => {
                    set_axis(&mut scale, *axis, value)
                }
                _ => {}
            }
        }
        let rotation = if euler == node.euler {
            node.rotation
        } else {
            Quat::from_euler(EulerRot::XYZ, euler.x, euler.y, euler.z)
        };
        let local = Mat4::from_scale_rotation_translation(scale, rotation, translation);
        let world = node
            .parent
            .map(|parent| self.world_matrix(parent) * local)
            .unwrap_or(local);
        self.world_cache.borrow_mut()[node_index] = Some(world);
        world
    }
}

impl MeshGeometry {
    fn new(positions: Vec<Vec3>, indices: Vec<u32>) -> Result<Self, SceneError> {
        if positions.is_empty() || !indices.len().is_multiple_of(3) {
            return Err(SceneError::InvalidGlb("invalid triangle mesh".into()));
        }
        if indices
            .iter()
            .any(|&index| index as usize >= positions.len())
        {
            return Err(SceneError::InvalidGlb("mesh index is out of bounds".into()));
        }
        let mut minimum = Vec3::splat(f32::INFINITY);
        let mut maximum = Vec3::splat(f32::NEG_INFINITY);
        for &position in &positions {
            minimum = minimum.min(position);
            maximum = maximum.max(position);
        }
        let mut volume = 0.0;
        for triangle in indices.chunks_exact(3) {
            let a = positions[triangle[0] as usize];
            let b = positions[triangle[1] as usize];
            let c = positions[triangle[2] as usize];
            volume += a.dot(b.cross(c)) as f64 / 6.0;
        }
        Ok(Self {
            positions: positions.into(),
            indices: indices.into(),
            local_bounds: Aabb {
                min: minimum.to_array().map(|v| v as f64),
                max: maximum.to_array().map(|v| v as f64),
            },
            signed_volume: volume,
        })
    }
}

fn validate_manifest(manifest: &SceneManifest) -> Result<(), SceneError> {
    if manifest.levers.is_empty() {
        return Err(SceneError::InvalidManifest(
            "at least one lever is required".into(),
        ));
    }
    let mut ids = HashSet::new();
    for lever in &manifest.levers {
        if lever.id.trim().is_empty() || !ids.insert(&lever.id) {
            return Err(SceneError::InvalidManifest(format!(
                "duplicate or empty lever id `{}`",
                lever.id
            )));
        }
        match &lever.variable {
            Variable::Real { lower, upper }
                if !lower.is_finite() || !upper.is_finite() || lower >= upper =>
            {
                return Err(SceneError::InvalidManifest(format!(
                    "lever `{}` has invalid real bounds",
                    lever.id
                )));
            }
            Variable::Integer { lower, upper, step } if lower > upper || *step == 0 => {
                return Err(SceneError::InvalidManifest(format!(
                    "lever `{}` has invalid integer bounds",
                    lever.id
                )));
            }
            Variable::Integer { lower, upper, .. }
                if lower.unsigned_abs() > 9_007_199_254_740_991
                    || upper.unsigned_abs() > 9_007_199_254_740_991 =>
            {
                return Err(SceneError::InvalidManifest(format!(
                    "lever `{}` exceeds exact integer range",
                    lever.id
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

fn extract_ga_id(extras: &gltf::json::Extras) -> Option<String> {
    let raw = extras.as_ref()?;
    let value: Value = serde_json::from_str(raw.get()).ok()?;
    value
        .get("gaId")
        .or_else(|| value.pointer("/userData/gaId"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn set_axis(vector: &mut Vec3, axis: Axis, value: f32) {
    match axis {
        Axis::X => vector.x = value,
        Axis::Y => vector.y = value,
        Axis::Z => vector.z = value,
    }
}

fn transform_bounds(bounds: Aabb, transform: Mat4) -> Aabb {
    let min = Vec3::from_array(bounds.min.map(|value| value as f32));
    let max = Vec3::from_array(bounds.max.map(|value| value as f32));
    let mut transformed_min = Vec3::splat(f32::INFINITY);
    let mut transformed_max = Vec3::splat(f32::NEG_INFINITY);
    for x in [min.x, max.x] {
        for y in [min.y, max.y] {
            for z in [min.z, max.z] {
                let point = transform.transform_point3(Vec3::new(x, y, z));
                transformed_min = transformed_min.min(point);
                transformed_max = transformed_max.max(point);
            }
        }
    }
    Aabb {
        min: transformed_min.to_array().map(|v| v as f64),
        max: transformed_max.to_array().map(|v| v as f64),
    }
}

#[derive(Debug, Error)]
pub enum SceneError {
    #[error("invalid GLB: {0}")]
    InvalidGlb(String),
    #[error("invalid scene manifest: {0}")]
    InvalidManifest(String),
    #[error("unsupported scene feature: {0}")]
    Unsupported(String),
    #[error("invalid candidate: {0}")]
    InvalidCandidate(String),
    #[error("unknown object `{0}`")]
    UnknownObject(String),
    #[error("unknown lever `{0}`")]
    UnknownLever(String),
    #[error("unknown property `{0}`")]
    UnknownProperty(String),
    #[error("metric unavailable: {0}")]
    MetricUnavailable(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_math_is_stable() {
        let left = Aabb {
            min: [0.0, 0.0, 0.0],
            max: [2.0, 3.0, 4.0],
        };
        assert_eq!(left.volume(), 24.0);
        let moved = transform_bounds(left, Mat4::from_translation(Vec3::new(3.0, -1.0, 2.0)));
        assert_eq!(moved.min, [3.0, -1.0, 2.0]);
        assert_eq!(moved.max, [5.0, 2.0, 6.0]);
    }
}
