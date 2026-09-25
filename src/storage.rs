//! Storage queries and a read-only data handle for cache controls absent from
//! the high-level wrapper. Its metadata handle closes before caches are configured.
use std::collections::HashMap;
use std::ffi::CString;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use netcdf::types::{FloatType, IntType, NcTypeDescriptor, NcVariableType};
use netcdf_sys::*;

const CACHE_BUDGET: usize = 64 * 1024 * 1024;
const VARIABLE_CACHE_LIMIT: usize = 32 * 1024 * 1024;
static CACHE_BYTES: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Debug, Default)]
pub struct Layout {
    pub chunks: Option<Vec<usize>>,
    pub netcdf4: bool,
    pub filtered: bool,
    group: i32,
    variable: i32,
    dtype: i32,
    rank: usize,
}

impl Layout {
    pub fn touched(&self, start: &[usize], count: &[usize], stride: &[isize]) -> Option<usize> {
        let chunks = self.chunks.as_ref()?;
        start.iter().zip(count).zip(stride).zip(chunks).try_fold(
            1usize,
            |total, (((&a, &m), &s), &c)| {
                let last = a.checked_add((m - 1).checked_mul(s as usize)?)?;
                total.checked_mul(m.min(last / c - a / c + 1))
            },
        )
    }
}

pub struct Reader {
    id: i32,
    caches: HashMap<(i32, i32), usize>,
}

fn check(code: i32) -> Result<(), String> {
    if code == NC_NOERR {
        return Ok(());
    }
    Err(netcdf::Error::from(code).to_string())
}

impl Reader {
    pub fn open(path: &Path) -> Result<Self, String> {
        let name = CString::new(path.as_os_str().as_encoded_bytes()).map_err(|e| e.to_string())?;
        let _guard = libnetcdf_lock.lock();
        let mut id = 0;
        // The path is NUL-terminated and the result lives until Drop.
        check(unsafe { nc_open(name.as_ptr(), NC_NOWRITE, &mut id) })?;
        Ok(Self {
            id,
            caches: HashMap::new(),
        })
    }

    pub fn layout(&self, path: &str, rank: usize) -> Result<Layout, String> {
        let _guard = libnetcdf_lock.lock();
        let (parent, name) = path.rsplit_once('/').ok_or("invalid variable path")?;
        let name = CString::new(name).map_err(|e| e.to_string())?;
        let mut result = Layout {
            group: self.id,
            rank,
            ..Layout::default()
        };
        // All pointers refer to initialized scalars or rank-sized output arrays.
        unsafe {
            if !parent.is_empty() {
                let parent = CString::new(parent).map_err(|e| e.to_string())?;
                check(nc_inq_grp_full_ncid(
                    self.id,
                    parent.as_ptr(),
                    &mut result.group,
                ))?;
            }
            check(nc_inq_varid(
                result.group,
                name.as_ptr(),
                &mut result.variable,
            ))?;
            check(nc_inq_vartype(
                result.group,
                result.variable,
                &mut result.dtype,
            ))?;
            let mut actual_rank = 0;
            check(nc_inq_varndims(
                result.group,
                result.variable,
                &mut actual_rank,
            ))?;
            if actual_rank as usize != rank {
                return Err("variable rank changed while opening".into());
            }
            // Classic files also answer the chunk inquiry successfully.
            let mut format = 0;
            check(nc_inq_format(self.id, &mut format))?;
            result.netcdf4 = matches!(format, NC_FORMAT_NETCDF4 | NC_FORMAT_NETCDF4_CLASSIC);
            if !result.netcdf4 {
                return Ok(result);
            }
            let mut chunks = vec![0; rank];
            let mut storage = 0;
            let code = nc_inq_var_chunking(
                result.group,
                result.variable,
                &mut storage,
                chunks.as_mut_ptr(),
            );
            if code == NC_ENOTNC4 {
                return Ok(result);
            }
            check(code)?;
            if storage == NC_CHUNKED {
                if chunks.contains(&0) {
                    return Err("invalid zero chunk length".into());
                }
                let mut filters = 0;
                check(nc_inq_var_filter_ids(
                    result.group,
                    result.variable,
                    &mut filters,
                    std::ptr::null_mut(),
                ))?;
                result.filtered = filters != 0;
                result.chunks = Some(chunks);
                // Inactive variables own no data cache; reads reserve their cache first.
                check(nc_set_var_chunk_cache(
                    result.group,
                    result.variable,
                    0,
                    1,
                    0.75,
                ))?;
            }
        }
        Ok(result)
    }

    pub fn read<T: NcTypeDescriptor + Copy>(
        &mut self,
        layout: &Layout,
        start: &[usize],
        count: &[usize],
        stride: &[isize],
    ) -> Result<Vec<T>, String> {
        if start.len() != layout.rank
            || count.len() != layout.rank
            || stride.len() != layout.rank
            || count.contains(&0)
            || stride.iter().any(|&step| step <= 0)
        {
            return Err("invalid native read extents".into());
        }
        let dtype = match T::type_descriptor() {
            NcVariableType::Int(IntType::U8) => NC_UBYTE,
            NcVariableType::Int(IntType::I8) => NC_BYTE,
            NcVariableType::Int(IntType::U16) => NC_USHORT,
            NcVariableType::Int(IntType::I16) => NC_SHORT,
            NcVariableType::Int(IntType::U32) => NC_UINT,
            NcVariableType::Int(IntType::I32) => NC_INT,
            NcVariableType::Int(IntType::U64) => NC_UINT64,
            NcVariableType::Int(IntType::I64) => NC_INT64,
            NcVariableType::Float(FloatType::F32) => NC_FLOAT,
            NcVariableType::Float(FloatType::F64) => NC_DOUBLE,
            _ => return Err("unsupported read type".into()),
        };
        if dtype != layout.dtype {
            return Err("stored type changed while opening".into());
        }
        let elements = count
            .iter()
            .try_fold(1usize, |n, &m| n.checked_mul(m))
            .ok_or("read size overflow")?;
        let _guard = libnetcdf_lock.lock();
        self.cache(layout, start, count, stride, std::mem::size_of::<T>())?;
        let mut values = Vec::<T>::with_capacity(elements);
        // The dtype is an exact primitive match and count determines the reserved
        // output length. NetCDF initializes all elements on success.
        unsafe {
            macro_rules! read {
                ($function:ident) => {
                    $function(
                        layout.group,
                        layout.variable,
                        start.as_ptr(),
                        count.as_ptr(),
                        stride.as_ptr(),
                        values.as_mut_ptr().cast(),
                    )
                };
            }
            check(match dtype {
                NC_UBYTE => read!(nc_get_vars_uchar),
                NC_BYTE => read!(nc_get_vars_schar),
                NC_USHORT => read!(nc_get_vars_ushort),
                NC_SHORT => read!(nc_get_vars_short),
                NC_UINT => read!(nc_get_vars_uint),
                NC_INT => read!(nc_get_vars_int),
                NC_UINT64 => read!(nc_get_vars_ulonglong),
                NC_INT64 => read!(nc_get_vars_longlong),
                NC_FLOAT => read!(nc_get_vars_float),
                NC_DOUBLE => read!(nc_get_vars_double),
                _ => unreachable!("primitive type was checked above"),
            })?;
            values.set_len(elements);
        }
        Ok(values)
    }

    fn cache(
        &mut self,
        layout: &Layout,
        start: &[usize],
        count: &[usize],
        stride: &[isize],
        element_bytes: usize,
    ) -> Result<(), String> {
        let Some(chunks) = &layout.chunks else {
            return Ok(());
        };
        let chunk_bytes = chunks
            .iter()
            .try_fold(element_bytes, |n, &m| n.checked_mul(m));
        let Some(chunk_bytes) = chunk_bytes.filter(|&bytes| bytes <= VARIABLE_CACHE_LIMIT) else {
            return Ok(());
        };
        // Keep the current and previous working sets when the budget permits;
        // an exactly one-frame cache thrashes during back-and-forth navigation.
        let desired = chunk_bytes
            .checked_mul(layout.touched(start, count, stride).unwrap_or(usize::MAX))
            .and_then(|bytes| bytes.checked_mul(2))
            .unwrap_or(VARIABLE_CACHE_LIMIT)
            .min(VARIABLE_CACHE_LIMIT);
        let key = (layout.group, layout.variable);
        let retained = self.caches.get(&key).copied().unwrap_or(0);
        // Charge the hash table as well as decoded data to the process budget.
        const SLOTS: usize = 1009;
        const TABLE_BYTES: usize = SLOTS * std::mem::size_of::<usize>();
        let target = desired.saturating_add(TABLE_BYTES);
        if target <= retained {
            return Ok(());
        }
        let mut reserved = CACHE_BYTES.load(Ordering::Relaxed);
        let granted = loop {
            let available =
                retained + (target - retained).min(CACHE_BUDGET.saturating_sub(reserved));
            let data_bytes = available.saturating_sub(TABLE_BYTES) / chunk_bytes * chunk_bytes;
            let extra = (data_bytes + TABLE_BYTES).saturating_sub(retained);
            if data_bytes == 0 || extra == 0 {
                return Ok(());
            }
            match CACHE_BYTES.compare_exchange_weak(
                reserved,
                reserved + extra,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ) {
                Ok(_) => break extra,
                Err(current) => reserved = current,
            }
        };
        let result = check(unsafe {
            nc_set_var_chunk_cache(
                layout.group,
                layout.variable,
                retained + granted - TABLE_BYTES,
                SLOTS,
                0.75,
            )
        });
        if result.is_err() {
            CACHE_BYTES.fetch_sub(granted, Ordering::SeqCst);
        } else {
            self.caches.insert(key, retained + granted);
        }
        result
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        let _guard = libnetcdf_lock.lock();
        unsafe {
            nc_close(self.id);
        }
        CACHE_BYTES.fetch_sub(self.caches.values().sum(), Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_count_matches_enumeration() {
        for start in 0..8 {
            for count in 1..12 {
                for stride in 1..12 {
                    for chunk in 1..12 {
                        let layout = Layout {
                            chunks: Some(vec![chunk]),
                            ..Layout::default()
                        };
                        let explicit = (0..count)
                            .map(|i| (start + i * stride) / chunk)
                            .collect::<std::collections::HashSet<_>>()
                            .len();
                        assert_eq!(
                            layout.touched(&[start], &[count], &[stride as isize]),
                            Some(explicit)
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn cache_budget_is_shared_across_variables_and_readers() {
        let path = std::env::temp_dir().join(format!("ncx-cache-budget-{}.nc", std::process::id()));
        {
            let mut file = netcdf::create(&path).unwrap();
            for (name, n) in [("y", 4096), ("x", 4096)] {
                file.add_dimension(name, n).unwrap();
            }
            for name in ["a", "b"] {
                file.add_variable::<i16>(name, &["y", "x"])
                    .unwrap()
                    .set_chunking(&[4096, 4096])
                    .unwrap();
            }
        }
        let mut first = Reader::open(&path).unwrap();
        let mut second = Reader::open(&path).unwrap();
        let a = first.layout("/a", 2).unwrap();
        let b = first.layout("/b", 2).unwrap();
        let other = second.layout("/a", 2).unwrap();
        let _lock = libnetcdf_lock.lock();
        let before = CACHE_BYTES.load(Ordering::SeqCst);
        first.cache(&a, &[0, 0], &[4096, 4096], &[1, 1], 2).unwrap();
        second
            .cache(&other, &[0, 0], &[4096, 4096], &[1, 1], 2)
            .unwrap();
        first.cache(&b, &[0, 0], &[4096, 4096], &[1, 1], 2).unwrap();
        assert!(CACHE_BYTES.load(Ordering::SeqCst) <= CACHE_BUDGET);
        assert_eq!(first.caches.len() + second.caches.len(), 1);
        let retained = first
            .caches
            .values()
            .chain(second.caches.values())
            .sum::<usize>();
        assert_eq!(retained + before, CACHE_BYTES.load(Ordering::SeqCst));
        drop(first);
        drop(second);
        assert_eq!(CACHE_BYTES.load(Ordering::SeqCst), before);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_readers_keep_values_and_cache_ownership() {
        let path = std::env::temp_dir().join(format!("ncx-concurrent-{}.nc", std::process::id()));
        {
            let mut file = netcdf::create(&path).unwrap();
            file.add_dimension("x", 64).unwrap();
            let mut variable = file.add_variable::<f32>("v", &["x"]).unwrap();
            variable.set_chunking(&[16]).unwrap();
            variable
                .put_values(&(0..64).map(|i| i as f32).collect::<Vec<_>>(), ..)
                .unwrap();
        }
        let before = CACHE_BYTES.load(Ordering::SeqCst);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let path = &path;
                scope.spawn(move || {
                    let mut reader = Reader::open(path).unwrap();
                    let layout = reader.layout("/v", 1).unwrap();
                    for start in 0..8 {
                        assert_eq!(
                            reader.read::<f32>(&layout, &[start], &[16], &[2]).unwrap(),
                            (0..16).map(|i| (start + i * 2) as f32).collect::<Vec<_>>()
                        );
                    }
                });
            }
        });
        assert_eq!(CACHE_BYTES.load(Ordering::SeqCst), before);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn temporal_cache_reuses_chunks_and_releases_its_budget() {
        let path = std::env::temp_dir().join(format!("ncx-cache-{}.nc", std::process::id()));
        {
            let mut file = netcdf::create(&path).unwrap();
            for (name, n) in [("t", 8), ("y", 64), ("x", 64)] {
                file.add_dimension(name, n).unwrap();
            }
            let mut variable = file.add_variable::<f32>("v", &["t", "y", "x"]).unwrap();
            variable.set_chunking(&[8, 16, 16]).unwrap();
            variable.set_compression(1, true).unwrap();
            variable.put_values(&vec![3_f32; 8 * 64 * 64], ..).unwrap();
        }
        let mut reader = Reader::open(&path).unwrap();
        let layout = reader.layout("/v", 3).unwrap();
        assert!(layout.filtered);
        for time in 0..8 {
            assert_eq!(
                reader
                    .read::<f32>(&layout, &[time, 0, 0], &[1, 64, 64], &[1, 1, 1])
                    .unwrap(),
                vec![3.; 4096]
            );
        }
        let retained = reader.caches.values().sum::<usize>();
        assert!(retained >= 8 * 64 * 64 * 4);
        assert!(retained <= VARIABLE_CACHE_LIMIT + 1009 * std::mem::size_of::<usize>());
        let _lock = libnetcdf_lock.lock();
        let before = CACHE_BYTES.load(Ordering::SeqCst);
        drop(reader);
        assert_eq!(CACHE_BYTES.load(Ordering::SeqCst), before - retained);
        std::fs::remove_file(path).unwrap();
    }
}
