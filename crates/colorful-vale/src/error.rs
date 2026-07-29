use std::fmt;

const STDERR_DETAIL_LIMIT: usize = 4096;

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
        let captured = &stderr[..stderr.len().min(STDERR_DETAIL_LIMIT)];
        let decoded = String::from_utf8_lossy(captured);
        let mut stderr_detail = decoded.trim().to_owned();
        let mut truncated = stderr.len() > STDERR_DETAIL_LIMIT;
        if stderr_detail.len() > STDERR_DETAIL_LIMIT {
            let mut end = STDERR_DETAIL_LIMIT;
            while !stderr_detail.is_char_boundary(end) {
                end -= 1;
            }
            stderr_detail.truncate(end);
            truncated = true;
        }
        let detail = if stderr_detail.is_empty() {
            "no stderr".to_string()
        } else if truncated {
            format!("stderr: {stderr_detail} [truncated]")
        } else {
            format!("stderr: {stderr_detail}")
        };
        let status = match code {
            Some(code) => format!("exited with code {code}"),
            None => "terminated by signal".to_string(),
        };
        Self::new(
            ValeErrorKind::ProcessFailure,
            format!("{phase} {status}; {detail}"),
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

#[cfg(test)]
mod tests {
    use super::ValeError;

    #[test]
    fn process_failure_bounds_stderr_and_formats_exit_status() {
        let numeric = ValeError::process_failure("Vale analysis", Some(7), &vec![b'x'; 8192]);
        assert!(numeric
            .message()
            .starts_with("Vale analysis exited with code 7;"));
        assert!(!numeric.message().contains("Some("));
        assert!(numeric.message().contains("[truncated]"));
        assert!(
            numeric.message().len() <= 4200,
            "bounded stderr produced {} message bytes",
            numeric.message().len()
        );

        let invalid_utf8 = ValeError::process_failure("Vale analysis", Some(8), &vec![0xff; 8192]);
        assert!(invalid_utf8.message().contains('\u{fffd}'));
        assert!(invalid_utf8.message().len() <= 4200);

        let signalled = ValeError::process_failure("Vale analysis", None, b"");
        assert_eq!(
            signalled.message(),
            "Vale analysis terminated by signal; no stderr"
        );
    }
}
