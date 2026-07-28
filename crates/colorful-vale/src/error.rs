use std::fmt;

/// Stable categories for Vale adapter failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValeErrorKind {
    /// The explicit configuration or adapter limits are invalid.
    Configuration,
    /// The configured executable could not be started.
    Unavailable,
    /// Vale version output did not contain a parseable stable semantic version.
    UnrecognizedVersion,
    /// Vale reported a parseable but unsupported major version.
    IncompatibleVersion,
    /// The process exceeded its configured deadline.
    Timeout,
    /// Cancellation was requested before the process completed.
    Cancelled,
    /// Vale exited unsuccessfully or process I/O failed.
    ProcessFailure,
    /// Captured stdout or stderr exceeded the configured bound.
    OutputTooLarge,
    /// Vale output was not valid UTF-8.
    InvalidUtf8,
    /// Vale output was not a single-source JSON result object.
    MalformedOutput,
    /// A Vale alert carried an invalid field, rule, severity, or coordinate.
    InvalidAlert,
    /// Vale named another source or a prepared analysis was rebound to new text.
    SourceMismatch,
}

/// A typed Vale adapter failure with a stable category and diagnostic message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValeError {
    kind: ValeErrorKind,
    message: String,
}

impl ValeError {
    pub(crate) fn new(kind: ValeErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(crate) fn process_failure(phase: &str, code: Option<i32>, stderr: &[u8]) -> Self {
        let stderr = String::from_utf8_lossy(stderr);
        let stderr = stderr.trim();
        let detail = if stderr.is_empty() {
            "no stderr".to_string()
        } else {
            format!("stderr: {stderr}")
        };
        Self::new(
            ValeErrorKind::ProcessFailure,
            format!("{phase} exited with code {code:?}; {detail}"),
        )
    }

    /// Return the stable failure category.
    #[must_use]
    pub fn kind(&self) -> ValeErrorKind {
        self.kind
    }

    /// Return the human-readable failure detail.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ValeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for ValeError {}
