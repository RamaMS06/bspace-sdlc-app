//! Talking to the world outside the app's own logic: the database, the keychain, HTTP, the Buma API,
//! running programs, and telemetry.

pub(crate) mod api_url;
pub(crate) mod cloud;
pub(crate) mod db;
pub(crate) mod exec;
pub(crate) mod http;
pub(crate) mod telemetry;
pub(crate) mod token_store;
