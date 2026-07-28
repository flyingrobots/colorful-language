use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use crate::{ValeError, ValeErrorKind};

/// The Vale major version whose JSON/stdin CLI contract this adapter supports.
pub const SUPPORTED_VALE_MAJOR: u64 = 3;

/// The default maximum captured stdout or stderr size: eight mebibytes.
pub const DEFAULT_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// Explicit process configuration for [`crate::ValeAnalyzer`].
#[derive(Debug, Clone)]
pub struct ValeConfig {
    executable: PathBuf,
    configuration: PathBuf,
    timeout: Duration,
    output_limit: usize,
}

impl ValeConfig {
    /// Configure a Vale executable and `.vale.ini` path.
    #[must_use]
    pub fn new(executable: impl Into<PathBuf>, configuration: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            configuration: configuration.into(),
            timeout: DEFAULT_TIMEOUT,
            output_limit: DEFAULT_OUTPUT_LIMIT,
        }
    }

    /// Override the process timeout used for discovery and analysis.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Override the maximum bytes retained from each output stream.
    #[must_use]
    pub fn with_output_limit(mut self, output_limit: usize) -> Self {
        self.output_limit = output_limit;
        self
    }

    /// Return the default output limit in bytes.
    #[must_use]
    pub const fn default_output_limit() -> usize {
        DEFAULT_OUTPUT_LIMIT
    }

    pub(crate) fn validate(mut self) -> Result<Self, ValeError> {
        if self.timeout.is_zero() {
            return Err(ValeError::new(
                ValeErrorKind::Configuration,
                "Vale timeout must be greater than zero",
            ));
        }
        if self.output_limit == 0 {
            return Err(ValeError::new(
                ValeErrorKind::Configuration,
                "Vale output limit must be greater than zero",
            ));
        }
        let current_directory = std::env::current_dir().map_err(|error| {
            ValeError::new(
                ValeErrorKind::Configuration,
                format!("could not resolve current directory: {error}"),
            )
        })?;
        if !self.configuration.is_absolute() {
            self.configuration = current_directory.join(&self.configuration);
        }
        if !self.executable.is_absolute() && self.executable.components().count() > 1 {
            self.executable = current_directory.join(&self.executable);
        }
        let metadata = self.configuration.metadata().map_err(|error| {
            ValeError::new(
                ValeErrorKind::Configuration,
                format!(
                    "Vale configuration {} is unavailable: {error}",
                    self.configuration.display()
                ),
            )
        })?;
        if !metadata.is_file() {
            return Err(ValeError::new(
                ValeErrorKind::Configuration,
                format!(
                    "Vale configuration {} is not a regular file",
                    self.configuration.display()
                ),
            ));
        }
        Ok(self)
    }

    pub(crate) fn executable(&self) -> &Path {
        &self.executable
    }

    pub(crate) fn configuration(&self) -> &Path {
        &self.configuration
    }

    pub(crate) fn working_directory(&self) -> &Path {
        self.configuration
            .parent()
            .expect("an absolute configuration path has a parent")
    }

    pub(crate) fn timeout(&self) -> Duration {
        self.timeout
    }

    pub(crate) fn output_limit(&self) -> usize {
        self.output_limit
    }
}

/// Vale CLI capabilities admitted by version discovery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValeCapabilities {
    version: String,
    major: u64,
}

impl ValeCapabilities {
    pub(crate) fn from_version_output(output: &str) -> Result<Self, ValeError> {
        let version = output
            .split_whitespace()
            .find_map(parse_version_token)
            .ok_or_else(|| {
                ValeError::new(
                    ValeErrorKind::IncompatibleVersion,
                    format!("Vale version output did not contain semantic version: {output:?}"),
                )
            })?;
        let major = version
            .split('.')
            .next()
            .and_then(|part| part.parse::<u64>().ok())
            .expect("parse_version_token validated the major component");
        if major != SUPPORTED_VALE_MAJOR {
            return Err(ValeError::new(
                ValeErrorKind::IncompatibleVersion,
                format!(
                    "Vale major version {major} is unsupported; expected {SUPPORTED_VALE_MAJOR}.x"
                ),
            ));
        }
        Ok(Self { version, major })
    }

    /// Return the discovered semantic version.
    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    /// Return the discovered major version.
    #[must_use]
    pub fn major(&self) -> u64 {
        self.major
    }

    /// Whether the admitted CLI supports built-in JSON output.
    #[must_use]
    pub const fn json_output(&self) -> bool {
        true
    }

    /// Whether the admitted CLI supports stdin with an explicit extension.
    #[must_use]
    pub const fn stdin_input(&self) -> bool {
        true
    }
}

fn parse_version_token(token: &str) -> Option<String> {
    let token = token
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '.');
    let token = token.strip_prefix('v').unwrap_or(token);
    let mut parts = token.split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    let patch = parts.next()?;
    if parts.next().is_some()
        || major.is_empty()
        || minor.is_empty()
        || patch.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || !minor.bytes().all(|byte| byte.is_ascii_digit())
        || !patch.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(format!("{major}.{minor}.{patch}"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::ValeConfig;

    #[test]
    fn relative_paths_are_resolved_before_the_process_changes_directory() {
        let current = std::env::current_dir().expect("current directory");
        let relative_root =
            std::path::PathBuf::from("target").join(format!("vale-config-{}", std::process::id()));
        let absolute_root = current.join(&relative_root);
        fs::create_dir_all(&absolute_root).expect("create test root");
        let executable = relative_root.join("bin/vale");
        let configuration = relative_root.join("config/.vale.ini");
        fs::create_dir_all(
            absolute_root
                .join("config")
                .parent()
                .expect("config parent"),
        )
        .expect("create config parent");
        fs::create_dir_all(absolute_root.join("config")).expect("create config directory");
        fs::write(current.join(&configuration), "[*.txt]\n").expect("write config");

        let validated = ValeConfig::new(&executable, &configuration)
            .validate()
            .expect("validate relative paths");
        assert_eq!(validated.executable, current.join(executable));
        assert_eq!(validated.configuration, current.join(configuration));

        fs::remove_dir_all(absolute_root).expect("remove test root");
    }
}

/// A cloneable cancellation signal for one Vale process execution.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    /// Create a non-cancelled token.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Signal cancellation to the process owner.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    /// Whether cancellation has been requested.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}
