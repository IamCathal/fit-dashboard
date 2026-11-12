use std::sync::{Mutex, OnceLock};

use reverse_geocoder::ReverseGeocoder;

use crate::models::GeocodeResult;

/// The reverse geocoder loads a bundled dataset on first use. Keep a single
/// instance around so repeated coverage-panel clicks stay cheap.
static GEOCODER: OnceLock<Mutex<Option<ReverseGeocoder>>> = OnceLock::new();

pub fn reverse_geocode(lat: f64, lon: f64) -> Option<GeocodeResult> {
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }

    let slot = GEOCODER.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().ok()?;
    if guard.is_none() {
        *guard = Some(ReverseGeocoder::new());
    }

    let geocoder = guard.as_ref()?;
    let result = geocoder.search((lat, lon));
    let record = result.record;

    Some(GeocodeResult {
        name: record.name.clone(),
        admin1: record.admin1.clone(),
        admin2: record.admin2.clone(),
        country: record.cc.clone(),
    })
}
