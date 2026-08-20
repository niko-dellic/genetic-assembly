use async_trait::async_trait;
use bytes::Bytes;
use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt, PutPayload};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

#[async_trait]
pub trait ArtifactStore: Send + Sync {
    async fn put(&self, key: &str, bytes: Vec<u8>) -> Result<(), StorageError>;
    async fn get(&self, key: &str) -> Result<Bytes, StorageError>;
}

#[derive(Clone)]
pub struct UnifiedArtifactStore {
    inner: Arc<dyn ObjectStore>,
}

impl UnifiedArtifactStore {
    pub fn local(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        std::fs::create_dir_all(root.as_ref())
            .map_err(|error| StorageError::Configuration(error.to_string()))?;
        let store = LocalFileSystem::new_with_prefix(root)
            .map_err(|error| StorageError::Configuration(error.to_string()))?;
        Ok(Self {
            inner: Arc::new(store),
        })
    }

    pub fn s3_from_env(bucket: &str) -> Result<Self, StorageError> {
        let store = AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()
            .map_err(|error| StorageError::Configuration(error.to_string()))?;
        Ok(Self {
            inner: Arc::new(store),
        })
    }

    fn path(key: &str) -> Result<ObjectPath, StorageError> {
        ObjectPath::parse(key).map_err(|error| StorageError::InvalidKey(error.to_string()))
    }
}

#[async_trait]
impl ArtifactStore for UnifiedArtifactStore {
    async fn put(&self, key: &str, bytes: Vec<u8>) -> Result<(), StorageError> {
        self.inner
            .put(
                &Self::path(key)?,
                PutPayload::from_bytes(Bytes::from(bytes)),
            )
            .await
            .map_err(|error| StorageError::Operation(error.to_string()))?;
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Bytes, StorageError> {
        self.inner
            .get(&Self::path(key)?)
            .await
            .map_err(|error| StorageError::Operation(error.to_string()))?
            .bytes()
            .await
            .map_err(|error| StorageError::Operation(error.to_string()))
    }
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("artifact-store configuration failed: {0}")]
    Configuration(String),
    #[error("invalid artifact key: {0}")]
    InvalidKey(String),
    #[error("artifact-store operation failed: {0}")]
    Operation(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_store_round_trips_nested_artifacts() {
        let root =
            std::env::temp_dir().join(format!("genetic-assembly-storage-{}", uuid::Uuid::new_v4()));
        let store = UnifiedArtifactStore::local(&root).unwrap();
        store
            .put("runs/example/checkpoint.zst", vec![1, 2, 3, 4])
            .await
            .unwrap();
        assert_eq!(
            store
                .get("runs/example/checkpoint.zst")
                .await
                .unwrap()
                .as_ref(),
            &[1, 2, 3, 4]
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
