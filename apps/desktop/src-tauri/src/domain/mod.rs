//! What the app does, one module per area: the logic the commands call into. Nothing here knows about
//! windows, commands or events.

pub mod acp;
pub(crate) mod accounts;
pub(crate) mod admin;
pub(crate) mod activity;
pub(crate) mod agents;
pub(crate) mod ai_proxy;
pub(crate) mod api_engine;
pub(crate) mod attachments;
pub(crate) mod auth;
pub(crate) mod claude_account;
pub(crate) mod devops;
pub(crate) mod device;
pub(crate) mod docx;
pub(crate) mod environment;
pub(crate) mod files;
pub(crate) mod model_catalog;
pub(crate) mod plugin_sync;
pub(crate) mod plugins;
pub(crate) mod projects;
pub(crate) mod share;
pub(crate) mod skills;
pub(crate) mod trace;
pub(crate) mod usage;
pub(crate) mod workspace;
