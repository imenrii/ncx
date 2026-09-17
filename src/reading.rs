use std::sync::Arc;

use bytes::Bytes;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, oneshot};

use crate::dataset::DataError;

pub const MAX_REQUESTS: usize = 32;
pub const MAX_READS: usize = 4;
pub const MEMORY_BYTES: usize = 256 * 1024 * 1024;
const PAGE_BYTES: usize = 64 * 1024;

/// Admission precedes blocking work. Returned buffers retain their reservation.
pub struct ReadAdmission {
    jobs: Arc<Semaphore>,
    reads: Arc<Semaphore>,
    memory: Arc<Semaphore>,
}

impl Default for ReadAdmission {
    fn default() -> Self {
        Self {
            jobs: Arc::new(Semaphore::new(MAX_REQUESTS)),
            reads: Arc::new(Semaphore::new(MAX_READS)),
            memory: Arc::new(Semaphore::new(MEMORY_BYTES / PAGE_BYTES)),
        }
    }
}

impl ReadAdmission {
    pub fn admit(&self) -> Result<OwnedSemaphorePermit, DataError> {
        self.jobs
            .clone()
            .try_acquire_owned()
            .map_err(|_| DataError::new(503, "reader_busy", "Reader busy; retry shortly"))
    }

    pub async fn reserve(&self, bytes: usize) -> Result<OwnedSemaphorePermit, DataError> {
        if bytes > MEMORY_BYTES {
            return Err(DataError::new(
                413,
                "read_memory_limit",
                "Read exceeds the memory budget; use a larger stride",
            ));
        }
        self.memory
            .clone()
            .acquire_many_owned(bytes.div_ceil(PAGE_BYTES) as u32)
            .await
            .map_err(|_| DataError::new(503, "reader_closed", "Reader closed"))
    }

    pub async fn blocking<T: Send + 'static>(
        &self,
        operation: impl FnOnce() -> Result<T, DataError> + Send + 'static,
    ) -> Result<T, DataError> {
        let permit = self
            .reads
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| DataError::new(503, "reader_closed", "Reader closed"))?;
        let (sender, receiver) = oneshot::channel();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            if !sender.is_closed() {
                let _ = sender.send(operation());
            }
        });
        receiver
            .await
            .map_err(|_| DataError::new(500, "read_task_failed", "Read failed"))?
    }
}

pub fn reserved_body(body: Vec<u8>, permit: OwnedSemaphorePermit) -> Bytes {
    struct ReservedBody {
        body: Vec<u8>,
        _permit: OwnedSemaphorePermit,
    }
    impl AsRef<[u8]> for ReservedBody {
        fn as_ref(&self) -> &[u8] {
            &self.body
        }
    }
    Bytes::from_owner(ReservedBody {
        body,
        _permit: permit,
    })
}

pub fn bounded_json(value: &impl serde::Serialize, limit: usize) -> Result<Vec<u8>, DataError> {
    struct Buffer {
        bytes: Vec<u8>,
        limit: usize,
    }
    impl std::io::Write for Buffer {
        fn write(&mut self, value: &[u8]) -> std::io::Result<usize> {
            if value.len() > self.limit.saturating_sub(self.bytes.len()) {
                return Err(std::io::Error::other("metadata limit exceeded"));
            }
            let required = self.bytes.len() + value.len();
            if required > self.bytes.capacity() {
                let capacity = required
                    .max(self.bytes.capacity().saturating_mul(2))
                    .min(self.limit);
                self.bytes.reserve_exact(capacity - self.bytes.len());
            }
            self.bytes.extend_from_slice(value);
            Ok(value.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut buffer = Buffer {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut buffer, value).map_err(|_| {
        DataError::new(413, "metadata_too_large", "Metadata exceeds the size limit")
    })?;
    Ok(buffer.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn admission_and_memory_follow_response_lifetime() {
        let reads = ReadAdmission::default();
        let tickets: Vec<_> = (0..MAX_REQUESTS).map(|_| reads.admit().unwrap()).collect();
        assert_eq!(reads.admit().unwrap_err().status, 503);
        drop(tickets);
        assert!(reads.admit().is_ok());
        assert!(bounded_json(&vec!["long"; 100], 16).is_err());
        let permit = reads.reserve(MEMORY_BYTES).await.unwrap();
        let body = reserved_body(vec![1, 2, 3], permit);
        let clone = body.clone();
        drop(body);
        assert_eq!(reads.memory.available_permits(), 0);
        drop(clone);
        assert_eq!(reads.memory.available_permits(), MEMORY_BYTES / PAGE_BYTES);
        assert_eq!(
            reads.reserve(MEMORY_BYTES + 1).await.unwrap_err().status,
            413
        );
    }

    #[tokio::test]
    async fn cancelled_waiters_do_not_run_a_blocking_read() {
        let reads = Arc::new(ReadAdmission::default());
        let permit = reads
            .reads
            .clone()
            .acquire_many_owned(MAX_READS as u32)
            .await
            .unwrap();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let worker = {
            let reads = reads.clone();
            let count = count.clone();
            tokio::spawn(async move {
                reads
                    .blocking(move || {
                        count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(())
                    })
                    .await
            })
        };
        tokio::task::yield_now().await;
        worker.abort();
        assert!(worker.await.unwrap_err().is_cancelled());
        drop(permit);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
