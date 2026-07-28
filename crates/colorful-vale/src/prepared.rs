use colorful_core::{Analyzer, Finding, Token, Tree};

use crate::{ValeError, ValeErrorKind};

/// A successful, normalized Vale result bound to one exact source snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedValeAnalysis {
    source: String,
    findings: Vec<Finding>,
}

impl PreparedValeAnalysis {
    pub(crate) fn new(source: &str, findings: Vec<Finding>) -> Self {
        Self {
            source: source.to_owned(),
            findings,
        }
    }

    /// Inspect the normalized findings without invoking a surface.
    #[must_use]
    pub fn findings(&self) -> &[Finding] {
        &self.findings
    }

    /// Bind this result to the same source text before passing it to a surface.
    ///
    /// # Errors
    ///
    /// Returns [`ValeErrorKind::SourceMismatch`] when `source` differs from the
    /// snapshot analyzed by Vale.
    pub fn bind(&self, source: &str) -> Result<BoundValeAnalyzer<'_>, ValeError> {
        if source != self.source {
            return Err(ValeError::new(
                ValeErrorKind::SourceMismatch,
                "prepared Vale analysis belongs to different source text",
            ));
        }
        Ok(BoundValeAnalyzer { prepared: self })
    }
}

/// An I/O-free, document-bound implementation of Colorful's [`Analyzer`] port.
#[derive(Debug, Clone, Copy)]
pub struct BoundValeAnalyzer<'a> {
    prepared: &'a PreparedValeAnalysis,
}

impl Analyzer for BoundValeAnalyzer<'_> {
    fn analyze(&self, source: &str, _tree: &Tree, _tokens: &[Token]) -> Vec<Finding> {
        assert_eq!(
            source, self.prepared.source,
            "BoundValeAnalyzer must be used with the source accepted by bind()"
        );
        self.prepared.findings.clone()
    }
}
