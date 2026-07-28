//! Optional Vale process adapter for Colorful.
//!
//! [`ValeAnalyzer`] owns capability discovery and process execution. A
//! successful run returns a document-bound [`PreparedValeAnalysis`]; binding it
//! to the same source yields a [`BoundValeAnalyzer`] that implements Colorful's
//! I/O-free [`colorful_core::Analyzer`] port.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod config;
mod error;
mod output;
mod prepared;
mod process;

use std::ffi::OsString;

pub use config::{
    CancellationToken, ValeCapabilities, ValeConfig, DEFAULT_OUTPUT_LIMIT, SUPPORTED_VALE_MAJOR,
};
pub use error::{ValeError, ValeErrorKind};
pub use prepared::{BoundValeAnalyzer, PreparedValeAnalysis};

use output::parse_findings;
use process::{run_process, ProcessInput};

/// A discovered Vale v3 process adapter.
///
/// Discovery validates the explicit configuration and executable version once.
/// Each [`analyze`](Self::analyze) call then runs Vale against one stdin
/// snapshot. The adapter never downloads styles, invokes `vale sync`, or falls
/// back to Colorful's built-in analyzer.
#[derive(Debug, Clone)]
pub struct ValeAnalyzer {
    config: ValeConfig,
    capabilities: ValeCapabilities,
}

impl ValeAnalyzer {
    /// Discover a supported Vale executable from explicit configuration.
    ///
    /// # Errors
    ///
    /// Returns a typed error when configuration is invalid, the executable
    /// cannot start, discovery times out, output is malformed, or the reported
    /// major version is unsupported.
    pub fn discover(config: ValeConfig) -> Result<Self, ValeError> {
        let config = config.validate()?;
        let cancellation = CancellationToken::new();
        let output = run_process(
            config.executable(),
            &[OsString::from("--version")],
            config.working_directory(),
            ProcessInput::None,
            config.timeout(),
            config.output_limit(),
            &cancellation,
        )?;
        if !output.status.success() {
            return Err(ValeError::process_failure(
                "Vale version discovery",
                output.status.code(),
                &output.stderr,
            ));
        }
        let version_output = output.stdout_text()?;
        let capabilities = ValeCapabilities::from_version_output(version_output)?;
        Ok(Self {
            config,
            capabilities,
        })
    }

    /// Return the capabilities admitted during discovery.
    #[must_use]
    pub fn capabilities(&self) -> &ValeCapabilities {
        &self.capabilities
    }

    /// Analyze one source snapshot through the discovered Vale process.
    ///
    /// # Errors
    ///
    /// Returns a typed error for cancellation, timeout, process failure,
    /// excessive output, invalid UTF-8, malformed JSON, invalid alert fields,
    /// or illegal source coordinates. No failure becomes an empty finding list.
    pub fn analyze(
        &self,
        source: &str,
        cancellation: &CancellationToken,
    ) -> Result<PreparedValeAnalysis, ValeError> {
        if cancellation.is_cancelled() {
            return Err(ValeError::new(
                ValeErrorKind::Cancelled,
                "Vale analysis was cancelled before process start",
            ));
        }
        let arguments = [
            OsString::from("--output=JSON"),
            OsString::from("--no-exit"),
            OsString::from("--no-global"),
            OsString::from(format!(
                "--config={}",
                self.config.configuration().display()
            )),
            OsString::from("--ext=.txt"),
        ];
        let output = run_process(
            self.config.executable(),
            &arguments,
            self.config.working_directory(),
            ProcessInput::Bytes(source.as_bytes().to_vec()),
            self.config.timeout(),
            self.config.output_limit(),
            cancellation,
        )?;
        if !output.status.success() {
            return Err(ValeError::process_failure(
                "Vale analysis",
                output.status.code(),
                &output.stderr,
            ));
        }
        let json = output.stdout_text()?;
        let findings = parse_findings(source, json)?;
        Ok(PreparedValeAnalysis::new(source, findings))
    }
}
